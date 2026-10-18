import {expect, it} from "vitest";
import {
	formatFinishTime,
	formatRaceInstant,
	formatRaceTime,
	formatSpeedrunTime,
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

it.each([
	["PT1H2M3.456S", "1:02:03.5"],
	["PT1H2M3.449S", "1:02:03.4"],
	["PT35M12S", "0:35:12.0"],
	["PT59M59.999S", "1:00:00.0"],
	["PT0S", "0:00:00.0"],
	["P1DT2H", "26:00:00.0"],
	[null, "—"],
])("formats the finish time %s as %s", (input, expected) => {
	expect(formatFinishTime(input)).toBe(expected);
});

it("does not change the generic race time format", () => {
	expect(formatRaceTime("PT1H2M3.456S")).toBe("1:02:03.456");
	expect(formatRaceTime(null)).toBe("—");
});

it.each([
	["PT12S", "0:00:12"],
	["PT12.100S", "0:00:12.100"],
	["PT1M2.030S", "0:01:02.030"],
	["PT1H2M3.450S", "1:02:03.450"],
	["PT12H3M4.123456S", "12:03:04.123456"],
	["PT59.999999999S", "0:00:59.999999999"],
	["PT90S", "PT90S"],
	["PT90M", "PT90M"],
	["P1DT2H", "P1DT2H"],
])("displays SRC %s as %s without normalizing", (time, expected) => {
	expect(formatSpeedrunTime(time)).toBe(expected);
});
