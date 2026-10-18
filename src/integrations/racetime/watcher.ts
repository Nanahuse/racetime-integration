import type {RaceState} from "@nanahuse/racetime-protocol";
import {parseRaceDetailForRace, type RaceTimeClient} from "./client";
import {RaceTimeAbortedError} from "./errors";
import {mapRace} from "./mapper";
import {type CanonicalRaceUrl, resolveWebSocketUrl} from "./url";

export type Socket = {
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	close(): void;
};
export type WatcherOptions = {
	client: RaceTimeClient;
	canonical: CanonicalRaceUrl;
	socketFactory: (url: string) => Socket;
	onUpdate: (state: TransportState) => void;
	backoffMs?: readonly number[];
	connectTimeoutMs?: number;
	onInvalidMessage?: (error: unknown) => void;
};

export type TransportState = Pick<
	RaceState,
	"url" | "race" | "connection" | "error"
>;
export class RaceWatcher {
	private state: TransportState;
	private stopped = false;
	private starting?: Promise<void>;
	private epoch = 0;
	private socket: Socket | null = null;
	private controller: AbortController | null = null;
	private retryTimer?: ReturnType<typeof setTimeout>;
	private connectTimer?: ReturnType<typeof setTimeout>;
	private attempt = 0;

	constructor(private readonly options: WatcherOptions) {
		this.state = {
			url: options.canonical.canonicalUrl,
			race: null,
			connection: "loading",
			error: null,
		};
	}

	snapshot(): TransportState {
		return structuredClone(this.state);
	}

	start(): Promise<void> {
		if (this.stopped)
			return Promise.reject(new RaceTimeAbortedError("Watcher stopped"));
		this.starting ??= this.load(true, true);
		return this.starting;
	}

	stop(): void {
		this.stopped = true;
		this.invalidate();
		clearTimeout(this.retryTimer);
	}

	private emit(): void {
		this.options.onUpdate(this.snapshot());
	}

	private invalidate(): void {
		this.epoch++;
		this.controller?.abort();
		this.controller = null;
		clearTimeout(this.connectTimer);
		const socket = this.socket;
		this.socket = null;
		if (socket) {
			socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
			try {
				socket.close();
			} catch {
				/* Closing a failed transport is best effort. */
			}
		}
	}

	private retry(error: unknown): void {
		if (this.stopped || this.retryTimer) return;
		this.invalidate();
		this.state.connection = "reconnecting";
		this.state.error = error instanceof Error ? error.message : String(error);
		this.emit();
		const backoff = this.options.backoffMs ?? [1000, 2000, 5000, 10000, 30000];
		const delay =
			backoff[Math.min(this.attempt++, backoff.length - 1)] ?? 30000;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined;
			void this.load(true);
		}, delay);
	}

	private async load(connect: boolean, initial = false): Promise<void> {
		const epoch = this.epoch;
		const controller = new AbortController();
		this.controller = controller;
		try {
			const dto = await this.options.client.fetchRaceDetail(
				this.options.canonical,
				controller.signal,
			);
			if (this.stopped || epoch !== this.epoch) {
				if (initial)
					throw new RaceTimeAbortedError(
						"Watcher stopped during initial fetch",
					);
				return;
			}
			if (!this.state.race || dto.version >= this.state.race.version) {
				this.state.race = mapRace(dto, this.state.url);
			}
			this.emit();
			if (connect) {
				try {
					this.connect(dto.websocketUrl);
				} catch (error) {
					this.retry(error);
				}
			}
		} catch (error) {
			if (initial) {
				this.stop();
				throw error;
			}
			if (!this.stopped && epoch === this.epoch) this.retry(error);
		} finally {
			if (epoch === this.epoch) {
				this.controller = null;
			}
		}
	}

	private connect(raw: string): void {
		const socket = this.options.socketFactory(
			resolveWebSocketUrl(raw, this.options.canonical.canonicalUrl),
		);
		this.socket = socket;
		this.state.connection = "connecting";
		this.emit();
		const current = () => !this.stopped && this.socket === socket;
		this.connectTimer = setTimeout(() => {
			if (current()) this.retry(new Error("WebSocket connection timed out"));
		}, this.options.connectTimeoutMs ?? 10000);
		socket.onopen = () => {
			if (!current()) return;
			clearTimeout(this.connectTimer);
			this.attempt = 0;
			this.state.connection = "connected";
			this.state.error = null;
			this.emit();
		};
		socket.onmessage = ({data}) => {
			if (!current() || typeof data !== "string") return;
			let message: unknown;
			try {
				message = JSON.parse(data);
			} catch {
				return;
			}
			if (
				typeof message !== "object" ||
				message === null ||
				!("type" in message) ||
				message.type !== "race.data"
			)
				return;
			try {
				if (
					!("version" in message) ||
					typeof message.version !== "number" ||
					!Number.isSafeInteger(message.version) ||
					message.version < 0 ||
					!("race" in message)
				)
					throw new Error("Invalid race.data envelope.");
				const dto = parseRaceDetailForRace(
					message.race,
					this.options.canonical,
				);
				if (message.version !== dto.version)
					throw new Error("race.data version does not match race.version.");
				if (this.state.race && dto.version < this.state.race.version) return;
				const race = mapRace(dto, this.state.url);
				if (
					this.state.race &&
					dto.version === this.state.race.version &&
					JSON.stringify(race) === JSON.stringify(this.state.race)
				)
					return;
				this.state.race = race;
				this.state.error = null;
				this.emit();
			} catch (error) {
				this.options.onInvalidMessage?.(error);
			}
		};
		socket.onclose = () => {
			if (current()) this.retry(new Error("WebSocket disconnected"));
		};
		socket.onerror = () => {
			if (current()) this.retry(new Error("WebSocket failed"));
		};
	}
}
