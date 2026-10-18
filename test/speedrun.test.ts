import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	ResolvedCategoryMapping,
} from "@nanahuse/racetime-protocol";
import {expect, it, vi} from "vitest";
import {createAPI} from "../src/api";
import {IntegrationError} from "../src/errors";
import {HttpSpeedrunClient} from "../src/integrations/speedrun/client";
import {MappingService, type MappingsRepository} from "../src/mappings";
import {gameMapping} from "./fixtures";

const resolvedLookup: ResolvedCategoryMapping = {
	key: "lookup",
	label: "Any% (Mode: Hard)",
	game: {gameId: "g1", gameName: "Game One"},
	category: {
		categoryId: "c1",
		categoryName: "Any%",
		levelId: "l1",
		variables: {v1: "hard"},
		platformId: "p1",
		regionId: "r1",
		emulator: false,
		timingMethod: "realtime_noloads",
	},
};

function clientWith(routes: Record<string, unknown>) {
	const fetchImpl = vi.fn(async (url: string) => {
		const path = new URL(url).pathname;
		if (!(path in routes)) return new Response("", {status: 404});
		const body = routes[path];
		return body instanceof Response ? body : Response.json(body);
	});
	return {
		fetchImpl,
		client: new HttpSpeedrunClient({
			fetchImpl: fetchImpl as never,
			userAgent: "test",
		}),
	};
}

const routes: Record<string, unknown> = {
	"/api/v1/games": {
		data: [{id: "g1", names: {international: "Game One"}, abbreviation: "G1"}],
		pagination: {size: 1},
	},
	"/api/v1/games/g1": {
		data: {
			id: "g1",
			names: {international: "Game One"},
			abbreviation: "G1",
			platforms: ["p1"],
			regions: ["r1"],
			ruleset: {"run-times": ["realtime", "ingame"]},
		},
	},
	"/api/v1/games/g1/categories": {
		data: [
			{id: "c1", name: "Any%", type: "per-game", miscellaneous: false},
			{id: "c2", name: "100%", type: "per-level", miscellaneous: true},
		],
		pagination: {size: 2},
	},
	"/api/v1/games/g1/levels": {
		data: [{id: "l1", name: "World 1"}],
		pagination: {size: 1},
	},
	"/api/v1/platforms": {
		data: [
			{id: "p1", name: "PC"},
			{id: "p2", name: "Console"},
		],
		pagination: {size: 2},
	},
	"/api/v1/regions": {
		data: [
			{id: "r1", name: "USA"},
			{id: "r2", name: "Japan"},
		],
		pagination: {size: 2},
	},
	"/api/v1/categories/c1/variables": {
		data: [
			{
				id: "v1",
				name: "Difficulty",
				mandatory: true,
				"user-defined": false,
				obsoletes: true,
				values: {values: {normal: {label: "Normal"}, hard: {label: "Hard"}}},
			},
		],
		pagination: {size: 1},
	},
	"/api/v1/categories/c1": {
		data: {
			id: "c1",
			links: [
				{
					rel: "self",
					uri: "https://www.speedrun.com/api/v1/categories/c1",
				},
				{rel: "game", uri: "https://www.speedrun.com/api/v1/games/g1"},
			],
		},
	},
	"/api/v1/categories/c-no-game": {
		data: {
			id: "c-no-game",
			links: [
				{
					rel: "self",
					uri: "https://www.speedrun.com/api/v1/categories/c-no-game",
				},
			],
		},
	},
	"/api/v1/categories/c-bad-uri": {
		data: {
			id: "c-bad-uri",
			links: [{rel: "game", uri: "https://evil.test/api/v1/games/g1"}],
		},
	},
	"/api/v1/categories/c-other": {
		data: {
			id: "c-other",
			links: [{rel: "game", uri: "https://www.speedrun.com/api/v1/games/g2"}],
		},
	},
	"/api/v1/categories/c-other/variables": {
		data: [],
		pagination: {size: 0},
	},
	"/api/v1/categories/c3/variables": {
		data: [
			{
				id: "runner",
				name: "Runner",
				mandatory: true,
				"user-defined": true,
				obsoletes: true,
				values: {values: {}},
			},
		],
		pagination: {size: 1},
	},
};

it("searches games by name through the Speedrun.com API", async () => {
	const {client, fetchImpl} = clientWith(routes);
	expect(await client.searchGames("mario")).toEqual([
		{id: "g1", name: "Game One", abbreviation: "G1"},
	]);
	const requested = new URL(fetchImpl.mock.calls[0]![0]);
	expect(requested.pathname).toBe("/api/v1/games");
	expect(requested.searchParams.get("name")).toBe("mario");
});

it("composes game options with categories, levels, supported platforms and regions", async () => {
	const {client} = clientWith(routes);
	const options = await client.getGameOptions("g1");
	expect(options.game).toMatchObject({id: "g1", name: "Game One"});
	expect(options.categories).toHaveLength(2);
	expect(options.levels).toEqual([{id: "l1", name: "World 1"}]);
	expect(options.platforms).toEqual([{id: "p1", name: "PC"}]);
	expect(options.regions).toEqual([{id: "r1", name: "USA"}]);
	expect(options.timingMethods).toEqual(["realtime", "ingame"]);
});

it("returns category variables with their selectable values and resolves the owning game", async () => {
	const {client} = clientWith(routes);
	expect(await client.getCategoryVariables("c1")).toEqual([
		{
			id: "v1",
			name: "Difficulty",
			mandatory: true,
			userDefined: false,
			obsoletes: true,
			values: [
				{id: "normal", label: "Normal"},
				{id: "hard", label: "Hard"},
			],
		},
	]);
	expect(await client.getCategoryGameId("c1")).toBe("g1");
});

it("ignores non-game links and rejects categories without a usable game link", async () => {
	const {client} = clientWith(routes);
	// c1 lists "self" before "game"; only the game link is used.
	expect(await client.getCategoryGameId("c1")).toBe("g1");
	await expect(client.getCategoryGameId("c-no-game")).rejects.toMatchObject({
		code: "invalid_payload",
	});
	await expect(client.getCategoryGameId("c-bad-uri")).rejects.toMatchObject({
		code: "invalid_payload",
	});
});

it("requests only the initial page for game search", async () => {
	const many = Array.from({length: 20}, (_, index) => ({
		id: `g${index}`,
		names: {international: `Game ${index}`},
		abbreviation: `G${index}`,
	}));
	const fetchImpl = vi.fn(async (_url: string) =>
		Response.json({data: many, pagination: {size: 20}}),
	);
	const client = new HttpSpeedrunClient({
		fetchImpl: fetchImpl as never,
		userAgent: "test",
	});
	const games = await client.searchGames("mario");
	expect(games).toHaveLength(20);
	expect(fetchImpl).toHaveBeenCalledOnce();
	const requested = new URL(fetchImpl.mock.calls[0]![0]);
	expect(requested.searchParams.get("max")).toBe("20");
	expect(requested.searchParams.get("offset")).toBe("0");
});

it("maps user-defined variables without offered values", async () => {
	const {client} = clientWith(routes);
	expect(await client.getCategoryVariables("c3")).toEqual([
		{
			id: "runner",
			name: "Runner",
			mandatory: true,
			userDefined: true,
			obsoletes: true,
			values: [],
		},
	]);
});

it("maps missing resources to not_found and server failures to speedrun_unavailable", async () => {
	const {client} = clientWith({
		"/api/v1/games": new Response("", {status: 500}),
	});
	await expect(client.searchGames("x")).rejects.toMatchObject({
		code: "speedrun_unavailable",
	});
	await expect(client.getCategoryGameId("missing")).rejects.toMatchObject({
		code: "not_found",
	});
});

it("caches reference lookups while keeping distinct keys apart", async () => {
	const {client, fetchImpl} = clientWith(routes);
	await client.getGameOptions("g1");
	await client.getGameOptions("g1");
	expect(fetchImpl).toHaveBeenCalledTimes(5);
	await client.getCategoryVariables("c1");
	await client.getCategoryVariables("c1");
	expect(fetchImpl).toHaveBeenCalledTimes(6);
});

function memoryRepository(): MappingsRepository {
	const games = new Map<string, {mapping: GameMapping; revision: string}>();
	const categories = new Map<
		string,
		{mapping: CategoryMapping; revision: string}
	>();
	let seq = 0;
	const key = (slug: string, goal = "") => `${slug.trim()}\u0000${goal.trim()}`;
	const clone = <T>(record: {mapping: T; revision: string}) => ({
		mapping: structuredClone(record.mapping),
		revision: record.revision,
	});
	return {
		games: {
			async find(categorySlug): Promise<GameMappingRecord | null> {
				const record = games.get(key(categorySlug));
				return record ? clone(record) : null;
			},
			async list(): Promise<GameMappingRecord[]> {
				return [...games.values()].map(clone);
			},
			async save(next, expected) {
				const k = key(next.racetime.categorySlug);
				const existing = games.get(k);
				if ((existing?.revision ?? null) !== expected)
					throw new IntegrationError("mapping_conflict", "conflict");
				const revision = `g${++seq}`;
				games.set(k, {mapping: structuredClone(next), revision});
				return {
					record: {mapping: structuredClone(next), revision},
					action: existing ? "updated" : "created",
				};
			},
			async delete(categorySlug, expected) {
				const k = key(categorySlug);
				const existing = games.get(k);
				if (!existing || existing.revision !== expected)
					throw new IntegrationError("mapping_conflict", "conflict");
				games.delete(k);
			},
		},
		categories: {
			async find(categorySlug, goal): Promise<CategoryMappingRecord | null> {
				const record = categories.get(key(categorySlug, goal));
				return record ? clone(record) : null;
			},
			async list(): Promise<CategoryMappingRecord[]> {
				return [...categories.values()].map(clone);
			},
			async save(next, expected) {
				const k = key(next.racetime.categorySlug, next.racetime.goal);
				const existing = categories.get(k);
				if ((existing?.revision ?? null) !== expected)
					throw new IntegrationError("mapping_conflict", "conflict");
				const revision = `c${++seq}`;
				categories.set(k, {mapping: structuredClone(next), revision});
				return {
					record: {mapping: structuredClone(next), revision},
					action: existing ? "updated" : "created",
				};
			},
			async delete(categorySlug, goal, expected) {
				const k = key(categorySlug, goal);
				const existing = categories.get(k);
				if (!existing || existing.revision !== expected)
					throw new IntegrationError("mapping_conflict", "conflict");
				categories.delete(k);
			},
		},
	};
}

it("validates the SRC category against the game resolved from the game link", async () => {
	const service = new MappingService(
		{
			revision: 0,
			settings: {
				spreadsheetId: "sheet",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				leaderboardTop: 20,
			},
		},
		() => {},
		() => memoryRepository(),
	);
	const {client} = clientWith(routes);
	const api = createAPI({} as never, service, client, () => {
		throw new Error("unused");
	});
	await api.request("saveGameMapping", {
		mapping: gameMapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	const owned: CategoryMapping = {
		racetime: {categorySlug: "game", goal: "Any%"},
		speedrunCom: {
			categoryId: "c1",
			categoryName: "Any%",
			levelId: null,
			variables: {v1: "normal"},
			platformId: null,
			regionId: null,
			emulator: null,
			timingMethod: null,
		},
	};
	const created = await api.request("saveCategoryMapping", {
		mapping: owned,
		expectedRevision: null,
		settingsRevision: 0,
	});
	expect(created).toMatchObject({ok: true, data: {action: "created"}});

	const foreign = structuredClone(owned);
	foreign.speedrunCom.categoryId = "c-other";
	expect(
		await api.request("saveCategoryMapping", {
			mapping: foreign,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "category_not_in_game"}});
});

it("requests a filtered level leaderboard, preserves ties, and joins embedded player records", async () => {
	const {client, fetchImpl} = clientWith({
		"/api/v1/leaderboards/g1/level/l1/c1": {
			data: {
				game: "g1",
				category: "c1",
				level: "l1",
				platform: "p1",
				region: "r1",
				emulators: false,
				timing: "realtime_noloads",
				values: {v1: "hard"},
				players: [
					{
						rel: "user",
						id: "u1",
						names: {international: "Runner"},
						weblink: "https://www.speedrun.com/user/runner",
					},
					{rel: "guest", name: "Guest Runner"},
				],
				runs: [
					{
						place: 1,
						run: {
							id: "run1",
							weblink: "https://www.speedrun.com/runs/run1",
							date: "2026-01-02",
							times: {realtime_noloads: "PT1M2S"},
							players: [{rel: "user", id: "u1"}],
						},
					},
					{
						place: 1,
						run: {
							id: "run2",
							times: {realtime_noloads: "PT1M2S"},
							players: [{rel: "guest", name: "Guest Runner"}],
						},
					},
				],
			},
		},
	});
	const result = await client.getLeaderboard(resolvedLookup, 20);
	const requested = new URL(fetchImpl.mock.calls[0]![0] as string);
	expect(requested.searchParams.get("top")).toBe("20");
	expect(requested.searchParams.get("platform")).toBe("p1");
	expect(requested.searchParams.get("region")).toBe("r1");
	expect(requested.searchParams.get("emulators")).toBe("false");
	expect(requested.searchParams.get("timing")).toBe("realtime_noloads");
	expect(requested.searchParams.get("var-v1")).toBe("hard");
	expect(result.entries.map(({place}) => place)).toEqual([1, 1]);
	expect(result.entries[0]?.run.players[0]).toMatchObject({
		userId: "u1",
		name: "Runner",
	});
	expect(result.entries[1]?.run.players[0]).toMatchObject({
		userId: null,
		name: "Guest Runner",
	});
});

function personalBest(
	id: string,
	place: number,
	category = "c1",
	level: string | null = "l1",
	values: Record<string, unknown> = {v1: "hard"},
	primary = "PT40S",
) {
	return {
		place,
		run: {
			id,
			status: {status: "verified"},
			game: "g1",
			category,
			level,
			weblink: `https://www.speedrun.com/runs/${id}`,
			date: "2025-07-01",
			times: {primary},
			values,
		},
	};
}

function timeBoundaryClient(time: unknown, date: unknown) {
	const pb = personalBest("precise", 3);
	const run = {
		...pb.run,
		times: {primary: time, realtime_noloads: time},
		date,
		players: [{rel: "guest", name: "Guest"}],
	};
	return clientWith({
		"/api/v1/users/u1/personal-bests": {
			data: [{...pb, run}],
			pagination: {size: 1, offset: 0, max: 200},
		},
		"/api/v1/leaderboards/g1/level/l1/c1": {
			data: {
				game: "g1",
				category: "c1",
				level: "l1",
				platform: "p1",
				region: "r1",
				emulators: false,
				timing: "realtime_noloads",
				values: {v1: "hard"},
				players: [{rel: "guest", name: "Guest"}],
				runs: [{place: 3, run}],
			},
		},
	}).client;
}

it.each(["2024-02-29", null])(
	"publishes exact durations and validated dates (%s) for both PBs and leaderboards",
	async (date) => {
		const client = timeBoundaryClient("PT0.123456789S", date);
		const bests = await client.getUserPersonalBests("u1", "g1");
		const leaderboard = await client.getLeaderboard(resolvedLookup, 20);
		expect(bests[0]).toMatchObject({time: "PT0.123456789S", date});
		expect(leaderboard.entries[0]?.run).toMatchObject({
			time: "PT0.123456789S",
			date,
		});
		expect(bests).toEqual(JSON.parse(JSON.stringify(bests)));
		expect(leaderboard).toEqual(JSON.parse(JSON.stringify(leaderboard)));
		expect(leaderboard.fetchedAt).toMatch(/Z$/);
	},
);

it.each([
	["-PT1S", "2026-01-01"],
	["P1Y", "2026-01-01"],
	["P1M", "2026-01-01"],
	["P1W", "2026-01-01"],
	["bad", null],
	[10, null],
	["PT1S", "2026-02-29"],
	["PT1S", "2026-01-01T00:00:00Z"],
	["PT1S", "bad"],
	["PT1S", 2026],
])(
	"rejects invalid SRC time/date (%s, %s) at both fetch boundaries",
	async (time, date) => {
		const client = timeBoundaryClient(time, date);
		await expect(client.getUserPersonalBests("u1", "g1")).rejects.toMatchObject(
			{code: "invalid_payload"},
		);
		await expect(
			client.getLeaderboard(resolvedLookup, 20),
		).rejects.toMatchObject({code: "invalid_payload"});
	},
);

it("normalizes official Personal Best entries and uses game without a top filter", async () => {
	const {client, fetchImpl} = clientWith({
		"/api/v1/users/u1/personal-bests": {
			data: [personalBest("pb1", 7)],
			pagination: {size: 1, offset: 0, max: 200},
		},
	});
	const personalBests = await client.getUserPersonalBests("u1", "g1");
	const requested = new URL(fetchImpl.mock.calls[0]![0] as string);
	expect(requested.searchParams.get("game")).toBe("g1");
	expect(requested.searchParams.has("top")).toBe(false);
	expect(personalBests).toEqual([
		{
			runId: "pb1",
			url: "https://www.speedrun.com/runs/pb1",
			time: "PT40S",
			date: "2025-07-01",
			players: [
				{
					userId: "u1",
					name: "u1",
					url: "https://www.speedrun.com/users/u1",
				},
			],
			place: 7,
			gameId: "g1",
			categoryId: "c1",
			levelId: "l1",
			variables: {v1: "hard"},
		},
	]);
});

it("reuses the complete PB list for another category in the same game", async () => {
	const {client, fetchImpl} = clientWith({
		"/api/v1/users/u1/personal-bests": {
			data: [personalBest("pb1", 7), personalBest("pb2", 2, "c2", null, {})],
			pagination: {size: 2, offset: 0, max: 200},
		},
	});
	const first = await client.getUserPersonalBests("u1", "g1");
	const second = await client.getUserPersonalBests("u1", "g1");
	expect(first.map(({categoryId}) => categoryId)).toEqual(["c1", "c2"]);
	expect(second).toEqual(first);
	expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("reads every Personal Best page and preserves official places", async () => {
	const pageData = (offset: number) =>
		Array.from({length: offset === 1000 ? 1 : 200}, (_, index) =>
			personalBest(`pb-${offset}-${index}`, index + 1),
		);
	const fetchImpl = vi.fn(async (url: string) => {
		const offset = Number(new URL(url).searchParams.get("offset"));
		return Response.json({
			data: pageData(offset),
			pagination: {size: pageData(offset).length, offset, max: 200},
		});
	});
	const client = new HttpSpeedrunClient({fetchImpl: fetchImpl as never});
	const results = await client.getUserPersonalBests("u1", "g1");
	expect(results).toHaveLength(1001);
	expect(fetchImpl).toHaveBeenCalledTimes(6);
	expect(
		fetchImpl.mock.calls.map(([url]) =>
			Number(new URL(url).searchParams.get("offset")),
		),
	).toEqual([0, 200, 400, 600, 800, 1000]);
});

it("rejects a repeated full Personal Best page", async () => {
	const page = Array.from({length: 200}, (_, index) =>
		personalBest(`pb-${index}`, index + 1),
	);
	const fetchImpl = vi.fn(async (url: string) => {
		const offset = Number(new URL(url).searchParams.get("offset"));
		return Response.json({
			data: page,
			pagination: {size: page.length, offset, max: 200},
		});
	});
	const client = new HttpSpeedrunClient({fetchImpl: fetchImpl as never});
	await expect(client.getUserPersonalBests("u1", "g1")).rejects.toMatchObject({
		code: "invalid_payload",
	});
	expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("refreshes a cached Personal Best list on request", async () => {
	const {client, fetchImpl} = clientWith({
		"/api/v1/users/u1/personal-bests": {
			data: [personalBest("pb1", 7)],
			pagination: {size: 1, offset: 0, max: 200},
		},
	});
	await client.getUserPersonalBests("u1", "g1");
	await client.getUserPersonalBests("u1", "g1", true);
	expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("propagates an error when a Personal Best page fails before completion", async () => {
	const firstPage = Array.from({length: 200}, (_, index) =>
		personalBest(`pb-${index}`, index + 1),
	);
	const fetchImpl = vi.fn(async (url: string) => {
		const offset = Number(new URL(url).searchParams.get("offset"));
		return offset === 0
			? Response.json({
					data: firstPage,
					pagination: {size: 200, offset, max: 200},
				})
			: new Response("", {status: 503});
	});
	const client = new HttpSpeedrunClient({fetchImpl: fetchImpl as never});
	await expect(client.getUserPersonalBests("u1", "g1")).rejects.toMatchObject({
		code: "speedrun_unavailable",
	});
});

it("rejects malformed official PB records instead of treating them as found", async () => {
	const {client} = clientWith({
		"/api/v1/users/u1/personal-bests": {
			data: [{place: 0, run: personalBest("bad", 1).run}],
			pagination: {size: 1, offset: 0, max: 200},
		},
	});
	await expect(client.getUserPersonalBests("u1", "g1")).rejects.toMatchObject({
		code: "invalid_payload",
	});
});
