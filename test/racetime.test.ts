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
import {deferred, dto, FakeSocket, flush, payload, url} from "./fixtures";

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
	it("refreshes after open, coalesces race.data, and ignores chat/malformed messages", async () => {
		const {watcher, sockets, client} = setup();
		await watcher.start();
		await flush();
		sockets[0]!.open();
		await flush();
		expect(client.fetchRaceDetail).toHaveBeenCalledTimes(2);
		sockets[0]!.message("{");
		sockets[0]!.message('{"type":"chat.message"}');
		expect(client.fetchRaceDetail).toHaveBeenCalledTimes(2);
		const pending = deferred<ReturnType<typeof dto>>();
		client.fetchRaceDetail.mockReturnValueOnce(pending.promise);
		sockets[0]!.message('{"type":"race.data"}');
		sockets[0]!.message('{"type":"race.data"}');
		sockets[0]!.message('{"type":"race.data"}');
		client.fetchRaceDetail.mockResolvedValueOnce(dto(3));
		pending.resolve(dto(2));
		await flush();
		expect(client.fetchRaceDetail).toHaveBeenCalledTimes(4);
		expect(watcher.snapshot().race?.version).toBe(3);
		watcher.stop();
		expect(vi.getTimerCount()).toBe(0);
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
	it("retains the last good snapshot and retries a failed refresh", async () => {
		const {watcher, sockets, client} = setup();
		await watcher.start();
		await flush();
		sockets[0]!.open();
		await flush();
		client.fetchRaceDetail.mockRejectedValueOnce(new Error("HTTP 503"));
		sockets[0]!.message('{"type":"race.data"}');
		await flush();
		expect(watcher.snapshot()).toMatchObject({
			connection: "reconnecting",
			race: {version: 1},
		});
		client.fetchRaceDetail.mockResolvedValueOnce(dto(2));
		await vi.advanceTimersByTimeAsync(10);
		expect(watcher.snapshot().race?.version).toBe(2);
		watcher.stop();
	});
	it("discards responses from a disconnected socket epoch and after stop", async () => {
		const {watcher, sockets, client, onUpdate} = setup();
		await watcher.start();
		await flush();
		sockets[0]!.open();
		await flush();
		const pending = deferred<ReturnType<typeof dto>>();
		client.fetchRaceDetail.mockReturnValueOnce(pending.promise);
		sockets[0]!.message('{"type":"race.data"}');
		sockets[0]!.fail();
		client.fetchRaceDetail.mockResolvedValueOnce(dto(3));
		await vi.advanceTimersByTimeAsync(10);
		pending.resolve(dto(99));
		await flush();
		expect(watcher.snapshot().race?.version).toBe(3);
		const last = deferred<ReturnType<typeof dto>>();
		client.fetchRaceDetail.mockReturnValueOnce(last.promise);
		sockets[1]!.open();
		await flush();
		watcher.stop();
		const calls = onUpdate.mock.calls.length;
		last.resolve(dto(100));
		await flush();
		expect(onUpdate).toHaveBeenCalledTimes(calls);
		expect(vi.getTimerCount()).toBe(0);
	});
});
