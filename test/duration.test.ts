import {
	parseRaceDuration,
	serializeRaceDuration,
	Temporal,
} from "@nanahuse/racetime-protocol";
import {describe, expect, it} from "vitest";

function text(value: string | null): string | null {
	return parseRaceDuration(value)?.toString() ?? null;
}

describe("parseRaceDuration", () => {
	it("parses hours, minutes and seconds", () => {
		expect(text("PT1H2M3S")).toBe("PT1H2M3S");
	});
	it("parses zero", () => {
		expect(text("PT0S")).toBe("PT0S");
	});
	it("parses days", () => {
		expect(text("P1DT2H")).toBe("P1DT2H");
	});
	it("parses times of 24 hours or more", () => {
		expect(text("PT25H")).toBe("PT25H");
	});
	it("preserves subsecond precision up to nanoseconds", () => {
		expect(text("PT1H2M3.45S")).toBe("PT1H2M3.45S");
		expect(text("PT0.000000001S")).toBe("PT0.000000001S");
		expect(text("PT1.123456789S")).toBe("PT1.123456789S");
	});
	it("returns null unchanged", () => {
		expect(parseRaceDuration(null)).toBeNull();
	});
	it.each(["", "nope", "P", "1H", "PT1H2"])("rejects malformed %s", (value) => {
		expect(() => parseRaceDuration(value)).toThrow();
	});
	it.each(["-PT1H", "-P1D"])("rejects negative %s", (value) => {
		expect(() => parseRaceDuration(value)).toThrow();
	});
	it.each(["P1Y", "P1M", "P1W", "P1Y2M3DT4H"])(
		"rejects calendar units %s",
		(value) => {
			expect(() => parseRaceDuration(value)).toThrow();
		},
	);
});

describe("serializeRaceDuration", () => {
	it("returns null unchanged", () => {
		expect(serializeRaceDuration(null)).toBeNull();
	});
	it("serializes to ISO 8601 without losing precision", () => {
		const value = "PT1H2M3.000000001S";
		expect(serializeRaceDuration(parseRaceDuration(value))).toBe(value);
	});
	it("round-trips a parsed duration to an equal duration", () => {
		const first = parseRaceDuration("P3DT4H5M6.78S");
		const second = parseRaceDuration(serializeRaceDuration(first));
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(Temporal.Duration.compare(first!, second!)).toBe(0);
	});
});
