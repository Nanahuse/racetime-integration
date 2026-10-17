import type {CategoryMapping, GameMapping} from "@nanahuse/racetime-protocol";
import {vi} from "vitest";
import {parseRaceDetail} from "../src/integrations/racetime/client";
import type {Socket} from "../src/integrations/racetime/watcher";

export const url = "https://racetime.gg/game/race";
export const payload = (
	version = 1,
	race = "race",
	status = "in_progress",
) => ({
	version,
	name: `game/${race}`,
	slug: race,
	status: {value: status},
	opened_at: "2026-01-01T00:00:00Z",
	started_at: status === "open" ? null : "2026-01-01T00:00:15Z",
	ended_at:
		status === "finished" || status === "cancelled"
			? "2026-01-01T02:00:00Z"
			: null,
	cancelled_at: status === "cancelled" ? "2026-01-01T02:00:00Z" : null,
	start_delay: "PT15S",
	time_limit: "P1D",
	info: "Race information",
	ranked: true,
	recordable: status === "finished",
	recorded: false,
	time_limit_auto_complete: false,
	entrants_count: 5,
	entrants_count_finished: status === "open" ? 0 : 1,
	entrants_count_inactive: 2,
	url: `/game/${race}`,
	data_url: `/game/${race}/data`,
	websocket_url: `/ws/race/${race}`,
	category: {slug: "game", name: "Game"},
	goal: {name: "Any%"},
	entrants: [
		{
			user: {id: "user1", name: "Runner", twitch_name: "runner"},
			status: {value: status === "open" ? "not_ready" : "done"},
			finish_time: status === "open" ? null : "PT1H2M3.45S",
			finished_at: status === "open" ? null : "2026-01-01T01:02:18.45Z",
			place: status === "open" ? null : 1,
		},
	],
});
export const dto = (version = 1, race = "race", status = "in_progress") =>
	parseRaceDetail(payload(version, race, status));
export const gameMapping: GameMapping = {
	racetime: {categorySlug: "game", categoryName: "Game"},
	speedrunCom: {gameId: "g1", gameName: "Game"},
};
export const mapping: CategoryMapping = {
	racetime: {categorySlug: "game", goal: "Any%"},
	speedrunCom: {
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
