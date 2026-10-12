import {
	BUNDLE_NAME,
	operationMessageName,
} from "@nanahuse/player-manager-protocol";
import {getNodeCG} from "./nodecg-client";

export type RegistrationSession = {registrationId: string; url: string};

type Envelope<T> =
	| {ok: true; data: T}
	| {ok: false; error: {code: string; message: string}};

/** Links to the read-only Player Directory panel shipped by player-manager. */
export function playerDirectoryUrl(): string {
	return `/bundles/${BUNDLE_NAME}/dashboard/PlayerMapping.html`;
}

export function playerEditUrl(playerId: string): string {
	return `${playerDirectoryUrl()}?playerId=${encodeURIComponent(playerId)}`;
}

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
