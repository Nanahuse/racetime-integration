import {
	parseRaceDuration,
	type RaceInstant,
	type ResolvedCategoryMapping,
	type SpeedrunPersonalBestRun,
	type SpeedrunPlayerBest,
	serializeRaceInstant,
	Temporal,
} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "./errors";
import type {ParticipantResolver} from "./integrations/players";
import type {SpeedrunClient} from "./integrations/speedrun/client";
import type {MappingService} from "./mappings";
import {expandCategoryMapping} from "./resolve";

type Resolution =
	| {
			status: "resolved";
			mappings: ResolvedCategoryMapping[];
			obsoletesVariableIds: string[];
	  }
	| {status: "unregistered"}
	| {status: "inconsistent"; message: string};
type RecordCacheEntry = {
	expiresAt: RaceInstant;
	value: unknown;
	accountIds?: readonly string[];
};
const RECORD_CACHE_TTL_MS = 5 * 60 * 1000;

function compareTime(
	a: SpeedrunPersonalBestRun,
	b: SpeedrunPersonalBestRun,
): number {
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
		if (
			!refresh &&
			previous &&
			Temporal.Instant.compare(previous.expiresAt, Temporal.Now.instant()) > 0
		)
			return {value: previous.value as T, stale: false};
		const active = this.pending.get(key);
		if (active) return active as Promise<{value: T; stale: boolean}>;
		const request = load()
			.then((value) => {
				this.cache.set(key, {
					expiresAt: Temporal.Now.instant().add({
						milliseconds: RECORD_CACHE_TTL_MS,
					}),
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
		const definitions = await this.speedrun.getCategoryVariables(
			source.category.categoryId,
		);
		const obsoletesVariableIds = definitions
			.filter(({obsoletes}) => obsoletes)
			.map(({id}) => id);
		const expanded = expandCategoryMapping(
			source.game,
			source.category,
			definitions,
			source.maxResolvedMappings,
		);
		if (!expanded.ok && expanded.status === "limit_exceeded")
			throw new IntegrationError("expansion_limit_exceeded", expanded.message);
		return expanded.ok
			? {status: "resolved", mappings: expanded.mappings, obsoletesVariableIds}
			: {status: "inconsistent", message: expanded.message};
	}

	private async bestForSrcUser(
		userId: string,
		mapping: ResolvedCategoryMapping,
		obsoletesVariableIds: readonly string[],
		refresh: boolean,
	): Promise<SpeedrunPlayerBest> {
		try {
			const result = await this.cached(
				`pb:${userId}:${mapping.key}`,
				refresh,
				async () => {
					const missingVariable = obsoletesVariableIds.find((variableId) => {
						const value = mapping.category.variables[variableId];
						return (
							value === undefined ||
							(typeof value === "string" && !value.trim())
						);
					});
					if (missingVariable)
						throw new Error(
							`PB-defining Variable "${missingVariable}" is not mapped`,
						);
					if (!this.speedrun.getUserPersonalBests)
						throw new Error("Speedrun.com Personal Bests API is unavailable");
					const personalBests = await this.speedrun.getUserPersonalBests(
						userId,
						mapping.game.gameId,
						refresh,
					);
					const matches = personalBests.filter(
						({gameId, categoryId, levelId, variables}) =>
							gameId === mapping.game.gameId &&
							categoryId === mapping.category.categoryId &&
							levelId === mapping.category.levelId &&
							obsoletesVariableIds.every(
								(variableId) =>
									variables[variableId] ===
									mapping.category.variables[variableId],
							),
					);
					if (matches.length > 1)
						throw new Error(
							"Speedrun.com returned multiple Personal Bests for the same PB-defining Variables",
						);
					return {
						run: matches[0] ?? null,
						fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
					};
				},
			);
			const run = result.value.run;
			return {
				playerId: null,
				srcUserId: userId,
				state: run ? "found" : "not_found",
				run,
				place: run?.place ?? null,
				fetchedAt: result.value.fetchedAt,
				stale: result.stale,
			};
		} catch (error) {
			return {
				playerId: null,
				srcUserId: userId,
				state: "error",
				run: null,
				place: null,
				fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
				stale: false,
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private savePlayerBest(
		key: string,
		value: SpeedrunPlayerBest,
		accountIds: readonly string[],
	): void {
		this.cache.set(key, {
			expiresAt: Temporal.Now.instant().add({
				milliseconds: RECORD_CACHE_TTL_MS,
			}),
			value,
			accountIds: [...accountIds].sort(),
		});
	}

	private stalePlayerBest(
		key: string,
		accountIds: readonly string[],
	): SpeedrunPlayerBest | null {
		const previous = this.cache.get(key);
		const sameAccounts =
			previous &&
			JSON.stringify(previous.accountIds ?? []) ===
				JSON.stringify([...accountIds].sort());
		return previous && sameAccounts
			? {...(previous.value as SpeedrunPlayerBest), stale: true}
			: null;
	}

	async leaderboards(categorySlug: string, goal: string, refresh = false) {
		const resolution = await this.resolve(categorySlug, goal);
		if (resolution.status !== "resolved") return resolution;
		const top = this.getLeaderboardTop();
		const results = await Promise.all(
			resolution.mappings.map(async (mapping) => {
				try {
					return await this.cached(
						`leaderboard:${mapping.key}:${top}`,
						refresh,
						() => {
							if (!this.speedrun.getLeaderboard)
								throw new Error("Speedrun.com leaderboard API is unavailable");
							return this.speedrun.getLeaderboard(mapping, top, refresh);
						},
					);
				} catch (error) {
					return {
						value: {
							mapping,
							top,
							fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
							state: "error" as const,
							entries: [],
							stale: false,
							message: error instanceof Error ? error.message : String(error),
						},
						stale: false,
					};
				}
			}),
		);
		const userIds = results.flatMap(({value}) =>
			value.entries.flatMap(({run}) =>
				run.players.flatMap((player) => (player.userId ? [player.userId] : [])),
			),
		);
		const displayNames = await this.players
			.speedrunDisplayNames(userIds)
			.catch(() => new Map<string, string>());
		const leaderboards = results.map(({value, stale}, index) => ({
			...value,
			mapping: resolution.mappings[index]!,
			stale,
			entries: value.entries.map((entry) => ({
				...entry,
				run: {
					...entry.run,
					players: entry.run.players.map((player) => ({
						...player,
						...(player.userId && displayNames.has(player.userId)
							? {displayName: displayNames.get(player.userId)}
							: {}),
					})),
				},
			})),
		}));
		return {
			status: "resolved" as const,
			mappings: resolution.mappings,
			leaderboards,
			top,
			fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
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
							return {
								playerId,
								srcUserId: null,
								state: "error",
								run: null,
								place: null,
								fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
								stale: false,
								message: accountError,
							};
						const accounts = accountMap.get(playerId);
						if (!accounts?.length) {
							const unlinked: SpeedrunPlayerBest = {
								playerId,
								srcUserId: null,
								state: accountMap.has(playerId) ? "unlinked" : "error",
								run: null,
								place: null,
								fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
								stale: false,
								...(accountMap.has(playerId)
									? {}
									: {message: "Player was not found in Player Manager"}),
							};
							this.savePlayerBest(playerCacheKey, unlinked, []);
							return unlinked;
						}
						try {
							const candidates = await Promise.all(
								[...new Set(accounts)].map((id) =>
									this.bestForSrcUser(
										id,
										mapping,
										resolution.obsoletesVariableIds,
										refresh,
									),
								),
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
									this.stalePlayerBest(playerCacheKey, accounts) ?? {
										playerId,
										srcUserId: best?.srcUserId ?? accounts[0] ?? null,
										state: "error",
										run: null,
										place: null,
										fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
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
								place: best?.run.place ?? null,
								fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
								stale: candidates.some((candidate) => candidate.stale),
							};
							this.savePlayerBest(playerCacheKey, resolved, accounts);
							return resolved;
						} catch (error) {
							return (
								this.stalePlayerBest(playerCacheKey, accounts) ?? {
									playerId,
									srcUserId: accounts[0] ?? null,
									state: "error",
									run: null,
									place: null,
									fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
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
			fetchedAt: serializeRaceInstant(Temporal.Now.instant()),
			stale: results.some((result) =>
				result.players.some((player) => player.stale),
			),
		};
	}
}
