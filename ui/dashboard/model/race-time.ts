import {
	parseRaceDuration,
	parseRaceInstant,
	type RaceDuration,
} from "@nanahuse/racetime-protocol";

/** Displays absolute timestamps in the viewer's local timezone. */
export function formatRaceInstant(value: string | null): string {
	const instant = parseRaceInstant(value);
	if (instant === null) return "未設定";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "long",
	}).format(instant.epochMilliseconds);
}

/** Displays a timestamp as a local wall-clock time for compact event logs. */
export function formatRaceClock(value: string | null): string {
	const instant = parseRaceInstant(value);
	if (instant === null) return "未設定";
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).format(instant.epochMilliseconds);
}

function fraction(duration: RaceDuration): string {
	const digits =
		`${duration.milliseconds}`.padStart(3, "0") +
		`${duration.microseconds}`.padStart(3, "0") +
		`${duration.nanoseconds}`.padStart(3, "0");
	const trimmed = digits.replace(/0+$/, "");
	return trimmed === "" ? "" : `.${trimmed}`;
}

/**
 * Formats an ISO 8601 finish-time duration as an elapsed clock. The duration is
 * first normalized with `Temporal.Duration.round` so oversized minutes and
 * seconds carry over correctly and days fold into a cumulative hour count;
 * `null` renders as an unfinished placeholder.
 */
export function formatRaceTime(time: string | null): string {
	const parsed = parseRaceDuration(time);
	if (parsed === null) return "—";
	const duration = parsed.round({largestUnit: "hour"});
	const minutes = `${duration.minutes}`.padStart(2, "0");
	const seconds = `${duration.seconds}`.padStart(2, "0");
	return `${duration.hours}:${minutes}:${seconds}${fraction(duration)}`;
}

/**
 * Formats a finish time to one decimal place. Rounding happens on the
 * duration itself so 59.95s correctly becomes 1:00:00.0.
 */
export function formatFinishTime(time: string | null): string {
	const parsed = parseRaceDuration(time);
	if (parsed === null) return "—";
	const duration = parsed.round({
		largestUnit: "hour",
		smallestUnit: "millisecond",
		roundingIncrement: 100,
		roundingMode: "halfExpand",
	});
	const minutes = `${duration.minutes}`.padStart(2, "0");
	const seconds = `${duration.seconds}`.padStart(2, "0");
	const tenths = Math.floor(duration.milliseconds / 100);
	return `${duration.hours}:${minutes}:${seconds}.${tenths}`;
}

export function formatSpeedrunTime(time: string): string {
	const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:[.,](\d+))?S)?$/i.exec(
		time,
	);
	if (!match?.slice(1).some(Boolean)) return time;
	const [, hours = "0", minutes = "0", seconds = "0", fraction] = match;
	if (!/^0*[0-5]?\d$/.test(minutes) || !/^0*[0-5]?\d$/.test(seconds))
		return time;
	return `${hours}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}
