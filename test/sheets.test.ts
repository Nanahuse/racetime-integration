import {expect, it, vi} from "vitest";
import {SpreadsheetCategoryMappingsRepository} from "../src/integrations/spreadsheet/category-mappings-repository";
import {
	CATEGORY_MAPPING_SHEET_COLUMNS,
	categoryMappingToSheetRow,
} from "../src/integrations/spreadsheet/category-mappings-row";
import type {SpreadsheetValues} from "../src/integrations/spreadsheet/client";
import {SpreadsheetGameMappingsRepository} from "../src/integrations/spreadsheet/game-mappings-repository";
import {GAME_MAPPING_SHEET_COLUMNS} from "../src/integrations/spreadsheet/game-mappings-row";
import {GoogleSheetsClient} from "../src/integrations/spreadsheet/google-sheets-client";
import {MappingService, type MappingsRepository} from "../src/mappings";
import {gameMapping, mapping} from "./fixtures";

type Store = Map<string, string[][]>;

function sheetOf(range: string): string {
	const match = /^'((?:[^']|'')*)'/.exec(range);
	return match ? match[1]!.replace(/''/g, "'") : range.split("!")[0]!;
}

function makeClient(store: Store) {
	return {
		readValues: vi.fn(
			async (range: string): Promise<SpreadsheetValues> =>
				structuredClone(store.get(sheetOf(range)) ?? []),
		),
		updateValues: vi.fn(
			async (
				updates: readonly {range: string; values: string[][]}[],
			): Promise<void> => {
				for (const update of updates) {
					const name = sheetOf(update.range);
					const match = /!([A-Z]+)(\d+)$/.exec(update.range)!;
					const startColumn =
						[...match[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) -
						1;
					const sheet = store.get(name) ?? [];
					while (sheet.length < Number(match[2])) sheet.push([]);
					const row = sheet[Number(match[2]) - 1]!;
					update.values[0]!.forEach((cell, offset) => {
						row[startColumn + offset] = cell;
					});
					store.set(name, sheet);
				}
			},
		),
		appendValues: vi.fn(
			async (
				range: string,
				rows: readonly (readonly string[])[],
			): Promise<void> => {
				const name = sheetOf(range);
				const sheet = store.get(name) ?? [];
				sheet.push(...rows.map((row) => [...row]));
				store.set(name, sheet);
			},
		),
		listSheets: vi.fn(async () => [...store.keys()]),
		createSheet: vi.fn(async (name: string) => {
			if (!store.has(name)) store.set(name, []);
		}),
	};
}

let tick = 0;
function categoryRepository(
	store: Store,
	header: readonly string[] = CATEGORY_MAPPING_SHEET_COLUMNS,
) {
	store.set("Category'Mappings", [[...header]]);
	const client = makeClient(store);
	return {
		client,
		repository: new SpreadsheetCategoryMappingsRepository(client, {
			sheetName: "Category'Mappings",
			now: () => new Date(1791676800000 + tick++),
		}),
	};
}

function gameRepository(store: Store) {
	store.set("GameMappings", [[...GAME_MAPPING_SHEET_COLUMNS]]);
	const client = makeClient(store);
	return {
		client,
		repository: new SpreadsheetGameMappingsRepository(client, {
			sheetName: "GameMappings",
			now: () => new Date(1791676800000 + tick++),
		}),
	};
}

function categoryRow(): string[] {
	const row = categoryMappingToSheetRow(mapping, "");
	return CATEGORY_MAPPING_SHEET_COLUMNS.map((column) => row[column]);
}

it("reads and lists existing category mappings with reordered columns, blanks and optional fields", async () => {
	const store: Store = new Map();
	const header = [...CATEGORY_MAPPING_SHEET_COLUMNS].reverse();
	const {repository, client} = categoryRepository(store, header);
	store.get("Category'Mappings")!.push(
		[],
		header.map(
			(key) =>
				categoryMappingToSheetRow(mapping, "")[
					key as keyof ReturnType<typeof categoryMappingToSheetRow>
				],
		),
	);
	expect(await repository.find(" game ", "Any%")).toMatchObject({
		mapping,
		revision: expect.any(String),
	});
	expect(await repository.list()).toEqual([
		await repository.find("game", "Any%"),
	]);
	expect(await repository.find("game", "other")).toBeNull();
	expect(client.readValues).toHaveBeenCalledWith("'Category''Mappings'!A1:ZZ");
});

it("distinguishes create and update and rejects stale edits, duplicate creates and missing updates", async () => {
	const store: Store = new Map();
	const {repository, client} = categoryRepository(store);
	const created = await repository.save(mapping, null);
	expect(created.action).toBe("created");
	const changed = structuredClone(mapping);
	changed.speedrunCom.categoryName = "Changed";
	const updated = await repository.save(changed, created.record.revision);
	expect(updated.action).toBe("updated");
	expect(updated.record.revision).not.toBe(created.record.revision);
	await expect(
		repository.save(mapping, created.record.revision),
	).rejects.toMatchObject({code: "mapping_conflict"});
	await expect(repository.save(mapping, null)).rejects.toMatchObject({
		code: "mapping_conflict",
	});
	expect(client.updateValues).toHaveBeenCalledTimes(1);
	expect(client.appendValues).toHaveBeenCalledTimes(1);
	await repository.delete("game", "Any%", updated.record.revision);
	await expect(
		repository.save(mapping, updated.record.revision),
	).rejects.toMatchObject({code: "mapping_conflict"});
});

it("round-trips Any and concrete variable selections through src_variables", async () => {
	const store: Store = new Map();
	const {repository} = categoryRepository(store);
	const withAny = structuredClone(mapping);
	withAny.speedrunCom.variables = {
		ruleset: {mode: "any"},
		difficulty: "normal",
	};
	const created = await repository.save(withAny, null);
	expect(
		store.get("Category'Mappings")![1]![
			CATEGORY_MAPPING_SHEET_COLUMNS.indexOf("src_variables")
		],
	).toBe('{"ruleset":{"mode":"any"},"difficulty":"normal"}');
	expect((await repository.find("game", "Any%"))!.mapping).toEqual(withAny);
	const updated = structuredClone(withAny);
	updated.speedrunCom.variables = {ruleset: "classic"};
	const saved = await repository.save(updated, created.record.revision);
	expect((await repository.find("game", "Any%"))!.mapping).toEqual(updated);
	expect(saved.record.revision).not.toBe(created.record.revision);
});

it("updates and deletes only owned cells while retaining unknown columns and formulas", async () => {
	const store: Store = new Map();
	const header = ["notes", ...[...CATEGORY_MAPPING_SHEET_COLUMNS].reverse()];
	const {repository, client} = categoryRepository(store, header);
	const row = categoryMappingToSheetRow(mapping, "old");
	store
		.get("Category'Mappings")!
		.push(
			header.map((key) =>
				key === "notes" ? "=SUM(Z1:Z2)" : row[key as keyof typeof row],
			),
		);
	const record = (await repository.find("game", "Any%"))!;
	const saved = await repository.save(mapping, record.revision);
	expect(
		client.updateValues.mock.calls[0]![0].some((u) => u.range.endsWith("!A2")),
	).toBe(false);
	await expect(
		repository.delete("game", "Any%", record.revision),
	).rejects.toMatchObject({code: "mapping_conflict"});
	await repository.delete("game", "Any%", saved.record.revision);
	expect(store.get("Category'Mappings")![1]![0]).toBe("=SUM(Z1:Z2)");
	expect(
		store
			.get("Category'Mappings")![1]!
			.slice(1)
			.every((cell) => cell === ""),
	).toBe(true);
	expect(await repository.list()).toEqual([]);
});

it("serializes concurrent category creates so one wins and the other reports conflict", async () => {
	const store: Store = new Map();
	const {repository, client} = categoryRepository(store);
	const results = await Promise.allSettled([
		repository.save(mapping, null),
		repository.save(mapping, null),
	]);
	expect(results.map((result) => result.status)).toEqual([
		"fulfilled",
		"rejected",
	]);
	expect(client.appendValues).toHaveBeenCalledOnce();
});

it("rejects duplicate keys/headers, missing headers and malformed category cells before mutation", async () => {
	for (const kind of [
		"key",
		"header",
		"missing",
		"json",
		"boolean",
		"timing",
		"anyObject",
	]) {
		const store: Store = new Map();
		const {repository, client} = categoryRepository(store);
		const row = categoryRow();
		store.get("Category'Mappings")!.push(row);
		if (kind === "key") store.get("Category'Mappings")!.push([...row]);
		if (kind === "header")
			store.get("Category'Mappings")![0]!.push("src_category_id");
		if (kind === "missing") store.get("Category'Mappings")![0]![0] = "wrong";
		if (kind === "json")
			row[CATEGORY_MAPPING_SHEET_COLUMNS.indexOf("src_variables")] =
				'{"difficulty":1}';
		if (kind === "anyObject")
			row[CATEGORY_MAPPING_SHEET_COLUMNS.indexOf("src_variables")] =
				'{"difficulty":{"mode":"other"}}';
		if (kind === "boolean")
			row[CATEGORY_MAPPING_SHEET_COLUMNS.indexOf("src_emulator")] = "maybe";
		if (kind === "timing")
			row[CATEGORY_MAPPING_SHEET_COLUMNS.indexOf("src_timing_method")] =
				"unknown";
		await expect(repository.save(mapping, null)).rejects.toMatchObject({
			name: "SheetValidationError",
		});
		expect(client.updateValues).not.toHaveBeenCalled();
		expect(client.appendValues).not.toHaveBeenCalled();
	}
});

it("recovers the category write queue after a failed read", async () => {
	const store: Store = new Map();
	const {repository, client} = categoryRepository(store);
	client.readValues.mockRejectedValueOnce(new Error("offline"));
	await expect(repository.save(mapping, null)).rejects.toThrow("offline");
	await repository.save(mapping, null);
	expect(client.appendValues).toHaveBeenCalledOnce();
});

it("keeps game mappings unique by RaceTime slug and manages create/update/delete", async () => {
	const store: Store = new Map();
	const {repository, client} = gameRepository(store);
	const created = await repository.save(gameMapping, null);
	expect(created.action).toBe("created");
	const changed = structuredClone(gameMapping);
	changed.speedrunCom.gameName = "Renamed";
	const updated = await repository.save(changed, created.record.revision);
	expect(updated.action).toBe("updated");
	await expect(repository.save(gameMapping, null)).rejects.toMatchObject({
		code: "mapping_conflict",
	});
	expect((await repository.find(" game ", "g1"))!.mapping).toEqual(changed);
	expect(await repository.list()).toHaveLength(1);
	await repository.delete("game", "g1", updated.record.revision);
	expect(await repository.list()).toEqual([]);
	expect(client.appendValues).toHaveBeenCalledOnce();
});

it("uses RAW and disables write retries at the Google boundary", async () => {
	const api = {
		values: {
			get: vi.fn().mockResolvedValue({data: {values: [[1, false, null]]}}),
			batchUpdate: vi.fn().mockResolvedValue({}),
			append: vi.fn().mockResolvedValue({}),
		},
		get: vi.fn().mockResolvedValue({
			data: {
				sheets: [
					{properties: {title: "GameMappings"}},
					{properties: {title: "CategoryMappings"}},
				],
			},
		}),
		batchUpdate: vi.fn().mockResolvedValue({}),
	};
	const client = new GoogleSheetsClient(
		api as unknown as ConstructorParameters<typeof GoogleSheetsClient>[0],
		"sheet-id",
	);
	expect(await client.readValues("range")).toEqual([["1", "false", ""]]);
	expect(api.values.get.mock.calls[0]![0]).not.toHaveProperty(
		"valueRenderOption",
	);
	await client.readValues("range", {valueRenderOption: "FORMULA"});
	expect(api.values.get).toHaveBeenLastCalledWith(
		expect.objectContaining({valueRenderOption: "FORMULA"}),
	);
	await client.updateValues([{range: "A2", values: [["=unsafe"]]}]);
	expect(api.values.batchUpdate).toHaveBeenCalledWith(
		{
			spreadsheetId: "sheet-id",
			requestBody: {
				valueInputOption: "RAW",
				data: [{range: "A2", values: [["=unsafe"]]}],
			},
		},
		{retry: false},
	);
	await client.appendValues("A1", [["value"]]);
	expect(api.values.append).toHaveBeenCalledWith(
		expect.objectContaining({
			valueInputOption: "RAW",
			insertDataOption: "INSERT_ROWS",
		}),
		{retry: false},
	);
	expect(await client.listSheets()).toEqual([
		"GameMappings",
		"CategoryMappings",
	]);
	expect(api.get).toHaveBeenCalledWith({
		spreadsheetId: "sheet-id",
		fields: "sheets.properties.title",
	});
	await client.createSheet("NewSheet");
	expect(api.batchUpdate).toHaveBeenCalledWith(
		{
			spreadsheetId: "sheet-id",
			requestBody: {
				requests: [{addSheet: {properties: {title: "NewSheet"}}}],
			},
		},
		{retry: false},
	);
	api.values.get.mockRejectedValueOnce(new Error("credentials"));
	await expect(client.readValues("range")).rejects.toMatchObject({
		name: "SpreadsheetClientError",
	});
});

it("requires a parent Game Mapping before saving a category and defends children", async () => {
	const store: Store = new Map();
	const games = gameRepository(store);
	const categories = categoryRepository(store);
	const bundle: MappingsRepository = {
		games: games.repository,
		categories: categories.repository,
	};
	const persist = vi.fn();
	const service = new MappingService(
		{
			revision: 0,
			settings: {
				spreadsheetId: "sheet",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "Category'Mappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
		persist,
		() => bundle,
	);

	await expect(service.saveCategory(mapping, null, 0)).rejects.toMatchObject({
		code: "game_mapping_missing",
	});
	await service.saveGame(gameMapping, null, 0);
	await service.saveCategory(mapping, null, 0);
	await expect(
		service.deleteGame(
			"game",
			"g1",
			(await service.findGame("game", "g1")).record!.revision,
			0,
		),
	).rejects.toMatchObject({code: "game_mapping_conflict"});
	const changedGame = structuredClone(gameMapping);
	changedGame.speedrunCom.gameId = "g2";
	await expect(
		service.saveGame(
			changedGame,
			(await service.findGame("game", "g1")).record!.revision,
			0,
		),
	).rejects.toMatchObject({code: "mapping_conflict"});
	await expect(service.resolveSource("game", "Any%")).resolves.toMatchObject({
		status: "found",
		game: {gameId: "g1"},
		category: {categoryId: "c1"},
	});
	await expect(service.resolveSource("game", "No%")).resolves.toEqual({
		status: "unregistered",
	});
});

it("validates both sheets before committing settings and rejects stale writes", async () => {
	const a: Store = new Map();
	const b: Store = new Map();
	const aGames = gameRepository(a);
	const aCategories = categoryRepository(a);
	const bGames = gameRepository(b);
	const bCategories = categoryRepository(b);
	const repositories: Record<string, MappingsRepository> = {
		a: {games: aGames.repository, categories: aCategories.repository},
		b: {games: bGames.repository, categories: bCategories.repository},
	};
	const persist = vi.fn();
	const service = new MappingService(
		{
			revision: 0,
			settings: {
				spreadsheetId: "a",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "Category'Mappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
		persist,
		(settings) => repositories[settings.spreadsheetId ?? ""] ?? null,
	);
	const createdGame = await service.saveGame(gameMapping, null, 0);
	bCategories.client.readValues.mockRejectedValueOnce(new Error("no access"));
	await expect(
		service.update(
			{
				spreadsheetId: "b",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "Category'Mappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
			0,
		),
	).rejects.toThrow("no access");
	expect(service.settings().settings.spreadsheetId).toBe("a");
	expect(persist).not.toHaveBeenCalled();
	await service.update(
		{
			spreadsheetId: "b",
			gameMappingsSheet: "GameMappings",
			categoryMappingsSheet: "Category'Mappings",
			maxResolvedMappings: 20,
			allowedRaceOrigins: ["https://racetime.gg"],
			leaderboardTop: 20,
		},
		0,
	);
	expect(persist).toHaveBeenCalledWith({
		revision: 1,
		settings: {
			spreadsheetId: "b",
			gameMappingsSheet: "GameMappings",
			categoryMappingsSheet: "Category'Mappings",
			maxResolvedMappings: 20,
			allowedRaceOrigins: ["https://racetime.gg"],
			leaderboardTop: 20,
		},
	});
	await expect(
		service.saveGame(gameMapping, createdGame.record.revision, 0),
	).rejects.toMatchObject({code: "settings_changed"});
	await expect(service.listCategories()).resolves.toMatchObject({
		records: [],
		settingsRevision: 1,
	});
});

it("round-trips multiple games per RaceTime slug and revisions per composite key", async () => {
	const store: Store = new Map();
	const {repository} = gameRepository(store);
	const first = await repository.save(gameMapping, null);
	const secondMapping = {
		...gameMapping,
		speedrunCom: {gameId: "g2", gameName: "Same display name"},
	};
	const second = await repository.save(secondMapping, null);
	await repository.save(
		{...gameMapping, racetime: {categorySlug: "other", categoryName: "Other"}},
		null,
	);
	expect(await repository.list()).toHaveLength(3);
	await expect(
		repository.save(
			{
				...secondMapping,
				speedrunCom: {...secondMapping.speedrunCom, gameName: "Renamed"},
			},
			null,
		),
	).rejects.toMatchObject({code: "mapping_conflict"});
	await repository.save(
		{
			...secondMapping,
			speedrunCom: {...secondMapping.speedrunCom, gameName: "Renamed"},
		},
		second.record.revision,
	);
	await expect(
		repository.delete("game", "g2", second.record.revision),
	).rejects.toMatchObject({code: "mapping_conflict"});
	expect((await repository.find("game", "g1"))?.revision).toBe(
		first.record.revision,
	);
	await repository.delete("game", "g1", first.record.revision);
	expect(await repository.find("game", "g1")).toBeNull();
	expect(
		(await repository.find("game", "g2"))?.mapping.speedrunCom.gameName,
	).toBe("Renamed");
});
it("rejects old CategoryMappings headers and blank game IDs without writing", async () => {
	for (const oldHeader of [true, false]) {
		const store: Store = new Map();
		const {repository, client} = categoryRepository(store);
		const header = store.get("Category'Mappings")![0]!;
		const row = categoryRow();
		if (oldHeader) {
			const index = header.indexOf("src_game_id");
			header.splice(index, 1);
			row.splice(index, 1);
		} else row[header.indexOf("src_game_id")] = "";
		store.get("Category'Mappings")!.push(row);
		await expect(repository.list()).rejects.toMatchObject({
			name: "SheetValidationError",
		});
		await expect(repository.save(mapping, null)).rejects.toMatchObject({
			name: "SheetValidationError",
		});
		expect(client.updateValues).not.toHaveBeenCalled();
		expect(client.appendValues).not.toHaveBeenCalled();
	}
});
