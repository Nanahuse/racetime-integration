import type {
	CategoryMappingRecord,
	SpeedrunLeaderboard,
} from "@nanahuse/racetime-protocol";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {errorMessage, request} from "../api/client";
import {formatRaceInstant, formatRaceTime} from "../model/race-time";
import {Callout} from "./common";

function mappingId(record: CategoryMappingRecord): string {
	return `${record.mapping.racetime.categorySlug}\u0000${record.mapping.racetime.goal}`;
}

type MappingResult = {
	boards: SpeedrunLeaderboard[];
	state: string;
	error: string | null;
};

export function Rankings() {
	const [records, setRecords] = useState<CategoryMappingRecord[]>([]);
	const [mappingsError, setMappingsError] = useState<string | null>(null);
	const [selected, setSelected] = useState("");
	const [results, setResults] = useState<Record<string, MappingResult>>({});
	const [loadingIds, setLoadingIds] = useState<string[]>([]);
	const activeIds = useRef(new Set<string>());
	const selectedRecord = useMemo(
		() => records.find((record) => mappingId(record) === selected),
		[records, selected],
	);
	const selectedResult = results[selected];
	const selectedLoading = loadingIds.includes(selected);

	useEffect(() => {
		void request("listCategoryMappings", undefined)
			.then(({records: next}) => {
				setRecords(next);
				setSelected(
					(current) => current || (next[0] ? mappingId(next[0]) : ""),
				);
			})
			.catch((cause) => setMappingsError(errorMessage(cause)));
	}, []);

	const load = useCallback(
		async (record: CategoryMappingRecord, refresh = false) => {
			const id = mappingId(record);
			if (activeIds.current.has(id)) return;
			activeIds.current.add(id);
			setLoadingIds((current) => [...current, id]);
			setResults((current) => ({
				...current,
				[id]: {
					boards: current[id]?.boards ?? [],
					state: "取得中",
					error: null,
				},
			}));
			try {
				const result = await request("getSpeedrunLeaderboards", {
					categorySlug: record.mapping.racetime.categorySlug,
					goal: record.mapping.racetime.goal,
					refresh,
				});
				let next: MappingResult;
				if (result.status === "unregistered") {
					next = {boards: [], state: "マッピング未登録", error: null};
				} else if (result.status === "inconsistent") {
					next = {
						boards: [],
						state: `マッピング不整合: ${result.message}`,
						error: null,
					};
				} else {
					next = {
						boards: result.leaderboards ?? [],
						state: result.stale ? "古いキャッシュを表示中" : "取得済み",
						error: null,
					};
				}
				setResults((current) => ({...current, [id]: next}));
			} catch (cause) {
				setResults((current) => ({
					...current,
					[id]: {
						boards: current[id]?.boards ?? [],
						state: "通信エラー",
						error: errorMessage(cause),
					},
				}));
			} finally {
				activeIds.current.delete(id);
				setLoadingIds((current) => current.filter((active) => active !== id));
			}
		},
		[],
	);

	useEffect(() => {
		if (selectedRecord) void load(selectedRecord);
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
						onChange={(event) => setSelected(event.target.value)}
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
					disabled={!selectedRecord || selectedLoading}
					onClick={() => selectedRecord && void load(selectedRecord, true)}
				>
					{selectedLoading ? "取得中…" : "再取得"}
				</button>
			</div>
			{mappingsError && <Callout tone='error'>{mappingsError}</Callout>}
			{selectedResult?.error && (
				<Callout tone='error'>{selectedResult.error}</Callout>
			)}
			{selectedResult && (
				<p className='muted'>
					{selectedResult.state}
					{selectedResult.boards[0]
						? ` · 最終取得 ${formatRaceInstant(selectedResult.boards[0].fetchedAt)}`
						: ""}
				</p>
			)}
			{!records.length && !selectedResult?.error && (
				<p className='muted'>Category Mappingがありません。</p>
			)}
			{selectedResult?.boards.map((board) => (
				<div
					className='subpanel'
					key={board.mapping.key}
				>
					<h3>
						{board.mapping.game.gameName} / {board.mapping.label}
					</h3>
					{board.state === "error" ? (
						<Callout tone='error'>
							{board.message ?? "この条件のLeaderboardを取得できませんでした。"}
							{board.stale ? " · 古いキャッシュを表示中" : ""}
						</Callout>
					) : board.state === "not_found" ? (
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
															{` · PB ${player.personalBest.state === "found" && player.personalBest.run ? `${formatRaceTime(player.personalBest.run.time)}${player.personalBest.place === null ? "" : ` · ${player.personalBest.place}位`}` : player.personalBest.state === "not_found" ? "記録なし" : player.personalBest.state === "error" ? "取得失敗" : "未連携"}`}
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
