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
export type Entrant = {
	userId: string;
	name: string;
	twitchLogin: string | null;
	status: string;
	finishTime: string | null;
	place: number | null;
};
export type Race = {
	url: string;
	version: number;
	name: string;
	status: string;
	category: {slug: string; name: string; goal: string};
	entrants: Entrant[];
};
export type Participant = {
	racetimeUserId: string;
	status: "matched" | "unresolved" | "ambiguous" | "conflict" | "unavailable";
	playerId: string | null;
	candidatePlayerIds: string[];
	message: string;
};
export type RaceState = {
	url: string;
	race: Race | null;
	connection: "loading" | "connecting" | "connected" | "reconnecting" | "error";
	error: string | null;
	participants: Participant[];
};
export type RacesState = {schemaVersion: 1; races: RaceState[]};
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
		response: {watchId: string; state: RaceState};
	};
	unwatchRace: {request: {watchId: string}; response: {released: boolean}};
	getRace: {request: {url: string}; response: RaceState | null};
	listRaces: {request: undefined; response: RacesState};
	resolveParticipants: {request: {url: string}; response: Participant[]};
	findCategoryMapping: {
		request: {categorySlug: string; goal: string};
		response: CategoryMapping | null;
	};
	saveCategoryMapping: {
		request: {mapping: CategoryMapping};
		response: CategoryMapping;
	};
};
export const OPERATIONS = [
	"fetchRace",
	"watchRace",
	"unwatchRace",
	"getRace",
	"listRaces",
	"resolveParticipants",
	"findCategoryMapping",
	"saveCategoryMapping",
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
