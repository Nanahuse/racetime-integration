import {randomUUID} from "node:crypto";
import type {
	Participant,
	RaceState,
	RacesState,
} from "@nanahuse/racetime-protocol";
import type {ParticipantResolver} from "./integrations/players";
import type {RaceTimeClient} from "./integrations/racetime/client";
import {mapRace} from "./integrations/racetime/mapper";
import {canonicalizeRaceUrl} from "./integrations/racetime/url";
import {RaceWatcher, type Socket} from "./integrations/racetime/watcher";

type Session = {
	watcher: RaceWatcher;
	state: RaceState;
	watches: Set<string>;
	identityKey: string;
	resolution: number;
};
export class RaceService {
	private readonly sessions = new Map<string, Session>();
	private readonly watches = new Map<string, string>();

	constructor(
		private readonly client: RaceTimeClient,
		private readonly socketFactory: (url: string) => Socket,
		private readonly players: ParticipantResolver,
		private readonly publish: (state: RacesState) => void,
	) {}

	snapshot(): RacesState {
		return {
			schemaVersion: 1,
			races: [...this.sessions.values()].map((s) => structuredClone(s.state)),
		};
	}
	get(url: string): RaceState | null {
		return structuredClone(
			this.sessions.get(canonicalizeRaceUrl(url).canonicalUrl)?.state ?? null,
		);
	}

	async fetch(url: string) {
		const canonical = canonicalizeRaceUrl(url);
		return mapRace(
			await this.client.fetchRaceDetail(canonical),
			canonical.canonicalUrl,
		);
	}

	watch(url: string): {watchId: string; state: RaceState} {
		const canonical = canonicalizeRaceUrl(url);
		let session = this.sessions.get(canonical.canonicalUrl);
		if (!session) {
			const watcher = new RaceWatcher({
				client: this.client,
				canonical,
				socketFactory: this.socketFactory,
				onUpdate: (state) =>
					this.update(canonical.canonicalUrl, watcher, state),
			});
			session = {
				watcher,
				state: watcher.snapshot(),
				watches: new Set(),
				identityKey: "",
				resolution: 0,
			};
			this.sessions.set(canonical.canonicalUrl, session);
		}
		const watchId = randomUUID();
		session.watches.add(watchId);
		this.watches.set(watchId, canonical.canonicalUrl);
		this.publish(this.snapshot());
		session.watcher.start();
		return {watchId, state: structuredClone(session.state)};
	}

	unwatch(watchId: string): boolean {
		const url = this.watches.get(watchId);
		if (!url) return false;
		this.watches.delete(watchId);
		const session = this.sessions.get(url);
		if (session) {
			session.watches.delete(watchId);
			if (!session.watches.size) {
				session.watcher.stop();
				this.sessions.delete(url);
				this.publish(this.snapshot());
			}
		}
		return true;
	}

	async resolve(url: string): Promise<Participant[]> {
		const canonical = canonicalizeRaceUrl(url);
		const session = this.sessions.get(canonical.canonicalUrl);
		const sequence = session ? ++session.resolution : 0;
		const race = session?.state.race ?? (await this.fetch(url));
		const result = await this.players.resolve(race.entrants);
		if (
			session &&
			this.sessions.get(canonical.canonicalUrl) === session &&
			sequence === session.resolution
		) {
			session.state.participants = result;
			this.publish(this.snapshot());
		}
		return structuredClone(result);
	}

	dispose(): void {
		for (const session of this.sessions.values()) session.watcher.stop();
		this.sessions.clear();
		this.watches.clear();
		this.publish(this.snapshot());
	}

	private update(url: string, watcher: RaceWatcher, state: RaceState): void {
		const session = this.sessions.get(url);
		if (!session || session.watcher !== watcher) return;
		const identityKey = JSON.stringify(
			state.race?.entrants
				.map(({userId, name, twitchLogin}) => [userId, name, twitchLogin])
				.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")) ?? [],
		);
		session.state = {...state, participants: session.state.participants};
		if (state.race && session.identityKey !== identityKey) {
			session.identityKey = identityKey;
			session.state.participants = [];
			void this.resolve(url);
		}
		this.publish(this.snapshot());
	}
}
