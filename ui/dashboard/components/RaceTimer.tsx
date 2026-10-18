import {useEffect, useState} from "react";
import {
	formatRaceTimer,
	type RaceTimerPrecision,
	type RaceTimerState,
	raceTimerPhase,
} from "../model/race-timer";

/**
 * Re-renders the consuming component on a fixed interval, always reporting the
 * current wall-clock time so resumed or throttled timers stay accurate.
 */
export function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(id);
	}, [intervalMs]);
	return now;
}

export function RaceTimer({
	state,
	precision = "seconds",
	className,
}: {
	state: RaceTimerState;
	precision?: RaceTimerPrecision;
	className?: string;
}) {
	if (state.kind === "hidden") return null;
	const phase = raceTimerPhase(state);
	return (
		<span
			className={["race-timer", `phase-${phase}`, className]
				.filter(Boolean)
				.join(" ")}
			data-phase={phase}
		>
			{formatRaceTimer(state, precision)}
		</span>
	);
}
