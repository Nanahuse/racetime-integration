import {afterEach, describe, expect, it, vi} from "vitest";
import {
	HttpRaceTimeClient,
	parseRaceDetail,
} from "../src/integrations/racetime/client";
import {mapRace} from "../src/integrations/racetime/mapper";
import {
	canonicalizeRaceUrl,
	resolveWebSocketUrl,
} from "../src/integrations/racetime/url";
import {RaceWatcher} from "../src/integrations/racetime/watcher";
import {dto, FakeSocket, flush, payload, url} from "./fixtures";

afterEach(() => vi.useRealTimers());
it("normalizes result status and preserves canonical race identity, rank and time", () => {
	const raw = dto();
	raw.entrants = ["done", "dnf", "dq", "in_progress", "future_status"].map(
		(status, i) => ({...raw.entrants[0]!, userId: `user${i}`, status}),
	);
	const race = mapRace(raw, url);
	expect(race.raceId).toBe("game/race");
	expect(race.results.map((r) => r.status)).toEqual([
		"finished",
		"dnf",
		"dq",
		"other",
		"other",
	]);
	expect(race.results[0]).toMatchObject({
		userId: "user0",
		place: 1,
		time: "PT1H2M3.45S",
	});
	// Public data never exposes Temporal instances.
	expect(typeof race.entrants[0]?.finishTime).toBe("string");
	expect(typeof race.results[0]?.time).toBe("string");
});
describe("HTTP boundary", () => {
	it.each(["open", "in_progress", "finished", "cancelled"])(
		"preserves the time and detail fields of a %s race",
		async (status) => {
			const raw = {
				...payload(1, "race", status),
				opened_at: "2026-01-01T09:00:00.123456789+09:00",
				info: "<b>Plain text</b>",
			};
			const client = new HttpRaceTimeClient({
				fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw)),
			});
			const race = mapRace(
				await client.fetchRaceDetail(canonicalizeRaceUrl(url)),
				url,
			);
			expect(race).toMatchObject({
				openedAt: "2026-01-01T00:00:00.123456789Z",
				startedAt: raw.started_at,
				endedAt: raw.ended_at,
				cancelledAt: raw.cancelled_at,
				startDelay: "PT15S",
				timeLimit: "P1D",
				info: raw.info,
				ranked: true,
				recordable: status === "finished",
				recorded: false,
				timeLimitAutoComplete: false,
				entrantsCount: 5,
				entrantsCountFinished: raw.entrants_count_finished,
				entrantsCountInactive: 2,
			});
			expect(race.entrantsCount).not.toBe(race.entrants.length);
			expect(race.entrants[0]?.finishTime).toBe(raw.entrants[0]?.finish_time);
			expect(race.entrants[0]?.finishedAt).toBe(raw.entrants[0]?.finished_at);
			expect(race.results[0]?.time).toBe(race.entrants[0]?.finishTime);
			expect(race.results[0]?.finishedAt).toBe(race.entrants[0]?.finishedAt);
			expect(race).toEqual(JSON.parse(JSON.stringify(race)));
		},
	);

	it.each([
		...[
			"opened_at",
			"started_at",
			"ended_at",
			"cancelled_at",
			"start_delay",
			"time_limit",
			"info",
			"ranked",
			"recordable",
			"recorded",
			"time_limit_auto_complete",
			"entrants_count",
			"entrants_count_finished",
			"entrants_count_inactive",
		].map((key): [string, undefined] => [key, undefined]),
		["opened_at", null],
		["opened_at", 123],
		["opened_at", "bad"],
		["started_at", "2026-01-01T00:00:00"],
		["ended_at", "2026-02-30T00:00:00Z"],
		["cancelled_at", false],
		["start_delay", null],
		["start_delay", "-PT1S"],
		["start_delay", "PT1.1234567890S"],
		["time_limit", "P1M"],
		["time_limit", "P1W"],
		["time_limit", 24],
		["info", null],
		["ranked", 1],
		["recordable", "true"],
		["recorded", null],
		["time_limit_auto_complete", 0],
		["entrants_count", -1],
		["entrants_count_finished", 1.5],
		["entrants_count_inactive", Number.MAX_SAFE_INTEGER + 1],
		["entrants_count", "5"],
	])(
		"rejects invalid race field %s=%s as invalid_payload",
		async (key, value) => {
			const client = new HttpRaceTimeClient({
				fetchImpl: vi
					.fn<typeof fetch>()
					.mockResolvedValue(
						Response.json({...payload(), [key as string]: value}),
					),
			});
			await expect(
				client.fetchRaceDetail(canonicalizeRaceUrl(url)),
			).rejects.toMatchObject({code: "invalid_payload"});
		},
	);

	it.each([undefined, 1, "bad", "2026-01-01T00:00:00"])(
		"rejects invalid entrant finished_at %s",
		async (value) => {
			const client = new HttpRaceTimeClient({
				fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
					Response.json({
						...payload(),
						entrants: [{...payload().entrants[0], finished_at: value}],
					}),
				),
			});
			await expect(
				client.fetchRaceDetail(canonicalizeRaceUrl(url)),
			).rejects.toMatchObject({code: "invalid_payload"});
		},
	);

	it("does not infer start or end timestamps for a race cancelled before starting", () => {
		const race = mapRace(
			parseRaceDetail({
				...payload(1, "race", "cancelled"),
				started_at: null,
				ended_at: null,
			}),
			url,
		);
		expect(race.startedAt).toBeNull();
		expect(race.endedAt).toBeNull();
		expect(race.cancelledAt).toBe("2026-01-01T02:00:00Z");
	});
	it("fetches the canonical data URL and maps the provider payload", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(payload()));
		const client = new HttpRaceTimeClient({fetchImpl});
		const result = await client.fetchRaceDetail(
			canonicalizeRaceUrl(`${url}/?x=1#chat`),
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			`${url}/data`,
			expect.objectContaining({redirect: "error"}),
		);
		expect(result.entrants[0]).toMatchObject({
			userId: "user1",
			place: 1,
		});
		expect(result.entrants[0]?.finishTime?.toString()).toBe("PT1H2M3.45S");
	});
	it.each([
		"http://racetime.gg/game/race",
		"https://evil.test/game/race",
		"https://racetime.gg:8443/game/race",
		"https://user@racetime.gg/game/race",
		"https://racetime.gg/game/race/data",
		"https://racetime.gg/game//race",
	])("rejects unsafe URL %s", (input) => {
		expect(() => canonicalizeRaceUrl(input)).toThrow();
	});
	it("allows configured local origins and preserves their normalized origin", () => {
		const origins = ["https://racetime.gg", "http://localhost:8000"];
		const local = canonicalizeRaceUrl(
			"http://localhost:8000/smw/dazzling-geralt-2972/?x=1",
			origins,
		);
		expect(local).toEqual({
			canonicalUrl: "http://localhost:8000/smw/dazzling-geralt-2972",
			categorySlug: "smw",
			raceSlug: "dazzling-geralt-2972",
			dataUrl: "http://localhost:8000/smw/dazzling-geralt-2972/data",
		});
		expect(() =>
			canonicalizeRaceUrl("http://localhost:8000/game/race"),
		).toThrow();
		expect(() =>
			canonicalizeRaceUrl("http://localhost:8001/game/race", origins),
		).toThrow();
		expect(
			canonicalizeRaceUrl("http://127.0.0.1:8000/game/race", [
				"http://127.0.0.1:8000",
			]).canonicalUrl,
		).toBe("http://127.0.0.1:8000/game/race");
		expect(
			canonicalizeRaceUrl("https://racetime.gg/game/race").canonicalUrl,
		).toBe(url);
	});
	it("restricts WebSocket destinations", () => {
		expect(resolveWebSocketUrl("/ws/race/test")).toBe(
			"wss://racetime.gg/ws/race/test",
		);
		for (const input of [
			"wss://evil.test/x",
			"ws://racetime.gg/x",
			"wss://racetime.gg:8443/x",
			"wss://u@racetime.gg/x",
		])
			expect(() => resolveWebSocketUrl(input)).toThrow();
	});
	it("resolves local WebSocket endpoints on the requested race origin", () => {
		const local = "http://localhost:8000/smw/race-001";
		expect(resolveWebSocketUrl("/ws/race/test", local)).toBe(
			"ws://localhost:8000/ws/race/test",
		);
		expect(resolveWebSocketUrl("ws://localhost:8000/ws/race/test", local)).toBe(
			"ws://localhost:8000/ws/race/test",
		);
		for (const input of [
			"ws://localhost:8001/ws/race/test",
			"ws://evil.test/ws/race/test",
			"wss://localhost:8000/ws/race/test",
			"ws://user@localhost:8000/ws/race/test",
		])
			expect(() => resolveWebSocketUrl(input, local)).toThrow();
	});
	it.each([
		[404, "not_found"],
		[429, "http_error"],
		[500, "http_error"],
	])("reports HTTP %s", async (status, code) => {
		const client = new HttpRaceTimeClient({
			fetchImpl: vi
				.fn<typeof fetch>()
				.mockResolvedValue(new Response("", {status: Number(status)})),
		});
		await expect(
			client.fetchRaceDetail(canonicalizeRaceUrl(url)),
		).rejects.toMatchObject({code});
	});
	it("rejects invalid JSON, invalid fields and mismatched race identities", async () => {
		for (const response of [
			new Response("<html>"),
			Response.json({...payload(), entrants: [null]}),
			Response.json(payload(1, "other")),
		]) {
			const client = new HttpRaceTimeClient({
				fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
			});
			await expect(
				client.fetchRaceDetail(canonicalizeRaceUrl(url)),
			).rejects.toMatchObject({code: "invalid_payload"});
		}
		expect(() => parseRaceDetail({...payload(), version: Infinity})).toThrow();
	});
	it("parses finish_time into a duration and reports invalid values as invalid_payload", async () => {
		const withFinishTime = (finishTime: unknown) => ({
			...payload(),
			entrants: [{...payload().entrants[0], finish_time: finishTime}],
		});
		const client = new HttpRaceTimeClient({
			fetchImpl: vi
				.fn<typeof fetch>()
				.mockResolvedValue(Response.json(withFinishTime(null))),
		});
		const result = await client.fetchRaceDetail(canonicalizeRaceUrl(url));
		expect(result.entrants[0]?.finishTime).toBeNull();

		for (const finishTime of ["P1Y", "-PT1H", "not-a-duration", 123]) {
			const invalid = new HttpRaceTimeClient({
				fetchImpl: vi
					.fn<typeof fetch>()
					.mockResolvedValue(Response.json(withFinishTime(finishTime))),
			});
			await expect(
				invalid.fetchRaceDetail(canonicalizeRaceUrl(url)),
			).rejects.toMatchObject({code: "invalid_payload"});
		}
	});
	it("distinguishes caller cancellation from request timeout", async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
			async (_, init) =>
				new Promise((_, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("aborted", "AbortError")),
						{once: true},
					);
				}),
		);
		const client = new HttpRaceTimeClient({fetchImpl, timeoutMs: 50});
		const timeout = expect(
			client.fetchRaceDetail(canonicalizeRaceUrl(url)),
		).rejects.toMatchObject({code: "timeout"});
		await vi.advanceTimersByTimeAsync(50);
		await timeout;
		const controller = new AbortController();
		const aborted = expect(
			client.fetchRaceDetail(canonicalizeRaceUrl(url), controller.signal),
		).rejects.toMatchObject({code: "aborted"});
		controller.abort();
		await aborted;
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("WebSocket monitoring", () => {
	const setup = () => {
		vi.useFakeTimers();
		const client = {fetchRaceDetail: vi.fn(async () => dto())};
		const sockets: FakeSocket[] = [];
		const onUpdate = vi.fn();
		const watcher = new RaceWatcher({
			client,
			canonical: canonicalizeRaceUrl(url),
			socketFactory: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket;
			},
			onUpdate,
			backoffMs: [10, 20],
			connectTimeoutMs: 100,
		});
		return {client, sockets, onUpdate, watcher};
	};
	it("adopts validated race.data directly without HTTP refreshes", async () => {
		const {watcher, sockets, client} = setup();
		await watcher.start();
		await flush();
		sockets[0]!.open();
		await flush();
		expect(client.fetchRaceDetail).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(5000);
		expect(client.fetchRaceDetail).toHaveBeenCalledTimes(1);
		sockets[0]!.message("{");
		sockets[0]!.message('{"type":"chat.message"}');
		const pending = payload(2, "race", "pending");
		sockets[0]!.raceData(pending);
		sockets[0]!.raceData(pending);
		sockets[0]!.raceData(payload(3, "race", "in_progress"));
		await flush();
		expect(client.fetchRaceDetail).toHaveBeenCalledTimes(1);
		expect(watcher.snapshot().race?.version).toBe(3);
		expect(watcher.snapshot().race?.status).toBe("in_progress");
		watcher.stop();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("rejects invalid, mismatched, and stale race.data without closing the socket", async () => {
		const onInvalidMessage = vi.fn();
		const client = {fetchRaceDetail: vi.fn(async () => dto())};
		const sockets: FakeSocket[] = [];
		const watcher = new RaceWatcher({
			client,
			canonical: canonicalizeRaceUrl(url),
			socketFactory: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				return socket;
			},
			onUpdate: vi.fn(),
			onInvalidMessage,
		});
		await watcher.start();
		sockets[0]!.open();
		sockets[0]!.raceData(payload(3, "race", "pending"));
		sockets[0]!.raceData(payload(2, "race", "open"));
		sockets[0]!.message(
			JSON.stringify({type: "race.data", version: 4, race: payload(5)}),
		);
		sockets[0]!.raceData(payload(4, "another", "pending"));
		sockets[0]!.message(
			JSON.stringify({type: "race.data", version: 4, race: {}}),
		);
		expect(watcher.snapshot().race).toMatchObject({
			version: 3,
			status: "pending",
		});
		expect(onInvalidMessage).toHaveBeenCalledTimes(3);
		expect(sockets[0]!.close).not.toHaveBeenCalled();
		watcher.stop();
	});
	it("ignores messages from a socket after its connection epoch ends", async () => {
		const {watcher, sockets, client} = setup();
		await watcher.start();
		const oldSocket = sockets[0]!;
		oldSocket.open();
		oldSocket.raceData(payload(2, "race", "pending"));
		oldSocket.fail();
		client.fetchRaceDetail.mockResolvedValueOnce(dto(2, "race", "pending"));
		await vi.advanceTimersByTimeAsync(10);
		expect(sockets).toHaveLength(2);
		oldSocket.raceData(payload(99, "race", "finished"));
		await flush();
		expect(watcher.snapshot().race).toMatchObject({
			version: 2,
			status: "pending",
		});
		sockets[1]!.open();
		sockets[1]!.raceData(payload(3, "race", "in_progress"));
		expect(watcher.snapshot().race).toMatchObject({
			version: 3,
			status: "in_progress",
		});
		watcher.stop();
	});
	it("rejects initial HTTP failure without scheduling reconnect", async () => {
		const {watcher, sockets, client} = setup();
		client.fetchRaceDetail.mockRejectedValueOnce(new Error("offline"));
		await expect(watcher.start()).rejects.toThrow("offline");
		expect(sockets).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("backs off on socket errors and handshake timeout after initial success", async () => {
		const {watcher, sockets} = setup();
		await watcher.start();
		sockets[0]!.fail();
		await vi.advanceTimersByTimeAsync(9);
		expect(sockets).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(sockets).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(100);
		expect(sockets[1]!.close).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(20);
		expect(sockets).toHaveLength(3);
		watcher.stop();
	});
	it("resets reconnect backoff after a WebSocket connection opens", async () => {
		const {watcher, sockets} = setup();
		await watcher.start();
		sockets[0]!.fail();
		await vi.advanceTimersByTimeAsync(10);
		sockets[1]!.open();
		sockets[1]!.fail();
		await vi.advanceTimersByTimeAsync(9);
		expect(sockets).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(sockets).toHaveLength(3);
		watcher.stop();
	});
	it("retains the last good snapshot when reconnect HTTP fails", async () => {
		const {watcher, sockets, client} = setup();
		await watcher.start();
		client.fetchRaceDetail.mockRejectedValueOnce(new Error("HTTP 503"));
		sockets[0]!.fail();
		await vi.advanceTimersByTimeAsync(10);
		expect(watcher.snapshot()).toMatchObject({
			connection: "reconnecting",
			race: {version: 1},
		});
		client.fetchRaceDetail.mockResolvedValueOnce(dto(2));
		await vi.advanceTimersByTimeAsync(20);
		expect(watcher.snapshot().race?.version).toBe(2);
		watcher.stop();
	});
	it("discards responses from a disconnected socket epoch and after stop", async () => {
		const {watcher, sockets, client, onUpdate} = setup();
		await watcher.start();
		await flush();
		sockets[0]!.open();
		await flush();
		sockets[0]!.fail();
		client.fetchRaceDetail.mockResolvedValueOnce(dto(3));
		await vi.advanceTimersByTimeAsync(10);
		expect(watcher.snapshot().race?.version).toBe(3);
		sockets[1]!.open();
		await flush();
		watcher.stop();
		const calls = onUpdate.mock.calls.length;
		sockets[1]!.raceData(payload(100));
		expect(onUpdate).toHaveBeenCalledTimes(calls);
		expect(vi.getTimerCount()).toBe(0);
	});
});
