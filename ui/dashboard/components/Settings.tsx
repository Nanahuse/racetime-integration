import type {SettingsState} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useState} from "react";
import {errorMessage, isConflict, request} from "../api/client";
import {spreadsheetEditUrl, spreadsheetIdFromInput} from "../model/spreadsheet";
import {Badge, Callout, Field} from "./common";

export function Settings() {
	const [settings, setSettings] = useState<SettingsState | null>(null);
	const [urlInput, setUrlInput] = useState("");
	const [gameSheet, setGameSheet] = useState("GameMappings");
	const [categorySheet, setCategorySheet] = useState("CategoryMappings");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [validated, setValidated] = useState(false);

	const load = useCallback(async () => {
		const state = await request("getSettings", undefined);
		setSettings(state);
		setUrlInput(state.settings.spreadsheetId ?? "");
		setGameSheet(state.settings.gameMappingsSheet);
		setCategorySheet(state.settings.categoryMappingsSheet);
		setValidated(false);
	}, []);

	useEffect(() => {
		void load().catch((cause) => setError(errorMessage(cause)));
	}, [load]);

	const save = async () => {
		if (!settings) return;
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
			setValidated(true);
			setMessage(
				"保存し、GameMappingsとCategoryMappingsの両シートを確認しました。",
			);
		} catch (cause) {
			setValidated(false);
			setError(errorMessage(cause));
			if (isConflict(cause)) await load();
		} finally {
			setBusy(false);
		}
	};

	const spreadsheetId = settings?.settings.spreadsheetId ?? null;
	const tone = validated ? "success" : spreadsheetId ? "warning" : "neutral";
	const state = validated ? "利用可能" : spreadsheetId ? "未検証" : "未設定";

	return (
		<div className='settings panel'>
			<h2>Spreadsheet 設定</h2>
			<Badge
				label='接続状態'
				state={state}
				tone={tone}
				title='保存時に両シートを実際に検証した場合のみ「利用可能」になります'
			/>
			{error && <Callout tone='error'>{error}</Callout>}
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
						disabled={busy || !settings}
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
