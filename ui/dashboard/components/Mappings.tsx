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

function blankGame(): GameMapping {
	return {
		racetime: {categorySlug: "", categoryName: ""},
		speedrunCom: {gameId: "", gameName: ""},
	};
}

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

	const activeGameId =
		categorySession?.draft.speedrunCom.gameId ||
		gameSession?.draft.speedrunCom.gameId ||
		"";
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

	const makeGameSession = (record: GameMappingRecord | null): GameSession => {
		const empty =
			mode === "race" && target ? gameForTarget(target) : blankGame();
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
			gameSession?.draft.racetime.categorySlug ??
			"";
		const empty =
			mode === "race" && target
				? categoryForTarget(target)
				: blankCategory(slug);
		empty.speedrunCom.gameId =
			gameSession?.baseline?.speedrunCom.gameId ??
			games.find((record) => record.mapping.racetime.categorySlug === slug)
				?.mapping.speedrunCom.gameId ??
			"";
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

	const startGameSession = (record: GameMappingRecord | null) => {
		searchGen.current++;
		if (mode === "race" && target)
			setCategorySession(
				makeCategorySession(
					findCategoryByKey(categories, target.categorySlug, target.goal),
				),
			);
		else setCategorySession(null);
		setSrcResults([]);
		setSrcQuery("");
		setMessage(null);
		setError(null);
		setGameSession(makeGameSession(record));
	};

	const selectGame = (record: GameMappingRecord | null) => {
		guard(() => startGameSession(record));
	};

	const gameCategories = categories.filter(
		(record) =>
			record.mapping.racetime.categorySlug ===
			(gameSession?.draft.racetime.categorySlug ?? ""),
	);
	const registeredGames = games.filter(
		(record) =>
			record.mapping.racetime.categorySlug ===
			(target?.categorySlug ?? gameSession?.draft.racetime.categorySlug),
	);
	const gameKeyLocked = gameSession?.baseline !== null && gameSession !== null;

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
		setGameSession(
			(session) =>
				session ??
				makeGameSession(
					games.find(
						(record) =>
							record.mapping.racetime.categorySlug === target.categorySlug,
					) ?? null,
				),
		);
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
		setGameSession(null);
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
		setGameSession(null);
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
		setMutating(true);
		setBusy(true);
		setError(null);
		setMessage(null);
		let saved = false;
		try {
			const result = await request("saveGameMapping", {
				mapping: gameSession.draft,
				expectedRevision: gameSession.baselineRevision,
				settingsRevision: gameSession.settingsRevision,
			});
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
			setGames((current) => {
				const key = result.record.mapping.racetime.categorySlug.trim();
				return [
					...current.filter(
						(record) =>
							record.mapping.racetime.categorySlug.trim() !== key ||
							record.mapping.speedrunCom.gameId !==
								result.record.mapping.speedrunCom.gameId,
					),
					result.record,
				];
			});
			setListSettingsRevision(result.settingsRevision);
			setCategorySession((session) =>
				session && !session.draft.speedrunCom.gameId
					? {
							...session,
							draft: {
								...session.draft,
								speedrunCom: {
									...session.draft.speedrunCom,
									gameId: result.record.mapping.speedrunCom.gameId,
								},
							},
							emptyDraft: {
								...session.emptyDraft,
								speedrunCom: {
									...session.emptyDraft.speedrunCom,
									gameId: result.record.mapping.speedrunCom.gameId,
								},
							},
						}
					: session,
			);
			setMessage("Game Mappingを保存しました。");
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
			const remaining = games.filter(
				(record) =>
					record.mapping.racetime.categorySlug !==
						gameSession.draft.racetime.categorySlug ||
					record.mapping.speedrunCom.gameId !==
						gameSession.draft.speedrunCom.gameId,
			);
			setGames(remaining);
			setGameSession(
				makeGameSession(
					remaining.find(
						(record) =>
							record.mapping.racetime.categorySlug ===
							gameSession.draft.racetime.categorySlug,
					) ?? null,
				),
			);
			onMappingChange?.();
			await refreshLists();
			setMessage("Game Mappingを削除しました。");
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
			if (closeOnSuccess) closeEditorAfterSave();
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
			setMessage("Category Mappingを削除しました。");
			setConfirmDelete(null);
			if (mode === "race") startCategorySession(null);
			else setCategorySession(null);
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
	const raceGameRecord = target
		? (games.find(
				(record) =>
					record.mapping.racetime.categorySlug === target.categorySlug &&
					(!raceCategoryRecord ||
						record.mapping.speedrunCom.gameId ===
							raceCategoryRecord.mapping.speedrunCom.gameId),
			) ?? null)
		: null;
	const shownError = mode === "manage" ? (error ?? listsError) : error;

	return (
		<div className={mode === "race" ? "mappings" : "mappings layout-two"}>
			{mode === "manage" && (
				<aside className='panel'>
					<div className='toolbar'>
						<h2>Game Mappings</h2>
						<button
							type='button'
							disabled={busy}
							onClick={() => selectGame(null)}
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
						{filteredGames.map((record) => (
							<li key={record.mapping.racetime.categorySlug}>
								<button
									type='button'
									disabled={busy}
									className={
										gameSession?.draft.racetime.categorySlug ===
										record.mapping.racetime.categorySlug
											? "active"
											: ""
									}
									onClick={() => selectGame(record)}
								>
									<strong>
										{record.mapping.racetime.categoryName ||
											record.mapping.racetime.categorySlug}
									</strong>
									<small>{record.mapping.speedrunCom.gameName}</small>
								</button>
							</li>
						))}
					</ul>
					<button
						type='button'
						disabled={busy}
						onClick={() => void reloadLatest()}
					>
						保存先から再読込
					</button>
				</aside>
			)}

			<section className='panel'>
				{mode === "race" && target && (
					<RaceMappingSummary
						target={target}
						game={raceGameRecord}
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

				{gameSession === null || (mode === "race" && !expanded) ? (
					mode === "race" ? null : (
						<p className='muted'>
							Game Mappingを選択するか、＋新規で作成してください。
						</p>
					)
				) : (
					<>
						<h2>Game Mapping</h2>
						<div className='subpanel'>
							<h3>登録済みSRCゲーム</h3>
							<ul className='list horizontal'>
								{registeredGames.map((record) => (
									<li key={record.mapping.speedrunCom.gameId}>
										<button
											type='button'
											disabled={busy || mutating}
											onClick={() => selectGame(record)}
										>
											{record.mapping.speedrunCom.gameName}
										</button>
									</li>
								))}
							</ul>
							<button
								type='button'
								disabled={busy || mutating}
								onClick={() =>
									guard(() => {
										const next = makeGameSession(null);
										next.draft.racetime = {...gameSession.draft.racetime};
										next.emptyDraft.racetime = {...gameSession.draft.racetime};
										startGameSession(null);
										setGameSession(next);
									})
								}
							>
								SRCゲームを追加
							</button>
						</div>
						{gameSession.status === "conflict" && (
							<SessionConflict
								label='Game Mapping'
								deleted={gameSession.conflict === null}
								before={gameSession.conflict?.mapping ?? gameSession.emptyDraft}
								after={gameSession.draft}
								busy={busy}
								onAdopt={adoptGameLatest}
								onReEdit={reEditGameLatest}
							/>
						)}
						{gameSession.status === "invalid" && (
							<Callout tone='warning'>
								このGame
								Mappingは保存先から削除されたか、Spreadsheet設定が変更されました。保存できません。再読込して選び直してください。
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
												session ? {...session, comparison: null} : session,
											)
										}
									>
										比較を閉じる
									</button>
								</div>
							</div>
						)}
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void saveGame();
							}}
						>
							<div className='grid'>
								<Field label='RaceTime category slug（一意キー）'>
									<input
										value={gameSession.draft.racetime.categorySlug}
										readOnly={mode === "race" || gameSession.baseline !== null}
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
								<Field label='RaceTime category name（表示用）'>
									<input
										value={gameSession.draft.racetime.categoryName}
										readOnly={mode === "race"}
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
							{gameSession.baseline !== null && (
								<p className='muted'>
									一意キーの変更はできません。変更する場合は削除して新規登録してください。
								</p>
							)}

							<div className='subpanel'>
								<h3>Speedrun.com ゲーム（手動選択）</h3>
								{gameKeyLocked && (
									<Field label='SRCゲーム名（表示用）'>
										<input
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
								)}
								{gameKeyLocked && (
									<Callout tone='warning'>
										登録済みのSRCゲームIDは変更できません。別のゲームは追加してください。
									</Callout>
								)}
								<p className='muted'>
									選択中: {gameSession.draft.speedrunCom.gameName || "未選択"}
									{gameSession.draft.speedrunCom.gameId
										? ` (${gameSession.draft.speedrunCom.gameId})`
										: ""}
								</p>
								<div className='formrow'>
									<input
										aria-label='SRCゲーム検索'
										placeholder='ゲーム名で検索'
										disabled={gameKeyLocked || mutating}
										value={srcQuery}
										onChange={(event) => setSrcQuery(event.target.value)}
									/>
									<button
										type='button'
										disabled={
											busy ||
											mutating ||
											gameKeyLocked ||
											srcQuery.trim() === ""
										}
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
											gameKeyLocked ||
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
							</div>

							<div className='button-row'>
								<button
									type='submit'
									disabled={busy || mutating || gameBlocked}
								>
									{busy ? "保存中…" : "Game Mappingを保存"}
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
															session.baseline ?? session.emptyDraft,
														),
													}
												: session,
										)
									}
								>
									Revert
								</button>
								{gameSession.baselineRevision !== null &&
									(confirmDelete === "game" ? (
										<>
											<span>
												子Category
												Mappingがある場合は削除できません。削除しますか？
											</span>
											<button
												type='button'
												disabled={busy || mutating}
												onClick={() => void removeGame()}
											>
												削除を確定
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
											削除
										</button>
									))}
							</div>
						</form>

						<h2>Category Mappings</h2>
						{registeredGames.length === 0 ? (
							<p className='muted'>先にGame Mappingを保存してください。</p>
						) : (
							<>
								{mode === "manage" && (
									<ul className='list horizontal'>
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
										<li>
											<button
												type='button'
												disabled={busy}
												onClick={() => selectCategory(null)}
											>
												＋ 新規 Goal
											</button>
										</li>
									</ul>
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
												Mappingは保存先から削除されたか、Spreadsheet設定が変更されました。保存できません。再読込して選び直してください。
											</Callout>
										)}
										{categorySession.comparison && (
											<div className='subpanel'>
												<h3>前回の編集内容（比較用・自動適用しません）</h3>
												<DiffTable
													before={
														categorySession.baseline ??
														categorySession.emptyDraft
													}
													after={categorySession.comparison}
												/>
												<div className='button-row'>
													<button
														type='button'
														onClick={() =>
															setCategorySession((session) =>
																session
																	? {...session, comparison: null}
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
											games={registeredGames}
											onGame={(gameId) => {
												optionsGen.current++;
												variablesGen.current++;
												setOptions(null);
												setOptionsFor(null);
												setVariables([]);
												setVariablesFor(null);
												requestedOptions.current = null;
												requestedVariables.current = null;
												setCategorySession((session) =>
													session
														? {
																...session,
																draft: {
																	...session.draft,
																	speedrunCom: {
																		...blankCategory(
																			session.draft.racetime.categorySlug,
																		).speedrunCom,
																		gameId,
																	},
																},
															}
														: session,
												);
											}}
											options={options}
											variables={variables}
											busy={busy}
											disabled={mutating}
											dirty={categoryDirty}
											expected={categorySession.baselineRevision}
											confirmDelete={confirmDelete === "category"}
											missingPbVariable={missingPbVariable}
											variablesReady={variablesReady}
											optionsReady={
												optionsReady &&
												!!categorySession.draft.speedrunCom.gameId &&
												registeredGames.some(
													(record) =>
														record.mapping.speedrunCom.gameId ===
														categorySession.draft.speedrunCom.gameId,
												)
											}
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
									<p className='muted'>
										Goalを選択するか新規作成してください。
									</p>
								)}
							</>
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
	game,
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
	game: GameMappingRecord | null;
	games: GameMappingRecord[];
	category: CategoryMappingRecord | null;
	ready: boolean;
	error: string | null;
	busy: boolean;
	expanded: boolean;
	onToggle: () => void;
	onReload: () => void;
}) {
	const inconsistent =
		ready && error === null && game === null && category !== null;
	const pending = !ready || error !== null;
	const gameLabel = pending
		? "—"
		: games.length > 0
			? `登録済み: ${games.map((record) => record.mapping.speedrunCom.gameName).join(" / ")}`
			: "未登録";
	const categoryLabel = pending
		? "—"
		: category
			? `登録済み: ${category.mapping.speedrunCom.categoryName}`
			: "未登録";
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
						保存先から再読込
					</button>
				</div>
			</div>
			<dl className='details'>
				<div>
					<dt>RaceTimeゲーム</dt>
					<dd>
						{target.categoryName} ({target.categorySlug})
					</dd>
				</div>
				<div>
					<dt>RaceTime Goal</dt>
					<dd>{target.goal}</dd>
				</div>
				<div>
					<dt>Game Mapping</dt>
					<dd>{gameLabel}</dd>
				</div>
				<div>
					<dt>Category Mapping</dt>
					<dd>{categoryLabel}</dd>
				</div>
			</dl>
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
					Game Mappingが未登録のため不整合です。先にGame
					Mappingを登録してください。
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
	games,
	onGame,
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
	games: GameMappingRecord[];
	onGame: (gameId: string) => void;
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
	const goalReadOnly = goalLocked || expected !== null;
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
	const saveDisabled =
		busy ||
		disabled ||
		missingPbVariable ||
		!variablesReady ||
		blocked ||
		unsupportedAny.length > 0 ||
		removedVariables.length > 0;
	return (
		<form
			className='subpanel category-editor'
			onSubmit={(event) => {
				event.preventDefault();
				onSave();
			}}
		>
			<Field label='RaceTime Goal'>
				<input
					value={draft.racetime.goal}
					readOnly={goalReadOnly}
					disabled={disabled}
					onChange={(event) => onGoal(event.target.value)}
				/>
			</Field>
			{goalReadOnly && (
				<p className='muted'>
					一意キーの変更はできません。変更する場合は削除して新規登録してください。
				</p>
			)}
			<Field label='SRC Game（必須）'>
				<select
					value={draft.speedrunCom.gameId}
					disabled={disabled || busy}
					onChange={(event) => onGame(event.target.value)}
				>
					<option value=''>選択してください</option>
					{games.map((record) => (
						<option
							key={record.mapping.speedrunCom.gameId}
							value={record.mapping.speedrunCom.gameId}
						>
							{record.mapping.speedrunCom.gameName}
						</option>
					))}
				</select>
			</Field>
			<Field label='SRC Category（必須）'>
				<select
					value={draft.speedrunCom.categoryId}
					disabled={disabled || !optionsReady}
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
			{selectedCategory?.type === "per-level" && (
				<Field label='Level'>
					<select
						value={draft.speedrunCom.levelId ?? ""}
						disabled={disabled}
						onChange={(event) => onField("levelId", event.target.value || null)}
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
			<fieldset className='variables'>
				<legend>Variables</legend>
				{draft.speedrunCom.categoryId === "" ? (
					<p className='muted'>SRC Categoryを選択してください。</p>
				) : !variablesReady ? (
					<p className='muted'>Variablesを取得中です…</p>
				) : variables.length === 0 ? (
					<p className='muted'>このカテゴリにVariablesはありません。</p>
				) : (
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
													? (draft.speedrunCom.variables[variable.id] as string)
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
				)}
			</fieldset>
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
			<div className='button-row'>
				<button
					type='submit'
					disabled={saveDisabled}
				>
					{busy ? "保存中…" : "Category Mappingを保存"}
				</button>
				<button
					type='button'
					disabled={busy || disabled || !dirty}
					onClick={onRevert}
				>
					Revert
				</button>
				{expected !== null &&
					(confirmDelete ? (
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
					))}
			</div>
		</form>
	);
}
