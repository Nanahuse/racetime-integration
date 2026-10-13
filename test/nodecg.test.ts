import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {
	OPERATIONS,
	operationMessageName,
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
): [RaceTimeAPI, Map<string, FakeReplicant>, ReturnType<typeof vi.fn>] {
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
	return [extension(nodecg), replicants, warn];
}

afterEach(() => vi.unstubAllGlobals());
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
    assert.equal(cjs.operationMessageName('watchRace'), 'racetime.v4.watchRace');`,
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
			},
		},
	});
});
it("loads persisted settings exposed through a Proxy-backed Replicant", async () => {
	const [api] = loadExtension({
		revision: 4,
		settings: {
			spreadsheetId: "abc_123-XYZ",
			gameMappingsSheet: "Games",
			categoryMappingsSheet: "Mappings",
			maxResolvedMappings: 20,
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
	const [api, , warn] = loadExtension(stored);
	expect(await api.request("getSettings", undefined)).toEqual({
		ok: true,
		data: {
			revision: 4,
			settings: {
				spreadsheetId: "abc_123-XYZ",
				gameMappingsSheet: "Games",
				categoryMappingsSheet: "Mappings",
				maxResolvedMappings: 20,
			},
		},
	});
	// A missing field must not be treated as an invalid configuration.
	expect(warn).not.toHaveBeenCalled();
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
			},
			expectedRevision: 0,
		}),
	).toMatchObject({
		ok: true,
		data: {revision: 1, settings: {maxResolvedMappings: 50}},
	});
	const saved = replicants.get(SETTINGS_REPLICANT)?.stored() as SettingsState;
	expect(saved.settings.maxResolvedMappings).toBe(50);
	const [restarted] = loadExtension(saved);
	expect(await restarted.request("getSettings", undefined)).toMatchObject({
		ok: true,
		data: {settings: {maxResolvedMappings: 50}},
	});
});

const DEFAULT_SETTINGS: SettingsState = {
	revision: 0,
	settings: {
		spreadsheetId: null,
		gameMappingsSheet: "GameMappings",
		categoryMappingsSheet: "CategoryMappings",
		maxResolvedMappings: 20,
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
			},
		},
		{
			revision: 1.5,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: "not a valid id",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: "",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "",
				maxResolvedMappings: 20,
			},
		},
		{
			revision: 0,
			settings: {
				spreadsheetId: null,
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
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

it("starts even when the persisted settings omit gameMappingsSheet", async () => {
	const [api, , warn] = loadExtension({
		revision: 0,
		settings: {
			spreadsheetId: null,
			categoryMappingsSheet: "CategoryMappings",
			maxResolvedMappings: 20,
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
