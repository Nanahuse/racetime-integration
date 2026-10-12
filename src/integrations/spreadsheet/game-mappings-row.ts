// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import type {GameMapping} from "@nanahuse/racetime-protocol";

export const GAME_MAPPING_SHEET_COLUMNS = [
	"racetime_category_slug",
	"racetime_category_name",
	"src_game_id",
	"src_game_name",
	"updated_at",
] as const;

export type GameMappingSheetColumn =
	(typeof GAME_MAPPING_SHEET_COLUMNS)[number];

export type GameMappingSheetRow = {
	[K in GameMappingSheetColumn]: string;
};

export const GAME_MAPPING_ROW_ISSUE_CODES = {
	categorySlugMissing: "racetime_category_slug_missing",
	gameIdMissing: "src_game_id_missing",
	gameNameMissing: "src_game_name_missing",
	duplicateKey: "duplicate_key",
} as const;

export type GameMappingIssue = {
	code: string;
	message: string;
};

export type GameMappingConversionResult =
	| {ok: true; mapping: GameMapping}
	| {ok: false; issues: GameMappingIssue[]};

function normalizeCell(value: string | undefined): string {
	return (value ?? "").trim();
}

export function emptyGameMappingSheetRow(): GameMappingSheetRow {
	return Object.fromEntries(
		GAME_MAPPING_SHEET_COLUMNS.map((column) => [column, ""]),
	) as GameMappingSheetRow;
}

export function gameMappingToSheetRow(
	mapping: GameMapping,
	updatedAt: string,
): GameMappingSheetRow {
	const row = emptyGameMappingSheetRow();
	row.racetime_category_slug = mapping.racetime.categorySlug;
	row.racetime_category_name = mapping.racetime.categoryName;
	row.src_game_id = mapping.speedrunCom.gameId;
	row.src_game_name = mapping.speedrunCom.gameName;
	row.updated_at = updatedAt;
	return row;
}

export function validateGameMapping(mapping: GameMapping): GameMappingIssue[] {
	const issues: GameMappingIssue[] = [];
	if (mapping.racetime.categorySlug.trim() === "") {
		issues.push({
			code: GAME_MAPPING_ROW_ISSUE_CODES.categorySlugMissing,
			message: "racetime category slug is required.",
		});
	}
	if (mapping.speedrunCom.gameId.trim() === "") {
		issues.push({
			code: GAME_MAPPING_ROW_ISSUE_CODES.gameIdMissing,
			message: "src_game_id is required.",
		});
	}
	if (mapping.speedrunCom.gameName.trim() === "") {
		issues.push({
			code: GAME_MAPPING_ROW_ISSUE_CODES.gameNameMissing,
			message: "src_game_name is required.",
		});
	}
	return issues;
}

export function gameMappingSheetRowToMapping(
	row: GameMappingSheetRow,
): GameMappingConversionResult {
	const issues: GameMappingIssue[] = [];

	const categorySlug = normalizeCell(row.racetime_category_slug);
	if (categorySlug === "") {
		issues.push({
			code: GAME_MAPPING_ROW_ISSUE_CODES.categorySlugMissing,
			message: "racetime_category_slug is required.",
		});
	}
	const gameId = normalizeCell(row.src_game_id);
	if (gameId === "") {
		issues.push({
			code: GAME_MAPPING_ROW_ISSUE_CODES.gameIdMissing,
			message: "src_game_id is required.",
		});
	}
	const gameName = normalizeCell(row.src_game_name);
	if (gameName === "") {
		issues.push({
			code: GAME_MAPPING_ROW_ISSUE_CODES.gameNameMissing,
			message: "src_game_name is required.",
		});
	}

	if (issues.length > 0) {
		return {ok: false, issues};
	}

	return {
		ok: true,
		mapping: {
			racetime: {
				categorySlug,
				categoryName: normalizeCell(row.racetime_category_name),
			},
			speedrunCom: {gameId, gameName},
		},
	};
}
