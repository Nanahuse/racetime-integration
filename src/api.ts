import {
	API_VERSION,
	type CategoryMapping,
	type GameMapping,
	type Operations,
	type RaceTimeAPI,
	type Response,
	type Settings,
	type SettingsState,
	type TimingMethod,
} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "./errors";
import {RaceTimeError} from "./integrations/racetime/errors";
import type {SpeedrunClient} from "./integrations/speedrun/client";
import {SpeedrunError} from "./integrations/speedrun/errors";
import {
	SheetValidationError,
	SpreadsheetIntegrationError,
} from "./integrations/spreadsheet/errors";
import type {MappingService} from "./mappings";
import type {RaceService} from "./service";

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
	for (const [key, value] of Object.entries(variables))
		text(value, `variables.${key}`);
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
			variables: {...variables} as Record<string, string>,
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

export function createAPI(
	races: RaceService,
	mappings: MappingService,
	speedrun: SpeedrunClient,
): RaceTimeAPI {
	async function request<K extends keyof Operations>(
		operation: K,
		raw: Operations[K]["request"],
	): Promise<Response<Operations[K]["response"]>> {
		try {
			const data = raw === undefined ? {} : object(raw);
			let value: unknown;
			switch (operation) {
				case "fetchRace":
					value = await races.fetch(text(data.url));
					break;
				case "watchRace":
					value = await races.watch(text(data.url));
					break;
				case "unwatchRace":
					value = {released: races.unwatch(text(data.watchId))};
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
				case "resolveParticipants":
					value = await races.resolve(text(data.url));
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
				case "saveCategoryMapping":
					value = await mappings.saveCategory(
						categoryMapping(data.mapping),
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
							const variables = await speedrun.getCategoryVariables(
								category.categoryId,
							);
							for (const variable of variables) {
								if (variable.mandatory && !category.variables[variable.id])
									throw new RequestError(
										"invalid_input",
										`Missing mandatory variable "${variable.id}"`,
									);
							}
						},
					);
					break;
				case "deleteCategoryMapping":
					value = await mappings.deleteCategory(
						text(data.categorySlug),
						text(data.goal),
						text(data.expectedRevision),
						revision(data.settingsRevision),
					);
					break;
				case "resolveCategoryMapping":
					value = await mappings.resolve(
						text(data.categorySlug),
						text(data.goal),
					);
					break;
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
