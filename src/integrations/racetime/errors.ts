// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
export type RaceTimeErrorCode =
	| "invalid_url"
	| "not_found"
	| "http_error"
	| "timeout"
	| "aborted"
	| "invalid_payload"
	| "websocket_error"
	| "network_error";

/**
 * Base error for the RaceTime.gg integration. Callers can branch on `code`
 * instead of parsing `message`.
 */
export class RaceTimeError extends Error {
	readonly code: RaceTimeErrorCode;

	constructor(
		code: RaceTimeErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
}

export class InvalidRaceUrlError extends RaceTimeError {
	constructor(message: string, options?: ErrorOptions) {
		super("invalid_url", message, options);
	}
}

export class RaceNotFoundError extends RaceTimeError {
	constructor(message: string, options?: ErrorOptions) {
		super("not_found", message, options);
	}
}

export class RaceTimeHttpError extends RaceTimeError {
	readonly status: number;

	constructor(status: number, message: string, options?: ErrorOptions) {
		super("http_error", message, options);
		this.status = status;
	}
}

export class RaceTimeTimeoutError extends RaceTimeError {
	constructor(message: string, options?: ErrorOptions) {
		super("timeout", message, options);
	}
}

export class RaceTimeAbortedError extends RaceTimeError {
	constructor(message: string, options?: ErrorOptions) {
		super("aborted", message, options);
	}
}

export class RaceTimePayloadError extends RaceTimeError {
	constructor(message: string, options?: ErrorOptions) {
		super("invalid_payload", message, options);
	}
}

export class RaceTimeWebSocketError extends RaceTimeError {
	constructor(message: string, options?: ErrorOptions) {
		super("websocket_error", message, options);
	}
}

export class RaceTimeNetworkError extends RaceTimeError {
	constructor(message: string, options?: ErrorOptions) {
		super("network_error", message, options);
	}
}

export function describeRaceTimeError(error: unknown): string {
	if (error instanceof RaceTimeError) {
		return `${error.code}: ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}

export function isAbortedError(error: unknown): boolean {
	return error instanceof RaceTimeError && error.code === "aborted";
}
