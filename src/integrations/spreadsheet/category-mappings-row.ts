// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import type {
	CategoryMapping,
	TimingMethod,
	VariableSelection,
} from "@nanahuse/racetime-protocol";

export const CATEGORY_MAPPING_SHEET_COLUMNS = [
	"racetime_category_slug",
	"racetime_goal",
	"src_game_id",
	"src_category_id",
	"src_category_name",
	"src_level_id",
	"src_variables",
	"src_platform_id",
	"src_region_id",
	"src_emulator",
	"src_timing_method",
	"updated_at",
] as const;

export type CategoryMappingSheetColumn =
	(typeof CATEGORY_MAPPING_SHEET_COLUMNS)[number];

export type CategoryMappingSheetRow = {
	[K in CategoryMappingSheetColumn]: string;
};

export const CATEGORY_MAPPING_ROW_ISSUE_CODES = {
	categorySlugMissing: "racetime_category_slug_missing",
	goalMissing: "racetime_goal_missing",
	gameIdMissing: "src_game_id_missing",
	categoryIdMissing: "src_category_id_missing",
	categoryNameMissing: "src_category_name_missing",
	variablesInvalid: "src_variables_invalid",
	variablesValueInvalid: "src_variables_value_invalid",
	emulatorInvalid: "src_emulator_invalid",
	timingMethodInvalid: "src_timing_method_invalid",
	duplicateKey: "duplicate_key",
} as const;

export type CategoryMappingIssue = {
	code: string;
	message: string;
};

export type CategoryMappingConversionResult =
	| {ok: true; mapping: CategoryMapping}
	| {ok: false; issues: CategoryMappingIssue[]};

const TIMING_METHODS: readonly TimingMethod[] = [
	"realtime",
	"realtime_noloads",
	"ingame",
];

function normalizeCell(value: string | undefined): string {
	return (value ?? "").trim();
}

function nullableCell(value: string | undefined): string | null {
	const normalized = normalizeCell(value);
	return normalized === "" ? null : normalized;
}

function isAnySelection(item: unknown): item is {mode: "any"} {
	if (typeof item !== "object" || item === null || Array.isArray(item))
		return false;
	const keys = Object.keys(item as Record<string, unknown>);
	return keys.length === 1 && (item as {mode?: unknown}).mode === "any";
}

function parseVariables(
	value: string | undefined,
	issues: CategoryMappingIssue[],
): Record<string, VariableSelection> {
	const raw = normalizeCell(value);
	if (raw === "") {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.variablesInvalid,
			message: "src_variables must be a JSON object.",
		});
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.variablesInvalid,
			message: "src_variables must be a JSON object.",
		});
		return {};
	}
	const variables: Record<string, VariableSelection> = {};
	for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof item === "string") {
			variables[key] = item;
			continue;
		}
		if (isAnySelection(item)) {
			variables[key] = {mode: "any"};
			continue;
		}
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.variablesValueInvalid,
			message: `src_variables["${key}"] must be a string or {"mode":"any"}.`,
		});
	}
	return variables;
}

function parseEmulator(
	value: string | undefined,
	issues: CategoryMappingIssue[],
): boolean | null {
	const raw = normalizeCell(value);
	if (raw === "") {
		return null;
	}
	if (raw === "true") {
		return true;
	}
	if (raw === "false") {
		return false;
	}
	issues.push({
		code: CATEGORY_MAPPING_ROW_ISSUE_CODES.emulatorInvalid,
		message: 'src_emulator must be "true", "false" or blank.',
	});
	return null;
}

function parseTimingMethod(
	value: string | undefined,
	issues: CategoryMappingIssue[],
): TimingMethod | null {
	const raw = normalizeCell(value);
	if (raw === "") {
		return null;
	}
	if ((TIMING_METHODS as readonly string[]).includes(raw)) {
		return raw as TimingMethod;
	}
	issues.push({
		code: CATEGORY_MAPPING_ROW_ISSUE_CODES.timingMethodInvalid,
		message: `src_timing_method must be one of ${TIMING_METHODS.join(", ")} or blank.`,
	});
	return null;
}

export function emptyCategoryMappingSheetRow(): CategoryMappingSheetRow {
	return Object.fromEntries(
		CATEGORY_MAPPING_SHEET_COLUMNS.map((column) => [column, ""]),
	) as CategoryMappingSheetRow;
}

export function validateCategoryMapping(
	mapping: CategoryMapping,
): CategoryMappingIssue[] {
	const issues: CategoryMappingIssue[] = [];
	if (mapping.racetime.categorySlug.trim() === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.categorySlugMissing,
			message: "racetime category slug is required.",
		});
	}
	if (mapping.racetime.goal.trim() === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.goalMissing,
			message: "racetime goal is required.",
		});
	}
	if (
		typeof mapping.speedrunCom.gameId !== "string" ||
		!mapping.speedrunCom.gameId.trim()
	)
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.gameIdMissing,
			message: "src_game_id is required.",
		});
	if (mapping.speedrunCom.categoryId.trim() === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.categoryIdMissing,
			message: "src_category_id is required.",
		});
	}
	if (mapping.speedrunCom.categoryName.trim() === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.categoryNameMissing,
			message: "src_category_name is required.",
		});
	}
	return issues;
}

export function categoryMappingToSheetRow(
	mapping: CategoryMapping,
	updatedAt: string,
): CategoryMappingSheetRow {
	const row = emptyCategoryMappingSheetRow();
	row.racetime_category_slug = mapping.racetime.categorySlug;
	row.racetime_goal = mapping.racetime.goal;
	row.src_game_id = mapping.speedrunCom.gameId;

	row.src_category_id = mapping.speedrunCom.categoryId;
	row.src_category_name = mapping.speedrunCom.categoryName;
	row.src_level_id = mapping.speedrunCom.levelId ?? "";
	row.src_variables = JSON.stringify(mapping.speedrunCom.variables);
	row.src_platform_id = mapping.speedrunCom.platformId ?? "";
	row.src_region_id = mapping.speedrunCom.regionId ?? "";
	row.src_emulator =
		mapping.speedrunCom.emulator === null
			? ""
			: String(mapping.speedrunCom.emulator);
	row.src_timing_method = mapping.speedrunCom.timingMethod ?? "";

	row.updated_at = updatedAt;
	return row;
}

export function categoryMappingSheetRowToMapping(
	row: CategoryMappingSheetRow,
): CategoryMappingConversionResult {
	const issues: CategoryMappingIssue[] = [];

	const categorySlug = normalizeCell(row.racetime_category_slug);
	if (categorySlug === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.categorySlugMissing,
			message: "racetime_category_slug is required.",
		});
	}
	const goal = normalizeCell(row.racetime_goal);
	if (goal === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.goalMissing,
			message: "racetime_goal is required.",
		});
	}

	const gameId = normalizeCell(row.src_game_id);
	if (!gameId)
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.gameIdMissing,
			message: "src_game_id is required.",
		});
	const categoryId = normalizeCell(row.src_category_id);
	if (categoryId === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.categoryIdMissing,
			message: "src_category_id is required.",
		});
	}
	const categoryName = normalizeCell(row.src_category_name);
	if (categoryName === "") {
		issues.push({
			code: CATEGORY_MAPPING_ROW_ISSUE_CODES.categoryNameMissing,
			message: "src_category_name is required.",
		});
	}

	const variables = parseVariables(row.src_variables, issues);
	const emulator = parseEmulator(row.src_emulator, issues);
	const timingMethod = parseTimingMethod(row.src_timing_method, issues);

	if (issues.length > 0) {
		return {ok: false, issues};
	}

	return {
		ok: true,
		mapping: {
			racetime: {categorySlug, goal},
			speedrunCom: {
				gameId,
				categoryId,
				categoryName,
				levelId: nullableCell(row.src_level_id),
				variables,
				platformId: nullableCell(row.src_platform_id),
				regionId: nullableCell(row.src_region_id),
				emulator,
				timingMethod,
			},
		},
	};
}
