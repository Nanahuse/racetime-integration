import type {Player, PlayerManagerAPI} from "@nanahuse/player-manager-protocol";
import {afterEach, expect, it, vi} from "vitest";
import {createAPI} from "../src/api";
import {ParticipantResolver} from "../src/integrations/players";
import {MappingService} from "../src/mappings";
import {RaceService} from "../src/service";
import {deferred, dto, FakeSocket, flush, mapping, url} from "./fixtures";

afterEach(() => vi.useRealTimers());
const player = (name = "Runner", revision = 1): Player => ({
	playerId: "p1",
	revision,
	manualDisplayName: name,
	racetime: {userId: "user1", name: "RaceTime name"},
	speedrunCom: null,
	twitch: null,
	youtube: null,
});
function playerAPI() {
	const directory = {revision: 1, player: player() as Player | null};
	const request = vi.fn(async (op: string) => ({
		ok: true,
		data:
			op === "list"
				? {
						schemaVersion: 1,
						revision: directory.revision,
						players: directory.player ? [directory.player] : [],
					}
				: structuredClone(directory.player),
	}));
	const api = {
		apiVersion: 2,
		ready: Promise.resolve(),
		request,
	} as unknown as PlayerManagerAPI;
	return {api, request, directory};
}

it("uses v2 find with the RaceTime ID and publishes a display-ready Player snapshot", async () => {
	const {api, request} = playerAPI();
	const result = await new ParticipantResolver(() => api).resolve(
		dto().entrants,
	);
	expect(result.directoryRevision).toBe(1);
	expect(result.participants[0]).toMatchObject({
		status: "matched",
		playerId: "p1",
		player: {displayName: "Runner", revision: 1},
	});
	expect(request.mock.calls).toContainEqual([
		"find",
		{provider: "racetime", value: "user1"},
	]);
	expect(
		request.mock.calls.every(([op]) => op === "find" || op === "list"),
	).toBe(true);
});
it("distinguishes unmatched accounts, v1 API incompatibility, directory failures and timeout", async () => {
	const {api, directory} = playerAPI();
	directory.player = null;
	expect(
		(await new ParticipantResolver(() => api).resolve(dto().entrants))
			.participants[0]?.status,
	).toBe("unresolved");
	expect(
		(
			await new ParticipantResolver(
				() => ({...api, apiVersion: 1}) as never,
			).resolve(dto().entrants)
		).participants[0]?.status,
	).toBe("unavailable");
	const bad = {
		...api,
		request: vi
			.fn()
			.mockResolvedValue({ok: false, error: {message: "offline"}}),
	} as PlayerManagerAPI;
	expect(
		(await new ParticipantResolver(() => bad).resolve(dto().entrants))
			.participants[0],
	).toMatchObject({status: "unavailable", message: "offline"});
	vi.useFakeTimers();
	const wait = deferred<void>();
	const pendingAPI = {...api, ready: wait.promise};
	const pending = new ParticipantResolver(() => pendingAPI, 10).resolve(
		dto().entrants,
	);
	await vi.advanceTimersByTimeAsync(10);
	expect((await pending).participants[0]).toMatchObject({
		status: "unavailable",
		message: "Player Manager timed out",
	});
});
it("retries the entire find batch if the directory changes during resolution", async () => {
	const {api, request, directory} = playerAPI();
	const original = request.getMockImplementation()!;
	let change = true;
	request.mockImplementation(async (op) => {
		const result = await original(op);
		if (op === "find" && change) {
			change = false;
			directory.revision = 2;
			directory.player = player("Renamed", 2);
		}
		return result;
	});
	const result = await new ParticipantResolver(() => api).resolve(
		dto().entrants,
	);
	expect(result.directoryRevision).toBe(2);
	expect(result.participants[0]?.player?.displayName).toBe("Renamed");
});
function setup() {
	vi.useFakeTimers();
	const client = {fetchRaceDetail: vi.fn(async () => dto())};
	const sockets: FakeSocket[] = [];
	const players = playerAPI();
	const publish = vi.fn();
	const service = new RaceService(
		client,
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		new ParticipantResolver(() => players.api),
		publish,
	);
	return {service, client, sockets, publish, ...players};
}
it("waits for initial HTTP success and shares the pending load between consumers", async () => {
	const {service, client, sockets} = setup();
	const pending = deferred<ReturnType<typeof dto>>();
	client.fetchRaceDetail.mockReturnValueOnce(pending.promise);
	let settled = false;
	const a = service.watch(url).then((watch) => {
		settled = true;
		return watch;
	});
	const b = service.watch(`${url}/#chat`);
	await flush();
	expect(settled).toBe(false);
	expect(sockets).toHaveLength(0);
	expect(client.fetchRaceDetail).toHaveBeenCalledTimes(1);
	pending.resolve(dto());
	const [first, second] = await Promise.all([a, b]);
	expect(first.state.race.raceId).toBe("game/race");
	expect(first.watchId).not.toBe(second.watchId);
	expect(service.getWatch(first.watchId)?.race).not.toBeNull();
	service.unwatch(first.watchId);
	expect(sockets[0]!.close).not.toHaveBeenCalled();
	service.unwatch(second.watchId);
	expect(sockets[0]!.close).toHaveBeenCalledOnce();
	expect(service.getWatch(second.watchId)).toBeNull();
	await flush();
	expect(vi.getTimerCount()).toBe(0);
});
it("removes all references after initial failure and leaves the existing active race intact", async () => {
	const {service, client, sockets} = setup();
	const active = await service.watch(url);
	const pending = deferred<ReturnType<typeof dto>>();
	client.fetchRaceDetail.mockReturnValueOnce(pending.promise);
	const a = service.watch("https://racetime.gg/game/new"),
		b = service.watch("https://racetime.gg/game/new");
	const results = Promise.allSettled([a, b]);
	pending.reject(new Error("not found"));
	expect((await results).map((r) => r.status)).toEqual([
		"rejected",
		"rejected",
	]);
	expect(service.snapshot().races.map((r) => r.url)).toEqual([url]);
	expect(service.getWatch(active.watchId)?.race?.raceId).toBe("game/race");
	expect(sockets).toHaveLength(1);
	service.dispose();
	expect(vi.getTimerCount()).toBe(0);
});
it("aborts pending startup on shutdown without leaving a socket or watch", async () => {
	const {service, client, sockets} = setup();
	const pending = deferred<ReturnType<typeof dto>>();
	client.fetchRaceDetail.mockReturnValueOnce(pending.promise);
	const result = expect(service.watch(url)).rejects.toMatchObject({
		code: "aborted",
	});
	service.dispose();
	pending.resolve(dto());
	await result;
	expect(service.snapshot().races).toEqual([]);
	expect(sockets).toHaveLength(0);
});
it("directoryChanged automatically refreshes names and account removals with revisions", async () => {
	const {service, directory, request} = setup();
	await service.watch(url);
	await flush();
	const before = service.get(url)!;
	expect(before.resolution).toMatchObject({
		state: "ready",
		directoryRevision: 1,
	});
	directory.player = player("New name", 2);
	directory.revision = 2;
	service.directoryChanged(2);
	expect(service.get(url)?.resolution.state).toBe("pending");
	await flush();
	const changed = service.get(url)!;
	expect(changed.participants[0]?.player?.displayName).toBe("New name");
	expect(changed.raceRevision).toBe(before.raceRevision);
	expect(changed.participantsRevision).toBeGreaterThan(
		before.participantsRevision,
	);
	expect(changed.revision).toBeGreaterThan(before.revision);
	const count = request.mock.calls.length;
	service.directoryChanged(2);
	service.directoryChanged(1);
	await flush();
	expect(request).toHaveBeenCalledTimes(count);
	directory.player = null;
	directory.revision = 3;
	service.directoryChanged(3);
	await flush();
	expect(service.get(url)?.participants[0]).toMatchObject({
		status: "unresolved",
		player: null,
	});
	service.dispose();
});
it("coalesces directory events and discards outdated resolutions and post-release updates", async () => {
	const {service, directory, request, publish} = setup();
	const wait = deferred<unknown>();
	const original = request.getMockImplementation()!;
	let waiting = true;
	request.mockImplementation(async (op) => {
		if (op === "find" && waiting) {
			waiting = false;
			return (await wait.promise) as never;
		}
		return original(op);
	});
	const watch = await service.watch(url);
	await flush();
	expect(service.get(url)?.resolution.state).toBe("pending");
	directory.player = player("Newest", 3);
	directory.revision = 3;
	service.directoryChanged(2);
	service.directoryChanged(3);
	wait.resolve({ok: true, data: player("Old")});
	await flush();
	await flush();
	await vi.waitFor(() =>
		expect(service.get(url)?.participants[0]?.player?.displayName).toBe(
			"Newest",
		),
	);
	expect(
		publish.mock.calls.every(
			([snapshot]) =>
				snapshot.races[0]?.participants[0]?.player?.displayName !== "Old",
		),
	).toBe(true);
	service.unwatch(watch.watchId);
	const count = publish.mock.calls.length;
	service.directoryChanged(4);
	await flush();
	expect(publish).toHaveBeenCalledTimes(count);
});
it("keeps race and participant revisions independent for result-only updates", async () => {
	const {service, client, sockets, request} = setup();
	await service.watch(url);
	await flush();
	sockets[0]!.open();
	await flush();
	const before = service.get(url)!;
	const count = request.mock.calls.length;
	client.fetchRaceDetail.mockResolvedValueOnce(dto(2));
	sockets[0]!.message('{"type":"race.data"}');
	await flush();
	const after = service.get(url)!;
	expect(after.raceRevision).toBeGreaterThan(before.raceRevision);
	expect(after.participantsRevision).toBe(before.participantsRevision);
	expect(after.resolution.raceRevision).toBe(after.raceRevision);
	expect(request).toHaveBeenCalledTimes(count);
	after.participants.length = 0;
	expect(service.get(url)?.participants).toHaveLength(1);
	service.dispose();
});
it("handles a directory change queued as the previous resolution completes", async () => {
	const {service, directory, publish} = setup();
	let queued = false;
	publish.mockImplementation((snapshot) => {
		if (!queued && snapshot.races[0]?.resolution.state === "ready") {
			queued = true;
			queueMicrotask(() => {
				directory.player = player("Latest", 2);
				directory.revision = 2;
				service.directoryChanged(2);
			});
		}
	});
	await service.watch(url);
	await vi.waitFor(() => {
		expect(service.get(url)?.resolution).toMatchObject({
			state: "ready",
			directoryRevision: 2,
		});
	});
	expect(service.get(url)?.participants[0]?.player?.displayName).toBe("Latest");
	service.dispose();
});
it("validates new public write contracts and reports disabled Sheets without affecting races", async () => {
	const {service} = setup();
	const mappings = new MappingService(
		{
			revision: 0,
			settings: {
				spreadsheetId: null,
				categoryMappingsSheet: "CategoryMappings",
			},
		},
		() => {},
		() => null,
	);
	const api = createAPI(service, mappings);
	expect(await api.request("watchRace", {url: 123} as never)).toMatchObject({
		ok: false,
		error: {code: "invalid_input"},
	});
	expect(
		await api.request("saveCategoryMapping", {mapping} as never),
	).toMatchObject({ok: false, error: {code: "invalid_input"}});
	expect(
		await api.request("saveCategoryMapping", {
			mapping,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "spreadsheet_unavailable"}});
	expect(await api.request("getSettings", undefined)).toMatchObject({
		ok: true,
		data: {revision: 0},
	});
	expect(
		await api.request("unknown" as never, undefined as never),
	).toMatchObject({ok: false, error: {code: "unsupported_operation"}});
	expect(await api.request("fetchRace", {url})).toMatchObject({
		ok: true,
		data: {raceId: "game/race", results: [{status: "finished"}]},
	});
	service.dispose();
});
