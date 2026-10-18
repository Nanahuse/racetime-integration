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
	within,
} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {Overview} from "../ui/dashboard/components/Overview";
import {formatRaceInstant} from "../ui/dashboard/model/race-time";
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

it("cancels force-release without selecting the race or sending an RPC", () => {
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: "強制解除"}));
	const dialog = screen.getByRole("dialog", {name: "監視を強制解除しますか？"});
	expect(within(dialog).getByText(`対象：${race.raceId}`)).toBeTruthy();
	expect(
		within(dialog).getByText(/他のバンドルが保持しているwatchIdも無効/),
	).toBeTruthy();
	expect(
		within(dialog).getByText(/RaceTime上のレース自体は変更されません/),
	).toBeTruthy();
	expect(screen.getByText(/レースを選択するかURLで取得/)).toBeTruthy();
	fireEvent.click(within(dialog).getByRole("button", {name: "キャンセル"}));
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(sendMessage).not.toHaveBeenCalled();
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
		const row = screen
			.getByRole("button", {name: /game\/other/})
			.closest("li")!;
		fireEvent.click(within(row).getByRole("button", {name: "強制解除"}));
		expect(sendMessage).not.toHaveBeenCalled();
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "強制解除",
			}),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
			"racetime.v4.forceUnwatchRace",
			{url: otherRace.url},
		);
		expect(screen.getByRole("button", {name: /game\/other/})).toBeTruthy();
		view.rerender(<Overview races={races} />);
		expect(screen.queryByRole("button", {name: /game\/other/})).toBeNull();
		expect(screen.getByRole("button", {name: /game\/race/})).toBeTruthy();
	},
);

it("prevents duplicate force-release submissions while the RPC is pending", async () => {
	const pending = deferred<unknown>();
	sendMessage.mockReturnValue(pending.promise);
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: "強制解除"}));
	const confirm = within(screen.getByRole("dialog")).getByRole("button", {
		name: "強制解除",
	});
	fireEvent.click(confirm);
	fireEvent.click(confirm);
	expect((confirm as HTMLButtonElement).disabled).toBe(true);
	expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
		"racetime.v4.forceUnwatchRace",
		{url: race.url},
	);
	await act(async () =>
		pending.resolve({ok: true, data: {released: true, releasedWatches: 1}}),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.getByRole("button", {name: /game\/race/})).toBeTruthy();
});

it("shows force-release errors without removing the race and allows retry", async () => {
	sendMessage.mockResolvedValueOnce({
		ok: false,
		error: {code: "internal_error", message: "release failed"},
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: "強制解除"}));
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {name: "強制解除"}),
	);
	expect(await screen.findByText(/release failed/)).toBeTruthy();
	expect(screen.getByRole("button", {name: /game\/race/})).toBeTruthy();
	sendMessage.mockResolvedValueOnce({
		ok: true,
		data: {released: true, releasedWatches: 1},
	});
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {name: "強制解除"}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(sendMessage).toHaveBeenCalledTimes(2);
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
	expect(screen.getByText("1:02:03")).toBeTruthy();
	expect(screen.getByText("finished")).toBeTruthy();
	const detail = (label: string) =>
		screen.getByText(label, {selector: "dt"}).nextElementSibling?.textContent;
	expect(detail("作成日時")).toBe(formatRaceInstant(race.openedAt));
	expect(detail("開始日時")).toBe(formatRaceInstant(race.startedAt));
	expect(detail("終了日時")).toBe("未設定");
	expect(detail("中止日時")).toBe("未設定");
	expect(detail("カウントダウン")).toBe("0:00:15");
	expect(detail("制限時間")).toBe("24:00:00");
	expect(detail("Entrants")).toBe("8");
	expect(detail("完走人数")).toBe("1");
	expect(detail("DNF / DQ人数")).toBe("2");
	expect(detail("記録対象設定")).toBe("有効");
	expect(detail("記録可能状態")).toBe("不可");
	expect(detail("記録済み状態")).toBe("未記録");
	expect(detail("制限時間到達時")).toBe("レースを中止");
	expect(screen.getByText(race.info).querySelector("b")).toBeNull();
	expect(
		screen.getByText(
			`完走日時: ${formatRaceInstant(race.results[0]!.finishedAt)}`,
		),
	).toBeTruthy();
	const operations = sendMessage.mock.calls.map((call) => call[0]);
	expect(operations).toContain("racetime.v4.fetchRace");
	expect(operations).not.toContain("racetime.v4.watchRace");
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
		if (name !== "racetime.v4.fetchRace")
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
		if (name !== "racetime.v4.fetchRace")
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
		if (name !== "racetime.v4.fetchRace")
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
		if (name !== "racetime.v4.fetchRace")
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
		if (name !== "racetime.v4.fetchRace")
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
		if (name !== "racetime.v4.fetchRace")
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
		if (name === "racetime.v4.fetchRace")
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
		if (name === "racetime.v4.fetchRace")
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
		const operation = name.replace("racetime.v4.", "");
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
	let leaderboardRequests = 0;
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "getSpeedrunLeaderboards") {
			leaderboardRequests += 1;
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
	await waitFor(() => expect(leaderboardRequests).toBe(1));

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
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
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
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
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
		const operation = name.replace("racetime.v4.", "");
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
		if (name === "racetime.v4.fetchRace")
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
		if (name === "racetime.v4.fetchRace")
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
		if (name === "racetime.v4.fetchRace")
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
		const operation = name.replace("racetime.v4.", "");
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
		const operation = name.replace("racetime.v4.", "");
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
		const operation = name.replace("racetime.v4.", "");
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
		const operation = name.replace("racetime.v4.", "");
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
	expect(
		screen.getByText(
			/保存処理中だったため、取得したレースは表示に反映されません/,
		),
	).toBeTruthy();

	await act(async () => {
		finishSave?.();
	});
	expect(await screen.findByText("Game Mappingを保存しました。")).toBeTruthy();

	// After the save completes, the discarded race can be fetched again.
	await waitFor(() =>
		expect(
			(screen.getByRole("button", {name: "取得"}) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText("other/race")).toBeTruthy();
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

it("keeps the mapping workspace when a fetch fails during the save reload", async () => {
	const games: GameMappingRecord[] = [];
	const gameListGate = deferred<unknown>();
	const categoryListGate = deferred<unknown>();
	let holdLists = false;
	const pendingFetch = deferred<unknown>();
	let fetches = 0;
	const base = mappingHandler({
		games: [],
		categories: [],
		saveGame: (mapping) => {
			games.splice(0, games.length, {mapping, revision: "g"});
			holdLists = true;
			return {
				ok: true,
				data: {
					record: {mapping, revision: "g"},
					action: "created",
					settingsRevision: 0,
				},
			};
		},
	});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "fetchRace") {
			fetches += 1;
			return fetches === 1
				? Promise.resolve({ok: true, data: resolved()})
				: pendingFetch.promise;
		}
		if (operation === "listGameMappings") {
			if (holdLists) return gameListGate.promise;
			return Promise.resolve({
				ok: true,
				data: {records: games, settingsRevision: 0},
			});
		}
		if (operation === "listCategoryMappings") {
			if (holdLists) return categoryListGate.promise;
			return Promise.resolve({
				ok: true,
				data: {records: [], settingsRevision: 0},
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

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	await waitFor(() =>
		expect(screen.getByRole("button", {name: "保存中…"})).toBeTruthy(),
	);

	// The save succeeded but the list reload is still pending: dirty=false,
	// busy=true. A failed fetch must not tear down the saving workspace.
	await act(async () => {
		pendingFetch.reject(new Error("boom"));
	});
	expect(screen.getByText("game/race")).toBeTruthy();
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	expect(screen.getByText(/boom/)).toBeTruthy();

	await act(async () => {
		gameListGate.resolve({
			ok: true,
			data: {records: games, settingsRevision: 0},
		});
		categoryListGate.resolve({
			ok: true,
			data: {records: [], settingsRevision: 0},
		});
	});
	expect(await screen.findByText("登録済み: SRC Game")).toBeTruthy();
});

it("clears the previous race's registration URL when another race is fetched", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	let settleRegistration: (value: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((resolve) => {
				settleRegistration = resolve;
			}),
	);
	const pendingFetch = deferred<unknown>();
	let fetches = 0;
	const base = mappingHandler({games: [], categories: []});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
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
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await act(async () => {
		settleRegistration({
			ok: true,
			data: {registrationId: "r1", url: "/Registration.html"},
		});
	});
	expect(await screen.findByText(/登録画面を開きました/)).toBeTruthy();

	await act(async () => {
		pendingFetch.resolve({ok: true, data: resolved(fetchedRace)});
	});
	expect(await screen.findByText("other/race")).toBeTruthy();
	expect(screen.queryByText(/登録画面を開きました/)).toBeNull();
	expect(open).toHaveBeenCalled();
});

it("clears the previous race's registration error when another race is fetched", async () => {
	let rejectRegistration: (reason: unknown) => void = () => {};
	sendMessageToBundle.mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectRegistration = reject;
			}),
	);
	const pendingFetch = deferred<unknown>();
	let fetches = 0;
	const base = mappingHandler({games: [], categories: []});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
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
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await act(async () => {
		rejectRegistration(new Error("directory_unavailable: down"));
	});
	expect(await screen.findByText(/directory_unavailable/)).toBeTruthy();

	await act(async () => {
		pendingFetch.resolve({ok: true, data: resolved(fetchedRace)});
	});
	expect(await screen.findByText("other/race")).toBeTruthy();
	expect(screen.queryByText(/directory_unavailable/)).toBeNull();
});

it("keeps the current race's registration URL when fetching another race fails", async () => {
	vi.spyOn(window, "open").mockReturnValue(null);
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {registrationId: "r1", url: "/Registration.html"},
	});
	const base = mappingHandler({games: [], categories: []});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "fetchRace")
			return Promise.resolve({
				ok: false,
				error: {code: "not_found", message: "missing"},
			});
		return base(name, data);
	});
	render(<Overview races={races} />);
	fireEvent.click(screen.getByRole("button", {name: /game\/race/}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));
	expect(await screen.findByText(/登録画面を開きました/)).toBeTruthy();

	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: "https://racetime.gg/other/race"},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	expect(await screen.findByText(/not_found/)).toBeTruthy();
	expect(screen.getByText("Game / Any%")).toBeTruthy();
	expect(screen.getByText(/登録画面を開きました/)).toBeTruthy();
});

it("keeps the registration URL when the same race is fetched again", async () => {
	const open = vi.spyOn(window, "open").mockReturnValue(null);
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {registrationId: "r1", url: "/Registration.html"},
	});
	const base = mappingHandler({games: [], categories: []});
	sendMessage.mockImplementation((name: string, data?: unknown) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "fetchRace")
			return Promise.resolve({ok: true, data: resolved()});
		return base(name, data);
	});
	render(<Overview races={undefined} />);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	fireEvent.click(await screen.findByRole("button", {name: "登録・紐付け"}));
	expect(await screen.findByText(/登録画面を開きました/)).toBeTruthy();

	// Refetching the same race does not discard its registration result.
	fireEvent.click(screen.getByRole("button", {name: "再取得"}));
	expect(await screen.findByText(race.raceId)).toBeTruthy();
	expect(screen.getByText(/登録画面を開きました/)).toBeTruthy();
	expect(open).toHaveBeenCalled();
});

const updatedRace: Race = {
	...race,
	category: {...race.category, goal: "100%"},
};
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

it("loads Leaderboards only when a monitored or fetched race is displayed", async () => {
	const leaderboardRequests: unknown[] = [];
	const handler = mappingHandler({});
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		if (name.endsWith("getSpeedrunLeaderboards")) {
			leaderboardRequests.push(data);
			return {ok: true, data: {status: "unregistered", mappings: []}};
		}
		return handler(name, data);
	});
	const view = render(<Overview races={undefined} />);
	expect(leaderboardRequests).toHaveLength(0);
	fireEvent.change(screen.getByLabelText("RaceTime race URL"), {
		target: {value: race.url},
	});
	fireEvent.click(screen.getByRole("button", {name: "取得"}));
	await screen.findByText("Speedrun.com Leaderboard");
	await waitFor(() => expect(leaderboardRequests).toHaveLength(1));
	expect(leaderboardRequests[0]).toEqual({
		categorySlug: "game",
		goal: "Any%",
		refresh: false,
	});

	view.unmount();
	leaderboardRequests.length = 0;
	render(<Overview races={races} />);
	await selectFirstMonitored();
	await screen.findByText("Speedrun.com Leaderboard");
	await waitFor(() => expect(leaderboardRequests).toHaveLength(1));
	expect(leaderboardRequests[0]).toEqual({
		categorySlug: "game",
		goal: "Any%",
		refresh: false,
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

	fireEvent.click(screen.getByRole("button", {name: "強制解除"}));
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {name: "強制解除"}),
	);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.getByText(/選択中: SRC Game/)).toBeTruthy();
	rerender(<Overview races={{schemaVersion: 1, races: []}} />);
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
	expect(
		await screen.findByText(/レースを選択するかURLで取得してください/),
	).toBeTruthy();
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
	fireEvent.click(screen.getByRole("button", {name: "強制解除"}));
	fireEvent.click(
		within(screen.getByRole("dialog")).getByRole("button", {name: "強制解除"}),
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
	expect(await screen.findByText(/レースを選択するかURLで取得/)).toBeTruthy();
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
	expect(
		await screen.findByText(/レースを選択するかURLで取得してください/),
	).toBeTruthy();

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
	expect(
		await screen.findByText(/レースを選択するかURLで取得してください/),
	).toBeTruthy();

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
	expect(
		await screen.findByText(/レースを選択するかURLで取得してください/),
	).toBeTruthy();

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
	expect(
		screen.queryByText(/レースを選択するかURLで取得してください/),
	).toBeNull();

	// Once the latest snapshot is available it can be applied.
	rerender(<Overview races={{schemaVersion: 1, races: [updatedRaceState]}} />);
	fireEvent.click(await screen.findByRole("button", {name: "最新状態を表示"}));
	expect(await screen.findByText("100%")).toBeTruthy();
});
