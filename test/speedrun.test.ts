import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
} from "@nanahuse/racetime-protocol";
import {expect, it, vi} from "vitest";
import {createAPI} from "../src/api";
import {IntegrationError} from "../src/errors";
import {HttpSpeedrunClient} from "../src/integrations/speedrun/client";
import {MappingService, type MappingsRepository} from "../src/mappings";
import {gameMapping} from "./fixtures";

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
