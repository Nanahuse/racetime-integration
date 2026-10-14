import type {
	ResolvedCategoryMapping,
	SpeedrunRun,
} from "@nanahuse/racetime-protocol";
import {expect, it, vi} from "vitest";
import {SpeedrunRecordService} from "../src/speedrun-records";

const source = {
	status: "found",
	game: {gameId: "g1", gameName: "Game"},
	category: {
		categoryId: "c1",
		categoryName: "Any%",
		levelId: null,
		variables: {},
		platformId: null,
		regionId: null,
		emulator: null,
		timingMethod: null,
	},
	maxResolvedMappings: 20,
};

function run(runId: string, time: string, userId = "u1"): SpeedrunRun {
	return {
		runId,
		url: `https://www.speedrun.com/runs/${runId}`,
		time,
		date: "2026-01-01",
		players: [
			{userId, name: userId, url: `https://www.speedrun.com/users/${userId}`},
		],
	};
}

function setup() {
	const mapping = {resolveSource: vi.fn(async () => structuredClone(source))};
	const speedrun = {
		getCategoryVariables: vi.fn(async () => []),
		getUserPersonalBests: vi.fn(async (userId: string) => [
			run(`${userId}-pb`, userId === "u1" ? "PT45S" : "PT1M"),
		]),
		getUserRuns: vi.fn(async (userId: string) => [
			run(`${userId}-verified`, "PT44S", userId),
		]),
		getLeaderboard: vi.fn(
			async (resolved: ResolvedCategoryMapping, top: number) => ({
				mapping: resolved,
				top,
				fetchedAt: "2026-01-01T00:00:00.000Z",
				state: "ready" as const,
				entries: [{place: 1, run: run("leaderboard-run", "PT40S")}],
				stale: false,
			}),
		),
	};
	const players = {
		speedrunAccounts: vi.fn(async () => new Map([["p1", ["u1", "u2"]]])),
		speedrunDisplayNames: vi.fn(async () => new Map([["u1", "Display Name"]])),
	};
	const service = new SpeedrunRecordService(
		mapping as never,
		speedrun as never,
		players as never,
		() => 20,
	);
	return {service, speedrun, players};
}

it("chooses the fastest current PB across every linked SRC account and shares its cache", async () => {
	const {service, speedrun, players} = setup();
	const first = await service.playerBests("race-game", "Any%", ["p1"]);
	const second = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(first.status).toBe("resolved");
	if (first.status !== "resolved") return;
	expect(first.results?.[0]?.players[0]).toMatchObject({
		playerId: "p1",
		srcUserId: "u1",
		state: "found",
		run: {runId: "u1-pb", time: "PT45S"},
	});
	expect(second.status).toBe("resolved");
	expect(speedrun.getUserPersonalBests).toHaveBeenCalledTimes(2);
	expect(players.speedrunAccounts).toHaveBeenCalledTimes(2);
});

it("attaches player-manager names and PBs to leaderboard players without changing SRC place", async () => {
	const {service} = setup();
	const response = await service.leaderboards("race-game", "Any%");
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.leaderboards?.[0]?.entries[0]).toMatchObject({
		place: 1,
		run: {
			players: [
				{
					userId: "u1",
					displayName: "Display Name",
					personalBest: {state: "found", run: {runId: "u1-pb"}},
				},
			],
		},
	});
});

it("falls back to verified runs only when the filtered leaderboard confirms them", async () => {
	const {service, speedrun, players} = setup();
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u1"]]]),
	);
	vi.mocked(speedrun.getUserPersonalBests).mockRejectedValue(
		new Error("PB response did not include condition data"),
	);
	vi.mocked(speedrun.getLeaderboard).mockImplementation(
		async (resolved: ResolvedCategoryMapping, top: number) => ({
			mapping: resolved,
			top,
			fetchedAt: "2026-01-01T00:00:00.000Z",
			state: "ready",
			entries: [{place: 1, run: run("u1-verified", "PT44S")}],
			stale: false,
		}),
	);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({
		state: "found",
		run: {runId: "u1-verified", time: "PT44S"},
	});
	expect(speedrun.getUserRuns).toHaveBeenCalledWith(
		"u1",
		expect.objectContaining({
			category: expect.objectContaining({categoryId: "c1"}),
		}),
	);
});
