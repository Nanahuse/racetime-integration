import type {
	ResolvedCategoryMapping,
	SpeedrunPersonalBestRun,
	SpeedrunRun,
	SpeedrunVariableOption,
} from "@nanahuse/racetime-protocol";
import {afterEach, expect, it, vi} from "vitest";
import {SpeedrunRecordService} from "../src/speedrun-records";

afterEach(() => vi.useRealTimers());

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

function personalBest(
	runId: string,
	time: string,
	place: number,
	userId = "u1",
	options: Partial<
		Pick<
			SpeedrunPersonalBestRun,
			"gameId" | "categoryId" | "levelId" | "variables"
		>
	> = {},
): SpeedrunPersonalBestRun {
	return {
		...run(runId, time, userId),
		place,
		gameId: options.gameId ?? "g1",
		categoryId: options.categoryId ?? "c1",
		levelId: options.levelId ?? null,
		variables: options.variables ?? {},
	};
}

function setup() {
	const mapping = {resolveSource: vi.fn(async () => structuredClone(source))};
	const speedrun = {
		getCategoryVariables: vi.fn(
			async (): Promise<SpeedrunVariableOption[]> => [],
		),
		getUserPersonalBests: vi.fn(async (userId: string, _gameId: string) => [
			personalBest(
				`${userId}-pb`,
				userId === "u1" ? "PT45S" : "PT30S",
				userId === "u1" ? 8 : 3,
				userId,
			),
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

it("chooses the fastest official PB across linked SRC accounts and retains SRC place", async () => {
	const {service, speedrun, players} = setup();
	const first = await service.playerBests("race-game", "Any%", ["p1"]);
	const second = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(first.status).toBe("resolved");
	if (first.status !== "resolved") return;
	expect(first.results?.[0]?.players[0]).toMatchObject({
		playerId: "p1",
		srcUserId: "u2",
		state: "found",
		run: {runId: "u2-pb", time: "PT30S", place: 3},
		place: 3,
	});
	expect(second.status).toBe("resolved");
	expect(speedrun.getUserPersonalBests).toHaveBeenCalledTimes(2);
	expect(players.speedrunAccounts).toHaveBeenCalledTimes(2);
});

it.each([
	["PT1.000000002S", "PT1.000000001S"],
	["PT1M", "PT59.999999999S"],
	["PT25H", "P1D"],
])(
	"chooses the fastest PB by duration across accounts (%s versus %s)",
	async (slower, faster) => {
		const {service, speedrun} = setup();
		speedrun.getUserPersonalBests.mockImplementation(async (userId) => [
			personalBest(
				userId,
				userId === "u1" ? slower : faster,
				userId === "u1" ? 1 : 8,
				userId,
			),
		]);
		const result = await service.playerBests("race-game", "Any%", ["p1"]);
		expect(result).toMatchObject({
			status: "resolved",
			results: [{players: [{srcUserId: "u2", run: {time: faster}, place: 8}]}],
		});
	},
);

it("keeps the five-minute PB cache and marks the last good snapshot stale after expiry and a failed reload", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	const {service, speedrun} = setup();
	const initial = await service.playerBests("race-game", "Any%", ["p1"]);
	vi.setSystemTime(new Date("2026-01-01T00:04:59Z"));
	await service.playerBests("race-game", "Any%", ["p1"]);
	expect(speedrun.getUserPersonalBests).toHaveBeenCalledTimes(2);
	vi.setSystemTime(new Date("2026-01-01T00:05:01Z"));
	speedrun.getUserPersonalBests.mockRejectedValue(new Error("offline"));
	const expired = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(speedrun.getUserPersonalBests).toHaveBeenCalledTimes(4);
	if (initial.status !== "resolved" || expired.status !== "resolved")
		throw new Error("Unresolved mapping");
	expect(expired.results[0]?.players[0]?.run).toEqual(
		initial.results[0]?.players[0]?.run,
	);
	expect(expired.stale).toBe(true);
});

it("resolves leaderboard player names without changing SRC place or fetching PBs", async () => {
	const {service, speedrun, players} = setup();
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
				},
			],
		},
	});
	expect(response.leaderboards?.[0]?.entries[0]?.run.time).toBe("PT40S");
	expect(response.leaderboards?.[0]?.entries[0]?.place).toBe(1);
	expect(speedrun.getUserPersonalBests).not.toHaveBeenCalled();
	expect(players.speedrunDisplayNames).toHaveBeenCalledWith(["u1"]);
});

it("keeps a leaderboard successful when the PB endpoint is unavailable", async () => {
	const {service, speedrun} = setup();
	speedrun.getUserPersonalBests.mockRejectedValue(new Error("offline"));
	const result = await service.leaderboards("race-game", "Any%");
	expect(result.status).toBe("resolved");
	if (result.status !== "resolved") return;
	expect(result.leaderboards?.[0]?.state).toBe("ready");
	expect(result.stale).toBe(false);
	expect(speedrun.getUserPersonalBests).not.toHaveBeenCalled();
});

it("finds an official PB outside the configured leaderboard top", async () => {
	const {service, speedrun, players} = setup();
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u1"]]]),
	);
	vi.mocked(speedrun.getUserPersonalBests).mockResolvedValue([
		personalBest("u1-official", "PT44S", 55),
	]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({
		state: "found",
		run: {runId: "u1-official", time: "PT44S", place: 55},
		place: 55,
	});
	expect(speedrun.getLeaderboard).not.toHaveBeenCalled();
});

it("returns not_found after a complete PB list has no matching official PB", async () => {
	const {service, speedrun} = setup();
	vi.mocked(speedrun.getUserPersonalBests).mockResolvedValue([]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({state: "not_found"});
	expect(speedrun.getUserPersonalBests).toHaveBeenCalled();
});

it("matches official PBs by game, category, level, and only obsoleting Variables", async () => {
	const {service, speedrun, mapping, players} = setup();
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u1"]]]),
	);
	mapping.resolveSource.mockResolvedValue({
		...structuredClone(source),
		category: {
			...source.category,
			levelId: "l1",
			variables: {v1: "hard", v2: "casual"},
		},
	} as never);
	vi.mocked(speedrun.getCategoryVariables).mockResolvedValue([
		{
			id: "v1",
			name: "Mode",
			mandatory: false,
			userDefined: false,
			obsoletes: true,
			values: [{id: "hard", label: "Hard"}],
		},
		{
			id: "v2",
			name: "Cosmetic",
			mandatory: false,
			userDefined: false,
			obsoletes: false,
			values: [{id: "casual", label: "Casual"}],
		},
	]);
	vi.mocked(speedrun.getUserPersonalBests).mockResolvedValue([
		personalBest("wrong-game", "PT20S", 1, "u1", {
			gameId: "other-game",
			categoryId: "c1",
			levelId: "l1",
			variables: {v1: "hard"},
		}),
		personalBest("wrong-category", "PT20S", 1, "u1", {
			categoryId: "c2",
			levelId: "l1",
			variables: {v1: "hard"},
		}),
		personalBest("wrong-level", "PT20S", 1, "u1", {
			categoryId: "c1",
			levelId: "l2",
			variables: {v1: "hard"},
		}),
		personalBest("wrong-pb-variable", "PT20S", 1, "u1", {
			categoryId: "c1",
			levelId: "l1",
			variables: {v1: "easy", v2: "casual"},
		}),
		personalBest("official-pb", "PT55S", 12, "u1", {
			categoryId: "c1",
			levelId: "l1",
			variables: {v1: "hard", v2: "different-cosmetic"},
		}),
	]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(response.results?.[0]?.players[0]).toMatchObject({
		state: "found",
		run: {runId: "official-pb", place: 12},
	});
});

it("keeps Any PB groups separate and rejects duplicate matches within a group", async () => {
	const {service, speedrun, mapping, players} = setup();
	await configureAny(mapping, speedrun);
	vi.mocked(players.speedrunAccounts).mockResolvedValue(
		new Map([["p1", ["u1"]]]),
	);
	vi.mocked(speedrun.getUserPersonalBests).mockResolvedValue([
		personalBest("easy-pb-a", "PT50S", 5, "u1", {variables: {v1: "easy"}}),
		personalBest("easy-pb-b", "PT49S", 4, "u1", {variables: {v1: "easy"}}),
		personalBest("hard-pb", "PT40S", 9, "u1", {variables: {v1: "hard"}}),
	]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(
		response.results?.map(({players: values}) => values[0]?.state),
	).toEqual(["error", "found"]);
	expect(response.results?.[1]?.players[0]).toMatchObject({
		run: {runId: "hard-pb", place: 9},
	});
});

it("does not resolve a Player PB from another account when one account failed", async () => {
	const {service, speedrun} = setup();
	vi.mocked(speedrun.getUserPersonalBests).mockImplementation(
		async (userId) => {
			if (userId === "u2") throw new Error("SRC unavailable");
			return [personalBest("u1-pb", "PT45S", 8, userId)];
		},
	);
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
	vi.mocked(speedrun.getUserPersonalBests).mockRejectedValue(
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
	vi.mocked(speedrun.getUserPersonalBests).mockResolvedValue([
		personalBest("easy-pb-a", "PT50S", 1, "u1", {variables: {v1: "easy"}}),
		personalBest("easy-pb-b", "PT49S", 2, "u1", {variables: {v1: "easy"}}),
		personalBest("hard-pb", "PT40S", 3, "u1", {variables: {v1: "hard"}}),
	]);
	const response = await service.playerBests("race-game", "Any%", ["p1"]);
	expect(response.status).toBe("resolved");
	if (response.status !== "resolved") return;
	expect(
		response.results?.map(({players: results}) => results[0]?.state),
	).toEqual(["error", "found"]);
});

it("resolves PB value labels for fixed and Any variables without changing mapping labels", async () => {
	const {service, mapping, speedrun} = setup();
	await configureAny(mapping, speedrun);
	const definitions = await speedrun.getCategoryVariables();
	speedrun.getCategoryVariables.mockResolvedValue([
		...definitions,
		{
			id: "difficulty",
			name: "Difficulty",
			mandatory: true,
			userDefined: false,
			obsoletes: false,
			values: [{id: "hard", label: "Hard"}],
		},
	]);
	mapping.resolveSource.mockResolvedValue({
		...source,
		category: {
			...source.category,
			variables: {difficulty: "hard", v1: {mode: "any"}},
		},
	} as never);
	const response = await service.playerBests("game", "Any%", ["p1"]);
	if (response.status !== "resolved") throw new Error("not resolved");
	expect(response.results.map((result) => result.variableValues)).toEqual(
		definitions[0]!.values.map((option) => ["Hard", option.label]),
	);
	expect(response.results[0]!.mapping.label).toContain("Any%");
});
it("omits PB labels when no variables are mapped", async () => {
	const {service} = setup();
	const response = await service.playerBests("game", "Any%", ["p1"]);
	if (response.status !== "resolved") throw new Error("not resolved");
	expect(response.results[0]?.variableValues).toEqual([]);
});

it("fetches only the selected game and shares condition caches across Goal aliases", async () => {
	const {service, mapping, speedrun} = setup();
	mapping.resolveSource.mockResolvedValue({
		...source,
		game: {gameId: "g2", gameName: "Second"},
		category: {...source.category, categoryId: "c2"},
	});
	speedrun.getUserPersonalBests.mockImplementation(async (userId) => [
		personalBest("second", "PT2.030S", 1, userId, {
			gameId: "g2",
			categoryId: "c2",
		}),
	]);
	const first = await service.leaderboards("race-game", "Any%");
	const alias = await service.leaderboards("race-game", "Any Percent");
	expect(alias).toMatchObject({
		status: "resolved",
		mappings: [{game: {gameId: "g2"}}],
	});
	expect(speedrun.getLeaderboard).toHaveBeenCalledTimes(1);
	expect(speedrun.getLeaderboard.mock.calls[0]?.[0].game.gameId).toBe("g2");
	if (first.status !== "resolved" || alias.status !== "resolved")
		throw new Error("not resolved");
	expect(first.mappings[0]?.key).toBe(alias.mappings[0]?.key);
	const pb = await service.playerBests("race-game", "Any%", ["p1"]);
	await service.playerBests("race-game", "Any Percent", ["p1"]);
	expect(speedrun.getUserPersonalBests).toHaveBeenCalledTimes(2);
	expect(
		speedrun.getUserPersonalBests.mock.calls.map((call) => call[1]),
	).toEqual(["g2", "g2"]);
	expect(pb).toMatchObject({
		status: "resolved",
		results: [{players: [{state: "found", run: {time: "PT2.030S"}}]}],
	});
});
