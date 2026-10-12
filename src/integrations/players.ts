import {
	API_VERSION,
	type PlayerManagerAPI,
	resolveDisplayName,
} from "@nanahuse/player-manager-protocol";
import type {Entrant, Participant} from "@nanahuse/racetime-protocol";

export type ResolutionBatch = {
	participants: Participant[];
	directoryRevision: number | null;
};
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
				throw new Error("Player Manager v2 is unavailable");
			const work = async (): Promise<ResolutionBatch> => {
				await api.ready;
				for (let attempt = 0; attempt < 3; attempt++) {
					if (expired) throw new Error("Player Manager timed out");
					const before = await api.request("list", undefined);
					if (!before.ok) throw new Error(before.error.message);
					const participants: Participant[] = [];
					for (const entrant of entrants) {
						if (expired) throw new Error("Player Manager timed out");
						const found = await api.request("find", {
							provider: "racetime",
							value: entrant.userId,
						});
						if (!found.ok) throw new Error(found.error.message);
						const player = found.data;
						participants.push({
							racetimeUserId: entrant.userId,
							status: player ? "matched" : "unresolved",
							playerId: player?.playerId ?? null,
							player: player
								? {
										playerId: player.playerId,
										revision: player.revision,
										displayName: resolveDisplayName(player),
										racetime: player.racetime,
										speedrunCom: player.speedrunCom,
										twitch: player.twitch,
										youtube: player.youtube,
									}
								: null,
							message: player
								? ""
								: "No Player is linked to this RaceTime account",
						});
					}
					if (expired) throw new Error("Player Manager timed out");
					const after = await api.request("list", undefined);
					if (!after.ok) throw new Error(after.error.message);
					if (before.data.revision === after.data.revision)
						return {
							participants: structuredClone(participants),
							directoryRevision: after.data.revision,
						};
				}
				throw new Error(
					"Player directory changed repeatedly during resolution",
				);
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
