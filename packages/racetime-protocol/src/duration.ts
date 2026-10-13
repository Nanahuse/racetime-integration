import {Temporal} from "@js-temporal/polyfill";

/** An elapsed RaceTime duration backed by the standard Temporal API. */
export type RaceDuration = Temporal.Duration;

/**
 * Parses a RaceTime.gg duration string into a `Temporal.Duration`.
 *
 * RaceTime finish times are elapsed times, so calendar units (years, months
 * and weeks) are rejected: they are ambiguous without a reference date. A
 * `null` input stays `null`; anything invalid throws instead of being coerced.
 */
export function parseRaceDuration(value: string | null): RaceDuration | null {
	if (value === null) return null;
	const duration = Temporal.Duration.from(value);
	if (duration.sign < 0) {
		throw new RangeError(`Duration must not be negative: ${value}`);
	}
	if (duration.years !== 0 || duration.months !== 0 || duration.weeks !== 0) {
		throw new RangeError(
			`Duration must not contain years, months or weeks: ${value}`,
		);
	}
	return duration;
}

/** Serializes a RaceTime duration back to its exact ISO 8601 string. */
export function serializeRaceDuration(
	value: RaceDuration | null,
): string | null {
	return value === null ? null : value.toString();
}
