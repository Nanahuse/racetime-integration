import {
	type Operations,
	operationMessageName,
	type Response,
} from "@nanahuse/racetime-protocol";
import {getNodeCG} from "./nodecg-client";

export class ApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export async function request<K extends keyof Operations>(
	operation: K,
	data: Operations[K]["request"],
): Promise<Operations[K]["response"]> {
	const response = await getNodeCG().sendMessage<
		Response<Operations[K]["response"]>
	>(operationMessageName(operation), data);
	if (!response.ok)
		throw new ApiError(response.error.code, response.error.message);
	return response.data;
}

export function errorMessage(error: unknown): string {
	if (error instanceof ApiError) return `${error.code}: ${error.message}`;
	return error instanceof Error ? error.message : String(error);
}

/** A stored row changed since it was loaded; the edit must be rebased. */
export function isConflict(error: unknown): boolean {
	return error instanceof ApiError && error.code === "mapping_conflict";
}

/** The spreadsheet destination changed; old edits must not auto-migrate. */
export function isSettingsChanged(error: unknown): boolean {
	return error instanceof ApiError && error.code === "settings_changed";
}

/** A parent/child integrity rule rejected the operation. */
export function isGameMappingConflict(error: unknown): boolean {
	return error instanceof ApiError && error.code === "game_mapping_conflict";
}
