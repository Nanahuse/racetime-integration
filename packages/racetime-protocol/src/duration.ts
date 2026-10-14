import {Temporal} from "@js-temporal/polyfill";

/** An elapsed RaceTime duration backed by the standard Temporal API. */
export type RaceDuration = Temporal.Duration;

/**
 * Rejects durations that cannot be interpreted as an elapsed time. Calendar
 * units (years, months and weeks) are ambiguous without a reference date, and
 * negatives are not valid finish times.
 */
function assertElapsedDuration(duration: Temporal.Duration): void {
	if (duration.sign < 0) {
		throw new RangeError("Race duration must not be negative");
	}
	if (duration.years !== 0 || duration.months !== 0 || duration.weeks !== 0) {
		throw new RangeError(
			"Race duration must not contain years, months or weeks",
		);
	}
}

/**
 * Parses a RaceTime.gg duration string into a `Temporal.Duration`.
 *
 * A `null` input stays `null`; anything invalid throws instead of being
 * coerced to zero or `null`.
 */
export function parseRaceDuration(value: string | null): RaceDuration | null {
	if (value === null) return null;
	const duration = Temporal.Duration.from(value);
	assertElapsedDuration(duration);
	return duration;
}

/** Serializes a RaceTime duration back to its exact ISO 8601 string. */
export function serializeRaceDuration(
	value: RaceDuration | null,
): string | null {
	if (value === null) return null;
	assertElapsedDuration(value);
	return value.toString();
}
