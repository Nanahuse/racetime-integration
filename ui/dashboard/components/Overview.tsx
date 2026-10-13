import type {
	Entrant,
	Participant,
	Race,
	RaceResult,
	RaceState,
	RacesState,
	ResolvedRace,
} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useRef, useState} from "react";
import {errorMessage, request} from "../api/client";
import {beginRegistration, playerEditUrl} from "../api/player-manager";
import type {EditorState} from "../model/editor";
import {Callout} from "./common";
import {
	MappingWorkspace,
	type RaceMappingTarget,
	targetKeyOf,
} from "./Mappings";

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

function resultByUser(race: Race | null) {
	const results = new Map<string, RaceResult>();
	for (const result of race?.results ?? []) results.set(result.userId, result);
	return results;
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

function FetchedDetails({resolved}: {resolved: ResolvedRace}) {
	return (
		<div className='subpanel'>
			<RaceFields race={resolved.race} />
			{resolved.resolution.state === "error" && (
				<Callout tone='error'>
					参加者の解決に失敗しました。Player Managerを確認してください。
				</Callout>
			)}
		</div>
	);
}

function ParticipantActions({
	participant,
	onRegister,
	registerDisabled,
}: {
	participant: Participant;
	onRegister: (participant: Participant) => void;
	registerDisabled: boolean;
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
				disabled={registerDisabled}
				onClick={() => onRegister(participant)}
			>
				登録・紐付け
			</button>
		);
	return null;
}

function Participants({
	participants,
	race,
	onRegister,
	registerDisabled,
}: {
	participants: readonly Participant[];
	race: Race | null;
	onRegister: (participant: Participant) => void;
	registerDisabled: boolean;
}) {
	if (participants.length === 0)
		return race && race.entrants.length === 0 ? (
			<p className='muted'>参加者はいません。</p>
		) : (
			<p className='muted'>参加者はまだ解決されていません。</p>
		);
	const names = entrantNames(race?.entrants ?? []);
	const results = resultByUser(race);
	return (
		<table className='participants'>
			<thead>
				<tr>
					<th>RaceTime</th>
					<th>Player</th>
					<th>SRC / Twitch</th>
					<th>結果</th>
					<th>状態</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{participants.map((participant) => {
					const result = results.get(participant.racetimeUserId);
					return (
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
								{result ? (
									<>
										<div>
											{result.place === null ? "—" : `${result.place}位`}
										</div>
										<div>{result.time ?? "—"}</div>
										<small>{result.status}</small>
									</>
								) : (
									<span className='muted'>—</span>
								)}
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
									registerDisabled={registerDisabled}
								/>
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

export function Overview({
	races,
	onStateChange,
}: {
	races: RacesState | undefined;
	onStateChange?: (state: EditorState) => void;
}) {
	const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
	const [urlInput, setUrlInput] = useState("");
	const [fetched, setFetched] = useState<ResolvedRace | null>(null);
	const [registrationUrl, setRegistrationUrl] = useState<string | null>(null);
	const [registrationError, setRegistrationError] = useState<string | null>(
		null,
	);
	const [fetchNotice, setFetchNotice] = useState<string | null>(null);
	const [fetching, setFetching] = useState(false);
	const [mappingBusy, setMappingBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pendingRace, setPendingRace] = useState<(() => void) | null>(null);
	const fetchGen = useRef(0);
	// Identifies the currently displayed race so a registration that finishes
	// after the user moved on cannot change the view.
	const viewRef = useRef(0);
	const displayRef = useRef<string | null>(null);
	const displaySourceRef = useRef<"monitored" | "fetched" | null>(null);
	const registerGen = useRef(0);
	const activeRegistration = useRef<{
		view: number;
		participant: string;
	} | null>(null);
	const mappingRef = useRef<EditorState>({dirty: false, busy: false});

	const list = races?.races ?? [];
	const monitored =
		selectedUrl === null
			? null
			: (list.find((race) => race.url === selectedUrl) ?? null);
	const displayedRace = monitored?.race ?? fetched?.race ?? null;
	const target: RaceMappingTarget | null = displayedRace
		? {
				categorySlug: displayedRace.category.slug,
				categoryName: displayedRace.category.name,
				goal: displayedRace.category.goal,
			}
		: null;
	const targetKey = target ? targetKeyOf(target) : null;
	const targetKeyRef = useRef<string | null>(null);
	targetKeyRef.current = targetKey;

	const reportMapping = useCallback(
		(state: EditorState) => {
			mappingRef.current = state;
			setMappingBusy(state.busy);
			onStateChange?.(state);
		},
		[onStateChange],
	);

	useEffect(() => {
		if (targetKey !== null) return;
		mappingRef.current = {dirty: false, busy: false};
		setMappingBusy(false);
		onStateChange?.({dirty: false, busy: false});
	}, [targetKey, onStateChange]);

	const clearRegistration = () => {
		setRegistrationUrl(null);
		setRegistrationError(null);
	};

	const applySelection = (url: string) => {
		fetchGen.current++;
		viewRef.current++;
		displayRef.current = url;
		displaySourceRef.current = "monitored";
		setSelectedUrl(url);
		setFetched(null);
		clearRegistration();
		setFetchNotice(null);
		setError(null);
		setFetching(false);
	};

	const guardRaceChange = (nextKey: string | null, action: () => void) => {
		if (mappingRef.current.busy) return;
		if (mappingRef.current.dirty && nextKey !== targetKeyRef.current) {
			setPendingRace(() => action);
			return;
		}
		action();
	};

	const selectMonitored = (url: string) => {
		const next = list.find((race) => race.url === url)?.race ?? null;
		const nextKey = next
			? targetKeyOf({
					categorySlug: next.category.slug,
					categoryName: next.category.name,
					goal: next.category.goal,
				})
			: null;
		guardRaceChange(nextKey, () => applySelection(url));
	};

	const applyFetched = (resolved: ResolvedRace) => {
		if (displayRef.current !== resolved.race.url) {
			viewRef.current++;
			displayRef.current = resolved.race.url;
			// Registration results belong to the race that was displayed.
			clearRegistration();
		}
		displaySourceRef.current = "fetched";
		setFetchNotice(null);
		setFetched(resolved);
		setSelectedUrl(null);
	};

	const loadFetch = async (url: string) => {
		if (mappingRef.current.busy) return;
		const gen = ++fetchGen.current;
		setFetching(true);
		setError(null);
		setFetchNotice(null);
		try {
			const resolved = await request("fetchRace", {url});
			if (gen !== fetchGen.current) return;
			// A save that started while this request was in flight must not have
			// its workspace unmounted from under it.
			if (mappingRef.current.busy) {
				setFetchNotice(
					"マッピングの保存処理中だったため、取得したレースは表示に反映されませんでした。保存完了後に再度取得してください。",
				);
				return;
			}
			const nextKey = targetKeyOf({
				categorySlug: resolved.race.category.slug,
				categoryName: resolved.race.category.name,
				goal: resolved.race.category.goal,
			});
			if (mappingRef.current.dirty && nextKey !== targetKeyRef.current) {
				setPendingRace(() => () => applyFetched(resolved));
				return;
			}
			applyFetched(resolved);
		} catch (cause) {
			if (gen !== fetchGen.current) return;
			setError(errorMessage(cause));
			// A workspace that is saving or holds unsaved edits must survive a
			// failed fetch of another race.
			if (mappingRef.current.busy || mappingRef.current.dirty) return;
			if (displaySourceRef.current === "fetched") {
				displayRef.current = null;
				displaySourceRef.current = null;
				viewRef.current++;
				clearRegistration();
			}
			setFetched(null);
		} finally {
			if (gen === fetchGen.current) setFetching(false);
		}
	};

	const register = async (participant: Participant) => {
		const active = activeRegistration.current;
		if (
			active?.view === viewRef.current &&
			active.participant === participant.racetimeUserId
		)
			return;
		const view = viewRef.current;
		const gen = ++registerGen.current;
		activeRegistration.current = {
			view,
			participant: participant.racetimeUserId,
		};
		setRegistrationError(null);
		try {
			const session = await beginRegistration(participant.racetimeUserId);
			if (gen !== registerGen.current || view !== viewRef.current) return;
			setRegistrationUrl(session.url);
			setRegistrationError(null);
			window.open(session.url, "_blank", "noopener,noreferrer");
		} catch (cause) {
			if (gen !== registerGen.current || view !== viewRef.current) return;
			setRegistrationError(errorMessage(cause));
		} finally {
			if (gen === registerGen.current) activeRegistration.current = null;
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
							disabled={fetching || mappingBusy || urlInput.trim() === ""}
							onClick={() => void loadFetch(urlInput.trim())}
						>
							{fetching ? "取得中…" : "取得"}
						</button>
					</div>
					<p className='muted'>watchIdは生成せず、監視には影響しません。</p>
				</div>
			</aside>
			<section className='panel'>
				<h2>レース詳細</h2>
				{error && <Callout tone='error'>{error}</Callout>}
				{registrationError && (
					<Callout tone='error'>{registrationError}</Callout>
				)}
				{fetchNotice && <Callout tone='info'>{fetchNotice}</Callout>}
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
						{target && (
							<MappingWorkspace
								key={targetKey}
								mode='race'
								target={target}
								onStateChange={reportMapping}
							/>
						)}
						<h3>参加者</h3>
						<Participants
							participants={orderParticipants(monitored.participants)}
							race={monitored.race}
							onRegister={(participant) => void register(participant)}
							registerDisabled={false}
						/>
					</>
				) : fetched ? (
					<>
						<FetchedDetails resolved={fetched} />
						{target && (
							<MappingWorkspace
								key={targetKey}
								mode='race'
								target={target}
								onStateChange={reportMapping}
							/>
						)}
						<h3>参加者</h3>
						<Participants
							participants={orderParticipants(fetched.participants)}
							race={fetched.race}
							onRegister={(participant) => void register(participant)}
							registerDisabled={fetching}
						/>
						<div className='formrow'>
							<button
								type='button'
								disabled={fetching || mappingBusy}
								onClick={() => void loadFetch(fetched.race.url)}
							>
								{fetching ? "取得中…" : "再取得"}
							</button>
						</div>
					</>
				) : (
					<p className='muted'>レースを選択するかURLで取得してください。</p>
				)}
			</section>
			{pendingRace && (
				<div className='dialog-backdrop'>
					<div className='dialog'>
						<p>未保存のマッピング変更があります。破棄して移動しますか？</p>
						<div className='button-row'>
							<button
								type='button'
								onClick={() => {
									if (mappingRef.current.busy) return;
									const action = pendingRace;
									setPendingRace(null);
									action();
								}}
							>
								破棄して移動
							</button>
							<button
								type='button'
								onClick={() => setPendingRace(null)}
							>
								キャンセル
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
