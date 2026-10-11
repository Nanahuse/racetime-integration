// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import {InvalidRaceUrlError, RaceTimeWebSocketError} from "./errors";

export const RACETIME_ORIGIN = "https://racetime.gg";
const RACETIME_HOST = "racetime.gg";
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type CanonicalRaceUrl = {
	canonicalUrl: string;
	categorySlug: string;
	raceSlug: string;
	/** Race Detail API URL, built internally from the validated slugs. */
	dataUrl: string;
};

/**
 * Validate an operator-supplied RaceTime.gg race page URL and produce a stable
 * canonical form plus the Race Detail API URL.
 *
 * Only `https://racetime.gg/<category>/<race>` (optionally with a trailing
 * slash, query or fragment) is accepted. The API URL is always rebuilt from the
 * validated slugs so an arbitrary URL can never be fetched.
 */
export function canonicalizeRaceUrl(input: string): CanonicalRaceUrl {
	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch {
		throw new InvalidRaceUrlError(`"${input}" is not a valid URL.`);
	}

	if (parsed.protocol !== "https:") {
		throw new InvalidRaceUrlError("Race URL must use the https: protocol.");
	}

	if (
		parsed.hostname !== RACETIME_HOST ||
		parsed.port ||
		parsed.username ||
		parsed.password
	) {
		throw new InvalidRaceUrlError(`Race URL must be on ${RACETIME_HOST}.`);
	}

	const segments = parsed.pathname
		.replace(/^\//, "")
		.replace(/\/$/, "")
		.split("/");
	if (segments.length !== 2) {
		throw new InvalidRaceUrlError(
			"Race URL must point to a race page (https://racetime.gg/<category>/<race>).",
		);
	}

	const [categorySlug, raceSlug] = segments;
	if (categorySlug === undefined || !SLUG_PATTERN.test(categorySlug)) {
		throw new InvalidRaceUrlError("Race URL is missing a valid category slug.");
	}
	if (raceSlug === undefined || !SLUG_PATTERN.test(raceSlug)) {
		throw new InvalidRaceUrlError("Race URL is missing a valid race slug.");
	}

	const canonicalUrl = `${RACETIME_ORIGIN}/${categorySlug}/${raceSlug}`;
	return {
		canonicalUrl,
		categorySlug,
		raceSlug,
		dataUrl: `${canonicalUrl}/data`,
	};
}

/**
 * Resolve the `websocket_url` returned by the API. Relative URLs are resolved
 * against racetime.gg and must end up as a `wss:` URL on racetime.gg.
 */
export function resolveWebSocketUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw, RACETIME_ORIGIN);
	} catch {
		throw new RaceTimeWebSocketError(`"${raw}" is not a valid WebSocket URL.`);
	}

	if (
		parsed.hostname !== RACETIME_HOST ||
		parsed.port ||
		parsed.username ||
		parsed.password
	) {
		throw new RaceTimeWebSocketError(
			`WebSocket URL must be on ${RACETIME_HOST}.`,
		);
	}

	if (parsed.protocol === "https:") {
		parsed.protocol = "wss:";
	}

	if (parsed.protocol !== "wss:") {
		throw new RaceTimeWebSocketError(
			"WebSocket URL must use the wss: protocol.",
		);
	}

	return parsed.toString();
}
