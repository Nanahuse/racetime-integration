// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import {IntegrationError} from "../../errors";
import {
	CATEGORY_MAPPING_ROW_ISSUE_CODES,
	CATEGORY_MAPPING_SHEET_COLUMNS,
	categoryMappingSheetRowToMapping,
} from "./category-mappings-row";
import {
	quoteSheetName,
	type SpreadsheetClient,
	type SpreadsheetValues,
	sheetReadRange,
} from "./client";
import {type SheetIssue, SheetValidationError} from "./errors";
import {
	GAME_MAPPING_ROW_ISSUE_CODES,
	GAME_MAPPING_SHEET_COLUMNS,
	gameMappingSheetRowToMapping,
} from "./game-mappings-row";
import {parseSheetValues, type SheetParseStatus} from "./sheet-parse";

export type SheetInitializationOutcome =
	| "created"
	| "initialized"
	| "unchanged";

export type SpreadsheetInitializationResult = {
	gameMappings: SheetInitializationOutcome;
	categoryMappings: SheetInitializationOutcome;
};

export type InitializeSpreadsheetOptions = {
	gameMappingsSheet: string;
	categoryMappingsSheet: string;
};

type Inspection = {
	exists: boolean;
	status: "missing" | SheetParseStatus;
	issues: SheetIssue[];
};

/** Any non-empty cell, judged without trimming so whitespace is protected. */
function hasContent(values: SpreadsheetValues): boolean {
	return values.some((row) => row.some((cell) => cell !== ""));
}

function occupiedIssue(sheetName: string): SheetIssue {
	return {
		code: "sheet_occupied",
		message: `Sheet "${sheetName}" already contains content and was not initialized.`,
		row: null,
	};
}

function inspectGameMappings(values: SpreadsheetValues): {
	status: SheetParseStatus;
	issues: SheetIssue[];
} {
	const result = parseSheetValues(values, {
		columns: GAME_MAPPING_SHEET_COLUMNS,
		convert: (row) => {
			const conversion = gameMappingSheetRowToMapping(row);
			return conversion.ok
				? {ok: true as const, value: conversion.mapping}
				: conversion;
		},
		key: (mapping) =>
			JSON.stringify([
				mapping.racetime.categorySlug.trim(),
				mapping.speedrunCom.gameId.trim(),
			]),
		duplicateCode: GAME_MAPPING_ROW_ISSUE_CODES.duplicateKey,
		duplicateMessage: (mapping, previousRow) =>
			`Duplicate game mapping key "${mapping.racetime.categorySlug}" + "${mapping.speedrunCom.gameId}" (also on row ${previousRow}).`,
	});
	return {status: result.status, issues: result.issues};
}

function inspectCategoryMappings(values: SpreadsheetValues): {
	status: SheetParseStatus;
	issues: SheetIssue[];
} {
	const result = parseSheetValues(values, {
		columns: CATEGORY_MAPPING_SHEET_COLUMNS,
		convert: (row) => {
			const conversion = categoryMappingSheetRowToMapping(row);
			return conversion.ok
				? {ok: true as const, value: conversion.mapping}
				: conversion;
		},
		key: (mapping) =>
			`${mapping.racetime.categorySlug.trim()}\u0000${mapping.racetime.goal.trim()}`,
		duplicateCode: CATEGORY_MAPPING_ROW_ISSUE_CODES.duplicateKey,
		duplicateMessage: (mapping, previousRow) =>
			`Duplicate mapping key "${mapping.racetime.categorySlug}" + "${mapping.racetime.goal}" (also on row ${previousRow}).`,
	});
	return {status: result.status, issues: result.issues};
}

/**
 * Prepares the two mapping worksheets without ever overwriting valid data:
 * missing sheets are created, blank sheets receive the shared header, and any
 * sheet that does not match the repository format aborts the whole operation.
 */
export async function initializeSpreadsheet(
	client: SpreadsheetClient,
	options: InitializeSpreadsheetOptions,
): Promise<SpreadsheetInitializationResult> {
	const gameName = options.gameMappingsSheet.trim();
	const categoryName = options.categoryMappingsSheet.trim();
	if (!gameName || !categoryName)
		throw new IntegrationError(
			"invalid_input",
			"Sheet names must not be empty.",
		);
	if (gameName === categoryName)
		throw new IntegrationError(
			"invalid_input",
			"GameMappings and CategoryMappings sheets must differ.",
		);

	const inspect = async (
		name: string,
		titles: ReadonlySet<string>,
		parse: (values: SpreadsheetValues) => {
			status: SheetParseStatus;
			issues: SheetIssue[];
		},
	): Promise<Inspection> => {
		if (!titles.has(name))
			return {exists: false, status: "missing", issues: []};
		const values = await client.readValues(sheetReadRange(name));
		const result = parse(values);
		if (result.status !== "empty") return {exists: true, ...result};
		// The A1:ZZ read may miss formulas that evaluate to "" or content to the
		// right of ZZ. Re-read the whole sheet as formulas before treating it as
		// empty, and refuse to write over anything that is actually present.
		const raw = await client.readValues(quoteSheetName(name), {
			valueRenderOption: "FORMULA",
		});
		if (hasContent(raw))
			return {exists: true, status: "invalid", issues: [occupiedIssue(name)]};
		return {exists: true, status: "empty", issues: result.issues};
	};

	const initialTitles = new Set(await client.listSheets());
	const game = await inspect(gameName, initialTitles, inspectGameMappings);
	const category = await inspect(
		categoryName,
		initialTitles,
		inspectCategoryMappings,
	);

	// Validate both sheets before any mutation so an invalid sheet elsewhere
	// never leaves the spreadsheet in a partially prepared state.
	const invalid: Array<{name: string; issues: SheetIssue[]}> = [];
	if (game.status === "invalid")
		invalid.push({name: gameName, issues: game.issues});
	if (category.status === "invalid")
		invalid.push({name: categoryName, issues: category.issues});
	if (invalid.length > 0)
		throw new SheetValidationError(
			invalid[0]!.name,
			invalid.flatMap((entry) => entry.issues),
		);

	const ensure = async (
		name: string,
		inspection: Inspection,
		columns: readonly string[],
	): Promise<SheetInitializationOutcome> => {
		const header = [[...columns]];
		if (!inspection.exists) {
			await client.createSheet(name);
			await client.updateValues([
				{range: `${quoteSheetName(name)}!A1`, values: header},
			]);
			return "created";
		}
		if (inspection.status === "empty") {
			await client.updateValues([
				{range: `${quoteSheetName(name)}!A1`, values: header},
			]);
			return "initialized";
		}
		return "unchanged";
	};

	const result: SpreadsheetInitializationResult = {
		gameMappings: await ensure(gameName, game, GAME_MAPPING_SHEET_COLUMNS),
		categoryMappings: await ensure(
			categoryName,
			category,
			CATEGORY_MAPPING_SHEET_COLUMNS,
		),
	};

	// Confirm the final state; a failure here leaves a re-runnable partial state.
	const finalTitles = new Set(await client.listSheets());
	const finalGame = await inspect(gameName, finalTitles, inspectGameMappings);
	if (finalGame.status !== "valid")
		throw new SheetValidationError(gameName, finalGame.issues);
	const finalCategory = await inspect(
		categoryName,
		finalTitles,
		inspectCategoryMappings,
	);
	if (finalCategory.status !== "valid")
		throw new SheetValidationError(categoryName, finalCategory.issues);

	return result;
}
