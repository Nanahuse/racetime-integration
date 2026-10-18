import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	ResolveCategoryMappingResult,
	ResolvedCategoryMapping,
} from "./category.js";
import type {
	SpeedrunGameOptions,
	SpeedrunGameSummary,
	SpeedrunVariableOption,
} from "./speedrun.js";

export {Temporal} from "@js-temporal/polyfill";
export type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	MappingRecord,
	ResolveCategoryMappingResult,
	ResolvedCategoryMapping,
	ResolvedSpeedrunCategorySelection,
	SpeedrunCategorySelection,
	TimingMethod,
	VariableSelection,
} from "./category.js";
export {
	parseRaceDate,
	parseRaceInstant,
	type RaceDate,
	type RaceInstant,
	serializeRaceDate,
	serializeRaceInstant,
} from "./datetime.js";
export {
	parseRaceDuration,
	type RaceDuration,
	serializeRaceDuration,
} from "./duration.js";
export type {
	SpeedrunCategoryOption,
	SpeedrunGame,
	SpeedrunGameOptions,
	SpeedrunGameSummary,
	SpeedrunLevelOption,
	SpeedrunPlatformOption,
	SpeedrunRegionOption,
	SpeedrunTimingMethods,
	SpeedrunVariableOption,
	SpeedrunVariableValueOption,
} from "./speedrun.js";
export {supportsAnySelection} from "./speedrun.js";

export const BUNDLE_NAME = "racetime-integration";
export const API_VERSION = 4;
export const MESSAGE_PREFIX = "racetime.v4";
export const RACES_REPLICANT = "racetime-races";
export const SETTINGS_REPLICANT = "racetime-settings";
/** Default cap on the number of mappings one Any expansion may produce. */
export const DEFAULT_MAX_RESOLVED_MAPPINGS = 20;
export const DEFAULT_LEADERBOARD_TOP = 20;
export const DEFAULT_ALLOWED_RACE_ORIGINS = ["https://racetime.gg"] as const;

export function normalizeAllowedRaceOrigin(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "")
		throw new TypeError("Originは空にできません。");
	const input = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(input);
	} catch {
		throw new TypeError("有効なOrigin URLを入力してください。");
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
		throw new TypeError("OriginはHTTPSまたはループバックHTTPにしてください。");
	if (parsed.username || parsed.password)
		throw new TypeError("Originにユーザー名やパスワードは指定できません。");
	if (
		!/^https?:\/\/[^/?#\\]+\/?$/i.test(input) ||
		parsed.pathname !== "/" ||
		parsed.search !== "" ||
		parsed.hash !== "" ||
		input.includes("?") ||
		input.includes("#")
	)
		throw new TypeError("Originにパス、クエリ、フラグメントは指定できません。");
	if (
		parsed.protocol === "http:" &&
		!new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname)
	)
		throw new TypeError(
			"HTTPを許可できるのはlocalhostまたはループバックIPだけです。",
		);
	return parsed.origin;
}

export function normalizeAllowedRaceOrigins(value: unknown): string[] {
	if (!Array.isArray(value))
		throw new TypeError("allowedRaceOriginsはOrigin URLの配列にしてください。");
	const normalized = value.map(normalizeAllowedRaceOrigin);
	if (new Set(normalized).size !== normalized.length)
		throw new TypeError("正規化後に重複するOriginは登録できません。");
	return normalized;
}
export type PlayerSnapshot = {
	playerId: string;
	revision: number;
	displayName: string;
	racetime: {userId: string; name: string} | null;
	speedrunCom: {userId: string; name: string} | null;
	twitch: {userId: string | null; login: string; displayName?: string} | null;
	youtube: string | null;
	/** Account IDs for the Primary account shown in each service column. */
	primaryAccountIds?: {
		speedrunCom: string | null;
		twitch: string | null;
	};
};
export type RaceResult = {
	userId: string;
	name: string;
	place: number | null;
	/**
	 * Elapsed finish time as a validated ISO 8601 duration string, or `null`
	 * when the entrant has no recorded time. Use `parseRaceDuration` to restore
	 * a `Temporal.Duration`.
	 */
	time: string | null;
	/** Absolute finish timestamp in UTC, distinct from the elapsed time. */
	finishedAt: string | null;
	status: "finished" | "dnf" | "dq" | "other";
};
export type FinishedRaceResult = RaceResult & {
	status: "finished";
	time: string;
	finishedAt: string;
};
export type RaceTimeEvents = {
	raceStartScheduled: {
		raceId: string;
		url: string;
		raceVersion: number;
		startedAt: string;
		previousStartedAt: string | null;
	};
	raceStarted: {
		raceId: string;
		url: string;
		raceVersion: number;
		startedAt: string;
	};
	entrantFinished: {
		raceId: string;
		url: string;
		raceVersion: number;
		result: FinishedRaceResult;
	};
	entrantFinishUndone: {
		raceId: string;
		url: string;
		raceVersion: number;
		userId: string;
	};
	raceCancelled: {
		raceId: string;
		url: string;
		raceVersion: number;
		cancelledAt: string;
	};
};
export const eventMessageName = <K extends keyof RaceTimeEvents>(
	event: K,
): `racetime.v4.${K}` => `${MESSAGE_PREFIX}.${event}`;
export type Entrant = {
	userId: string;
	name: string;
	twitchLogin: string | null;
	status: string;
	/**
	 * Elapsed finish time as a validated ISO 8601 duration string, or `null`
	 * when the entrant has no recorded time. Always the same duration as the
	 * matching `RaceResult.time`; use `parseRaceDuration` to restore it.
	 */
	finishTime: string | null;
	/** Same UTC timestamp as the matching RaceResult.finishedAt. */
	finishedAt: string | null;
	place: number | null;
};
export type Race = {
	raceId: string;
	url: string;
	version: number;
	name: string;
	status: string;
	/** Absolute timestamps serialized as ISO 8601 UTC strings. */
	openedAt: string;
	startedAt: string | null;
	endedAt: string | null;
	cancelledAt: string | null;
	/** Countdown and maximum elapsed race time as ISO 8601 durations. */
	startDelay: string;
	timeLimit: string;
	info: string;
	ranked: boolean;
	recordable: boolean;
	recorded: boolean;
	timeLimitAutoComplete: boolean;
	/** Provider counts, including entrants omitted from the entrant list. */
	entrantsCount: number;
	entrantsCountFinished: number;
	entrantsCountInactive: number;
	category: {slug: string; name: string; goal: string};
	entrants: Entrant[];
	results: RaceResult[];
};
export type Participant = {
	racetimeUserId: string;
	status: "matched" | "unresolved" | "unavailable";
	playerId: string | null;
	player: PlayerSnapshot | null;
	message: string;
};
/**
 * A single RaceTime HTTP fetch paired with the Player Manager resolution of its
 * entrants. `resolution.state` describes whether resolution itself succeeded;
 * unmatched entrants are still `ready`.
 */
export type ResolvedRace = {
	race: Race;
	participants: Participant[];
	resolution: {
		state: "ready" | "error";
		directoryRevision: number | null;
	};
};
export type RaceState = {
	revision: number;
	raceRevision: number;
	participantsRevision: number;
	resolution: {
		state: "idle" | "pending" | "ready" | "error";
		raceRevision: number | null;
		directoryRevision: number | null;
	};
	url: string;
	race: Race | null;
	connection:
		| "loading"
		| "connecting"
		| "connected"
		| "reconnecting"
		| "error"
		| "closed";
	error: string | null;
	participants: Participant[];
};
export type RacesState = {schemaVersion: 1; races: RaceState[]};
export type Settings = {
	spreadsheetId: string | null;
	gameMappingsSheet: string;
	categoryMappingsSheet: string;
	allowedRaceOrigins: string[];
	/** Maximum number of mappings a single Any expansion may produce. */
	maxResolvedMappings: number;
	leaderboardTop: number;
};
export type SettingsState = {revision: number; settings: Settings};
export type MappingSave = {
	expectedRevision: string | null;
	settingsRevision: number;
};
export type FailureCode =
	| "invalid_input"
	| "invalid_url"
	| "not_found"
	| "http_error"
	| "timeout"
	| "aborted"
	| "invalid_payload"
	| "websocket_error"
	| "network_error"
	| "player_manager_unavailable"
	| "spreadsheet_unavailable"
	| "invalid_sheet"
	| "mapping_conflict"
	| "game_mapping_conflict"
	| "game_mapping_missing"
	| "category_not_in_game"
	| "speedrun_unavailable"
	| "expansion_limit_exceeded"
	| "settings_changed"
	| "unsupported_operation"
	| "internal_error";
export type Response<T> =
	| {ok: true; data: T}
	| {
			ok: false;
			error: {code: FailureCode; message: string};
	  };
export type GameMappingList = {
	records: GameMappingRecord[];
	settingsRevision: number;
};
export type CategoryMappingList = {
	records: CategoryMappingRecord[];
	settingsRevision: number;
};
export type SpeedrunPlayer =
	| ({userId: string; name: string; url: string} & {
			displayName?: string;
			personalBest?: SpeedrunPlayerBest;
	  })
	| ({userId: null; name: string; url: null} & {
			displayName?: string;
			personalBest?: SpeedrunPlayerBest;
	  });
export type SpeedrunRun = {
	runId: string;
	url: string;
	/** Validated elapsed time as an ISO 8601 duration. */
	time: string;
	/** Validated ISO 8601 date without a time or timezone. */
	date: string | null;
	players: SpeedrunPlayer[];
};
export type SpeedrunPersonalBestRun = SpeedrunRun & {
	place: number;
	gameId: string;
	categoryId: string;
	levelId: string | null;
	variables: Record<string, string>;
};
export type SpeedrunLeaderboard = {
	mapping: ResolvedCategoryMapping;
	top: number;
	fetchedAt: string;
	state: "ready" | "not_found" | "error";
	entries: Array<{place: number; run: SpeedrunRun}>;
	stale: boolean;
	message?: string;
};
export type SpeedrunPlayerBest = {
	playerId: string | null;
	srcUserId: string | null;
	state: "found" | "not_found" | "unlinked" | "error";
	run: SpeedrunPersonalBestRun | null;
	place: number | null;
	fetchedAt: string | null;
	stale: boolean;
	message?: string;
};
/** Per-worksheet result of preparing a spreadsheet destination. */
export type SpreadsheetSheetOutcome = "created" | "initialized" | "unchanged";
export type SpreadsheetInitialization = {
	gameMappings: SpreadsheetSheetOutcome;
	categoryMappings: SpreadsheetSheetOutcome;
};
/** Explicit destination for spreadsheet initialization (never persisted). */
export type SpreadsheetInitializationSettings = {
	spreadsheetId: string;
	gameMappingsSheet: string;
	categoryMappingsSheet: string;
};
export type Operations = {
	fetchRace: {request: {url: string}; response: ResolvedRace};
	watchRace: {
		request: {url: string};
		response: {watchId: string; state: RaceState & {race: Race}};
	};
	unwatchRace: {request: {watchId: string}; response: {released: boolean}};
	forceUnwatchRace: {
		request: {url: string};
		response: {released: boolean; releasedWatches: number};
	};
	getRace: {request: {url: string}; response: RaceState | null};
	getWatch: {request: {watchId: string}; response: RaceState | null};
	listRaces: {request: undefined; response: RacesState};
	listGameMappings: {request: undefined; response: GameMappingList};
	findGameMapping: {
		request: {categorySlug: string};
		response: {record: GameMappingRecord | null; settingsRevision: number};
	};
	saveGameMapping: {
		request: {mapping: GameMapping} & MappingSave;
		response: {
			record: GameMappingRecord;
			action: "created" | "updated";
			settingsRevision: number;
		};
	};
	deleteGameMapping: {
		request: {
			categorySlug: string;
			expectedRevision: string;
			settingsRevision: number;
		};
		response: {deleted: true; settingsRevision: number};
	};
	listCategoryMappings: {request: undefined; response: CategoryMappingList};
	findCategoryMapping: {
		request: {categorySlug: string; goal: string};
		response: {record: CategoryMappingRecord | null; settingsRevision: number};
	};
	saveCategoryMapping: {
		request: {mapping: CategoryMapping} & MappingSave;
		response: {
			record: CategoryMappingRecord;
			action: "created" | "updated";
			settingsRevision: number;
		};
	};
	deleteCategoryMapping: {
		request: {
			categorySlug: string;
			goal: string;
			expectedRevision: string;
			settingsRevision: number;
		};
		response: {deleted: true; settingsRevision: number};
	};
	resolveCategoryMapping: {
		request: {categorySlug: string; goal: string};
		response: ResolveCategoryMappingResult;
	};
	getSpeedrunLeaderboards: {
		request: {categorySlug: string; goal: string; refresh?: boolean};
		response: ResolveCategoryMappingResult & {
			leaderboards?: SpeedrunLeaderboard[];
			fetchedAt?: string;
			stale?: boolean;
			top?: number;
		};
	};
	getSpeedrunPlayerBests: {
		request: {
			categorySlug: string;
			goal: string;
			playerIds: string[];
			refresh?: boolean;
		};
		response: ResolveCategoryMappingResult & {
			results?: Array<{
				mapping: ResolvedCategoryMapping;
				players: SpeedrunPlayerBest[];
			}>;
			fetchedAt?: string;
			stale?: boolean;
		};
	};
	searchSpeedrunGames: {
		request: {query: string};
		response: {games: SpeedrunGameSummary[]};
	};
	getSpeedrunGameOptions: {
		request: {gameId: string};
		response: SpeedrunGameOptions;
	};
	getSpeedrunCategoryVariables: {
		request: {categoryId: string};
		response: {variables: SpeedrunVariableOption[]};
	};
	initializeSpreadsheet: {
		request: {settings: SpreadsheetInitializationSettings};
		response: SpreadsheetInitialization;
	};
	getSettings: {request: undefined; response: SettingsState};
	updateSettings: {
		request: {settings: Settings; expectedRevision: number};
		response: SettingsState;
	};
};
export const OPERATIONS = [
	"fetchRace",
	"watchRace",
	"unwatchRace",
	"forceUnwatchRace",
	"getRace",
	"getWatch",
	"listRaces",
	"listGameMappings",
	"findGameMapping",
	"saveGameMapping",
	"deleteGameMapping",
	"listCategoryMappings",
	"findCategoryMapping",
	"saveCategoryMapping",
	"deleteCategoryMapping",
	"resolveCategoryMapping",
	"getSpeedrunLeaderboards",
	"getSpeedrunPlayerBests",
	"searchSpeedrunGames",
	"getSpeedrunGameOptions",
	"getSpeedrunCategoryVariables",
	"initializeSpreadsheet",
	"getSettings",
	"updateSettings",
] as const satisfies readonly (keyof Operations)[];
export const operationMessageName = <K extends keyof Operations>(
	operation: K,
): `racetime.v4.${K}` => `${MESSAGE_PREFIX}.${operation}`;
export type RaceTimeAPI = {
	apiVersion: 4;
	request<K extends keyof Operations>(
		operation: K,
		request: Operations[K]["request"],
	): Promise<Response<Operations[K]["response"]>>;
};
