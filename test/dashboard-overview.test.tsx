// @vitest-environment jsdom
import type {Race, RaceState, RacesState} from "@nanahuse/racetime-protocol";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {Overview} from "../ui/dashboard/components/Overview";

const sendMessage = vi.fn();
const sendMessageToBundle = vi.fn();
(window as unknown as {nodecg: unknown}).nodecg = {
	sendMessage,
	sendMessageToBundle,
	Replicant: vi.fn(),
};

const race: Race = {
	raceId: "game/race",
	url: "https://racetime.gg/game/race",
	version: 1,
	name: "game/race",
	status: "in_progress",
	category: {slug: "game", name: "Game", goal: "Any%"},
	entrants: [
		{
			userId: "user1",
			name: "Runner One",
			twitchLogin: "runnerone",
			status: "done",
			finishTime: null,
			place: 1,
		},
		{
			userId: "user2",
			name: "Runner Two",
			twitchLogin: null,
			status: "in_progress",
			finishTime: null,
			place: null,
		},
		{
			userId: "user3",
			name: "Runner Three",
			twitchLogin: null,
			status: "in_progress",
			finishTime: null,
			place: null,
		},
	],
	results: [],
};

const raceState: RaceState = {
	revision: 1,
	raceRevision: 1,
	participantsRevision: 1,
	resolution: {state: "ready", raceRevision: 1, directoryRevision: 1},
	url: race.url,
	race,
	connection: "connected",
	error: null,
	participants: [
		{
			racetimeUserId: "user1",
			status: "matched",
			playerId: "p1",
			player: {
				playerId: "p1",
				revision: 1,
				displayName: "Player One",
				racetime: {userId: "user1", name: "Runner One"},
				speedrunCom: null,
				twitch: null,
				youtube: null,
			},
			message: "",
		},
		{
			racetimeUserId: "user2",
			status: "unresolved",
			playerId: null,
			player: null,
			message: "No Player is linked to this RaceTime account",
		},
		{
			racetimeUserId: "user3",
			status: "unavailable",
			playerId: null,
			player: null,
			message: "Player Manager timed out",
		},
	],
};
const races: RacesState = {schemaVersion: 1, races: [raceState]};

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
	sendMessageToBundle.mockReset();
});

it("displays a single-fetched race without starting a watch", async () => {
	sendMessage.mockResolvedValue({ok: true, data: race});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText(race.raceId)).toBeTruthy();
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	expect(screen.getByText("in_progress")).toBeTruthy();
	expect(screen.getByText("Runner One")).toBeTruthy();
	const operations = sendMessage.mock.calls.map((call) => call[0]);
	expect(operations).toContain("racetime.v2.fetchRace");
	expect(operations).not.toContain("racetime.v2.watchRace");
});

it("shows an error and clears a stale result when fetching fails", async () => {
	sendMessage.mockResolvedValueOnce({ok: true, data: race});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await screen.findByText(race.raceId);
	sendMessage.mockResolvedValueOnce({
		ok: false,
		error: {code: "not_found", message: "missing"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText(/not_found/)).toBeTruthy();
	await waitFor(() => expect(screen.queryByText(race.raceId)).toBeNull());
});

it("shows participant actions by resolution status and RaceTime names from entrants", () => {
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(screen.getByText("Runner Two")).toBeTruthy();
	expect(screen.getByText("Runner Three")).toBeTruthy();
	const edit = screen.getByRole("link", {name: /編集/});
	expect(edit.getAttribute("href")).toContain("PlayerMapping.html");
	expect(edit.getAttribute("href")).toContain("playerId=p1");
	expect(screen.getAllByRole("button", {name: "登録・紐付け"})).toHaveLength(1);
	expect(screen.getByText("Player Manager timed out")).toBeTruthy();
});

const fetchedRace: Race = {...race, raceId: "other/race"};

it("keeps a monitored selection when a pending fetch resolves later", async () => {
	let resolveFetch: (value: unknown) => void = () => {};
	sendMessage.mockImplementation((name: string) => {
		if (name === "racetime.v2.fetchRace")
			return new Promise((resolve) => {
				resolveFetch = resolve;
			});
		return Promise.resolve({ok: true, data: fetchedRace});
	});
	render(<Overview races={races} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	await act(async () => {
		resolveFetch({ok: true, data: fetchedRace});
	});
	expect(screen.getByText("Player One")).toBeTruthy();
	expect(screen.queryByText("other/race")).toBeNull();
	expect(
		(screen.getByRole("button", {name: "取得"}) as HTMLButtonElement).disabled,
	).toBe(false);
});

it("ignores a failed fetch that settles after selecting a monitored race", async () => {
	let rejectFetch: (reason: unknown) => void = () => {};
	sendMessage.mockImplementation((name: string) => {
		if (name === "racetime.v2.fetchRace")
			return new Promise((_resolve, reject) => {
				rejectFetch = reject;
			});
		return Promise.resolve({ok: true, data: fetchedRace});
	});
	render(<Overview races={races} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	await act(async () => {
		rejectFetch(new Error("boom"));
	});
	await waitFor(() => expect(screen.queryByText(/boom/)).toBeNull());
	expect(screen.getByText("Player One")).toBeTruthy();
});
