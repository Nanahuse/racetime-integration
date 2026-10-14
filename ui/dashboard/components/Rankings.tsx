import type {
	CategoryMappingRecord,
	SpeedrunLeaderboard,
} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {errorMessage, request} from "../api/client";
import {formatRaceTime} from "../model/race-time";
import {Callout} from "./common";

function mappingId(record: CategoryMappingRecord): string {
	return `${record.mapping.racetime.categorySlug}\u0000${record.mapping.racetime.goal}`;
}

export function Rankings() {
	const [records, setRecords] = useState<CategoryMappingRecord[]>([]);
	const [selected, setSelected] = useState("");
	const [boards, setBoards] = useState<SpeedrunLeaderboard[]>([]);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [state, setState] = useState<string | null>(null);
	const selectedRecord = useMemo(
		() => records.find((record) => mappingId(record) === selected),
		[records, selected],
	);

	useEffect(() => {
		void request("listCategoryMappings", undefined)
			.then(({records: next}) => {
				setRecords(next);
				setSelected(
					(current) => current || (next[0] ? mappingId(next[0]) : ""),
				);
			})
			.catch((cause) => setError(errorMessage(cause)));
	}, []);

	const load = useCallback(
		async (refresh = false) => {
			if (!selectedRecord || busyRef.current) return;
			busyRef.current = true;
			setBusy(true);
			setError(null);
			setState("取得中");
			try {
				const result = await request("getSpeedrunLeaderboards", {
					categorySlug: selectedRecord.mapping.racetime.categorySlug,
					goal: selectedRecord.mapping.racetime.goal,
					refresh,
				});
				if (result.status === "unregistered") {
					setBoards([]);
					setState("マッピング未登録");
					return;
				}
				if (result.status === "inconsistent") {
					setBoards([]);
					setState(`マッピング不整合: ${result.message}`);
					return;
				}
				setBoards(result.leaderboards ?? []);
				setState(result.stale ? "古いキャッシュを表示中" : "取得済み");
			} catch (cause) {
				setError(errorMessage(cause));
				setState("通信エラー");
			} finally {
				busyRef.current = false;
				setBusy(false);
			}
		},
		[selectedRecord],
	);

	useEffect(() => {
		if (selectedRecord) void load();
	}, [selectedRecord, load]);

	return (
		<section className='panel'>
			<h2>Rankings</h2>
			<div className='formrow'>
				<label>
					Mapping{" "}
					<select
						aria-label='Ranking mapping'
						value={selected}
						onChange={(event) => {
							setSelected(event.target.value);
							setBoards([]);
						}}
					>
						{records.map((record) => (
							<option
								key={mappingId(record)}
								value={mappingId(record)}
							>
								{record.mapping.racetime.categorySlug} /{" "}
								{record.mapping.racetime.goal}
							</option>
						))}
					</select>
				</label>
				<button
					type='button'
					disabled={!selectedRecord || busy}
					onClick={() => void load(true)}
				>
					{busy ? "取得中…" : "再取得"}
				</button>
			</div>
			{error && <Callout tone='error'>{error}</Callout>}
			{state && (
				<p className='muted'>
					{state}
					{boards[0]
						? ` · 最終取得 ${new Date(boards[0].fetchedAt).toLocaleString()}`
						: ""}
				</p>
			)}
			{!records.length && !error && (
				<p className='muted'>Category Mappingがありません。</p>
			)}
			{boards.map((board) => (
				<div
					className='subpanel'
					key={board.mapping.key}
				>
					<h3>
						{board.mapping.game.gameName} / {board.mapping.label}
					</h3>
					{board.state === "not_found" ? (
						<p className='muted'>該当する記録はありません。</p>
					) : (
						<table>
							<thead>
								<tr>
									<th>順位</th>
									<th>プレイヤー</th>
									<th>記録</th>
									<th>日付</th>
								</tr>
							</thead>
							<tbody>
								{board.entries.map(({place, run}) => (
									<tr key={run.runId}>
										<td>{place}</td>
										<td>
											{run.players.map((player, index) => (
												<span
													key={`${player.userId ?? "guest"}-${player.name}-${index}`}
												>
													{player.displayName ?? player.name}
													{player.personalBest && (
														<small className='muted'>
															{` · PB ${player.personalBest.state === "found" && player.personalBest.run ? formatRaceTime(player.personalBest.run.time) : player.personalBest.state === "not_found" ? "記録なし" : player.personalBest.state === "error" ? "取得失敗" : "未連携"}`}
															{player.personalBest.stale ? " · 古いデータ" : ""}
														</small>
													)}
													{index + 1 < run.players.length ? ", " : ""}
												</span>
											))}
										</td>
										<td>
											<a
												className='link'
												href={run.url}
												target='_blank'
												rel='noopener noreferrer'
											>
												{formatRaceTime(run.time)}
											</a>
										</td>
										<td>{run.date ?? "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			))}
		</section>
	);
}
