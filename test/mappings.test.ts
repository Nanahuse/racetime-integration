import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
} from "@nanahuse/racetime-protocol";
import {expect, it, vi} from "vitest";
import {createAPI} from "../src/api";
import {IntegrationError} from "../src/errors";
import {MappingService, type MappingsRepository} from "../src/mappings";
import {gameMapping, mapping} from "./fixtures";

type Stored<T> = {mapping: T; revision: string};

function memoryRepository() {
	const games = new Map<string, Stored<GameMapping>>();
	const categories = new Map<string, Stored<CategoryMapping>>();
	let seq = 0;
	const key = (slug: string, goal?: string) =>
		`${slug.trim()}\u0000${(goal ?? "").trim()}`;
	const clone = <T>(record: Stored<T>): {mapping: T; revision: string} => ({
		mapping: structuredClone(record.mapping),
		revision: record.revision,
	});
	const repository: MappingsRepository = {
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
	return {repository, games, categories};
}

function setup() {
	const memory = memoryRepository();
	const persist = vi.fn();
	const service = new MappingService(
		{
			revision: 0,
			settings: {
				spreadsheetId: "sheet",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
			},
		},
		persist,
		() => memory.repository,
	);
	const speedrun = {
		searchGames: vi.fn(async (query: string) => [
			{id: "g1", name: `Result ${query}`, abbreviation: "R"},
		]),
		getGameOptions: vi.fn(async (gameId: string) => ({
			game: {
				id: gameId,
				name: "Game",
				abbreviation: "G",
				platformIds: [],
				regionIds: [],
				timingMethods: {realtime: true, realtimeNoLoads: false, ingame: false},
			},
			categories: [],
			levels: [],
			platforms: [],
			regions: [],
			timingMethods: ["realtime" as const],
		})),
		getCategoryVariables: vi.fn(async () => [
			{
				id: "difficulty",
				name: "Difficulty",
				mandatory: false,
				userDefined: false,
				values: [{id: "normal", label: "Normal"}],
			},
		]),
		getCategoryGameId: vi.fn(async (categoryId: string) =>
			categoryId === "c1" ? "g1" : "other",
		),
	};
	const api = createAPI({} as never, service, speedrun);
	return {api, service, speedrun, persist, memory};
}

it("exposes Game Mapping CRUD through the public API with conflict detection", async () => {
	const {api} = setup();
	const created = await api.request("saveGameMapping", {
		mapping: gameMapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	expect(created).toMatchObject({
		ok: true,
		data: {action: "created", record: {mapping: gameMapping}},
	});
	expect(await api.request("listGameMappings", undefined)).toMatchObject({
		ok: true,
		data: {
			records: [{mapping: gameMapping}],
			settingsRevision: 0,
		},
	});
	expect(
		await api.request("findGameMapping", {categorySlug: "game"}),
	).toMatchObject({
		ok: true,
		data: {record: {mapping: gameMapping}},
	});
	const stale = await api.request("saveGameMapping", {
		mapping: gameMapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	expect(stale).toMatchObject({ok: false, error: {code: "mapping_conflict"}});
	expect(
		await api.request("deleteGameMapping", {
			categorySlug: "game",
			expectedRevision: "wrong",
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "mapping_conflict"}});
});

it("requires a parent Game Mapping and rejects a category from another SRC game", async () => {
	const {api} = setup();
	expect(
		await api.request("saveCategoryMapping", {
			mapping,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "game_mapping_missing"}});
	await api.request("saveGameMapping", {
		mapping: gameMapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	const foreign = structuredClone(mapping);
	foreign.speedrunCom.categoryId = "c2";
	expect(
		await api.request("saveCategoryMapping", {
			mapping: foreign,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "category_not_in_game"}});
	expect(
		await api.request("saveCategoryMapping", {
			mapping,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: true, data: {action: "created"}});
});

async function saveParent(api: ReturnType<typeof setup>["api"]) {
	await api.request("saveGameMapping", {
		mapping: gameMapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
}

it("rejects a category that omits a mandatory Speedrun.com variable", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValueOnce([
		{
			id: "difficulty",
			name: "Difficulty",
			mandatory: true,
			userDefined: false,
			values: [{id: "normal", label: "Normal"}],
		},
	]);
	const bare = structuredClone(mapping);
	bare.speedrunCom.variables = {};
	expect(
		await api.request("saveCategoryMapping", {
			mapping: bare,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "invalid_input"}});
});

it("rejects unknown variable ids and values outside the offered options", async () => {
	const {api} = setup();
	await saveParent(api);
	const unknown = structuredClone(mapping);
	unknown.speedrunCom.variables = {mystery: "x"};
	expect(
		await api.request("saveCategoryMapping", {
			mapping: unknown,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "invalid_input"}});
	const badValue = structuredClone(mapping);
	badValue.speedrunCom.variables = {difficulty: "nightmare"};
	expect(
		await api.request("saveCategoryMapping", {
			mapping: badValue,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "invalid_input"}});
});

it("accepts and length-checks user-defined variables", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([
		{
			id: "runner",
			name: "Runner",
			mandatory: true,
			userDefined: true,
			values: [],
		},
	]);
	const withValue = structuredClone(mapping);
	withValue.speedrunCom.variables = {runner: "Somebody"};
	expect(
		await api.request("saveCategoryMapping", {
			mapping: withValue,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: true, data: {action: "created"}});
	const empty = structuredClone(mapping);
	empty.speedrunCom.variables = {};
	expect(
		await api.request("saveCategoryMapping", {
			mapping: empty,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "invalid_input"}});
	const tooLong = structuredClone(mapping);
	tooLong.speedrunCom.variables = {runner: "x".repeat(256)};
	expect(
		await api.request("saveCategoryMapping", {
			mapping: tooLong,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "invalid_input"}});
});

it("resolves combined game and category information, distinguishing unregistered and inconsistent", async () => {
	const {api} = setup();
	await api.request("saveGameMapping", {
		mapping: gameMapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	expect(
		await api.request("resolveCategoryMapping", {
			categorySlug: "game",
			goal: "Any%",
		}),
	).toEqual({
		ok: true,
		data: {status: "unregistered"},
	});
	await api.request("saveCategoryMapping", {
		mapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	expect(
		await api.request("resolveCategoryMapping", {
			categorySlug: "game",
			goal: "Any%",
		}),
	).toMatchObject({
		ok: true,
		data: {
			status: "resolved",
			mapping: {game: {gameId: "g1"}, category: {categoryId: "c1"}},
		},
	});
});

it("guards child category mappings when changing or deleting the parent game", async () => {
	const {api} = setup();
	const created = await api.request("saveGameMapping", {
		mapping: gameMapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	const revision = (created as {data: {record: {revision: string}}}).data.record
		.revision;
	await api.request("saveCategoryMapping", {
		mapping,
		expectedRevision: null,
		settingsRevision: 0,
	});
	expect(
		await api.request("deleteGameMapping", {
			categorySlug: "game",
			expectedRevision: revision,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "game_mapping_conflict"}});
	const renamed = structuredClone(gameMapping);
	renamed.speedrunCom.gameId = "g2";
	expect(
		await api.request("saveGameMapping", {
			mapping: renamed,
			expectedRevision: revision,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "game_mapping_conflict"}});
	const nameOnly = structuredClone(gameMapping);
	nameOnly.racetime.categoryName = "Renamed";
	expect(
		await api.request("saveGameMapping", {
			mapping: nameOnly,
			expectedRevision: revision,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: true, data: {action: "updated"}});
});

it("validates settings through the API and forwards Speedrun.com discovery operations", async () => {
	const {api, speedrun} = setup();
	expect(
		await api.request("updateSettings", {
			settings: {
				spreadsheetId: "new",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
			},
			expectedRevision: 0,
		}),
	).toMatchObject({ok: true, data: {revision: 1}});
	expect(
		await api.request("searchSpeedrunGames", {query: "mario"}),
	).toMatchObject({
		ok: true,
		data: {games: [{id: "g1"}]},
	});
	expect(
		await api.request("getSpeedrunGameOptions", {gameId: "g1"}),
	).toMatchObject({
		ok: true,
		data: {game: {id: "g1"}, timingMethods: ["realtime"]},
	});
	expect(
		await api.request("getSpeedrunCategoryVariables", {categoryId: "c1"}),
	).toMatchObject({
		ok: true,
		data: {variables: [{id: "difficulty", mandatory: false}]},
	});
	expect(speedrun.searchGames).toHaveBeenCalledWith("mario");
	expect(
		await api.request("updateSettings", {
			settings: {
				spreadsheetId: "new",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
			},
			expectedRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "settings_changed"}});
});
