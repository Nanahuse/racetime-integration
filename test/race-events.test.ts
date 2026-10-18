import {afterEach, expect, it, vi} from "vitest";
import {ParticipantResolver} from "../src/integrations/players";
import {HttpRaceTimeClient} from "../src/integrations/racetime/client";
import type {RaceChangeEvent} from "../src/race-events";
import {RaceService} from "../src/service";
import {FakeSocket, flush, payload, url} from "./fixtures";

const services: RaceService[] = [];
afterEach(() => {
	for (const service of services.splice(0)) service.dispose();
	vi.useRealTimers();
});

function finished(userId = "user1", place = 1) {
	return {
		...payload().entrants[0]!,
		user: {id: userId, name: userId, twitch_name: userId},
		place,
		finish_time: "PT1.123456789S",
		finished_at: "2026-01-01T10:00:00.123456789+09:00",
	};
}

function unfinished(userId = "user1", status = "in_progress") {
	return {
		...finished(userId),
		status: {value: status},
		finish_time: null,
		finished_at: null,
		place: null,
	};
}

async function setup(initial = payload(1, "race", "open")) {
	vi.useFakeTimers();
	let raw = initial;
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json(raw));
	const sockets: FakeSocket[] = [];
	const publish = vi.fn();
	const notifications: Array<{
		event: RaceChangeEvent;
		state: ReturnType<RaceService["get"]>;
		published: ReturnType<RaceService["snapshot"]>;
	}> = [];
	const notify = vi.fn<(event: RaceChangeEvent) => void>();
	const onNotifyError =
		vi.fn<(error: unknown, event: RaceChangeEvent) => void>();
	const service = new RaceService(
		new HttpRaceTimeClient({fetchImpl}),
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		new ParticipantResolver(() => undefined),
		publish,
		notify,
		onNotifyError,
	);
	notify.mockImplementation((event) => {
		notifications.push({
			event,
			state: service.get(url),
			published: publish.mock.lastCall![0],
		});
	});
	services.push(service);
	const watch = await service.watch(url);
	sockets[0]!.open();
	await vi.advanceTimersByTimeAsync(0);
	const change = async (patch: Partial<typeof raw>) => {
		raw = {...raw, version: raw.version + 1, ...patch};
		sockets.at(-1)!.raceData(raw);
		await vi.advanceTimersByTimeAsync(0);
		await flush();
	};
	return {
		service,
		watch,
		fetchImpl,
		sockets,
		publish,
		notifications,
		notify,
		onNotifyError,
		change,
		events: () => notifications.map(({event}) => event),
	};
}

it.each([false, true])(
	"isolates a synchronous notification failure and continues monitoring (error reporter throws: %s)",
	async (reporterThrows) => {
		const {
			service,
			watch,
			change,
			events,
			notify,
			onNotifyError,
			publish,
			sockets,
			fetchImpl,
		} = await setup();
		const error = new Error("notification callback failed");
		notify.mockImplementationOnce(() => {
			throw error;
		});
		if (reporterThrows) {
			onNotifyError.mockImplementation(() => {
				throw new Error("error reporter failed");
			});
		}
		await change({
			status: {value: "in_progress"},
			started_at: "2026-01-01T00:00:15Z",
			entrants: [finished()],
		});
		const failedEvent: RaceChangeEvent = {
			type: "raceStarted",
			payload: {
				raceId: "game/race",
				url,
				raceVersion: 2,
				startedAt: "2026-01-01T00:00:15Z",
			},
		};
		expect(notify.mock.calls.map(([event]) => event.type)).toEqual([
			"raceStarted",
			"entrantFinished",
		]);
		expect(onNotifyError).toHaveBeenCalledExactlyOnceWith(error, failedEvent);
		expect(events().map(({type}) => type)).toEqual(["entrantFinished"]);
		expect(service.getWatch(watch.watchId)).toMatchObject({
			connection: "connected",
			error: null,
			race: {
				version: 2,
				status: "in_progress",
				results: [{status: "finished", time: "PT1.123456789S"}],
			},
		});
		expect(publish.mock.lastCall?.[0]).toEqual(service.snapshot());
		const fetched = fetchImpl.mock.calls.length;
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetchImpl).toHaveBeenCalledTimes(fetched);
		expect(sockets).toHaveLength(1);
		expect(sockets[0]!.close).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledTimes(2);
		await change({entrants: [unfinished()]});
		expect(events().at(-1)).toEqual({
			type: "entrantFinishUndone",
			payload: {raceId: "game/race", url, raceVersion: 3, userId: "user1"},
		});
		expect(service.get(url)).toMatchObject({
			connection: "connected",
			error: null,
			race: {version: 3},
		});
		expect(publish.mock.lastCall?.[0]).toEqual(service.snapshot());
		expect(onNotifyError).toHaveBeenCalledTimes(1);
		expect(sockets).toHaveLength(1);
	},
);

it.each(["open", "pending", "in_progress", "finished", "cancelled"])(
	"uses the first %s snapshot as a baseline without events",
	async (status) => {
		const initial = payload(10, "race", status);
		const {events, change} = await setup(initial);
		expect(events()).toEqual([]);
		await change(initial);
		expect(events()).toEqual([]);
	},
);

it.each(["open", "invitational"])(
	"notifies %s schedule creation and changes in pending, but not clearing the schedule",
	async (initialStatus) => {
		const {change, events, notifications, service} = await setup({
			...payload(1, "race", initialStatus),
			started_at: null,
		});
		await change({
			status: {value: "pending"},
			started_at: "2026-01-01T09:00:15.123456789+09:00",
		});
		await change({started_at: "2026-01-01T00:00:30Z"});
		await change({started_at: null});
		expect(events()).toEqual([
			{
				type: "raceStartScheduled",
				payload: {
					raceId: "game/race",
					url,
					raceVersion: 2,
					startedAt: "2026-01-01T00:00:15.123456789Z",
					previousStartedAt: null,
				},
			},
			{
				type: "raceStartScheduled",
				payload: {
					raceId: "game/race",
					url,
					raceVersion: 3,
					startedAt: "2026-01-01T00:00:30Z",
					previousStartedAt: "2026-01-01T00:00:15.123456789Z",
				},
			},
		]);
		for (const {event, state, published} of notifications) {
			expect(state?.race?.version).toBe(event.payload.raceVersion);
			expect(published.races[0]?.race).toEqual(state?.race);
		}
		expect(service.get(url)?.revision).toBeGreaterThan(
			service.get(url)!.race!.version,
		);
	},
);

it.each(["open", "invitational", "pending"])(
	"notifies %s to in_progress once per shared session",
	async (status) => {
		const {service, change, events} = await setup({
			...payload(1, "race", "open"),
			status: {value: status},
			started_at: "2026-01-01T00:00:15Z",
		});
		const second = await service.watch(url);
		await change({status: {value: "in_progress"}});
		await change({status: {value: "finished"}});
		await change({status: {value: "in_progress"}});
		await change({status: {value: "pending"}});
		service.unwatch(second.watchId);
		await change({status: {value: "in_progress"}});
		expect(events()).toEqual([
			{
				type: "raceStarted",
				payload: {
					raceId: "game/race",
					url,
					raceVersion: 2,
					startedAt: "2026-01-01T00:00:15Z",
				},
			},
		]);
	},
);

it.each(["in_progress", "finished"])(
	"does not announce a start after initially observing %s, even through pending",
	async (status) => {
		const {change, events} = await setup(payload(1, "race", status));
		await change({status: {value: "pending"}});
		await change({status: {value: "in_progress"}});
		expect(events()).toEqual([]);
	},
);

it("requires a start timestamp and remembers a start observed without one", async () => {
	const {change, events} = await setup();
	await change({status: {value: "in_progress"}, started_at: null});
	await change({status: {value: "pending"}});
	await change({
		status: {value: "in_progress"},
		started_at: "2026-01-01T00:00:15Z",
	});
	expect(events()).toEqual([]);
});

it.each(["not_ready", "in_progress"])(
	"notifies %s to done with the adopted formal result, and can notify a new finish after undo",
	async (status) => {
		const {change, events, service} = await setup({
			...payload(1, "race", "in_progress"),
			entrants: [unfinished("user1", status)],
		});
		await change({entrants: [finished()]});
		const firstResult = service.get(url)!.race!.results[0]!;
		expect(events()).toEqual([
			{
				type: "entrantFinished",
				payload: {
					raceId: "game/race",
					url,
					raceVersion: 2,
					result: firstResult,
				},
			},
		]);
		expect(firstResult).toEqual({
			userId: "user1",
			name: "user1",
			place: 1,
			status: "finished",
			time: "PT1.123456789S",
			finishedAt: "2026-01-01T01:00:00.123456789Z",
		});
		await change({
			entrants: [
				{
					...finished(),
					place: 3,
					finish_time: "PT2S",
					finished_at: "2026-01-01T01:00:02Z",
				},
			],
		});
		expect(events()).toHaveLength(1);
		await change({entrants: [unfinished()]});
		expect(events().at(-1)).toEqual({
			type: "entrantFinishUndone",
			payload: {raceId: "game/race", url, raceVersion: 4, userId: "user1"},
		});
		await change({entrants: [finished("user1", 2)]});
		expect(events().at(-1)).toEqual({
			type: "entrantFinished",
			payload: {
				raceId: "game/race",
				url,
				raceVersion: 5,
				result: service.get(url)!.race!.results[0],
			},
		});
		expect(events()).toHaveLength(3);
		expect(events()).toEqual(JSON.parse(JSON.stringify(events())));
	},
);

it("matches entrants by userId, emits one event per new finish, and ignores newly appearing finishers", async () => {
	const {change, events} = await setup({
		...payload(1, "race", "in_progress"),
		entrants: [unfinished("user1"), unfinished("user2")],
	});
	await change({
		entrants: [finished("new", 1), finished("user2", 2), finished("user1", 3)],
	});
	expect(events()).toHaveLength(2);
	expect(
		events().map((event) =>
			event.type === "entrantFinished" ? event.payload.result.userId : null,
		),
	).toEqual(["user2", "user1"]);
	await change({entrants: []});
	expect(events()).toHaveLength(2);
});

it.each([
	{...finished(), finish_time: null},
	{...finished(), finished_at: null},
])(
	"does not notify a finish with incomplete time data (%j)",
	async (entrant) => {
		const {change, events} = await setup({
			...payload(1, "race", "in_progress"),
			entrants: [unfinished()],
		});
		await change({entrants: [entrant]});
		expect(events()).toEqual([]);
	},
);

it("only reports finish undo when a recorded elapsed time is cleared, and never for removal", async () => {
	const {change, events} = await setup({
		...payload(1, "race", "in_progress"),
		entrants: [{...finished(), finish_time: null}],
	});
	await change({entrants: [unfinished()]});
	await change({entrants: [finished()]});
	await change({entrants: [{...finished(), status: {value: "dnf"}}]});
	expect(events().map(({type}) => type)).toEqual(["entrantFinished"]);
	await change({entrants: [finished()]});
	await change({entrants: []});
	expect(events().map(({type}) => type)).toEqual([
		"entrantFinished",
		"entrantFinished",
	]);
});

it("notifies cancellation only on transition with a timestamp", async () => {
	const {change, events} = await setup();
	await change({status: {value: "cancelled"}, cancelled_at: null});
	await change({cancelled_at: "2026-01-01T00:10:00Z"});
	expect(events()).toEqual([]);
	await change({status: {value: "open"}});
	await change({
		status: {value: "cancelled"},
		cancelled_at: "2026-01-01T09:20:00.123456789+09:00",
	});
	await change({info: "updated"});
	expect(events()).toEqual([
		{
			type: "raceCancelled",
			payload: {
				raceId: "game/race",
				url,
				raceVersion: 5,
				cancelledAt: "2026-01-01T00:20:00.123456789Z",
			},
		},
	]);
});

it("ignores connection-only changes, Player re-resolution, version-only changes and fetchRace", async () => {
	const {service, sockets, change, events, fetchImpl} = await setup();
	service.directoryChanged(1);
	await flush();
	sockets[0]!.fail();
	expect(events()).toEqual([]);
	await vi.advanceTimersByTimeAsync(1000);
	sockets[1]!.open();
	await vi.advanceTimersByTimeAsync(0);
	await change({info: "details changed"});
	await change({});
	fetchImpl.mockResolvedValueOnce(
		Response.json(payload(99, "race", "finished")),
	);
	const fetched = await service.fetch(url);
	expect(fetched.race.version).toBe(99);
	expect(service.get(url)?.race?.version).toBe(3);
	expect(events()).toEqual([]);
});

it("compares against the last good snapshot on reconnect and rejects older versions", async () => {
	const {sockets, fetchImpl, events, service, change} = await setup({
		...payload(10, "race", "in_progress"),
		entrants: [unfinished()],
	});
	sockets[0]!.fail();
	expect(events()).toEqual([]);
	fetchImpl.mockResolvedValueOnce(
		Response.json({...payload(9), entrants: [finished()]}),
	);
	await vi.advanceTimersByTimeAsync(1000);
	expect(service.get(url)?.race?.version).toBe(10);
	expect(events()).toEqual([]);
	sockets[1]!.open();
	await vi.advanceTimersByTimeAsync(0);
	await change({version: 11, entrants: [finished()]});
	expect(events().map(({type}) => type)).toEqual(["entrantFinished"]);
});

it("detects a finish first observed in the HTTP reconnect snapshot", async () => {
	const {sockets, fetchImpl, events, service} = await setup({
		...payload(1, "race", "in_progress"),
		entrants: [unfinished()],
	});
	sockets[0]!.fail();
	fetchImpl.mockResolvedValueOnce(
		Response.json({...payload(2), entrants: [finished()]}),
	);
	await vi.advanceTimersByTimeAsync(1000);
	expect(service.get(url)?.race?.version).toBe(2);
	expect(events().map(({type}) => type)).toEqual(["entrantFinished"]);
});

it("ignores messages from a released socket and reinitializes a new session", async () => {
	const {service, watch, fetchImpl, sockets, change, events} = await setup({
		...payload(1, "race", "in_progress"),
		entrants: [unfinished()],
	});
	const releasedSocket = sockets[0]!;
	service.unwatch(watch.watchId);
	fetchImpl.mockResolvedValueOnce(
		Response.json({...payload(10, "race", "pending"), entrants: [finished()]}),
	);
	await service.watch(url);
	expect(service.get(url)?.race?.version).toBe(10);
	expect(events()).toEqual([]);
	releasedSocket.raceData(payload(99, "race", "finished"));
	expect(service.get(url)?.race?.version).toBe(10);
	fetchImpl.mockResolvedValueOnce(
		Response.json({...payload(10, "race", "pending"), entrants: [finished()]}),
	);
	sockets[1]!.open();
	await vi.advanceTimersByTimeAsync(0);
	await change({
		version: 11,
		status: {value: "in_progress"},
		started_at: "2026-01-01T00:00:15Z",
		entrants: [finished()],
	});
	expect(events().map(({type}) => type)).toEqual(["raceStarted"]);
});
