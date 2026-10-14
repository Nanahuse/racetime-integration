import type {
	ResolvedCategoryMapping,
	SpeedrunRun,
	SpeedrunVariableOption,
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
		getCategoryVariables: vi.fn(
			async (): Promise<SpeedrunVariableOption[]> => [],
		),
		getUserPersonalBests: vi.fn(async (userId: string) => [`${userId}-pb`]),
		getUserRuns: vi.fn(
			async (userId: string, _mapping: ResolvedCategoryMapping) => [
				run(`${userId}-pb`, userId === "u1" ? "PT45S" : "PT30S", userId),
			],
		),
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
	return {service, speedrun, players, mapping};
}

async function configureAny(
	mapping: ReturnType<typeof setup>["mapping"],
	speedrun: ReturnType<typeof setup>["speedrun"],
) {
	mapping.resolveSource.mockResolvedValue({
		...structuredClone(source),
		category: {...source.category, variables: {v1: {mode: "any"}}},
	} as never);
	vi.mocked(speedrun.getCategoryVariables).mockResolvedValue([
		{
			id: "v1",
			name: "Mode",
			mandatory: true,
			userDefined: false,
			obsoletes: true,
			values: [
				{id: "easy", label: "Easy"},
				{id: "hard", label: "Hard"},
			],
		},
	]);
}

it("chooses the fastest matching run across every linked SRC account and shares its cache", async () => {
	const {service, speedrun, players} = setup();
	const first = await service.playerBests("race-game", "Any%", ["p1"]);
	const second = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(first.status).toBe("resolved");
	if (first.status !== "resolved") return;
	expect(first.results?.[0]?.players[0]).toMatchObject({
		playerId: "p1",
		srcUserId: "u2",
		state: "found",
		run: {runId: "u2-pb", time: "PT30S"},
	});
	expect(second.status).toBe("resolved");
	expect(speedrun.getUserPersonalBests).not.toHaveBeenCalled();
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

it("finds a condition-matching PB outside the configured leaderboard top even when Personal Bests is empty", async () => {
	const {service, speedrun, players} = setup();
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u1"]]]),
	);
	vi.mocked(speedrun.getUserPersonalBests).mockResolvedValue(["u1-verified"]);
	vi.mocked(speedrun.getUserRuns).mockResolvedValue([
		run("u1-verified", "PT44S"),
	]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({
		state: "found",
		run: {runId: "u1-verified", time: "PT44S"},
	});
	expect(speedrun.getLeaderboard).not.toHaveBeenCalled();
});

it("returns not_found only after a complete Runs search has no matching record", async () => {
	const {service, speedrun} = setup();
	vi.mocked(speedrun.getUserRuns).mockResolvedValue([]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({state: "not_found"});
	expect(speedrun.getUserRuns).toHaveBeenCalled();
	expect(speedrun.getUserPersonalBests).not.toHaveBeenCalled();
});

it("chooses the fastest Run after checking all matching candidates", async () => {
	const {service, speedrun, players} = setup();
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u1"]]]),
	);
	vi.mocked(speedrun.getUserRuns).mockResolvedValue([
		run("slower", "PT45S"),
		run("fastest", "PT34S"),
		run("middle", "PT40S"),
	]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({
		state: "found",
		run: {runId: "fastest", time: "PT34S"},
	});
});

it("uses fully searched Runs candidates when Personal Bests returns an empty list", async () => {
	const {service, speedrun} = setup();
	vi.mocked(speedrun.getUserRuns).mockResolvedValue([
		run("candidate", "PT40S"),
	]);
	vi.mocked(speedrun.getUserPersonalBests).mockResolvedValue([]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({
		state: "found",
		run: {runId: "candidate", time: "PT40S"},
	});
});

it("does not resolve a Player PB from another account when one account failed", async () => {
	const {service, speedrun} = setup();
	vi.mocked(speedrun.getUserRuns).mockImplementation(async (userId) => {
		if (userId === "u2") throw new Error("SRC unavailable");
		return [run("u1-pb", "PT45S", userId)];
	});
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({
		state: "error",
		run: null,
	});
});

it("does not reuse a stale PB after the linked SRC accounts change", async () => {
	const {service, speedrun, players} = setup();
	const first = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(first.status).toBe("resolved");
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u3"]]]),
	);
	vi.mocked(speedrun.getUserRuns).mockRejectedValue(
		new Error("SRC unavailable"),
	);
	const second = await service.playerBests("race-game", "Any%", ["p1"], true);
	expect(second.status).toBe("resolved");
	if (second.status !== "resolved") return;
	expect(second.results?.[0]?.players[0]).toMatchObject({
		srcUserId: "u3",
		state: "error",
		run: null,
		stale: false,
	});
});

it("returns each Any leaderboard independently and marks only the failed mapping as error", async () => {
	const {service, speedrun, mapping} = setup();
	await configureAny(mapping, speedrun);
	vi.mocked(speedrun.getLeaderboard).mockImplementation(
		async (resolved: ResolvedCategoryMapping, top: number) => {
			if (resolved.category.variables.v1 === "hard")
				throw new Error("temporary SRC failure");
			return {
				mapping: resolved,
				top,
				fetchedAt: "2026-01-01T00:00:00.000Z",
				state: "ready",
				entries: [{place: 1, run: run("easy-run", "PT40S")}],
				stale: false,
			};
		},
	);
	const first = await service.leaderboards("race-game", "Any%");
	expect(first.status).toBe("resolved");
	if (first.status !== "resolved") return;
	expect(first.leaderboards?.map(({state}) => state)).toEqual([
		"ready",
		"error",
	]);
	expect(first.leaderboards?.[1]).toMatchObject({
		mapping: {category: {variables: {v1: "hard"}}},
		message: "temporary SRC failure",
	});

	vi.mocked(speedrun.getLeaderboard).mockRejectedValue(new Error("still down"));
	const refreshed = await service.leaderboards("race-game", "Any%", true);
	expect(refreshed.status).toBe("resolved");
	if (refreshed.status !== "resolved") return;
	expect(
		refreshed.leaderboards?.map(({state, stale}) => [state, stale]),
	).toEqual([
		["ready", true],
		["error", false],
	]);
});

it("reports every Any mapping independently when all leaderboard requests fail", async () => {
	const {service, speedrun, mapping} = setup();
	await configureAny(mapping, speedrun);
	vi.mocked(speedrun.getLeaderboard).mockRejectedValue(new Error("offline"));
	const response = await service.leaderboards("race-game", "Any%");
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.leaderboards).toHaveLength(2);
	expect(response.leaderboards?.map(({state}) => state)).toEqual([
		"error",
		"error",
	]);
});

it("keeps PB results independent when one Any mapping fails", async () => {
	const {service, speedrun, mapping, players} = setup();
	await configureAny(mapping, speedrun);
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u1"]]]),
	);
	vi.mocked(speedrun.getUserRuns).mockImplementation(
		async (_userId: string, resolved: ResolvedCategoryMapping) => {
			if (resolved.category.variables.v1 === "hard")
				throw new Error("page failed");
			return [run("u1-pb", "PT40S")];
		},
	);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(
		response.results?.map(({players: results}) => results[0]?.state),
	).toEqual(["found", "error"]);
});
