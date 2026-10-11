import type {
	PlayerManagerAPI,
	Resolution,
} from "@nanahuse/player-manager-protocol";
import {afterEach, expect, it, vi} from "vitest";
import {createAPI} from "../src/api";
import {ParticipantResolver} from "../src/integrations/players";
import {RaceService} from "../src/service";
import {deferred, dto, FakeSocket, flush, mapping, url} from "./fixtures";

afterEach(() => vi.useRealTimers());
const resolution = (status: Resolution["status"] = "matched"): Resolution => ({
	status,
	playerId: "p1",
	candidates: [{type: "player", playerId: "p1"}],
	message: "Resolved",
	warnings: [],
	input: {
		manualDisplayName: null,
		racetime: null,
		speedrunCom: null,
		twitch: null,
	},
});
const playerAPI = (request: ReturnType<typeof vi.fn>) =>
	({
		apiVersion: 1,
		ready: Promise.resolve(),
		request,
	}) as unknown as PlayerManagerAPI;

it("delegates identity resolution to the public Player Manager API without mutation", async () => {
	const request = vi.fn().mockResolvedValue({ok: true, data: resolution()});
	const resolver = new ParticipantResolver(() => playerAPI(request));
	expect(await resolver.resolve(dto().entrants)).toEqual([
		expect.objectContaining({
			racetimeUserId: "user1",
			status: "matched",
			playerId: "p1",
		}),
	]);
	expect(request).toHaveBeenCalledExactlyOnceWith("resolve", {
		input: {
			racetime: {userId: "user1", name: "Runner", twitchLogin: "runner"},
			twitch: {login: "runner"},
		},
	});
});
it.each(["unresolved", "ambiguous", "conflict"] as const)(
	"preserves %s and never guesses a player",
	async (status) => {
		const resolver = new ParticipantResolver(() =>
			playerAPI(
				vi.fn().mockResolvedValue({ok: true, data: resolution(status)}),
			),
		);
		expect(await resolver.resolve(dto().entrants)).toEqual([
			expect.objectContaining({status, playerId: null}),
		]);
	},
);
it("represents dependency failure and timeout separately from unmatched players", async () => {
	const resolver = new ParticipantResolver(() => undefined);
	expect((await resolver.resolve(dto().entrants))[0]?.status).toBe(
		"unavailable",
	);
	const failed = new ParticipantResolver(() =>
		playerAPI(
			vi.fn().mockResolvedValue({ok: false, error: {message: "offline"}}),
		),
	);
	expect((await failed.resolve(dto().entrants))[0]).toMatchObject({
		status: "unavailable",
		message: "offline",
	});
	vi.useFakeTimers();
	const stalled = new ParticipantResolver(
		() => playerAPI(vi.fn().mockReturnValue(new Promise(() => {}))),
		10,
	);
	const pending = stalled.resolve(dto().entrants);
	await vi.advanceTimersByTimeAsync(10);
	expect((await pending)[0]).toMatchObject({
		status: "unavailable",
		message: "Player Manager timed out",
	});
});

function setup() {
	vi.useFakeTimers();
	const client = {fetchRaceDetail: vi.fn(async () => dto())};
	const sockets: FakeSocket[] = [];
	const request = vi.fn().mockResolvedValue({ok: true, data: resolution()});
	const publish = vi.fn();
	const service = new RaceService(
		client,
		() => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		new ParticipantResolver(() => playerAPI(request)),
		publish,
	);
	return {service, client, sockets, request, publish};
}
it("shares one watcher per canonical URL and releases only the final reference", async () => {
	const {service, client, sockets} = setup();
	const a = service.watch(url),
		b = service.watch(`${url}/#chat`);
	service.watch("https://racetime.gg/game/other");
	await flush();
	expect(a.watchId).not.toBe(b.watchId);
	expect(sockets).toHaveLength(2);
	expect(client.fetchRaceDetail).toHaveBeenCalledTimes(2);
	expect(service.snapshot().races).toHaveLength(2);
	expect(service.unwatch(a.watchId)).toBe(true);
	expect(sockets[0]!.close).not.toHaveBeenCalled();
	expect(service.unwatch(a.watchId)).toBe(false);
	service.unwatch(b.watchId);
	expect(sockets[0]!.close).toHaveBeenCalledOnce();
	expect(service.snapshot().races).toHaveLength(1);
	service.dispose();
	expect(vi.getTimerCount()).toBe(0);
});
it("returns isolated snapshots and does not repeat lookups for result-only updates", async () => {
	const {service, sockets, client, request} = setup();
	const initial = dto();
	initial.entrants.push({...initial.entrants[0]!, userId: "user2"});
	client.fetchRaceDetail.mockResolvedValue(initial);
	service.watch(url);
	await flush();
	sockets[0]!.open();
	await flush();
	expect(request).toHaveBeenCalledTimes(2);
	const reordered = {
		...initial,
		version: 2,
		entrants: [...initial.entrants].reverse(),
	};
	client.fetchRaceDetail.mockResolvedValueOnce(reordered);
	sockets[0]!.message('{"type":"race.data"}');
	await flush();
	expect(request).toHaveBeenCalledTimes(2);
	const state = service.get(url)!;
	state.participants.length = 0;
	state.race!.entrants.length = 0;
	expect(service.get(url)?.participants).toHaveLength(2);
	expect(service.get(url)?.race?.entrants).toHaveLength(2);
	service.dispose();
});
it("ignores participant results for replaced entrant lists and disposed sessions", async () => {
	const {service, sockets, client, request, publish} = setup();
	const pending = deferred<unknown>();
	request.mockReturnValueOnce(pending.promise);
	const watch = service.watch(url);
	await flush();
	const changed = dto(2);
	changed.entrants[0]!.userId = "user2";
	client.fetchRaceDetail.mockResolvedValueOnce(changed);
	sockets[0]!.open();
	await flush();
	expect(service.get(url)?.participants[0]?.racetimeUserId).toBe("user2");
	pending.resolve({ok: true, data: resolution()});
	await flush();
	expect(service.get(url)?.participants[0]?.racetimeUserId).toBe("user2");
	const late = deferred<unknown>();
	request.mockReturnValueOnce(late.promise);
	const refresh = service.resolve(url);
	service.unwatch(watch.watchId);
	const count = publish.mock.calls.length;
	late.resolve({ok: true, data: resolution()});
	await refresh;
	expect(publish).toHaveBeenCalledTimes(count);
});
it("validates public requests and reports Sheets configuration errors without affecting races", async () => {
	const {service} = setup();
	const api = createAPI(service, null);
	expect(await api.request("watchRace", {url: 123} as never)).toMatchObject({
		ok: false,
		error: {code: "invalid_input"},
	});
	expect(
		await api.request("saveCategoryMapping", {mapping: {}} as never),
	).toMatchObject({ok: false, error: {code: "invalid_input"}});
	expect(await api.request("saveCategoryMapping", {mapping})).toMatchObject({
		ok: false,
		error: {code: "spreadsheet_unavailable"},
	});
	expect(
		await api.request("unknown" as never, undefined as never),
	).toMatchObject({ok: false, error: {code: "unsupported_operation"}});
	expect(await api.request("fetchRace", {url})).toMatchObject({
		ok: true,
		data: {url},
	});
	service.dispose();
});
