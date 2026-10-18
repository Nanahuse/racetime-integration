import {createRequire} from "node:module";
import {
	BUNDLE_NAME,
	eventMessageName,
	operationMessageName,
	RACES_REPLICANT,
	type RacesState,
	type RaceTimeAPI,
	type RaceTimeEvents,
} from "@nanahuse/racetime-protocol";
import {afterEach, expect, it, vi} from "vitest";
import {deferred, FakeSocket, payload, url} from "./fixtures";

type Handler = (data: unknown) => void;
const stoppers: Array<() => void> = [];
afterEach(() => {
	for (const stop of stoppers.splice(0)) stop();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function setup() {
	vi.useFakeTimers();
	let raw = payload(1, "race", "open");
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json(raw));
	const sockets: FakeSocket[] = [];
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
	const listeners = new Map<string, Handler[]>();
	const lifecycle = new Map<string, () => void>();
	const replicants = new Map<string, {value: unknown}>();
	const warn = vi.fn();
	const nodecg = {
		bundleConfig: {},
		extensions: {},
		log: {warn, info: vi.fn(), error: vi.fn()},
		once: (name: string, handler: () => void) => lifecycle.set(name, handler),
		unlisten: vi.fn(),
		Replicant: (name: string, options: {defaultValue: unknown}) => {
			const replicant = {value: options.defaultValue};
			replicants.set(name, replicant);
			return replicant;
		},
		listenFor: (
			name: string,
			bundleOrHandler: string | Handler,
			handler?: Handler,
		) => {
			const key = `${typeof bundleOrHandler === "string" ? bundleOrHandler : BUNDLE_NAME}:${name}`;
			const list = listeners.get(key) ?? [];
			list.push(
				typeof bundleOrHandler === "function" ? bundleOrHandler : handler!,
			);
			listeners.set(key, list);
		},
		sendMessage: vi.fn<(name: string, data: unknown) => void | Promise<void>>(
			(name, data) => {
				for (const handler of listeners.get(`${BUNDLE_NAME}:${name}`) ?? [])
					handler(data);
			},
		),
	};
	const extension = createRequire(import.meta.url)("../extension/index.js") as (
		nodecg: unknown,
	) => RaceTimeAPI;
	const api = extension(nodecg);
	stoppers.push(() => lifecycle.get("serverStopping")!());
	const watch = await api.request("watchRace", {url});
	if (!watch.ok) throw new Error("Initial watch failed");
	sockets[0]!.open();
	await vi.advanceTimersByTimeAsync(0);
	const change = async (patch: Partial<typeof raw>) => {
		raw = {...raw, version: raw.version + 1, ...patch};
		sockets[0]!.message('{"type":"race.data"}');
		await vi.advanceTimersByTimeAsync(0);
	};
	return {
		api,
		nodecg,
		fetchImpl,
		sockets,
		warn,
		change,
		state: () => replicants.get(RACES_REPLICANT)!.value as RacesState,
	};
}

it.each([
	"raceStartScheduled",
	"raceStarted",
	"entrantFinished",
	"entrantFinishUndone",
	"raceCancelled",
] as const)(
	"exports the event message name for %s without adding an RPC",
	(name) => {
		expect(eventMessageName(name)).toBe(`racetime.v4.${name}`);
		expect(operationMessageName("watchRace")).toBe("racetime.v4.watchRace");
	},
);

it("delivers all five event contracts in the racetime-integration namespace after publishing state", async () => {
	const {api, nodecg, change, state} = await setup();
	expect(nodecg.sendMessage).not.toHaveBeenCalled();
	const received: Array<{
		name: string;
		data: unknown;
		version: number | undefined;
	}> = [];
	for (const name of [
		"raceStartScheduled",
		"raceStarted",
		"entrantFinished",
		"entrantFinishUndone",
		"raceCancelled",
	] as const) {
		nodecg.listenFor(eventMessageName(name), BUNDLE_NAME, (data) =>
			received.push({name, data, version: state().races[0]?.race?.version}),
		);
	}
	const finishedConsumer =
		vi.fn<(event: RaceTimeEvents["entrantFinished"]) => void>();
	nodecg.listenFor(eventMessageName("entrantFinished"), BUNDLE_NAME, (data) =>
		finishedConsumer(data as RaceTimeEvents["entrantFinished"]),
	);
	await change({
		status: {value: "pending"},
		started_at: "2026-01-01T09:00:15+09:00",
	});
	await change({status: {value: "in_progress"}});
	await change({
		entrants: [
			{
				...payload().entrants[0]!,
				finish_time: "PT1.123456789S",
				finished_at: "2026-01-01T10:00:00.123456789+09:00",
			},
		],
	});
	const race = state().races[0]!.race!;
	expect(finishedConsumer).toHaveBeenCalledWith({
		raceId: race.raceId,
		url,
		raceVersion: 4,
		result: race.results[0],
	});
	expect(finishedConsumer.mock.calls[0]![0].result.time).toBe("PT1.123456789S");
	expect(finishedConsumer.mock.calls[0]![0].result.finishedAt).toBe(
		"2026-01-01T01:00:00.123456789Z",
	);
	await change({entrants: payload(1, "race", "open").entrants});
	await change({
		status: {value: "cancelled"},
		cancelled_at: "2026-01-01T00:10:00Z",
	});
	expect(received.map(({name}) => name)).toEqual([
		"raceStartScheduled",
		"raceStarted",
		"entrantFinished",
		"entrantFinishUndone",
		"raceCancelled",
	]);
	for (const [index, notification] of received.entries()) {
		expect(notification.version).toBe(index + 2);
		expect(notification.data).toMatchObject({
			raceId: "game/race",
			url,
			raceVersion: notification.version,
		});
		expect(notification.data).toEqual(
			JSON.parse(JSON.stringify(notification.data)),
		);
	}
	expect(await api.request("getRace", {url})).toMatchObject({
		ok: true,
		data: state().races[0],
	});
	expect(await api.request("listRaces", undefined)).toEqual({
		ok: true,
		data: state(),
	});
});

it.each(["synchronous", "rejected Promise"])(
	"isolates a %s send failure, continues the event batch and does not reconnect or resend",
	async (mode) => {
		const {api, nodecg, change, state, warn, fetchImpl, sockets} =
			await setup();
		nodecg.sendMessage.mockImplementationOnce(() => {
			if (mode === "synchronous") throw new Error("send failed");
			return Promise.reject(new Error("send failed"));
		});
		await change({...payload(2, "race", "in_progress")});
		expect(nodecg.sendMessage.mock.calls.map(([name]) => name)).toEqual([
			eventMessageName("raceStartScheduled"),
			eventMessageName("raceStarted"),
			eventMessageName("entrantFinished"),
		]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				"Failed to send racetime.v4.raceStartScheduled: send failed",
			),
		);
		expect(state().races[0]).toMatchObject({
			connection: "connected",
			error: null,
			race: {version: 2, status: "in_progress"},
		});
		const calls = fetchImpl.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetchImpl).toHaveBeenCalledTimes(calls);
		expect(sockets).toHaveLength(1);
		expect(nodecg.sendMessage).toHaveBeenCalledTimes(3);
		await change({});
		expect(nodecg.sendMessage).toHaveBeenCalledTimes(3);
		await change({entrants: payload(1, "race", "open").entrants});
		expect(nodecg.sendMessage).toHaveBeenLastCalledWith(
			eventMessageName("entrantFinishUndone"),
			{raceId: "game/race", url, raceVersion: 4, userId: "user1"},
		);
		expect(await api.request("getRace", {url})).toMatchObject({
			ok: true,
			data: state().races[0],
		});
	},
);

it("publishes and continues monitoring while a send Promise is pending, and logs its eventual rejection", async () => {
	const {api, nodecg, change, state, warn} = await setup();
	const sent = deferred<void>();
	nodecg.sendMessage.mockReturnValueOnce(sent.promise);
	await change({
		status: {value: "pending"},
		started_at: "2026-01-01T00:00:15Z",
	});
	expect(state().races[0]?.race?.version).toBe(2);
	expect(warn).not.toHaveBeenCalled();
	await change({status: {value: "in_progress"}});
	expect(nodecg.sendMessage).toHaveBeenLastCalledWith(
		eventMessageName("raceStarted"),
		{
			raceId: "game/race",
			url,
			raceVersion: 3,
			startedAt: "2026-01-01T00:00:15Z",
		},
	);
	sent.reject(new Error("late rejection"));
	await vi.advanceTimersByTimeAsync(0);
	expect(warn).toHaveBeenCalledWith(expect.stringContaining("late rejection"));
	expect(await api.request("getRace", {url})).toMatchObject({
		ok: true,
		data: {connection: "connected", error: null, race: {version: 3}},
	});
});
