import {
	BUNDLE_NAME,
	type Entrant,
	eventMessageName,
	type Participant,
	type Race,
	type RaceResult,
	type RaceState,
	type RacesState,
	type RaceTimeEvents,
	type SpeedrunPlayerBest,
} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useRef, useState} from "react";
import {errorMessage, request} from "../api/client";
import {getNodeCG} from "../api/nodecg-client";
import {beginRegistration, playerEditUrl} from "../api/player-manager";
import type {EditorState} from "../model/editor";
import {useAccountProfileUrl} from "../model/profile-url";
import {
	formatFinishTime,
	formatRaceClock,
	formatRaceInstant,
	formatRaceTime,
} from "../model/race-time";
import {Callout} from "./common";
import {
	MappingWorkspace,
	type RaceMappingTarget,
	targetKeyOf,
} from "./Mappings";
import {MonitoredRaceList} from "./MonitoredRaceList";
import {RaceLeaderboard} from "./RaceLeaderboard";
import {RaceTimerPanel} from "./RaceTimerPanel";

type EventLogEntry = {
	id: number;
	receivedAt: string;
	event: keyof RaceTimeEvents;
	details: string[];
};
type EventLogsByRace = Record<string, EventLogEntry[]>;

type PendingSelection = {
	url: string;
	generation: number;
};

function eventDetails<K extends keyof RaceTimeEvents>(
	event: K,
	data: RaceTimeEvents[K],
): Omit<EventLogEntry, "id"> {
	let details: string[];
	switch (event) {
		case "raceStartScheduled":
		case "raceStarted":
			details = [
				formatRaceInstant((data as RaceTimeEvents["raceStarted"]).startedAt),
			];
			break;
		case "entrantFinished": {
			const result = (data as RaceTimeEvents["entrantFinished"]).result;
			details = [result.userId, formatFinishTime(result.time)];
			break;
		}
		case "entrantFinishUndone":
			details = [(data as RaceTimeEvents["entrantFinishUndone"]).userId];
			break;
		case "raceCancelled":
			details = [
				formatRaceInstant(
					(data as RaceTimeEvents["raceCancelled"]).cancelledAt,
				),
			];
			break;
	}
	return {
		receivedAt: new Date().toISOString(),
		event,
		details,
	};
}

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

function raceTarget(race: Race): RaceMappingTarget {
	return {
		categorySlug: race.category.slug,
		categoryName: race.category.name,
		goal: race.category.goal,
	};
}

/** Fields common to a single Race. */
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
				<dd>{race.entrantsCount}</dd>
			</div>
			{[
				["作成日時", formatRaceInstant(race.openedAt)],
				["開始日時", formatRaceInstant(race.startedAt)],
				["終了日時", formatRaceInstant(race.endedAt)],
				["中止日時", formatRaceInstant(race.cancelledAt)],
				["カウントダウン", formatRaceTime(race.startDelay)],
				["制限時間", formatRaceTime(race.timeLimit)],
				["レース説明", race.info],
				["記録対象設定", race.ranked ? "有効" : "無効"],
				["記録可能状態", race.recordable ? "可能" : "不可"],
				["記録済み状態", race.recorded ? "記録済み" : "未記録"],
				["完走人数", race.entrantsCountFinished],
				["DNF / DQ人数", race.entrantsCountInactive],
				[
					"制限時間到達時",
					race.timeLimitAutoComplete ? "レースを完了" : "レースを中止",
				],
			].map(([label, value]) => (
				<div key={label}>
					<dt>{label}</dt>
					<dd>{value}</dd>
				</div>
			))}
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

function AccountLink({
	label,
	name,
	accountId,
}: {
	label: string;
	name: string | null;
	accountId: string | null;
}) {
	const {state, retry} = useAccountProfileUrl(name ? accountId : null);
	if (!name) return <div>{label}: —</div>;
	if (state?.state === "ready" && state.url)
		return (
			<div>
				{label}:{" "}
				<a
					className='link'
					href={state.url}
					target='_blank'
					rel='noopener noreferrer'
				>
					{name}
				</a>
			</div>
		);
	return (
		<div>
			{label}: <span>{name}</span>
			{state?.state === "error" && (
				<button
					type='button'
					className='retry-link'
					title={state.error ?? undefined}
					onClick={retry}
				>
					再試行
				</button>
			)}
		</div>
	);
}

function Participants({
	participants,
	race,
	onRegister,
	registerDisabled,
	bests = [],
	bestsLoading = false,
	bestsError = null,
	onRefreshBests,
}: {
	participants: readonly Participant[];
	race: Race | null;
	onRegister: (participant: Participant) => void;
	registerDisabled: boolean;
	bests?: Array<{playerId: string; label: string; best: SpeedrunPlayerBest}>;
	bestsLoading?: boolean;
	bestsError?: string | null;
	onRefreshBests?: () => void;
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
		<>
			<div className='formrow'>
				<button
					type='button'
					disabled={bestsLoading}
					onClick={onRefreshBests}
				>
					PBを再取得
				</button>
			</div>
			<table className='participants'>
				<thead>
					<tr>
						<th>RaceTime</th>
						<th>Player</th>
						<th>SRC / Twitch</th>
						<th>PB</th>
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
									<AccountLink
										label='SRC'
										name={participant.player?.speedrunCom?.name ?? null}
										accountId={
											participant.player?.primaryAccountIds?.speedrunCom ?? null
										}
									/>
									<AccountLink
										label='Twitch'
										name={participant.player?.twitch?.login ?? null}
										accountId={
											participant.player?.primaryAccountIds?.twitch ?? null
										}
									/>
								</td>
								<td>
									{participant.playerId ? (
										bestsLoading ? (
											<span className='muted'>取得中…</span>
										) : bestsError ? (
											<span title={bestsError}>
												{bestsError.includes("マッピング")
													? bestsError
													: "取得失敗"}
											</span>
										) : bests.filter(
												(item) => item.playerId === participant.playerId,
											).length ? (
											bests
												.filter(
													(item) => item.playerId === participant.playerId,
												)
												.map((item) => (
													<div key={item.label}>
														<small>{item.label}: </small>
														{item.best.state === "found" && item.best.run ? (
															<a
																className='link'
																href={item.best.run.url}
																target='_blank'
																rel='noopener noreferrer'
															>
																{formatRaceTime(item.best.run.time)}
																{item.best.place !== null &&
																	` · ${item.best.place}位`}
															</a>
														) : (
															<span className='muted'>
																{item.best.state === "not_found"
																	? "記録なし"
																	: item.best.state === "unlinked"
																		? "未連携"
																		: "取得失敗"}
															</span>
														)}
														{item.best.stale && (
															<small className='muted'>古いデータ</small>
														)}
													</div>
												))
										) : (
											<span className='muted'>取得待ち</span>
										)
									) : (
										<span className='muted'>
											{participant.status === "unresolved"
												? "Player未解決"
												: "SRC未連携"}
										</span>
									)}
								</td>
								<td>
									{result ? (
										<>
											<div>
												{result.place === null ? "—" : `${result.place}位`}
											</div>
											<div>{formatFinishTime(result.time)}</div>
											<div>
												完走日時: {formatRaceInstant(result.finishedAt)}
											</div>
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
		</>
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
	const [addingWatch, setAddingWatch] = useState(false);
	const [pendingSelection, setPendingSelection] =
		useState<PendingSelection | null>(null);
	const [eventLogsByRace, setEventLogsByRace] = useState<EventLogsByRace>({});
	const [registrationUrl, setRegistrationUrl] = useState<string | null>(null);
	const [registrationError, setRegistrationError] = useState<string | null>(
		null,
	);
	const [mappingBusy, setMappingBusy] = useState(false);
	const [mappingRevision, setMappingRevision] = useState(0);
	const [mappingDirty, setMappingDirty] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [forceTarget, setForceTarget] = useState<{
		url: string;
		label: string;
	} | null>(null);
	const [forceReleasing, setForceReleasing] = useState(false);
	const [forceError, setForceError] = useState<string | null>(null);
	const forceInFlight = useRef(false);
	const addInFlight = useRef(false);
	const selectionGeneration = useRef(0);
	const eventSequence = useRef(0);
	// The monitored race snapshot currently shown. It is pinned while there are
	// unsaved mapping edits so an external Replicant update cannot discard them.
	const [monitoredTarget, setMonitoredTarget] = useState<{
		key: string;
		state: RaceState;
	} | null>(null);
	const [externalPrompt, setExternalPrompt] = useState<
		"changed" | "removed" | null
	>(null);
	const [externalNotice, setExternalNotice] = useState<
		"changed" | "removed" | null
	>(null);
	const [pendingRace, setPendingRace] = useState<(() => void) | null>(null);
	// Identifies the currently displayed race so a registration that finishes
	// after the user moved on cannot change the view.
	const viewRef = useRef(0);
	const registerGen = useRef(0);
	const activeRegistration = useRef<{
		view: number;
		participant: string;
	} | null>(null);
	const mappingRef = useRef<EditorState>({dirty: false, busy: false});
	const acknowledgedExternalRef = useRef<string | null>(null);

	useEffect(() => {
		const nodecg = getNodeCG();
		const append = <K extends keyof RaceTimeEvents>(
			event: K,
			data: RaceTimeEvents[K],
		) => {
			const entry = {...eventDetails(event, data), id: ++eventSequence.current};
			setEventLogsByRace((current) => ({
				...current,
				[data.url]: [...(current[data.url] ?? []), entry].slice(-100),
			}));
		};
		const raceStartScheduled = (data: RaceTimeEvents["raceStartScheduled"]) =>
			append("raceStartScheduled", data);
		const raceStarted = (data: RaceTimeEvents["raceStarted"]) =>
			append("raceStarted", data);
		const entrantFinished = (data: RaceTimeEvents["entrantFinished"]) =>
			append("entrantFinished", data);
		const entrantFinishUndone = (data: RaceTimeEvents["entrantFinishUndone"]) =>
			append("entrantFinishUndone", data);
		const raceCancelled = (data: RaceTimeEvents["raceCancelled"]) =>
			append("raceCancelled", data);
		nodecg.listenFor(
			eventMessageName("raceStartScheduled"),
			BUNDLE_NAME,
			raceStartScheduled,
		);
		nodecg.listenFor(eventMessageName("raceStarted"), BUNDLE_NAME, raceStarted);
		nodecg.listenFor(
			eventMessageName("entrantFinished"),
			BUNDLE_NAME,
			entrantFinished,
		);
		nodecg.listenFor(
			eventMessageName("entrantFinishUndone"),
			BUNDLE_NAME,
			entrantFinishUndone,
		);
		nodecg.listenFor(
			eventMessageName("raceCancelled"),
			BUNDLE_NAME,
			raceCancelled,
		);
		return () => {
			nodecg.unlisten(
				eventMessageName("raceStartScheduled"),
				BUNDLE_NAME,
				raceStartScheduled,
			);
			nodecg.unlisten(
				eventMessageName("raceStarted"),
				BUNDLE_NAME,
				raceStarted,
			);
			nodecg.unlisten(
				eventMessageName("entrantFinished"),
				BUNDLE_NAME,
				entrantFinished,
			);
			nodecg.unlisten(
				eventMessageName("entrantFinishUndone"),
				BUNDLE_NAME,
				entrantFinishUndone,
			);
			nodecg.unlisten(
				eventMessageName("raceCancelled"),
				BUNDLE_NAME,
				raceCancelled,
			);
		};
	}, []);

	const list = races?.races ?? [];
	const liveMonitored =
		selectedUrl === null
			? null
			: (list.find((race) => race.url === selectedUrl) ?? null);
	const monitoredDisplay = monitoredTarget?.state ?? liveMonitored;
	const isMonitored = selectedUrl !== null && monitoredDisplay !== null;
	const visibleEventLog = monitoredDisplay
		? (eventLogsByRace[monitoredDisplay.url] ?? [])
		: [];
	const displayedRace = monitoredDisplay?.race ?? null;
	const target: RaceMappingTarget | null = displayedRace
		? raceTarget(displayedRace)
		: null;
	const targetKey = target ? targetKeyOf(target) : null;
	const shownParticipants = monitoredDisplay?.participants ?? [];
	const playerIds = [
		...new Set(
			shownParticipants.flatMap((participant) =>
				participant.playerId ? [participant.playerId] : [],
			),
		),
	];
	const playerDirectoryKey = JSON.stringify(
		shownParticipants.flatMap((participant) =>
			participant.playerId && participant.player
				? [[participant.playerId, participant.player.revision]]
				: [],
		),
	);
	const playerQueryKey = JSON.stringify({playerIds, playerDirectoryKey});
	const targetCategorySlug = target?.categorySlug ?? null;
	const targetGoal = target?.goal ?? null;
	const [participantBests, setParticipantBests] = useState<
		Array<{playerId: string; label: string; best: SpeedrunPlayerBest}>
	>([]);
	const [bestsLoading, setBestsLoading] = useState(false);
	const [bestsError, setBestsError] = useState<string | null>(null);
	const [bestsMappingRevision, setBestsMappingRevision] = useState(-1);
	const [bestsRefreshToken, setBestsRefreshToken] = useState(0);
	const lastBestsRefreshToken = useRef(0);
	useEffect(() => {
		const requestPlayerIds = (
			JSON.parse(playerQueryKey) as {
				playerIds: string[];
				playerDirectoryKey: string;
			}
		).playerIds;
		if (!targetCategorySlug || !targetGoal || requestPlayerIds.length === 0) {
			setParticipantBests([]);
			setBestsLoading(false);
			setBestsError(null);
			setBestsMappingRevision(mappingRevision);
			return;
		}
		let active = true;
		setBestsMappingRevision(mappingRevision);
		setBestsLoading(true);
		setBestsError(null);
		void request("getSpeedrunPlayerBests", {
			categorySlug: targetCategorySlug,
			goal: targetGoal,
			playerIds: requestPlayerIds,
			refresh: bestsRefreshToken > lastBestsRefreshToken.current,
		})
			.then((response) => {
				if (!active) return;
				if (response.status !== "resolved") {
					setParticipantBests([]);
					setBestsError(
						response.status === "unregistered"
							? "マッピング未登録"
							: response.message,
					);
					return;
				}
				setParticipantBests(
					response.results?.flatMap(({mapping, players}) =>
						players.map((best) => ({
							playerId: best.playerId ?? "",
							label: mapping.label,
							best,
						})),
					) ?? [],
				);
			})
			.catch((cause) => {
				if (active) {
					setParticipantBests([]);
					setBestsError(errorMessage(cause));
				}
			})
			.finally(() => {
				if (active) setBestsLoading(false);
			});
		return () => {
			active = false;
		};
	}, [
		targetCategorySlug,
		targetGoal,
		playerQueryKey,
		bestsRefreshToken,
		mappingRevision,
	]);
	useEffect(() => {
		lastBestsRefreshToken.current = bestsRefreshToken;
	}, [bestsRefreshToken]);
	const targetKeyRef = useRef<string | null>(null);
	targetKeyRef.current = targetKey;
	const bestsMappingCurrent = bestsMappingRevision === mappingRevision;

	const reportMapping = useCallback(
		(state: EditorState) => {
			mappingRef.current = state;
			setMappingBusy(state.busy);
			setMappingDirty(state.dirty);
			onStateChange?.(state);
		},
		[onStateChange],
	);

	const clearRegistration = useCallback(() => {
		setRegistrationUrl(null);
		setRegistrationError(null);
	}, []);

	// Invalidate the registration in-flight for the race that is being dismissed
	// so a late response cannot open the registration screen.
	const endDisplay = useCallback(() => {
		viewRef.current++;
		clearRegistration();
	}, [clearRegistration]);

	useEffect(() => {
		if (targetKey !== null) return;
		mappingRef.current = {dirty: false, busy: false};
		setMappingBusy(false);
		setMappingDirty(false);
		onStateChange?.({dirty: false, busy: false});
	}, [targetKey, onStateChange]);

	// External Replicant updates must not silently replace the mapping target
	// while the user has unsaved edits. Follow normal updates, but hold the
	// current target and ask before switching when only the target changed.
	useEffect(() => {
		if (selectedUrl === null) {
			setMonitoredTarget(null);
			setExternalPrompt(null);
			setExternalNotice(null);
			acknowledgedExternalRef.current = null;
			return;
		}
		const live = list.find((race) => race.url === selectedUrl) ?? null;
		if (live === null) {
			// The monitored race was removed from the Replicant.
			if (monitoredTarget === null) {
				setSelectedUrl(null);
				return;
			}
			if (mappingBusy) return;
			if (mappingDirty) {
				if (acknowledgedExternalRef.current === "removed")
					setExternalNotice((current) => current ?? "removed");
				else setExternalPrompt((current) => current ?? "removed");
				return;
			}
			endDisplay();
			setMonitoredTarget(null);
			setSelectedUrl(null);
			setExternalPrompt(null);
			setExternalNotice(null);
			acknowledgedExternalRef.current = null;
			return;
		}
		if (live.race === null) {
			// The entry still exists but its snapshot is temporarily missing.
			// Keep the displayed race, its target and any in-flight registration.
			return;
		}
		const liveKey = targetKeyOf(raceTarget(live.race));
		if (monitoredTarget === null) {
			setMonitoredTarget({key: liveKey, state: live});
			return;
		}
		if (liveKey === monitoredTarget.key) {
			if (live !== monitoredTarget.state)
				setMonitoredTarget({key: liveKey, state: live});
			if (externalPrompt !== null) setExternalPrompt(null);
			if (externalNotice !== null) setExternalNotice(null);
			acknowledgedExternalRef.current = null;
			return;
		}
		if (mappingBusy) return;
		if (mappingDirty) {
			if (acknowledgedExternalRef.current === liveKey)
				setExternalNotice((current) => current ?? "changed");
			else setExternalPrompt((current) => current ?? "changed");
			return;
		}
		// Same race, only its goal/category changed: switching the mapping target
		// must not invalidate an in-flight participant registration.
		setMonitoredTarget({key: liveKey, state: live});
		setExternalPrompt(null);
		setExternalNotice(null);
		acknowledgedExternalRef.current = null;
	}, [
		selectedUrl,
		list,
		monitoredTarget,
		mappingBusy,
		mappingDirty,
		externalPrompt,
		externalNotice,
		endDisplay,
	]);

	const markExternalAcknowledged = () => {
		const live =
			selectedUrl === null
				? null
				: (list.find((race) => race.url === selectedUrl) ?? null);
		acknowledgedExternalRef.current = live?.race
			? targetKeyOf(raceTarget(live.race))
			: "removed";
	};

	const keepEditing = () => {
		markExternalAcknowledged();
		setExternalNotice(externalPrompt);
		setExternalPrompt(null);
	};

	const showLatest = () => {
		if (mappingRef.current.busy) return;
		const live =
			selectedUrl === null
				? null
				: (list.find((race) => race.url === selectedUrl) ?? null);
		if (live === null) {
			// The monitored race was removed: dismissing invalidates any
			// in-flight registration.
			endDisplay();
			setMonitoredTarget(null);
			setSelectedUrl(null);
		} else if (live.race === null) {
			// The entry still exists but its snapshot is temporarily missing.
			// Keep the displayed race, workspace, draft and registration, and
			// keep waiting so the latest state can be applied once available.
			return;
		} else {
			setMonitoredTarget({
				key: targetKeyOf(raceTarget(live.race)),
				state: live,
			});
		}
		setExternalPrompt(null);
		setExternalNotice(null);
		acknowledgedExternalRef.current = null;
	};

	const applySelection = useCallback(
		(url: string) => {
			viewRef.current++;
			const live = list.find((race) => race.url === url) ?? null;
			setMonitoredTarget(
				live?.race
					? {key: targetKeyOf(raceTarget(live.race)), state: live}
					: null,
			);
			setExternalPrompt(null);
			setExternalNotice(null);
			acknowledgedExternalRef.current = null;
			setSelectedUrl(url);
			clearRegistration();
			setError(null);
		},
		[clearRegistration, list],
	);

	const guardRaceChange = useCallback(
		(nextKey: string | null, action: () => void) => {
			if (mappingRef.current.busy) return;
			if (mappingRef.current.dirty && nextKey !== targetKeyRef.current) {
				setPendingRace(() => action);
				return;
			}
			action();
		},
		[],
	);

	const selectMonitored = useCallback(
		(url: string) => {
			const next = list.find((race) => race.url === url)?.race ?? null;
			const nextKey = next
				? targetKeyOf({
						categorySlug: next.category.slug,
						categoryName: next.category.name,
						goal: next.category.goal,
					})
				: null;
			guardRaceChange(nextKey, () => applySelection(url));
		},
		[applySelection, guardRaceChange, list],
	);

	useEffect(() => {
		if (pendingSelection === null || mappingBusy) return;
		if (pendingSelection.generation !== selectionGeneration.current) {
			setPendingSelection(null);
			return;
		}
		const pending = list.find(
			(race) => race.url === pendingSelection.url && race.race !== null,
		);
		if (!pending) return;
		setPendingSelection(null);
		selectMonitored(pending.url);
	}, [pendingSelection, list, mappingBusy, selectMonitored]);

	const addWatch = async () => {
		const url = urlInput.trim();
		if (url === "" || addInFlight.current) return;
		const generation = ++selectionGeneration.current;
		setPendingSelection(null);
		addInFlight.current = true;
		setAddingWatch(true);
		setError(null);
		try {
			const existing = await request("getRace", {url});
			if (existing !== null) {
				if (generation === selectionGeneration.current)
					setPendingSelection({url: existing.url, generation});
				return;
			}
			const {state} = await request("watchRace", {url});
			if (generation === selectionGeneration.current)
				setPendingSelection({url: state.url, generation});
		} catch (cause) {
			if (generation === selectionGeneration.current)
				setError(errorMessage(cause));
		} finally {
			addInFlight.current = false;
			setAddingWatch(false);
		}
	};

	const forceUnwatch = async () => {
		if (!forceTarget || forceInFlight.current) return;
		selectionGeneration.current += 1;
		setPendingSelection(null);
		forceInFlight.current = true;
		setForceReleasing(true);
		setForceError(null);
		try {
			await request("forceUnwatchRace", {url: forceTarget.url});
			setForceTarget(null);
		} catch (cause) {
			setForceError(errorMessage(cause));
		} finally {
			forceInFlight.current = false;
			setForceReleasing(false);
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
				<MonitoredRaceList
					races={list}
					selectedUrl={selectedUrl}
					onSelect={(url) => {
						selectionGeneration.current += 1;
						setPendingSelection(null);
						selectMonitored(url);
					}}
				/>
				<div className='subpanel'>
					<h3>URLで監視を追加</h3>
					<div className='formrow'>
						<input
							aria-label='RaceTime race URL'
							placeholder='https://racetime.gg/game/race'
							value={urlInput}
							onChange={(event) => setUrlInput(event.target.value)}
						/>
						<button
							type='button'
							disabled={addingWatch || urlInput.trim() === ""}
							onClick={() => void addWatch()}
						>
							{addingWatch ? "追加中…" : "追加"}
						</button>
					</div>
				</div>
			</aside>
			<section className='panel'>
				<div className='toolbar'>
					<h2>レース詳細</h2>
					{liveMonitored && (
						<button
							type='button'
							disabled={forceReleasing}
							onClick={() => {
								setForceError(null);
								setForceTarget({
									url: liveMonitored.url,
									label: liveMonitored.race?.raceId ?? liveMonitored.url,
								});
							}}
						>
							監視を停止
						</button>
					)}
				</div>
				{error && <Callout tone='error'>{error}</Callout>}
				{registrationError && (
					<Callout tone='error'>{registrationError}</Callout>
				)}
				{externalNotice && (
					<Callout tone='warning'>
						{externalNotice === "changed"
							? "監視中のレース情報が更新され、Mappingの対象が変更されました。"
							: "監視中のレースが監視対象から削除されました。"}
						<button
							type='button'
							disabled={mappingBusy}
							onClick={showLatest}
						>
							{externalNotice === "changed" ? "最新状態を表示" : "表示を解除"}
						</button>
					</Callout>
				)}
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
				{isMonitored && monitoredDisplay ? (
					<>
						<RaceTimerPanel
							race={liveMonitored?.race ?? null}
							connection={liveMonitored?.connection}
						/>
						<MonitoredDetails state={monitoredDisplay} />
						<div className='event-log subpanel'>
							<h3>イベントログ</h3>
							{visibleEventLog.length === 0 ? (
								<p className='muted'>受信したイベントはありません。</p>
							) : (
								<ol>
									{visibleEventLog.map((entry) => (
										<li key={entry.id}>
											<time dateTime={entry.receivedAt}>
												{formatRaceClock(entry.receivedAt)}
											</time>
											<span>{entry.event}</span>
											{entry.details.map((detail, index) => (
												<span key={`${entry.id}-${index}`}>{detail}</span>
											))}
										</li>
									))}
								</ol>
							)}
						</div>
						{target && (
							<MappingWorkspace
								key={targetKey}
								mode='race'
								target={target}
								onStateChange={reportMapping}
								onMappingChange={() => setMappingRevision((value) => value + 1)}
							/>
						)}
						<h3>参加者</h3>
						<Participants
							participants={orderParticipants(monitoredDisplay.participants)}
							race={monitoredDisplay.race}
							onRegister={(participant) => void register(participant)}
							registerDisabled={false}
							bests={bestsMappingCurrent ? participantBests : []}
							bestsLoading={bestsLoading || !bestsMappingCurrent}
							bestsError={bestsMappingCurrent ? bestsError : null}
							onRefreshBests={() => setBestsRefreshToken((value) => value + 1)}
						/>
						{target && (
							<RaceLeaderboard
								categorySlug={target.categorySlug}
								goal={target.goal}
								mappingRevision={mappingRevision}
							/>
						)}
					</>
				) : (
					<p className='muted'>レースを選択してください。</p>
				)}
			</section>
			{forceTarget && (
				<div className='dialog-backdrop'>
					<div
						className='dialog'
						role='dialog'
						aria-modal='true'
						aria-label='監視を停止しますか？'
					>
						<h3>監視を停止しますか？</h3>
						<p>対象：{forceTarget.label}</p>
						<p>このレースの監視をすべて停止します。</p>
						<p>他のバンドルが保持しているwatchIdも無効になります。</p>
						<p>RaceTime上のレース自体は変更されません。</p>
						{forceError && <Callout tone='error'>{forceError}</Callout>}
						<div className='button-row'>
							<button
								type='button'
								disabled={forceReleasing}
								onClick={() => setForceTarget(null)}
							>
								キャンセル
							</button>
							<button
								type='button'
								disabled={forceReleasing}
								onClick={() => void forceUnwatch()}
							>
								{forceReleasing ? "停止中…" : "監視を停止"}
							</button>
						</div>
					</div>
				</div>
			)}
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
			{externalPrompt && (
				<div className='dialog-backdrop'>
					<div className='dialog'>
						<p>
							{externalPrompt === "changed"
								? "監視中のレース情報が更新され、Mappingの対象が変更されました。未保存の変更を破棄して最新のレース情報を表示しますか？"
								: "監視中のレースが監視対象から削除されました。未保存の変更を破棄して表示を解除しますか？"}
						</p>
						<div className='button-row'>
							<button
								type='button'
								disabled={mappingBusy}
								onClick={showLatest}
							>
								{externalPrompt === "changed" ? "最新状態を表示" : "表示を解除"}
							</button>
							<button
								type='button'
								onClick={keepEditing}
							>
								編集を続ける
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
