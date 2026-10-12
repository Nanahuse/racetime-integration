import {randomUUID} from "node:crypto";
import type {
	Participant,
	Race,
	RaceState,
	RacesState,
} from "@nanahuse/racetime-protocol";
import type {ParticipantResolver} from "./integrations/players";
import type {RaceTimeClient} from "./integrations/racetime/client";
import {RaceTimeAbortedError} from "./integrations/racetime/errors";
import {mapRace} from "./integrations/racetime/mapper";
import {canonicalizeRaceUrl} from "./integrations/racetime/url";
import {
	RaceWatcher,
	type Socket,
	type TransportState,
} from "./integrations/racetime/watcher";

type Session = {
	watcher: RaceWatcher;
	state: RaceState;
	watches: Set<string>;
	ready: Promise<void> | null;
	identityKey: string;
	generation: number;
	requested: boolean;
	resolving: Promise<void> | null;
	controller: AbortController | null;
};
export class RaceService {
	private readonly sessions = new Map<string, Session>();
	private readonly watches = new Map<string, string>();
	private disposed = false;
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
	getWatch(watchId: string): RaceState | null {
		const url = this.watches.get(watchId);
		return url ? this.get(url) : null;
	}
	async fetch(url: string): Promise<Race> {
		const canonical = canonicalizeRaceUrl(url);
		return mapRace(
			await this.client.fetchRaceDetail(canonical),
			canonical.canonicalUrl,
		);
	}

	async watch(
		url: string,
	): Promise<{watchId: string; state: RaceState & {race: Race}}> {
		if (this.disposed) throw new RaceTimeAbortedError("Race service stopped");
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
				state: {
					...watcher.snapshot(),
					revision: 0,
					raceRevision: 0,
					participantsRevision: 0,
					participants: [],
					resolution: {
						state: "idle",
						raceRevision: null,
						directoryRevision: null,
					},
				},
				watches: new Set(),
				ready: null,
				identityKey: "",
				generation: 0,
				requested: false,
				resolving: null,
				controller: null,
			};
			this.sessions.set(canonical.canonicalUrl, session);
		}
		const watchId = randomUUID();
		session.watches.add(watchId);
		this.watches.set(watchId, canonical.canonicalUrl);
		session.ready ??= session.watcher.start();
		try {
			await session.ready;
			if (
				this.disposed ||
				this.sessions.get(canonical.canonicalUrl) !== session ||
				!session.state.race
			)
				throw new RaceTimeAbortedError("Watch cancelled during initial fetch");
			return {
				watchId,
				state: structuredClone({...session.state, race: session.state.race}),
			};
		} catch (error) {
			this.unwatch(watchId);
			throw error;
		}
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
				session.controller?.abort();
				this.sessions.delete(url);
				this.publish(this.snapshot());
			}
		}
		return true;
	}

	async resolve(url: string): Promise<Participant[]> {
		const canonical = canonicalizeRaceUrl(url);
		const session = this.sessions.get(canonical.canonicalUrl);
		if (!session)
			return (await this.players.resolve((await this.fetch(url)).entrants))
				.participants;
		await session.ready;
		if (this.sessions.get(canonical.canonicalUrl) !== session)
			throw new RaceTimeAbortedError("Watch released before resolution");
		await this.requestResolution(session);
		return structuredClone(session.state.participants);
	}

	directoryChanged(revision: number): void {
		// Player Manager v3 may change Directory contents without bumping the
		// revision, so any well-formed notification re-resolves monitored races.
		if (!Number.isSafeInteger(revision) || revision < 0 || this.disposed)
			return;
		for (const session of this.sessions.values())
			if (session.state.race) void this.requestResolution(session);
	}

	dispose(): void {
		this.disposed = true;
		for (const session of this.sessions.values()) {
			session.watcher.stop();
			session.controller?.abort();
		}
		this.sessions.clear();
		this.watches.clear();
		this.publish(this.snapshot());
	}

	private emit(session: Session): void {
		session.state.revision++;
		this.publish(this.snapshot());
	}
	private requestResolution(session: Session): Promise<void> {
		if (!session.state.race || this.sessions.get(session.state.url) !== session)
			return Promise.resolve();
		session.generation++;
		session.controller?.abort();
		session.requested = true;
		session.state.resolution = {...session.state.resolution, state: "pending"};
		this.emit(session);
		session.resolving ??= this.runResolution(session);
		return session.resolving;
	}
	private async runResolution(session: Session): Promise<void> {
		try {
			while (
				session.requested &&
				this.sessions.get(session.state.url) === session
			) {
				session.requested = false;
				const generation = session.generation;
				const race = session.state.race;
				if (!race) return;
				const controller = new AbortController();
				session.controller = controller;
				const result = await this.players.resolve(
					race.entrants,
					controller.signal,
				);
				session.controller = null;
				if (this.sessions.get(session.state.url) !== session) return;
				if (generation !== session.generation) continue;
				session.state.participants = result.participants;
				session.state.participantsRevision++;
				session.state.resolution = {
					state: result.directoryRevision === null ? "error" : "ready",
					raceRevision: session.state.raceRevision,
					directoryRevision: result.directoryRevision,
				};
				this.emit(session);
			}
		} finally {
			session.resolving = null;
		}
	}
	private update(
		url: string,
		watcher: RaceWatcher,
		state: TransportState,
	): void {
		const session = this.sessions.get(url);
		if (!session || session.watcher !== watcher) return;
		const changed =
			JSON.stringify(state.race) !== JSON.stringify(session.state.race);
		const identityKey = JSON.stringify(
			state.race?.entrants.map(({userId}) => userId).sort() ?? [],
		);
		Object.assign(session.state, state);
		if (changed) session.state.raceRevision++;
		if (state.race && session.identityKey !== identityKey) {
			session.identityKey = identityKey;
			session.state.participants = state.race.entrants.map((entrant) => ({
				racetimeUserId: entrant.userId,
				status: "unresolved",
				playerId: null,
				player: null,
				message: "Resolution pending",
			}));
			void this.requestResolution(session);
		} else if (session.state.resolution.state === "ready") {
			session.state.resolution.raceRevision = session.state.raceRevision;
		}
		this.emit(session);
	}
}
