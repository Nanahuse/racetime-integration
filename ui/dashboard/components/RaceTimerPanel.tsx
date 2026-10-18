import type {Race, RaceState} from "@nanahuse/racetime-protocol";
import {
	computeRaceTimer,
	raceTimerLabel,
	raceTimerPhase,
} from "../model/race-timer";
import {RaceTimer, useNow} from "./RaceTimer";

const CONNECTION_NOTES: Partial<Record<RaceState["connection"], string>> = {
	reconnecting:
		"RaceTimeへの接続が切断されています。最新の状態と同期されていない可能性があります。",
	error:
		"RaceTimeへの接続でエラーが発生しています。最新の状態と同期されていない可能性があります。",
	closed: "レース終了後の監視通信を終了しました。",
};

export function RaceTimerPanel({
	race,
	connection,
}: {
	race: Race | null;
	connection: RaceState["connection"] | undefined;
}) {
	const now = useNow(100);
	const state = computeRaceTimer(race, now);
	if (state.kind === "hidden") return null;
	const label = raceTimerLabel(state);
	const note = connection ? CONNECTION_NOTES[connection] : undefined;
	return (
		<section className='race-timer-panel'>
			<div className='race-timer-panel-head'>
				<h3>レースタイマー</h3>
				{label && (
					<span className={`timer-label phase-${raceTimerPhase(state)}`}>
						{label}
					</span>
				)}
			</div>
			<RaceTimer
				state={state}
				precision='tenths'
				className='race-timer-large'
			/>
			{note && <p className='muted'>{note}</p>}
		</section>
	);
}
