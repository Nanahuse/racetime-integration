import {
	parseRaceDuration,
	parseRaceInstant,
	type Race,
} from "@nanahuse/racetime-protocol";

/**
 * Display state for a single monitored race timer. `offsetMs` is the signed
 * time relative to the race start: negative means a countdown, zero or
 * positive means elapsed time.
 */
export type RaceTimerState =
	| {kind: "hidden"}
	| {kind: "unavailable"}
	| {kind: "prestart"; offsetMs: number}
	| {kind: "countdown"; offsetMs: number}
	| {kind: "elapsed"; offsetMs: number}
	| {kind: "finished"; offsetMs: number}
	| {kind: "cancelledBeforeStart"}
	| {kind: "cancelledAfterStart"; offsetMs: number};

export type RaceTimerPhase =
	| "waiting"
	| "countdown"
	| "running"
	| "finished"
	| "cancelled"
	| "unavailable";

export type RaceTimerPrecision = "seconds" | "tenths";

function instantMs(value: string | null): number | null {
	if (value === null) return null;
	try {
		return parseRaceInstant(value).epochMilliseconds;
	} catch {
		return null;
	}
}

function durationMs(value: string | null): number | null {
	if (value === null) return null;
	try {
		const duration = parseRaceDuration(value);
		return duration === null ? null : duration.total({unit: "milliseconds"});
	} catch {
		return null;
	}
}

/**
 * Derives the timer display state from the latest Race snapshot and the
 * current time. Time is always recomputed from the stored RaceTime instants so
 * a stuck render loop or a missed update cannot drift the clock.
 */
export function computeRaceTimer(
	race: Race | null,
	now: number,
): RaceTimerState {
	if (race === null) return {kind: "unavailable"};
	const status = race.status;
	if (status === "partitioned") return {kind: "hidden"};
	const startedAt = instantMs(race.startedAt);
	const endedAt = instantMs(race.endedAt);
	const cancelledAt = instantMs(race.cancelledAt);
	switch (status) {
		case "open":
		case "invitational": {
			const delay = durationMs(race.startDelay);
			return delay === null
				? {kind: "unavailable"}
				: {kind: "prestart", offsetMs: -delay};
		}
		case "pending": {
			if (startedAt === null) return {kind: "unavailable"};
			const offsetMs = now - startedAt;
			return offsetMs < 0
				? {kind: "countdown", offsetMs}
				: {kind: "elapsed", offsetMs};
		}
		case "in_progress": {
			if (startedAt === null) return {kind: "unavailable"};
			return {kind: "elapsed", offsetMs: now - startedAt};
		}
		case "finished": {
			if (startedAt === null || endedAt === null) return {kind: "unavailable"};
			return {kind: "finished", offsetMs: Math.max(0, endedAt - startedAt)};
		}
		case "cancelled": {
			if (startedAt === null || cancelledAt === null || cancelledAt < startedAt)
				return {kind: "cancelledBeforeStart"};
			return {kind: "cancelledAfterStart", offsetMs: cancelledAt - startedAt};
		}
		default:
			return {kind: "unavailable"};
	}
}

export function raceTimerPhase(state: RaceTimerState): RaceTimerPhase {
	switch (state.kind) {
		case "prestart":
			return "waiting";
		case "countdown":
			return "countdown";
		case "elapsed":
			return "running";
		case "finished":
			return "finished";
		case "cancelledBeforeStart":
		case "cancelledAfterStart":
			return "cancelled";
		default:
			return "unavailable";
	}
}

export function raceTimerLabel(state: RaceTimerState): string | null {
	switch (state.kind) {
		case "prestart":
			return "開始待ち";
		case "countdown":
			return "カウントダウン";
		case "elapsed":
			return "進行中";
		case "finished":
			return "終了";
		case "cancelledBeforeStart":
		case "cancelledAfterStart":
			return "中止";
		case "unavailable":
			return "未取得";
		default:
			return null;
	}
}

function pad(value: number): string {
	return `${value}`.padStart(2, "0");
}

function formatOffset(offsetMs: number, precision: RaceTimerPrecision): string {
	const sign = offsetMs < 0 ? "-" : "";
	const totalMs = Math.abs(offsetMs);
	const totalSeconds = Math.floor(totalMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const clock = `${hours}:${pad(minutes)}:${pad(seconds)}`;
	if (precision === "tenths")
		return `${sign}${clock}.${Math.floor((totalMs % 1000) / 100)}`;
	return `${sign}${clock}`;
}

/** Formats a timer state as `H:MM:SS` or `H:MM:SS.d` for the detail panel. */
export function formatRaceTimer(
	state: RaceTimerState,
	precision: RaceTimerPrecision = "seconds",
): string {
	switch (state.kind) {
		case "prestart":
		case "countdown":
		case "elapsed":
		case "finished":
		case "cancelledAfterStart":
			return formatOffset(state.offsetMs, precision);
		case "cancelledBeforeStart":
			return "中止";
		default:
			return "未取得";
	}
}
