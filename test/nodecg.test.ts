import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {
	OPERATIONS,
	operationMessageName,
	type RacesState,
	type RaceTimeAPI,
	SETTINGS_REPLICANT,
	type SettingsState,
} from "@nanahuse/racetime-protocol";
import {afterEach, expect, it, vi} from "vitest";
import {FakeSocket, flush, payload, url} from "./fixtures";

type Ack = ((error: unknown, result: unknown) => void) & {handled?: boolean};
type Handler = (data: unknown, ack?: Ack) => void;

function deepProxy<T>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	return new Proxy(value as object, {
		get: (target, property, receiver) =>
			deepProxy(Reflect.get(target, property, receiver)),
	}) as T;
}

class FakeReplicant {
	private current: unknown;
	constructor(defaultValue: unknown, stored?: unknown) {
		this.current = stored === undefined ? defaultValue : stored;
	}
	get value(): unknown {
		return deepProxy(this.current);
	}
	set value(next: unknown) {
		this.current = next;
	}
	stored(): unknown {
		return this.current;
	}
}

function loadExtension(
	stored?: SettingsState,
): [
	RaceTimeAPI,
	Map<string, FakeReplicant>,
	ReturnType<typeof vi.fn>,
	Map<string, Handler>,
	() => void,
] {
	const handlers = new Map<string, Handler>();
	const events = new Map<string, () => void>();
	const replicants = new Map<string, FakeReplicant>();
	const warn = vi.fn();
	const nodecg = {
		bundleConfig: {},
		extensions: {},
		log: {warn, info: vi.fn(), error: vi.fn()},
		once: (event: string, callback: () => void) => events.set(event, callback),
		unlisten: vi.fn(),
		Replicant: vi.fn(
			(name: string, options: {persistent: boolean; defaultValue: unknown}) => {
				const replicant = new FakeReplicant(
					options.defaultValue,
					name === SETTINGS_REPLICANT ? stored : undefined,
				);
				replicants.set(name, replicant);
				return replicant;
			},
		),
		listenFor: (
			name: string,
			bundleOrHandler: string | Handler,
			handler?: Handler,
		) => {
			handlers.set(
				typeof bundleOrHandler === "string"
					? `${bundleOrHandler}:${name}`
					: name,
				typeof bundleOrHandler === "function" ? bundleOrHandler : handler!,
			);
		},
	};
	const extension = createRequire(import.meta.url)("../extension/index.js") as (
		nodecg: unknown,
	) => RaceTimeAPI;
	return [
		extension(nodecg),
		replicants,
		warn,
		handlers,
		() => events.get("serverStopping")!(),
	];
}

afterEach(() => vi.unstubAllGlobals());

it("force-releases all watches through the NodeCG message API and publishes the remaining list", async () => {
	const sockets: FakeSocket[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(payload())),
	);
	vi.stubGlobal(
		"WebSocket",
		class extends FakeSocket {
			constructor() {
				super();
				sockets.push(this);
			}
		},
	);
	const [api, replicants, , handlers, stop] = loadExtension();
	const message = (input: unknown) =>
		new Promise((resolve) =>
			handlers.get(operationMessageName("forceUnwatchRace"))!(
				input,
				(_error, result) => resolve(result),
			),
		);
	try {
		const first = await api.request("watchRace", {url});
		const second = await api.request("watchRace", {url});
		if (!first.ok || !second.ok) throw new Error("Initial watch failed");
		for (const input of [
			{url: 42},
			{url: ""},
			{url: null},
			{url: "x".repeat(2049)},
			{},
		]) {
			expect(await message(input)).toMatchObject({
				ok: false,
				error: {code: "invalid_input"},
			});
		}
		expect(await message({url: "https://example.com/game/race"})).toMatchObject(
			{ok: false, error: {code: "invalid_url"}},
		);
		expect(await message({url: `  ${url}/?x=1#chat  `})).toEqual({
			ok: true,
			data: {released: true, releasedWatches: 2},
		});
		expect(replicants.get("racetime-races")!.stored()).toEqual({
			schemaVersion: 1,
			races: [],
		});
		expect(await api.request("getRace", {url})).toEqual({ok: true, data: null});
		for (const watch of [first.data, second.data]) {
			expect(await api.request("getWatch", {watchId: watch.watchId})).toEqual({
				ok: true,
				data: null,
			});
			expect(
				await api.request("unwatchRace", {watchId: watch.watchId}),
			).toEqual({ok: true, data: {released: false}});
		}
		expect(await api.request("listRaces", undefined)).toEqual({
			ok: true,
			data: {schemaVersion: 1, races: []},
		});
		expect(await message({url})).toEqual({
			ok: true,
			data: {released: false, releasedWatches: 0},
		});
		expect(sockets[0]!.close).toHaveBeenCalledOnce();
		expect(await api.request("watchRace", {url})).toMatchObject({
			ok: true,
			data: {state: {race: {raceId: "game/race"}}},
		});
	} finally {
		stop();
	}
});

it("publishes identical ISO race models through direct requests, messages and Replicants, including watch updates and failures", async () => {
	const sockets: FakeSocket[] = [];
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json(payload()));
	vi.stubGlobal("fetch", fetchImpl);
	vi.stubGlobal(
		"WebSocket",
		class extends FakeSocket {
			constructor() {
				super();
				sockets.push(this);
			}
		},
	);
	const handlers = new Map<string, Handler>();
	const events = new Map<string, () => void>();
	const replicants = new Map<string, FakeReplicant>();
	const extension = createRequire(import.meta.url)("../extension/index.js") as (
		nodecg: unknown,
	) => RaceTimeAPI;
	const api = extension({
		bundleConfig: {},
		extensions: {},
		log: {warn: vi.fn(), info: vi.fn(), error: vi.fn()},
		once: (name: string, callback: () => void) => events.set(name, callback),
		unlisten: vi.fn(),
		Replicant: (name: string, options: {defaultValue: unknown}) => {
			const replicant = new FakeReplicant(options.defaultValue);
			replicants.set(name, replicant);
			return replicant;
		},
		listenFor: (
			name: string,
			bundleOrHandler: string | Handler,
			handler?: Handler,
		) => {
			handlers.set(
				name,
				typeof bundleOrHandler === "function" ? bundleOrHandler : handler!,
			);
		},
	});
	try {
		const fetched = await api.request("fetchRace", {url});
		const watched = await api.request("watchRace", {url});
		if (!fetched.ok || !watched.ok) throw new Error("Race fetch failed");
		await flush();
		const initial = fetched.data.race;
		expect(watched.data.state.race).toEqual(initial);
		const assertPublished = async (race: typeof initial) => {
			expect(await api.request("getRace", {url})).toMatchObject({
				ok: true,
				data: {race},
			});
			expect(
				await api.request("getWatch", {watchId: watched.data.watchId}),
			).toMatchObject({ok: true, data: {race}});
			expect(await api.request("listRaces", undefined)).toMatchObject({
				ok: true,
				data: {schemaVersion: 1, races: [{race}]},
			});
			const message = await new Promise((resolve) =>
				handlers.get(operationMessageName("getRace"))!(
					{url},
					(_error, response) => resolve(response),
				),
			);
			expect(message).toEqual(await api.request("getRace", {url}));
			const stored = replicants.get("racetime-races")!.stored() as RacesState;
			expect(stored.races[0]?.race).toEqual(race);
			expect(stored).toEqual(JSON.parse(JSON.stringify(stored)));
		};
		await assertPublished(initial);
		const fetchMessage = await new Promise((resolve) =>
			handlers.get(operationMessageName("fetchRace"))!(
				{url},
				(_error, response) => resolve(response),
			),
		);
		expect(fetchMessage).toMatchObject({ok: true, data: {race: initial}});
		sockets[0]!.open();
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
		await flush();
		const finishedAt = new Date(Math.floor((Date.now() + 60_000) / 1000) * 1000)
			.toISOString()
			.replace(".000Z", "Z");
		const updatedPayload = {
			...payload(2, "race", "finished"),
			ended_at: finishedAt,
			info: "Updated details",
			recorded: true,
			recordable: true,
			time_limit_auto_complete: true,
			entrants: [
				{
					...payload().entrants[0],
					finish_time: "PT1.123456789S",
					finished_at: "2026-01-01T10:00:00.123456789+09:00",
				},
			],
		};
		fetchImpl.mockImplementation(async () => Response.json(updatedPayload));
		sockets[0]!.raceData(updatedPayload);
		await vi.waitFor(async () =>
			expect(await api.request("getRace", {url})).toMatchObject({
				ok: true,
				data: {race: {version: 2}},
			}),
		);
		const updated = await api.request("getRace", {url});
		if (!updated.ok || !updated.data?.race)
			throw new Error("Missing updated race");
		const race = updated.data.race;
		expect(race).toMatchObject({
			info: "Updated details",
			endedAt: finishedAt,
			recorded: true,
			recordable: true,
			timeLimitAutoComplete: true,
			entrants: [
				{
					finishTime: "PT1.123456789S",
					finishedAt: "2026-01-01T01:00:00.123456789Z",
				},
			],
			results: [
				{time: "PT1.123456789S", finishedAt: "2026-01-01T01:00:00.123456789Z"},
			],
		});
		await assertPublished(race);
		fetchImpl.mockImplementation(async () =>
			Response.json({...updatedPayload, opened_at: "invalid"}),
		);
		sockets[0]!.raceData({...updatedPayload, opened_at: "invalid"});
		expect(await api.request("getRace", {url})).toMatchObject({
			ok: true,
			data: {connection: "connected", error: null},
		});
		await assertPublished(race);
		expect(await api.request("fetchRace", {url})).toMatchObject({
			ok: false,
			error: {code: "invalid_payload"},
		});
		await assertPublished(race);
	} finally {
		events.get("serverStopping")!();
	}
});

it("loads the built extension, subscribes to the v3 event, and refreshes its public Player snapshot", async () => {
	const extension = createRequire(import.meta.url)("../extension/index.js") as (
		nodecg: unknown,
	) => RaceTimeAPI;
	const handlers = new Map<string, Handler>();
	const events = new Map<string, () => void>();
	let revision = 1,
		name = "First";
	const player = () => ({
		playerId: "p1",
		revision,
		manualDisplayName: name,
		racetime: {userId: "user1", name: "Runner"},
		speedrunCom: null,
		twitch: null,
		youtube: null,
		accounts: [
			{
				id: "acct-user1",
				service: "racetime",
				role: "primary",
				identity: {userId: "user1", name: "Runner"},
			},
		],
	});
	const sockets: FakeSocket[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(payload())),
	);
	vi.stubGlobal(
		"WebSocket",
		class extends FakeSocket {
			constructor() {
				super();
				sockets.push(this);
			}
		},
	);
	const nodecg = {
		bundleConfig: {},
		log: {warn: vi.fn(), info: vi.fn(), error: vi.fn()},
		extensions: {
			"player-manager": {
				apiVersion: 3,
				ready: Promise.resolve(),
				request: vi.fn(async (operation: string) => {
					if (operation !== "list")
						throw new Error(`unexpected operation ${operation}`);
					return {
						ok: true,
						data: {
							schemaVersion: 2,
							revision,
							players: [player()],
						},
					};
				}),
			},
		},
		once: (event: string, callback: () => void) => events.set(event, callback),
		unlisten: vi.fn(),
		Replicant: vi.fn(
			(
				_name: string,
				options: {persistent: boolean; defaultValue: unknown},
			) => ({value: options.defaultValue}),
		),
		listenFor: (
			name: string,
			bundleOrHandler: string | Handler,
			handler?: Handler,
		) => {
			handlers.set(
				typeof bundleOrHandler === "string"
					? `${bundleOrHandler}:${name}`
					: name,
				typeof bundleOrHandler === "function" ? bundleOrHandler : handler!,
			);
		},
	};
	const api = extension(nodecg);
	expect([...handlers.keys()]).toEqual([
		"player-manager:player-manager.v3.directoryChanged",
		...OPERATIONS.map(operationMessageName),
	]);
	expect(nodecg.Replicant).toHaveBeenCalledWith("racetime-settings", {
		persistent: true,
		defaultValue: {
			revision: 0,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
	const response = await new Promise((resolve) =>
		handlers.get(operationMessageName("listRaces"))!(
			undefined,
			(_error, result) => resolve(result),
		),
	);
	expect(response).toEqual(await api.request("listRaces", undefined));
	const invalid = await new Promise((resolve) =>
		handlers.get(operationMessageName("watchRace"))!(
			{url: 42},
			(_error, result) => resolve(result),
		),
	);
	expect(invalid).toMatchObject({ok: false, error: {code: "invalid_input"}});
	const watch = await api.request("watchRace", {url});
	expect(watch.ok).toBe(true);
	await flush();
	expect(await api.request("getRace", {url})).toMatchObject({
		ok: true,
		data: {participants: [{player: {displayName: "First"}}]},
	});
	const fetched = await api.request("fetchRace", {url});
	expect(fetched).toMatchObject({
		ok: true,
		data: {
			race: {raceId: "game/race"},
			resolution: {state: "ready", directoryRevision: 1},
			participants: [{status: "matched", player: {displayName: "First"}}],
		},
	});
	expect(sockets).toHaveLength(1);
	revision = 2;
	name = "Changed";
	handlers.get("player-manager:player-manager.v3.directoryChanged")!({
		directoryRevision: 2,
	});
	await flush();
	expect(await api.request("getRace", {url})).toMatchObject({
		ok: true,
		data: {
			resolution: {state: "ready", directoryRevision: 2},
			participants: [{player: {displayName: "Changed"}}],
		},
	});
	const handled = Object.assign(vi.fn(), {handled: true});
	handlers.get(operationMessageName("listRaces"))!(undefined, handled);
	await flush();
	expect(handled).not.toHaveBeenCalled();
	events.get("serverStopping")!();
	expect(sockets[0]!.close).toHaveBeenCalledOnce();
	expect(nodecg.unlisten).toHaveBeenCalledWith(
		"player-manager.v3.directoryChanged",
		"player-manager",
		expect.any(Function),
	);
});
it("exports the protocol from ESM and CommonJS without server dependencies", () => {
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import assert from 'node:assert/strict';
    import {createRequire} from 'node:module'; import * as esm from '@nanahuse/racetime-protocol';
    const cjs = createRequire(import.meta.url)('@nanahuse/racetime-protocol');
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort()); assert.equal(esm.API_VERSION, cjs.API_VERSION);
    assert.equal(cjs.operationMessageName('watchRace'), 'racetime.v4.watchRace');
    assert.equal(cjs.eventMessageName('entrantFinished'), 'racetime.v4.entrantFinished');`,
		],
		{cwd: process.cwd()},
	);
});
it("initializes from a Proxy-backed settings Replicant and reads the defaults", async () => {
	const [api] = loadExtension();
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: {
			revision: 0,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
});
it("migrates allowed RaceTime origins without changing existing settings or revision", async () => {
	const stored = {
		revision: 7,
		settings: {
			spreadsheetId: "abc_123-XYZ",
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Mappings",
			maxResolvedMappings: 35,
			leaderboardTop: 12,
		},
	} as SettingsState;
	const [api, replicants, warn] = loadExtension(stored);
	const expected = {
		revision: 7,
		settings: {
			spreadsheetId: "abc_123-XYZ",
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Mappings",
			maxResolvedMappings: 35,
			leaderboardTop: 12,
			allowedRaceOrigins: ["https://racetime.gg"],
		},
	};
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: expected,
	});
	expect(replicants.get(SETTINGS_REPLICANT)?.stored()).toEqual(expected);
	expect(warn).not.toHaveBeenCalled();
});

it("does not silently replace invalid persisted allowed origins", () => {
	const stored = {
		revision: 3,
		settings: {
			spreadsheetId: "abc_123-XYZ",
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Mappings",
			maxResolvedMappings: 35,
			leaderboardTop: 12,
			allowedRaceOrigins: ["http://example.com:8000"],
		},
	} as SettingsState;
	expect(() => loadExtension(stored)).toThrow(/HTTPを許可できるのはlocalhost/);
});

it("rejects invalid allowed origins without updating Settings", async () => {
	const invalidLists: unknown[] = [
		["ftp://racetime.gg"],
		["http://example.com:8000"],
		["http://localhost:8000/path"],
		["https://user@racetime.gg"],
		["https://racetime.gg", "https://RACETIME.GG:443/"],
		["not a URL"],
	];
	for (const allowedRaceOrigins of invalidLists) {
		const [api] = loadExtension();
		const result = await api.request("updateSettings", {
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				leaderboardTop: 20,
				allowedRaceOrigins,
			} as never,
			expectedRevision: 0,
		});
		expect(result).toMatchObject({
			ok: false,
			error: {code: "invalid_input"},
		});
		expect(await api.request("getSettings", undefined)).toMatchObject({
			ok: true,
			data: {
				revision: 0,
				settings: {allowedRaceOrigins: ["https://racetime.gg"]},
			},
		});
	}
	const [api] = loadExtension();
	expect(
		await api.request("updateSettings", {
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				leaderboardTop: 20,
				allowedRaceOrigins: [],
			},
			expectedRevision: 0,
		}),
	).toMatchObject({
		ok: true,
		data: {revision: 1, settings: {allowedRaceOrigins: []}},
	});
});

it("uses the current allowlist for get, fetch, watch and force-unwatch requests", async () => {
	const [api] = loadExtension();
	for (const operation of [
		"getRace",
		"fetchRace",
		"watchRace",
		"forceUnwatchRace",
	] as const) {
		expect(
			await api.request(operation, {url: "http://localhost:8000/game/race"}),
		).toMatchObject({
			ok: false,
			error: {code: "invalid_url"},
		});
	}
	expect(
		await api.request("updateSettings", {
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				leaderboardTop: 20,
				allowedRaceOrigins: ["http://localhost:8000"],
			},
			expectedRevision: 0,
		}),
	).toMatchObject({ok: true, data: {revision: 1}});
	expect(
		await api.request("getRace", {url: "http://localhost:8000/game/race"}),
	).toEqual({ok: true, data: null});
});

it("applies origin updates immediately and releases only removed-origin watches", async () => {
	const sockets: FakeSocket[] = [];
	const socketUrls: string[] = [];
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json(payload()));
	vi.stubGlobal("fetch", fetchImpl);
	vi.stubGlobal(
		"WebSocket",
		class extends FakeSocket {
			constructor(target: string) {
				super();
				sockets.push(this);
				socketUrls.push(target);
			}
		},
	);
	const localUrl = "http://localhost:8000/game/race";
	const [api, replicants, , , stop] = loadExtension({
		revision: 0,
		settings: {
			spreadsheetId: null,
			gameMappingsSheet: "GameMappings",
			categoryMappingsSheet: "CategoryMappings",
			maxResolvedMappings: 20,
			leaderboardTop: 20,
			allowedRaceOrigins: ["https://racetime.gg", "http://localhost:8000"],
		},
	});
	try {
		const publicWatch = await api.request("watchRace", {url});
		const localWatch = await api.request("watchRace", {url: localUrl});
		expect(publicWatch.ok).toBe(true);
		expect(localWatch.ok).toBe(true);
		expect(socketUrls).toEqual([
			"wss://racetime.gg/ws/race/race",
			"ws://localhost:8000/ws/race/race",
		]);
		const publicWatchId = publicWatch.ok ? publicWatch.data.watchId : "";
		const localWatchId = localWatch.ok ? localWatch.data.watchId : "";
		const update = (allowedRaceOrigins: string[], expectedRevision: number) =>
			api.request("updateSettings", {
				settings: {
					spreadsheetId: null,
					gameMappingsSheet: "GameMappings",
					categoryMappingsSheet: "CategoryMappings",
					maxResolvedMappings: 20,
					leaderboardTop: 20,
					allowedRaceOrigins,
				},
				expectedRevision,
			});
		const removed = await update(["https://racetime.gg"], 0);
		expect(removed).toMatchObject({ok: true, data: {revision: 1}});
		expect(sockets[0]!.close).not.toHaveBeenCalled();
		expect(sockets[1]!.close).toHaveBeenCalledOnce();
		expect(replicants.get("racetime-races")?.stored()).toMatchObject({
			races: [{url}],
		});
		expect(await api.request("getWatch", {watchId: localWatchId})).toEqual({
			ok: true,
			data: null,
		});
		expect(
			await api.request("getWatch", {watchId: publicWatchId}),
		).toMatchObject({ok: true, data: {url}});
		const added = await update(
			["https://racetime.gg", "http://localhost:8000"],
			1,
		);
		expect(added).toMatchObject({ok: true, data: {revision: 2}});
		const restartedLocalWatch = await api.request("watchRace", {url: localUrl});
		expect(restartedLocalWatch.ok).toBe(true);
		expect(socketUrls[2]).toBe("ws://localhost:8000/ws/race/race");
	} finally {
		stop();
	}
});
it("loads persisted settings exposed through a Proxy-backed Replicant", async () => {
	const [api] = loadExtension({
		revision: 4,
		settings: {
			spreadsheetId: "abc_123-XYZ",
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Mappings",
			maxResolvedMappings: 20,
			allowedRaceOrigins: ["https://racetime.gg"],
			leaderboardTop: 20,
		},
	});
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: {
			revision: 4,
			settings: {
				spreadsheetId: "abc_123-XYZ",
				gameMappingsSheet: "Games",
				categoryMappingsSheet: "Mappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
});
it("persists updates through the Replicant and restarts from the saved settings", async () => {
	const [api, replicants] = loadExtension();
	expect(
		await api.request("updateSettings", {
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "Games",
				categoryMappingsSheet: "Other",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
			expectedRevision: 0,
		}),
	).toEqual({
		ok: true,
		data: {
			revision: 1,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "Games",
				categoryMappingsSheet: "Other",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
	const saved = replicants.get(SETTINGS_REPLICANT)?.stored();
	expect(saved).toEqual({
		revision: 1,
		settings: {
			spreadsheetId: null,
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Other",
			maxResolvedMappings: 20,
			allowedRaceOrigins: ["https://racetime.gg"],
			leaderboardTop: 20,
		},
	});
	const [restarted] = loadExtension(saved as SettingsState);
	expect(await restarted.request("getSettings", undefined)).toEqual({
		ok: true,
		data: {
			revision: 1,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "Games",
				categoryMappingsSheet: "Other",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
});
it("fills the default expansion limit for settings persisted before it existed", async () => {
	const stored = {
		revision: 4,
		settings: {
			spreadsheetId: "abc_123-XYZ",
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Mappings",
		},
	} as SettingsState;
	const [api, replicants, warn] = loadExtension(stored);
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: {
			revision: 4,
			settings: {
				spreadsheetId: "abc_123-XYZ",
				gameMappingsSheet: "Games",
				categoryMappingsSheet: "Mappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
	// A missing field must not be treated as an invalid configuration.
	expect(warn).not.toHaveBeenCalled();
	expect(replicants.get(SETTINGS_REPLICANT)?.stored()).toMatchObject({
		revision: 4,
		settings: {maxResolvedMappings: 20, leaderboardTop: 20},
	});
});

it("persists a changed expansion limit and reloads it", async () => {
	const [api, replicants] = loadExtension();
	expect(
		await api.request("updateSettings", {
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "Games",
				categoryMappingsSheet: "Other",
				maxResolvedMappings: 50,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
			expectedRevision: 0,
		}),
	).toMatchObject({
		ok: true,
		data: {
			revision: 1,
			settings: {maxResolvedMappings: 50, leaderboardTop: 20},
		},
	});
	const saved = replicants.get(SETTINGS_REPLICANT)?.stored() as SettingsState;
	expect(saved.settings.maxResolvedMappings).toBe(50);
	const [restarted] = loadExtension(saved);
	expect(await restarted.request("getSettings", undefined)).toMatchObject({
		ok: true,
		data: {settings: {maxResolvedMappings: 50, leaderboardTop: 20}},
	});
});

const DEFAULT_SETTINGS: SettingsState = {
	revision: 0,
	settings: {
		spreadsheetId: null,
		gameMappingsSheet: "GameMappings",
		categoryMappingsSheet: "CategoryMappings",
		maxResolvedMappings: 20,
		allowedRaceOrigins: ["https://racetime.gg"],
		leaderboardTop: 20,
	},
};

it("resets invalid persisted settings to defaults and keeps the extension running", async () => {
	const invalid: SettingsState[] = [
		{
			revision: -1,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
		{
			revision: 1.5,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: "not a valid id",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: "",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: null,
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			} as never,
		},
		{revision: 0, settings: null as never},
	];
	for (const stored of invalid) {
		const [api, replicants, warn] = loadExtension(stored);
		expect(await api.request("getSettings", undefined)).toEqual({
			ok: true,
			data: DEFAULT_SETTINGS,
		});
		expect(replicants.get(SETTINGS_REPLICANT)?.stored()).toEqual(
			DEFAULT_SETTINGS,
		);
		expect(warn).toHaveBeenCalledTimes(1);
	}
});

it("resets when the persisted expansion limit is invalid", async () => {
	for (const maxResolvedMappings of [
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		"20",
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		const [api, replicants, warn] = loadExtension({
			revision: 0,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: maxResolvedMappings as never,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		});
		expect(await api.request("getSettings", undefined)).toEqual({
			ok: true,
			data: DEFAULT_SETTINGS,
		});
		expect(replicants.get(SETTINGS_REPLICANT)?.stored()).toEqual(
			DEFAULT_SETTINGS,
		);
		expect(warn).toHaveBeenCalledTimes(1);
	}
});

it("rejects invalid leaderboardTop values without changing Settings", async () => {
	for (const leaderboardTop of [
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		"20",
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		const [api] = loadExtension();
		const result = await api.request("updateSettings", {
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: leaderboardTop as never,
			},
			expectedRevision: 0,
		});
		expect(result).toMatchObject({ok: false, error: {code: "invalid_input"}});
		expect(await api.request("getSettings", undefined)).toMatchObject({
			ok: true,
			data: {revision: 0, settings: {leaderboardTop: 20}},
		});
	}
});

it("starts even when the persisted settings omit gameMappingsSheet", async () => {
	const [api, , warn] = loadExtension({
		revision: 0,
		settings: {
			spreadsheetId: null,
			categoryMappingsSheet: "CategoryMappings",
			maxResolvedMappings: 20,
			allowedRaceOrigins: ["https://racetime.gg"],
			leaderboardTop: 20,
		} as never,
	});
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: DEFAULT_SETTINGS,
	});
	expect(warn).toHaveBeenCalledTimes(1);
});

it("keeps valid persisted settings unchanged", async () => {
	const stored: SettingsState = {
		revision: 4,
		settings: {
			spreadsheetId: "abc_123-XYZ",
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Mappings",
			maxResolvedMappings: 20,
			allowedRaceOrigins: ["https://racetime.gg"],
			leaderboardTop: 20,
		},
	};
	const [api, , warn] = loadExtension(stored);
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: stored,
	});
	expect(warn).not.toHaveBeenCalled();
});

it("reloads the persisted defaults after a reset without warning again", async () => {
	const [api, replicants] = loadExtension({
		revision: -1,
		settings: null as never,
	});
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: DEFAULT_SETTINGS,
	});
	const saved = replicants.get(SETTINGS_REPLICANT)?.stored();
	const [restarted, , warn] = loadExtension(saved as SettingsState);
	expect(await restarted.request("getSettings", undefined)).toEqual({
		ok: true,
		data: DEFAULT_SETTINGS,
	});
	expect(warn).not.toHaveBeenCalled();
});

it("does not hide startup failures unrelated to settings validation", () => {
	const extension = createRequire(import.meta.url)("../extension/index.js") as (
		nodecg: unknown,
	) => RaceTimeAPI;
	const nodecg = {
		bundleConfig: {},
		extensions: {},
		log: {warn: vi.fn(), info: vi.fn(), error: vi.fn()},
		once: vi.fn(),
		unlisten: vi.fn(),
		Replicant: vi.fn(() => ({
			get value(): never {
				throw new TypeError("boom");
			},
			set value(_next: unknown) {},
		})),
		listenFor: vi.fn(),
	};
	expect(() => extension(nodecg)).toThrow("boom");
});
