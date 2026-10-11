import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {
	OPERATIONS,
	operationMessageName,
	type RacesState,
	type RaceTimeAPI,
} from "@nanahuse/racetime-protocol";
import {expect, it, vi} from "vitest";

it("loads the built CommonJS extension and serves the same v1 contract over NodeCG messages", async () => {
	const extension = createRequire(import.meta.url)("../extension/index.js") as (
		nodecg: unknown,
	) => RaceTimeAPI;
	type Ack = ((error: unknown, result: unknown) => void) & {handled?: boolean};
	const handlers = new Map<string, (data: unknown, ack?: Ack) => void>();
	const nodecg = {
		bundleConfig: {},
		extensions: {},
		once: vi.fn(),
		Replicant: vi.fn(
			(
				_name: string,
				options: {persistent: boolean; defaultValue: RacesState},
			) => ({value: options.defaultValue}),
		),
		listenFor: (name: string, handler: (data: unknown, ack?: Ack) => void) =>
			handlers.set(name, handler),
	};
	const api = extension(nodecg);
	expect(api.apiVersion).toBe(1);
	expect([...handlers.keys()]).toEqual(OPERATIONS.map(operationMessageName));
	expect(nodecg.Replicant).toHaveBeenCalledWith("racetime-races", {
		persistent: false,
		defaultValue: {schemaVersion: 1, races: []},
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
	const handled = Object.assign(vi.fn(), {handled: true});
	handlers.get(operationMessageName("listRaces"))!(undefined, handled);
	await Promise.resolve();
	expect(handled).not.toHaveBeenCalled();
});

it("exports the protocol from both ESM and CommonJS without server dependencies", () => {
	const source = `import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import * as esm from '@nanahuse/racetime-protocol';
    const cjs = createRequire(import.meta.url)('@nanahuse/racetime-protocol');
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    assert.equal(esm.API_VERSION, cjs.API_VERSION);
    assert.equal(cjs.operationMessageName('watchRace'), 'racetime.v1.watchRace');
    assert.equal(esm.operationMessageName('watchRace'), 'racetime.v1.watchRace');`;
	execFileSync(process.execPath, ["--input-type=module", "-e", source], {
		cwd: process.cwd(),
	});
});
