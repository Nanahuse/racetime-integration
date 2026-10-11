import type {PlayerManagerAPI} from "@nanahuse/player-manager-protocol";
import type {Entrant, Participant} from "@nanahuse/racetime-protocol";

export class ParticipantResolver {
	constructor(
		private readonly getAPI: () => PlayerManagerAPI | undefined,
		private readonly timeoutMs = 15000,
	) {}

	async resolve(entrants: readonly Entrant[]): Promise<Participant[]> {
		const api = this.getAPI();
		const results: Participant[] = [];
		// Limit concurrent provider lookups initiated through Player Manager.
		for (let offset = 0; offset < entrants.length; offset += 4) {
			results.push(
				...(await Promise.all(
					entrants
						.slice(offset, offset + 4)
						.map(async (entrant): Promise<Participant> => {
							const base = {
								racetimeUserId: entrant.userId,
								playerId: null,
								candidatePlayerIds: [],
							};
							let timer: ReturnType<typeof setTimeout> | undefined;
							try {
								if (api?.apiVersion !== 1)
									throw new Error("Player Manager v1 is unavailable");
								const result = await Promise.race([
									api.ready.then(() =>
										api.request("resolve", {
											input: {
												racetime: {
													userId: entrant.userId,
													name: entrant.name,
													twitchLogin: entrant.twitchLogin,
												},
												...(entrant.twitchLogin
													? {twitch: {login: entrant.twitchLogin}}
													: {}),
											},
										}),
									),
									new Promise<never>((_, reject) => {
										timer = setTimeout(
											() => reject(new Error("Player Manager timed out")),
											this.timeoutMs,
										);
									}),
								]);
								if (!result.ok) throw new Error(result.error.message);
								return {
									...base,
									status: result.data.status,
									playerId:
										result.data.status === "matched"
											? result.data.playerId
											: null,
									candidatePlayerIds: result.data.candidates
										.filter((c) => c.type === "player")
										.map((c) => c.playerId),
									message: result.data.message,
								};
							} catch (error) {
								return {
									...base,
									status: "unavailable",
									message:
										error instanceof Error
											? error.message
											: "Player Manager failed",
								};
							} finally {
								clearTimeout(timer);
							}
						}),
				)),
			);
		}
		return results;
	}
}
