import {
	BUNDLE_NAME,
	operationMessageName,
	playerEditUrl,
} from "@nanahuse/player-manager-protocol";
import {getNodeCG} from "./nodecg-client";

export {playerEditUrl};

export type RegistrationSession = {registrationId: string; url: string};

export type PlayerManagerStatus =
	| {state: "ready"}
	| {state: "loading"}
	| {state: "error"; message: string}
	| {state: "unavailable"; message: string};

type Envelope<T> =
	| {ok: true; data: T}
	| {ok: false; error: {code: string; message: string}};

/**
 * Uses player-manager's public registration API to obtain a one-time,
 * server-generated registration URL for an unmatched RaceTime account.
 */
export async function beginRegistration(
	racetimeUserId: string,
): Promise<RegistrationSession> {
	const response = await getNodeCG().sendMessageToBundle<
		Envelope<RegistrationSession>
	>(operationMessageName("beginRegistration"), BUNDLE_NAME, {
		input: {racetime: racetimeUserId},
		createPlayerOnEmpty: true,
	});
	if (!response.ok)
		throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

/**
 * Resolves a service profile URL through Player Manager's public API. The
 * integration never builds or validates provider URLs itself.
 */
export async function accountProfileUrl(accountId: string): Promise<string> {
	const response = await getNodeCG().sendMessageToBundle<
		Envelope<{url: string}>
	>(operationMessageName("getAccountProfileUrl"), BUNDLE_NAME, {accountId});
	if (!response.ok)
		throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data.url;
}

/**
 * Reads the public Player Manager readiness through its `status` operation.
 * Never depends on player-manager internals; a missing bundle is "unavailable".
 */
export async function playerManagerStatus(): Promise<PlayerManagerStatus> {
	try {
		const response = await getNodeCG().sendMessageToBundle<
			Envelope<{ready: boolean; error: string | null}>
		>(operationMessageName("status"), BUNDLE_NAME, undefined);
		if (!response.ok)
			return {
				state: "unavailable",
				message: `${response.error.code}: ${response.error.message}`,
			};
		if (response.data.error)
			return {state: "error", message: response.data.error};
		return response.data.ready ? {state: "ready"} : {state: "loading"};
	} catch (cause) {
		return {
			state: "unavailable",
			message: cause instanceof Error ? cause.message : String(cause),
		};
	}
}
