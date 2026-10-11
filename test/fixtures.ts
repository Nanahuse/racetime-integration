import type {CategoryMapping} from "@nanahuse/racetime-protocol";
import {vi} from "vitest";
import {parseRaceDetail} from "../src/integrations/racetime/client";
import type {Socket} from "../src/integrations/racetime/watcher";

export const url = "https://racetime.gg/game/race";
export const payload = (version = 1, race = "race") => ({
	version,
	name: `game/${race}`,
	slug: race,
	status: {value: "in_progress"},
	url: `/game/${race}`,
	data_url: `/game/${race}/data`,
	websocket_url: `/ws/race/${race}`,
	category: {slug: "game", name: "Game"},
	goal: {name: "Any%"},
	entrants: [
		{
			user: {id: "user1", name: "Runner", twitch_name: "runner"},
			status: {value: "done"},
			finish_time: "PT1H2M3.45S",
			place: 1,
		},
	],
});
export const dto = (version = 1, race = "race") =>
	parseRaceDetail(payload(version, race));
export const mapping: CategoryMapping = {
	racetime: {categorySlug: "game", categoryName: "Game", goal: "Any%"},
	speedrunCom: {
		gameId: "g1",
		gameName: "Game",
		categoryId: "c1",
		categoryName: "Any%",
		levelId: null,
		variables: {difficulty: "normal"},
		platformId: null,
		regionId: null,
		emulator: false,
		timingMethod: "realtime",
	},
};
export class FakeSocket implements Socket {
	onopen: Socket["onopen"] = null;
	onmessage: Socket["onmessage"] = null;
	onclose: Socket["onclose"] = null;
	onerror: Socket["onerror"] = null;
	close = vi.fn();
	open() {
		this.onopen?.(new Event("open"));
	}
	message(data: string) {
		this.onmessage?.(new MessageEvent("message", {data}));
	}
	fail() {
		this.onerror?.(new Event("error"));
	}
}
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
}
export const flush = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};
