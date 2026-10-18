import {
	API_VERSION,
	type CategoryMapping,
	DEFAULT_LEADERBOARD_TOP,
	DEFAULT_MAX_RESOLVED_MAPPINGS,
	type GameMapping,
	type Operations,
	type RaceTimeAPI,
	type Response,
	type Settings,
	type SettingsState,
	type SpeedrunVariableOption,
	type SpreadsheetInitializationSettings,
	supportsAnySelection,
	type TimingMethod,
	type VariableSelection,
} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "./errors";
import {RaceTimeError} from "./integrations/racetime/errors";
import type {SpeedrunClient} from "./integrations/speedrun/client";
import {SpeedrunError} from "./integrations/speedrun/errors";
import type {SpreadsheetClient} from "./integrations/spreadsheet/client";
import {
	SheetValidationError,
	SpreadsheetIntegrationError,
} from "./integrations/spreadsheet/errors";
import {initializeSpreadsheet} from "./integrations/spreadsheet/initialize";
import type {MappingService} from "./mappings";
import {anyVariableIds, expandCategoryMapping} from "./resolve";
import type {RaceService} from "./service";
import type {SpeedrunRecordService} from "./speedrun-records";

class RequestError extends IntegrationError {}
function object(raw: unknown, field?: string): Record<string, unknown> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new RequestError(
			"invalid_input",
			field ? `Invalid ${field}` : "Expected an object",
		);
	return raw as Record<string, unknown>;
}
function text(value: unknown, field?: string): string {
	if (typeof value !== "string" || !value.trim() || value.length > 2048)
		throw new RequestError(
			"invalid_input",
			field
				? `Invalid ${field}`
				: "Expected a non-empty string (max 2048 characters)",
		);
	return value.trim();
}
function revision(value: unknown, field?: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new RequestError(
			"invalid_input",
			field ? `Invalid ${field}` : "Expected a non-negative revision",
		);
	return value;
}
function nullableText(value: unknown, field: string): string | null {
	return value === null ? null : text(value, field);
}
function positiveInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
		throw new RequestError("invalid_input", `Invalid ${field}`);
	return value;
}
export function parseSettings(raw: unknown): Settings {
	const input = object(raw, "settings");
	const spreadsheetId =
		input.spreadsheetId === null
			? null
			: text(input.spreadsheetId, "spreadsheetId");
	if (spreadsheetId !== null && !/^[A-Za-z0-9_-]+$/.test(spreadsheetId))
		throw new RequestError("invalid_input", "Invalid spreadsheetId");
	return {
		spreadsheetId,
		gameMappingsSheet: text(input.gameMappingsSheet, "gameMappingsSheet"),
		categoryMappingsSheet: text(
			input.categoryMappingsSheet,
			"categoryMappingsSheet",
		),
		// Settings persisted before this field existed default to the initial cap
		// rather than being rejected; other values are preserved.
		maxResolvedMappings:
			input.maxResolvedMappings === undefined
				? DEFAULT_MAX_RESOLVED_MAPPINGS
				: positiveInteger(input.maxResolvedMappings, "maxResolvedMappings"),
		leaderboardTop:
			input.leaderboardTop === undefined
				? DEFAULT_LEADERBOARD_TOP
				: positiveInteger(input.leaderboardTop, "leaderboardTop"),
	};
}
export function parseSettingsState(raw: unknown): SettingsState {
	const input = object(raw, "settings state");
	return {
		revision: revision(input.revision, "revision"),
		settings: parseSettings(input.settings),
	};
}

const TIMING_METHODS = ["realtime", "realtime_noloads", "ingame"];
const MAX_VARIABLE_VALUE_LENGTH = 2048;
const MAX_USER_DEFINED_LENGTH = 255;

function variableValue(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length > MAX_VARIABLE_VALUE_LENGTH)
		throw new RequestError("invalid_input", `Invalid ${field}`);
	return value;
}

function variableSelection(value: unknown, field: string): VariableSelection {
	if (typeof value === "string") return variableValue(value, field);
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const keys = Object.keys(value);
		if (keys.length === 1 && (value as {mode?: unknown}).mode === "any")
			return {mode: "any"};
	}
	throw new RequestError("invalid_input", `Invalid ${field}`);
}

function pruneVariables(
	values: Record<string, VariableSelection>,
): Record<string, VariableSelection> {
	const result: Record<string, VariableSelection> = {};
	for (const [key, value] of Object.entries(values))
		if (value !== "") result[key] = value;
	return result;
}

/**
 * Validates a category's variable selection against the Speedrun.com
 * definitions: no unknown ids, enum values must be offered options, PB-defining
 * variables must be set, and user-defined values are length-checked.
 */
function validateVariables(
	definitions: readonly SpeedrunVariableOption[],
	values: Record<string, VariableSelection>,
): void {
	const byId = new Map(definitions.map((variable) => [variable.id, variable]));
	for (const [id, value] of Object.entries(values)) {
		const variable = byId.get(id);
		if (!variable)
			throw new RequestError("invalid_input", `Unknown variable "${id}"`);
		if (typeof value !== "string") {
			if (!supportsAnySelection(variable))
				throw new RequestError(
					"invalid_input",
					`Variable "${id}" does not support Any`,
				);
			continue;
		}
		if (variable.userDefined) {
			if (value.length > MAX_USER_DEFINED_LENGTH)
				throw new RequestError("invalid_input", `Variable "${id}" is too long`);
			if (variable.obsoletes && value.trim() === "")
				throw new RequestError(
					"invalid_input",
					`Missing PB-defining variable "${id}"`,
				);
			continue;
		}
		if (!variable.values.some((option) => option.id === value))
			throw new RequestError(
				"invalid_input",
				`Invalid value for variable "${id}"`,
			);
	}
	for (const variable of definitions) {
		const value = values[variable.id];
		if (
			variable.obsoletes &&
			(value === undefined ||
				(typeof value === "string" && value.trim() === ""))
		)
			throw new RequestError(
				"invalid_input",
				`Missing PB-defining variable "${variable.id}"`,
			);
	}
}

function gameMapping(raw: unknown): GameMapping {
	const input = object(raw, "game mapping");
	const race = object(input.racetime, "gameMapping.racetime");
	const src = object(input.speedrunCom, "gameMapping.speedrunCom");
	return {
		racetime: {
			categorySlug: text(race.categorySlug, "categorySlug"),
			categoryName: text(race.categoryName, "categoryName"),
		},
		speedrunCom: {
			gameId: text(src.gameId, "gameId"),
			gameName: text(src.gameName, "gameName"),
		},
	};
}

function categoryMapping(raw: unknown): CategoryMapping {
	const input = object(raw, "category mapping");
	const race = object(input.racetime, "categoryMapping.racetime");
	const src = object(input.speedrunCom, "categoryMapping.speedrunCom");
	const variables = object(src.variables, "variables");
	const normalizedVariables: Record<string, VariableSelection> = {};
	for (const [key, value] of Object.entries(variables)) {
		if (key.trim() === "")
			throw new RequestError("invalid_input", "Invalid variable id");
		normalizedVariables[key] = variableSelection(value, `variables.${key}`);
	}
	if (src.emulator !== null && typeof src.emulator !== "boolean")
		throw new RequestError("invalid_input", "emulator must be boolean or null");
	if (
		src.timingMethod !== null &&
		!TIMING_METHODS.includes(String(src.timingMethod))
	)
		throw new RequestError("invalid_input", "Invalid timingMethod");
	return {
		racetime: {
			categorySlug: text(race.categorySlug, "categorySlug"),
			goal: text(race.goal, "goal"),
		},
		speedrunCom: {
			categoryId: text(src.categoryId, "categoryId"),
			categoryName: text(src.categoryName, "categoryName"),
			levelId: nullableText(src.levelId, "levelId"),
			variables: normalizedVariables,
			platformId: nullableText(src.platformId, "platformId"),
			regionId: nullableText(src.regionId, "regionId"),
			emulator: src.emulator,
			timingMethod: src.timingMethod as TimingMethod | null,
		},
	};
}

function expectedRevision(value: unknown): string | null {
	return value === null ? null : text(value, "expectedRevision");
}

function initializationSettings(
	raw: unknown,
): SpreadsheetInitializationSettings {
	const input = object(raw, "settings");
	const spreadsheetId = text(input.spreadsheetId, "spreadsheetId");
	if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId))
		throw new RequestError("invalid_input", "Invalid spreadsheetId");
	return {
		spreadsheetId,
		gameMappingsSheet: text(input.gameMappingsSheet, "gameMappingsSheet"),
		categoryMappingsSheet: text(
			input.categoryMappingsSheet,
			"categoryMappingsSheet",
		),
	};
}

export function createAPI(
	races: RaceService,
	mappings: MappingService,
	speedrun: SpeedrunClient,
	createSpreadsheetClient: (spreadsheetId: string) => SpreadsheetClient,
	records?: SpeedrunRecordService,
): RaceTimeAPI {
	async function request<K extends keyof Operations>(
		operation: K,
		raw: Operations[K]["request"],
	): Promise<Response<Operations[K]["response"]>> {
		try {
			const data = raw === undefined ? {} : object(raw);
			let value: unknown;
			switch (operation) {
				case "getSpeedrunLeaderboards":
					if (!records)
						throw new RequestError(
							"unsupported_operation",
							"Speedrun records are unavailable",
						);
					value = await records.leaderboards(
						text(data.categorySlug),
						text(data.goal),
						data.refresh === true,
					);
					break;
				case "getSpeedrunPlayerBests": {
					if (!records)
						throw new RequestError(
							"unsupported_operation",
							"Speedrun records are unavailable",
						);
					if (
						!Array.isArray(data.playerIds) ||
						data.playerIds.some((id) => typeof id !== "string")
					)
						throw new RequestError("invalid_input", "Invalid playerIds");
					value = await records.playerBests(
						text(data.categorySlug),
						text(data.goal),
						(data.playerIds as string[]).map((id) => text(id, "playerId")),
						data.refresh === true,
					);
					break;
				}
				case "fetchRace":
					value = await races.fetch(text(data.url));
					break;
				case "watchRace":
					value = await races.watch(text(data.url));
					break;
				case "unwatchRace":
					value = {released: races.unwatch(text(data.watchId))};
					break;
				case "forceUnwatchRace":
					value = races.forceUnwatch(text(data.url));
					break;
				case "getRace":
					value = races.get(text(data.url));
					break;
				case "getWatch":
					value = races.getWatch(text(data.watchId));
					break;
				case "listRaces":
					value = races.snapshot();
					break;
				case "listGameMappings":
					value = await mappings.listGames();
					break;
				case "findGameMapping":
					value = await mappings.findGame(text(data.categorySlug));
					break;
				case "saveGameMapping":
					value = await mappings.saveGame(
						gameMapping(data.mapping),
						expectedRevision(data.expectedRevision),
						revision(data.settingsRevision),
					);
					break;
				case "deleteGameMapping":
					value = await mappings.deleteGame(
						text(data.categorySlug),
						text(data.expectedRevision),
						revision(data.settingsRevision),
					);
					break;
				case "listCategoryMappings":
					value = await mappings.listCategories();
					break;
				case "findCategoryMapping":
					value = await mappings.findCategory(
						text(data.categorySlug),
						text(data.goal),
					);
					break;
				case "saveCategoryMapping": {
					const parsed = categoryMapping(data.mapping);
					const mapping: CategoryMapping = {
						...parsed,
						speedrunCom: {
							...parsed.speedrunCom,
							variables: pruneVariables(parsed.speedrunCom.variables),
						},
					};
					value = await mappings.saveCategory(
						mapping,
						expectedRevision(data.expectedRevision),
						revision(data.settingsRevision),
						async (game, category) => {
							const gameId = await speedrun.getCategoryGameId(
								category.categoryId,
							);
							if (gameId !== game.gameId)
								throw new RequestError(
									"category_not_in_game",
									`Category "${category.categoryId}" does not belong to game "${game.gameId}"`,
								);
							const definitions = await speedrun.getCategoryVariables(
								category.categoryId,
							);
							validateVariables(definitions, category.variables);
						},
					);
					break;
				}
				case "deleteCategoryMapping":
					value = await mappings.deleteCategory(
						text(data.categorySlug),
						text(data.goal),
						text(data.expectedRevision),
						revision(data.settingsRevision),
					);
					break;
				case "resolveCategoryMapping": {
					const source = await mappings.resolveSource(
						text(data.categorySlug),
						text(data.goal),
					);
					if (source.status !== "found") {
						value = source;
						break;
					}
					if (anyVariableIds(source.category.variables).length === 0) {
						const expanded = expandCategoryMapping(
							source.game,
							source.category,
							[],
							source.maxResolvedMappings,
						);
						value = expanded.ok
							? {status: "resolved", mappings: expanded.mappings}
							: {status: "inconsistent", message: expanded.message};
						break;
					}
					const definitions = await speedrun.getCategoryVariables(
						source.category.categoryId,
					);
					const expanded = expandCategoryMapping(
						source.game,
						source.category,
						definitions,
						source.maxResolvedMappings,
					);
					if (!expanded.ok && expanded.status === "limit_exceeded")
						throw new IntegrationError(
							"expansion_limit_exceeded",
							expanded.message,
						);
					value = expanded.ok
						? {status: "resolved", mappings: expanded.mappings}
						: {status: "inconsistent", message: expanded.message};
					break;
				}
				case "searchSpeedrunGames":
					value = {games: await speedrun.searchGames(text(data.query))};
					break;
				case "getSpeedrunGameOptions":
					value = await speedrun.getGameOptions(text(data.gameId));
					break;
				case "getSpeedrunCategoryVariables":
					value = {
						variables: await speedrun.getCategoryVariables(
							text(data.categoryId),
						),
					};
					break;
				case "initializeSpreadsheet": {
					const target = initializationSettings(data.settings);
					value = await initializeSpreadsheet(
						createSpreadsheetClient(target.spreadsheetId),
						{
							gameMappingsSheet: target.gameMappingsSheet,
							categoryMappingsSheet: target.categoryMappingsSheet,
						},
					);
					break;
				}
				case "getSettings":
					value = mappings.settings();
					break;
				case "updateSettings":
					value = await mappings.update(
						parseSettings(data.settings),
						revision(data.expectedRevision),
					);
					break;
				default:
					throw new RequestError("unsupported_operation", "Unknown operation");
			}
			return {ok: true, data: value as Operations[K]["response"]};
		} catch (error) {
			const code =
				error instanceof IntegrationError || error instanceof RaceTimeError
					? error.code
					: error instanceof SpeedrunError
						? error.code
						: error instanceof SheetValidationError
							? "invalid_sheet"
							: error instanceof SpreadsheetIntegrationError
								? "spreadsheet_unavailable"
								: "internal_error";
			return {
				ok: false,
				error: {
					code,
					message:
						code === "internal_error"
							? "Operation failed"
							: (error as Error).message,
				},
			};
		}
	}
	return {apiVersion: API_VERSION, request};
}
