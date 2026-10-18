// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {
	ACCOUNT_PROFILE_URL_TTL_MS,
	resetAccountProfileUrls,
	useAccountProfileUrl,
} from "../ui/dashboard/model/profile-url";
import {deferred} from "./fixtures";

const sendMessageToBundle = vi.fn();

(window as unknown as {nodecg: unknown}).nodecg = {sendMessageToBundle};

afterEach(() => {
	resetAccountProfileUrls();
	sendMessageToBundle.mockReset();
	vi.useRealTimers();
});

async function settle() {
	await act(async () => {
		for (let i = 0; i < 12; i += 1) await Promise.resolve();
	});
}

it("resolves and caches a profile URL per account", async () => {
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {url: "https://src.example/one"},
	});
	const {result} = renderHook(() => useAccountProfileUrl("acct-1"));
	await settle();
	expect(result.current.state?.state).toBe("ready");
	expect(result.current.state?.url).toBe("https://src.example/one");
	expect(sendMessageToBundle).toHaveBeenCalledTimes(1);
});

it("does not refetch within the TTL and refetches after it expires", async () => {
	vi.useFakeTimers();
	let calls = 0;
	sendMessageToBundle.mockImplementation(() => {
		calls += 1;
		return Promise.resolve({
			ok: true,
			data: {url: `https://src.example/${calls}`},
		});
	});
	const {result} = renderHook(() => useAccountProfileUrl("acct-1"));
	await settle();
	expect(result.current.state?.url).toBe("https://src.example/1");

	await act(async () => {
		await vi.advanceTimersByTimeAsync(ACCOUNT_PROFILE_URL_TTL_MS - 1);
	});
	expect(sendMessageToBundle).toHaveBeenCalledTimes(1);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	await settle();
	expect(sendMessageToBundle).toHaveBeenCalledTimes(2);
	expect(result.current.state?.url).toBe("https://src.example/2");
});

it("uses the account-specific URL when the account changes", async () => {
	sendMessageToBundle.mockImplementation((_name, _bundle, data?: unknown) =>
		Promise.resolve({
			ok: true,
			data: {
				url: `https://src.example/${(data as {accountId: string}).accountId}`,
			},
		}),
	);
	const {result, rerender} = renderHook(
		({accountId}: {accountId: string}) => useAccountProfileUrl(accountId),
		{initialProps: {accountId: "acct-1"}},
	);
	await settle();
	expect(result.current.state?.url).toBe("https://src.example/acct-1");
	rerender({accountId: "acct-2"});
	await settle();
	expect(result.current.state?.url).toBe("https://src.example/acct-2");
});

it("ignores a stale response after a retry starts a new request", async () => {
	const first = deferred<{ok: true; data: {url: string}}>();
	const second = deferred<{ok: true; data: {url: string}}>();
	sendMessageToBundle
		.mockReturnValueOnce(first.promise)
		.mockReturnValueOnce(second.promise);
	const {result} = renderHook(() => useAccountProfileUrl("acct-1"));
	await settle();
	expect(result.current.state?.state).toBe("loading");

	act(() => result.current.retry());
	await settle();

	second.resolve({ok: true, data: {url: "https://src.example/new"}});
	await settle();
	expect(result.current.state?.url).toBe("https://src.example/new");

	first.resolve({ok: true, data: {url: "https://src.example/old"}});
	await settle();
	expect(result.current.state?.url).toBe("https://src.example/new");
});
