import type {CategoryMapping} from "./category.js";

export type {
	CategoryMapping,
	SpeedrunCategorySelection,
	TimingMethod,
} from "./category.js";

export const BUNDLE_NAME = "racetime-integration";
export const API_VERSION = 1;
export const MESSAGE_PREFIX = "racetime.v1";
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
	categoryMappingsSheet: string;
};
export type SettingsState = {revision: number; settings: Settings};
export type MappingRecord = {mapping: CategoryMapping; revision: string};
export type MappingSave = {
	mapping: CategoryMapping;
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
	| "settings_changed"
	| "unsupported_operation"
	| "internal_error";
export type Response<T> =
	| {ok: true; data: T}
	| {
			ok: false;
			error: {code: FailureCode; message: string};
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
	findCategoryMapping: {
		request: {categorySlug: string; goal: string};
		response: {record: MappingRecord | null; settingsRevision: number};
	};
	saveCategoryMapping: {
		request: MappingSave;
		response: {
			record: MappingRecord;
			action: "created" | "updated";
			settingsRevision: number;
		};
	};
	listCategoryMappings: {
		request: undefined;
		response: {records: MappingRecord[]; settingsRevision: number};
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
	"findCategoryMapping",
	"saveCategoryMapping",
	"listCategoryMappings",
	"deleteCategoryMapping",
	"getSettings",
	"updateSettings",
] as const satisfies readonly (keyof Operations)[];
export const operationMessageName = <K extends keyof Operations>(
	operation: K,
): `racetime.v1.${K}` => `${MESSAGE_PREFIX}.${operation}`;
export type RaceTimeAPI = {
	apiVersion: 1;
	request<K extends keyof Operations>(
		operation: K,
		request: Operations[K]["request"],
	): Promise<Response<Operations[K]["response"]>>;
};
