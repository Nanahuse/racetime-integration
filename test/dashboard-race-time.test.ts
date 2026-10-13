import {expect, it} from "vitest";
import {formatRaceTime} from "../ui/dashboard/model/race-time";

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
