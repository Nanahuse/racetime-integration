import type {RaceState} from "@nanahuse/racetime-protocol";
import type {RaceTimeClient} from "./client";
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
	onUpdate: (state: RaceState) => void;
	backoffMs?: readonly number[];
	connectTimeoutMs?: number;
};

export class RaceWatcher {
	private state: RaceState;
	private stopped = false;
	private started = false;
	private epoch = 0;
	private socket: Socket | null = null;
	private controller: AbortController | null = null;
	private retryTimer?: ReturnType<typeof setTimeout>;
	private connectTimer?: ReturnType<typeof setTimeout>;
	private attempt = 0;
	private refreshing = false;
	private pending = false;

	constructor(private readonly options: WatcherOptions) {
		this.state = {
			url: options.canonical.canonicalUrl,
			race: null,
			connection: "loading",
			error: null,
			participants: [],
		};
	}

	snapshot(): RaceState {
		return structuredClone(this.state);
	}

	start(): void {
		if (this.started || this.stopped) return;
		this.started = true;
		void this.load(true);
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
		this.refreshing = false;
		this.pending = false;
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

	private refresh(): void {
		if (this.stopped || this.retryTimer) return;
		if (this.refreshing) {
			this.pending = true;
			return;
		}
		void this.load(false);
	}

	private async load(connect: boolean): Promise<void> {
		const epoch = this.epoch;
		const controller = new AbortController();
		this.controller = controller;
		this.refreshing = true;
		try {
			const dto = await this.options.client.fetchRaceDetail(
				this.options.canonical,
				controller.signal,
			);
			if (this.stopped || epoch !== this.epoch) return;
			if (!this.state.race || dto.version >= this.state.race.version) {
				this.state.race = mapRace(dto, this.state.url);
			}
			this.state.error = null;
			this.emit();
			if (connect) this.connect(dto.websocketUrl);
			else if (this.state.connection === "connected") this.attempt = 0;
		} catch (error) {
			if (!this.stopped && epoch === this.epoch) this.retry(error);
		} finally {
			if (epoch === this.epoch) {
				this.controller = null;
				this.refreshing = false;
				if (this.pending) {
					this.pending = false;
					this.refresh();
				}
			}
		}
	}

	private connect(raw: string): void {
		const socket = this.options.socketFactory(resolveWebSocketUrl(raw));
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
			this.state.connection = "connected";
			this.state.error = null;
			this.emit();
			// Cover updates between the HTTP snapshot and WebSocket subscription.
			this.refresh();
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
				typeof message === "object" &&
				message !== null &&
				"type" in message &&
				message.type === "race.data"
			)
				this.refresh();
		};
		socket.onclose = () => {
			if (current()) this.retry(new Error("WebSocket disconnected"));
		};
		socket.onerror = () => {
			if (current()) this.retry(new Error("WebSocket failed"));
		};
	}
}
