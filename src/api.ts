import {
	API_VERSION,
	type CategoryMapping,
	type Operations,
	type RaceTimeAPI,
	type Response,
} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "./errors";
import {RaceTimeError} from "./integrations/racetime/errors";
import {
	SheetValidationError,
	SpreadsheetIntegrationError,
} from "./integrations/spreadsheet/errors";
import type {MappingService} from "./mappings";
import type {RaceService} from "./service";

class RequestError extends IntegrationError {}
function object(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new RequestError("invalid_input", "Expected an object");
	return raw as Record<string, unknown>;
}
function text(value: unknown): string {
	if (typeof value !== "string" || !value.trim() || value.length > 2048)
		throw new RequestError(
			"invalid_input",
			"Expected a non-empty string (max 2048 characters)",
		);
	return value.trim();
}
function revision(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new RequestError("invalid_input", "Expected a non-negative revision");
	return value;
}
function mapping(raw: unknown): CategoryMapping {
	const input = object(raw),
		race = object(input.racetime),
		src = object(input.speedrunCom);
	const nullable = (value: unknown) => (value === null ? null : text(value));
	const variables = object(src.variables);
	for (const value of Object.values(variables)) text(value);
	if (src.emulator !== null && typeof src.emulator !== "boolean")
		throw new RequestError("invalid_input", "emulator must be boolean or null");
	if (
		src.timingMethod !== null &&
		!["realtime", "realtime_noloads", "ingame"].includes(
			String(src.timingMethod),
		)
	)
		throw new RequestError("invalid_input", "Invalid timingMethod");
	if (typeof race.categoryName !== "string")
		throw new RequestError("invalid_input", "categoryName must be a string");
	return {
		racetime: {
			categorySlug: text(race.categorySlug),
			categoryName: race.categoryName.trim(),
			goal: text(race.goal),
		},
		speedrunCom: {
			gameId: text(src.gameId),
			gameName: text(src.gameName),
			categoryId: text(src.categoryId),
			categoryName: text(src.categoryName),
			levelId: nullable(src.levelId),
			platformId: nullable(src.platformId),
			regionId: nullable(src.regionId),
			variables: {...variables} as Record<string, string>,
			emulator: src.emulator,
			timingMethod:
				src.timingMethod as CategoryMapping["speedrunCom"]["timingMethod"],
		},
	};
}

export function createAPI(
	races: RaceService,
	mappings: MappingService,
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
				case "getSettings":
					value = mappings.settings();
					break;
				case "updateSettings": {
					const settings = object(data.settings);
					const spreadsheetId =
						settings.spreadsheetId === null
							? null
							: text(settings.spreadsheetId);
					if (spreadsheetId !== null && !/^[A-Za-z0-9_-]+$/.test(spreadsheetId))
						throw new RequestError("invalid_input", "Invalid spreadsheetId");
					value = await mappings.update(
						{
							spreadsheetId,
							categoryMappingsSheet: text(settings.categoryMappingsSheet),
						},
						revision(data.expectedRevision),
					);
					break;
				}
				case "listCategoryMappings":
					value = await mappings.list();
					break;
				case "findCategoryMapping":
					value = await mappings.find(text(data.categorySlug), text(data.goal));
					break;
				case "saveCategoryMapping": {
					const incoming = mapping(data.mapping);
					value = await mappings.save(
						incoming,
						data.expectedRevision === null ? null : text(data.expectedRevision),
						revision(data.settingsRevision),
					);
					break;
				}
				case "deleteCategoryMapping":
					value = await mappings.delete(
						text(data.categorySlug),
						text(data.goal),
						text(data.expectedRevision),
						revision(data.settingsRevision),
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
