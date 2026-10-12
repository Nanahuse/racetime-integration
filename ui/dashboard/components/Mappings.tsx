import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	SpeedrunCategoryOption,
	SpeedrunGameOptions,
	SpeedrunGameSummary,
	SpeedrunVariableOption,
	TimingMethod,
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

type Kind = "game" | "category";
type SessionStatus = "normal" | "conflict" | "invalid";

type GameSession = {
	status: SessionStatus;
	baseline: GameMapping | null;
	baselineRevision: string | null;
	draft: GameMapping;
	settingsRevision: number;
	conflict: GameMappingRecord | null;
	comparison: GameMapping | null;
};

type CategorySession = {
	status: SessionStatus;
	baseline: CategoryMapping | null;
	baselineRevision: string | null;
	draft: CategoryMapping;
	settingsRevision: number;
	conflict: CategoryMappingRecord | null;
	comparison: CategoryMapping | null;
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
): GameMappingRecord | null {
	const key = slug.trim();
	return (
		records.find(
			(record) => record.mapping.racetime.categorySlug.trim() === key,
		) ?? null
	);
}

function findCategory(
	records: readonly CategoryMappingRecord[],
	draft: CategoryMapping,
): CategoryMappingRecord | null {
	const key = `${draft.racetime.categorySlug.trim()}\u0000${draft.racetime.goal.trim()}`;
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
		stringify(session.draft) !== stringify(session.baseline ?? blankGame())
	);
}

function categoryIsDirty(session: CategorySession): boolean {
	return (
		stringify(session.draft) !==
		stringify(
			session.baseline ?? blankCategory(session.draft.racetime.categorySlug),
		)
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
			draft: latest ? structuredClone(latest.mapping) : blankGame(),
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
			draft: blankGame(),
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
			draft: latest
				? structuredClone(latest.mapping)
				: blankCategory(session.draft.racetime.categorySlug),
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
			draft: blankCategory(session.draft.racetime.categorySlug),
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
		setGameSession((session) =>
			session
				? reconcileGame(
						session,
						findGame(result.games, session.draft.racetime.categorySlug),
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
		void refreshLists().catch((cause) => setError(errorMessage(cause)));
	}, [refreshLists]);

	const activeGameId = gameSession?.draft.speedrunCom.gameId ?? "";
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

	const startGameSession = (record: GameMappingRecord | null) => {
		searchGen.current++;
		setCategorySession(null);
		setSrcResults([]);
		setSrcQuery("");
		setMessage(null);
		setError(null);
		setGameSession({
			status: "normal",
			baseline: record?.mapping ?? null,
			baselineRevision: record?.revision ?? null,
			draft: record ? structuredClone(record.mapping) : blankGame(),
			settingsRevision: listSettingsRevision ?? 0,
			conflict: null,
			comparison: null,
		});
	};

	const selectGame = (record: GameMappingRecord | null) => {
		guard(() => startGameSession(record));
	};

	const gameCategories = categories.filter(
		(record) =>
			record.mapping.racetime.categorySlug ===
			(gameSession?.draft.racetime.categorySlug ?? ""),
	);
	const gameHasChildren =
		(gameSession?.baseline ?? null) !== null && gameCategories.length > 0;

	const startCategorySession = (record: CategoryMappingRecord | null) => {
		const slug = gameSession?.draft.racetime.categorySlug ?? "";
		setMessage(null);
		setError(null);
		setCategorySession({
			status: "normal",
			baseline: record?.mapping ?? null,
			baselineRevision: record?.revision ?? null,
			draft: record ? structuredClone(record.mapping) : blankCategory(slug),
			settingsRevision:
				listSettingsRevision ?? gameSession?.settingsRevision ?? 0,
			conflict: null,
			comparison: null,
		});
	};

	const selectCategory = (record: CategoryMappingRecord | null) => {
		guard(() => startCategorySession(record));
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
				draft: latest ? structuredClone(latest.mapping) : blankGame(),
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
				draft: latest ? structuredClone(latest.mapping) : blankGame(),
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
				draft: latest
					? structuredClone(latest.mapping)
					: blankCategory(session.draft.racetime.categorySlug),
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
				draft: latest
					? structuredClone(latest.mapping)
					: blankCategory(session.draft.racetime.categorySlug),
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
				draft: structuredClone(result.record.mapping),
				settingsRevision: gameSession.settingsRevision,
				conflict: null,
				comparison: null,
			});
			setMessage("Game Mappingを保存しました。");
			await refreshLists();
		} catch (cause) {
			await handleSaveFailure(cause);
		} finally {
			setBusy(false);
			setMutating(false);
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
				expectedRevision: gameSession.baselineRevision,
				settingsRevision: gameSession.settingsRevision,
			});
			setConfirmDelete(null);
			startGameSession(null);
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
		setMutating(true);
		setBusy(true);
		setError(null);
		setMessage(null);
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
				draft: structuredClone(result.record.mapping),
				settingsRevision: categorySession.settingsRevision,
				conflict: null,
				comparison: null,
			});
			setMessage("Category Mappingを保存しました。");
			await refreshLists();
		} catch (cause) {
			await handleSaveFailure(cause);
		} finally {
			setBusy(false);
			setMutating(false);
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
			setCategorySession(null);
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
		setCategorySession((session) =>
			session
				? {
						...session,
						draft: {
							...session.draft,
							speedrunCom: {
								...session.draft.speedrunCom,
								categoryId: "",
								categoryName: "",
								levelId: null,
								variables: {},
							},
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

	const filteredGames = games.filter((record) =>
		stringify(record.mapping).toLowerCase().includes(gameQuery.toLowerCase()),
	);
	const gameBlocked = gameSession !== null && gameSession.status !== "normal";
	const categoryBlocked =
		categorySession !== null && categorySession.status !== "normal";
	const categoryId = categorySession?.draft.speedrunCom.categoryId ?? "";
	const variablesReady =
		categoryId !== "" && !variablesLoading && variablesFor === categoryId;
	const missingMandatory = categorySession
		? variables.some(
				(variable) =>
					variable.mandatory &&
					!categorySession.draft.speedrunCom.variables[variable.id],
			)
		: false;
	const optionsReady =
		!activeGameId || (optionsFor !== null && optionsFor === activeGameId);
	const hasSessionNotice =
		gameSession?.status === "conflict" ||
		gameSession?.status === "invalid" ||
		categorySession?.status === "conflict" ||
		categorySession?.status === "invalid";

	return (
		<div className='mappings layout-two'>
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

			<section className='panel'>
				{error && !hasSessionNotice && <Callout tone='error'>{error}</Callout>}
				{message && <Callout tone='success'>{message}</Callout>}

				{gameSession === null ? (
					<p className='muted'>
						Game Mappingを選択するか、＋新規で作成してください。
					</p>
				) : (
					<>
						<h2>Game Mapping</h2>
						{gameSession.status === "conflict" && (
							<SessionConflict
								label='Game Mapping'
								deleted={gameSession.conflict === null}
								before={gameSession.conflict?.mapping ?? blankGame()}
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
									before={gameSession.baseline ?? blankGame()}
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
										readOnly={gameSession.baseline !== null}
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
								{gameHasChildren && (
									<Callout tone='warning'>
										子Category
										Mappingが存在するためSRCゲームを変更できません。先に子Category
										Mappingを整理してください。
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
										disabled={gameHasChildren || mutating}
										value={srcQuery}
										onChange={(event) => setSrcQuery(event.target.value)}
									/>
									<button
										type='button'
										disabled={
											busy ||
											mutating ||
											gameHasChildren ||
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
										disabled={gameHasChildren || mutating}
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
															session.baseline ?? blankGame(),
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
						{gameSession.baseline === null ? (
							<p className='muted'>先にGame Mappingを保存してください。</p>
						) : (
							<>
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
												<small>{record.mapping.speedrunCom.categoryName}</small>
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
								{categorySession ? (
									<>
										{categorySession.status === "conflict" && (
											<SessionConflict
												label='Category Mapping'
												deleted={categorySession.conflict === null}
												before={
													categorySession.conflict?.mapping ??
													blankCategory(
														categorySession.draft.racetime.categorySlug,
													)
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
														blankCategory(
															categorySession.draft.racetime.categorySlug,
														)
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
											options={options}
											variables={variables}
											busy={busy}
											disabled={mutating}
											dirty={categoryDirty}
											expected={categorySession.baselineRevision}
											confirmDelete={confirmDelete === "category"}
											missingMandatory={missingMandatory}
											variablesReady={variablesReady}
											optionsReady={optionsReady}
											blocked={categoryBlocked}
											onField={setCategoryField}
											onChooseCategory={chooseCategory}
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
																	session.baseline ??
																		blankCategory(
																			session.draft.racetime.categorySlug,
																		),
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
	options,
	variables,
	busy,
	disabled,
	dirty,
	expected,
	confirmDelete,
	missingMandatory,
	variablesReady,
	optionsReady,
	blocked,
	onField,
	onChooseCategory,
	onGoal,
	onSave,
	onRevert,
	onDeleteRequest,
	onDeleteConfirm,
	onDeleteCancel,
}: {
	draft: CategoryMapping;
	options: SpeedrunGameOptions | null;
	variables: SpeedrunVariableOption[];
	busy: boolean;
	disabled: boolean;
	dirty: boolean;
	expected: string | null;
	confirmDelete: boolean;
	missingMandatory: boolean;
	variablesReady: boolean;
	optionsReady: boolean;
	blocked: boolean;
	onField: <K extends keyof CategoryMapping["speedrunCom"]>(
		key: K,
		value: CategoryMapping["speedrunCom"][K],
	) => void;
	onChooseCategory: (option: SpeedrunCategoryOption) => void;
	onGoal: (goal: string) => void;
	onSave: () => void;
	onRevert: () => void;
	onDeleteRequest: () => void;
	onDeleteConfirm: () => void;
	onDeleteCancel: () => void;
}) {
	const selectedCategory = options?.categories.find(
		(option) => option.id === draft.speedrunCom.categoryId,
	);
	const goalReadOnly = expected !== null;
	const saveDisabled =
		busy || disabled || missingMandatory || !variablesReady || blocked;
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
								label={`${variable.name}${variable.mandatory ? "（必須）" : ""}`}
							>
								{variable.userDefined ? (
									<input
										value={draft.speedrunCom.variables[variable.id] ?? ""}
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
										value={draft.speedrunCom.variables[variable.id] ?? ""}
										disabled={disabled}
										onChange={(event) =>
											onField("variables", {
												...draft.speedrunCom.variables,
												[variable.id]: event.target.value,
											})
										}
									>
										<option value=''>選択してください</option>
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
			{missingMandatory && (
				<Callout tone='warning'>
					必須Variableが未選択のため保存できません。
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
