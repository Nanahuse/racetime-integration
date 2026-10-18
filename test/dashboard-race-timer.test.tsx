// @vitest-environment jsdom
import type {Race, RaceState, RacesState} from "@nanahuse/racetime-protocol";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {Overview} from "../ui/dashboard/components/Overview";

const sendMessage = vi.fn();
const sendMessageToBundle = vi.fn();
const listenFor = vi.fn();
const unlisten = vi.fn();
(window as unknown as {nodecg: unknown}).nodecg = {
	sendMessage,
	sendMessageToBundle,
	listenFor,
	unlisten,
	Replicant: vi.fn(),
};

const NOW = Date.parse("2026-01-01T00:10:00.000Z");
const ISO = (milliseconds: number) => new Date(milliseconds).toISOString();

function race(overrides: Partial<Race> = {}): Race {
	return {
		raceId: "game/race",
		url: "https://racetime.gg/game/race",
		version: 1,
		name: "game/race",
		status: "in_progress",
		openedAt: ISO(NOW - 300_000),
		startedAt: ISO(NOW - 32_140),
		endedAt: null,
		cancelledAt: null,
		startDelay: "PT15S",
		timeLimit: "P1D",
		info: "",
		ranked: true,
		recordable: false,
		recorded: false,
		timeLimitAutoComplete: false,
		entrantsCount: 0,
		entrantsCountFinished: 0,
		entrantsCountInactive: 0,
		category: {slug: "game", name: "Game", goal: "Any%"},
		entrants: [],
		results: [],
		...overrides,
	};
}

function state(
	value: Race,
	connection: RaceState["connection"] = "connected",
): RaceState {
	return {
		revision: 1,
		raceRevision: 1,
		participantsRevision: 1,
		resolution: {state: "ready", raceRevision: 1, directoryRevision: 1},
		url: value.url,
		race: value,
		connection,
		error: null,
		participants: [],
	};
}

function racesFor(...states: RaceState[]): RacesState {
	return {schemaVersion: 1, races: states};
}

function listTimers(): string[] {
	return Array.from(document.querySelectorAll(".race-list-timer")).map(
		(node) => node.textContent ?? "",
	);
}

function detailTimer(): string {
	return document.querySelector(".race-timer-large")?.textContent ?? "";
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(NOW));
	sendMessage.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	sendMessage.mockReset();
	sendMessageToBundle.mockReset();
	listenFor.mockReset();
	unlisten.mockReset();
});

it("updates every monitored race from one shared interval", () => {
	const raceA = race();
	const raceB = race({
		raceId: "other/race2",
		url: "https://racetime.gg/other/race2",
		startedAt: ISO(NOW - 5_000),
	});
	render(<Overview races={racesFor(state(raceA), state(raceB))} />);
	expect(listTimers()).toEqual(["0:00:32", "0:00:05"]);

	act(() => {
		vi.advanceTimersByTime(1000);
	});
	expect(listTimers()).toEqual(["0:00:33", "0:00:06"]);
});

it("gives the list and the detail the same elapsed time", () => {
	render(<Overview races={racesFor(state(race()))} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(listTimers()).toEqual(["0:00:32"]);
	expect(detailTimer()).toBe("0:00:32.1");

	act(() => {
		vi.advanceTimersByTime(1000);
	});
	expect(listTimers()).toEqual(["0:00:33"]);
	expect(detailTimer()).toBe("0:00:33.1");
});

it("keeps counting from the stored start when switching selection", () => {
	const raceB = race({
		raceId: "other/race2",
		url: "https://racetime.gg/other/race2",
		startedAt: ISO(NOW - 5_000),
	});
	render(<Overview races={racesFor(state(race()), state(raceB))} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	act(() => {
		vi.advanceTimersByTime(2000);
	});
	expect(detailTimer()).toBe("0:00:34.1");

	fireEvent.click(screen.getByRole("button", {name: /other\/race2/}));
	act(() => {
		vi.advanceTimersByTime(1000);
	});
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(detailTimer()).toBe("0:00:35.1");
});

it("isolates finish and cancellation to the affected race", () => {
	const running = race();
	const finished = race({
		raceId: "game/finished",
		url: "https://racetime.gg/game/finished",
		status: "finished",
		startedAt: ISO(NOW - 3_600_000),
		endedAt: ISO(NOW - 60_000),
	});
	const cancelled = race({
		raceId: "game/cancelled",
		url: "https://racetime.gg/game/cancelled",
		status: "cancelled",
		startedAt: null,
		cancelledAt: ISO(NOW - 30_000),
	});
	render(
		<Overview
			races={racesFor(state(running), state(finished), state(cancelled))}
		/>,
	);
	expect(listTimers()).toEqual(["0:00:32", "0:59:00", "中止"]);

	act(() => {
		vi.advanceTimersByTime(1000);
	});
	expect(listTimers()).toEqual(["0:00:33", "0:59:00", "中止"]);
});

it("recomputes from the latest snapshot after reconnecting", () => {
	const view = render(
		<Overview races={racesFor(state(race(), "reconnecting"))} />,
	);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(screen.getByText(/最新の状態と同期されていない/)).toBeTruthy();
	expect(detailTimer()).toBe("0:00:32.1");

	view.rerender(
		<Overview
			races={racesFor(state(race({startedAt: ISO(NOW - 2_000)}), "connected"))}
		/>,
	);
	expect(screen.queryByText(/最新の状態と同期されていない/)).toBeNull();
	expect(detailTimer()).toBe("0:00:02.0");
});

it("switches a pending race from countdown to elapsed at its start time", () => {
	const start = NOW + 8_000;
	render(
		<Overview
			races={racesFor(state(race({status: "pending", startedAt: ISO(start)})))}
		/>,
	);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(listTimers()).toEqual(["-0:00:08"]);
	expect(detailTimer()).toBe("-0:00:08.0");
	expect(document.querySelector(".timer-label")?.textContent).toBe(
		"カウントダウン",
	);

	act(() => {
		vi.advanceTimersByTime(8_000);
	});
	expect(listTimers()).toEqual(["0:00:00"]);
	expect(detailTimer()).toBe("0:00:00.0");

	act(() => {
		vi.advanceTimersByTime(2_500);
	});
	expect(listTimers()).toEqual(["0:00:02"]);
	expect(detailTimer()).toBe("0:00:02.5");
	expect(document.querySelector(".timer-label")?.textContent).toBe("進行中");
});

it("clears its update interval when the Overview unmounts", () => {
	const view = render(<Overview races={racesFor(state(race()))} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(vi.getTimerCount()).toBeGreaterThan(0);
	view.unmount();
	expect(vi.getTimerCount()).toBe(0);
});
