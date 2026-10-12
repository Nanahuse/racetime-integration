import type {
	DirectoryAccount,
	Player,
	PlayerManagerAPI,
} from "@nanahuse/player-manager-protocol";
import {afterEach, expect, it, vi} from "vitest";
import {createAPI} from "../src/api";
import {ParticipantResolver} from "../src/integrations/players";
import {RaceTimeHttpError} from "../src/integrations/racetime/errors";
import {MappingService} from "../src/mappings";
import {RaceService} from "../src/service";
import {deferred, dto, FakeSocket, flush, mapping, url} from "./fixtures";

afterEach(() => vi.useRealTimers());

function raceTimeAccount(
	userId: string,
	role: "primary" | "secondary",
	name = "RaceTime name",
): DirectoryAccount {
	return {
		id: `acct-${userId}`,
		service: "racetime",
		role,
		identity: {userId, name},
	};
}

const player = (
	name = "Runner",
	revision = 1,
	userIds: readonly string[] = ["user1"],
): Player => ({
	playerId: "p1",
	revision,
	manualDisplayName: name,
	racetime: {userId: userIds[0]!, name: "RaceTime name"},
	speedrunCom: null,
	twitch: null,
	youtube: null,
	accounts: userIds.map((userId, index) =>
		raceTimeAccount(userId, index === 0 ? "primary" : "secondary"),
	),
});

function entrant(userId: string) {
	return {...dto().entrants[0]!, userId};
}

function playerAPI() {
	const directory = {revision: 1, players: [player()] as Player[]};
	const request = vi.fn(async (op: string) => {
		if (op === "list")
			return {
				ok: true,
				data: {
					schemaVersion: 2,
					revision: directory.revision,
					players: directory.players,
				},
			};
		return {ok: true, data: null};
	});
	const api = {
		apiVersion: 3,
		ready: Promise.resolve(),
		request,
	} as unknown as PlayerManagerAPI;
	return {api, request, directory};
}

it("resolves Primary and Secondary RaceTime accounts from one directory snapshot", async () => {
	const {api, request, directory} = playerAPI();
	directory.players = [player("Runner", 1, ["user1", "user2"])];
	const result = await new ParticipantResolver(() => api).resolve([
		entrant("user1"),
		entrant("user2"),
	]);
	expect(result.directoryRevision).toBe(1);
	expect(result.participants.map((p) => p.status)).toEqual([
		"matched",
		"matched",
	]);
	expect(result.participants[0]).toMatchObject({
		racetimeUserId: "user1",
		playerId: "p1",
		player: {displayName: "Runner", revision: 1},
	});
	expect(result.participants[1]).toMatchObject({
		racetimeUserId: "user2",
		playerId: "p1",
	});
	expect(request.mock.calls.every(([op]) => op === "list")).toBe(true);
});

it("publishes v3-compatible snapshots with accounts and Twitch without a userId", async () => {
	const {api, directory} = playerAPI();
	directory.players = [
		{
			...player("Runner", 3, ["user1"]),
			speedrunCom: {userId: "src1", name: "SRC Name"},
			twitch: {login: "runner", displayName: "RunnerTV"},
			youtube: "https://youtube.com/@runner",
		},
	];
	const result = await new ParticipantResolver(() => api).resolve(
		dto().entrants,
	);
	expect(result.participants[0]?.player).toMatchObject({
		displayName: "Runner",
		speedrunCom: {userId: "src1", name: "SRC Name"},
		twitch: {userId: null, login: "runner", displayName: "RunnerTV"},
		youtube: "https://youtube.com/@runner",
	});
});

it("distinguishes unresolved accounts, incompatible APIs, invalid data, failures and timeout", async () => {
	const {api, directory} = playerAPI();
	directory.players = [];
	expect(
		(await new ParticipantResolver(() => api).resolve(dto().entrants))
			.participants[0]?.status,
	).toBe("unresolved");
	expect(
		(
			await new ParticipantResolver(
				() => ({...api, apiVersion: 2}) as never,
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
	const invalid = {
		...api,
		request: vi.fn().mockResolvedValue({
			ok: true,
			data: {schemaVersion: 2, revision: 1, players: "nope"},
		}),
	} as PlayerManagerAPI;
	expect(
		(await new ParticipantResolver(() => invalid).resolve(dto().entrants))
			.participants[0]?.status,
	).toBe("unavailable");
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

it("refuses to assign a RaceTime ID claimed by two Players", async () => {
	const {api, directory} = playerAPI();
	directory.players = [
		{...player("Runner", 1, ["user1"]), playerId: "p1"},
		{...player("Other", 1, ["user1"]), playerId: "p2"},
	];
	const result = await new ParticipantResolver(() => api).resolve(
		dto().entrants,
	);
	expect(result.participants[0]).toMatchObject({
		status: "unavailable",
		playerId: null,
	});
});

it("ignores account entries without a usable RaceTime userId", async () => {
	const {api, directory} = playerAPI();
	directory.players = [
		{
			...player("Runner", 1, ["user1"]),
			racetime: null,
			accounts: [
				{
					id: "acct-string",
					service: "racetime",
					role: "primary",
					identity: "user1",
				},
				{
					id: "acct-twitch",
					service: "twitch",
					role: "secondary",
					identity: {login: "runner"},
				},
			],
		},
	];
	const result = await new ParticipantResolver(() => api).resolve(
		dto().entrants,
	);
	expect(result.participants[0]).toMatchObject({
		status: "unresolved",
		playerId: null,
	});
});

it("reflects an account moving to another Player on the next snapshot", async () => {
	const {api, directory} = playerAPI();
	directory.players = [player("Runner", 1, ["user1", "user2"])];
	expect(
		(await new ParticipantResolver(() => api).resolve([entrant("user2")]))
			.participants[0],
	).toMatchObject({playerId: "p1"});
	directory.players = [
		{...player("Runner", 2, ["user1"]), playerId: "p1"},
		{...player("Moved", 1, ["user2"]), playerId: "p9"},
	];
	expect(
		(await new ParticipantResolver(() => api).resolve([entrant("user2")]))
			.participants[0],
	).toMatchObject({playerId: "p9", status: "matched"});
	directory.players = [{...player("Runner", 2, ["user1"]), playerId: "p1"}];
	expect(
		(await new ParticipantResolver(() => api).resolve([entrant("user2")]))
			.participants[0]?.status,
	).toBe("unresolved");
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
it("re-resolves on directoryChanged even when the revision is unchanged", async () => {
	const {service, directory, request} = setup();
	await service.watch(url);
	await flush();
	const before = service.get(url)!;
	expect(before.resolution).toMatchObject({
		state: "ready",
		directoryRevision: 1,
	});
	directory.players = [player("New name", 2, ["user1", "user2"])];
	service.directoryChanged(1);
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
	service.directoryChanged(0);
	await flush();
	expect(request.mock.calls.length).toBeGreaterThan(count);
	directory.players = [];
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
		if (op === "list" && waiting) {
			waiting = false;
			return (await wait.promise) as never;
		}
		return original(op);
	});
	const watch = await service.watch(url);
	await flush();
	expect(service.get(url)?.resolution.state).toBe("pending");
	directory.players = [player("Newest", 3)];
	directory.revision = 3;
	service.directoryChanged(2);
	service.directoryChanged(3);
	wait.resolve({
		ok: true,
		data: {
			schemaVersion: 2,
			revision: 2,
			players: [player("Old")],
		},
	});
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
				directory.players = [player("Latest", 2)];
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
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
			},
		},
		() => {},
		() => null,
	);
	const speedrun = {
		searchGames: vi.fn(),
		getGameOptions: vi.fn(),
		getCategoryVariables: vi.fn(),
		getCategoryGameId: vi.fn(),
	};
	const api = createAPI(service, mappings, speedrun as never, () => {
		throw new Error("spreadsheet client is not available in this test");
	});
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
		data: {
			race: {raceId: "game/race", results: [{status: "finished"}]},
			resolution: {state: "ready", directoryRevision: 1},
		},
	});
	service.dispose();
});

it("resolves participants for a single fetch without creating a watch or session", async () => {
	const {service, client, sockets, publish} = setup();
	const result = await service.fetch(url);
	expect(client.fetchRaceDetail).toHaveBeenCalledTimes(1);
	expect(result.race.raceId).toBe("game/race");
	expect(result.participants[0]).toMatchObject({
		racetimeUserId: "user1",
		status: "matched",
		playerId: "p1",
	});
	expect(result.resolution).toEqual({state: "ready", directoryRevision: 1});
	expect(sockets).toHaveLength(0);
	expect(service.snapshot().races).toEqual([]);
	expect(service.getWatch("any-watch")).toBeNull();
	expect(publish).not.toHaveBeenCalled();
	service.dispose();
});

it("resolves in-progress races with the same participant logic as completed races", async () => {
	const {service, client} = setup();
	const inProgress = dto();
	inProgress.entrants[0]!.status = "in_progress";
	client.fetchRaceDetail.mockResolvedValueOnce(inProgress);
	const ongoing = await service.fetch(url);
	const finished = await service.fetch(url);
	expect(ongoing.participants).toEqual(finished.participants);
	expect(ongoing.resolution.state).toBe("ready");
	expect(ongoing.race.results[0]?.status).toBe("other");
	expect(finished.race.results[0]?.status).toBe("finished");
});

it("keeps race information and reports unavailable participants when Player Manager fails", async () => {
	const service = new RaceService(
		{fetchRaceDetail: vi.fn(async () => dto())},
		() => {
			throw new Error("a single fetch must not open a socket");
		},
		new ParticipantResolver(() => undefined),
		() => {},
	);
	const result = await service.fetch(url);
	expect(result.race.raceId).toBe("game/race");
	expect(result.resolution).toEqual({state: "error", directoryRevision: null});
	expect(result.participants[0]).toMatchObject({
		status: "unavailable",
		player: null,
	});
});

it("returns an API error when the RaceTime fetch fails without touching monitoring", async () => {
	const {service, client} = setup();
	const mappings = new MappingService(
		{
			revision: 0,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
			},
		},
		() => {},
		() => null,
	);
	const api = createAPI(service, mappings, {} as never, () => {
		throw new Error("unused");
	});
	client.fetchRaceDetail.mockRejectedValueOnce(
		new RaceTimeHttpError(500, "boom"),
	);
	expect(await api.request("fetchRace", {url})).toMatchObject({
		ok: false,
		error: {code: "http_error"},
	});
	expect(service.snapshot().races).toEqual([]);
	service.dispose();
});

it("produces the same resolution for watched and single-fetched races", async () => {
	const {service} = setup();
	const watch = await service.watch(url);
	await flush();
	const watched = service.get(url)!;
	const fetched = await service.fetch(url);
	expect(fetched.participants).toEqual(watched.participants);
	expect(fetched.resolution).toMatchObject({
		state: "ready",
		directoryRevision: 1,
	});
	expect(fetched.race.raceId).toBe(watched.race?.raceId);
	service.unwatch(watch.watchId);
	service.dispose();
});

it("leaves an existing monitored race and its sockets untouched during a single fetch", async () => {
	const {service, client, sockets, publish} = setup();
	await service.watch(url);
	await flush();
	const before = service.snapshot();
	publish.mockClear();
	client.fetchRaceDetail.mockResolvedValueOnce(dto(2, "other"));
	const result = await service.fetch("https://racetime.gg/game/other");
	expect(result.race.raceId).toBe("game/other");
	expect(sockets).toHaveLength(1);
	expect(publish).not.toHaveBeenCalled();
	expect(service.snapshot()).toEqual(before);
	service.dispose();
});
