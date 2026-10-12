import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	ResolveCategoryMappingResult,
} from "./category.js";
import type {
	SpeedrunGameOptions,
	SpeedrunGameSummary,
	SpeedrunVariableOption,
} from "./speedrun.js";

export type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	MappingRecord,
	ResolveCategoryMappingResult,
	ResolvedCategoryMapping,
	SpeedrunCategorySelection,
	TimingMethod,
} from "./category.js";
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

export const BUNDLE_NAME = "racetime-integration";
export const API_VERSION = 2;
export const MESSAGE_PREFIX = "racetime.v2";
export const RACES_REPLICANT = "racetime-races";
export const SETTINGS_REPLICANT = "racetime-settings";
export type PlayerSnapshot = {
	playerId: string;
	revision: number;
	displayName: string;
	racetime: {userId: string; name: string} | null;
	speedrunCom: {userId: string; name: string} | null;
	twitch: {userId: string | null; login: string; displayName?: string} | null;
	youtube: string | null;
};
export type RaceResult = {
	userId: string;
	name: string;
	place: number | null;
	time: string | null;
	status: "finished" | "dnf" | "dq" | "other";
};
export type Entrant = {
	userId: string;
	name: string;
	twitchLogin: string | null;
	status: string;
	finishTime: string | null;
	place: number | null;
};
export type Race = {
	raceId: string;
	url: string;
	version: number;
	name: string;
	status: string;
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
	connection: "loading" | "connecting" | "connected" | "reconnecting" | "error";
	error: string | null;
	participants: Participant[];
};
export type RacesState = {schemaVersion: 1; races: RaceState[]};
export type Settings = {
	spreadsheetId: string | null;
	gameMappingsSheet: string;
	categoryMappingsSheet: string;
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
	fetchRace: {request: {url: string}; response: Race};
	watchRace: {
		request: {url: string};
		response: {watchId: string; state: RaceState & {race: Race}};
	};
	unwatchRace: {request: {watchId: string}; response: {released: boolean}};
	getRace: {request: {url: string}; response: RaceState | null};
	getWatch: {request: {watchId: string}; response: RaceState | null};
	listRaces: {request: undefined; response: RacesState};
	resolveParticipants: {request: {url: string}; response: Participant[]};
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
	"getRace",
	"getWatch",
	"listRaces",
	"resolveParticipants",
	"listGameMappings",
	"findGameMapping",
	"saveGameMapping",
	"deleteGameMapping",
	"listCategoryMappings",
	"findCategoryMapping",
	"saveCategoryMapping",
	"deleteCategoryMapping",
	"resolveCategoryMapping",
	"searchSpeedrunGames",
	"getSpeedrunGameOptions",
	"getSpeedrunCategoryVariables",
	"initializeSpreadsheet",
	"getSettings",
	"updateSettings",
] as const satisfies readonly (keyof Operations)[];
export const operationMessageName = <K extends keyof Operations>(
	operation: K,
): `racetime.v2.${K}` => `${MESSAGE_PREFIX}.${operation}`;
export type RaceTimeAPI = {
	apiVersion: 2;
	request<K extends keyof Operations>(
		operation: K,
		request: Operations[K]["request"],
	): Promise<Response<Operations[K]["response"]>>;
};
