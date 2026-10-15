import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	SpeedrunVariableOption,
} from "@nanahuse/racetime-protocol";
import {expect, it, vi} from "vitest";
import {createAPI} from "../src/api";
import {IntegrationError} from "../src/errors";
import {SpeedrunError} from "../src/integrations/speedrun/errors";
import {CATEGORY_MAPPING_SHEET_COLUMNS} from "../src/integrations/spreadsheet/category-mappings-row";
import type {SpreadsheetClient} from "../src/integrations/spreadsheet/client";
import {GAME_MAPPING_SHEET_COLUMNS} from "../src/integrations/spreadsheet/game-mappings-row";
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

function setup(
	createSpreadsheetClient: (
		spreadsheetId: string,
	) => SpreadsheetClient = () => {
		throw new Error("spreadsheet client is not available in this test");
	},
) {
	const memory = memoryRepository();
	const persist = vi.fn();
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
				obsoletes: true,
				values: [{id: "normal", label: "Normal"}],
			},
		]),
		getCategoryGameId: vi.fn(async (categoryId: string) =>
			categoryId === "c1" ? "g1" : "other",
		),
	};
	const api = createAPI(
		{} as never,
		service,
		speedrun,
		createSpreadsheetClient,
	);
	return {api, service, speedrun, persist, memory};
}

it("initializes the destination through the API without changing saved settings", async () => {
	const store = new Map<string, string[][]>([
		["GameMappings", [[...GAME_MAPPING_SHEET_COLUMNS]]],
		["CategoryMappings", [[...CATEGORY_MAPPING_SHEET_COLUMNS]]],
	]);
	const client: SpreadsheetClient = {
		readValues: async (range) =>
			structuredClone(
				store.get(/^'([^']+)'/.exec(range)?.[1] ?? range.split("!")[0]!) ?? [],
			),
		updateValues: async () => {},
		appendValues: async () => {},
		listSheets: async () => [...store.keys()],
		createSheet: async (name) => {
			if (!store.has(name)) store.set(name, []);
		},
	};
	const {api, service} = setup(() => client);
	const before = service.settings();
	const result = await api.request("initializeSpreadsheet", {
		settings: {
			spreadsheetId: "sheet",
			gameMappingsSheet: "GameMappings",
			categoryMappingsSheet: "CategoryMappings",
		},
	});
	expect(result).toEqual({
		ok: true,
		data: {gameMappings: "unchanged", categoryMappings: "unchanged"},
	});
	expect(service.settings()).toEqual(before);
	expect(service.settings().revision).toBe(0);
});

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

it("allows an unmapped mandatory variable when it does not obsolete records", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValueOnce([
		{
			id: "difficulty",
			name: "Difficulty",
			mandatory: true,
			userDefined: false,
			obsoletes: false,
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
	).toMatchObject({ok: true, data: {action: "created"}});
});

it("requires an obsoleting variable even when SRC does not mark it mandatory", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValueOnce([
		{
			id: "difficulty",
			name: "Difficulty",
			mandatory: false,
			userDefined: false,
			obsoletes: true,
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
			obsoletes: false,
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
	const second = setup();
	await saveParent(second.api);
	second.speedrun.getCategoryVariables.mockResolvedValue([
		{
			id: "runner",
			name: "Runner",
			mandatory: true,
			userDefined: true,
			obsoletes: false,
			values: [],
		},
	]);
	expect(
		await second.api.request("saveCategoryMapping", {
			mapping: empty,
			expectedRevision: null,
			settingsRevision: 0,
		}),
	).toMatchObject({ok: true, data: {action: "created"}});
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
			mappings: [
				{
					key: expect.any(String),
					label: "Any%",
					game: {gameId: "g1", gameName: "Game"},
					category: {
						categoryId: "c1",
						categoryName: "Any%",
						variables: {difficulty: "normal"},
					},
				},
			],
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
				maxResolvedMappings: 20,
				leaderboardTop: 20,
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
				maxResolvedMappings: 20,
				leaderboardTop: 20,
			},
			expectedRevision: 0,
		}),
	).toMatchObject({ok: false, error: {code: "settings_changed"}});
});

const rulesetVariable: SpeedrunVariableOption = {
	id: "ruleset",
	name: "Ruleset",
	mandatory: false,
	userDefined: false,
	obsoletes: true,
	values: [
		{id: "classic", label: "Classic"},
		{id: "modern", label: "Modern"},
	],
};

const difficultyVariable: SpeedrunVariableOption = {
	id: "difficulty",
	name: "Difficulty",
	mandatory: false,
	userDefined: false,
	obsoletes: true,
	values: [
		{id: "easy", label: "Easy"},
		{id: "normal", label: "Normal"},
		{id: "hard", label: "Hard"},
	],
};

type ResolvedMapping = {
	key: string;
	label: string;
	game: {gameId: string; gameName: string};
	category: {categoryId: string; variables: Record<string, string>};
};

async function saveCategoryVariables(
	api: ReturnType<typeof setup>["api"],
	variables: unknown,
) {
	const stored: CategoryMapping = structuredClone(mapping);
	stored.speedrunCom.variables =
		variables as CategoryMapping["speedrunCom"]["variables"];
	return api.request("saveCategoryMapping", {
		mapping: stored,
		expectedRevision: null,
		settingsRevision: 0,
	});
}

async function resolveMappings(
	api: ReturnType<typeof setup>["api"],
): Promise<ResolvedMapping[]> {
	const result = await api.request("resolveCategoryMapping", {
		categorySlug: "game",
		goal: "Any%",
	});
	expect(result).toMatchObject({ok: true, data: {status: "resolved"}});
	return (result as {ok: true; data: {mappings: ResolvedMapping[]}}).data
		.mappings;
}

it("accepts Any only for eligible variables and rejects malformed objects", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([
		rulesetVariable,
		{
			id: "runner",
			name: "Runner",
			mandatory: false,
			userDefined: true,
			obsoletes: true,
			values: [],
		},
		{
			id: "legacy",
			name: "Legacy",
			mandatory: false,
			userDefined: false,
			obsoletes: false,
			values: [{id: "x", label: "X"}],
		},
		{
			id: "empty",
			name: "Empty",
			mandatory: false,
			userDefined: false,
			obsoletes: false,
			values: [],
		},
	]);
	expect(
		await saveCategoryVariables(api, {
			ruleset: {mode: "any"},
			runner: "Runner Name",
		}),
	).toMatchObject({ok: true, data: {action: "created"}});
	for (const variables of [
		{runner: {mode: "any"}},
		{legacy: {mode: "any"}},
		{empty: {mode: "any"}},
		{ruleset: {mode: "sometimes"}},
		{ruleset: {mode: "any", extra: true}},
	])
		expect(await saveCategoryVariables(api, variables)).toMatchObject({
			ok: false,
			error: {code: "invalid_input"},
		});
});

it("returns one mapping and avoids Speedrun.com when no Any is stored", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	await saveCategoryVariables(api, {difficulty: "normal"});
	speedrun.getCategoryVariables.mockClear();
	const mappings = await resolveMappings(api);
	expect(mappings).toHaveLength(1);
	expect(mappings[0]!.category.variables).toEqual({difficulty: "normal"});
	expect(mappings[0]!.game).toEqual({gameId: "g1", gameName: "Game"});
	expect(speedrun.getCategoryVariables).not.toHaveBeenCalled();
});

it("expands a single Any over every defined value with stable keys and labels", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([rulesetVariable]);
	await saveCategoryVariables(api, {ruleset: {mode: "any"}});
	const first = await resolveMappings(api);
	expect(first).toHaveLength(2);
	expect(first.map((m) => m.category.variables.ruleset)).toEqual([
		"classic",
		"modern",
	]);
	expect(first.map((m) => m.label)).toEqual([
		"Any% (Ruleset: Classic)",
		"Any% (Ruleset: Modern)",
	]);
	expect(new Set(first.map((m) => m.key)).size).toBe(2);
	for (const mappingResult of first)
		expect(typeof mappingResult.category.variables.ruleset).toBe("string");
	const second = await resolveMappings(api);
	expect(second.map((m) => m.key)).toEqual(first.map((m) => m.key));
});

it("expands multiple Any variables as a deterministic cartesian product", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([
		rulesetVariable,
		difficultyVariable,
	]);
	await saveCategoryVariables(api, {
		ruleset: {mode: "any"},
		difficulty: {mode: "any"},
	});
	const mappings = await resolveMappings(api);
	expect(mappings).toHaveLength(6);
	expect(
		new Set(
			mappings.map(
				(m) =>
					`${m.category.variables.ruleset}/${m.category.variables.difficulty}`,
			),
		),
	).toEqual(
		new Set([
			"classic/easy",
			"classic/normal",
			"classic/hard",
			"modern/easy",
			"modern/normal",
			"modern/hard",
		]),
	);
	expect(mappings[0]!.label).toBe("Any% (Difficulty: Easy, Ruleset: Classic)");
});

it("carries fixed variables and other conditions through Any expansion", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([
		rulesetVariable,
		difficultyVariable,
	]);
	await saveCategoryVariables(api, {
		ruleset: {mode: "any"},
		difficulty: "normal",
	});
	const mappings = await resolveMappings(api);
	expect(mappings).toHaveLength(2);
	for (const mappingResult of mappings) {
		expect(mappingResult.category.variables.difficulty).toBe("normal");
		expect(mappingResult.category.categoryId).toBe("c1");
	}
	expect(mappings.map((m) => m.category.variables.ruleset)).toEqual([
		"classic",
		"modern",
	]);
});

it("leaves unspecified variables out while expanding Any", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([
		rulesetVariable,
		{
			id: "storage",
			name: "Storage",
			mandatory: false,
			userDefined: false,
			obsoletes: false,
			values: [{id: "cart", label: "Cartridge"}],
		},
	]);
	await saveCategoryVariables(api, {ruleset: {mode: "any"}});
	const mappings = await resolveMappings(api);
	expect(mappings).toHaveLength(2);
	expect(mappings.every((m) => !("storage" in m.category.variables))).toBe(
		true,
	);
});

it("reflects changed Speedrun.com choices in the expansion", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([rulesetVariable]);
	await saveCategoryVariables(api, {ruleset: {mode: "any"}});
	expect(await resolveMappings(api)).toHaveLength(2);
	speedrun.getCategoryVariables.mockResolvedValue([
		{
			...rulesetVariable,
			values: [...rulesetVariable.values, {id: "future", label: "Future"}],
		},
	]);
	expect(await resolveMappings(api)).toHaveLength(3);
});

it("reports inconsistent when a stored Any no longer matches the SRC definitions", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([rulesetVariable]);
	await saveCategoryVariables(api, {ruleset: {mode: "any"}});
	speedrun.getCategoryVariables.mockResolvedValue([
		{...rulesetVariable, obsoletes: false},
	]);
	expect(
		await api.request("resolveCategoryMapping", {
			categorySlug: "game",
			goal: "Any%",
		}),
	).toMatchObject({ok: true, data: {status: "inconsistent"}});
	speedrun.getCategoryVariables.mockResolvedValue([]);
	expect(
		await api.request("resolveCategoryMapping", {
			categorySlug: "game",
			goal: "Any%",
		}),
	).toMatchObject({ok: true, data: {status: "inconsistent"}});
});

it("does not return a partial success when Speedrun.com fails during expansion", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([rulesetVariable]);
	await saveCategoryVariables(api, {ruleset: {mode: "any"}});
	speedrun.getCategoryVariables.mockRejectedValueOnce(
		new SpeedrunError("speedrun_unavailable", "down"),
	);
	expect(
		await api.request("resolveCategoryMapping", {
			categorySlug: "game",
			goal: "Any%",
		}),
	).toMatchObject({ok: false, error: {code: "speedrun_unavailable"}});
});

function manyValues(id: string, count: number): SpeedrunVariableOption {
	return {
		id,
		name: id,
		mandatory: false,
		userDefined: false,
		obsoletes: true,
		values: Array.from({length: count}, (_, index) => ({
			id: `${id}-${index}`,
			label: `${id} ${index}`,
		})),
	};
}

it("caps one Any at the default limit of 20 and returns no partial result", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([manyValues("ruleset", 20)]);
	await saveCategoryVariables(api, {ruleset: {mode: "any"}});
	expect(await resolveMappings(api)).toHaveLength(20);

	speedrun.getCategoryVariables.mockResolvedValue([manyValues("ruleset", 21)]);
	const over = await api.request("resolveCategoryMapping", {
		categorySlug: "game",
		goal: "Any%",
	});
	expect(over).toMatchObject({
		ok: false,
		error: {code: "expansion_limit_exceeded"},
	});
	expect(over).not.toHaveProperty("data");
	expect((over as {error: {message: string}}).error.message).toContain("21");
	expect((over as {error: {message: string}}).error.message).toContain("20");
});

it("honors a configured expansion limit from Settings", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([manyValues("ruleset", 21)]);
	await saveCategoryVariables(api, {ruleset: {mode: "any"}});
	expect(
		await api.request("resolveCategoryMapping", {
			categorySlug: "game",
			goal: "Any%",
		}),
	).toMatchObject({ok: false, error: {code: "expansion_limit_exceeded"}});
	expect(
		await api.request("updateSettings", {
			settings: {
				spreadsheetId: "sheet",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 30,
				leaderboardTop: 20,
			},
			expectedRevision: 0,
		}),
	).toMatchObject({ok: true, data: {revision: 1}});
	expect(await resolveMappings(api)).toHaveLength(21);
});

it("rejects an extreme cartesian product before materializing it", async () => {
	const {api, speedrun} = setup();
	await saveParent(api);
	speedrun.getCategoryVariables.mockResolvedValue([
		manyValues("a", 1000),
		manyValues("b", 1000),
		manyValues("c", 1000),
	]);
	await saveCategoryVariables(api, {
		a: {mode: "any"},
		b: {mode: "any"},
		c: {mode: "any"},
	});
	expect(
		await api.request("resolveCategoryMapping", {
			categorySlug: "game",
			goal: "Any%",
		}),
	).toMatchObject({ok: false, error: {code: "expansion_limit_exceeded"}});
});

it("rejects invalid expansion limits through the API", async () => {
	const {api} = setup();
	for (const maxResolvedMappings of [
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		"20",
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		expect(
			await api.request("updateSettings", {
				settings: {
					spreadsheetId: "sheet",
					gameMappingsSheet: "GameMappings",
					categoryMappingsSheet: "CategoryMappings",
					maxResolvedMappings,
				} as never,
				expectedRevision: 0,
			}),
		).toMatchObject({ok: false, error: {code: "invalid_input"}});
	}
});
