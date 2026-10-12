import {expect, it, vi} from "vitest";
import {HttpSpeedrunClient} from "../src/integrations/speedrun/client";

function clientWith(routes: Record<string, unknown>) {
	const fetchImpl = vi.fn(async (url: string) => {
		const path = new URL(url).pathname;
		if (!(path in routes)) return new Response("", {status: 404});
		const body = routes[path];
		return body instanceof Response ? body : Response.json(body);
	});
	return {
		fetchImpl,
		client: new HttpSpeedrunClient({
			fetchImpl: fetchImpl as never,
			userAgent: "test",
		}),
	};
}

const routes: Record<string, unknown> = {
	"/api/v1/games": {
		data: [{id: "g1", names: {international: "Game One"}, abbreviation: "G1"}],
		pagination: {size: 1},
	},
	"/api/v1/games/g1": {
		data: {
			id: "g1",
			names: {international: "Game One"},
			abbreviation: "G1",
			platforms: ["p1"],
			regions: ["r1"],
			ruleset: {"run-times": ["realtime", "ingame"]},
		},
	},
	"/api/v1/games/g1/categories": {
		data: [
			{id: "c1", name: "Any%", type: "per-game", miscellaneous: false},
			{id: "c2", name: "100%", type: "per-level", miscellaneous: true},
		],
		pagination: {size: 2},
	},
	"/api/v1/games/g1/levels": {
		data: [{id: "l1", name: "World 1"}],
		pagination: {size: 1},
	},
	"/api/v1/platforms": {
		data: [
			{id: "p1", name: "PC"},
			{id: "p2", name: "Console"},
		],
		pagination: {size: 2},
	},
	"/api/v1/regions": {
		data: [
			{id: "r1", name: "USA"},
			{id: "r2", name: "Japan"},
		],
		pagination: {size: 2},
	},
	"/api/v1/categories/c1/variables": {
		data: [
			{
				id: "v1",
				name: "Difficulty",
				mandatory: true,
				"user-defined": false,
				values: {values: {normal: {label: "Normal"}, hard: {label: "Hard"}}},
			},
		],
		pagination: {size: 1},
	},
	"/api/v1/categories/c1": {data: {id: "c1", game: "g1"}},
};

it("searches games by name through the Speedrun.com API", async () => {
	const {client, fetchImpl} = clientWith(routes);
	expect(await client.searchGames("mario")).toEqual([
		{id: "g1", name: "Game One", abbreviation: "G1"},
	]);
	const requested = new URL(fetchImpl.mock.calls[0]![0]);
	expect(requested.pathname).toBe("/api/v1/games");
	expect(requested.searchParams.get("name")).toBe("mario");
});

it("composes game options with categories, levels, supported platforms and regions", async () => {
	const {client} = clientWith(routes);
	const options = await client.getGameOptions("g1");
	expect(options.game).toMatchObject({id: "g1", name: "Game One"});
	expect(options.categories).toHaveLength(2);
	expect(options.levels).toEqual([{id: "l1", name: "World 1"}]);
	expect(options.platforms).toEqual([{id: "p1", name: "PC"}]);
	expect(options.regions).toEqual([{id: "r1", name: "USA"}]);
	expect(options.timingMethods).toEqual(["realtime", "ingame"]);
});

it("returns category variables with their selectable values and resolves the owning game", async () => {
	const {client} = clientWith(routes);
	expect(await client.getCategoryVariables("c1")).toEqual([
		{
			id: "v1",
			name: "Difficulty",
			mandatory: true,
			userDefined: false,
			values: [
				{id: "normal", label: "Normal"},
				{id: "hard", label: "Hard"},
			],
		},
	]);
	expect(await client.getCategoryGameId("c1")).toBe("g1");
});

it("maps missing resources to not_found and server failures to speedrun_unavailable", async () => {
	const {client} = clientWith({
		"/api/v1/games": new Response("", {status: 500}),
	});
	await expect(client.searchGames("x")).rejects.toMatchObject({
		code: "speedrun_unavailable",
	});
	await expect(client.getCategoryGameId("missing")).rejects.toMatchObject({
		code: "not_found",
	});
});

it("caches reference lookups while keeping distinct keys apart", async () => {
	const {client, fetchImpl} = clientWith(routes);
	await client.getGameOptions("g1");
	await client.getGameOptions("g1");
	expect(fetchImpl).toHaveBeenCalledTimes(5);
	await client.getCategoryVariables("c1");
	await client.getCategoryVariables("c1");
	expect(fetchImpl).toHaveBeenCalledTimes(6);
});
