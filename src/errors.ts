import type {FailureCode} from "@nanahuse/racetime-protocol";

export class IntegrationError extends Error {
	constructor(
		readonly code: FailureCode,
		message: string,
	) {
		super(message);
	}
}
