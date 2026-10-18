// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {RaceLeaderboard} from "../ui/dashboard/components/RaceLeaderboard";
import {deferred} from "./fixtures";

const sendMessage = vi.fn();
(window as unknown as {nodecg: unknown}).nodecg = {sendMessage};

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
});

function response(
	goal: string,
	state: "ready" | "not_found" | "error" = "ready",
) {
	return {
		ok: true,
		data: {
			status: "resolved",
			stale: false,
			leaderboards: [
				{
					mapping: {
						key: `game\u0000${goal}`,
						label: goal,
						game: {gameId: "g1", gameName: "Game"},
						category: {
							categoryId: "c1",
							categoryName: goal,
							levelId: null,
							variables: {},
							platformId: null,
							regionId: null,
							emulator: null,
							timingMethod: null,
						},
					},
					top: 20,
					fetchedAt: "2026-10-18T00:00:00Z",
					state,
					stale: false,
					message: state === "error" ? `failure ${goal}` : undefined,
					entries:
						state === "ready"
							? [
									{
										place: 1,
										run: {
											runId: `run-${goal}`,
											url: `https://www.speedrun.com/runs/${goal}`,
											time: "PT1M",
											date: "2026-10-18",
											players: [
												{
													userId: "u1",
													name: "Runner",
													displayName: "Player Manager name",
													url: "https://www.speedrun.com/users/u1",
													personalBest: {
														playerId: "p1",
														srcUserId: "u1",
														state: "found",
														run: {
															runId: "pb",
															url: "https://www.speedrun.com/runs/pb",
															time: "PT55S",
															date: "2026-10-17",
															players: [],
															place: 2,
															gameId: "g1",
															categoryId: "c1",
															levelId: null,
															variables: {},
														},
														place: 2,
														fetchedAt: "2026-10-18T00:00:00Z",
														stale: false,
													},
												},
											],
										},
									},
								]
							: [],
				},
			],
		},
	};
}

it("requests the selected category and shows the board, PB, time, and date", async () => {
	sendMessage.mockResolvedValue(response("Any%"));
	render(
		<RaceLeaderboard
			categorySlug='game'
			goal='Any%'
			mappingRevision={0}
		/>,
	);
	await screen.findByText("Game / Any%");
	expect(sendMessage).toHaveBeenCalledWith(
		"racetime.v4.getSpeedrunLeaderboards",
		{
			categorySlug: "game",
			goal: "Any%",
			refresh: false,
		},
	);
	expect(screen.getByText("Player Manager name", {exact: false})).toBeTruthy();
	expect(screen.getByText(/PB 0:00:55 · 2位/)).toBeTruthy();
	expect(
		screen.getByRole("link", {name: "0:01:00"}).getAttribute("href"),
	).toContain("Any%");
	expect(screen.getByText("2026-10-18")).toBeTruthy();
});

it("does not show a previous category response after switching categories", async () => {
	const old = deferred<unknown>();
	const current = deferred<unknown>();
	sendMessage
		.mockReturnValueOnce(old.promise)
		.mockReturnValueOnce(current.promise);
	const view = render(
		<RaceLeaderboard
			categorySlug='game'
			goal='Any%'
			mappingRevision={0}
		/>,
	);
	view.rerender(
		<RaceLeaderboard
			categorySlug='other'
			goal='100%'
			mappingRevision={0}
		/>,
	);
	await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
	await act(async () => old.resolve(response("Any%")));
	expect(screen.queryByText("Game / Any%")).toBeNull();
	await act(async () => current.resolve(response("100%")));
	await screen.findByText("Game / 100%");
	expect(screen.queryByText("Game / Any%")).toBeNull();
});

it("uses cached automatic requests and refreshes only on request", async () => {
	sendMessage.mockResolvedValue(response("Any%"));
	const view = render(
		<RaceLeaderboard
			categorySlug='game'
			goal='Any%'
			mappingRevision={0}
		/>,
	);
	await screen.findByText("Game / Any%");
	view.rerender(
		<RaceLeaderboard
			categorySlug='game'
			goal='Any%'
			mappingRevision={1}
		/>,
	);
	await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
	expect(sendMessage.mock.calls[1]?.[1]).toEqual({
		categorySlug: "game",
		goal: "Any%",
		refresh: false,
	});
	fireEvent.click(screen.getByRole("button", {name: "Leaderboard再取得"}));
	await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
	expect(sendMessage.mock.calls[2]?.[1]).toEqual({
		categorySlug: "game",
		goal: "Any%",
		refresh: true,
	});
});

it("shows empty boards and individual mapping errors", async () => {
	sendMessage.mockResolvedValue({
		ok: true,
		data: {
			status: "resolved",
			stale: true,
			leaderboards: [
				{
					...response("First").data.leaderboards[0],
					state: "not_found",
					entries: [],
				},
				{...response("Second", "error").data.leaderboards[0]},
			],
		},
	});
	render(
		<RaceLeaderboard
			categorySlug='game'
			goal='Any%'
			mappingRevision={0}
		/>,
	);
	await screen.findByText("該当する記録はありません。");
	expect(screen.getByText("failure Second")).toBeTruthy();
	await screen.findByText("古いキャッシュを表示中");
});
