import {
	parseRaceDuration,
	type ResolvedCategoryMapping,
	type SpeedrunPlayerBest,
	type SpeedrunRun,
	Temporal,
} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "./errors";
import type {ParticipantResolver} from "./integrations/players";
import type {SpeedrunClient} from "./integrations/speedrun/client";
import type {MappingService} from "./mappings";
import {anyVariableIds, expandCategoryMapping} from "./resolve";

type Resolution =
	| {status: "resolved"; mappings: ResolvedCategoryMapping[]}
	| {status: "unregistered"}
	| {status: "inconsistent"; message: string};
type RecordCacheEntry = {expiresAt: number; value: unknown};
const RECORD_CACHE_TTL_MS = 5 * 60 * 1000;

function compareTime(a: SpeedrunRun, b: SpeedrunRun): number {
	const aTime = parseRaceDuration(a.time);
	const bTime = parseRaceDuration(b.time);
	if (!aTime || !bTime) throw new Error("Speedrun.com run had no time");
	return Temporal.Duration.compare(aTime, bTime);
}

export class SpeedrunRecordService {
	private readonly cache = new Map<string, RecordCacheEntry>();
	private readonly pending = new Map<string, Promise<unknown>>();
	constructor(
		private readonly mappings: MappingService,
		private readonly speedrun: SpeedrunClient,
		private readonly players: ParticipantResolver,
		private readonly getLeaderboardTop: () => number,
	) {}

	private async cached<T>(
		key: string,
		refresh: boolean,
		load: () => Promise<T>,
	): Promise<{value: T; stale: boolean}> {
		const previous = this.cache.get(key);
		if (!refresh && previous && previous.expiresAt > Date.now())
			return {value: previous.value as T, stale: false};
		const active = this.pending.get(key);
		if (active) return active as Promise<{value: T; stale: boolean}>;
		const request = load()
			.then((value) => {
				this.cache.set(key, {
					expiresAt: Date.now() + RECORD_CACHE_TTL_MS,
					value,
				});
				return {value, stale: false};
			})
			.catch((error) => {
				if (previous) return {value: previous.value as T, stale: true};
				throw error;
			})
			.finally(() => this.pending.delete(key));
		this.pending.set(key, request);
		return request;
	}

	private async resolve(
		categorySlug: string,
		goal: string,
	): Promise<Resolution> {
		const source = await this.mappings.resolveSource(categorySlug, goal);
		if (source.status !== "found") return source;
		const definitions = anyVariableIds(source.category.variables).length
			? await this.speedrun.getCategoryVariables(source.category.categoryId)
			: [];
		const expanded = expandCategoryMapping(
			source.game,
			source.category,
			definitions,
			source.maxResolvedMappings,
		);
		if (!expanded.ok && expanded.status === "limit_exceeded")
			throw new IntegrationError("expansion_limit_exceeded", expanded.message);
		return expanded.ok
			? {status: "resolved", mappings: expanded.mappings}
			: {status: "inconsistent", message: expanded.message};
	}

	private async bestForSrcUser(
		userId: string,
		mapping: ResolvedCategoryMapping,
		refresh: boolean,
	): Promise<SpeedrunPlayerBest> {
		try {
			const result = await this.cached(
				`pb:${userId}:${mapping.key}`,
				refresh,
				async () => {
					if (!this.speedrun.getUserPersonalBests)
						throw new Error("Speedrun.com Personal Bests API is unavailable");
					try {
						return {
							runs: await this.speedrun.getUserPersonalBests(userId, mapping),
							fetchedAt: new Date().toISOString(),
						};
					} catch (pbError) {
						if (!this.speedrun.getUserRuns || !this.speedrun.getLeaderboard)
							throw pbError;
						const runs = await this.speedrun.getUserRuns(userId, mapping);
						if (runs.length === 0)
							return {runs: [], fetchedAt: new Date().toISOString()};
						const leaderboard = await this.speedrun.getLeaderboard(
							mapping,
							this.getLeaderboardTop(),
						);
						const confirmedRunIds = new Set(
							leaderboard.entries
								.filter((entry) =>
									entry.run.players.some((player) => player.userId === userId),
								)
								.map((entry) => entry.run.runId),
						);
						const confirmed = runs.filter((run) =>
							confirmedRunIds.has(run.runId),
						);
						if (confirmed.length === 0)
							throw new Error(
								`Could not verify ${userId}'s runs against the filtered leaderboard`,
							);
						return {
							runs: confirmed,
							fetchedAt: new Date().toISOString(),
						};
					}
				},
			);
			const run = [...result.value.runs].sort(compareTime)[0] ?? null;
			return {
				playerId: null,
				srcUserId: userId,
				state: run ? "found" : "not_found",
				run,
				fetchedAt: result.value.fetchedAt,
				stale: result.stale,
			};
		} catch (error) {
			return {
				playerId: null,
				srcUserId: userId,
				state: "error",
				run: null,
				fetchedAt: new Date().toISOString(),
				stale: false,
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private savePlayerBest(key: string, value: SpeedrunPlayerBest): void {
		this.cache.set(key, {
			expiresAt: Date.now() + RECORD_CACHE_TTL_MS,
			value,
		});
	}

	private stalePlayerBest(key: string): SpeedrunPlayerBest | null {
		const previous = this.cache.get(key);
		return previous
			? {...(previous.value as SpeedrunPlayerBest), stale: true}
			: null;
	}

	async leaderboards(categorySlug: string, goal: string, refresh = false) {
		const resolution = await this.resolve(categorySlug, goal);
		if (resolution.status !== "resolved") return resolution;
		const top = this.getLeaderboardTop();
		if (refresh) this.speedrun.clearRecordCache?.();
		const results = await Promise.all(
			resolution.mappings.map(async (mapping) =>
				this.cached(`leaderboard:${mapping.key}:${top}`, refresh, () => {
					if (!this.speedrun.getLeaderboard)
						throw new Error("Speedrun.com leaderboard API is unavailable");
					return this.speedrun.getLeaderboard(mapping, top);
				}),
			),
		);
		const userIds = results.flatMap(({value}) =>
			value.entries.flatMap(({run}) =>
				run.players.flatMap((player) => (player.userId ? [player.userId] : [])),
			),
		);
		const displayNames = await this.players
			.speedrunDisplayNames(userIds)
			.catch(() => new Map<string, string>());
		const leaderboards = await Promise.all(
			results.map(async ({value, stale}, index) => {
				const mapping = resolution.mappings[index]!;
				const sourceIds = [
					...new Set(
						value.entries.flatMap(({run}) =>
							run.players.flatMap((player) =>
								player.userId ? [player.userId] : [],
							),
						),
					),
				];
				const bests = new Map(
					await Promise.all(
						sourceIds.map(
							async (userId) =>
								[
									userId,
									await this.bestForSrcUser(userId, value.mapping, refresh),
								] as const,
						),
					),
				);
				return {
					...value,
					mapping,
					entries: value.entries.map((entry) => ({
						...entry,
						run: {
							...entry.run,
							players: entry.run.players.map((player) => ({
								...player,
								...(player.userId && displayNames.has(player.userId)
									? {displayName: displayNames.get(player.userId)}
									: {}),
								...(player.userId && bests.has(player.userId)
									? {personalBest: bests.get(player.userId)}
									: {}),
							})),
						},
					})),
					stale: stale || sourceIds.some((id) => bests.get(id)?.stale === true),
				};
			}),
		);
		return {
			status: "resolved" as const,
			mappings: resolution.mappings,
			leaderboards,
			top,
			fetchedAt: new Date().toISOString(),
			stale: leaderboards.some((leaderboard) => leaderboard.stale),
		};
	}

	async playerBests(
		categorySlug: string,
		goal: string,
		playerIds: readonly string[],
		refresh = false,
	) {
		const resolution = await this.resolve(categorySlug, goal);
		if (resolution.status !== "resolved") return resolution;
		if (refresh) this.speedrun.clearRecordCache?.();
		let accountMap = new Map<string, string[]>();
		let accountError: string | null = null;
		try {
			accountMap = await this.players.speedrunAccounts(playerIds);
		} catch (error) {
			accountError = error instanceof Error ? error.message : String(error);
		}
		const results = await Promise.all(
			resolution.mappings.map(async (mapping) => {
				const players = await Promise.all(
					playerIds.map(async (playerId): Promise<SpeedrunPlayerBest> => {
						const playerCacheKey = `player:${playerId}:${mapping.key}`;
						if (accountError)
							return (
								this.stalePlayerBest(playerCacheKey) ?? {
									playerId,
									srcUserId: null,
									state: "error",
									run: null,
									fetchedAt: new Date().toISOString(),
									stale: false,
									message: accountError,
								}
							);
						const accounts = accountMap.get(playerId);
						if (!accounts?.length) {
							const unlinked: SpeedrunPlayerBest = {
								playerId,
								srcUserId: null,
								state: accountMap.has(playerId) ? "unlinked" : "error",
								run: null,
								fetchedAt: new Date().toISOString(),
								stale: false,
								...(accountMap.has(playerId)
									? {}
									: {message: "Player was not found in Player Manager"}),
							};
							this.savePlayerBest(playerCacheKey, unlinked);
							return unlinked;
						}
						try {
							const candidates = await Promise.all(
								accounts.map((id) => this.bestForSrcUser(id, mapping, refresh)),
							);
							const candidateRuns = candidates.flatMap((candidate) =>
								candidate.run
									? [{run: candidate.run, srcUserId: candidate.srcUserId}]
									: [],
							);
							candidateRuns.sort((a, b) => compareTime(a.run, b.run));
							const best = candidateRuns[0] ?? null;
							if (candidates.some((candidate) => candidate.state === "error"))
								return (
									this.stalePlayerBest(playerCacheKey) ?? {
										playerId,
										srcUserId: best?.srcUserId ?? accounts[0] ?? null,
										state: "error",
										run: null,
										fetchedAt: new Date().toISOString(),
										stale: false,
										message:
											"At least one linked Speedrun.com account could not be checked",
									}
								);
							const resolved: SpeedrunPlayerBest = {
								playerId,
								srcUserId: best?.srcUserId ?? accounts[0] ?? null,
								state: best ? "found" : "not_found",
								run: best?.run ?? null,
								fetchedAt: new Date().toISOString(),
								stale: candidates.some((candidate) => candidate.stale),
							};
							this.savePlayerBest(playerCacheKey, resolved);
							return resolved;
						} catch (error) {
							return (
								this.stalePlayerBest(playerCacheKey) ?? {
									playerId,
									srcUserId: accounts[0] ?? null,
									state: "error",
									run: null,
									fetchedAt: new Date().toISOString(),
									stale: false,
									message:
										error instanceof Error ? error.message : String(error),
								}
							);
						}
					}),
				);
				return {mapping, players};
			}),
		);
		return {
			status: "resolved" as const,
			mappings: resolution.mappings,
			results,
			fetchedAt: new Date().toISOString(),
			stale: results.some((result) =>
				result.players.some((player) => player.stale),
			),
		};
	}
}
