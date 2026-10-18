import {
	DEFAULT_ALLOWED_RACE_ORIGINS,
	DEFAULT_LEADERBOARD_TOP,
	DEFAULT_MAX_RESOLVED_MAPPINGS,
	normalizeAllowedRaceOrigin,
	normalizeAllowedRaceOrigins,
	type SettingsState,
	type Settings as SettingsValue,
	type SpreadsheetInitialization,
	type SpreadsheetSheetOutcome,
} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useState} from "react";
import {
	errorMessage,
	isConflict,
	isSettingsChanged,
	request,
} from "../api/client";
import type {EditorState} from "../model/editor";
import {spreadsheetEditUrl, spreadsheetIdFromInput} from "../model/spreadsheet";
import {Badge, Callout, Field} from "./common";
import {DiffTable} from "./DiffTable";

type Validation = "unknown" | "ok" | "error";

const OUTCOME_LABELS: Record<SpreadsheetSheetOutcome, string> = {
	created: "新規作成",
	initialized: "ヘッダーを設定",
	unchanged: "変更なし",
};

function formatInitialization(result: SpreadsheetInitialization): string {
	return `初期化しました。GameMappings: ${OUTCOME_LABELS[result.gameMappings]} / CategoryMappings: ${OUTCOME_LABELS[result.categoryMappings]}`;
}

type SettingsInput = {
	spreadsheetId: string | null;
	gameMappingsSheet: string;
	categoryMappingsSheet: string;
	allowedRaceOrigins: string[];
	// null means the field is invalid or empty; saving is blocked.
	maxResolvedMappings: number | null;
	leaderboardTop: number | null;
};

/** Parses the Any-expansion cap input, or null when it is not a safe integer >= 1. */
function parseMaxMappings(value: string): number | null {
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const parsed = Number(trimmed);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}
function parseLeaderboardTop(value: string): number | null {
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const parsed = Number(trimmed);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

type ConflictState =
	| {status: "none"}
	| {status: "unavailable"; message: string}
	| {status: "ready"; latest: SettingsState};

export function Settings({
	onStateChange,
}: {
	onStateChange?: (state: EditorState) => void;
}) {
	const [baseline, setBaseline] = useState<SettingsState | null>(null);
	const [urlInput, setUrlInput] = useState("");
	const [gameSheet, setGameSheet] = useState("GameMappings");
	const [categorySheet, setCategorySheet] = useState("CategoryMappings");
	const [allowedRaceOrigins, setAllowedRaceOrigins] = useState<string[]>([
		...DEFAULT_ALLOWED_RACE_ORIGINS,
	]);
	const [originInput, setOriginInput] = useState("");
	const [originError, setOriginError] = useState<string | null>(null);
	const [maxMappingsInput, setMaxMappingsInput] = useState(
		String(DEFAULT_MAX_RESOLVED_MAPPINGS),
	);
	const [leaderboardTopInput, setLeaderboardTopInput] = useState(
		String(DEFAULT_LEADERBOARD_TOP),
	);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [validation, setValidation] = useState<Validation>("unknown");
	const [conflict, setConflict] = useState<ConflictState>({status: "none"});
	const [comparison, setComparison] = useState<SettingsInput | null>(null);
	const [initializing, setInitializing] = useState(false);
	const [initMessage, setInitMessage] = useState<string | null>(null);
	const [initError, setInitError] = useState<string | null>(null);

	const currentInput = (): SettingsInput => ({
		spreadsheetId: spreadsheetIdFromInput(urlInput),
		gameMappingsSheet: gameSheet.trim(),
		categoryMappingsSheet: categorySheet.trim(),
		allowedRaceOrigins: [...allowedRaceOrigins],
		maxResolvedMappings: parseMaxMappings(maxMappingsInput),
		leaderboardTop: parseLeaderboardTop(leaderboardTopInput),
	});

	const maxMappingsInvalid = currentInput().maxResolvedMappings === null;
	const leaderboardTopInvalid = currentInput().leaderboardTop === null;

	// The initialization result only describes the inputs it ran against, so
	// editing any target field clears it.
	const changeTarget = () => {
		setInitMessage(null);
		setInitError(null);
	};

	const applySettings = useCallback((state: SettingsState) => {
		setBaseline(state);
		setUrlInput(state.settings.spreadsheetId ?? "");
		setGameSheet(state.settings.gameMappingsSheet);
		setCategorySheet(state.settings.categoryMappingsSheet);
		setAllowedRaceOrigins(
			normalizeAllowedRaceOrigins(state.settings.allowedRaceOrigins),
		);
		setMaxMappingsInput(String(state.settings.maxResolvedMappings));
		setLeaderboardTopInput(String(state.settings.leaderboardTop));
	}, []);

	const load = useCallback(async () => {
		const state = await request("getSettings", undefined);
		applySettings(state);
		setValidation("unknown");
		setConflict({status: "none"});
		setComparison(null);
	}, [applySettings]);

	useEffect(() => {
		void load().catch((cause) => setError(errorMessage(cause)));
	}, [load]);

	const inputsDirty = baseline
		? (() => {
				const current = currentInput();
				const comparable = (input: SettingsInput) => ({
					spreadsheetId: input.spreadsheetId,
					gameMappingsSheet: input.gameMappingsSheet,
					categoryMappingsSheet: input.categoryMappingsSheet,
					allowedRaceOrigins: [...input.allowedRaceOrigins].sort(),
					maxResolvedMappings: input.maxResolvedMappings,
					leaderboardTop: input.leaderboardTop,
				});
				return (
					JSON.stringify(comparable(current)) !==
					JSON.stringify(comparable(baseline.settings))
				);
			})()
		: false;

	const addAllowedOrigin = () => {
		if (busy || initializing) return;
		try {
			const origin = normalizeAllowedRaceOrigin(originInput);
			if (allowedRaceOrigins.includes(origin))
				throw new TypeError("正規化後に重複するOriginは登録できません。");
			setAllowedRaceOrigins((current) => [...current, origin]);
			setOriginInput("");
			setOriginError(null);
		} catch (cause) {
			setOriginError(errorMessage(cause));
		}
	};

	useEffect(() => {
		onStateChange?.({dirty: inputsDirty, busy: busy || initializing});
	}, [inputsDirty, busy, initializing, onStateChange]);

	const initialize = async () => {
		if (busy || initializing) return;
		// Snapshot the input so a mid-flight edit cannot retarget the operation.
		const target = currentInput();
		if (!target.spreadsheetId) {
			setInitError("Spreadsheet URL または ID を入力してください。");
			setInitMessage(null);
			return;
		}
		setInitializing(true);
		setInitError(null);
		setInitMessage(null);
		try {
			const result = await request("initializeSpreadsheet", {
				settings: {
					spreadsheetId: target.spreadsheetId,
					gameMappingsSheet: target.gameMappingsSheet,
					categoryMappingsSheet: target.categoryMappingsSheet,
				},
			});
			setInitMessage(formatInitialization(result));
		} catch (cause) {
			setInitError(errorMessage(cause));
		} finally {
			setInitializing(false);
		}
	};

	const save = async () => {
		if (busy || initializing) return;
		if (!baseline || conflict.status !== "none") return;
		const input = currentInput();
		if (input.maxResolvedMappings === null || input.leaderboardTop === null) {
			setValidation("error");
			setError(
				input.maxResolvedMappings === null
					? "Any展開の最大件数は1以上の整数で入力してください。"
					: "リーダーボード取得順位数は1以上の整数で入力してください。",
			);
			setMessage(null);
			return;
		}
		const settings: SettingsValue = {
			spreadsheetId: input.spreadsheetId,
			gameMappingsSheet: input.gameMappingsSheet,
			categoryMappingsSheet: input.categoryMappingsSheet,
			allowedRaceOrigins: input.allowedRaceOrigins,
			maxResolvedMappings: input.maxResolvedMappings,
			leaderboardTop: input.leaderboardTop,
		};
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			const next = await request("updateSettings", {
				settings,
				expectedRevision: baseline.revision,
			});
			applySettings(next);
			setConflict({status: "none"});
			setComparison(null);
			setOriginError(null);
			const spreadsheetChanged =
				baseline.settings.spreadsheetId !== input.spreadsheetId ||
				baseline.settings.gameMappingsSheet !== input.gameMappingsSheet ||
				baseline.settings.categoryMappingsSheet !== input.categoryMappingsSheet;
			if (!spreadsheetChanged) {
				setValidation((current) => (current === "ok" ? "ok" : "unknown"));
				setMessage("保存しました。Spreadsheet接続の確認は行っていません。");
			} else if (next.settings.spreadsheetId === null) {
				setValidation("unknown");
				setMessage(
					"Spreadsheetを未設定として保存しました（マッピングは無効）。",
				);
			} else {
				setValidation("ok");
				setMessage(
					"保存し、GameMappingsとCategoryMappingsの両シートを確認しました。",
				);
			}
		} catch (cause) {
			if (isSettingsChanged(cause) || isConflict(cause)) {
				// Block saving immediately, then try to fetch the latest revision.
				setConflict({
					status: "unavailable",
					message: "最新設定を取得しています…",
				});
				setValidation("unknown");
				setError(null);
				try {
					const latest = await request("getSettings", undefined);
					setConflict({status: "ready", latest});
				} catch (reloadError) {
					setConflict({
						status: "unavailable",
						message: errorMessage(reloadError),
					});
				}
			} else {
				setValidation("error");
				setError(errorMessage(cause));
			}
		} finally {
			setBusy(false);
		}
	};

	const refetchLatest = async () => {
		if (busy || conflict.status !== "unavailable") return;
		setBusy(true);
		setError(null);
		try {
			const latest = await request("getSettings", undefined);
			setConflict({status: "ready", latest});
		} catch (cause) {
			setConflict({status: "unavailable", message: errorMessage(cause)});
		} finally {
			setBusy(false);
		}
	};

	/** Replaces the form with the latest saved settings. */
	const adoptLatest = () => {
		if (conflict.status !== "ready") return;
		applySettings(conflict.latest);
		setConflict({status: "none"});
		setComparison(null);
		setValidation("unknown");
		setError(null);
		setMessage("最新の設定を読み込みました。");
	};

	/** Rebases on the latest settings, keeping the previous input for comparison. */
	const reEditLatest = () => {
		if (conflict.status !== "ready") return;
		const previous = currentInput();
		applySettings(conflict.latest);
		setComparison(previous);
		setConflict({status: "none"});
		setValidation("unknown");
		setError(null);
		setMessage(
			"最新設定を編集の基準にしました。以前の入力内容は比較用に保持しています。",
		);
	};

	const applied = baseline?.settings ?? null;
	const spreadsheetId = applied?.spreadsheetId ?? null;
	const hasInput = spreadsheetIdFromInput(urlInput) !== null;
	const connection = ((): {
		state: string;
		tone: "success" | "warning" | "error" | "neutral";
	} => {
		if (validation === "error") return {state: "エラー", tone: "error"};
		if (spreadsheetId === null && !hasInput)
			return {state: "未設定", tone: "neutral"};
		if (validation === "ok" && !inputsDirty)
			return {state: "利用可能", tone: "success"};
		return {state: "未確認", tone: "warning"};
	})();

	return (
		<div className='settings panel'>
			<h2>Spreadsheet 設定</h2>
			<Badge
				label='接続状態'
				state={connection.state}
				tone={connection.tone}
				title='保存時に両シートを実際に検証できた場合のみ「利用可能」になります'
			/>
			{conflict.status !== "none" ? (
				<div className='callout warning'>
					<p>
						設定が別の場所で更新されました。入力内容は保持しています。
						{conflict.status === "ready"
							? " 最新設定を採用するか、最新設定から再編集してください。"
							: " 最新設定を再取得してください。"}
					</p>
					{conflict.status === "unavailable" &&
						conflict.message &&
						conflict.message !== "最新設定を取得しています…" && (
							<p className='muted'>{conflict.message}</p>
						)}
					<div className='button-row'>
						{conflict.status === "ready" ? (
							<>
								<button
									type='button'
									disabled={busy}
									onClick={adoptLatest}
								>
									最新設定を採用
								</button>
								<button
									type='button'
									disabled={busy}
									onClick={reEditLatest}
								>
									最新設定から再編集
								</button>
							</>
						) : (
							<button
								type='button'
								disabled={busy}
								onClick={() => void refetchLatest()}
							>
								最新設定を再取得
							</button>
						)}
					</div>
					{conflict.status === "ready" && (
						<DiffTable
							before={conflict.latest.settings}
							after={currentInput()}
						/>
					)}
				</div>
			) : (
				error && <Callout tone='error'>{error}</Callout>
			)}
			{message && <Callout tone='success'>{message}</Callout>}
			{initError && <Callout tone='error'>{initError}</Callout>}
			{initMessage && <Callout tone='success'>{initMessage}</Callout>}
			{comparison && baseline && (
				<div className='subpanel'>
					<h3>以前の入力内容（比較用・自動適用しません）</h3>
					<DiffTable
						before={baseline.settings}
						after={comparison}
					/>
					<div className='button-row'>
						<button
							type='button'
							onClick={() => setComparison(null)}
						>
							比較を閉じる
						</button>
					</div>
				</div>
			)}
			<section className='subpanel'>
				<h3>RaceTime接続設定</h3>
				<strong>接続許可先</strong>
				{allowedRaceOrigins.length === 0 ? (
					<p className='muted'>接続許可先はありません。</p>
				) : (
					<ul className='list allowed-origins'>
						{allowedRaceOrigins.map((origin) => (
							<li key={origin}>
								<span>{origin}</span>
								<button
									type='button'
									disabled={busy || initializing}
									aria-label={`${origin}を削除`}
									onClick={() => {
										setAllowedRaceOrigins((current) =>
											current.filter((item) => item !== origin),
										);
										setOriginError(null);
									}}
								>
									削除
								</button>
							</li>
						))}
					</ul>
				)}
				<Field label='新しい接続先'>
					<div className='formrow'>
						<input
							value={originInput}
							placeholder='https://racetime.gg または http://localhost:8000'
							disabled={busy || initializing}
							onChange={(event) => {
								setOriginInput(event.target.value);
								setOriginError(null);
							}}
						/>
						<button
							type='button'
							disabled={busy || initializing}
							onClick={addAllowedOrigin}
						>
							追加
						</button>
					</div>
				</Field>
				{originError && <Callout tone='error'>{originError}</Callout>}
				<p className='muted'>
					許可された接続先のみ監視に使用できます。HTTPはlocalhostなどのループバック接続先に限ります。
				</p>
			</section>
			<form
				className='settings-form'
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<Field label='Spreadsheet URL または ID'>
					<input
						value={urlInput}
						placeholder='https://docs.google.com/spreadsheets/d/...'
						disabled={busy || initializing}
						onChange={(event) => {
							setUrlInput(event.target.value);
							changeTarget();
						}}
					/>
				</Field>
				<Field label='GameMappings シート名'>
					<input
						value={gameSheet}
						disabled={busy || initializing}
						onChange={(event) => {
							setGameSheet(event.target.value);
							changeTarget();
						}}
					/>
				</Field>
				<Field label='CategoryMappings シート名'>
					<input
						value={categorySheet}
						disabled={busy || initializing}
						onChange={(event) => {
							setCategorySheet(event.target.value);
							changeTarget();
						}}
					/>
				</Field>
				<Field label='Any展開の最大件数'>
					<input
						type='number'
						min={1}
						step={1}
						value={maxMappingsInput}
						disabled={busy || initializing}
						onChange={(event) => setMaxMappingsInput(event.target.value)}
					/>
				</Field>
				<Field label='リーダーボード取得順位数'>
					<input
						type='number'
						min={1}
						step={1}
						value={leaderboardTopInput}
						disabled={busy || initializing}
						onChange={(event) => setLeaderboardTopInput(event.target.value)}
					/>
				</Field>
				{maxMappingsInvalid && (
					<Callout tone='error'>
						Any展開の最大件数は1以上の整数で入力してください。
					</Callout>
				)}
				{leaderboardTopInvalid && (
					<Callout tone='error'>
						リーダーボード取得順位数は1以上の整数で入力してください。
					</Callout>
				)}
				<div className='button-row'>
					<button
						type='submit'
						disabled={
							busy ||
							initializing ||
							!baseline ||
							conflict.status !== "none" ||
							maxMappingsInvalid ||
							leaderboardTopInvalid
						}
					>
						{busy ? "検証中…" : "保存"}
					</button>
					<button
						type='button'
						disabled={busy || initializing || !hasInput}
						onClick={() => void initialize()}
					>
						{initializing ? "初期化中…" : "Spreadsheetを初期化"}
					</button>
					{spreadsheetId && (
						<a
							className='link'
							href={spreadsheetEditUrl(spreadsheetId)}
							target='_blank'
							rel='noopener noreferrer'
						>
							Spreadsheetを開く ↗
						</a>
					)}
				</div>
			</form>
			<p className='muted'>
				Google認証情報の入力は不要です（ADCを使用）。保存に失敗した場合は旧設定を維持します。
			</p>
		</div>
	);
}
