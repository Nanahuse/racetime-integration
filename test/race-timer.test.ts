import type {Race} from "@nanahuse/racetime-protocol";
import {describe, expect, it} from "vitest";
import {
	computeRaceTimer,
	formatRaceTimer,
	raceTimerLabel,
	raceTimerPhase,
} from "../ui/dashboard/model/race-timer";

const ISO = (milliseconds: number) => new Date(milliseconds).toISOString();
const START = Date.parse("2026-01-01T00:00:15Z");

function race(overrides: Partial<Race> = {}): Race {
	return {
		raceId: "game/race",
		url: "https://racetime.gg/game/race",
		version: 1,
		name: "game/race",
		status: "in_progress",
		openedAt: ISO(START - 60_000),
		startedAt: ISO(START),
		endedAt: null,
		cancelledAt: null,
		startDelay: "PT15S",
		timeLimit: "P1D",
		info: "",
		ranked: true,
		recordable: false,
		recorded: false,
		timeLimitAutoComplete: false,
		entrantsCount: 0,
		entrantsCountFinished: 0,
		entrantsCountInactive: 0,
		category: {slug: "game", name: "Game", goal: "Any%"},
		entrants: [],
		results: [],
		...overrides,
	};
}

describe("computeRaceTimer", () => {
	it("holds the configured start delay while the race is open", () => {
		const open = race({status: "open", startedAt: null});
		expect(computeRaceTimer(open, START - 90_000)).toEqual({
			kind: "prestart",
			offsetMs: -15_000,
		});
		expect(computeRaceTimer(open, START + 90_000)).toEqual({
			kind: "prestart",
			offsetMs: -15_000,
		});
		expect(computeRaceTimer(race({status: "invitational"}), START)).toEqual({
			kind: "prestart",
			offsetMs: -15_000,
		});
	});

	it("counts down to the scheduled start while pending", () => {
		const pending = race({status: "pending"});
		expect(computeRaceTimer(pending, START - 8_000)).toEqual({
			kind: "countdown",
			offsetMs: -8_000,
		});
	});

	it("switches to elapsed time once the countdown reaches zero", () => {
		const pending = race({status: "pending"});
		expect(computeRaceTimer(pending, START)).toEqual({
			kind: "elapsed",
			offsetMs: 0,
		});
		expect(computeRaceTimer(pending, START + 5_000)).toEqual({
			kind: "elapsed",
			offsetMs: 5_000,
		});
	});

	it("computes elapsed time from startedAt for an in-progress race joined mid-way", () => {
		const running = race({status: "in_progress"});
		expect(computeRaceTimer(running, START + 32_140)).toEqual({
			kind: "elapsed",
			offsetMs: 32_140,
		});
	});

	it("recomputes the countdown when the scheduled start changes", () => {
		const pending = race({status: "pending"});
		const moved = race({status: "pending", startedAt: ISO(START + 30_000)});
		expect(computeRaceTimer(pending, START - 8_000)).toEqual({
			kind: "countdown",
			offsetMs: -8_000,
		});
		expect(computeRaceTimer(moved, START - 8_000)).toEqual({
			kind: "countdown",
			offsetMs: -38_000,
		});
	});

	it("stops at the recorded finish time", () => {
		const finished = race({
			status: "finished",
			endedAt: ISO(START + 360_000),
		});
		expect(computeRaceTimer(finished, START + 1_000_000)).toEqual({
			kind: "finished",
			offsetMs: 360_000,
		});
	});

	it("reports an end before the start as unavailable instead of zero", () => {
		expect(
			computeRaceTimer(
				race({
					status: "finished",
					startedAt: ISO(START),
					endedAt: ISO(START - 1_000),
				}),
				START,
			),
		).toEqual({kind: "unavailable"});
	});

	it("treats an end equal to the start as a zero-second finish", () => {
		expect(
			computeRaceTimer(
				race({
					status: "finished",
					startedAt: ISO(START),
					endedAt: ISO(START),
				}),
				START,
			),
		).toEqual({kind: "finished", offsetMs: 0});
	});

	it("reports a cancellation without a cancellation time as unavailable", () => {
		expect(
			computeRaceTimer(
				race({status: "cancelled", startedAt: ISO(START), cancelledAt: null}),
				START,
			),
		).toEqual({kind: "unavailable"});
		expect(
			computeRaceTimer(
				race({status: "cancelled", startedAt: null, cancelledAt: null}),
				START,
			),
		).toEqual({kind: "unavailable"});
	});

	it("stops at the cancellation time for a race cancelled after starting", () => {
		const cancelled = race({
			status: "cancelled",
			cancelledAt: ISO(START + 45_000),
		});
		expect(computeRaceTimer(cancelled, START + 500_000)).toEqual({
			kind: "cancelledAfterStart",
			offsetMs: 45_000,
		});
	});

	it("reports a cancellation before the race started", () => {
		expect(
			computeRaceTimer(
				race({
					status: "cancelled",
					startedAt: null,
					cancelledAt: ISO(START - 5_000),
				}),
				START,
			),
		).toEqual({kind: "cancelledBeforeStart"});
		expect(
			computeRaceTimer(
				race({
					status: "cancelled",
					startedAt: ISO(START + 60_000),
					cancelledAt: ISO(START - 5_000),
				}),
				START,
			),
		).toEqual({kind: "cancelledBeforeStart"});
	});

	it("follows the latest state when a finished race is resumed", () => {
		const finished = race({
			status: "finished",
			endedAt: ISO(START + 360_000),
		});
		const resumed = race({status: "in_progress"});
		expect(computeRaceTimer(finished, START + 360_000)).toEqual({
			kind: "finished",
			offsetMs: 360_000,
		});
		expect(computeRaceTimer(resumed, START + 720_000)).toEqual({
			kind: "elapsed",
			offsetMs: 720_000,
		});
	});

	it("reports missing required times instead of guessing", () => {
		expect(
			computeRaceTimer(race({status: "in_progress", startedAt: null}), START),
		).toEqual({
			kind: "unavailable",
		});
		expect(
			computeRaceTimer(race({status: "finished", endedAt: null}), START),
		).toEqual({kind: "unavailable"});
		expect(
			computeRaceTimer(race({status: "open", startDelay: "nonsense"}), START),
		).toEqual({kind: "unavailable"});
		expect(computeRaceTimer(race({status: "weird"}), START)).toEqual({
			kind: "unavailable",
		});
		expect(computeRaceTimer(null, START)).toEqual({kind: "unavailable"});
	});

	it("hides the timer for partitioned races", () => {
		expect(computeRaceTimer(race({status: "partitioned"}), START)).toEqual({
			kind: "hidden",
		});
	});
});

describe("formatRaceTimer", () => {
	it("always shows the hour and prefixes countdowns", () => {
		expect(formatRaceTimer({kind: "countdown", offsetMs: -8_000})).toBe(
			"-0:00:08",
		);
		expect(formatRaceTimer({kind: "prestart", offsetMs: -5_400_000})).toBe(
			"-1:30:00",
		);
		expect(formatRaceTimer({kind: "elapsed", offsetMs: 1_934_000})).toBe(
			"0:32:14",
		);
		expect(formatRaceTimer({kind: "elapsed", offsetMs: 3_723_000})).toBe(
			"1:02:03",
		);
	});

	it("adds tenths only for the detail precision", () => {
		expect(formatRaceTimer({kind: "elapsed", offsetMs: 32_140})).toBe(
			"0:00:32",
		);
		expect(formatRaceTimer({kind: "elapsed", offsetMs: 32_140}, "tenths")).toBe(
			"0:00:32.1",
		);
		expect(
			formatRaceTimer({kind: "countdown", offsetMs: -8_000}, "tenths"),
		).toBe("-0:00:08.0");
	});

	it("folds hours beyond a day into a cumulative count", () => {
		expect(formatRaceTimer({kind: "elapsed", offsetMs: 90_000_000})).toBe(
			"25:00:00",
		);
		expect(formatRaceTimer({kind: "finished", offsetMs: 93_784_000})).toBe(
			"26:03:04",
		);
	});

	it("renders placeholders without time data", () => {
		expect(formatRaceTimer({kind: "unavailable"})).toBe("未取得");
		expect(formatRaceTimer({kind: "cancelledBeforeStart"})).toBe("中止");
	});
});

describe("timer metadata", () => {
	it("labels and colours each state", () => {
		expect(raceTimerLabel({kind: "elapsed", offsetMs: 0})).toBe("進行中");
		expect(raceTimerPhase({kind: "elapsed", offsetMs: 0})).toBe("running");
		expect(raceTimerLabel({kind: "countdown", offsetMs: -1})).toBe(
			"カウントダウン",
		);
		expect(raceTimerPhase({kind: "countdown", offsetMs: -1})).toBe("countdown");
		expect(raceTimerPhase({kind: "cancelledAfterStart", offsetMs: 1})).toBe(
			"cancelled",
		);
		expect(raceTimerPhase({kind: "unavailable"})).toBe("unavailable");
	});
});
