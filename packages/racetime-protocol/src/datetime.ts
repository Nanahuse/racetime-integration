import {Temporal} from "@js-temporal/polyfill";

export type RaceInstant = Temporal.Instant;
export type RaceDate = Temporal.PlainDate;

/** Parses an absolute ISO 8601 timestamp; an explicit UTC offset is required. */
export function parseRaceInstant(value: string): RaceInstant;
export function parseRaceInstant(value: null): null;
export function parseRaceInstant(value: string | null): RaceInstant | null;
export function parseRaceInstant(value: string | null): RaceInstant | null {
	return value === null ? null : Temporal.Instant.from(value);
}

/** Serializes an instant in UTC without rounding fractional seconds. */
export function serializeRaceInstant(value: RaceInstant): string;
export function serializeRaceInstant(value: null): null;
export function serializeRaceInstant(value: RaceInstant | null): string | null;
export function serializeRaceInstant(value: RaceInstant | null): string | null {
	return value === null ? null : value.toString();
}

/** Accepts only an ISO date, without silently discarding a time or timezone. */
export function parseRaceDate(value: string): RaceDate;
export function parseRaceDate(value: null): null;
export function parseRaceDate(value: string | null): RaceDate | null;
export function parseRaceDate(value: string | null): RaceDate | null {
	if (value === null) return null;
	if (!/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}$/.test(value)) {
		throw new RangeError("Race date must be an ISO 8601 date without a time");
	}
	return Temporal.PlainDate.from(value);
}

export function serializeRaceDate(value: RaceDate): string;
export function serializeRaceDate(value: null): null;
export function serializeRaceDate(value: RaceDate | null): string | null;
export function serializeRaceDate(value: RaceDate | null): string | null {
	return value === null ? null : value.toString({calendarName: "never"});
}
