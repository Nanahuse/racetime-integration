// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import {
	parseRaceDuration,
	parseRaceInstant,
	type RaceDuration,
	type RaceInstant,
} from "@nanahuse/racetime-protocol";
import {
	RaceNotFoundError,
	RaceTimeAbortedError,
	RaceTimeError,
	RaceTimeHttpError,
	RaceTimeNetworkError,
	RaceTimePayloadError,
	RaceTimeTimeoutError,
} from "./errors";
import type {RaceTimeEntrantDto, RaceTimeRaceDto} from "./types";
import type {CanonicalRaceUrl} from "./url";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface RaceTimeClient {
	fetchRaceDetail(
		canonical: CanonicalRaceUrl,
		signal?: AbortSignal,
	): Promise<RaceTimeRaceDto>;
}

export type HttpRaceTimeClientOptions = {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new RaceTimePayloadError(`${path} must be an object.`);
	}
	return value;
}

function requireString(
	record: Record<string, unknown>,
	key: string,
	path: string,
): string {
	const value = record[key];
	if (typeof value !== "string") {
		throw new RaceTimePayloadError(`${path} must be a string.`);
	}
	return value;
}

function optionalString(
	record: Record<string, unknown>,
	key: string,
	path: string,
): string | null {
	const value = record[key];
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "string") {
		throw new RaceTimePayloadError(`${path} must be a string or null.`);
	}
	return value;
}

function optionalDuration(
	record: Record<string, unknown>,
	key: string,
	path: string,
): RaceDuration | null {
	const value = record[key];
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "string") {
		throw new RaceTimePayloadError(`${path} must be a string or null.`);
	}
	try {
		return parseRaceDuration(value);
	} catch (error) {
		throw new RaceTimePayloadError(
			`${path} must be a valid ISO 8601 duration.`,
			{cause: error},
		);
	}
}

function requireNumber(
	record: Record<string, unknown>,
	key: string,
	path: string,
): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new RaceTimePayloadError(`${path} must be a number.`);
	}
	return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
	const value = record[key];
	if (typeof value !== "boolean") {
		throw new RaceTimePayloadError(`race.${key} must be a boolean.`);
	}
	return value;
}

function requireCount(record: Record<string, unknown>, key: string): number {
	const value = requireNumber(record, key, `race.${key}`);
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RaceTimePayloadError(
			`race.${key} must be a non-negative safe integer.`,
		);
	}
	return value;
}

function requireDuration(
	record: Record<string, unknown>,
	key: string,
): RaceDuration {
	const value = requireString(record, key, `race.${key}`);
	try {
		return parseRaceDuration(value)!;
	} catch (cause) {
		throw new RaceTimePayloadError(
			`race.${key} must be a valid ISO 8601 duration.`,
			{cause},
		);
	}
}

function nullableInstant(
	record: Record<string, unknown>,
	key: string,
	path: string,
): RaceInstant | null {
	const value = record[key];
	if (value === null) return null;
	return requireInstant(record, key, path);
}

function requireInstant(
	record: Record<string, unknown>,
	key: string,
	path: string,
): RaceInstant {
	const value = requireString(record, key, path);
	try {
		return parseRaceInstant(value);
	} catch (cause) {
		throw new RaceTimePayloadError(
			`${path} must be a valid ISO 8601 timestamp with a timezone.`,
			{cause},
		);
	}
}

function optionalNumber(
	record: Record<string, unknown>,
	key: string,
	path: string,
): number | null {
	const value = record[key];
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new RaceTimePayloadError(`${path} must be a number or null.`);
	}
	return value;
}

function parseEntrant(value: unknown, index: number): RaceTimeEntrantDto {
	const path = `race.entrants[${index}]`;
	const entrant = requireRecord(value, path);
	const user = requireRecord(entrant.user, `${path}.user`);
	const status = requireRecord(entrant.status, `${path}.status`);

	return {
		userId: requireString(user, "id", `${path}.user.id`),
		name: requireString(user, "name", `${path}.user.name`),
		twitchLogin: optionalString(
			user,
			"twitch_name",
			`${path}.user.twitch_name`,
		),
		status: requireString(status, "value", `${path}.status.value`),
		finishTime: optionalDuration(entrant, "finish_time", `${path}.finish_time`),
		finishedAt: nullableInstant(entrant, "finished_at", `${path}.finished_at`),
		place: optionalNumber(entrant, "place", `${path}.place`),
	};
}

/**
 * Parse an untrusted Race Detail payload into the integration DTO. Only the
 * fields we use are validated; anything unexpected is rejected rather than
 * coerced.
 */
export function parseRaceDetail(payload: unknown): RaceTimeRaceDto {
	const root = requireRecord(payload, "race");
	const status = requireRecord(root.status, "race.status");
	const category = requireRecord(root.category, "race.category");
	const goal = requireRecord(root.goal, "race.goal");

	if (!Array.isArray(root.entrants)) {
		throw new RaceTimePayloadError("race.entrants must be an array.");
	}

	return {
		version: requireNumber(root, "version", "race.version"),
		name: requireString(root, "name", "race.name"),
		slug: requireString(root, "slug", "race.slug"),
		status: requireString(status, "value", "race.status.value"),
		openedAt: requireInstant(root, "opened_at", "race.opened_at"),
		startedAt: nullableInstant(root, "started_at", "race.started_at"),
		endedAt: nullableInstant(root, "ended_at", "race.ended_at"),
		cancelledAt: nullableInstant(root, "cancelled_at", "race.cancelled_at"),
		startDelay: requireDuration(root, "start_delay"),
		timeLimit: requireDuration(root, "time_limit"),
		info: requireString(root, "info", "race.info"),
		ranked: requireBoolean(root, "ranked"),
		recordable: requireBoolean(root, "recordable"),
		recorded: requireBoolean(root, "recorded"),
		timeLimitAutoComplete: requireBoolean(root, "time_limit_auto_complete"),
		entrantsCount: requireCount(root, "entrants_count"),
		entrantsCountFinished: requireCount(root, "entrants_count_finished"),
		entrantsCountInactive: requireCount(root, "entrants_count_inactive"),
		url: requireString(root, "url", "race.url"),
		dataUrl: requireString(root, "data_url", "race.data_url"),
		websocketUrl: requireString(root, "websocket_url", "race.websocket_url"),
		categorySlug: requireString(category, "slug", "race.category.slug"),
		categoryName: requireString(category, "name", "race.category.name"),
		goal: requireString(goal, "name", "race.goal.name"),
		entrants: root.entrants.map((entry, index) => parseEntrant(entry, index)),
	};
}

function isAbortLike(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	);
}

export class HttpRaceTimeClient implements RaceTimeClient {
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;

	constructor(options: HttpRaceTimeClientOptions = {}) {
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	async fetchRaceDetail(
		canonical: CanonicalRaceUrl,
		signal?: AbortSignal,
	): Promise<RaceTimeRaceDto> {
		const controller = new AbortController();
		const onAbort = (): void => controller.abort();
		if (signal) {
			if (signal.aborted) {
				controller.abort();
			} else {
				signal.addEventListener("abort", onAbort, {once: true});
			}
		}
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const response = await this.fetchImpl(canonical.dataUrl, {
				redirect: "error",
				signal: controller.signal,
				headers: {accept: "application/json"},
			});

			if (response.status === 404) {
				throw new RaceNotFoundError(
					`Race not found: ${canonical.canonicalUrl}`,
				);
			}
			if (!response.ok) {
				throw new RaceTimeHttpError(
					response.status,
					`RaceTime.gg returned HTTP ${response.status} for ${canonical.canonicalUrl}.`,
				);
			}

			const text = await response.text();
			let payload: unknown;
			try {
				payload = JSON.parse(text);
			} catch {
				throw new RaceTimePayloadError(
					"Race Detail response was not valid JSON.",
				);
			}
			const dto = parseRaceDetail(payload);
			if (
				dto.categorySlug !== canonical.categorySlug ||
				dto.slug !== canonical.raceSlug
			) {
				throw new RaceTimePayloadError(
					"Race Detail identity does not match the requested race.",
				);
			}
			return dto;
		} catch (error) {
			if (error instanceof RaceTimeError) {
				throw error;
			}
			if (isAbortLike(error)) {
				if (signal?.aborted) {
					throw new RaceTimeAbortedError("Race Detail request was aborted.");
				}
				throw new RaceTimeTimeoutError(
					`Race Detail request timed out after ${this.timeoutMs}ms.`,
				);
			}
			throw new RaceTimeNetworkError(
				`Failed to fetch Race Detail for ${canonical.canonicalUrl}.`,
				{
					cause: error,
				},
			);
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		}
	}
}
