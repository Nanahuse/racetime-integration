import {
	parseRaceDate,
	parseRaceInstant,
	serializeRaceDate,
	serializeRaceInstant,
} from "@nanahuse/racetime-protocol";
import {expect, it} from "vitest";

it.each([
	["2026-01-02T03:04:05Z", "2026-01-02T03:04:05Z"],
	["2026-01-02T03:04:05.123456789+09:00", "2026-01-01T18:04:05.123456789Z"],
	["2026-01-02T03:04:05.000000001-04:30", "2026-01-02T07:34:05.000000001Z"],
])(
	"normalizes %s to UTC and preserves the exact instant",
	(input, expected) => {
		const instant = parseRaceInstant(input);
		const serialized = serializeRaceInstant(instant);
		expect(serialized).toBe(expected);
		expect(parseRaceInstant(serialized).epochNanoseconds).toBe(
			instant.epochNanoseconds,
		);
	},
);

it("preserves null across timestamp and date boundaries", () => {
	expect(parseRaceInstant(null)).toBeNull();
	expect(serializeRaceInstant(null)).toBeNull();
	expect(parseRaceDate(null)).toBeNull();
	expect(serializeRaceDate(null)).toBeNull();
});

it.each([
	"",
	"bad",
	"2026-01-02",
	"2026-01-02T03:04:05",
	"2026-02-30T00:00:00Z",
	"2026-01-02T25:00:00Z",
])("rejects invalid or timezone-free timestamps %s", (value) => {
	expect(() => parseRaceInstant(value)).toThrow();
});

it.each(["2024-02-29", "2026-01-02"])("round-trips date-only %s", (value) => {
	const date = parseRaceDate(value);
	expect(serializeRaceDate(date)).toBe(value);
	expect(parseRaceDate(serializeRaceDate(date)).equals(date)).toBe(true);
});

it.each([
	"",
	"bad",
	"2026-02-29",
	"2026-13-01",
	"2026-01-02T00:00:00",
	"2026-01-02T00:00:00Z",
])("rejects invalid dates and timestamps used as dates %s", (value) => {
	expect(() => parseRaceDate(value)).toThrow();
});
