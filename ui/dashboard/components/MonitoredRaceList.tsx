import type {RaceState} from "@nanahuse/racetime-protocol";
import {computeRaceTimer} from "../model/race-timer";
import {RaceTimer, useNow} from "./RaceTimer";

/**
 * The shared 1s update for every monitored race. A single interval drives the
 * whole list, including races that are not currently selected.
 */
export function MonitoredRaceList({
	races,
	selectedUrl,
	onSelect,
}: {
	races: readonly RaceState[];
	selectedUrl: string | null;
	onSelect: (url: string) => void;
}) {
	const now = useNow(1000);
	return (
		<ul className='list'>
			{races.map((race) => (
				<li key={race.url}>
					<button
						type='button'
						className={selectedUrl === race.url ? "active" : ""}
						onClick={() => onSelect(race.url)}
					>
						<span className='race-list-head'>
							<strong>{race.race?.raceId ?? race.url}</strong>
							<RaceTimer
								state={computeRaceTimer(race.race, now)}
								className='race-list-timer'
							/>
						</span>
						<small>RaceTime: {race.race?.status ?? "未取得"}</small>
						<small>
							Connection: {race.connection} · E{race.participantsRevision}
						</small>
					</button>
				</li>
			))}
		</ul>
	);
}
