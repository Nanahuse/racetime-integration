import type {
	FinishedRaceResult,
	Race,
	RaceResult,
	RaceTimeEvents,
} from "@nanahuse/racetime-protocol";

export type RaceChangeEvent = {
	[K in keyof RaceTimeEvents]: {type: K; payload: RaceTimeEvents[K]};
}[keyof RaceTimeEvents];

function isFinishedResult(result: RaceResult): result is FinishedRaceResult {
	return (
		result.status === "finished" &&
		result.time !== null &&
		result.finishedAt !== null
	);
}

/** Detects observed transitions; the first snapshot only establishes a baseline. */
export function detectRaceEvents(
	previous: Race | null,
	current: Race,
	hasStarted: boolean | null,
): {hasStarted: boolean; events: RaceChangeEvent[]} {
	const events: RaceChangeEvent[] = [];
	const started =
		hasStarted === true ||
		current.status === "in_progress" ||
		current.status === "finished";
	if (previous === null) return {hasStarted: started, events};
	const identity = {
		raceId: current.raceId,
		url: current.url,
		raceVersion: current.version,
	};
	if (
		!hasStarted &&
		current.status === "pending" &&
		current.startedAt !== null &&
		previous.startedAt !== current.startedAt
	) {
		events.push({
			type: "raceStartScheduled",
			payload: {
				...identity,
				startedAt: current.startedAt,
				previousStartedAt: previous.startedAt,
			},
		});
	}
	if (
		!hasStarted &&
		["open", "invitational", "pending"].includes(previous.status) &&
		current.status === "in_progress" &&
		current.startedAt !== null
	) {
		events.push({
			type: "raceStarted",
			payload: {...identity, startedAt: current.startedAt},
		});
	}
	const previousEntrants = new Map(
		previous.entrants.map((entrant) => [entrant.userId, entrant]),
	);
	const results = new Map(
		current.results.map((result) => [result.userId, result]),
	);
	for (const entrant of current.entrants) {
		const before = previousEntrants.get(entrant.userId);
		if (!before) continue;
		if (
			before.status !== "done" &&
			entrant.status === "done" &&
			entrant.finishTime !== null &&
			entrant.finishedAt !== null
		) {
			const result = results.get(entrant.userId);
			if (result && isFinishedResult(result)) {
				events.push({
					type: "entrantFinished",
					payload: {...identity, result: {...result}},
				});
			}
		} else if (
			before.status === "done" &&
			entrant.status !== "done" &&
			before.finishTime !== null &&
			entrant.finishTime === null
		) {
			events.push({
				type: "entrantFinishUndone",
				payload: {...identity, userId: entrant.userId},
			});
		}
	}
	if (
		previous.status !== "cancelled" &&
		current.status === "cancelled" &&
		current.cancelledAt !== null
	) {
		events.push({
			type: "raceCancelled",
			payload: {...identity, cancelledAt: current.cancelledAt},
		});
	}
	return {hasStarted: started, events};
}
