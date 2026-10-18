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
} from "@nanahuse/racetime-protocol";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {Overview} from "../ui/dashboard/components/Overview";
import {formatRaceInstant} from "../ui/dashboard/model/race-time";
import {deferred} from "./fixtures";

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

const race: Race = {
	raceId: "game/race",
	url: "https://racetime.gg/game/race",
	version: 1,
	name: "game/race",
	status: "in_progress",
	openedAt: "2026-01-01T00:00:00Z",
	startedAt: "2026-01-01T00:00:15Z",
	endedAt: null,
	cancelledAt: null,
	startDelay: "PT15S",
	timeLimit: "P1D",
	info: "<b>Race details</b>",
	ranked: true,
	recordable: false,
	recorded: false,
	timeLimitAutoComplete: false,
	entrantsCount: 8,
	entrantsCountFinished: 1,
	entrantsCountInactive: 2,
	category: {slug: "game", name: "Game", goal: "Any%"},
	entrants: [
		{
			userId: "user1",
			name: "Runner One",
			twitchLogin: "runnerone",
			status: "done",
			finishTime: "PT1H2M3S",
			finishedAt: "2026-01-01T01:02:18Z",
			place: 1,
		},
		{
			userId: "user2",
			name: "Runner Two",
			twitchLogin: null,
			status: "in_progress",
			finishTime: null,
			finishedAt: null,
			place: null,
		},
		{
			userId: "user3",
			name: "Runner Three",
			twitchLogin: null,
			status: "in_progress",
			finishTime: null,
			finishedAt: null,
			place: null,
		},
	],
	results: [
		{
			userId: "user1",
			name: "Runner One",
			place: 1,
			time: "PT1H2M3S",
			finishedAt: "2026-01-01T01:02:18Z",
			status: "finished",
		},
		{
			userId: "user2",
			name: "Runner Two",
			place: null,
			time: null,
			finishedAt: null,
			status: "other",
		},
		{
			userId: "user3",
			name: "Runner Three",
			place: null,
			time: null,
			finishedAt: null,
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
	listenFor.mockReset();
	unlisten.mockReset();
});

it("shows live RaceTime status separately from Connection and participant revision, including missing snapshots", () => {
	const view = render(<Overview races={races} />);
	let row = screen.getByRole("button", {name: /game\/race/});
	expect(row.textContent).toContain("RaceTime: in_progress");
	expect(row.textContent).toContain("Connection: connected · E1");
	view.rerender(
		<Overview
			races={{
				schemaVersion: 1,
				races: [
					{
						...raceState,
						race: {...race, status: "pending"},
						connection: "reconnecting",
						participantsRevision: 4,
					},
				],
			}}
		/>,
	);
	row = screen.getByRole("button", {name: /game\/race/});
	expect(row.textContent).toContain("RaceTime: pending");
	expect(row.textContent).toContain("Connection: reconnecting · E4");
	view.rerender(
		<Overview
			races={{schemaVersion: 1, races: [{...raceState, race: null}]}}
		/>,
	);
	row = screen.getByRole("button", {name: /https:\/\/racetime.gg\/game\/race/});
	expect(row.textContent).toContain("RaceTime: 未取得");
	expect(sendMessage).not.toHaveBeenCalled();
});

it("subscribes to the five RaceTime events and renders them in receive order", () => {
	const view = render(<Overview races={undefined} />);
	expect(listenFor).toHaveBeenCalledTimes(5);
	for (const [name, bundle] of listenFor.mock.calls) {
		expect(bundle).toBe("racetime-integration");
		expect(name).toMatch(
			/^racetime\.v4\.(raceStartScheduled|raceStarted|entrantFinished|entrantFinishUndone|raceCancelled)$/,
		);
	}
	const emit = (event: string, data: unknown) => {
		const handler = listenFor.mock.calls.find((call) => call[0] === event)?.[2];
		if (typeof handler !== "function")
			throw new Error(`missing ${event} handler`);
		act(() => handler(data));
	};
	emit("racetime.v4.raceStartScheduled", {
		raceId: "game/race-001",
		startedAt: "2026-01-01T00:12:00Z",
	});
	emit("racetime.v4.raceStarted", {
		raceId: "game/race-001",
		startedAt: "2026-01-01T00:12:00Z",
	});
	emit("racetime.v4.entrantFinished", {
		raceId: "other/race-002",
		result: {userId: "runner1", time: "PT45M12S"},
	});
	emit("racetime.v4.entrantFinishUndone", {
		raceId: "game/race-001",
		userId: "runner1",
	});
	emit("racetime.v4.raceCancelled", {
		raceId: "game/race-001",
		cancelledAt: "2026-01-01T00:47:03Z",
	});
	const rows = screen
		.getByRole("heading", {name: "イベントログ"})
		.parentElement?.querySelectorAll("li");
	expect(rows).toHaveLength(5);
	expect(rows?.[0]?.textContent).toContain("raceStartScheduled");
	expect(rows?.[1]?.textContent).toContain("raceStarted");
	expect(rows?.[2]?.textContent).toContain("other/race-002");
	expect(rows?.[2]?.textContent).toContain("runner1");
	expect(rows?.[2]?.textContent).toContain("0:45:12");
	expect(rows?.[3]?.textContent).toContain("entrantFinishUndone");
	expect(rows?.[4]?.textContent).toContain("raceCancelled");
	expect(sendMessage).not.toHaveBeenCalled();
	view.unmount();
	expect(unlisten).toHaveBeenCalledTimes(5);
	for (const call of unlisten.mock.calls)
		expect(call[1]).toBe("racetime-integration");
	const reopened = render(<Overview races={undefined} />);
	expect(screen.getByText("受信したイベントはありません。")).toBeTruthy();
	expect(listenFor).toHaveBeenCalledTimes(10);
	reopened.unmount();
});

it("keeps only the newest 100 received events", () => {
	render(<Overview races={undefined} />);
	const handler = listenFor.mock.calls.find(
		(call) => call[0] === "racetime.v4.raceStarted",
	)?.[2];
	if (typeof handler !== "function")
		throw new Error("missing raceStarted handler");
	for (let index = 0; index < 101; index++) {
		act(() =>
			handler({
				raceId: `race-${index}`,
				startedAt: "2026-01-01T00:12:00Z",
			}),
		);
	}
	const rows = screen
		.getByRole("heading", {name: "イベントログ"})
		.parentElement?.querySelectorAll("li");
	expect(rows).toHaveLength(100);
	expect(rows?.[0]?.textContent).toContain("race-1");
	expect(rows?.[99]?.textContent).toContain("race-100");
});

it("adds an unmonitored URL once and selects it after the Replicant updates", async () => {
	sendMessage.mockImplementation(async (name: string) => {
		if (name === "racetime.v4.getRace") return {ok: true, data: null};
		if (name === "racetime.v4.watchRace")
			return {ok: true, data: {watchId: "watch-1", state: raceState}};
		throw new Error(`unexpected operation ${name}`);
	});
	const view = render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
	expect(sendMessage.mock.calls.map((call) => call[0])).toEqual([
		"racetime.v4.getRace",
		"racetime.v4.watchRace",
	]);
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "監視を追加"})).toBeTruthy(),
	);
	const addButton = screen.getByRole("button", {name: "監視を追加"});
	expect((addButton as HTMLButtonElement).disabled).toBe(false);
	expect(screen.queryByText("Game / Any%")).toBeNull();
	view.rerender(<Overview races={races} />);
	expect(await screen.findByText("Game / Any%")).toBeTruthy();
	expect(screen.getByRole("button", {name: /game\/race/}).className).toContain(
		"active",
	);
});

it("lets a new URL be added while an earlier Replicant update is pending", async () => {
	const base = mappingHandler({});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		if (name === "racetime.v4.getRace") return {ok: true, data: null};
		if (name === "racetime.v4.watchRace") {
			const url = (data as {url: string}).url;
			const state = url === raceB.url ? raceStateB : raceStateTwo;
			return {ok: true, data: {watchId: `watch-${url}`, state}};
		}
		return base(name, data);
	});
	const view = render(<Overview races={races} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: raceB.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "監視を追加"})).toBeTruthy(),
	);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: raceTwo.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() =>
		expect(
			sendMessage.mock.calls.filter(
				([name]) => name === "racetime.v4.watchRace",
			),
		).toHaveLength(2),
	);
	view.rerender(<Overview races={racesTwoWithRaceB} />);
	await waitFor(() =>
		expect(
			screen.getByRole("button", {name: /other\/race2/}).className,
		).toContain("active"),
	);
	expect(
		screen.getByRole("button", {name: /game\/race-b/}).className,
	).not.toContain("active");
});

it("keeps an explicit race selection ahead of a pending automatic selection", async () => {
	const base = mappingHandler({});
	const pendingWatch = deferred<unknown>();
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		if (name === "racetime.v4.getRace") return {ok: true, data: null};
		if (name === "racetime.v4.watchRace") return pendingWatch.promise;
		return base(name, data);
	});
	const view = render(<Overview races={racesTwo} />);
	await selectFirstMonitored();
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: raceB.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() =>
		expect(
			sendMessage.mock.calls.some(([name]) => name === "racetime.v4.watchRace"),
		).toBe(true),
	);
	fireEvent.click(screen.getByRole("button", {name: /other\/race2/}));
	await act(async () =>
		pendingWatch.resolve({
			ok: true,
			data: {watchId: "watch-b", state: raceStateB},
		}),
	);
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "監視を追加"})).toBeTruthy(),
	);
	view.rerender(<Overview races={racesTwoWithRaceB} />);
	expect(
		screen.getByRole("button", {name: /other\/race2/}).className,
	).toContain("active");
	expect(
		screen.getByRole("button", {name: /game\/race-b/}).className,
	).not.toContain("active");
});

it("keeps the Mapping editor and save in place while an added race is reflected", async () => {
	const games: GameMappingRecord[] = [];
	const pendingSave = deferred<unknown>();
	let submitted: GameMapping | null = null;
	const base = mappingHandler({
		games,
		categories: [],
		saveGame: (mapping) => {
			submitted = mapping;
			return pendingSave.promise;
		},
	});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		if (name === "racetime.v4.getRace") return {ok: true, data: null};
		if (name === "racetime.v4.watchRace")
			return {ok: true, data: {watchId: "watch-2", state: raceStateTwo}};
		return base(name, data);
	});
	const view = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	await screen.findByRole("button", {name: "保存中…"});
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: raceTwo.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "監視を追加"})).toBeTruthy(),
	);
	view.rerender(<Overview races={racesTwo} />);
	expect(screen.getByRole("button", {name: /game\/race/}).className).toContain(
		"active",
	);
	expect(screen.getByRole("button", {name: "保存中…"})).toBeTruthy();
	if (!submitted) throw new Error("Mapping save was not submitted");
	const record: GameMappingRecord = {mapping: submitted, revision: "g-saved"};
	games.push(record);
	await act(async () =>
		pendingSave.resolve({
			ok: true,
			data: {record, action: "created", settingsRevision: 0},
		}),
	);
	await waitFor(() =>
		expect(monitoredButton(raceTwo.raceId).className).toContain("active"),
	);
});

it("invalidates a pending automatic selection when monitoring is stopped", async () => {
	const base = mappingHandler({});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		if (name === "racetime.v4.getRace") return {ok: true, data: null};
		if (name === "racetime.v4.watchRace")
			return {ok: true, data: {watchId: "watch-b", state: raceStateB}};
		if (name === "racetime.v4.forceUnwatchRace")
			return {ok: true, data: {released: true, releasedWatches: 1}};
		return base(name, data);
	});
	const view = render(<Overview races={races} />);
	await selectFirstMonitored();
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: raceB.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() =>
		expect(
			sendMessage.mock.calls.some(([name]) => name === "racetime.v4.watchRace"),
		).toBe(true),
	);
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "監視を停止"})).toBeTruthy(),
	);
	fireEvent.click(screen.getByRole("button", {name: "監視を停止"}));
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "監視を停止",
		}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	view.rerender(<Overview races={racesWithRaceB} />);
	expect(monitoredButton(race.raceId).className).toContain("active");
	expect(monitoredButton(raceB.raceId).className).not.toContain("active");
});

it("selects an existing monitored URL without creating another watch", async () => {
	sendMessage.mockResolvedValue({ok: true, data: raceState});
	const view = render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
	expect(sendMessage).toHaveBeenCalledWith("racetime.v4.getRace", {
		url: race.url,
	});
	view.rerender(<Overview races={races} />);
	expect(await screen.findByText("Game / Any%")).toBeTruthy();
	expect(
		sendMessage.mock.calls.filter(
			(call) => call[0] === "racetime.v4.watchRace",
		),
	).toHaveLength(0);
});

it("does not stay busy when an existing race is removed before its lookup completes", async () => {
	const pendingLookup = deferred<unknown>();
	const base = mappingHandler({});
	sendMessage.mockImplementation((name: string, data?: unknown) =>
		name === "racetime.v4.getRace" ? pendingLookup.promise : base(name, data),
	);
	const view = render(<Overview races={races} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	view.rerender(<Overview races={{schemaVersion: 1, races: []}} />);
	await act(async () => pendingLookup.resolve({ok: true, data: raceState}));
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "監視を追加"})).toBeTruthy(),
	);
	expect(
		sendMessage.mock.calls.filter(([name]) => name === "racetime.v4.watchRace"),
	).toHaveLength(0);
	expect(screen.getByText("レースを選択してください。")).toBeTruthy();
});

it("prevents duplicate URL additions and preserves the current view on failure", async () => {
	const pending = deferred<unknown>();
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	sendMessage.mockClear();
	sendMessage.mockReturnValueOnce(pending.promise);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	const add = screen.getByRole("button", {name: "監視を追加"});
	fireEvent.click(add);
	fireEvent.click(add);
	expect(sendMessage).toHaveBeenCalledTimes(1);
	expect((add as HTMLButtonElement).disabled).toBe(true);
	await act(async () =>
		pending.resolve({
			ok: false,
			error: {code: "not_found", message: "missing"},
		}),
	);
	expect(await screen.findByText(/not_found: missing/)).toBeTruthy();
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	const retryAdd = screen.getByRole("button", {name: "監視を追加"});
	expect((retryAdd as HTMLButtonElement).disabled).toBe(false);
});

it("keeps a URL monitor when switching away is canceled for a dirty mapping", async () => {
	const base = mappingHandler({games: [], categories: []});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		if (name === "racetime.v4.getRace") return {ok: true, data: null};
		if (name === "racetime.v4.watchRace")
			return {ok: true, data: {watchId: "watch-2", state: raceStateTwo}};
		return base(name, data);
	});
	const view = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: raceTwo.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "監視を追加"}));
	await waitFor(() =>
		expect(sendMessage).toHaveBeenCalledWith("racetime.v4.watchRace", {
			url: raceTwo.url,
		}),
	);
	view.rerender(<Overview races={racesTwo} />);
	expect(
		await screen.findByText(/未保存のマッピング変更があります/),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: "キャンセル"}));
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(screen.getByRole("button", {name: /other\/race2/})).toBeTruthy();
	expect(screen.getByRole("button", {name: /game\/race/}).className).toContain(
		"active",
	);
});

it("shows force-release only for the selected monitored race and cancels without an RPC", () => {
	render(<Overview races={races} />);
	expect(screen.queryByRole("button", {name: "監視を停止"})).toBeNull();
	expect(screen.getByText("レースを選択してください。")).toBeTruthy();
	selectFirstMonitored();
	fireEvent.click(screen.getByRole("button", {name: "監視を停止"}));
	const dialog = screen.getByRole("dialog", {name: "監視を停止しますか？"});
	expect(within(dialog).getByText(`対象：${race.raceId}`)).toBeTruthy();
	expect(
		within(dialog).getByText(/他のバンドルが保持しているwatchIdも無効/),
	).toBeTruthy();
	expect(
		within(dialog).getByText(/RaceTime上のレース自体は変更されません/),
	).toBeTruthy();
	fireEvent.click(within(dialog).getByRole("button", {name: "キャンセル"}));
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(
		sendMessage.mock.calls.filter(
			([name]) => name === "racetime.v4.forceUnwatchRace",
		),
	).toHaveLength(0);
});

it.each([true, false])(
	"confirms force-release for the chosen URL and waits for Replicant removal (released: %s)",
	async (released) => {
		const otherRace: RaceState = {
			...raceState,
			url: "https://racetime.gg/game/other",
			race: {...race, raceId: "game/other"},
		};
		sendMessage.mockResolvedValue({
			ok: true,
			data: {released, releasedWatches: released ? 3 : 0},
		});
		const view = render(
			<Overview races={{schemaVersion: 1, races: [raceState, otherRace]}} />,
		);
		expect(screen.queryByRole("button", {name: "監視を停止"})).toBeNull();
		fireEvent.click(screen.getByRole("button", {name: /game\/other/}));
		fireEvent.click(screen.getByRole("button", {name: "監視を停止"}));
		expect(
			sendMessage.mock.calls.filter(
				([name]) => name === "racetime.v4.forceUnwatchRace",
			),
		).toHaveLength(0);
		expect(
			within(screen.getByRole("dialog")).getByText("対象：game/other"),
		).toBeTruthy();
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "監視を停止",
			}),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(
			sendMessage.mock.calls.filter(
				([name]) => name === "racetime.v4.forceUnwatchRace",
			),
		).toEqual([["racetime.v4.forceUnwatchRace", {url: otherRace.url}]]);
		expect(screen.getByRole("button", {name: /game\/other/})).toBeTruthy();
		view.rerender(<Overview races={races} />);
		expect(screen.queryByRole("button", {name: /game\/other/})).toBeNull();
		expect(screen.getByRole("button", {name: /game\/race/})).toBeTruthy();
		expect(screen.queryByRole("button", {name: "監視を停止"})).toBeNull();
	},
);

it("prevents duplicate monitor-stop submissions while the RPC is pending", async () => {
	const pending = deferred<unknown>();
	sendMessage.mockReturnValue(pending.promise);
	render(<Overview races={races} />);
	selectFirstMonitored();
	fireEvent.click(screen.getByRole("button", {name: "監視を停止"}));
	const confirm = within(screen.getByRole("dialog")).getByRole("button", {
		name: "監視を停止",
	});
	fireEvent.click(confirm);
	fireEvent.click(confirm);
	expect((confirm as HTMLButtonElement).disabled).toBe(true);
	expect(confirm.textContent).toBe("停止中…");
	expect(
		sendMessage.mock.calls.filter(
			([name]) => name === "racetime.v4.forceUnwatchRace",
		),
	).toEqual([["racetime.v4.forceUnwatchRace", {url: race.url}]]);
	await act(async () =>
		pending.resolve({ok: true, data: {released: true, releasedWatches: 1}}),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.getByRole("button", {name: /game\/race/})).toBeTruthy();
});

it("shows monitor-stop errors without removing the race and allows retry", async () => {
	let failNext = true;
	const base = mappingHandler({});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		if (name === "racetime.v4.forceUnwatchRace") {
			if (failNext) {
				failNext = false;
				return {
					ok: false,
					error: {code: "internal_error", message: "release failed"},
				};
			}
			return {ok: true, data: {released: true, releasedWatches: 1}};
		}
		return base(name, data);
	});
	render(<Overview races={races} />);
	selectFirstMonitored();
	fireEvent.click(screen.getByRole("button", {name: "監視を停止"}));
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "監視を停止",
		}),
	);
	expect(await screen.findByText(/release failed/)).toBeTruthy();
	expect(screen.getByRole("button", {name: /game\/race/})).toBeTruthy();
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "監視を停止",
		}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(
		sendMessage.mock.calls.filter(
			([name]) => name === "racetime.v4.forceUnwatchRace",
		),
	).toHaveLength(2);
});

it("displays and updates the same race details from monitored snapshots", async () => {
	sendMessage.mockResolvedValue({
		ok: true,
		data: {records: [], settingsRevision: 0},
	});
	const view = render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	expect(await screen.findByText(race.info)).toBeTruthy();
	expect(
		screen.getByText("制限時間", {selector: "dt"}).nextElementSibling
			?.textContent,
	).toBe("24:00:00");
	const updated: Race = {
		...race,
		endedAt: "2026-01-01T02:00:00Z",
		cancelledAt: "2026-01-01T02:00:00Z",
		info: "Updated description",
		recorded: true,
		recordable: true,
		timeLimitAutoComplete: true,
	};
	view.rerender(
		<Overview
			races={{
				schemaVersion: 1,
				races: [{...raceState, race: updated, revision: 2, raceRevision: 2}],
			}}
		/>,
	);
	expect(await screen.findByText("Updated description")).toBeTruthy();
	expect(
		screen.getByText("終了日時", {selector: "dt"}).nextElementSibling
			?.textContent,
	).toBe(formatRaceInstant(updated.endedAt));
	expect(
		screen.getByText("中止日時", {selector: "dt"}).nextElementSibling
			?.textContent,
	).toBe(formatRaceInstant(updated.cancelledAt));
	expect(
		screen.getByText("記録済み状態", {selector: "dt"}).nextElementSibling
			?.textContent,
	).toBe("記録済み");
	expect(
		screen.getByText("記録可能状態", {selector: "dt"}).nextElementSibling
			?.textContent,
	).toBe("可能");
	expect(
		screen.getByText("制限時間到達時", {selector: "dt"}).nextElementSibling
			?.textContent,
	).toBe("レースを完了");
});

it("shows a registration error for the current race", async () => {
	vi.spyOn(window, "open").mockReturnValue(null);
	sendMessageToBundle.mockResolvedValue({
		ok: false,
		error: {code: "directory_unavailable", message: "down"},
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));
	expect(await screen.findByText(/directory_unavailable/)).toBeTruthy();
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
		const operation = name.replace("racetime.v4.", "");
		const payload = data as {
			mapping?: GameMapping & CategoryMapping;
			expectedRevision?: string | null;
		};
		switch (operation) {
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
			case "getSpeedrunLeaderboards":
				return {ok: true, data: {status: "unregistered", mappings: []}};
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

const racesTwoWithRaceB: RacesState = {
	schemaVersion: 1,
	races: [raceState, raceStateTwo, raceStateB],
};
const racesWithRaceB: RacesState = {
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
	fireEvent.click(screen.getByRole("button", {name: "編集"}));
}

const updatedRace: Race = {...race, category: {...race.category, goal: "100%"}};
const updatedRaceState: RaceState = {...raceState, race: updatedRace};

async function editMappingDraft() {
	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
}

async function selectFirstMonitored() {
	const [firstRace] = screen.getAllByRole("button", {name: /game\/race/});
	fireEvent.click(firstRace!);
}

function monitoredButton(raceId: string) {
	return screen.getByText(raceId, {selector: "strong"}).closest("button")!;
}

it("loads Overview Leaderboards for the selected monitored race and after Mapping changes", async () => {
	const leaderboardRequests: unknown[] = [];
	const games: GameMappingRecord[] = [];
	const handler = mappingHandler({
		games,
		categories: [],
		saveGame: (mapping) => {
			const record: GameMappingRecord = {mapping, revision: "g-new"};
			games.splice(0, games.length, record);
			return {
				ok: true,
				data: {record, action: "created", settingsRevision: 0},
			};
		},
	});
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		if (name === "racetime.v4.getSpeedrunLeaderboards") {
			leaderboardRequests.push(data);
			return {ok: true, data: {status: "unregistered", mappings: []}};
		}
		return handler(name, data);
	});
	const view = render(<Overview races={races} />);
	expect(leaderboardRequests).toHaveLength(0);
	await selectFirstMonitored();
	await screen.findByText("Speedrun.com Leaderboard");
	await waitFor(() => expect(leaderboardRequests).toHaveLength(1));
	expect(leaderboardRequests[0]).toEqual({
		categorySlug: "game",
		goal: "Any%",
		refresh: false,
	});

	view.rerender(
		<Overview
			races={{
				schemaVersion: 1,
				races: [
					{...raceState, participantsRevision: 5, connection: "reconnecting"},
				],
			}}
		/>,
	);
	await act(async () => Promise.resolve());
	expect(leaderboardRequests).toHaveLength(1);

	await openMappingEditor();
	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "src"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: /SRC Game/}));
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(await screen.findByText("Game Mappingを保存しました。")).toBeTruthy();
	await waitFor(() => expect(leaderboardRequests).toHaveLength(2));
	expect(leaderboardRequests[1]).toEqual({
		categorySlug: "game",
		goal: "Any%",
		refresh: false,
	});
});

it("registers Game then Category mappings from Overview", async () => {
	const savedGames: GameMappingRecord[] = [];
	const savedCategories: CategoryMappingRecord[] = [];
	let leaderboardRequests = 0;
	const bestRequests: Array<{
		categorySlug: string;
		goal: string;
		playerIds: string[];
		refresh: boolean;
	}> = [];
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "getSpeedrunLeaderboards") {
			leaderboardRequests += 1;
			return {ok: true, data: {status: "unregistered", mappings: []}};
		}
		if (operation === "getSpeedrunPlayerBests") {
			bestRequests.push(data as (typeof bestRequests)[number]);
			return {ok: true, data: {status: "unregistered", mappings: []}};
		}
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
		if (operation === "deleteCategoryMapping") {
			savedCategories.splice(0, savedCategories.length);
			return {ok: true, data: {deleted: true, settingsRevision: 0}};
		}
		if (operation === "listGameMappings")
			return {ok: true, data: {records: savedGames, settingsRevision: 0}};
		if (operation === "listCategoryMappings")
			return {ok: true, data: {records: savedCategories, settingsRevision: 0}};
		return mappingHandler({})(name, data);
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));

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
	await waitFor(() => expect(leaderboardRequests).toBe(2));
	await waitFor(() => expect(bestRequests).toHaveLength(2));
	expect(bestRequests[1]?.refresh).toBe(false);

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
	await waitFor(() => expect(leaderboardRequests).toBe(3));
	await waitFor(() => expect(bestRequests).toHaveLength(3));
	expect(bestRequests[2]?.refresh).toBe(false);
	expect(screen.getByText("登録済み: SRC Game")).toBeTruthy();
	expect(screen.getByText("登録済み: Any%")).toBeTruthy();
	fireEvent.click(
		within(document.querySelector("form.category-editor")!).getByRole(
			"button",
			{
				name: "削除",
			},
		),
	);
	fireEvent.click(screen.getByRole("button", {name: "削除を確定"}));
	await waitFor(() => expect(leaderboardRequests).toBe(4));
	await waitFor(() => expect(bestRequests).toHaveLength(4));
	expect(bestRequests[3]?.refresh).toBe(false);
	expect(await screen.findAllByText("未登録")).toHaveLength(1);
	fireEvent.click(screen.getByRole("button", {name: "PBを再取得"}));
	await waitFor(() => expect(bestRequests).toHaveLength(5));
	expect(bestRequests[4]?.refresh).toBe(true);
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
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
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

it("selects Any from the Overview category editor like Mappings", async () => {
	let saved: CategoryMapping | null = null;
	const variables = [
		{
			id: "ruleset",
			name: "Ruleset",
			mandatory: false,
			userDefined: false,
			obsoletes: true,
			values: [
				{id: "classic", label: "Classic"},
				{id: "modern", label: "Modern"},
			],
		},
	];
	const handler = mappingHandler({
		games: [gameRecord],
		categories: [categoryRecord],
	});
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "getSpeedrunCategoryVariables")
			return {ok: true, data: {variables}};
		if (operation === "saveCategoryMapping") {
			saved = (data as {mapping: CategoryMapping}).mapping;
			return {
				ok: true,
				data: {
					record: {mapping: saved, revision: "c2r"},
					action: "updated",
					settingsRevision: 0,
				},
			};
		}
		return handler(name, data);
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	await openMappingEditor();
	const ruleset = (await screen.findByLabelText(
		"Ruleset（PB区分）",
	)) as HTMLSelectElement;
	const anyOption = Array.from(ruleset.options).find((option) =>
		option.textContent?.startsWith("Any"),
	);
	expect(anyOption).toBeTruthy();
	await act(async () => {
		fireEvent.change(ruleset, {target: {value: anyOption!.value}});
	});
	fireEvent.click(screen.getByRole("button", {name: /Category Mappingを保存/}));
	expect(
		await screen.findByText("Category Mappingを保存しました。"),
	).toBeTruthy();
	expect(saved).toMatchObject({
		speedrunCom: {variables: {ruleset: {mode: "any"}}},
	});
});

it("removes a deleted Variable from the Overview category editor", async () => {
	const ghostCategory: CategoryMappingRecord = {
		...categoryRecord,
		mapping: {
			...categoryRecord.mapping,
			speedrunCom: {
				...categoryRecord.mapping.speedrunCom,
				variables: {ghost: {mode: "any"}},
			},
		},
	};
	const handler = mappingHandler({
		games: [gameRecord],
		categories: [ghostCategory],
	});
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "getSpeedrunCategoryVariables")
			return {ok: true, data: {variables: []}};
		return handler(name, data);
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	await openMappingEditor();
	expect(await screen.findByText("ghost")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: "変数 ghost を削除"}));
	await waitFor(() => expect(screen.queryByText("ghost")).toBeNull());
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
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
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
			races={races}
			onStateChange={onStateChange}
		/>,
	);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
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

it("protects unsaved mapping edits when the monitored race target changes", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	rerender(<Overview races={{schemaVersion: 1, races: [updatedRaceState]}} />);
	expect(
		await screen.findByText(
			/未保存の変更を破棄して最新のレース情報を表示しますか/,
		),
	).toBeTruthy();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "編集を続ける"}));
	expect(
		screen.queryByText(/未保存の変更を破棄して最新のレース情報を表示しますか/),
	).toBeNull();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(
		screen.getByText(
			/監視中のレース情報が更新され、Mappingの対象が変更されました。/,
		),
	).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "最新状態を表示"}));
	expect(await screen.findByText("100%")).toBeTruthy();
});

it("protects unsaved mapping edits when force-release removes the monitored race from the Replicant", async () => {
	const base = mappingHandler({games: [], categories: []});
	sendMessage.mockImplementation((name: string, data?: unknown) =>
		name === "racetime.v4.forceUnwatchRace"
			? Promise.resolve({ok: true, data: {released: true, releasedWatches: 3}})
			: base(name, data),
	);
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "監視を停止"}));
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "監視を停止",
		}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	rerender(<Overview races={{schemaVersion: 1, races: []}} />);
	expect(screen.queryByRole("button", {name: "監視を停止"})).toBeNull();
	expect(
		await screen.findByText(/未保存の変更を破棄して表示を解除しますか/),
	).toBeTruthy();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "編集を続ける"}));
	expect(
		screen.queryByText(/未保存の変更を破棄して表示を解除しますか/),
	).toBeNull();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(
		screen.getByText(/監視中のレースが監視対象から削除されました。/),
	).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "表示を解除"}));
	expect(await screen.findByText("レースを選択してください。")).toBeTruthy();
});

it("keeps the draft on ordinary monitored updates without prompting", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	rerender(
		<Overview
			races={{
				schemaVersion: 1,
				races: [
					{
						...raceState,
						participantsRevision: 7,
						connection: "reconnecting",
					},
				],
			}}
		/>,
	);
	expect(screen.queryByText(/未保存の変更を破棄して/)).toBeNull();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
});

it("follows an external target change when there are no unsaved edits", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();

	rerender(<Overview races={{schemaVersion: 1, races: [updatedRaceState]}} />);
	expect(await screen.findByText("100%")).toBeTruthy();
	expect(screen.queryByText(/未保存の変更を破棄して/)).toBeNull();
});

it("does not switch the mapping target during a save triggered by an external update", async () => {
	const games: GameMappingRecord[] = [];
	let finishSave: (() => void) | null = null;
	sendMessage.mockImplementation(
		mappingHandler({
			games,
			categories: [],
			saveGame: (mapping) =>
				new Promise((resolve) => {
					finishSave = () => {
						const record = {mapping, revision: "g"};
						games.splice(0, games.length, record);
						resolve({
							ok: true,
							data: {record, action: "created", settingsRevision: 0},
						});
					};
				}),
		}),
	);
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "保存中…"})).toBeTruthy(),
	);

	rerender(<Overview races={{schemaVersion: 1, races: [updatedRaceState]}} />);
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(screen.queryByText(/未保存の変更を破棄して/)).toBeNull();

	await act(async () => {
		finishSave?.();
	});
	expect(await screen.findByText("100%")).toBeTruthy();
	expect(screen.getByText("登録済み: SRC Game")).toBeTruthy();
});

it("preserves an in-flight mapping save when force-release removes the selected race", async () => {
	const games: GameMappingRecord[] = [];
	const saved = deferred<unknown>();
	let submitted: GameMapping | null = null;
	const base = mappingHandler({
		games,
		categories: [],
		saveGame: (mapping) => {
			submitted = mapping;
			return saved.promise;
		},
	});
	sendMessage.mockImplementation((name: string, data?: unknown) =>
		name === "racetime.v4.forceUnwatchRace"
			? Promise.resolve({ok: true, data: {released: true, releasedWatches: 1}})
			: base(name, data),
	);
	const view = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	await screen.findByRole("button", {name: "保存中…"});
	fireEvent.click(screen.getByRole("button", {name: "監視を停止"}));
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "監視を停止",
		}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	view.rerender(<Overview races={{schemaVersion: 1, races: []}} />);
	expect(screen.getByRole("button", {name: "保存中…"})).toBeTruthy();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(screen.queryByText(/未保存の変更を破棄して/)).toBeNull();
	if (!submitted) throw new Error("Mapping save was not submitted");
	const record: GameMappingRecord = {mapping: submitted, revision: "saved"};
	games.push(record);
	await act(async () =>
		saved.resolve({
			ok: true,
			data: {record, action: "created", settingsRevision: 0},
		}),
	);
	expect(await screen.findByText("レースを選択してください。")).toBeTruthy();
	expect(screen.queryByRole("button", {name: "保存中…"})).toBeNull();
});

it("invalidates an in-flight registration when the monitored race is removed", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	let settleRegistration: (value: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				settleRegistration = resolve;
			}),
	);
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	rerender(<Overview races={{schemaVersion: 1, races: []}} />);
	expect(await screen.findByText("レースを選択してください。")).toBeTruthy();

	await act(async () => {
		settleRegistration({
			ok: true,
			data: {registrationId: "r1", url: "/Registration.html"},
		});
	});
	expect(screen.queryByText(/登録画面を開きました/)).toBeNull();
	expect(open).not.toHaveBeenCalled();
});

it("ignores a removed race's failed registration", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	let rejectRegistration: (reason: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectRegistration = reject;
			}),
	);
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	rerender(<Overview races={{schemaVersion: 1, races: []}} />);
	expect(await screen.findByText("レースを選択してください。")).toBeTruthy();

	await act(async () => {
		rejectRegistration(new Error("directory_unavailable: down"));
	});
	await waitFor(() =>
		expect(screen.queryByText(/directory_unavailable/)).toBeNull(),
	);
});

it("keeps the race and draft when editing continues after removal", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	let settleRegistration: (value: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				settleRegistration = resolve;
			}),
	);
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	rerender(<Overview races={{schemaVersion: 1, races: []}} />);
	expect(
		await screen.findByText(/未保存の変更を破棄して表示を解除しますか/),
	).toBeTruthy();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "編集を続ける"}));
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(screen.getByText("Game / Any%")).toBeTruthy();

	await act(async () => {
		settleRegistration({
			ok: true,
			data: {registrationId: "r1", url: "/Registration.html"},
		});
	});
	expect(await screen.findByText(/登録画面を開きました/)).toBeTruthy();
	expect(open).toHaveBeenCalled();
});

it("invalidates the registration after dismissing a removed race", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	let settleRegistration: (value: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				settleRegistration = resolve;
			}),
	);
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	rerender(<Overview races={{schemaVersion: 1, races: []}} />);
	expect(
		await screen.findByText(/未保存の変更を破棄して表示を解除しますか/),
	).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "表示を解除"}));
	expect(await screen.findByText("レースを選択してください。")).toBeTruthy();

	await act(async () => {
		settleRegistration({
			ok: true,
			data: {registrationId: "r1", url: "/Registration.html"},
		});
	});
	expect(screen.queryByText(/登録画面を開きました/)).toBeNull();
	expect(open).not.toHaveBeenCalled();
});

it("does not invalidate an in-flight registration on ordinary monitored updates", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	let settleRegistration: (value: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				settleRegistration = resolve;
			}),
	);
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	// A participantsRevision update and a same-race goal change.
	rerender(
		<Overview
			races={{
				schemaVersion: 1,
				races: [{...raceState, participantsRevision: 9, race: updatedRace}],
			}}
		/>,
	);
	expect(screen.queryByText(/未保存の変更を破棄して/)).toBeNull();

	await act(async () => {
		settleRegistration({
			ok: true,
			data: {registrationId: "r1", url: "/Registration.html"},
		});
	});
	expect(await screen.findByText(/登録画面を開きました/)).toBeTruthy();
	expect(open).toHaveBeenCalled();
});

it("does not treat a temporarily missing race snapshot as removal", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();

	rerender(
		<Overview
			races={{schemaVersion: 1, races: [{...raceState, race: null}]}}
		/>,
	);
	expect(screen.queryByText(/監視対象から削除されました/)).toBeNull();
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	expect(
		await screen.findByRole("button", {name: "登録・紐付け"}),
	).toBeTruthy();
});

it("keeps the display when the latest race snapshot is temporarily missing", async () => {
	sendMessage.mockImplementation(mappingHandler({games: [], categories: []}));
	const {rerender} = render(<Overview races={races} />);
	await selectFirstMonitored();
	await openMappingEditor();
	await editMappingDraft();
	expect(await screen.findByText(/選択中: SRC Game/)).toBeTruthy();

	// The goal changed externally, so the confirm dialog is shown.
	rerender(<Overview races={{schemaVersion: 1, races: [updatedRaceState]}} />);
	expect(
		await screen.findByText(
			/未保存の変更を破棄して最新のレース情報を表示しますか/,
		),
	).toBeTruthy();

	// The entry still exists but its snapshot is temporarily missing.
	rerender(
		<Overview
			races={{schemaVersion: 1, races: [{...raceState, race: null}]}}
		/>,
	);

	// Choosing 最新状態を表示 must not dismiss the display or the draft.
	fireEvent.click(screen.getByRole("button", {name: "最新状態を表示"}));
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	expect(screen.queryByText("レースを選択してください。")).toBeNull();

	// Once the latest snapshot is available it can be applied.
	rerender(<Overview races={{schemaVersion: 1, races: [updatedRaceState]}} />);
	fireEvent.click(await screen.findByRole("button", {name: "最新状態を表示"}));
	expect(await screen.findByText("100%")).toBeTruthy();
});
