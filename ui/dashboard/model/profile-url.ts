import {useCallback, useEffect, useSyncExternalStore} from "react";
import {AccountProfileError, accountProfileUrl} from "../api/player-manager";

export type AccountProfileUrlState = {
	state: "loading" | "ready" | "error";
	url: string | null;
	error: string | null;
	errorCode: string | null;
	fetchedAt: number | null;
};

export const ACCOUNT_PROFILE_URL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 4;
const states = new Map<string, AccountProfileUrlState>();
const inFlight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const tokens = new Map<string, number>();
const queue: string[] = [];
let active = 0;

function loadingState(): AccountProfileUrlState {
	return {
		state: "loading",
		url: null,
		error: null,
		errorCode: null,
		fetchedAt: null,
	};
}

function isExpired(state: AccountProfileUrlState, now: number): boolean {
	return (
		state.state === "ready" &&
		state.fetchedAt !== null &&
		now - state.fetchedAt >= ACCOUNT_PROFILE_URL_TTL_MS
	);
}

/** Clears the in-memory cache. Intended for tests. */
export function resetAccountProfileUrls(): void {
	states.clear();
	inFlight.clear();
	tokens.clear();
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
		const token = (tokens.get(accountId) ?? 0) + 1;
		tokens.set(accountId, token);
		active++;
		inFlight.add(accountId);
		void accountProfileUrl(accountId)
			.then((url) => {
				if (tokens.get(accountId) !== token) return;
				if (states.get(accountId)?.state !== "loading") return;
				setState(accountId, {
					state: "ready",
					url,
					error: null,
					errorCode: null,
					fetchedAt: Date.now(),
				});
			})
			.catch((cause) => {
				if (tokens.get(accountId) !== token) return;
				if (states.get(accountId)?.state !== "loading") return;
				const code =
					cause instanceof AccountProfileError ? cause.code : "communication";
				setState(accountId, {
					state: "error",
					url: null,
					error: cause instanceof Error ? cause.message : String(cause),
					errorCode: code,
					fetchedAt: null,
				});
			})
			.finally(() => {
				active--;
				inFlight.delete(accountId);
				drain();
			});
	}
}

/** Requests a profile URL once per account until the cache TTL expires. */
export function requestAccountProfileUrl(accountId: string): void {
	const current = states.get(accountId);
	if (current?.state === "loading") return;
	if (current?.state === "error") return;
	if (current?.state === "ready" && !isExpired(current, Date.now())) return;
	setState(accountId, loadingState());
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
	const stateKind = state?.state;
	const fetchedAt = state?.fetchedAt ?? null;
	useEffect(() => {
		if (!accountId) return;
		const current = states.get(accountId);
		if (!current) {
			requestAccountProfileUrl(accountId);
			return;
		}
		if (current.state !== "ready" || current.fetchedAt === null) return;
		const remaining =
			ACCOUNT_PROFILE_URL_TTL_MS - (Date.now() - current.fetchedAt);
		if (remaining <= 0) {
			requestAccountProfileUrl(accountId);
			return;
		}
		const timer = setTimeout(
			() => requestAccountProfileUrl(accountId),
			remaining,
		);
		return () => clearTimeout(timer);
	}, [accountId, stateKind, fetchedAt]);
	const retry = useCallback(() => {
		if (!accountId) return;
		states.delete(accountId);
		inFlight.delete(accountId);
		requestAccountProfileUrl(accountId);
	}, [accountId]);
	return {state, retry};
}
