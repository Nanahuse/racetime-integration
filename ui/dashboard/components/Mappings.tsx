import {
	type CategoryMapping,
	type CategoryMappingRecord,
	type GameMapping,
	type GameMappingRecord,
	type SpeedrunCategoryOption,
	type SpeedrunGameOptions,
	type SpeedrunGameSummary,
	type SpeedrunVariableOption,
	supportsAnySelection,
	type TimingMethod,
	type VariableSelection,
} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useRef, useState} from "react";
import {
	errorMessage,
	isConflict,
	isGameMappingConflict,
	isSettingsChanged,
	request,
} from "../api/client";
import type {EditorState} from "../model/editor";
import {Callout, Field} from "./common";
import {DiffTable} from "./DiffTable";

const TIMING_LABELS: Record<TimingMethod, string> = {
	realtime: "Real Time",
	realtime_noloads: "Real Time (no load removal)",
	ingame: "In-Game Time",
};

// UI-only sentinel for the Any choice. Uses a NUL prefix that cannot be a
// Speedrun.com Value ID, so it is never confused with a stored string value.
const ANY_SELECTION = "\u0000any";

function isAnySelection(value: VariableSelection | undefined): boolean {
	return value !== undefined && typeof value !== "string";
}

type Kind = "game" | "category";
type SessionStatus = "normal" | "conflict" | "invalid";

type GameSession = {
	status: SessionStatus;
	baseline: GameMapping | null;
	baselineRevision: string | null;
	// The untouched draft used for dirty comparison when nothing is saved yet.
	emptyDraft: GameMapping;
	draft: GameMapping;
	settingsRevision: number;
	conflict: GameMappingRecord | null;
	comparison: GameMapping | null;
};

type CategorySession = {
	status: SessionStatus;
	baseline: CategoryMapping | null;
	baselineRevision: string | null;
	emptyDraft: CategoryMapping;
	draft: CategoryMapping;
	settingsRevision: number;
	conflict: CategoryMappingRecord | null;
	comparison: CategoryMapping | null;
};

/** RaceTime identifiers that select the Game and Category Mapping in Overview. */
export type RaceMappingTarget = {
	categorySlug: string;
	categoryName: string;
	goal: string;
};

export type MappingWorkspaceProps =
	| {mode: "manage"; onStateChange?: (state: EditorState) => void}
	| {
			mode: "race";
			target: RaceMappingTarget;
			onStateChange?: (state: EditorState) => void;
			onMappingChange?: () => void;
	  };

function blankCategory(categorySlug: string): CategoryMapping {
	return {
		racetime: {categorySlug, goal: ""},
		speedrunCom: {
			gameId: "",
			categoryId: "",
			categoryName: "",
			levelId: null,
			variables: {},
			platformId: null,
			regionId: null,
			emulator: null,
			timingMethod: null,
		},
	};
}

export function targetKeyOf(target: RaceMappingTarget): string {
	return `${target.categorySlug.trim()}\u0000${target.goal.trim()}`;
}

function gameForTarget(target: RaceMappingTarget): GameMapping {
	return {
		racetime: {
			categorySlug: target.categorySlug,
			categoryName: target.categoryName,
		},
		speedrunCom: {gameId: "", gameName: ""},
	};
}

function categoryForTarget(target: RaceMappingTarget): CategoryMapping {
	return {
		racetime: {categorySlug: target.categorySlug, goal: target.goal},
		speedrunCom: {
			gameId: "",
			categoryId: "",
			categoryName: "",
			levelId: null,
			variables: {},
			platformId: null,
			regionId: null,
			emulator: null,
			timingMethod: null,
		},
	};
}

function withGoalGame(
	session: CategorySession,
	gameId: string,
): CategorySession {
	if (session.draft.speedrunCom.gameId === gameId) return session;
	return {
		...session,
		draft: {
			...session.draft,
			speedrunCom: {
				...blankCategory(session.draft.racetime.categorySlug).speedrunCom,
				gameId,
			},
		},
	};
}

function stringify(value: unknown): string {
	return JSON.stringify(value ?? null);
}

function findGame(
	records: readonly GameMappingRecord[],
	slug: string,
	gameId: string,
): GameMappingRecord | null {
	const key = slug.trim();
	return (
		records.find(
			(record) =>
				record.mapping.racetime.categorySlug.trim() === key &&
				record.mapping.speedrunCom.gameId === gameId,
		) ?? null
	);
}

function findCategory(
	records: readonly CategoryMappingRecord[],
	draft: CategoryMapping,
): CategoryMappingRecord | null {
	return findCategoryByKey(
		records,
		draft.racetime.categorySlug,
		draft.racetime.goal,
	);
}

function findCategoryByKey(
	records: readonly CategoryMappingRecord[],
	categorySlug: string,
	goal: string,
): CategoryMappingRecord | null {
	const key = `${categorySlug.trim()}\u0000${goal.trim()}`;
	return (
		records.find(
			(record) =>
				`${record.mapping.racetime.categorySlug.trim()}\u0000${record.mapping.racetime.goal.trim()}` ===
				key,
		) ?? null
	);
}

function gameIsDirty(session: GameSession): boolean {
	return (
		stringify(session.draft) !==
		stringify(session.baseline ?? session.emptyDraft)
	);
}

function categoryIsDirty(session: CategorySession): boolean {
	return (
		stringify(session.draft) !==
		stringify(session.baseline ?? session.emptyDraft)
	);
}

function reconcileGame(
	session: GameSession,
	latest: GameMappingRecord | null,
	settingsRevision: number,
): GameSession {
	if (settingsRevision !== session.settingsRevision)
		return {
			status: "normal",
			baseline: latest ? structuredClone(latest.mapping) : null,
			baselineRevision: latest?.revision ?? null,
			emptyDraft: session.emptyDraft,
			draft: latest
				? structuredClone(latest.mapping)
				: structuredClone(session.emptyDraft),
			settingsRevision,
			conflict: null,
			comparison: session.comparison ?? structuredClone(session.draft),
		};
	if (
		(latest?.revision ?? null) === session.baselineRevision &&
		(latest !== null) === (session.baseline !== null)
	)
		return session;
	if (!gameIsDirty(session)) {
		if (latest)
			return {
				status: "normal",
				baseline: structuredClone(latest.mapping),
				baselineRevision: latest.revision,
				emptyDraft: session.emptyDraft,
				draft: structuredClone(latest.mapping),
				settingsRevision: session.settingsRevision,
				conflict: null,
				comparison: null,
			};
		return {
			...session,
			status: "invalid",
			baseline: null,
			baselineRevision: null,
			draft: structuredClone(session.emptyDraft),
			conflict: null,
			comparison: null,
		};
	}
	return {...session, status: "conflict", conflict: latest, comparison: null};
}

function reconcileCategory(
	session: CategorySession,
	latest: CategoryMappingRecord | null,
	settingsRevision: number,
): CategorySession {
	if (settingsRevision !== session.settingsRevision)
		return {
			status: "normal",
			baseline: latest ? structuredClone(latest.mapping) : null,
			baselineRevision: latest?.revision ?? null,
			emptyDraft: session.emptyDraft,
			draft: latest
				? structuredClone(latest.mapping)
				: structuredClone(session.emptyDraft),
			settingsRevision,
			conflict: null,
			comparison: session.comparison ?? structuredClone(session.draft),
		};
	if (
		(latest?.revision ?? null) === session.baselineRevision &&
		(latest !== null) === (session.baseline !== null)
	)
		return session;
	if (!categoryIsDirty(session)) {
		if (latest)
			return {
				status: "normal",
				baseline: structuredClone(latest.mapping),
				baselineRevision: latest.revision,
				emptyDraft: session.emptyDraft,
				draft: structuredClone(latest.mapping),
				settingsRevision: session.settingsRevision,
				conflict: null,
				comparison: null,
			};
		return {
			...session,
			status: "invalid",
			baseline: null,
			baselineRevision: null,
			draft: structuredClone(session.emptyDraft),
			conflict: null,
			comparison: null,
		};
	}
	return {...session, status: "conflict", conflict: latest, comparison: null};
}

async function loadLists(): Promise<{
	games: GameMappingRecord[];
	categories: CategoryMappingRecord[];
	settingsRevision: number;
}> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const [gameList, categoryList] = await Promise.all([
			request("listGameMappings", undefined),
			request("listCategoryMappings", undefined),
		]);
		if (
			!Array.isArray(gameList.records) ||
			!Array.isArray(categoryList.records)
		)
			throw new Error("マッピング一覧の応答が不正です。");
		if (gameList.settingsRevision === categoryList.settingsRevision)
			return {
				games: gameList.records,
				categories: categoryList.records,
				settingsRevision: gameList.settingsRevision,
			};
	}
	throw new Error(
		"Game MappingとCategory Mappingの設定Revisionが一致しません。再取得してください。",
	);
}

export function Mappings({
	onStateChange,
}: {
	onStateChange?: (state: EditorState) => void;
}) {
	return (
		<MappingWorkspace
			mode='manage'
			onStateChange={onStateChange}
		/>
	);
}

export function MappingWorkspace(props: MappingWorkspaceProps) {
	const {mode, onStateChange} = props;
	const onMappingChange =
		props.mode === "race" ? props.onMappingChange : undefined;
	const target = props.mode === "race" ? props.target : null;

	const [games, setGames] = useState<GameMappingRecord[]>([]);
	const [categories, setCategories] = useState<CategoryMappingRecord[]>([]);
	const [listSettingsRevision, setListSettingsRevision] = useState<
		number | null
	>(null);
	const [gameQuery, setGameQuery] = useState("");
	const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
	const [gameMode, setGameMode] = useState<"add" | "rename" | null>(null);

	const [gameSession, setGameSession] = useState<GameSession | null>(null);
	const [categorySession, setCategorySession] =
		useState<CategorySession | null>(null);

	const [srcQuery, setSrcQuery] = useState("");
	const [srcResults, setSrcResults] = useState<SpeedrunGameSummary[]>([]);
	const [options, setOptions] = useState<SpeedrunGameOptions | null>(null);
	const [optionsFor, setOptionsFor] = useState<string | null>(null);
	const [variables, setVariables] = useState<SpeedrunVariableOption[]>([]);
	const [variablesFor, setVariablesFor] = useState<string | null>(null);
	const [variablesLoading, setVariablesLoading] = useState(false);

	const [busy, setBusy] = useState(false);
	// True only while a save/delete/reload replaces the editing state, so form
	// inputs can be locked without blocking reference-only operations.
	const [mutating, setMutating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<Kind | null>(null);
	const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [listsReady, setListsReady] = useState(false);
	const [listsError, setListsError] = useState<string | null>(null);
	const [confirmClose, setConfirmClose] = useState(false);

	const optionsGen = useRef(0);
	const variablesGen = useRef(0);
	const searchGen = useRef(0);
	const requestedOptions = useRef<string | null>(null);
	const requestedVariables = useRef<string | null>(null);

	const gameDirty = gameSession ? gameIsDirty(gameSession) : false;
	const categoryDirty = categorySession
		? categoryIsDirty(categorySession)
		: false;
	const dirty = gameDirty || categoryDirty;

	useEffect(() => {
		onStateChange?.({dirty, busy: busy || mutating});
	}, [dirty, busy, mutating, onStateChange]);

	const loadOptions = useCallback(async (gameId: string) => {
		const gen = ++optionsGen.current;
		if (!gameId) {
			setOptions(null);
			setOptionsFor(null);
			return;
		}
		try {
			const result = await request("getSpeedrunGameOptions", {gameId});
			if (gen !== optionsGen.current) return;
			setOptions(result);
			setOptionsFor(gameId);
		} catch (cause) {
			if (gen !== optionsGen.current) return;
			setOptions(null);
			setOptionsFor(null);
			setError(errorMessage(cause));
		}
	}, []);

	const loadVariables = useCallback(async (categoryId: string) => {
		const gen = ++variablesGen.current;
		if (!categoryId) {
			setVariables([]);
			setVariablesFor(null);
			setVariablesLoading(false);
			return;
		}
		setVariablesLoading(true);
		setVariables([]);
		setVariablesFor(null);
		try {
			const result = await request("getSpeedrunCategoryVariables", {
				categoryId,
			});
			if (gen !== variablesGen.current) return;
			setVariables(result.variables);
			setVariablesFor(categoryId);
			setVariablesLoading(false);
		} catch (cause) {
			if (gen !== variablesGen.current) return;
			setVariables([]);
			setVariablesFor(null);
			setVariablesLoading(false);
			setError(errorMessage(cause));
		}
	}, []);

	const refreshLists = useCallback(async () => {
		const result = await loadLists();
		setGames(result.games);
		setCategories(result.categories);
		setListSettingsRevision(result.settingsRevision);
		setListsReady(true);
		setListsError(null);
		setGameSession((session) =>
			session
				? reconcileGame(
						session,
						findGame(
							result.games,
							session.draft.racetime.categorySlug,
							session.draft.speedrunCom.gameId,
						),
						result.settingsRevision,
					)
				: session,
		);
		setCategorySession((session) =>
			session
				? reconcileCategory(
						session,
						findCategory(result.categories, session.draft),
						result.settingsRevision,
					)
				: session,
		);
		return result;
	}, []);

	useEffect(() => {
		void refreshLists().catch((cause) => setListsError(errorMessage(cause)));
	}, [refreshLists]);

	const activeGameId = categorySession?.draft.speedrunCom.gameId ?? "";
	useEffect(() => {
		if (requestedOptions.current === activeGameId) return;
		requestedOptions.current = activeGameId;
		void loadOptions(activeGameId);
	}, [activeGameId, loadOptions]);

	const activeCategoryId = categorySession?.draft.speedrunCom.categoryId ?? "";
	useEffect(() => {
		if (requestedVariables.current === activeCategoryId) return;
		requestedVariables.current = activeCategoryId;
		void loadVariables(activeCategoryId);
	}, [activeCategoryId, loadVariables]);

	const guard = (action: () => void) => {
		if (gameDirty || categoryDirty) setPendingAction(() => action);
		else action();
	};

	const makeGameSession = (
		record: GameMappingRecord | null,
		slugOverride?: string,
	): GameSession => {
		const slug =
			record?.mapping.racetime.categorySlug ??
			slugOverride ??
			target?.categorySlug ??
			selectedSlug ??
			"";
		const name =
			record?.mapping.racetime.categoryName ??
			(slug === target?.categorySlug
				? (target?.categoryName ?? "")
				: (games.find(
						(candidate) => candidate.mapping.racetime.categorySlug === slug,
					)?.mapping.racetime.categoryName ?? ""));
		const empty =
			slug === "" && mode === "race" && target
				? gameForTarget(target)
				: {
						racetime: {categorySlug: slug, categoryName: name},
						speedrunCom: {gameId: "", gameName: ""},
					};
		return {
			status: "normal",
			baseline: record?.mapping ?? null,
			baselineRevision: record?.revision ?? null,
			emptyDraft: structuredClone(empty),
			draft: record ? structuredClone(record.mapping) : structuredClone(empty),
			settingsRevision: listSettingsRevision ?? 0,
			conflict: null,
			comparison: null,
		};
	};

	const makeCategorySession = (
		record: CategoryMappingRecord | null,
	): CategorySession => {
		const slug =
			record?.mapping.racetime.categorySlug ??
			target?.categorySlug ??
			selectedSlug ??
			"";
		const empty =
			mode === "race" && target
				? categoryForTarget(target)
				: blankCategory(slug);
		return {
			status: "normal",
			baseline: record?.mapping ?? null,
			baselineRevision: record?.revision ?? null,
			emptyDraft: structuredClone(empty),
			draft: record ? structuredClone(record.mapping) : structuredClone(empty),
			settingsRevision:
				listSettingsRevision ?? gameSession?.settingsRevision ?? 0,
			conflict: null,
			comparison: null,
		};
	};

	const closeGameEdit = () => {
		searchGen.current++;
		setGameMode(null);
		setGameSession(null);
		setSrcResults([]);
		setSrcQuery("");
	};

	const requestCloseGameEdit = () => {
		if (gameDirty) setPendingAction(() => closeGameEdit);
		else closeGameEdit();
	};

	const beginGameEdit = (
		nextMode: "add" | "rename",
		record: GameMappingRecord | null,
	) => {
		const action = () => {
			searchGen.current++;
			setSrcResults([]);
			setSrcQuery("");
			setMessage(null);
			setError(null);
			setConfirmDelete(null);
			setGameMode(nextMode);
			setGameSession(
				makeGameSession(
					record,
					nextMode === "add" ? (selectedSlug ?? "") : undefined,
				),
			);
		};
		if (gameDirty) setPendingAction(() => action);
		else action();
	};

	const startNewRace = () => {
		guard(() => {
			searchGen.current++;
			setSelectedSlug(null);
			setCategorySession(null);
			setSrcResults([]);
			setSrcQuery("");
			setConfirmDelete(null);
			setMessage(null);
			setError(null);
			setGameMode("add");
			setGameSession(makeGameSession(null, ""));
		});
	};

	const selectRaceGame = (record: GameMappingRecord) => {
		const slug = record.mapping.racetime.categorySlug;
		if (slug === selectedSlug) return;
		guard(() => {
			setSelectedSlug(slug);
			setCategorySession(null);
			closeGameEdit();
			setConfirmDelete(null);
			setMessage(null);
			setError(null);
		});
	};

	const activeSlug =
		mode === "race" ? (target?.categorySlug ?? "") : (selectedSlug ?? "");
	const gameCategories = categories.filter(
		(record) => record.mapping.racetime.categorySlug === activeSlug,
	);
	const registeredGames = games.filter(
		(record) => record.mapping.racetime.categorySlug === activeSlug,
	);
	const raceCategoryName =
		registeredGames[0]?.mapping.racetime.categoryName ??
		games.find((record) => record.mapping.racetime.categorySlug === activeSlug)
			?.mapping.racetime.categoryName ??
		"";
	const hasRegisteredGames = registeredGames.length > 0;

	const startCategorySession = (record: CategoryMappingRecord | null) => {
		setMessage(null);
		setError(null);
		setCategorySession(makeCategorySession(record));
	};

	const selectCategory = (record: CategoryMappingRecord | null) => {
		guard(() => startCategorySession(record));
	};

	const expandEditor = () => {
		if (!target) return;
		setError(null);
		setMessage(null);
		setCategorySession(
			(session) =>
				session ??
				makeCategorySession(
					findCategoryByKey(categories, target.categorySlug, target.goal),
				),
		);
		setExpanded(true);
	};

	const closeEditor = () => {
		setExpanded(false);
		setConfirmClose(false);
		closeGameEdit();
		setCategorySession(null);
		setError(null);
		setMessage(null);
		setConfirmDelete(null);
	};

	// Closes only the editing view so the save notification and
	// any reload error stay visible.
	const closeEditorAfterSave = () => {
		setExpanded(false);
		setConfirmClose(false);
		closeGameEdit();
		setCategorySession(null);
		setConfirmDelete(null);
	};

	const requestClose = () => {
		if (gameDirty || categoryDirty) {
			setConfirmClose(true);
			return;
		}
		closeEditor();
	};

	const handleSaveFailure = async (cause: unknown) => {
		if (isConflict(cause)) {
			await refreshLists();
			setError(
				"他の変更と競合しました。最新状態を採用するか、最新状態から再編集してください。",
			);
			return;
		}
		if (isSettingsChanged(cause)) {
			await refreshLists();
			setError(
				"Spreadsheet設定が変更されました。新しい保存先を読み込みました。内容を確認して再編集してください。",
			);
			return;
		}
		if (isGameMappingConflict(cause)) {
			await refreshLists();
			setError(
				"子Category Mappingが存在するため、この操作はできません。先に子Category Mappingを整理してください。",
			);
			return;
		}
		setError(errorMessage(cause));
	};

	const adoptGameLatest = () => {
		setGameSession((session) => {
			if (session?.status !== "conflict") return session;
			const latest = session.conflict;
			return {
				status: "normal",
				baseline: latest ? structuredClone(latest.mapping) : null,
				baselineRevision: latest?.revision ?? null,
				emptyDraft: session.emptyDraft,
				draft: latest
					? structuredClone(latest.mapping)
					: structuredClone(session.emptyDraft),
				settingsRevision: session.settingsRevision,
				conflict: null,
				comparison: null,
			};
		});
		setError(null);
	};

	const reEditGameLatest = () => {
		setGameSession((session) => {
			if (session?.status !== "conflict") return session;
			const latest = session.conflict;
			return {
				status: "normal",
				baseline: latest ? structuredClone(latest.mapping) : null,
				baselineRevision: latest?.revision ?? null,
				emptyDraft: session.emptyDraft,
				draft: latest
					? structuredClone(latest.mapping)
					: structuredClone(session.emptyDraft),
				settingsRevision: session.settingsRevision,
				conflict: null,
				comparison: structuredClone(session.draft),
			};
		});
		setError(null);
	};

	const adoptCategoryLatest = () => {
		setCategorySession((session) => {
			if (session?.status !== "conflict") return session;
			const latest = session.conflict;
			return {
				status: "normal",
				baseline: latest ? structuredClone(latest.mapping) : null,
				baselineRevision: latest?.revision ?? null,
				emptyDraft: session.emptyDraft,
				draft: latest
					? structuredClone(latest.mapping)
					: structuredClone(session.emptyDraft),
				settingsRevision: session.settingsRevision,
				conflict: null,
				comparison: null,
			};
		});
		setError(null);
	};

	const reEditCategoryLatest = () => {
		setCategorySession((session) => {
			if (session?.status !== "conflict") return session;
			const latest = session.conflict;
			return {
				status: "normal",
				baseline: latest ? structuredClone(latest.mapping) : null,
				baselineRevision: latest?.revision ?? null,
				emptyDraft: session.emptyDraft,
				draft: latest
					? structuredClone(latest.mapping)
					: structuredClone(session.emptyDraft),
				settingsRevision: session.settingsRevision,
				conflict: null,
				comparison: structuredClone(session.draft),
			};
		});
		setError(null);
	};

	const saveGame = async () => {
		if (mutating || !gameSession || gameSession.status !== "normal") return;
		const draft = gameSession.draft;
		if (
			!draft.racetime.categorySlug.trim() ||
			!draft.racetime.categoryName.trim() ||
			!draft.speedrunCom.gameId
		) {
			setError("RaceTime category slug、表示名、SRCゲームを入力してください。");
			return;
		}
		const adding = gameMode === "add";
		setMutating(true);
		setBusy(true);
		setError(null);
		setMessage(null);
		let saved = false;
		try {
			const result = await request("saveGameMapping", {
				mapping: draft,
				expectedRevision: gameSession.baselineRevision,
				settingsRevision: gameSession.settingsRevision,
			});
			const savedGameId = result.record.mapping.speedrunCom.gameId;
			setGames((current) => {
				const key = result.record.mapping.racetime.categorySlug.trim();
				return [
					...current.filter(
						(record) =>
							record.mapping.racetime.categorySlug.trim() !== key ||
							record.mapping.speedrunCom.gameId !== savedGameId,
					),
					result.record,
				];
			});
			setListSettingsRevision(result.settingsRevision);
			if (adding) {
				if (mode === "manage" && selectedSlug === null)
					setSelectedSlug(result.record.mapping.racetime.categorySlug);
				if (categorySession)
					setCategorySession((session) => {
						if (!session) return session;
						const next = withGoalGame(session, savedGameId);
						if (session.baseline !== null) return next;
						return {
							...next,
							emptyDraft: {
								...next.emptyDraft,
								speedrunCom: {
									...next.emptyDraft.speedrunCom,
									gameId: savedGameId,
								},
							},
						};
					});
				setMessage("SRCゲームを追加しました。");
				closeGameEdit();
			} else {
				setGameSession({
					status: "normal",
					baseline: structuredClone(result.record.mapping),
					baselineRevision: result.record.revision,
					emptyDraft: gameSession.emptyDraft,
					draft: structuredClone(result.record.mapping),
					settingsRevision: gameSession.settingsRevision,
					conflict: null,
					comparison: null,
				});
				setMessage("SRCゲームの表示名を保存しました。");
			}
			onMappingChange?.();
			saved = true;
		} catch (cause) {
			await handleSaveFailure(cause);
		} finally {
			setBusy(false);
			setMutating(false);
		}
		if (!saved) return;
		try {
			await refreshLists();
		} catch (cause) {
			setListsError(errorMessage(cause));
		}
	};

	const removeGame = async () => {
		if (mutating || !gameSession || gameSession.baselineRevision === null)
			return;
		setMutating(true);
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await request("deleteGameMapping", {
				categorySlug: gameSession.draft.racetime.categorySlug,
				gameId: gameSession.draft.speedrunCom.gameId,
				expectedRevision: gameSession.baselineRevision,
				settingsRevision: gameSession.settingsRevision,
			});
			setConfirmDelete(null);
			const removedGameId = gameSession.draft.speedrunCom.gameId;
			const remaining = games.filter(
				(record) =>
					record.mapping.racetime.categorySlug !==
						gameSession.draft.racetime.categorySlug ||
					record.mapping.speedrunCom.gameId !== removedGameId,
			);
			setGames(remaining);
			closeGameEdit();
			setCategorySession((session) =>
				session && session.draft.speedrunCom.gameId === removedGameId
					? withGoalGame(session, "")
					: session,
			);
			onMappingChange?.();
			await refreshLists();
			setMessage("SRCゲームの登録を解除しました。");
		} catch (cause) {
			setConfirmDelete(null);
			await handleSaveFailure(cause);
		} finally {
			setBusy(false);
			setMutating(false);
		}
	};

	const saveCategory = async () => {
		if (mutating || !categorySession || categorySession.status !== "normal")
			return;
		const closeOnSuccess = !gameDirty;
		setMutating(true);
		setBusy(true);
		setError(null);
		setMessage(null);
		let saved = false;
		try {
			const result = await request("saveCategoryMapping", {
				mapping: categorySession.draft,
				expectedRevision: categorySession.baselineRevision,
				settingsRevision: categorySession.settingsRevision,
			});
			setCategorySession({
				status: "normal",
				baseline: structuredClone(result.record.mapping),
				baselineRevision: result.record.revision,
				emptyDraft: categorySession.emptyDraft,
				draft: structuredClone(result.record.mapping),
				settingsRevision: categorySession.settingsRevision,
				conflict: null,
				comparison: null,
			});
			setCategories((current) => [
				...current.filter(
					(record) =>
						record.mapping.racetime.categorySlug.trim() !==
							result.record.mapping.racetime.categorySlug.trim() ||
						record.mapping.racetime.goal.trim() !==
							result.record.mapping.racetime.goal.trim(),
				),
				result.record,
			]);
			setListSettingsRevision(result.settingsRevision);
			setMessage("Category Mappingを保存しました。");
			onMappingChange?.();
			if (closeOnSuccess && mode === "race") closeEditorAfterSave();
			saved = true;
		} catch (cause) {
			await handleSaveFailure(cause);
		} finally {
			setBusy(false);
			setMutating(false);
		}
		if (!saved) return;
		try {
			await refreshLists();
		} catch (cause) {
			setListsError(errorMessage(cause));
		}
	};

	const removeCategory = async () => {
		if (
			mutating ||
			!categorySession ||
			categorySession.baselineRevision === null
		)
			return;
		setMutating(true);
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await request("deleteCategoryMapping", {
				categorySlug: categorySession.draft.racetime.categorySlug,
				goal: categorySession.draft.racetime.goal,
				expectedRevision: categorySession.baselineRevision,
				settingsRevision: categorySession.settingsRevision,
			});
			setConfirmDelete(null);
			if (mode === "race") startCategorySession(null);
			else setCategorySession(null);
			setMessage("Category Mappingを削除しました。");
			onMappingChange?.();
			await refreshLists();
		} catch (cause) {
			setConfirmDelete(null);
			await handleSaveFailure(cause);
		} finally {
			setBusy(false);
			setMutating(false);
		}
	};

	const reloadLatest = async () => {
		if (mutating) return;
		setMutating(true);
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await refreshLists();
			setMessage("保存先の最新状態を読み込みました。");
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
			setMutating(false);
		}
	};

	const searchGames = async () => {
		const query = srcQuery.trim();
		const gen = ++searchGen.current;
		setBusy(true);
		setError(null);
		try {
			const result = await request("searchSpeedrunGames", {query});
			if (gen !== searchGen.current) return;
			setSrcResults(result.games);
		} catch (cause) {
			if (gen !== searchGen.current) return;
			setError(errorMessage(cause));
		} finally {
			if (gen === searchGen.current) setBusy(false);
		}
	};

	const chooseSrcGame = (game: SpeedrunGameSummary) => {
		searchGen.current++;
		setGameSession((session) =>
			session
				? {
						...session,
						draft: {
							...session.draft,
							speedrunCom: {gameId: game.id, gameName: game.name},
						},
					}
				: session,
		);
		setSrcResults([]);
		setSrcQuery("");
	};

	const chooseGoalGame = (gameId: string) => {
		if (categorySession?.draft.speedrunCom.gameId === gameId) return;
		optionsGen.current++;
		variablesGen.current++;
		setOptions(null);
		setOptionsFor(null);
		setVariables([]);
		setVariablesFor(null);
		requestedOptions.current = null;
		requestedVariables.current = null;
		setCategorySession((session) =>
			session ? withGoalGame(session, gameId) : session,
		);
	};

	const chooseCategory = (option: SpeedrunCategoryOption) => {
		setCategorySession((session) =>
			session
				? {
						...session,
						draft: {
							...session.draft,
							speedrunCom: {
								...session.draft.speedrunCom,
								categoryId: option.id,
								categoryName: option.name,
								levelId: null,
								variables: {},
							},
						},
					}
				: session,
		);
	};

	const setCategoryField = <K extends keyof CategoryMapping["speedrunCom"]>(
		key: K,
		value: CategoryMapping["speedrunCom"][K],
	) => {
		setCategorySession((session) =>
			session
				? {
						...session,
						draft: {
							...session.draft,
							speedrunCom: {...session.draft.speedrunCom, [key]: value},
						},
					}
				: session,
		);
	};

	const removeVariable = (id: string) => {
		setCategorySession((session) => {
			if (!session) return session;
			const variables = {...session.draft.speedrunCom.variables};
			delete variables[id];
			return {
				...session,
				draft: {
					...session.draft,
					speedrunCom: {...session.draft.speedrunCom, variables},
				},
			};
		});
	};

	const matchingGames = games.filter((record) =>
		stringify(record.mapping).toLowerCase().includes(gameQuery.toLowerCase()),
	);
	const filteredGames = matchingGames.filter(
		(record, index) =>
			matchingGames.findIndex(
				(candidate) =>
					candidate.mapping.racetime.categorySlug ===
					record.mapping.racetime.categorySlug,
			) === index,
	);
	const gameBlocked = gameSession !== null && gameSession.status !== "normal";
	const categoryBlocked =
		categorySession !== null && categorySession.status !== "normal";
	const categoryId = categorySession?.draft.speedrunCom.categoryId ?? "";
	const variablesReady =
		categoryId !== "" && !variablesLoading && variablesFor === categoryId;
	const missingPbVariable = categorySession
		? variables.some((variable) => {
				const value = categorySession.draft.speedrunCom.variables[variable.id];
				return (
					variable.obsoletes &&
					(value === undefined || (typeof value === "string" && !value.trim()))
				);
			})
		: false;
	const optionsReady =
		!activeGameId || (optionsFor !== null && optionsFor === activeGameId);
	const hasSessionNotice =
		gameSession?.status === "conflict" ||
		gameSession?.status === "invalid" ||
		categorySession?.status === "conflict" ||
		categorySession?.status === "invalid";
	const raceCategoryRecord = target
		? findCategoryByKey(categories, target.categorySlug, target.goal)
		: null;
	const categoryGameId = categorySession?.draft.speedrunCom.gameId ?? "";
	const hasCategoryGame =
		categoryGameId !== "" &&
		registeredGames.some(
			(record) => record.mapping.speedrunCom.gameId === categoryGameId,
		);
	const shownError = mode === "manage" ? (error ?? listsError) : error;

	return (
		<div className={mode === "race" ? "mappings" : "mappings layout-two"}>
			{mode === "manage" && (
				<aside className='panel'>
					<div className='toolbar'>
						<h2>RaceTimeゲーム</h2>
						<button
							type='button'
							disabled={busy || mutating}
							onClick={startNewRace}
						>
							＋ 新規
						</button>
					</div>
					<input
						aria-label='ゲームを検索'
						placeholder='RaceTime / SRC で検索'
						value={gameQuery}
						onChange={(event) => setGameQuery(event.target.value)}
					/>
					<ul className='list'>
						{filteredGames.map((record) => {
							const slug = record.mapping.racetime.categorySlug;
							const names = games
								.filter(
									(candidate) =>
										candidate.mapping.racetime.categorySlug === slug,
								)
								.map((candidate) => candidate.mapping.speedrunCom.gameName);
							return (
								<li key={slug}>
									<button
										type='button'
										disabled={busy || mutating}
										className={selectedSlug === slug ? "active" : ""}
										onClick={() => selectRaceGame(record)}
									>
										<strong>
											{record.mapping.racetime.categoryName || slug}
										</strong>
										<small>{names.join(" / ")}</small>
									</button>
								</li>
							);
						})}
					</ul>
					<button
						type='button'
						disabled={busy || mutating}
						onClick={() => void reloadLatest()}
					>
						再読み込み
					</button>
				</aside>
			)}

			<section className='panel'>
				{mode === "race" && target && (
					<RaceMappingSummary
						target={target}
						games={games.filter(
							(record) =>
								record.mapping.racetime.categorySlug === target.categorySlug,
						)}
						category={raceCategoryRecord}
						ready={listsReady}
						error={listsError}
						busy={busy || mutating}
						expanded={expanded}
						onToggle={() => (expanded ? requestClose() : expandEditor())}
						onReload={() => void reloadLatest()}
					/>
				)}
				{shownError && !hasSessionNotice && (
					<Callout tone='error'>{shownError}</Callout>
				)}
				{message && <Callout tone='success'>{message}</Callout>}

				{mode === "manage" && selectedSlug === null && gameMode !== "add" && (
					<p className='muted'>
						RaceTimeゲームを選択するか、＋新規で作成してください。
					</p>
				)}

				{mode === "race" && !expanded ? null : (
					<>
						{mode === "manage" && selectedSlug !== null && (
							<div className='mapping-target'>
								<span className='muted'>RaceTime</span>
								<strong>
									{raceCategoryName || selectedSlug} ({selectedSlug})
								</strong>
							</div>
						)}

						{(mode === "race" || selectedSlug !== null) && (
							<div className='subpanel'>
								<h3>登録済みSRCゲーム</h3>
								{registeredGames.length === 0 ? (
									<p className='muted'>未登録</p>
								) : (
									<ul className='src-game-list'>
										{registeredGames.map((record) => {
											const gameId = record.mapping.speedrunCom.gameId;
											const gameName = record.mapping.speedrunCom.gameName;
											const checked =
												categorySession?.draft.speedrunCom.gameId === gameId;
											const editingThisGame =
												gameMode === "rename" &&
												gameSession?.draft.speedrunCom.gameId === gameId;
											return (
												<li
													key={gameId}
													className='src-game-row'
												>
													<div className='src-game-main'>
														<label className='src-game-choice'>
															<input
																type='radio'
																name={`goal-src-game-${activeSlug}`}
																aria-label={gameName}
																checked={checked}
																disabled={
																	busy || mutating || categorySession === null
																}
																onChange={() => chooseGoalGame(gameId)}
															/>
															<span>{gameName}</span>
														</label>
														<button
															type='button'
															className='game-menu-button'
															aria-label={`${gameName} の管理`}
															disabled={busy || mutating}
															onClick={() => {
																if (editingThisGame) requestCloseGameEdit();
																else beginGameEdit("rename", record);
															}}
														>
															⋯
														</button>
													</div>
													{editingThisGame && gameSession && (
														<div className='game-manage'>
															{gameSession.status === "conflict" && (
																<SessionConflict
																	label='Game Mapping'
																	deleted={gameSession.conflict === null}
																	before={
																		gameSession.conflict?.mapping ??
																		gameSession.emptyDraft
																	}
																	after={gameSession.draft}
																	busy={busy}
																	onAdopt={adoptGameLatest}
																	onReEdit={reEditGameLatest}
																/>
															)}
															{gameSession.status === "invalid" && (
																<Callout tone='warning'>
																	このSRCゲームは保存先から削除されたか、Spreadsheet設定が変更されました。保存できません。再読み込みして選び直してください。
																</Callout>
															)}
															{gameSession.comparison && (
																<div className='subpanel'>
																	<h3>
																		前回の編集内容（比較用・自動適用しません）
																	</h3>
																	<DiffTable
																		before={
																			gameSession.baseline ??
																			gameSession.emptyDraft
																		}
																		after={gameSession.comparison}
																	/>
																	<div className='button-row'>
																		<button
																			type='button'
																			onClick={() =>
																				setGameSession((session) =>
																					session
																						? {
																								...session,
																								comparison: null,
																							}
																						: session,
																				)
																			}
																		>
																			比較を閉じる
																		</button>
																	</div>
																</div>
															)}
															<Field label='SRCゲーム名（表示用）'>
																<input
																	aria-label={`${gameName} の表示名`}
																	value={gameSession.draft.speedrunCom.gameName}
																	disabled={mutating}
																	onChange={(event) =>
																		setGameSession((session) =>
																			session
																				? {
																						...session,
																						draft: {
																							...session.draft,
																							speedrunCom: {
																								...session.draft.speedrunCom,
																								gameName: event.target.value,
																							},
																						},
																					}
																				: session,
																		)
																	}
																/>
															</Field>
															<div className='button-row'>
																<button
																	type='button'
																	disabled={busy || mutating || gameBlocked}
																	onClick={() => void saveGame()}
																>
																	{busy ? "保存中…" : "保存"}
																</button>
																<button
																	type='button'
																	disabled={busy || mutating || !gameDirty}
																	onClick={() =>
																		setGameSession((session) =>
																			session
																				? {
																						...session,
																						draft: structuredClone(
																							session.baseline ??
																								session.emptyDraft,
																						),
																					}
																				: session,
																		)
																	}
																>
																	元に戻す
																</button>
																<div className='danger-zone'>
																	{confirmDelete === "game" ? (
																		<>
																			<span>
																				このSRCゲームの登録を解除しますか？
																			</span>
																			<button
																				type='button'
																				disabled={busy || mutating}
																				onClick={() => void removeGame()}
																			>
																				登録解除を確定
																			</button>
																			<button
																				type='button'
																				onClick={() => setConfirmDelete(null)}
																			>
																				キャンセル
																			</button>
																		</>
																	) : (
																		<button
																			type='button'
																			disabled={busy || mutating}
																			onClick={() => setConfirmDelete("game")}
																		>
																			登録解除
																		</button>
																	)}
																</div>
															</div>
														</div>
													)}
												</li>
											);
										})}
									</ul>
								)}
								{gameMode === "rename" &&
									gameSession &&
									!registeredGames.some(
										(record) =>
											record.mapping.speedrunCom.gameId ===
											gameSession.draft.speedrunCom.gameId,
									) && (
										<div className='game-manage'>
											{gameSession.status === "conflict" && (
												<SessionConflict
													label='Game Mapping'
													deleted={gameSession.conflict === null}
													before={
														gameSession.conflict?.mapping ??
														gameSession.emptyDraft
													}
													after={gameSession.draft}
													busy={busy}
													onAdopt={adoptGameLatest}
													onReEdit={reEditGameLatest}
												/>
											)}
											{gameSession.status === "invalid" && (
												<Callout tone='warning'>
													このSRCゲームは保存先から削除されたか、Spreadsheet設定が変更されました。保存できません。再読み込みして選び直してください。
												</Callout>
											)}
											<div className='button-row'>
												<button
													type='button'
													disabled={busy || mutating}
													onClick={requestCloseGameEdit}
												>
													閉じる
												</button>
											</div>
										</div>
									)}
								{mode === "manage" && categorySession === null && (
									<p className='muted'>Goalを選択するとSRCゲームを選べます。</p>
								)}
								<button
									type='button'
									disabled={busy || mutating || gameMode === "add"}
									onClick={() => beginGameEdit("add", null)}
								>
									SRCゲームを追加
								</button>
							</div>
						)}

						{gameMode === "add" && gameSession && (
							<form
								className='subpanel game-registration'
								onSubmit={(event) => {
									event.preventDefault();
									void saveGame();
								}}
							>
								<h3>SRCゲームを追加</h3>
								{gameSession.status === "conflict" && (
									<SessionConflict
										label='Game Mapping'
										deleted={gameSession.conflict === null}
										before={
											gameSession.conflict?.mapping ?? gameSession.emptyDraft
										}
										after={gameSession.draft}
										busy={busy}
										onAdopt={adoptGameLatest}
										onReEdit={reEditGameLatest}
									/>
								)}
								{gameSession.status === "invalid" && (
									<Callout tone='warning'>
										このGame
										Mappingは保存先から削除されたか、Spreadsheet設定が変更されました。保存できません。再読み込みして選び直してください。
									</Callout>
								)}
								{gameSession.comparison && (
									<div className='subpanel'>
										<h3>前回の編集内容（比較用・自動適用しません）</h3>
										<DiffTable
											before={gameSession.baseline ?? gameSession.emptyDraft}
											after={gameSession.comparison}
										/>
										<div className='button-row'>
											<button
												type='button'
												onClick={() =>
													setGameSession((session) =>
														session
															? {
																	...session,
																	comparison: null,
																}
															: session,
													)
												}
											>
												比較を閉じる
											</button>
										</div>
									</div>
								)}
								{selectedSlug === null ? (
									<div className='grid'>
										<Field label='RaceTime category slug'>
											<input
												value={gameSession.draft.racetime.categorySlug}
												disabled={mutating}
												onChange={(event) =>
													setGameSession((session) =>
														session
															? {
																	...session,
																	draft: {
																		...session.draft,
																		racetime: {
																			...session.draft.racetime,
																			categorySlug: event.target.value,
																		},
																	},
																}
															: session,
													)
												}
											/>
										</Field>
										<Field label='RaceTime category name'>
											<input
												value={gameSession.draft.racetime.categoryName}
												disabled={mutating}
												onChange={(event) =>
													setGameSession((session) =>
														session
															? {
																	...session,
																	draft: {
																		...session.draft,
																		racetime: {
																			...session.draft.racetime,
																			categoryName: event.target.value,
																		},
																	},
																}
															: session,
													)
												}
											/>
										</Field>
									</div>
								) : (
									<div className='mapping-target'>
										<span className='muted'>RaceTime</span>
										<strong>
											{raceCategoryName || selectedSlug} ({selectedSlug})
										</strong>
									</div>
								)}
								<div className='formrow'>
									<input
										aria-label='SRCゲーム検索'
										placeholder='ゲーム名で検索'
										disabled={mutating}
										value={srcQuery}
										onChange={(event) => setSrcQuery(event.target.value)}
									/>
									<button
										type='button'
										disabled={busy || mutating || srcQuery.trim() === ""}
										onClick={() => void searchGames()}
									>
										検索
									</button>
								</div>
								{srcResults.map((game) => (
									<button
										key={game.id}
										type='button'
										className='choice'
										disabled={
											mutating ||
											registeredGames.some(
												(record) =>
													record.mapping.speedrunCom.gameId === game.id,
											)
										}
										onClick={() => chooseSrcGame(game)}
									>
										{game.name} ({game.abbreviation})
									</button>
								))}
								<p className='muted'>
									選択中: {gameSession.draft.speedrunCom.gameName || "未選択"}
									{gameSession.draft.speedrunCom.gameId
										? ` (${gameSession.draft.speedrunCom.gameId})`
										: ""}
								</p>
								<div className='button-row'>
									<button
										type='submit'
										disabled={
											busy ||
											mutating ||
											gameBlocked ||
											!gameSession.draft.racetime.categorySlug.trim() ||
											!gameSession.draft.racetime.categoryName.trim() ||
											!gameSession.draft.speedrunCom.gameId
										}
									>
										{busy ? "保存中…" : "保存"}
									</button>
									<button
										type='button'
										disabled={busy || mutating}
										onClick={requestCloseGameEdit}
									>
										キャンセル
									</button>
								</div>
							</form>
						)}

						{mode === "manage" && selectedSlug !== null && (
							<div className='subpanel'>
								<div className='toolbar'>
									<h3>Goals</h3>
									<button
										type='button'
										disabled={busy || !hasRegisteredGames}
										onClick={() => selectCategory(null)}
									>
										＋ 新規 Goal
									</button>
								</div>
								{gameCategories.length === 0 ? (
									<p className='muted'>Goalはまだ登録されていません。</p>
								) : (
									<ul className='list'>
										{gameCategories.map((record) => (
											<li key={record.mapping.racetime.goal}>
												<button
													type='button'
													disabled={busy}
													className={
														categorySession?.draft.racetime.goal ===
															record.mapping.racetime.goal &&
														categorySession?.draft.racetime.categorySlug ===
															record.mapping.racetime.categorySlug
															? "active"
															: ""
													}
													onClick={() => selectCategory(record)}
												>
													<strong>{record.mapping.racetime.goal}</strong>
													<small>
														{findGame(
															games,
															record.mapping.racetime.categorySlug,
															record.mapping.speedrunCom.gameId,
														)?.mapping.speedrunCom.gameName ??
															record.mapping.speedrunCom.gameId}{" "}
														/ {record.mapping.speedrunCom.categoryName}
													</small>
												</button>
											</li>
										))}
									</ul>
								)}
							</div>
						)}

						{categorySession ? (
							<>
								{categorySession.status === "conflict" && (
									<SessionConflict
										label='Category Mapping'
										deleted={categorySession.conflict === null}
										before={
											categorySession.conflict?.mapping ??
											categorySession.emptyDraft
										}
										after={categorySession.draft}
										busy={busy}
										onAdopt={adoptCategoryLatest}
										onReEdit={reEditCategoryLatest}
									/>
								)}
								{categorySession.status === "invalid" && (
									<Callout tone='warning'>
										このCategory
										Mappingは保存先から削除されたか、Spreadsheet設定が変更されました。保存できません。再読み込みして選び直してください。
									</Callout>
								)}
								{categorySession.comparison && (
									<div className='subpanel'>
										<h3>前回の編集内容（比較用・自動適用しません）</h3>
										<DiffTable
											before={
												categorySession.baseline ?? categorySession.emptyDraft
											}
											after={categorySession.comparison}
										/>
										<div className='button-row'>
											<button
												type='button'
												onClick={() =>
													setCategorySession((session) =>
														session
															? {
																	...session,
																	comparison: null,
																}
															: session,
													)
												}
											>
												比較を閉じる
											</button>
										</div>
									</div>
								)}
								<CategoryEditor
									draft={categorySession.draft}
									hasGame={hasCategoryGame}
									isNewGoal={categorySession.baseline === null}
									options={options}
									variables={variables}
									busy={busy}
									disabled={mutating}
									dirty={categoryDirty}
									expected={categorySession.baselineRevision}
									confirmDelete={confirmDelete === "category"}
									missingPbVariable={missingPbVariable}
									variablesReady={variablesReady}
									optionsReady={optionsReady}
									blocked={categoryBlocked}
									goalLocked={mode === "race"}
									onField={setCategoryField}
									onChooseCategory={chooseCategory}
									onRemoveVariable={removeVariable}
									onGoal={(goal) =>
										setCategorySession((session) =>
											session
												? {
														...session,
														draft: {
															...session.draft,
															racetime: {
																...session.draft.racetime,
																goal,
															},
														},
													}
												: session,
										)
									}
									onSave={() => void saveCategory()}
									onRevert={() =>
										setCategorySession((session) =>
											session
												? {
														...session,
														draft: structuredClone(
															session.baseline ?? session.emptyDraft,
														),
													}
												: session,
										)
									}
									onDeleteRequest={() => setConfirmDelete("category")}
									onDeleteConfirm={() => void removeCategory()}
									onDeleteCancel={() => setConfirmDelete(null)}
								/>
							</>
						) : (
							mode === "manage" &&
							selectedSlug !== null && (
								<p className='muted'>Goalを選択するか新規作成してください。</p>
							)
						)}
					</>
				)}
			</section>

			{pendingAction && (
				<div className='dialog-backdrop'>
					<div className='dialog'>
						<p>未保存の変更があります。破棄して移動しますか？</p>
						<div className='button-row'>
							<button
								type='button'
								onClick={() => {
									const action = pendingAction;
									setPendingAction(null);
									action();
								}}
							>
								破棄して移動
							</button>
							<button
								type='button'
								onClick={() => setPendingAction(null)}
							>
								キャンセル
							</button>
						</div>
					</div>
				</div>
			)}

			{confirmClose && (
				<div className='dialog-backdrop'>
					<div className='dialog'>
						<p>未保存の変更があります。破棄して閉じますか？</p>
						<div className='button-row'>
							<button
								type='button'
								onClick={closeEditor}
							>
								破棄して閉じる
							</button>
							<button
								type='button'
								onClick={() => setConfirmClose(false)}
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

function RaceMappingSummary({
	target,
	games,
	category,
	ready,
	error,
	busy,
	expanded,
	onToggle,
	onReload,
}: {
	target: RaceMappingTarget;
	games: GameMappingRecord[];
	category: CategoryMappingRecord | null;
	ready: boolean;
	error: string | null;
	busy: boolean;
	expanded: boolean;
	onToggle: () => void;
	onReload: () => void;
}) {
	const pending = !ready || error !== null;
	const referencedGameId = category?.mapping.speedrunCom.gameId;
	const primaryGame = referencedGameId
		? (games.find(
				(record) => record.mapping.speedrunCom.gameId === referencedGameId,
			) ?? null)
		: (games[0] ?? null);
	const otherGames = games.filter(
		(record) =>
			record.mapping.speedrunCom.gameId !==
			primaryGame?.mapping.speedrunCom.gameId,
	);
	const inconsistent =
		ready && error === null && category !== null && primaryGame === null;
	const gameLabel = pending
		? "—"
		: (primaryGame?.mapping.speedrunCom.gameName ?? "未登録");
	const categoryLabel = pending
		? "—"
		: (category?.mapping.speedrunCom.categoryName ?? "未登録");
	return (
		<div className='subpanel race-mapping-summary'>
			<div className='toolbar'>
				<h3>Speedrun.com マッピング</h3>
				<div className='button-row'>
					<button
						type='button'
						disabled={busy || !ready || error !== null}
						onClick={onToggle}
					>
						{expanded ? "編集を閉じる" : "編集"}
					</button>
					<button
						type='button'
						disabled={busy}
						onClick={onReload}
					>
						再読み込み
					</button>
				</div>
			</div>
			<table className='mapping-summary'>
				<thead>
					<tr>
						<th>RaceTime</th>
						<th>Speedrun.com</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							{target.categoryName} ({target.categorySlug})
						</td>
						<td>{gameLabel}</td>
					</tr>
					<tr>
						<td>{target.goal}</td>
						<td>{categoryLabel}</td>
					</tr>
				</tbody>
			</table>
			{otherGames.length > 0 && (
				<p className='muted'>
					その他のSRCゲーム:{" "}
					{otherGames
						.map((record) => record.mapping.speedrunCom.gameName)
						.join(" / ")}
				</p>
			)}
			{!ready && error === null && (
				<p className='muted'>マッピング情報を取得中です…</p>
			)}
			{error && (
				<Callout tone='error'>
					マッピング情報を取得できませんでした: {error}
				</Callout>
			)}
			{inconsistent && (
				<Callout tone='warning'>
					Category
					Mappingが参照するSRCゲームが未登録です。SRCゲームを追加してください。
				</Callout>
			)}
		</div>
	);
}
function SessionConflict({
	label,
	deleted,
	before,
	after,
	busy,
	onAdopt,
	onReEdit,
}: {
	label: string;
	deleted: boolean;
	before: unknown;
	after: unknown;
	busy: boolean;
	onAdopt: () => void;
	onReEdit: () => void;
}) {
	return (
		<div className='callout warning'>
			<p>
				{deleted
					? `${label}は保存先から削除されています。最新状態を採用するか、最新状態から再編集してください。`
					: "他の変更と競合しました。最新状態を採用するか、最新状態から再編集してください。"}
			</p>
			<div className='button-row'>
				<button
					type='button'
					disabled={busy}
					onClick={onAdopt}
				>
					最新状態を採用
				</button>
				<button
					type='button'
					disabled={busy || deleted}
					onClick={onReEdit}
				>
					最新状態から再編集
				</button>
			</div>
			{!deleted && (
				<DiffTable
					before={before}
					after={after}
				/>
			)}
		</div>
	);
}

function CategoryEditor({
	draft,
	hasGame,
	isNewGoal,
	options,
	variables,
	busy,
	disabled,
	dirty,
	expected,
	confirmDelete,
	missingPbVariable,
	variablesReady,
	optionsReady,
	blocked,
	goalLocked,
	onField,
	onChooseCategory,
	onGoal,
	onRemoveVariable,
	onSave,
	onRevert,
	onDeleteRequest,
	onDeleteConfirm,
	onDeleteCancel,
}: {
	draft: CategoryMapping;
	hasGame: boolean;
	isNewGoal: boolean;
	options: SpeedrunGameOptions | null;
	variables: SpeedrunVariableOption[];
	busy: boolean;
	disabled: boolean;
	dirty: boolean;
	expected: string | null;
	confirmDelete: boolean;
	missingPbVariable: boolean;
	variablesReady: boolean;
	optionsReady: boolean;
	blocked: boolean;
	goalLocked: boolean;
	onField: <K extends keyof CategoryMapping["speedrunCom"]>(
		key: K,
		value: CategoryMapping["speedrunCom"][K],
	) => void;
	onChooseCategory: (option: SpeedrunCategoryOption) => void;
	onGoal: (goal: string) => void;
	onRemoveVariable: (id: string) => void;
	onSave: () => void;
	onRevert: () => void;
	onDeleteRequest: () => void;
	onDeleteConfirm: () => void;
	onDeleteCancel: () => void;
}) {
	const selectedCategory = options?.categories.find(
		(option) => option.id === draft.speedrunCom.categoryId,
	);
	const unsupportedAny = variablesReady
		? variables.filter(
				(variable) =>
					isAnySelection(draft.speedrunCom.variables[variable.id]) &&
					!supportsAnySelection(variable),
			)
		: [];
	// Variables saved in the mapping that no longer exist in the SRC definitions.
	const removedVariables = variablesReady
		? Object.entries(draft.speedrunCom.variables)
				.filter(
					([id, value]) =>
						value !== "" && !variables.some((variable) => variable.id === id),
				)
				.map(([id]) => id)
		: [];
	const goalMissing = isNewGoal && !goalLocked && !draft.racetime.goal.trim();
	const requirementIssue = !hasGame
		? "SRCゲームを選択してください。"
		: goalMissing
			? "Goalを入力してください。"
			: draft.speedrunCom.categoryId === ""
				? "SRCカテゴリを選択してください。"
				: !variablesReady
					? "Variablesを取得中です…"
					: missingPbVariable
						? "PB区分のVariableが未選択です。"
						: unsupportedAny.length > 0
							? "利用できないAnyがあります。"
							: removedVariables.length > 0
								? "削除されたVariableが残っています。"
								: null;
	const saveDisabled = busy || disabled || blocked || requirementIssue !== null;
	return (
		<form
			className='subpanel category-editor'
			onSubmit={(event) => {
				event.preventDefault();
				onSave();
			}}
		>
			{isNewGoal && !goalLocked ? (
				<Field label='RaceTime Goal'>
					<input
						value={draft.racetime.goal}
						disabled={disabled}
						onChange={(event) => onGoal(event.target.value)}
					/>
				</Field>
			) : (
				<p className='mapping-goal'>
					<span className='muted'>Goal</span>{" "}
					<strong>{draft.racetime.goal || "未入力"}</strong>
				</p>
			)}

			<h3>対応するSRCカテゴリ</h3>
			<Field label='カテゴリ'>
				<select
					value={draft.speedrunCom.categoryId}
					disabled={disabled || !optionsReady || !hasGame}
					onChange={(event) => {
						const option = options?.categories.find(
							(candidate) => candidate.id === event.target.value,
						);
						if (option) onChooseCategory(option);
					}}
				>
					<option value=''>選択してください</option>
					{options?.categories.map((option) => (
						<option
							key={option.id}
							value={option.id}
						>
							{option.name} ({option.type})
						</option>
					))}
				</select>
			</Field>

			<details className='mapping-conditions'>
				<summary>
					<span>記録の取得条件</span>
					{requirementIssue && (
						<span className='summary-warning'>
							保存に必要な条件が不足しています: {requirementIssue}
						</span>
					)}
				</summary>
				{selectedCategory?.type === "per-level" && (
					<Field label='Level'>
						<select
							value={draft.speedrunCom.levelId ?? ""}
							disabled={disabled}
							onChange={(event) =>
								onField("levelId", event.target.value || null)
							}
						>
							<option value=''>指定なし</option>
							{options?.levels.map((level) => (
								<option
									key={level.id}
									value={level.id}
								>
									{level.name}
								</option>
							))}
						</select>
					</Field>
				)}
				<div className='grid'>
					<Field label='Platform'>
						<select
							value={draft.speedrunCom.platformId ?? ""}
							disabled={disabled}
							onChange={(event) =>
								onField("platformId", event.target.value || null)
							}
						>
							<option value=''>指定なし</option>
							{options?.platforms.map((platform) => (
								<option
									key={platform.id}
									value={platform.id}
								>
									{platform.name}
								</option>
							))}
						</select>
					</Field>
					<Field label='Region'>
						<select
							value={draft.speedrunCom.regionId ?? ""}
							disabled={disabled}
							onChange={(event) =>
								onField("regionId", event.target.value || null)
							}
						>
							<option value=''>指定なし</option>
							{options?.regions.map((region) => (
								<option
									key={region.id}
									value={region.id}
								>
									{region.name}
								</option>
							))}
						</select>
					</Field>
					<Field label='Emulator'>
						<select
							value={
								draft.speedrunCom.emulator === null
									? "any"
									: draft.speedrunCom.emulator
										? "true"
										: "false"
							}
							disabled={disabled}
							onChange={(event) =>
								onField(
									"emulator",
									event.target.value === "any"
										? null
										: event.target.value === "true",
								)
							}
						>
							<option value='any'>指定なし</option>
							<option value='true'>エミュレータ</option>
							<option value='false'>実機</option>
						</select>
					</Field>
					<Field label='Timing Method'>
						<select
							value={draft.speedrunCom.timingMethod ?? ""}
							disabled={disabled}
							onChange={(event) =>
								onField(
									"timingMethod",
									(event.target.value || null) as TimingMethod | null,
								)
							}
						>
							<option value=''>指定なし</option>
							{(options?.timingMethods ?? []).map((method) => (
								<option
									key={method}
									value={method}
								>
									{TIMING_LABELS[method]}
								</option>
							))}
						</select>
					</Field>
				</div>
				{draft.speedrunCom.categoryId === "" ? (
					<p className='muted'>カテゴリを選択するとVariablesを設定できます。</p>
				) : !variablesReady ? (
					<p className='muted'>Variablesを取得中です…</p>
				) : variables.length === 0 ? (
					<p className='muted'>このカテゴリにVariablesはありません。</p>
				) : (
					<fieldset className='variables'>
						<legend>Variables</legend>
						<div className='grid'>
							{variables.map((variable) => (
								<Field
									key={variable.id}
									label={`${variable.name}${variable.obsoletes ? "（PB区分）" : ""}`}
								>
									{variable.userDefined ? (
										<input
											value={
												typeof draft.speedrunCom.variables[variable.id] ===
												"string"
													? (draft.speedrunCom.variables[variable.id] as string)
													: ""
											}
											disabled={disabled}
											onChange={(event) =>
												onField("variables", {
													...draft.speedrunCom.variables,
													[variable.id]: event.target.value,
												})
											}
										/>
									) : (
										<select
											value={
												isAnySelection(draft.speedrunCom.variables[variable.id])
													? ANY_SELECTION
													: typeof draft.speedrunCom.variables[variable.id] ===
															"string"
														? (draft.speedrunCom.variables[
																variable.id
															] as string)
														: ""
											}
											disabled={disabled}
											onChange={(event) =>
												onField("variables", {
													...draft.speedrunCom.variables,
													[variable.id]:
														event.target.value === ANY_SELECTION
															? {mode: "any"}
															: event.target.value,
												})
											}
										>
											<option value=''>選択してください</option>
											{supportsAnySelection(variable) && (
												<option value={ANY_SELECTION}>Any（すべて）</option>
											)}
											{variable.values.map((value) => (
												<option
													key={value.id}
													value={value.id}
												>
													{value.label}
												</option>
											))}
										</select>
									)}
								</Field>
							))}
						</div>
					</fieldset>
				)}
				{removedVariables.length > 0 && (
					<fieldset className='variables'>
						<legend>削除されたVariable</legend>
						<Callout tone='error'>
							保存されているVariableが現在のSpeedrun.com定義に存在しません。設定を削除するか、カテゴリを見直してください。
						</Callout>
						{removedVariables.map((id) => (
							<div
								className='formrow'
								key={id}
							>
								<span>{id}</span>
								<button
									type='button'
									aria-label={`変数 ${id} を削除`}
									disabled={disabled}
									onClick={() => onRemoveVariable(id)}
								>
									削除
								</button>
							</div>
						))}
					</fieldset>
				)}
				{missingPbVariable && (
					<Callout tone='warning'>
						公式PB区分を特定するVariableが未選択のため保存できません。
					</Callout>
				)}
				{unsupportedAny.length > 0 && (
					<Callout tone='error'>
						{`保存済みのAnyが現在のSpeedrun.com定義では利用できません: ${unsupportedAny
							.map((variable) => variable.name)
							.join(", ")}。値を選び直してください。`}
					</Callout>
				)}
			</details>

			<div className='button-row mapping-actions'>
				<button
					type='submit'
					disabled={saveDisabled}
				>
					{busy ? "保存中…" : "保存"}
				</button>
				<button
					type='button'
					disabled={busy || disabled || !dirty}
					onClick={onRevert}
				>
					元に戻す
				</button>
				{expected !== null && (
					<div className='danger-zone'>
						{confirmDelete ? (
							<>
								<span>このCategory Mappingを削除しますか？</span>
								<button
									type='button'
									disabled={busy || disabled}
									onClick={onDeleteConfirm}
								>
									削除を確定
								</button>
								<button
									type='button'
									onClick={onDeleteCancel}
								>
									キャンセル
								</button>
							</>
						) : (
							<button
								type='button'
								disabled={busy || disabled}
								onClick={onDeleteRequest}
							>
								削除
							</button>
						)}
					</div>
				)}
			</div>
		</form>
	);
}
