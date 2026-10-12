import type {SettingsState} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useState} from "react";
import {
	errorMessage,
	isConflict,
	isSettingsChanged,
	request,
} from "../api/client";
import {spreadsheetEditUrl, spreadsheetIdFromInput} from "../model/spreadsheet";
import {Badge, Callout, Field} from "./common";

type Validation = "unknown" | "ok" | "error";

export function Settings() {
	const [settings, setSettings] = useState<SettingsState | null>(null);
	const [urlInput, setUrlInput] = useState("");
	const [gameSheet, setGameSheet] = useState("GameMappings");
	const [categorySheet, setCategorySheet] = useState("CategoryMappings");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [validation, setValidation] = useState<Validation>("unknown");
	const [conflict, setConflict] = useState(false);

	const load = useCallback(async () => {
		const state = await request("getSettings", undefined);
		setSettings(state);
		setUrlInput(state.settings.spreadsheetId ?? "");
		setGameSheet(state.settings.gameMappingsSheet);
		setCategorySheet(state.settings.categoryMappingsSheet);
		setValidation("unknown");
		setConflict(false);
	}, []);

	useEffect(() => {
		void load().catch((cause) => setError(errorMessage(cause)));
	}, [load]);

	const save = async () => {
		if (!settings || conflict) return;
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			const next = await request("updateSettings", {
				settings: {
					spreadsheetId: spreadsheetIdFromInput(urlInput),
					gameMappingsSheet: gameSheet.trim(),
					categoryMappingsSheet: categorySheet.trim(),
				},
				expectedRevision: settings.revision,
			});
			setSettings(next);
			setConflict(false);
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
				setConflict(true);
				setValidation("unknown");
				setError(
					"設定が別の場所で更新されました。最新設定を再取得してから保存してください。入力内容は保持しています。",
				);
			} else {
				setValidation("error");
				setError(errorMessage(cause));
			}
		} finally {
			setBusy(false);
		}
	};

	/** Refreshes only the expected revision, keeping the user's input intact. */
	const refreshRevision = async () => {
		setBusy(true);
		setError(null);
		try {
			const latest = await request("getSettings", undefined);
			setSettings(latest);
			setConflict(false);
			setValidation("unknown");
			setMessage(
				"最新の設定Revisionを取得しました。内容を確認して保存してください。",
			);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	/** Explicitly replaces the form with the latest saved settings. */
	const adoptLatest = async () => {
		setBusy(true);
		setError(null);
		try {
			const latest = await request("getSettings", undefined);
			setSettings(latest);
			setUrlInput(latest.settings.spreadsheetId ?? "");
			setGameSheet(latest.settings.gameMappingsSheet);
			setCategorySheet(latest.settings.categoryMappingsSheet);
			setConflict(false);
			setValidation("unknown");
			setMessage("最新の設定を読み込みました。");
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	const applied = settings?.settings ?? null;
	const spreadsheetId = applied?.spreadsheetId ?? null;
	const hasInput = spreadsheetIdFromInput(urlInput) !== null;
	const inputsDirty = applied
		? spreadsheetIdFromInput(urlInput) !== applied.spreadsheetId ||
			gameSheet.trim() !== applied.gameMappingsSheet ||
			categorySheet.trim() !== applied.categoryMappingsSheet
		: false;
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
			{conflict ? (
				<div className='callout warning'>
					<p>{error}</p>
					<div className='button-row'>
						<button
							type='button'
							disabled={busy}
							onClick={() => void refreshRevision()}
						>
							最新設定を再取得（入力を保持）
						</button>
						<button
							type='button'
							disabled={busy}
							onClick={() => void adoptLatest()}
						>
							最新設定で入力を置き換える
						</button>
					</div>
				</div>
			) : (
				error && <Callout tone='error'>{error}</Callout>
			)}
			{message && <Callout tone='success'>{message}</Callout>}
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
						onChange={(event) => setUrlInput(event.target.value)}
					/>
				</Field>
				<Field label='GameMappings シート名'>
					<input
						value={gameSheet}
						onChange={(event) => setGameSheet(event.target.value)}
					/>
				</Field>
				<Field label='CategoryMappings シート名'>
					<input
						value={categorySheet}
						onChange={(event) => setCategorySheet(event.target.value)}
					/>
				</Field>
				<div className='button-row'>
					<button
						type='submit'
						disabled={busy || !settings || conflict}
					>
						{busy ? "検証中…" : "保存"}
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
