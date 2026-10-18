// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import {
	DEFAULT_ALLOWED_RACE_ORIGINS,
	normalizeAllowedRaceOrigins,
} from "@nanahuse/racetime-protocol";
import {InvalidRaceUrlError, RaceTimeWebSocketError} from "./errors";

export const RACETIME_ORIGIN = "https://racetime.gg";
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type CanonicalRaceUrl = {
	canonicalUrl: string;
	categorySlug: string;
	raceSlug: string;
	/** Race Detail API URL, built internally from the validated slugs. */
	dataUrl: string;
};

/** Validate an allowed RaceTime race page and rebuild its API URL from slugs. */
export function canonicalizeRaceUrl(
	input: string,
	allowedOrigins: readonly string[] = DEFAULT_ALLOWED_RACE_ORIGINS,
): CanonicalRaceUrl {
	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch {
		throw new InvalidRaceUrlError(`"${input}" is not a valid URL.`);
	}
	if (parsed.username || parsed.password)
		throw new InvalidRaceUrlError("Race URL cannot contain credentials.");

	let origins: string[];
	try {
		origins = normalizeAllowedRaceOrigins(allowedOrigins);
	} catch (cause) {
		throw new InvalidRaceUrlError(
			cause instanceof Error ? cause.message : "Invalid allowed RaceTime origins.",
		);
	}
	if (!origins.includes(parsed.origin))
		throw new InvalidRaceUrlError("Race URL origin is not allowed.");

	const segments = parsed.pathname
		.replace(/^\//, "")
		.replace(/\/$/, "")
		.split("/");
	if (segments.length !== 2) {
		throw new InvalidRaceUrlError(
			"Race URL must point to a race page (<origin>/<category>/<race>).",
		);
	}

	const [categorySlug, raceSlug] = segments;
	if (categorySlug === undefined || !SLUG_PATTERN.test(categorySlug)) {
		throw new InvalidRaceUrlError("Race URL is missing a valid category slug.");
	}
	if (raceSlug === undefined || !SLUG_PATTERN.test(raceSlug)) {
		throw new InvalidRaceUrlError("Race URL is missing a valid race slug.");
	}

	const canonicalUrl = `${parsed.origin}/${categorySlug}/${raceSlug}`;
	return {
		canonicalUrl,
		categorySlug,
		raceSlug,
		dataUrl: `${canonicalUrl}/data`,
	};
}

/** Resolve the server-provided WebSocket URL and bind it to the race origin. */
export function resolveWebSocketUrl(raw: string, raceUrl = RACETIME_ORIGIN): string {
	let base: URL;
	let parsed: URL;
	try {
		base = new URL(raceUrl);
		parsed = new URL(raw, base);
	} catch {
		throw new RaceTimeWebSocketError(`"${raw}" is not a valid WebSocket URL.`);
	}
	if (parsed.username || parsed.password)
		throw new RaceTimeWebSocketError("WebSocket URL cannot contain credentials.");
	if (parsed.hostname !== base.hostname || parsed.port !== base.port)
		throw new RaceTimeWebSocketError(
			"WebSocket URL must use the race's host and port.",
		);

	const expectedProtocol = base.protocol === "https:" ? "wss:" : "ws:";
	if (parsed.protocol === base.protocol) parsed.protocol = expectedProtocol;
	if (parsed.protocol !== expectedProtocol)
		throw new RaceTimeWebSocketError(
			`WebSocket URL must use ${expectedProtocol}`,
		);
	return parsed.toString();
}
