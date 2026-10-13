// @vitest-environment jsdom
import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
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
	const otherRace: Race = {
		...race,
		raceId: "other/race",
		url: "https://racetime.gg/other/race",
	};
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
	const otherRace: Race = {
		...race,
		raceId: "other/race",
		url: "https://racetime.gg/other/race",
	};
	let rejectRegistration: (reason: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectRegistration = reject;
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

it("disables registration while another race is being fetched", async () => {
	const otherRace: Race = {
		...race,
		raceId: "other/race",
		url: "https://racetime.gg/other/race",
	};
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
	const register = await screen.findByRole("button", {name: "登録・紐付け"});
	expect((register as HTMLButtonElement).disabled).toBe(false);

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(
		(screen.getByRole("button", {name: "登録・紐付け"}) as HTMLButtonElement)
			.disabled,
	).toBe(true);

	await act(async () => {
		pending.resolve({ok: true, data: resolved(otherRace)});
	});
	expect(await screen.findByText("other/race")).toBeTruthy();
	expect(
		(screen.getByRole("button", {name: "登録・紐付け"}) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});

it("registers the same account after switching races without stale effects", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	const raceA: Race = {
		...race,
		raceId: "a/race",
		url: "https://racetime.gg/a/race",
	};
	const raceB: Race = {
		...race,
		raceId: "b/race",
		url: "https://racetime.gg/b/race",
	};
	const registrations: Array<(value: unknown) => void> = [];
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				registrations.push(resolve);
			}),
	);
	let fetches = 0;
	sendMessage.mockImplementation(async (name: string) => {
		if (name !== "racetime.v3.fetchRace")
			throw new Error(`unexpected operation ${name}`);
		fetches += 1;
		return {ok: true, data: resolved(fetches === 1 ? raceA : raceB)};
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/game/a"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("a/race")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: "登録・紐付け"}));
	expect(sendMessageToBundle).toHaveBeenCalledTimes(1);

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/game/b"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("b/race")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: "登録・紐付け"}));
	expect(sendMessageToBundle).toHaveBeenCalledTimes(2);

	await act(async () => {
		registrations[0]!({
			ok: true,
			data: {registrationId: "rA", url: "/RegistrationA.html"},
		});
	});
	expect(open).not.toHaveBeenCalled();
	expect(screen.queryByText(/登録画面を開きました/)).toBeNull();
	expect(screen.getByText("b/race")).toBeTruthy();

	await act(async () => {
		registrations[1]!({
			ok: true,
			data: {registrationId: "rB", url: "/RegistrationB.html"},
		});
	});
	expect(open).toHaveBeenCalledWith(
		"/RegistrationB.html",
		"_blank",
		"noopener,noreferrer",
	);
	expect(screen.getByText(/登録画面を開きました/)).toBeTruthy();
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

const fetchedRace: Race = {
	...race,
	raceId: "other/race",
	url: "https://racetime.gg/other/race",
};

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

const gameRecord: GameMappingRecord = {
	mapping: {
		racetime: {categorySlug: "game", categoryName: "Game"},
		speedrunCom: {gameId: "g1", gameName: "SRC Game"},
	},
	revision: "g1r",
};
const categoryRecord: CategoryMappingRecord = {
	mapping: {
		racetime: {categorySlug: "game", goal: "Any%"},
		speedrunCom: {
			categoryId: "c1",
			categoryName: "Any%",
			levelId: null,
			variables: {},
			platformId: null,
			regionId: null,
			emulator: null,
			timingMethod: null,
		},
	},
	revision: "c1r",
};

function mappingHandler(options: {
	games?: GameMappingRecord[];
	categories?: CategoryMappingRecord[];
	settingsRevision?: number;
	saveGame?: (mapping: GameMapping, expectedRevision: string | null) => unknown;
	saveCategory?: (
		mapping: CategoryMapping,
		expectedRevision: string | null,
	) => unknown;
}) {
	const games = options.games ?? [];
	const categories = options.categories ?? [];
	const settingsRevision = options.settingsRevision ?? 0;
	return async (name: string, data?: unknown): Promise<unknown> => {
		const operation = name.replace("racetime.v3.", "");
		const payload = data as {
			mapping?: GameMapping & CategoryMapping;
			expectedRevision?: string | null;
		};
		switch (operation) {
			case "fetchRace":
				return {ok: true, data: resolved()};
			case "listGameMappings":
				return {ok: true, data: {records: games, settingsRevision}};
			case "listCategoryMappings":
				return {ok: true, data: {records: categories, settingsRevision}};
			case "getSpeedrunGameOptions":
				return {
					ok: true,
					data: {
						game: {
							id: "g1",
							name: "SRC Game",
							abbreviation: "S",
							platformIds: [],
							regionIds: [],
							timingMethods: {
								realtime: true,
								realtimeNoLoads: false,
								ingame: false,
							},
						},
						categories: [
							{id: "c1", name: "Any%", type: "per-level", miscellaneous: false},
						],
						levels: [],
						platforms: [{id: "p1", name: "PC"}],
						regions: [],
						timingMethods: [],
					},
				};
			case "getSpeedrunCategoryVariables":
				return {ok: true, data: {variables: []}};
			case "searchSpeedrunGames":
				return {
					ok: true,
					data: {games: [{id: "g1", name: "SRC Game", abbreviation: "S"}]},
				};
			case "saveGameMapping":
				return options.saveGame
					? options.saveGame(
							payload.mapping as GameMapping,
							payload.expectedRevision ?? null,
						)
					: {ok: false, error: {code: "internal_error", message: "unexpected"}};
			case "saveCategoryMapping":
				return options.saveCategory
					? options.saveCategory(
							payload.mapping as CategoryMapping,
							payload.expectedRevision ?? null,
						)
					: {ok: false, error: {code: "internal_error", message: "unexpected"}};
			default:
				throw new Error(`unexpected operation ${operation}`);
		}
	};
}

const raceTwo: Race = {
	...race,
	raceId: "other/race2",
	url: "https://racetime.gg/other/race2",
	name: "other/race2",
	category: {slug: "other", name: "Other", goal: "100%"},
};
const raceStateTwo: RaceState = {...raceState, url: raceTwo.url, race: raceTwo};
const racesTwo: RacesState = {
	schemaVersion: 1,
	races: [raceState, raceStateTwo],
};

const raceB: Race = {
	...race,
	raceId: "game/race-b",
	url: "https://racetime.gg/game/race-b",
	name: "game/race-b",
};
const raceStateB: RaceState = {...raceState, url: raceB.url, race: raceB};
const racesSameTarget: RacesState = {
	schemaVersion: 1,
	races: [raceState, raceStateB],
};

async function openMappingEditor() {
	await waitFor(() =>
		expect(
			(screen.getByRole("button", {name: "編集"}) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	const button = screen.getByRole("button", {name: "編集"});
	fireEvent.click(button);
}

it("registers Game then Category mappings from Overview", async () => {
	const savedGames: GameMappingRecord[] = [];
	const savedCategories: CategoryMappingRecord[] = [];
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v3.", "");
		if (operation === "saveGameMapping") {
			const mapping = (data as {mapping: GameMapping}).mapping;
			const record: GameMappingRecord = {mapping, revision: "g-new"};
			savedGames.splice(0, savedGames.length, record);
			return {ok: true, data: {record, action: "created", settingsRevision: 0}};
		}
		if (operation === "saveCategoryMapping") {
			const mapping = (data as {mapping: CategoryMapping}).mapping;
			const record: CategoryMappingRecord = {mapping, revision: "c-new"};
			savedCategories.splice(0, savedCategories.length, record);
			return {ok: true, data: {record, action: "created", settingsRevision: 0}};
		}
		if (operation === "listGameMappings")
			return {ok: true, data: {records: savedGames, settingsRevision: 0}};
		if (operation === "listCategoryMappings")
			return {ok: true, data: {records: savedCategories, settingsRevision: 0}};
		return mappingHandler({})(name, data);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));

	expect(await screen.findByText("Speedrun.com マッピング")).toBeTruthy();
	expect(await screen.findAllByText("未登録")).toHaveLength(2);

	await openMappingEditor();
	const slug = (await screen.findByDisplayValue("game")) as HTMLInputElement;
	expect(slug.readOnly).toBe(true);
	expect(screen.getByDisplayValue("Game")).toBeTruthy();
	// Auto-filled RaceTime identifiers alone are not an unsaved change.
	expect(
		(screen.getByRole("button", {name: "Revert"}) as HTMLButtonElement)
			.disabled,
	).toBe(true);

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(await screen.findByText("Game Mappingを保存しました。")).toBeTruthy();

	const categorySelect = (await screen.findByLabelText(
		"SRC Category（必須）",
	)) as HTMLSelectElement;
	await act(async () => {
		fireEvent.change(categorySelect, {target: {value: "c1"}});
	});
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: /Category Mappingを保存/,
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", {name: /Category Mappingを保存/}));
	expect(
		await screen.findByText("Category Mappingを保存しました。"),
	).toBeTruthy();
	expect(screen.getByText("登録済み: SRC Game")).toBeTruthy();
	expect(screen.getByText("登録済み: Any%")).toBeTruthy();
});

it("shows existing mappings and updates with the saved revision", async () => {
	let savedExpected: string | null | undefined;
	sendMessage.mockImplementation(
		mappingHandler({
			games: [gameRecord],
			categories: [categoryRecord],
			saveCategory: (_mapping, expectedRevision) => {
				savedExpected = expectedRevision;
				return {
					ok: true,
					data: {
						record: categoryRecord,
						action: "updated",
						settingsRevision: 0,
					},
				};
			},
		}),
	);
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("登録済み: SRC Game")).toBeTruthy();
	expect(screen.getByText("登録済み: Any%")).toBeTruthy();

	await openMappingEditor();
	expect(
		((await screen.findByDisplayValue("game")) as HTMLInputElement).readOnly,
	).toBe(true);
	expect(
		(screen.getByLabelText("RaceTime Goal") as HTMLInputElement).readOnly,
	).toBe(true);

	const categorySelect = (await screen.findByLabelText(
		"SRC Category（必須）",
	)) as HTMLSelectElement;
	await waitFor(() => expect(categorySelect.disabled).toBe(false));
	const platform = (await screen.findByLabelText(
		"Platform",
	)) as HTMLSelectElement;
	await act(async () => {
		fireEvent.change(platform, {target: {value: "p1"}});
	});
	fireEvent.click(screen.getByRole("button", {name: /Category Mappingを保存/}));
	expect(
		await screen.findByText("Category Mappingを保存しました。"),
	).toBeTruthy();
	expect(savedExpected).toBe("c1r");
});

it("surfaces a mapping save conflict in Overview", async () => {
	const games: GameMappingRecord[] = [];
	sendMessage.mockImplementation(
		mappingHandler({
			games,
			categories: [],
			saveGame: () => {
				games.push({...gameRecord, revision: "g2r"});
				return {
					ok: false,
					error: {code: "mapping_conflict", message: "conflict"},
				};
			},
		}),
	);
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(
		await screen.findByRole("button", {name: /最新状態を採用/}),
	).toBeTruthy();
});

it("keeps race details and participants when mapping load fails", async () => {
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v3.", "");
		if (operation === "fetchRace") return {ok: true, data: resolved()};
		if (
			operation === "listGameMappings" ||
			operation === "listCategoryMappings"
		)
			return {
				ok: false,
				error: {code: "spreadsheet_unavailable", message: "no sheet"},
			};
		throw new Error(`unexpected operation ${operation}`);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText(race.raceId)).toBeTruthy();
	expect(screen.getByText("Player One")).toBeTruthy();
	expect(
		await screen.findByText(/マッピング情報を取得できませんでした/),
	).toBeTruthy();
	// A failed load must not be presented as unregistered.
	expect(screen.queryByText("未登録")).toBeNull();
});

it("asks before discarding unsaved mapping edits when switching races", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	render(<Overview races={racesTwo} />);
	const [firstRace] = screen.getAllByRole("button", {name: /game\/race/});
	fireEvent.click(firstRace!);
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	expect(screen.getByText("Game / Any%")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: /other\/race2/}));
	expect(
		await screen.findByText(/未保存のマッピング変更があります/),
	).toBeTruthy();
	// The pending change is not applied until the user approves it.
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: "キャンセル"}));
	expect(screen.queryByText(/未保存のマッピング変更があります/)).toBeNull();

	fireEvent.click(screen.getByRole("button", {name: /other\/race2/}));
	fireEvent.click(await screen.findByRole("button", {name: "破棄して移動"}));
	expect(await screen.findByText("Other / 100%")).toBeTruthy();
});

it("keeps the mapping edit session when switching to a race with the same target", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	render(<Overview races={racesSameTarget} />);
	const [firstRace] = screen.getAllByRole("button", {name: /game\/race/});
	fireEvent.click(firstRace!);
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: /game\/race-b/}));
	expect(screen.queryByText(/未保存のマッピング変更があります/)).toBeNull();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
});

it("does not switch the mapping target while a save is in progress", async () => {
	let finishSave: () => void = () => {};
	sendMessage.mockImplementation(
		mappingHandler({
			games: [],
			categories: [],
			saveGame: (mapping) =>
				new Promise((resolve) => {
					finishSave = () =>
						resolve({
							ok: true,
							data: {
								record: {mapping, revision: "g"},
								action: "created",
								settingsRevision: 0,
							},
						});
				}),
		}),
	);
	render(<Overview races={racesTwo} />);
	const [firstRace] = screen.getAllByRole("button", {name: /game\/race/});
	fireEvent.click(firstRace!);
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));

	fireEvent.click(screen.getByRole("button", {name: /other\/race2/}));
	expect(screen.queryByText(/未保存のマッピング変更があります/)).toBeNull();
	expect(screen.getByText("Game / Any%")).toBeTruthy();

	await act(async () => {
		finishSave();
	});
	expect(await screen.findByText("Game Mappingを保存しました。")).toBeTruthy();
});

it("reports unsaved mapping edits through onStateChange", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	const onStateChange = vi.fn();
	render(
		<Overview
			races={undefined}
			onStateChange={onStateChange}
		/>,
	);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	await waitFor(() =>
		expect(onStateChange).toHaveBeenLastCalledWith({
			dirty: true,
			busy: false,
		}),
	);
});

it("keeps the mapping draft when the monitored race refreshes", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	const {rerender} = render(<Overview races={races} />);
	const [firstRace] = screen.getAllByRole("button", {name: /game\/race/});
	fireEvent.click(firstRace!);
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	const refreshed: RacesState = {
		schemaVersion: 1,
		races: [{...raceState, participantsRevision: 5}],
	};
	rerender(<Overview races={refreshed} />);
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
});

it("does not apply a stale registration after fetching another race", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	let settleRegistration: (value: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				settleRegistration = resolve;
			}),
	);
	sendMessage.mockImplementation(async (name: string) => {
		if (name === "racetime.v3.fetchRace")
			return {ok: true, data: resolved(fetchedRace)};
		throw new Error(`unexpected operation ${name}`);
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	fireEvent.click(screen.getByRole("button", {name: "登録・紐付け"}));
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("other/race")).toBeTruthy();

	await act(async () => {
		settleRegistration({
			ok: true,
			data: {registrationId: "r1", url: "/Registration.html"},
		});
	});
	expect(open).not.toHaveBeenCalled();
	expect(screen.queryByText(/登録画面を開きました/)).toBeNull();
	expect(screen.getByText("other/race")).toBeTruthy();
});

it("does not surface a stale registration error after fetching another race", async () => {
	let rejectRegistration: (reason: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectRegistration = reject;
			}),
	);
	sendMessage.mockImplementation(async (name: string) => {
		if (name === "racetime.v3.fetchRace")
			return {ok: true, data: resolved(fetchedRace)};
		throw new Error(`unexpected operation ${name}`);
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	fireEvent.click(screen.getByRole("button", {name: "登録・紐付け"}));
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("other/race")).toBeTruthy();

	await act(async () => {
		rejectRegistration(new Error("directory_unavailable: down"));
	});
	await waitFor(() =>
		expect(screen.queryByText(/directory_unavailable/)).toBeNull(),
	);
});

it("registers participants for a newly fetched race", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {registrationId: "r1", url: "/Registration.html"},
	});
	sendMessage.mockImplementation(async (name: string) => {
		if (name === "racetime.v3.fetchRace")
			return {ok: true, data: resolved(fetchedRace)};
		throw new Error(`unexpected operation ${name}`);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("other/race")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "登録・紐付け"}));
	expect(await screen.findByText(/登録画面を開きました/)).toBeTruthy();
	expect(open).toHaveBeenCalledWith(
		"/Registration.html",
		"_blank",
		"noopener,noreferrer",
	);
});

it("disables editing until the mapping lists have loaded", async () => {
	const listPending = deferred<unknown>();
	sendMessage.mockImplementation((name: string) => {
		const operation = name.replace("racetime.v3.", "");
		if (operation === "fetchRace")
			return Promise.resolve({ok: true, data: resolved()});
		if (
			operation === "listGameMappings" ||
			operation === "listCategoryMappings"
		)
			return listPending.promise;
		throw new Error(`unexpected operation ${operation}`);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	const edit = await screen.findByRole("button", {name: "編集"});
	expect((edit as HTMLButtonElement).disabled).toBe(true);

	await act(async () => {
		listPending.resolve({
			ok: true,
			data: {records: [], settingsRevision: 0},
		});
	});
	await waitFor(() =>
		expect(
			(screen.getByRole("button", {name: "編集"}) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
});

it("keeps editing disabled after a mapping load failure and recovers on reload", async () => {
	let failLists = true;
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v3.", "");
		if (operation === "fetchRace") return {ok: true, data: resolved()};
		if (operation === "listGameMappings")
			return failLists
				? {
						ok: false,
						error: {code: "spreadsheet_unavailable", message: "down"},
					}
				: {ok: true, data: {records: [gameRecord], settingsRevision: 0}};
		if (operation === "listCategoryMappings")
			return failLists
				? {
						ok: false,
						error: {code: "spreadsheet_unavailable", message: "down"},
					}
				: {ok: true, data: {records: [], settingsRevision: 0}};
		throw new Error(`unexpected operation ${operation}`);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(
		await screen.findByText(/マッピング情報を取得できませんでした/),
	).toBeTruthy();
	expect(
		(screen.getByRole("button", {name: "編集"}) as HTMLButtonElement).disabled,
	).toBe(true);

	failLists = false;
	fireEvent.click(screen.getByRole("button", {name: "保存先から再読込"}));
	await waitFor(() =>
		expect(
			(screen.getByRole("button", {name: "編集"}) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	expect(await screen.findByText("登録済み: SRC Game")).toBeTruthy();
});

it("keeps unsaved mapping edits when fetching another race fails", async () => {
	let fetches = 0;
	const base = mappingHandler({games: [], categories: []});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		const operation = name.replace("racetime.v3.", "");
		if (operation === "fetchRace") {
			fetches += 1;
			return fetches === 1
				? Promise.resolve({ok: true, data: resolved()})
				: Promise.resolve({
						ok: false,
						error: {code: "not_found", message: "missing"},
					});
		}
		return base(name, data);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText(/not_found/)).toBeTruthy();
	expect(screen.getByText("game/race")).toBeTruthy();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
});

it("does not switch races when a fetch result arrives during a mapping save", async () => {
	const otherCategory: Race = {
		...race,
		raceId: "other/race",
		url: "https://racetime.gg/other/race",
		category: {slug: "other", name: "Other", goal: "100%"},
	};
	const pendingFetch = deferred<unknown>();
	let finishSave: (() => void) | null = null;
	const base = mappingHandler({
		games: [],
		categories: [],
		saveGame: (mapping) =>
			new Promise((resolve) => {
				finishSave = () =>
					resolve({
						ok: true,
						data: {
							record: {mapping, revision: "g"},
							action: "created",
							settingsRevision: 0,
						},
					});
			}),
	});
	let fetches = 0;
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		const operation = name.replace("racetime.v3.", "");
		if (operation === "fetchRace") {
			fetches += 1;
			return fetches === 1
				? Promise.resolve({ok: true, data: resolved()})
				: pendingFetch.promise;
		}
		return base(name, data);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "保存中…"})).toBeTruthy(),
	);

	await act(async () => {
		pendingFetch.resolve({ok: true, data: resolved(otherCategory)});
	});
	expect(screen.getByText("game/race")).toBeTruthy();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();

	await act(async () => {
		finishSave?.();
	});
	expect(await screen.findByText("Game Mappingを保存しました。")).toBeTruthy();
});

it("cannot confirm a pending race switch while a save is in progress", async () => {
	let finishSave: (() => void) | null = null;
	sendMessage.mockImplementation(
		mappingHandler({
			games: [],
			categories: [],
			saveGame: (mapping) =>
				new Promise((resolve) => {
					finishSave = () =>
						resolve({
							ok: true,
							data: {
								record: {mapping, revision: "g"},
								action: "created",
								settingsRevision: 0,
							},
						});
				}),
		}),
	);
	render(<Overview races={racesTwo} />);
	const [firstRace] = screen.getAllByRole("button", {name: /game\/race/});
	fireEvent.click(firstRace!);
	await openMappingEditor();

	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));

	fireEvent.click(screen.getByRole("button", {name: /other\/race2/}));
	expect(
		await screen.findByText(/未保存のマッピング変更があります/),
	).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "保存中…"})).toBeTruthy(),
	);

	fireEvent.click(screen.getByRole("button", {name: "破棄して移動"}));
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	expect(screen.getByText(/未保存のマッピング変更があります/)).toBeTruthy();

	await act(async () => {
		finishSave?.();
	});
});
