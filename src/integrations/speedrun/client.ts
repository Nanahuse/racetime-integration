// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import type {
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
	TimingMethod,
} from "@nanahuse/racetime-protocol";
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

	private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
		const entry = this.cache.get(key);
		if (entry && entry.expires > Date.now())
			return Promise.resolve(entry.value as T);
		const promise = load().catch((error) => {
			this.cache.delete(key);
			throw error;
		});
		return promise.then((value) => {
			this.cache.set(key, {expires: Date.now() + CACHE_TTL_MS, value});
			return value;
		});
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
}
