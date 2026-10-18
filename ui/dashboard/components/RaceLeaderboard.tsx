import type {SpeedrunLeaderboard} from "@nanahuse/racetime-protocol";
import {useEffect, useRef, useState} from "react";
import {errorMessage, request} from "../api/client";
import {formatRaceInstant, formatSpeedrunTime} from "../model/race-time";
import {Callout} from "./common";

type Result = {
	key: string;
	requestId: string;
	boards: SpeedrunLeaderboard[];
	state: string;
	error: string | null;
	stale: boolean;
};

export function RaceLeaderboard({
	categorySlug,
	goal,
	mappingRevision,
}: {
	categorySlug: string;
	goal: string;
	mappingRevision: number;
}) {
	const key = `${categorySlug}\u0000${goal}`;
	const displayKey = `${key}\u0000${mappingRevision}`;
	const [result, setResult] = useState<Result | null>(null);
	const [loading, setLoading] = useState(false);
	const [requestRevision, setRequestRevision] = useState(0);
	const refreshNext = useRef<string | null>(null);
	const requestId = `${displayKey}\u0000${requestRevision}`;
	const visible = result?.key === displayKey ? result : null;

	useEffect(() => {
		let active = true;
		const refresh = refreshNext.current === displayKey;
		refreshNext.current = null;
		setLoading(true);
		void request("getSpeedrunLeaderboards", {
			categorySlug,
			goal,
			refresh,
		})
			.then((response) => {
				if (!active) return;
				if (response.status === "unregistered") {
					setResult({
						key: displayKey,
						requestId,
						boards: [],
						state: "マッピング未登録",
						error: null,
						stale: false,
					});
				} else if (response.status === "inconsistent") {
					setResult({
						key: displayKey,
						requestId,
						boards: [],
						state: "マッピング不整合",
						error: response.message,
						stale: false,
					});
				} else {
					setResult({
						key: displayKey,
						requestId,
						boards: response.leaderboards ?? [],
						state: response.stale ? "古いキャッシュを表示中" : "取得済み",
						error: null,
						stale: response.stale ?? false,
					});
				}
			})
			.catch((cause) => {
				if (active)
					setResult((current) =>
						current?.key === displayKey
							? {
									...current,
									requestId,
									state: "再取得に失敗しました",
									error: errorMessage(cause),
									stale: current.boards.length > 0,
								}
							: {
									key: displayKey,
									requestId,
									boards: [],
									state: "通信エラー",
									error: errorMessage(cause),
									stale: false,
								},
					);
			})
			.finally(() => {
				if (active) {
					setLoading(false);
				}
			});
		return () => {
			active = false;
		};
	}, [categorySlug, goal, displayKey, requestId]);

	return (
		<section className='race-leaderboard'>
			<div className='toolbar'>
				<h3>Speedrun.com Leaderboard</h3>
				<button
					type='button'
					aria-label='Leaderboard再取得'
					disabled={loading}
					onClick={() => {
						refreshNext.current = displayKey;
						setRequestRevision((current) => current + 1);
					}}
				>
					{loading ? "取得中…" : "再取得"}
				</button>
			</div>
			{loading && <p className='muted'>Leaderboardを取得中…</p>}
			{visible?.state && <p className='muted'>{visible.state}</p>}
			{visible?.error && (
				<Callout tone='error'>
					{visible.error}
					{visible.stale && " · 古いLeaderboardを表示中"}
				</Callout>
			)}
			{visible?.state === "取得済み" && visible.boards.length === 0 && (
				<p className='muted'>該当する記録はありません。</p>
			)}
			{visible?.boards.map((board) => (
				<div
					className='subpanel'
					key={board.mapping.key}
				>
					<div className='toolbar'>
						<h4>
							{board.mapping.game.gameName} / {board.mapping.label}
						</h4>
						<small className='muted'>
							最終取得 {formatRaceInstant(board.fetchedAt)}
							{board.stale ? " · 古いキャッシュ" : ""}
						</small>
					</div>
					{board.state === "error" ? (
						<Callout tone='error'>
							{board.message ?? "この条件のLeaderboardを取得できませんでした。"}
							{board.stale ? " · 古いキャッシュを表示中" : ""}
						</Callout>
					) : board.state === "not_found" ? (
						<p className='muted'>該当する記録はありません。</p>
					) : (
						<div className='table-scroll'>
							<table className='leaderboard'>
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
													{formatSpeedrunTime(run.time)}
												</a>
											</td>
											<td>{run.date ?? "—"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			))}
		</section>
	);
}
