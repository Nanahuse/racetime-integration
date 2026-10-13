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
 * Formats an ISO 8601 finish-time duration as an elapsed clock. Days are
 * folded into a cumulative hour count so 24 hours or more stay readable, and
 * `null` renders as an unfinished placeholder.
 */
export function formatRaceTime(time: string | null): string {
	const duration = parseRaceDuration(time);
	if (duration === null) return "—";
	const hours = duration.days * 24 + duration.hours;
	const minutes = `${duration.minutes}`.padStart(2, "0");
	const seconds = `${duration.seconds}`.padStart(2, "0");
	return `${hours}:${minutes}:${seconds}${fraction(duration)}`;
}
