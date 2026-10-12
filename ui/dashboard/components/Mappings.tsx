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
import {diffValues} from "../model/diff";
import {Callout, Field} from "./common";

const TIMING_LABELS: Record<TimingMethod, string> = {
	realtime: "Real Time",
	realtime_noloads: "Real Time (no load removal)",
	ingame: "In-Game Time",
};

type Kind = "game" | "category";

type Conflict =
	| {kind: "game"; latest: GameMappingRecord | null}
	| {kind: "category"; latest: CategoryMappingRecord | null};

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

function DiffTable({before, after}: {before: unknown; after: unknown}) {
	const entries = diffValues(before, after);
	if (entries.length === 0)
		return <p className='muted'>保存済みの最新内容と同じです。</p>;
	return (
		<table className='participants'>
			<thead>
				<tr>
					<th>項目</th>
					<th>最新（保存済み）</th>
					<th>編集中</th>
				</tr>
			</thead>
			<tbody>
				{entries.map((entry) => (
					<tr key={entry.path}>
						<td>{entry.path}</td>
						<td>{entry.before}</td>
						<td>{entry.after}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function Mappings() {
	const [games, setGames] = useState<GameMappingRecord[]>([]);
	const [categories, setCategories] = useState<CategoryMappingRecord[]>([]);
	const [settingsRevision, setSettingsRevision] = useState(0);
	const [gameQuery, setGameQuery] = useState("");

	const [gameSelected, setGameSelected] = useState<string | null>(null);
	const [gameSaved, setGameSaved] = useState<GameMapping | null>(null);
	const [gameDraft, setGameDraft] = useState<GameMapping>(blankGame());
	const [gameExpected, setGameExpected] = useState<string | null>(null);

	const [categorySelected, setCategorySelected] = useState<string | null>(null);
	const [categorySaved, setCategorySaved] = useState<CategoryMapping | null>(
		null,
	);
	const [categoryDraft, setCategoryDraft] = useState<CategoryMapping | null>(
		null,
	);
	const [categoryExpected, setCategoryExpected] = useState<string | null>(null);

	const [srcQuery, setSrcQuery] = useState("");
	const [srcResults, setSrcResults] = useState<SpeedrunGameSummary[]>([]);
	const [options, setOptions] = useState<SpeedrunGameOptions | null>(null);
	const [optionsFor, setOptionsFor] = useState<string | null>(null);
	const [variables, setVariables] = useState<SpeedrunVariableOption[]>([]);
	const [variablesFor, setVariablesFor] = useState<string | null>(null);
	const [variablesLoading, setVariablesLoading] = useState(false);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [conflict, setConflict] = useState<Conflict | null>(null);
	const [diffVisible, setDiffVisible] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState<Kind | null>(null);
	const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

	const optionsGen = useRef(0);
	const variablesGen = useRef(0);
	const searchGen = useRef(0);

	const gameDirty =
		stringify(gameDraft) !== stringify(gameSaved ?? blankGame());
	const categoryDirty = categoryDraft
		? stringify(categoryDraft) !==
			stringify(categorySaved ?? blankCategory(gameSelected ?? ""))
		: false;
	const conflictBlocking = conflict !== null && !diffVisible;

	const reloadLists = useCallback(async () => {
		const [gameList, categoryList] = await Promise.all([
			request("listGameMappings", undefined),
			request("listCategoryMappings", undefined),
		]);
		setGames(gameList.records);
		setCategories(categoryList.records);
		setSettingsRevision(gameList.settingsRevision);
		return {gameList, categoryList};
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				await reloadLists();
			} catch (cause) {
				setError(errorMessage(cause));
			}
		})();
	}, [reloadLists]);

	const guard = (action: () => void) => {
		if (gameDirty || categoryDirty) setPendingAction(() => action);
		else action();
	};

	const loadOptions = async (gameId: string) => {
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
	};

	const loadVariables = async (categoryId: string) => {
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
	};

	const applyGameSelection = (record: GameMappingRecord | null) => {
		optionsGen.current++;
		variablesGen.current++;
		searchGen.current++;
		const mapping = record ? structuredClone(record.mapping) : blankGame();
		setGameSelected(record?.mapping.racetime.categorySlug ?? null);
		setGameSaved(record?.mapping ?? null);
		setGameDraft(mapping);
		setGameExpected(record?.revision ?? null);
		setCategorySelected(null);
		setCategorySaved(null);
		setCategoryDraft(null);
		setCategoryExpected(null);
		setVariables([]);
		setVariablesFor(null);
		setVariablesLoading(false);
		setOptions(null);
		setOptionsFor(null);
		setSrcResults([]);
		setSrcQuery("");
		setMessage(null);
		setError(null);
		setConflict(null);
		setDiffVisible(false);
		if (mapping.speedrunCom.gameId)
			void loadOptions(mapping.speedrunCom.gameId);
	};

	const selectGame = (record: GameMappingRecord | null) => {
		guard(() => applyGameSelection(record));
	};

	const gameCategories = categories.filter(
		(record) => record.mapping.racetime.categorySlug === gameSelected,
	);
	const gameHasChildren = gameSaved !== null && gameCategories.length > 0;

	const selectCategory = (record: CategoryMappingRecord | null) => {
		guard(() => {
			variablesGen.current++;
			const mapping = record
				? structuredClone(record.mapping)
				: blankCategory(gameSelected ?? "");
			setCategorySelected(record ? record.mapping.racetime.goal : null);
			setCategorySaved(record?.mapping ?? null);
			setCategoryDraft(mapping);
			setCategoryExpected(record?.revision ?? null);
			setVariables([]);
			setVariablesFor(null);
			setVariablesLoading(false);
			setMessage(null);
			setError(null);
			setConflict(null);
			setDiffVisible(false);
			void loadVariables(mapping.speedrunCom.categoryId);
		});
	};

	const reloadAndFind = async (kind: Kind) => {
		const {gameList, categoryList} = await reloadLists();
		if (kind === "game") {
			const key = gameDraft.racetime.categorySlug.trim();
			return (
				gameList.records.find(
					(record) => record.mapping.racetime.categorySlug.trim() === key,
				) ?? null
			);
		}
		const slug = categoryDraft?.racetime.categorySlug.trim() ?? "";
		const goal = categoryDraft?.racetime.goal.trim() ?? "";
		return (
			categoryList.records.find(
				(record) =>
					record.mapping.racetime.categorySlug.trim() === slug &&
					record.mapping.racetime.goal.trim() === goal,
			) ?? null
		);
	};

	const handleSaveFailure = async (kind: Kind, cause: unknown) => {
		if (isConflict(cause)) {
			const latest = await reloadAndFind(kind);
			setConflict({kind, latest} as Conflict);
			setDiffVisible(false);
			setError(
				latest === null
					? "選択中のレコードは保存先から削除されています。最新状態へ戻すか、編集内容を確認してやり直してください。"
					: "他の変更と競合しました。最新状態へ戻すか、編集内容を確認してやり直してください。",
			);
			return;
		}
		if (isSettingsChanged(cause)) {
			await reloadLists();
			setConflict(null);
			setDiffVisible(false);
			setError(
				"Spreadsheet設定が変更されました。新しい保存先の内容を再読込しました。編集を再開してください。",
			);
			return;
		}
		if (isGameMappingConflict(cause)) {
			await reloadLists();
			setError(
				"子Category Mappingが存在するため、この操作はできません。先に子Category Mappingを整理してください。",
			);
			return;
		}
		setError(errorMessage(cause));
	};

	const adoptLatest = () => {
		if (!conflict) return;
		if (conflict.kind === "game") {
			const latest = conflict.latest;
			setGameSaved(latest?.mapping ?? null);
			setGameDraft(latest ? structuredClone(latest.mapping) : blankGame());
			setGameExpected(latest?.revision ?? null);
			if (latest) setGameSelected(latest.mapping.racetime.categorySlug);
			setMessage(
				latest
					? "最新のGame Mappingを読み込みました。"
					: "保存先のGame Mappingは削除されています。",
			);
		} else {
			const latest = conflict.latest;
			setCategorySaved(latest?.mapping ?? null);
			setCategoryDraft(
				latest
					? structuredClone(latest.mapping)
					: blankCategory(gameSelected ?? ""),
			);
			setCategoryExpected(latest?.revision ?? null);
			if (latest) void loadVariables(latest.mapping.speedrunCom.categoryId);
			setMessage(
				latest
					? "最新のCategory Mappingを読み込みました。"
					: "保存先のCategory Mappingは削除されています。",
			);
		}
		setConflict(null);
		setDiffVisible(false);
		setError(null);
	};

	const confirmRedo = () => {
		if (!conflict) return;
		if (conflict.kind === "game")
			setGameExpected(conflict.latest?.revision ?? null);
		else setCategoryExpected(conflict.latest?.revision ?? null);
		setDiffVisible(true);
		setError(null);
	};

	const saveGame = async () => {
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			const result = await request("saveGameMapping", {
				mapping: gameDraft,
				expectedRevision: gameExpected,
				settingsRevision,
			});
			setGameSaved(result.record.mapping);
			setGameDraft(structuredClone(result.record.mapping));
			setGameSelected(result.record.mapping.racetime.categorySlug);
			setGameExpected(result.record.revision);
			setConflict(null);
			setDiffVisible(false);
			setMessage("Game Mappingを保存しました。");
			await reloadLists();
		} catch (cause) {
			await handleSaveFailure("game", cause);
		} finally {
			setBusy(false);
		}
	};

	const removeGame = async () => {
		if (gameExpected === null) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await request("deleteGameMapping", {
				categorySlug: gameDraft.racetime.categorySlug,
				expectedRevision: gameExpected,
				settingsRevision,
			});
			setConfirmDelete(null);
			applyGameSelection(null);
			await reloadLists();
			setMessage("Game Mappingを削除しました。");
		} catch (cause) {
			setConfirmDelete(null);
			await handleSaveFailure("game", cause);
		} finally {
			setBusy(false);
		}
	};

	const saveCategory = async () => {
		if (!categoryDraft) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			const result = await request("saveCategoryMapping", {
				mapping: categoryDraft,
				expectedRevision: categoryExpected,
				settingsRevision,
			});
			setCategorySaved(result.record.mapping);
			setCategoryDraft(structuredClone(result.record.mapping));
			setCategorySelected(result.record.mapping.racetime.goal);
			setCategoryExpected(result.record.revision);
			setConflict(null);
			setDiffVisible(false);
			setMessage("Category Mappingを保存しました。");
			await reloadLists();
		} catch (cause) {
			await handleSaveFailure("category", cause);
		} finally {
			setBusy(false);
		}
	};

	const removeCategory = async () => {
		if (!categoryDraft || categoryExpected === null) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await request("deleteCategoryMapping", {
				categorySlug: categoryDraft.racetime.categorySlug,
				goal: categoryDraft.racetime.goal,
				expectedRevision: categoryExpected,
				settingsRevision,
			});
			setMessage("Category Mappingを削除しました。");
			setConfirmDelete(null);
			setCategorySelected(null);
			setCategorySaved(null);
			setCategoryDraft(null);
			setCategoryExpected(null);
			await reloadLists();
		} catch (cause) {
			setConfirmDelete(null);
			await handleSaveFailure("category", cause);
		} finally {
			setBusy(false);
		}
	};

	const reloadLatest = async () => {
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			const {gameList, categoryList} = await reloadLists();
			const gameWasDirty = gameDirty;
			const categoryWasDirty = categoryDirty;
			let notice: string | null = null;
			const gameKey = gameDraft.racetime.categorySlug.trim();
			const latestGame = gameKey
				? (gameList.records.find(
						(record) => record.mapping.racetime.categorySlug.trim() === gameKey,
					) ?? null)
				: null;
			setGameSaved(latestGame?.mapping ?? null);
			setGameExpected(latestGame?.revision ?? null);
			if (!gameWasDirty) {
				if (latestGame) {
					setGameDraft(structuredClone(latestGame.mapping));
					setGameSelected(latestGame.mapping.racetime.categorySlug);
				} else if (gameSelected !== null) {
					setGameDraft(blankGame());
					setGameSelected(null);
					setCategorySelected(null);
					setCategorySaved(null);
					setCategoryDraft(null);
					setCategoryExpected(null);
				}
			}
			if (gameKey && latestGame === null)
				notice = "選択中のGame Mappingは保存先から削除されています。";
			if (categoryDraft) {
				const slug = categoryDraft.racetime.categorySlug.trim();
				const goal = categoryDraft.racetime.goal.trim();
				const latestCategory =
					categoryList.records.find(
						(record) =>
							record.mapping.racetime.categorySlug.trim() === slug &&
							record.mapping.racetime.goal.trim() === goal,
					) ?? null;
				setCategorySaved(latestCategory?.mapping ?? null);
				setCategoryExpected(latestCategory?.revision ?? null);
				if (!categoryWasDirty && latestCategory)
					setCategoryDraft(structuredClone(latestCategory.mapping));
				if (latestCategory === null)
					notice = "選択中のCategory Mappingは保存先から削除されています。";
			}
			setConflict(null);
			setDiffVisible(false);
			setMessage(
				notice ??
					(gameWasDirty || categoryWasDirty
						? "保存済みデータを取り込みました。未保存の編集は保持しています。"
						: "最新の内容を読み込みました。"),
			);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
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

	const chooseSrcGame = async (game: SpeedrunGameSummary) => {
		optionsGen.current++;
		variablesGen.current++;
		setGameDraft((draft) => ({
			...draft,
			speedrunCom: {gameId: game.id, gameName: game.name},
		}));
		setCategoryDraft((draft) =>
			draft
				? {
						...draft,
						speedrunCom: {
							...draft.speedrunCom,
							categoryId: "",
							categoryName: "",
							levelId: null,
							variables: {},
						},
					}
				: draft,
		);
		setSrcResults([]);
		setSrcQuery("");
		setOptions(null);
		setOptionsFor(null);
		setVariables([]);
		setVariablesFor(null);
		setVariablesLoading(false);
		await loadOptions(game.id);
	};

	const chooseCategory = async (option: SpeedrunCategoryOption) => {
		setCategoryDraft((draft) =>
			draft
				? {
						...draft,
						speedrunCom: {
							...draft.speedrunCom,
							categoryId: option.id,
							categoryName: option.name,
							levelId:
								option.type === "per-level" ? draft.speedrunCom.levelId : null,
							variables: {},
						},
					}
				: draft,
		);
		setVariables([]);
		setVariablesFor(null);
		await loadVariables(option.id);
	};

	const setCategoryField = <K extends keyof CategoryMapping["speedrunCom"]>(
		key: K,
		value: CategoryMapping["speedrunCom"][K],
	) => {
		setCategoryDraft((draft) =>
			draft
				? {...draft, speedrunCom: {...draft.speedrunCom, [key]: value}}
				: draft,
		);
	};

	const filteredGames = games.filter((record) =>
		stringify(record.mapping).toLowerCase().includes(gameQuery.toLowerCase()),
	);
	const categoryId = categoryDraft?.speedrunCom.categoryId ?? "";
	const variablesReady =
		categoryId !== "" && !variablesLoading && variablesFor === categoryId;
	const missingMandatory = categoryDraft
		? variables.some(
				(variable) =>
					variable.mandatory &&
					!categoryDraft.speedrunCom.variables[variable.id],
			)
		: false;
	const optionsReady =
		!gameDraft.speedrunCom.gameId ||
		(optionsFor !== null && optionsFor === gameDraft.speedrunCom.gameId);

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
									gameSelected === record.mapping.racetime.categorySlug
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
				{conflict ? (
					<div className='callout warning'>
						<p>{error}</p>
						<div className='button-row'>
							<button
								type='button'
								disabled={busy}
								onClick={adoptLatest}
							>
								最新状態へ戻す
							</button>
							<button
								type='button'
								disabled={busy || diffVisible}
								onClick={confirmRedo}
							>
								編集内容を確認してやり直す
							</button>
						</div>
						{diffVisible && (
							<DiffTable
								before={
									conflict.kind === "game"
										? (conflict.latest?.mapping ?? blankGame())
										: (conflict.latest?.mapping ??
											blankCategory(gameSelected ?? ""))
								}
								after={
									conflict.kind === "game"
										? gameDraft
										: (categoryDraft ?? blankCategory(gameSelected ?? ""))
								}
							/>
						)}
					</div>
				) : (
					error && <Callout tone='error'>{error}</Callout>
				)}
				{message && <Callout tone='success'>{message}</Callout>}

				<h2>Game Mapping</h2>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void saveGame();
					}}
				>
					<div className='grid'>
						<Field label='RaceTime category slug（一意キー）'>
							<input
								value={gameDraft.racetime.categorySlug}
								readOnly={gameSaved !== null}
								onChange={(event) =>
									setGameDraft({
										...gameDraft,
										racetime: {
											...gameDraft.racetime,
											categorySlug: event.target.value,
										},
									})
								}
							/>
						</Field>
						<Field label='RaceTime category name（表示用）'>
							<input
								value={gameDraft.racetime.categoryName}
								onChange={(event) =>
									setGameDraft({
										...gameDraft,
										racetime: {
											...gameDraft.racetime,
											categoryName: event.target.value,
										},
									})
								}
							/>
						</Field>
					</div>
					{gameSaved !== null && (
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
							選択中: {gameDraft.speedrunCom.gameName || "未選択"}
							{gameDraft.speedrunCom.gameId
								? ` (${gameDraft.speedrunCom.gameId})`
								: ""}
						</p>
						<div className='formrow'>
							<input
								aria-label='SRCゲーム検索'
								placeholder='ゲーム名で検索'
								disabled={gameHasChildren}
								value={srcQuery}
								onChange={(event) => setSrcQuery(event.target.value)}
							/>
							<button
								type='button'
								disabled={busy || gameHasChildren || srcQuery.trim() === ""}
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
								disabled={gameHasChildren}
								onClick={() => void chooseSrcGame(game)}
							>
								{game.name} ({game.abbreviation})
							</button>
						))}
					</div>

					<div className='button-row'>
						<button
							type='submit'
							disabled={busy || conflictBlocking}
						>
							{busy ? "保存中…" : "Game Mappingを保存"}
						</button>
						<button
							type='button'
							disabled={busy || !gameDirty}
							onClick={() =>
								setGameDraft(structuredClone(gameSaved ?? blankGame()))
							}
						>
							Revert
						</button>
						{gameExpected !== null &&
							(confirmDelete === "game" ? (
								<>
									<span>
										子Category Mappingがある場合は削除できません。削除しますか？
									</span>
									<button
										type='button'
										disabled={busy}
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
									onClick={() => setConfirmDelete("game")}
								>
									削除
								</button>
							))}
					</div>
				</form>

				<h2>Category Mappings</h2>
				{gameSelected === null ? (
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
											categorySelected === record.mapping.racetime.goal
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
						{categoryDraft ? (
							<CategoryEditor
								draft={categoryDraft}
								options={options}
								variables={variables}
								busy={busy}
								dirty={categoryDirty}
								expected={categoryExpected}
								confirmDelete={confirmDelete === "category"}
								missingMandatory={missingMandatory}
								variablesReady={variablesReady}
								optionsReady={optionsReady}
								blocked={conflictBlocking}
								onField={setCategoryField}
								onChooseCategory={(option) => void chooseCategory(option)}
								onGoal={(goal) =>
									setCategoryDraft({
										...categoryDraft,
										racetime: {...categoryDraft.racetime, goal},
									})
								}
								onSave={() => void saveCategory()}
								onRevert={() =>
									setCategoryDraft(
										structuredClone(
											categorySaved ?? blankCategory(gameSelected ?? ""),
										),
									)
								}
								onDeleteRequest={() => setConfirmDelete("category")}
								onDeleteConfirm={() => void removeCategory()}
								onDeleteCancel={() => setConfirmDelete(null)}
							/>
						) : (
							<p className='muted'>Goalを選択するか新規作成してください。</p>
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

function CategoryEditor({
	draft,
	options,
	variables,
	busy,
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
	const saveDisabled = busy || missingMandatory || !variablesReady || blocked;
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
					disabled={!optionsReady}
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
					disabled={busy || !dirty}
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
								disabled={busy}
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
							onClick={onDeleteRequest}
						>
							削除
						</button>
					))}
			</div>
		</form>
	);
}
