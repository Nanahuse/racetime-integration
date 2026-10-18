import {useCallback, useEffect, useSyncExternalStore} from "react";
import {accountProfileUrl} from "../api/player-manager";

export type AccountProfileUrlState = {
	state: "loading" | "ready" | "error";
	url: string | null;
	error: string | null;
};

const MAX_CONCURRENT = 4;
const states = new Map<string, AccountProfileUrlState>();
const inFlight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const queue: string[] = [];
let active = 0;

/** Clears the in-memory cache. Intended for tests. */
export function resetAccountProfileUrls(): void {
	states.clear();
	inFlight.clear();
	queue.length = 0;
	listeners.clear();
	active = 0;
}

function notify(accountId: string): void {
	for (const listener of listeners.get(accountId) ?? []) listener();
}

function setState(accountId: string, state: AccountProfileUrlState): void {
	states.set(accountId, state);
	notify(accountId);
}

function drain(): void {
	while (active < MAX_CONCURRENT && queue.length > 0) {
		const accountId = queue.shift();
		if (accountId === undefined) return;
		if (states.get(accountId)?.state !== "loading" || inFlight.has(accountId))
			continue;
		active++;
		inFlight.add(accountId);
		void accountProfileUrl(accountId)
			.then((url) => {
				if (states.get(accountId)?.state === "loading")
					setState(accountId, {state: "ready", url, error: null});
			})
			.catch((cause) => {
				if (states.get(accountId)?.state === "loading")
					setState(accountId, {
						state: "error",
						url: null,
						error: cause instanceof Error ? cause.message : String(cause),
					});
			})
			.finally(() => {
				active--;
				inFlight.delete(accountId);
				drain();
			});
	}
}

/** Requests a profile URL once per account; the result is not persisted. */
export function requestAccountProfileUrl(accountId: string): void {
	const current = states.get(accountId);
	if (current?.state === "ready" || current?.state === "loading") return;
	setState(accountId, {state: "loading", url: null, error: null});
	queue.push(accountId);
	drain();
}

function subscribe(accountId: string, listener: () => void): () => void {
	const set = listeners.get(accountId) ?? new Set();
	set.add(listener);
	listeners.set(accountId, set);
	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(accountId);
	};
}

export function useAccountProfileUrl(accountId: string | null): {
	state: AccountProfileUrlState | null;
	retry: () => void;
} {
	const state = useSyncExternalStore(
		useCallback(
			(listener) => (accountId ? subscribe(accountId, listener) : () => {}),
			[accountId],
		),
		() => (accountId ? (states.get(accountId) ?? null) : null),
	);
	useEffect(() => {
		if (accountId && !states.has(accountId))
			requestAccountProfileUrl(accountId);
	}, [accountId]);
	const retry = useCallback(() => {
		if (!accountId) return;
		states.delete(accountId);
		inFlight.delete(accountId);
		requestAccountProfileUrl(accountId);
	}, [accountId]);
	return {state, retry};
}
