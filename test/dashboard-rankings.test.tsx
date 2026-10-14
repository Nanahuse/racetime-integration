// @vitest-environment jsdom
import type {CategoryMappingRecord} from "@nanahuse/racetime-protocol";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {Rankings} from "../ui/dashboard/components/Rankings";

const sendMessage = vi.fn();
(window as unknown as {nodecg: unknown}).nodecg = {sendMessage};

const records: CategoryMappingRecord[] = ["A", "B"].map((goal) => ({
	mapping: {
		racetime: {categorySlug: "game", goal},
		speedrunCom: {
			categoryId: `category-${goal}`,
			categoryName: goal,
			levelId: null,
			variables: {},
			platformId: null,
			regionId: null,
			emulator: null,
			timingMethod: null,
		},
	},
	revision: `revision-${goal}`,
}));

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
});

it("keeps each mapping's result and loading state with its own request", async () => {
	const pending = new Map<string, (value: unknown) => void>();
	sendMessage.mockImplementation(
		async (name: string, request: {goal?: string}) => {
			const operation = name.replace("racetime.v4.", "");
			if (operation === "listCategoryMappings")
				return {ok: true, data: {records, settingsRevision: 0}};
			if (operation === "getSpeedrunLeaderboards")
				return new Promise((resolve) =>
					pending.set(request.goal ?? "", resolve),
				);
			throw new Error(`unexpected operation ${operation}`);
		},
	);

	render(<Rankings />);
	await waitFor(() => expect(pending.has("A")).toBe(true));
	fireEvent.change(screen.getByRole("combobox", {name: "Ranking mapping"}), {
		target: {value: "game\u0000B"},
	});
	await waitFor(() => expect(pending.has("B")).toBe(true));
	expect(
		(screen.getByRole("button", {name: "取得中…"}) as HTMLButtonElement)
			.disabled,
	).toBe(true);

	pending.get("A")?.({
		ok: true,
		data: {status: "resolved", leaderboards: [], stale: false},
	});
	await waitFor(() => expect(screen.getByText("取得中")).toBeTruthy());

	pending.get("B")?.({
		ok: true,
		data: {status: "resolved", leaderboards: [], stale: true},
	});
	await waitFor(() =>
		expect(screen.getByText("古いキャッシュを表示中")).toBeTruthy(),
	);
	await waitFor(() =>
		expect(
			(screen.getByRole("button", {name: "再取得"}) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
});

it("keeps a refresh response attached to the mapping requested", async () => {
	const pending: Array<{
		goal: string;
		resolve: (value: unknown) => void;
	}> = [];
	sendMessage.mockImplementation(
		async (name: string, request: {goal?: string}) => {
			const operation = name.replace("racetime.v4.", "");
			if (operation === "listCategoryMappings")
				return {ok: true, data: {records, settingsRevision: 0}};
			if (operation === "getSpeedrunLeaderboards")
				return new Promise((resolve) =>
					pending.push({goal: request.goal ?? "", resolve}),
				);
			throw new Error(`unexpected operation ${operation}`);
		},
	);
	render(<Rankings />);
	await waitFor(() => expect(pending).toHaveLength(1));
	pending[0]?.resolve({
		ok: true,
		data: {status: "resolved", leaderboards: [], stale: false},
	});
	await waitFor(() => expect(screen.getByText("取得済み")).toBeTruthy());
	fireEvent.click(screen.getByRole("button", {name: "再取得"}));
	await waitFor(() => expect(pending).toHaveLength(2));
	fireEvent.change(screen.getByRole("combobox", {name: "Ranking mapping"}), {
		target: {value: "game\u0000B"},
	});
	await waitFor(() => expect(pending).toHaveLength(3));
	pending[2]?.resolve({
		ok: true,
		data: {status: "resolved", leaderboards: [], stale: false},
	});
	await waitFor(() => expect(screen.getByText("取得済み")).toBeTruthy());
	pending[1]?.resolve({
		ok: true,
		data: {status: "resolved", leaderboards: [], stale: true},
	});
	await waitFor(() => expect(screen.getByText("取得済み")).toBeTruthy());
	expect(screen.queryByText("古いキャッシュを表示中")).toBeNull();
});
