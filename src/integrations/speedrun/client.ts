// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import type {
	ResolvedCategoryMapping,
	SpeedrunCategoryOption,
	SpeedrunGame,
	SpeedrunGameOptions,
	SpeedrunGameSummary,
	SpeedrunLeaderboard,
	SpeedrunLevelOption,
	SpeedrunPlatformOption,
	SpeedrunRegionOption,
	SpeedrunRun,
	SpeedrunTimingMethods,
	SpeedrunVariableOption,
	SpeedrunVariableValueOption,
	TimingMethod,
} from "@nanahuse/racetime-protocol";
import {parseRaceDuration} from "@nanahuse/racetime-protocol";
import {SpeedrunError, SpeedrunNotFoundError} from "./errors";

export const SPEEDRUN_API_BASE_URL = "https://www.speedrun.com/api/v1";
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const SEARCH_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface SpeedrunClient {
	searchGames(query: string): Promise<SpeedrunGameSummary[]>;
	getGameOptions(gameId: string): Promise<SpeedrunGameOptions>;
	getCategoryVariables(categoryId: string): Promise<SpeedrunVariableOption[]>;
	getCategoryGameId(categoryId: string): Promise<string>;
	getLeaderboard?(
		mapping: ResolvedCategoryMapping,
		top: number,
		refresh?: boolean,
	): Promise<SpeedrunLeaderboard>;
	getUserRuns?(
		userId: string,
		mapping: ResolvedCategoryMapping,
		refresh?: boolean,
	): Promise<SpeedrunRun[]>;
	getUserPersonalBests?(
		userId: string,
		mapping: ResolvedCategoryMapping,
		refresh?: boolean,
	): Promise<string[]>;
}

type Fetcher = (
	url: string,
	init: {headers: Record<string, string>; signal: AbortSignal},
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value))
		throw new SpeedrunError("invalid_payload", `${path} must be an object.`);
	return value;
}

function requireString(
	record: Record<string, unknown>,
	key: string,
	path: string,
): string {
	const value = record[key];
	if (typeof value !== "string" || value === "")
		throw new SpeedrunError(
			"invalid_payload",
			`${path}.${key} must be a non-empty string.`,
		);
	return value;
}

function requireBoolean(
	record: Record<string, unknown>,
	key: string,
	path: string,
): boolean {
	const value = record[key];
	if (typeof value !== "boolean")
		throw new SpeedrunError(
			"invalid_payload",
			`${path}.${key} must be a boolean.`,
		);
	return value;
}

function requireDuration(value: unknown, path: string): string {
	if (typeof value !== "string")
		throw new SpeedrunError(
			"invalid_payload",
			`${path} must be an ISO 8601 duration.`,
		);
	try {
		parseRaceDuration(value);
	} catch (cause) {
		throw new SpeedrunError(
			"invalid_payload",
			`${path} must be an ISO 8601 duration.`,
			{cause},
		);
	}
	return value;
}

function optionalDuration(value: unknown, path: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string")
		throw new SpeedrunError("invalid_payload", `${path} is not a duration.`);
	return requireDuration(value, path);
}

function optionalStringArray(
	record: Record<string, unknown>,
	key: string,
	path: string,
): string[] {
	const value = record[key];
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value))
		throw new SpeedrunError(
			"invalid_payload",
			`${path}.${key} must be an array.`,
		);
	return value.filter((item): item is string => typeof item === "string");
}

function internationalName(
	record: Record<string, unknown>,
	path: string,
): string {
	const names = requireRecord(record.names, `${path}.names`);
	return requireString(names, "international", `${path}.names`);
}

function timingMethodsFromRunTimes(
	runTimes: readonly string[],
): SpeedrunTimingMethods {
	return {
		realtime: runTimes.includes("realtime"),
		realtimeNoLoads: runTimes.includes("realtime_noloads"),
		ingame: runTimes.includes("ingame"),
	};
}

function toTimingMethodList(methods: SpeedrunTimingMethods): TimingMethod[] {
	const list: TimingMethod[] = [];
	if (methods.realtime) list.push("realtime");
	if (methods.realtimeNoLoads) list.push("realtime_noloads");
	if (methods.ingame) list.push("ingame");
	return list;
}

export function mapGameSummary(value: unknown): SpeedrunGameSummary {
	const record = requireRecord(value, "game");
	return {
		id: requireString(record, "id", "game"),
		name: internationalName(record, "game"),
		abbreviation: requireString(record, "abbreviation", "game"),
	};
}

function mapGame(value: unknown): SpeedrunGame {
	const record = requireRecord(value, "game");
	const ruleset = isRecord(record.ruleset) ? record.ruleset : {};
	const runTimes = optionalStringArray(ruleset, "run-times", "game.ruleset");
	return {
		...mapGameSummary(value),
		platformIds: optionalStringArray(record, "platforms", "game"),
		regionIds: optionalStringArray(record, "regions", "game"),
		timingMethods: timingMethodsFromRunTimes(runTimes),
	};
}

function mapCategory(value: unknown): SpeedrunCategoryOption {
	const record = requireRecord(value, "category");
	const type = record.type;
	if (type !== "per-game" && type !== "per-level")
		throw new SpeedrunError(
			"invalid_payload",
			'category.type must be "per-game" or "per-level".',
		);
	return {
		id: requireString(record, "id", "category"),
		name: requireString(record, "name", "category"),
		type,
		miscellaneous:
			typeof record.miscellaneous === "boolean" ? record.miscellaneous : false,
	};
}

function mapLevel(value: unknown): SpeedrunLevelOption {
	const record = requireRecord(value, "level");
	return {
		id: requireString(record, "id", "level"),
		name: requireString(record, "name", "level"),
	};
}

function mapVariable(value: unknown): SpeedrunVariableOption {
	const record = requireRecord(value, "variable");
	const valuesWrapper = requireRecord(record.values, "variable.values");
	const valuesMap = isRecord(valuesWrapper.values) ? valuesWrapper.values : {};
	const values: SpeedrunVariableValueOption[] = [];
	for (const [id, entry] of Object.entries(valuesMap)) {
		const entryRecord = requireRecord(entry, `variable.values.values.${id}`);
		values.push({
			id,
			label: typeof entryRecord.label === "string" ? entryRecord.label : id,
		});
	}
	return {
		id: requireString(record, "id", "variable"),
		name: requireString(record, "name", "variable"),
		mandatory: record.mandatory === true,
		userDefined: record["user-defined"] === true,
		obsoletes: requireBoolean(record, "obsoletes", "variable"),
		values,
	};
}

function mapPlatform(value: unknown): SpeedrunPlatformOption {
	const record = requireRecord(value, "platform");
	return {
		id: requireString(record, "id", "platform"),
		name: requireString(record, "name", "platform"),
	};
}

function mapRegion(value: unknown): SpeedrunRegionOption {
	const record = requireRecord(value, "region");
	return {
		id: requireString(record, "id", "region"),
		name: requireString(record, "name", "region"),
	};
}

/**
 * The category detail endpoint links to the owning game rather than embedding
 * its id: `{"links": [{"rel": "game", "uri": ".../games/<id>"}]}`.
 */
function gameIdFromCategory(value: unknown): string {
	const category = requireRecord(value, "category");
	const links = category.links;
	if (!Array.isArray(links))
		throw new SpeedrunError(
			"invalid_payload",
			"category.links must be an array.",
		);
	for (const entry of links) {
		if (!isRecord(entry) || entry.rel !== "game") continue;
		if (typeof entry.uri !== "string" || entry.uri === "")
			throw new SpeedrunError(
				"invalid_payload",
				'category game link must include a non-empty "uri".',
			);
		return gameIdFromLinkUri(entry.uri);
	}
	throw new SpeedrunError(
		"invalid_payload",
		'category.links must include a link with rel "game".',
	);
}

function gameIdFromLinkUri(uri: string): string {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		throw new SpeedrunError(
			"invalid_payload",
			`category game link uri is not a valid URL: ${uri}`,
		);
	}
	const base = new URL(`${SPEEDRUN_API_BASE_URL}/games/`);
	if (
		url.protocol !== base.protocol ||
		url.host !== base.host ||
		!url.pathname.startsWith(base.pathname)
	)
		throw new SpeedrunError(
			"invalid_payload",
			`category game link uri is not a Speedrun.com games URL: ${uri}`,
		);
	let id: string;
	try {
		id = decodeURIComponent(url.pathname.slice(base.pathname.length));
	} catch {
		throw new SpeedrunError(
			"invalid_payload",
			`category game link uri has an invalid game id: ${uri}`,
		);
	}
	if (!/^[A-Za-z0-9_-]+$/.test(id))
		throw new SpeedrunError(
			"invalid_payload",
			`category game link uri has an invalid game id: ${uri}`,
		);
	return id;
}

type CacheEntry = {expires: number; value: unknown};

export class HttpSpeedrunClient implements SpeedrunClient {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly pending = new Map<string, Promise<unknown>>();
	private activeRequests = 0;
	private readonly requestWaiters: Array<() => void> = [];
	private async acquireRequestSlot(): Promise<() => void> {
		if (this.activeRequests >= 4)
			await new Promise<void>((resolve) => this.requestWaiters.push(resolve));
		else this.activeRequests++;
		return () => {
			const next = this.requestWaiters.shift();
			if (next) next();
			else this.activeRequests--;
		};
	}
	constructor(
		private readonly options: {
			fetchImpl?: Fetcher;
			userAgent?: string;
			timeoutMs?: number;
		} = {},
	) {}

	private async request(path: string, query: Record<string, string | number>) {
		const url = new URL(`${SPEEDRUN_API_BASE_URL}${path}`);
		for (const [key, value] of Object.entries(query))
			url.searchParams.set(key, String(value));
		const fetcher =
			this.options.fetchImpl ?? (globalThis.fetch as unknown as Fetcher);
		const controller = new AbortController();
		const release = await this.acquireRequestSlot();
		const timer = setTimeout(
			() => controller.abort(),
			this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		let response: Response;
		try {
			response = await fetcher(url.toString(), {
				headers: {
					accept: "application/json",
					"user-agent":
						this.options.userAgent ?? "racetime-integration/speedruncom",
				},
				signal: controller.signal,
			});
		} catch (cause) {
			throw new SpeedrunError(
				"network_error",
				`Speedrun.com request failed for "${path}".`,
				{cause},
			);
		} finally {
			clearTimeout(timer);
			release();
		}
		if (response.status === 404)
			throw new SpeedrunNotFoundError(
				`Speedrun.com resource not found: ${path}`,
			);
		if (!response.ok)
			throw new SpeedrunError(
				"speedrun_unavailable",
				`Speedrun.com responded with ${response.status} for "${path}".`,
			);
		try {
			return (await response.json()) as unknown;
		} catch (cause) {
			throw new SpeedrunError(
				"invalid_payload",
				`Speedrun.com returned invalid JSON for "${path}".`,
				{cause},
			);
		}
	}

	private async single<R>(
		path: string,
		map: (value: unknown) => R,
	): Promise<R> {
		const envelope = requireRecord(await this.request(path, {}), "response");
		if (!("data" in envelope))
			throw new SpeedrunError("invalid_payload", "response.data is missing.");
		return map(envelope.data);
	}

	private async collection<R>(
		path: string,
		map: (value: unknown) => R,
		query: Record<string, string | number> = {},
		limit = Number.POSITIVE_INFINITY,
	): Promise<R[]> {
		const results: R[] = [];
		for (let page = 0; page < MAX_PAGES && results.length < limit; page += 1) {
			const pageSize = Math.min(PAGE_SIZE, limit - results.length);
			const envelope = requireRecord(
				await this.request(path, {
					...query,
					max: pageSize,
					offset: results.length,
				}),
				"response",
			);
			if (!Array.isArray(envelope.data))
				throw new SpeedrunError(
					"invalid_payload",
					"response.data must be an array.",
				);
			results.push(...envelope.data.slice(0, pageSize).map(map));
			const pagination = isRecord(envelope.pagination)
				? envelope.pagination
				: {};
			const size = pagination.size;
			if (typeof size !== "number" || size < pageSize) break;
		}
		return results;
	}

	private cached<T>(
		key: string,
		load: () => Promise<T>,
		refresh = false,
	): Promise<T> {
		const entry = this.cache.get(key);
		if (!refresh && entry && entry.expires > Date.now())
			return Promise.resolve(entry.value as T);
		const active = this.pending.get(key);
		if (active) return active as Promise<T>;
		const promise = load()
			.then((value) => {
				this.cache.set(key, {expires: Date.now() + CACHE_TTL_MS, value});
				return value;
			})
			.finally(() => this.pending.delete(key));
		this.pending.set(key, promise);
		return promise;
	}

	private async paginated<R>(
		path: string,
		query: Record<string, string | number>,
		map: (value: unknown) => R | null,
	): Promise<R[]> {
		const results: R[] = [];
		const seenPages = new Set<string>();
		let offset = 0;
		for (;;) {
			if (!Number.isSafeInteger(offset))
				throw new SpeedrunError(
					"invalid_payload",
					"Speedrun.com pagination offset exceeded the safe integer range.",
				);
			const envelope = requireRecord(
				await this.request(path, {...query, max: PAGE_SIZE, offset}),
				"response",
			);
			if (!Array.isArray(envelope.data))
				throw new SpeedrunError(
					"invalid_payload",
					"response.data must be an array.",
				);
			const pagination = requireRecord(
				envelope.pagination,
				"response.pagination",
			);
			const size = pagination.size;
			if (
				typeof size !== "number" ||
				!Number.isSafeInteger(size) ||
				size < 0 ||
				size > PAGE_SIZE ||
				size !== envelope.data.length
			)
				throw new SpeedrunError(
					"invalid_payload",
					"Speedrun.com pagination size does not match response.data.",
				);
			if (pagination.offset !== undefined && pagination.offset !== offset)
				throw new SpeedrunError(
					"invalid_payload",
					"Speedrun.com pagination offset did not advance as requested.",
				);
			if (pagination.max !== undefined && pagination.max !== PAGE_SIZE)
				throw new SpeedrunError(
					"invalid_payload",
					"Speedrun.com pagination max changed during the search.",
				);
			const page = envelope.data.map(map);
			results.push(...page.filter((value): value is R => value !== null));
			if (size < PAGE_SIZE) return results;
			const fingerprint = JSON.stringify(
				envelope.data.map((item) => {
					if (!isRecord(item)) return null;
					if (isRecord(item.run)) return item.run.id ?? null;
					return item.id ?? null;
				}),
			);
			if (seenPages.has(fingerprint))
				throw new SpeedrunError(
					"invalid_payload",
					"Speedrun.com repeated a full page without advancing pagination.",
				);
			seenPages.add(fingerprint);
			const nextOffset = offset + size;
			if (nextOffset <= offset)
				throw new SpeedrunError(
					"invalid_payload",
					"Speedrun.com pagination did not make progress.",
				);
			offset = nextOffset;
		}
	}

	getLeaderboard(
		mapping: ResolvedCategoryMapping,
		top: number,
		refresh = false,
	): Promise<SpeedrunLeaderboard> {
		const {game, category} = mapping;
		const path = category.levelId
			? `/leaderboards/${encodeURIComponent(game.gameId)}/level/${encodeURIComponent(category.levelId)}/${encodeURIComponent(category.categoryId)}`
			: `/leaderboards/${encodeURIComponent(game.gameId)}/category/${encodeURIComponent(category.categoryId)}`;
		const query: Record<string, string | number> = {top, embed: "players"};
		if (category.platformId) query.platform = category.platformId;
		if (category.regionId) query.region = category.regionId;
		if (category.emulator !== null)
			query.emulators = category.emulator ? "true" : "false";
		if (category.timingMethod) query.timing = category.timingMethod;
		for (const [id, value] of Object.entries(category.variables))
			query[`var-${id}`] = value;
		return this.cached(
			`leaderboard:${mapping.key}:${top}`,
			async () => {
				const envelope = requireRecord(
					await this.request(path, query),
					"response",
				);
				const board = requireRecord(envelope.data, "leaderboard");
				if (
					board.game !== game.gameId ||
					board.category !== category.categoryId ||
					(board.level ?? null) !== category.levelId
				)
					throw new SpeedrunError(
						"invalid_payload",
						"Leaderboard response does not match the requested game/category/level.",
					);
				if (
					category.platformId !== null &&
					board.platform !== category.platformId
				)
					throw new SpeedrunError(
						"invalid_payload",
						"Leaderboard response has a different platform filter.",
					);
				if (category.regionId !== null && board.region !== category.regionId)
					throw new SpeedrunError(
						"invalid_payload",
						"Leaderboard response has a different region filter.",
					);
				if (category.emulator !== null && board.emulators !== category.emulator)
					throw new SpeedrunError(
						"invalid_payload",
						"Leaderboard response has a different emulator filter.",
					);
				if (
					category.timingMethod !== null &&
					board.timing !== category.timingMethod
				)
					throw new SpeedrunError(
						"invalid_payload",
						"Leaderboard response has a different timing filter.",
					);
				if (!isRecord(board.values))
					throw new SpeedrunError(
						"invalid_payload",
						"Leaderboard response has invalid variable filters.",
					);
				const boardValues = board.values as Record<string, unknown>;
				if (
					Object.entries(category.variables).some(
						([id, value]) => boardValues[id] !== value,
					)
				)
					throw new SpeedrunError(
						"invalid_payload",
						"Leaderboard response has different variable filters.",
					);
				if (!Array.isArray(board.runs))
					throw new SpeedrunError(
						"invalid_payload",
						"leaderboard.runs must be an array.",
					);
				if (!Array.isArray(board.players))
					throw new SpeedrunError(
						"invalid_payload",
						"leaderboard.players must contain the embedded player list.",
					);
				const embeddedPlayers = board.players;
				const playerIndex = new Map<string, SpeedrunRun["players"][number]>();
				for (const raw of embeddedPlayers) {
					if (!isRecord(raw)) continue;
					if (raw.rel === "user" && typeof raw.id === "string") {
						const names = isRecord(raw.names) ? raw.names : {};
						const name =
							typeof names.international === "string"
								? names.international
								: raw.id;
						playerIndex.set(`user:${raw.id}`, {
							userId: raw.id,
							name,
							url:
								typeof raw.weblink === "string"
									? raw.weblink
									: `https://www.speedrun.com/users/${encodeURIComponent(raw.id)}`,
						});
					} else if (raw.rel === "guest" && typeof raw.name === "string") {
						playerIndex.set(`guest:${raw.name}`, {
							userId: null,
							name: raw.name,
							url: null,
						});
					}
				}
				const entries = board.runs.flatMap((raw, index) => {
					const item = requireRecord(raw, `leaderboard.runs[${index}]`);
					if (
						typeof item.place !== "number" ||
						!Number.isSafeInteger(item.place) ||
						item.place < 1
					)
						throw new SpeedrunError(
							"invalid_payload",
							"leaderboard place is invalid.",
						);
					const run = requireRecord(item.run, `leaderboard.runs[${index}].run`);
					const id = requireString(run, "id", `leaderboard.runs[${index}].run`);
					const times = requireRecord(run.times, `run ${id}.times`);
					const time = category.timingMethod
						? times[category.timingMethod]
						: times.primary;
					const duration = optionalDuration(time, `run ${id} leaderboard time`);
					if (duration === null) return [];
					const players: SpeedrunRun["players"] = Array.isArray(run.players)
						? run.players.map((player): SpeedrunRun["players"][number] => {
								if (!isRecord(player))
									throw new SpeedrunError(
										"invalid_payload",
										`run ${id} has invalid player data.`,
									);
								if (player.rel === "user" && typeof player.id === "string") {
									const embedded = playerIndex.get(`user:${player.id}`);
									if (embedded) return embedded;
								}
								if (player.rel === "guest" && typeof player.name === "string") {
									const embedded = playerIndex.get(`guest:${player.name}`);
									if (embedded) return embedded;
								}
								throw new SpeedrunError(
									"invalid_payload",
									`run ${id} has an unknown player reference.`,
								);
							})
						: [];
					if (!Array.isArray(run.players))
						throw new SpeedrunError(
							"invalid_payload",
							`run ${id}.players must be an array.`,
						);
					return [
						{
							place: item.place,
							run: {
								runId: id,
								url:
									typeof run.weblink === "string"
										? run.weblink
										: `https://www.speedrun.com/runs/${encodeURIComponent(id)}`,
								time: duration,
								date: typeof run.date === "string" ? run.date : null,
								players,
							},
						},
					];
				});
				return {
					mapping,
					top,
					fetchedAt: new Date().toISOString(),
					state: entries.length ? "ready" : "not_found",
					entries,
					stale: false,
				};
			},
			refresh,
		);
	}

	getUserRuns(
		userId: string,
		mapping: ResolvedCategoryMapping,
		refresh = false,
	): Promise<SpeedrunRun[]> {
		const {game, category} = mapping;
		const query: Record<string, string | number> = {
			user: userId,
			game: game.gameId,
			category: category.categoryId,
			status: "verified",
			embed: "players",
		};
		if (category.levelId) query.level = category.levelId;
		if (category.platformId) query.platform = category.platformId;
		if (category.regionId) query.region = category.regionId;
		if (category.emulator !== null)
			query.emulated = category.emulator ? "yes" : "no";
		return this.cached(
			`runs:${userId}:${mapping.key}`,
			() =>
				this.paginated("/runs", query, (value) => {
					const run = requireRecord(value, "run");
					const status = requireRecord(run.status, "run.status");
					const statusName = requireString(status, "status", "run.status");
					if (statusName !== "verified") return null;
					const id = requireString(run, "id", "run");
					if (
						run.game !== game.gameId ||
						run.category !== category.categoryId ||
						(run.level ?? null) !== category.levelId
					)
						return null;
					const players = run.players;
					if (!Array.isArray(players))
						throw new SpeedrunError(
							"invalid_payload",
							`run ${id}.players must be an array.`,
						);
					if (
						!players.some(
							(player) =>
								isRecord(player) &&
								player.rel === "user" &&
								player.id === userId,
						)
					)
						return null;
					const system =
						category.platformId !== null ||
						category.regionId !== null ||
						category.emulator !== null
							? requireRecord(run.system, `run ${id}.system`)
							: isRecord(run.system)
								? run.system
								: {};
					if (
						category.platformId !== null &&
						system.platform !== category.platformId
					)
						return null;
					if (category.regionId !== null && system.region !== category.regionId)
						return null;
					if (
						category.emulator !== null &&
						system.emulated !== category.emulator
					)
						return null;
					const categoryValues = Object.entries(category.variables);
					const values = categoryValues.length
						? requireRecord(run.values, `run ${id}.values`)
						: isRecord(run.values)
							? run.values
							: {};
					if (
						categoryValues.some(
							([variableId, expected]) => values[variableId] !== expected,
						)
					)
						return null;
					const times = requireRecord(run.times, `run ${id}.times`);
					const time = category.timingMethod
						? times[category.timingMethod]
						: times.primary;
					const duration = optionalDuration(time, `run ${id} requested time`);
					if (duration === null) return null;
					const mappedPlayers: SpeedrunRun["players"] = players.flatMap(
						(player): SpeedrunRun["players"] => {
							if (!isRecord(player)) return [];
							if (player.rel === "user" && typeof player.id === "string") {
								const names = isRecord(player.names) ? player.names : {};
								return [
									{
										userId: player.id,
										name:
											typeof names.international === "string"
												? names.international
												: player.id,
										url:
											typeof player.weblink === "string"
												? player.weblink
												: `https://www.speedrun.com/users/${encodeURIComponent(player.id)}`,
									},
								];
							}
							if (player.rel === "guest" && typeof player.name === "string")
								return [{userId: null, name: player.name, url: null}];
							return [];
						},
					);
					return {
						runId: id,
						url:
							typeof run.weblink === "string"
								? run.weblink
								: `https://www.speedrun.com/runs/${encodeURIComponent(id)}`,
						time: duration,
						date: typeof run.date === "string" ? run.date : null,
						players: mappedPlayers,
					};
				}),
			refresh,
		);
	}

	searchGames(query: string): Promise<SpeedrunGameSummary[]> {
		return this.collection(
			`/games`,
			mapGameSummary,
			{name: query},
			SEARCH_LIMIT,
		);
	}

	getGameOptions(gameId: string): Promise<SpeedrunGameOptions> {
		return this.cached(`options:${gameId}`, async () => {
			const [game, categories, levels, platforms, regions] = await Promise.all([
				this.cached(`game:${gameId}`, () =>
					this.single(`/games/${encodeURIComponent(gameId)}`, mapGame),
				),
				this.cached(`categories:${gameId}`, () =>
					this.collection(
						`/games/${encodeURIComponent(gameId)}/categories`,
						mapCategory,
					),
				),
				this.cached(`levels:${gameId}`, () =>
					this.collection(
						`/games/${encodeURIComponent(gameId)}/levels`,
						mapLevel,
					),
				),
				this.cached("platforms", () =>
					this.collection(`/platforms`, mapPlatform),
				),
				this.cached("regions", () => this.collection(`/regions`, mapRegion)),
			]);
			return {
				game,
				categories,
				levels,
				platforms: game.platformIds
					.map((id) => platforms.find((platform) => platform.id === id))
					.filter((platform): platform is SpeedrunPlatformOption => !!platform),
				regions: game.regionIds
					.map((id) => regions.find((region) => region.id === id))
					.filter((region): region is SpeedrunRegionOption => !!region),
				timingMethods: toTimingMethodList(game.timingMethods),
			};
		});
	}

	getCategoryVariables(categoryId: string): Promise<SpeedrunVariableOption[]> {
		return this.cached(`variables:${categoryId}`, () =>
			this.collection(
				`/categories/${encodeURIComponent(categoryId)}/variables`,
				mapVariable,
			),
		);
	}

	getCategoryGameId(categoryId: string): Promise<string> {
		return this.cached(`category-game:${categoryId}`, () =>
			this.single(
				`/categories/${encodeURIComponent(categoryId)}`,
				gameIdFromCategory,
			),
		);
	}

	getUserPersonalBests(
		userId: string,
		mapping: ResolvedCategoryMapping,
		refresh = false,
	): Promise<string[]> {
		const path = `/users/${encodeURIComponent(userId)}/personal-bests`;
		return this.cached(
			`pbs:${userId}:${mapping.game.gameId}`,
			() =>
				this.paginated(
					path,
					{game: mapping.game.gameId, embed: "players"},
					(raw) => {
						const entry = requireRecord(raw, "personal-bests entry");
						const run = requireRecord(entry.run, "personal-bests entry.run");
						const id = requireString(run, "id", "personal-bests entry.run");
						const status = requireRecord(run.status, `run ${id}.status`);
						if (
							requireString(status, "status", `run ${id}.status`) !== "verified"
						)
							throw new SpeedrunError(
								"invalid_payload",
								`Personal Bests included a non-verified run ${id}.`,
							);
						return id;
					},
				),
			refresh,
		);
	}
}
