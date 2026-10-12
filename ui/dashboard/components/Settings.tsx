import type {
	SettingsState,
	SpreadsheetInitialization,
	SpreadsheetSheetOutcome,
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
};

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
	});

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
		? JSON.stringify(currentInput()) !== JSON.stringify(baseline.settings)
		: false;

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
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			const next = await request("updateSettings", {
				settings: currentInput(),
				expectedRevision: baseline.revision,
			});
			applySettings(next);
			setConflict({status: "none"});
			setComparison(null);
			if (next.settings.spreadsheetId === null) {
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
				<div className='button-row'>
					<button
						type='submit'
						disabled={
							busy || initializing || !baseline || conflict.status !== "none"
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
