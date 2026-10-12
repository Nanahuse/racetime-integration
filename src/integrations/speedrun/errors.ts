import type {FailureCode} from "@nanahuse/racetime-protocol";

export class SpeedrunError extends Error {
	constructor(
		readonly code: FailureCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = new.target.name;
	}
}

export class SpeedrunNotFoundError extends SpeedrunError {
	constructor(message: string, options?: ErrorOptions) {
		super("not_found", message, options);
	}
}
