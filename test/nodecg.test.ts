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
): [RaceTimeAPI, Map<string, FakeReplicant>] {
	const handlers = new Map<string, Handler>();
	const events = new Map<string, () => void>();
	const replicants = new Map<string, FakeReplicant>();
	const nodecg = {
		bundleConfig: {},
		extensions: {},
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
	return [extension(nodecg), replicants];
}

afterEach(() => vi.unstubAllGlobals());
it("loads the built extension, subscribes to the v2 event, and refreshes its public Player snapshot", async () => {
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
		extensions: {
			"player-manager": {
				apiVersion: 2,
				ready: Promise.resolve(),
				request: vi.fn(async (operation: string) => ({
					ok: true,
					data:
						operation === "list" ? {revision, players: [player()]} : player(),
				})),
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
		"player-manager:player-manager.v2.directoryChanged",
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
	revision = 2;
	name = "Changed";
	handlers.get("player-manager:player-manager.v2.directoryChanged")!({
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
		"player-manager.v2.directoryChanged",
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
    assert.equal(cjs.operationMessageName('watchRace'), 'racetime.v2.watchRace');`,
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
			},
		},
	});
});
it("rejects invalid persisted settings with an identifiable error", () => {
	const invalid: Array<[RegExp, SettingsState]> = [
		[
			/revision/,
			{
				revision: -1,
				settings: {
					spreadsheetId: null,
					gameMappingsSheet: "GameMappings",
					categoryMappingsSheet: "CategoryMappings",
				},
			},
		],
		[
			/revision/,
			{
				revision: 1.5,
				settings: {
					spreadsheetId: null,
					gameMappingsSheet: "GameMappings",
					categoryMappingsSheet: "CategoryMappings",
				},
			},
		],
		[
			/spreadsheetId/,
			{
				revision: 0,
				settings: {
					spreadsheetId: "not a valid id",
					gameMappingsSheet: "GameMappings",
					categoryMappingsSheet: "CategoryMappings",
				},
			},
		],
		[
			/spreadsheetId/,
			{
				revision: 0,
				settings: {
					spreadsheetId: "",
					gameMappingsSheet: "GameMappings",
					categoryMappingsSheet: "CategoryMappings",
				},
			},
		],
		[
			/categoryMappingsSheet/,
			{
				revision: 0,
				settings: {
					spreadsheetId: null,
					gameMappingsSheet: "GameMappings",
					categoryMappingsSheet: "",
				},
			},
		],
		[/settings/, {revision: 0, settings: null as never}],
	];
	for (const [message, stored] of invalid)
		expect(() => loadExtension(stored)).toThrow(message);
});
