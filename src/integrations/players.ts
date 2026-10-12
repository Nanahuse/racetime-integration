import {
	API_VERSION,
	type Directory,
	type DirectoryAccount,
	type Player,
	type PlayerManagerAPI,
	resolveDisplayName,
} from "@nanahuse/player-manager-protocol";
import type {
	Entrant,
	Participant,
	PlayerSnapshot,
} from "@nanahuse/racetime-protocol";

export type ResolutionBatch = {
	participants: Participant[];
	directoryRevision: number | null;
};

function identityUserId(identity: DirectoryAccount["identity"]): string | null {
	if (!identity || typeof identity !== "object") return null;
	const userId = (identity as {userId?: unknown}).userId;
	return typeof userId === "string" && userId !== "" ? userId : null;
}

/**
 * Every RaceTime userId a Player is associated with, including Secondary
 * accounts. The Primary account is always included even if `accounts` omits it.
 */
function racetimeUserIds(player: Player): string[] {
	const ids: string[] = [];
	if (player.racetime?.userId) ids.push(player.racetime.userId);
	for (const account of player.accounts ?? []) {
		if (account.service !== "racetime") continue;
		const userId = identityUserId(account.identity);
		if (userId) ids.push(userId);
	}
	return ids;
}

function buildIndex(directory: Directory): {
	index: Map<string, Player>;
	ambiguous: Set<string>;
} {
	const index = new Map<string, Player>();
	const ambiguous = new Set<string>();
	for (const player of directory.players) {
		for (const userId of racetimeUserIds(player)) {
			const existing = index.get(userId);
			if (existing && existing.playerId !== player.playerId) {
				ambiguous.add(userId);
				continue;
			}
			index.set(userId, player);
		}
	}
	for (const userId of ambiguous) index.delete(userId);
	return {index, ambiguous};
}

function isDirectory(value: unknown): value is Directory {
	if (!value || typeof value !== "object") return false;
	const candidate = value as {revision?: unknown; players?: unknown};
	return (
		typeof candidate.revision === "number" && Array.isArray(candidate.players)
	);
}

function toSnapshot(player: Player): PlayerSnapshot {
	return {
		playerId: player.playerId,
		revision: player.revision,
		displayName: resolveDisplayName(player),
		racetime: player.racetime
			? {userId: player.racetime.userId, name: player.racetime.name}
			: null,
		speedrunCom: player.speedrunCom
			? {userId: player.speedrunCom.userId, name: player.speedrunCom.name}
			: null,
		twitch: player.twitch
			? {
					userId: null,
					login: player.twitch.login,
					displayName: player.twitch.displayName,
				}
			: null,
		youtube: player.youtube,
	};
}

export class ParticipantResolver {
	constructor(
		private readonly getAPI: () => PlayerManagerAPI | undefined,
		private readonly timeoutMs = 15000,
	) {}

	async resolve(
		entrants: readonly Entrant[],
		signal?: AbortSignal,
	): Promise<ResolutionBatch> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let expired = false;
		let onAbort: (() => void) | undefined;
		try {
			if (signal?.aborted) throw new Error("Participant resolution cancelled");
			const api = this.getAPI();
			if (api?.apiVersion !== API_VERSION)
				throw new Error("Player Manager v3 is unavailable");
			const work = async (): Promise<ResolutionBatch> => {
				await api.ready;
				if (expired) throw new Error("Player Manager timed out");
				const listed = await api.request("list", undefined);
				if (!listed.ok) throw new Error(listed.error.message);
				if (expired) throw new Error("Player Manager timed out");
				if (!isDirectory(listed.data))
					throw new Error("Player Manager returned an invalid directory");
				const {index, ambiguous} = buildIndex(listed.data);
				const participants: Participant[] = entrants.map((entrant) => {
					if (ambiguous.has(entrant.userId))
						return {
							racetimeUserId: entrant.userId,
							status: "unavailable",
							playerId: null,
							player: null,
							message: "RaceTime account is assigned to multiple Players",
						};
					const player = index.get(entrant.userId) ?? null;
					return {
						racetimeUserId: entrant.userId,
						status: player ? "matched" : "unresolved",
						playerId: player?.playerId ?? null,
						player: player ? toSnapshot(player) : null,
						message: player
							? ""
							: "No Player is linked to this RaceTime account",
					};
				});
				return {
					participants: structuredClone(participants),
					directoryRevision: listed.data.revision,
				};
			};
			return await Promise.race([
				work(),
				new Promise<never>((_, reject) => {
					onAbort = () => {
						expired = true;
						reject(new Error("Participant resolution cancelled"));
					};
					signal?.addEventListener("abort", onAbort, {once: true});
					timer = setTimeout(() => {
						expired = true;
						reject(new Error("Player Manager timed out"));
					}, this.timeoutMs);
				}),
			]);
		} catch (error) {
			return {
				directoryRevision: null,
				participants: entrants.map((entrant) => ({
					racetimeUserId: entrant.userId,
					status: "unavailable",
					playerId: null,
					player: null,
					message:
						error instanceof Error ? error.message : "Player Manager failed",
				})),
			};
		} finally {
			clearTimeout(timer);
			if (onAbort) signal?.removeEventListener("abort", onAbort);
		}
	}
}
