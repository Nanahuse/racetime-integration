import {
	parseRaceDuration,
	type RaceDuration,
} from "@nanahuse/racetime-protocol";

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
