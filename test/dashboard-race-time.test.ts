import {expect, it} from "vitest";
import {
	formatRaceInstant,
	formatRaceTime,
} from "../ui/dashboard/model/race-time";

it("formats an offset timestamp in the environment's local timezone", () => {
	const expected = new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "long",
	}).format(Date.UTC(2026, 0, 1, 18, 4, 5));
	expect(formatRaceInstant("2026-01-02T03:04:05+09:00")).toBe(expected);
	expect(formatRaceInstant(null)).toBe("未設定");
});

it.each([
	["PT1H2M3.45S", "1:02:03.45"],
	["PT1H2M3S", "1:02:03"],
	["PT35M12S", "0:35:12"],
	["PT90S", "0:01:30"],
	["PT90M", "1:30:00"],
	["PT1H90M90S", "2:31:30"],
	["PT0S", "0:00:00"],
	["P1DT2H", "26:00:00"],
	["PT25H", "25:00:00"],
	["PT1.000000001S", "0:00:01.000000001"],
	[null, "—"],
])("formats %s as %s", (input, expected) => {
	expect(formatRaceTime(input)).toBe(expected);
});
