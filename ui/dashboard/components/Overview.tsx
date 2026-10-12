import type {
	Entrant,
	Participant,
	Race,
	RaceState,
	RacesState,
} from "@nanahuse/racetime-protocol";
import {useRef, useState} from "react";
import {errorMessage, request} from "../api/client";
import {beginRegistration, playerEditUrl} from "../api/player-manager";
import {Callout} from "./common";

function counts(participants: readonly Participant[]) {
	const matched = participants.filter((p) => p.status === "matched").length;
	const unresolved = participants.filter(
		(p) => p.status === "unresolved",
	).length;
	const unavailable = participants.filter(
		(p) => p.status === "unavailable",
	).length;
	return {matched, unresolved, unavailable};
}

function orderParticipants(participants: readonly Participant[]) {
	const rank = {unavailable: 0, unresolved: 1, matched: 2} as const;
	return [...participants].sort((a, b) => rank[a.status] - rank[b.status]);
}

function entrantNames(entrants: readonly Entrant[]) {
	return new Map(entrants.map((entrant) => [entrant.userId, entrant.name]));
}

/** Fields common to a single Race, used by both monitored and fetched views. */
function RaceFields({race}: {race: Race}) {
	return (
		<dl className='details'>
			<div>
				<dt>Race ID</dt>
				<dd>{race.raceId}</dd>
			</div>
			<div>
				<dt>Game / Goal</dt>
				<dd>
					{race.category.name} / {race.category.goal}
				</dd>
			</div>
			<div>
				<dt>RaceTime status</dt>
				<dd>{race.status}</dd>
			</div>
			<div>
				<dt>Entrants</dt>
				<dd>{race.entrants.length}</dd>
			</div>
		</dl>
	);
}

function MonitoredDetails({state}: {state: RaceState}) {
	const summary = counts(state.participants);
	return (
		<div className='subpanel'>
			{state.race ? (
				<RaceFields race={state.race} />
			) : (
				<p className='muted'>レース情報を取得できていません。</p>
			)}
			<dl className='details'>
				<div>
					<dt>Connection</dt>
					<dd>{state.connection}</dd>
				</div>
				<div>
					<dt>Matched / Unresolved / Unavailable</dt>
					<dd>
						{summary.matched} / {summary.unresolved} / {summary.unavailable}
					</dd>
				</div>
				<div>
					<dt>Race revision</dt>
					<dd>{state.raceRevision}</dd>
				</div>
				<div>
					<dt>Participants revision</dt>
					<dd>{state.participantsRevision}</dd>
				</div>
			</dl>
			{state.error && <Callout tone='error'>{state.error}</Callout>}
		</div>
	);
}

function FetchedDetails({race}: {race: Race}) {
	return (
		<div className='subpanel'>
			<RaceFields race={race} />
			<p className='muted'>
				単発取得の結果です（watchIdなし・Player解決なし）。
			</p>
		</div>
	);
}

function Entrants({entrants}: {entrants: readonly Entrant[]}) {
	return (
		<ul className='list'>
			{entrants.map((entrant) => (
				<li key={entrant.userId}>
					<strong>{entrant.name}</strong>
					<small>{entrant.userId}</small>
				</li>
			))}
		</ul>
	);
}

function ParticipantActions({
	participant,
	onRegister,
}: {
	participant: Participant;
	onRegister: (participant: Participant) => void;
}) {
	if (participant.status === "matched" && participant.playerId)
		return (
			<a
				className='link'
				href={playerEditUrl(participant.playerId)}
				target='_blank'
				rel='noopener noreferrer'
			>
				編集 ↗
			</a>
		);
	if (participant.status === "unresolved")
		return (
			<button
				type='button'
				onClick={() => onRegister(participant)}
			>
				登録・紐付け
			</button>
		);
	return null;
}

function Participants({
	participants,
	entrants,
	onRegister,
}: {
	participants: readonly Participant[];
	entrants: readonly Entrant[];
	onRegister: (participant: Participant) => void;
}) {
	if (participants.length === 0)
		return <p className='muted'>参加者はまだ解決されていません。</p>;
	const names = entrantNames(entrants);
	return (
		<table className='participants'>
			<thead>
				<tr>
					<th>RaceTime</th>
					<th>Player</th>
					<th>SRC / Twitch</th>
					<th>状態</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{participants.map((participant) => (
					<tr
						key={participant.racetimeUserId}
						className={participant.status}
					>
						<td>
							<div>
								{names.get(participant.racetimeUserId) ??
									participant.player?.racetime?.name ??
									"—"}
							</div>
							<small>{participant.racetimeUserId}</small>
						</td>
						<td>
							{participant.player ? (
								<>
									<div>{participant.player.displayName}</div>
									<small>{participant.playerId}</small>
								</>
							) : (
								<span className='muted'>—</span>
							)}
						</td>
						<td>
							<div>SRC: {participant.player?.speedrunCom?.name ?? "—"}</div>
							<div>Twitch: {participant.player?.twitch?.login ?? "—"}</div>
						</td>
						<td>
							<span className={`badge ${participant.status}`}>
								{participant.status}
							</span>
							{participant.message && <small>{participant.message}</small>}
						</td>
						<td>
							<ParticipantActions
								participant={participant}
								onRegister={onRegister}
							/>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function Overview({races}: {races: RacesState | undefined}) {
	const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
	const [urlInput, setUrlInput] = useState("");
	const [fetched, setFetched] = useState<Race | null>(null);
	const [registrationUrl, setRegistrationUrl] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fetchGen = useRef(0);

	const list = races?.races ?? [];
	const monitored =
		selectedUrl === null
			? null
			: (list.find((race) => race.url === selectedUrl) ?? null);

	const selectMonitored = (url: string) => {
		fetchGen.current++;
		setSelectedUrl(url);
		setFetched(null);
		setError(null);
		setBusy(false);
	};

	const runFetch = async () => {
		const gen = ++fetchGen.current;
		setBusy(true);
		setError(null);
		setRegistrationUrl(null);
		try {
			const race = await request("fetchRace", {url: urlInput.trim()});
			if (gen !== fetchGen.current) return;
			setFetched(race);
			setSelectedUrl(null);
		} catch (cause) {
			if (gen !== fetchGen.current) return;
			setFetched(null);
			setError(errorMessage(cause));
		} finally {
			if (gen === fetchGen.current) setBusy(false);
		}
	};

	const register = async (participant: Participant) => {
		setBusy(true);
		setError(null);
		try {
			const session = await beginRegistration(participant.racetimeUserId);
			setRegistrationUrl(session.url);
			window.open(session.url, "_blank", "noopener,noreferrer");
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='overview layout-two'>
			<aside className='panel'>
				<h2>監視中のレース</h2>
				{list.length === 0 && (
					<p className='muted'>監視中のレースはありません。</p>
				)}
				<ul className='list'>
					{list.map((race) => (
						<li key={race.url}>
							<button
								type='button'
								className={selectedUrl === race.url ? "active" : ""}
								onClick={() => selectMonitored(race.url)}
							>
								<strong>{race.race?.raceId ?? race.url}</strong>
								<small>
									{race.connection} · E{race.participantsRevision}
								</small>
							</button>
						</li>
					))}
				</ul>
				<div className='subpanel'>
					<h3>URLで単発取得</h3>
					<div className='formrow'>
						<input
							aria-label='RaceTime race URL'
							placeholder='https://racetime.gg/game/race'
							value={urlInput}
							onChange={(event) => setUrlInput(event.target.value)}
						/>
						<button
							type='button'
							disabled={busy || urlInput.trim() === ""}
							onClick={() => void runFetch()}
						>
							{busy ? "取得中…" : "取得"}
						</button>
					</div>
					<p className='muted'>watchIdは生成せず、監視には影響しません。</p>
				</div>
			</aside>
			<section className='panel'>
				<h2>レース詳細</h2>
				{error && <Callout tone='error'>{error}</Callout>}
				{registrationUrl && (
					<Callout tone='success'>
						登録画面を開きました:{" "}
						<a
							className='link'
							href={registrationUrl}
							target='_blank'
							rel='noopener noreferrer'
						>
							{registrationUrl}
						</a>
					</Callout>
				)}
				{monitored ? (
					<>
						<MonitoredDetails state={monitored} />
						<h3>参加者</h3>
						<Participants
							participants={orderParticipants(monitored.participants)}
							entrants={monitored.race?.entrants ?? []}
							onRegister={(participant) => void register(participant)}
						/>
					</>
				) : fetched ? (
					<>
						<FetchedDetails race={fetched} />
						<h3>参加者</h3>
						{fetched.entrants.length > 0 ? (
							<Entrants entrants={fetched.entrants} />
						) : (
							<p className='muted'>参加者はいません。</p>
						)}
					</>
				) : (
					<p className='muted'>レースを選択するかURLで取得してください。</p>
				)}
			</section>
		</div>
	);
}
