import {expect, it} from "vitest";
import {
	CATEGORY_MAPPING_SHEET_COLUMNS,
	categoryMappingToSheetRow,
} from "../src/integrations/spreadsheet/category-mappings-row";
import type {SpreadsheetClient} from "../src/integrations/spreadsheet/client";
import {SpreadsheetClientError} from "../src/integrations/spreadsheet/errors";
import {
	GAME_MAPPING_SHEET_COLUMNS,
	gameMappingToSheetRow,
} from "../src/integrations/spreadsheet/game-mappings-row";
import {initializeSpreadsheet} from "../src/integrations/spreadsheet/initialize";
import {gameMapping, mapping} from "./fixtures";

type Store = Map<string, string[][]>;

type Hooks = {
	failList?: boolean;
	failCreate?: string | null;
	failWrite?: string | null;
};

function sheetOf(range: string): string {
	const match = /^'((?:[^']|'')*)'/.exec(range);
	return match ? match[1]!.replace(/''/g, "'") : range.split("!")[0]!;
}

function fakeClient(
	store: Store,
	hooks: Hooks = {},
	formulas: Store = new Map(),
) {
	const formulaRanges: string[] = [];
	const client: SpreadsheetClient = {
		async readValues(range, readOptions) {
			if (readOptions?.valueRenderOption === "FORMULA") {
				formulaRanges.push(range);
				return structuredClone(formulas.get(sheetOf(range)) ?? []);
			}
			return structuredClone(store.get(sheetOf(range)) ?? []);
		},
		async updateValues(updates) {
			for (const update of updates) {
				const name = sheetOf(update.range);
				if (hooks.failWrite === name)
					throw new SpreadsheetClientError("write failed");
				const match = /!([A-Z]+)(\d+)$/.exec(update.range)!;
				const startColumn =
					[...match[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
				const sheet = store.get(name) ?? [];
				while (sheet.length < Number(match[2])) sheet.push([]);
				const row = sheet[Number(match[2]) - 1]!;
				update.values[0]!.forEach((cell, offset) => {
					row[startColumn + offset] = cell;
				});
				store.set(name, sheet);
			}
		},
		async appendValues(range, rows) {
			const name = sheetOf(range);
			const sheet = store.get(name) ?? [];
			sheet.push(...rows.map((row) => [...row]));
			store.set(name, sheet);
		},
		async listSheets() {
			if (hooks.failList) throw new SpreadsheetClientError("list failed");
			return [...store.keys()];
		},
		async createSheet(sheetName) {
			if (hooks.failCreate === sheetName)
				throw new SpreadsheetClientError("create failed");
			if (!store.has(sheetName)) store.set(sheetName, []);
		},
	};
	return {client, hooks, formulaRanges};
}

const options = {
	gameMappingsSheet: "GameMappings",
	categoryMappingsSheet: "CategoryMappings",
};

function gameHeader(): string[] {
	return [...GAME_MAPPING_SHEET_COLUMNS];
}

function gameRow(): string[] {
	const row = gameMappingToSheetRow(gameMapping, "");
	return GAME_MAPPING_SHEET_COLUMNS.map((column) => row[column]);
}

function categoryHeader(): string[] {
	return [...CATEGORY_MAPPING_SHEET_COLUMNS];
}

it("creates both worksheets with their shared headers when missing", async () => {
	const store: Store = new Map();
	const {client} = fakeClient(store);
	expect(await initializeSpreadsheet(client, options)).toEqual({
		gameMappings: "created",
		categoryMappings: "created",
	});
	expect(store.get("GameMappings")).toEqual([gameHeader()]);
	expect(store.get("CategoryMappings")).toEqual([categoryHeader()]);
});

it("creates only the missing worksheet and leaves the valid one untouched", async () => {
	const store: Store = new Map();
	store.set("GameMappings", [gameHeader(), gameRow()]);
	const before = structuredClone(store.get("GameMappings"));
	const {client} = fakeClient(store);
	expect(await initializeSpreadsheet(client, options)).toEqual({
		gameMappings: "unchanged",
		categoryMappings: "created",
	});
	expect(store.get("GameMappings")).toEqual(before);
});

it("writes headers into blank worksheets", async () => {
	const store: Store = new Map();
	store.set("GameMappings", []);
	store.set("CategoryMappings", [[]]);
	const {client} = fakeClient(store);
	expect(await initializeSpreadsheet(client, options)).toEqual({
		gameMappings: "initialized",
		categoryMappings: "initialized",
	});
	expect(store.get("GameMappings")![0]).toEqual(gameHeader());
	expect(store.get("CategoryMappings")![0]).toEqual(categoryHeader());
});

it("preserves valid data, extra columns and reordered headers", async () => {
	const store: Store = new Map();
	store.set("GameMappings", [gameHeader(), gameRow()]);
	const header = ["notes", ...[...CATEGORY_MAPPING_SHEET_COLUMNS].reverse()];
	const row = categoryMappingToSheetRow(mapping, "old");
	store.set("CategoryMappings", [
		header,
		header.map((key) =>
			key === "notes" ? "=SUM(A1:A2)" : row[key as keyof typeof row],
		),
	]);
	const before = structuredClone([...store.entries()]);
	const {client} = fakeClient(store);
	expect(await initializeSpreadsheet(client, options)).toEqual({
		gameMappings: "unchanged",
		categoryMappings: "unchanged",
	});
	expect([...store.entries()]).toEqual(before);
});

it("does not touch either worksheet when one has invalid data", async () => {
	const store: Store = new Map();
	store.set("GameMappings", [["wrong", "header"]]);
	const {client} = fakeClient(store);
	await expect(initializeSpreadsheet(client, options)).rejects.toMatchObject({
		name: "SheetValidationError",
	});
	expect(store.get("GameMappings")).toEqual([["wrong", "header"]]);
	expect(store.has("CategoryMappings")).toBe(false);
});

it("refuses to overwrite a blank header row that sits above data", async () => {
	const store: Store = new Map();
	store.set("GameMappings", [[], gameRow()]);
	const {client} = fakeClient(store);
	await expect(initializeSpreadsheet(client, options)).rejects.toMatchObject({
		name: "SheetValidationError",
	});
	expect(store.get("GameMappings")).toEqual([[], gameRow()]);
});

it("is idempotent when run twice on a prepared spreadsheet", async () => {
	const store: Store = new Map();
	const {client} = fakeClient(store);
	await initializeSpreadsheet(client, options);
	const snapshot = structuredClone([...store.entries()]);
	expect(await initializeSpreadsheet(client, options)).toEqual({
		gameMappings: "unchanged",
		categoryMappings: "unchanged",
	});
	expect([...store.entries()]).toEqual(snapshot);
});

it("completes the remaining work when re-run after a partial failure", async () => {
	const store: Store = new Map();
	const {client, hooks} = fakeClient(store, {failCreate: "CategoryMappings"});
	await expect(initializeSpreadsheet(client, options)).rejects.toMatchObject({
		name: "SpreadsheetClientError",
	});
	expect(store.get("GameMappings")).toEqual([gameHeader()]);
	expect(store.has("CategoryMappings")).toBe(false);
	hooks.failCreate = null;
	expect(await initializeSpreadsheet(client, options)).toEqual({
		gameMappings: "unchanged",
		categoryMappings: "created",
	});
	expect(store.get("CategoryMappings")).toEqual([categoryHeader()]);
});

it("propagates access failures as spreadsheet errors", async () => {
	const store: Store = new Map();
	const {client} = fakeClient(store, {failList: true});
	await expect(initializeSpreadsheet(client, options)).rejects.toMatchObject({
		name: "SpreadsheetClientError",
	});
});

it("rejects identical sheet names before touching the spreadsheet", async () => {
	const store: Store = new Map();
	const {client} = fakeClient(store);
	await expect(
		initializeSpreadsheet(client, {
			gameMappingsSheet: "Same",
			categoryMappingsSheet: "Same",
		}),
	).rejects.toMatchObject({code: "invalid_input"});
	expect(store.size).toBe(0);
});

it("refuses to initialize a worksheet whose formulas evaluate to empty", async () => {
	const store: Store = new Map();
	store.set("GameMappings", []);
	store.set("CategoryMappings", [categoryHeader()]);
	const formulas: Store = new Map([
		["GameMappings", [['=IF(FALSE,"data","")']]],
	]);
	const {client} = fakeClient(store, {}, formulas);
	await expect(initializeSpreadsheet(client, options)).rejects.toMatchObject({
		name: "SheetValidationError",
	});
	expect(store.get("GameMappings")).toEqual([]);
	expect(store.get("CategoryMappings")).toEqual([categoryHeader()]);
});

it("detects content beyond the A1:ZZ read using the whole-sheet FORMULA range", async () => {
	const store: Store = new Map();
	store.set("GameMappings", []);
	store.set("CategoryMappings", [categoryHeader()]);
	const formulas: Store = new Map([["GameMappings", [["far right"]]]]);
	const {client, formulaRanges} = fakeClient(store, {}, formulas);
	await expect(initializeSpreadsheet(client, options)).rejects.toMatchObject({
		name: "SheetValidationError",
	});
	expect(formulaRanges).toContain("'GameMappings'");
	expect(formulaRanges.some((range) => range.includes("A1:ZZ"))).toBe(false);
});

it("protects whitespace-only cells without trimming", async () => {
	const store: Store = new Map();
	store.set("GameMappings", []);
	store.set("CategoryMappings", [categoryHeader()]);
	const formulas: Store = new Map([["GameMappings", [["   "]]]]);
	const {client} = fakeClient(store, {}, formulas);
	await expect(initializeSpreadsheet(client, options)).rejects.toMatchObject({
		name: "SheetValidationError",
	});
	expect(store.get("GameMappings")).toEqual([]);
});

it("does not re-read formulas for worksheets that already match the format", async () => {
	const store: Store = new Map();
	store.set("GameMappings", [gameHeader(), gameRow()]);
	store.set("CategoryMappings", [categoryHeader()]);
	const {client, formulaRanges} = fakeClient(store);
	expect(await initializeSpreadsheet(client, options)).toEqual({
		gameMappings: "unchanged",
		categoryMappings: "unchanged",
	});
	expect(formulaRanges).toEqual([]);
});
