// @vitest-environment jsdom
import type {
	Participant,
	Race,
	RaceState,
	RacesState,
	ResolvedRace,
} from "@nanahuse/racetime-protocol";
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
import {deferred} from "./fixtures";

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
			finishTime: "PT1H2M3S",
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
	results: [
		{
			userId: "user1",
			name: "Runner One",
			place: 1,
			time: "PT1H2M3S",
			status: "finished",
		},
		{
			userId: "user2",
			name: "Runner Two",
			place: null,
			time: null,
			status: "other",
		},
		{
			userId: "user3",
			name: "Runner Three",
			place: null,
			time: null,
			status: "other",
		},
	],
};

const participants: Participant[] = [
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
];

const resolved = (
	value: Race = race,
	list: Participant[] = participants,
	directoryRevision: number | null = 1,
): ResolvedRace => ({
	race: value,
	participants: list,
	resolution: {
		state: directoryRevision === null ? "error" : "ready",
		directoryRevision,
	},
});

const raceState: RaceState = {
	revision: 1,
	raceRevision: 1,
	participantsRevision: 1,
	resolution: {state: "ready", raceRevision: 1, directoryRevision: 1},
	url: race.url,
	race,
	connection: "connected",
	error: null,
	participants,
};
const races: RacesState = {schemaVersion: 1, races: [raceState]};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	sendMessage.mockReset();
	sendMessageToBundle.mockReset();
});

it("displays a single-fetched race with resolved participants without starting a watch", async () => {
	sendMessage.mockResolvedValue({ok: true, data: resolved()});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText(race.raceId)).toBeTruthy();
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	expect(screen.getByText("in_progress")).toBeTruthy();
	expect(screen.getByText("Player One")).toBeTruthy();
	const edit = screen.getByRole("link", {name: /編集/});
	expect(edit.getAttribute("href")).toContain("playerId=p1");
	expect(screen.getAllByRole("button", {name: "登録・紐付け"})).toHaveLength(1);
	expect(screen.getByText("Player Manager timed out")).toBeTruthy();
	expect(screen.getByText("1位")).toBeTruthy();
	expect(screen.getByText("PT1H2M3S")).toBeTruthy();
	expect(screen.getByText("finished")).toBeTruthy();
	const operations = sendMessage.mock.calls.map((call) => call[0]);
	expect(operations).toContain("racetime.v3.fetchRace");
	expect(operations).not.toContain("racetime.v3.watchRace");
});

it("shows an error and clears a stale result when fetching fails", async () => {
	sendMessage.mockResolvedValueOnce({ok: true, data: resolved()});
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

it("keeps RaceTime information when participant resolution fails", async () => {
	sendMessage.mockResolvedValue({
		ok: true,
		data: resolved(
			race,
			participants.map((participant) => ({
				...participant,
				status: "unavailable" as const,
				playerId: null,
				player: null,
				message: "Player Manager timed out",
			})),
			null,
		),
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText(race.raceId)).toBeTruthy();
	expect(screen.getByText(/参加者の解決に失敗しました/)).toBeTruthy();
	expect(screen.getByText("Runner Two")).toBeTruthy();
	expect(screen.getAllByText("Player Manager timed out")).toHaveLength(3);
});

it("opens registration without re-fetching and refreshes on demand", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	const before = resolved(race, [participants[1]!], 1);
	let fetches = 0;
	sendMessage.mockImplementation(async (name: string) => {
		if (name !== "racetime.v3.fetchRace")
			throw new Error(`unexpected operation ${name}`);
		fetches += 1;
		return {ok: true, data: fetches === 1 ? before : resolved()};
	});
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {
			registrationId: "r1",
			url: "/bundles/player-manager/Registration.html",
		},
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	expect(await screen.findByText(/登録画面を開きました/)).toBeTruthy();
	expect(sendMessageToBundle).toHaveBeenCalledWith(
		"player-manager.v3.beginRegistration",
		"player-manager",
		{input: {racetime: "user2"}, createPlayerOnEmpty: true},
	);
	expect(open).toHaveBeenCalledWith(
		"/bundles/player-manager/Registration.html",
		"_blank",
		"noopener,noreferrer",
	);
	// Opening the registration session must not re-run fetchRace.
	expect(fetches).toBe(1);

	fireEvent.click(screen.getByRole("button", {name: "再取得"}));
	expect(await screen.findByText("Player One")).toBeTruthy();
	expect(fetches).toBe(2);
});

it("ignores a registration result that settles after fetching another race", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	const otherRace: Race = {...race, raceId: "other/race"};
	let settleRegistration: (value: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				settleRegistration = resolve;
			}),
	);
	let fetches = 0;
	sendMessage.mockImplementation(async (name: string) => {
		if (name !== "racetime.v3.fetchRace")
			throw new Error(`unexpected operation ${name}`);
		fetches += 1;
		return {ok: true, data: fetches === 1 ? resolved() : resolved(otherRace)};
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("other/race")).toBeTruthy();

	await act(async () => {
		settleRegistration({
			ok: true,
			data: {
				registrationId: "r1",
				url: "/bundles/player-manager/Registration.html",
			},
		});
	});
	expect(open).not.toHaveBeenCalled();
	expect(screen.queryByText(/登録画面を開きました/)).toBeNull();
});

it("shows a registration error for the current race", async () => {
	vi.spyOn(window, "open").mockReturnValue(null);
	sendMessageToBundle.mockResolvedValue({
		ok: false,
		error: {code: "directory_unavailable", message: "down"},
	});
	sendMessage.mockResolvedValue({ok: true, data: resolved()});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));
	expect(await screen.findByText(/directory_unavailable/)).toBeTruthy();
});

it("does not surface a registration error after fetching another race", async () => {
	vi.spyOn(window, "open").mockReturnValue(null);
	let rejectRegistration: (reason: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectRegistration = reject;
			}),
	);
	sendMessage.mockResolvedValue({ok: true, data: resolved()});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await act(async () => {
		rejectRegistration(new Error("directory_unavailable: down"));
	});
	await waitFor(() =>
		expect(screen.queryByText(/directory_unavailable/)).toBeNull(),
	);
});

it("keeps a fetch busy when an older registration completes", async () => {
	vi.spyOn(window, "open").mockReturnValue(null);
	let rejectRegistration: (reason: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectRegistration = reject;
			}),
	);
	const pending = deferred<unknown>();
	let fetches = 0;
	sendMessage.mockImplementation((name: string) => {
		if (name !== "racetime.v3.fetchRace")
			throw new Error(`unexpected operation ${name}`);
		fetches += 1;
		return fetches === 1
			? Promise.resolve({ok: true, data: resolved()})
			: pending.promise;
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));
	fireEvent.click(screen.getByRole("button", {name: "再取得"}));
	expect(screen.getAllByRole("button", {name: "取得中…"})).toHaveLength(2);

	await act(async () => {
		rejectRegistration(new Error("registration failed"));
	});
	expect(screen.getAllByRole("button", {name: "取得中…"})).toHaveLength(2);

	await act(async () => {
		pending.resolve({ok: true, data: resolved()});
	});
});

it("renders an unset place as a dash instead of 位", () => {
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(screen.getByText("1位")).toBeTruthy();
	expect(screen.queryByText("—位")).toBeNull();
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
		if (name === "racetime.v3.fetchRace")
			return new Promise((resolve) => {
				resolveFetch = resolve;
			});
		return Promise.resolve({ok: true, data: resolved(fetchedRace)});
	});
	render(<Overview races={races} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	await act(async () => {
		resolveFetch({ok: true, data: resolved(fetchedRace)});
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
		if (name === "racetime.v3.fetchRace")
			return new Promise((_resolve, reject) => {
				rejectFetch = reject;
			});
		return Promise.resolve({ok: true, data: resolved(fetchedRace)});
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
