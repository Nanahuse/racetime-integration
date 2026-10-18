// @vitest-environment jsdom
import type {SettingsState} from "@nanahuse/racetime-protocol";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {Settings} from "../ui/dashboard/components/Settings";

type Envelope =
	| {ok: true; data: unknown}
	| {ok: false; error: {code: string; message: string}};

const sendMessage = vi.fn();
(window as unknown as {nodecg: unknown}).nodecg = {
	sendMessage,
	sendMessageToBundle: vi.fn(),
	Replicant: vi.fn(),
};

const initial: SettingsState = {
	revision: 0,
	settings: {
		spreadsheetId: null,
		gameMappingsSheet: "GameMappings",
		categoryMappingsSheet: "CategoryMappings",
		maxResolvedMappings: 20,
		allowedRaceOrigins: ["https://racetime.gg"],
		leaderboardTop: 20,
	},
};
let updateResult: () => Envelope | Promise<Envelope> = () => ({
	ok: true,
	data: {
		revision: 1,
		settings: {
			spreadsheetId: "abc",
			gameMappingsSheet: "GameMappings",
			categoryMappingsSheet: "CategoryMappings",
			maxResolvedMappings: 20,
			allowedRaceOrigins: ["https://racetime.gg"],
			leaderboardTop: 20,
		},
	},
});
let initializeResult: () => Envelope | Promise<Envelope> = () => ({
	ok: true,
	data: {gameMappings: "created", categoryMappings: "created"},
});
let getSettingsResult: () => Envelope = () => ({ok: true, data: initial});

beforeEach(() => {
	getSettingsResult = () => ({ok: true, data: initial});
	updateResult = () => ({
		ok: true,
		data: {
			revision: 1,
			settings: {
				spreadsheetId: "abc",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
	initializeResult = () => ({
		ok: true,
		data: {gameMappings: "created", categoryMappings: "created"},
	});
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v4.", "");
		if (operation === "getSettings") return getSettingsResult();
		if (operation === "updateSettings") return updateResult();
		if (operation === "initializeSpreadsheet") return initializeResult();
		throw new Error(`unexpected operation ${operation}`);
	});
});

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
});

it("shows 未設定 when no spreadsheet is configured", async () => {
	render(<Settings />);
	expect(await screen.findByText("未設定")).toBeTruthy();
	expect(screen.getByText("https://racetime.gg")).toBeTruthy();
});

it("adds and saves a normalized RaceTime origin without checking the spreadsheet", async () => {
	const next: SettingsState = {
		revision: 1,
		settings: {
			...initial.settings,
			allowedRaceOrigins: [
				"https://racetime.gg",
				"http://localhost:8000",
			],
		},
	};
	updateResult = () => ({ok: true, data: next});
	render(<Settings />);
	await screen.findByText("未設定");
	sendMessage.mockClear();
	fireEvent.change(screen.getByLabelText("新しい接続先"), {
		target: {value: "http://LOCALHOST:8000/"},
	});
	fireEvent.click(screen.getByRole("button", {name: "追加"}));
	expect(screen.getByText("http://localhost:8000")).toBeTruthy();
	expect(sendMessage).not.toHaveBeenCalledWith(
		"racetime.v4.updateSettings",
		expect.anything(),
	);
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(
		await screen.findByText("保存しました。Spreadsheet接続の確認は行っていません。"),
	).toBeTruthy();
	expect(sendMessage).toHaveBeenCalledWith(
		"racetime.v4.updateSettings",
		expect.objectContaining({
			settings: expect.objectContaining({
				allowedRaceOrigins: [
					"https://racetime.gg",
					"http://localhost:8000",
				],
			}),
		}),
	);
});

it("allows deleting the default origin and saving an empty allowlist", async () => {
	const next: SettingsState = {
		revision: 1,
		settings: {...initial.settings, allowedRaceOrigins: []},
	};
	updateResult = () => ({ok: true, data: next});
	render(<Settings />);
	await screen.findByText("未設定");
	sendMessage.mockClear();
	fireEvent.click(
		screen.getByRole("button", {name: "https://racetime.ggを削除"}),
	);
	expect(screen.getByText("接続許可先はありません。")).toBeTruthy();
	expect(sendMessage).not.toHaveBeenCalledWith(
		"racetime.v4.updateSettings",
		expect.anything(),
	);
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(
		await screen.findByText("保存しました。Spreadsheet接続の確認は行っていません。"),
	).toBeTruthy();
	expect(sendMessage).toHaveBeenCalledWith(
		"racetime.v4.updateSettings",
		expect.objectContaining({
			settings: expect.objectContaining({allowedRaceOrigins: []}),
		}),
	);
});

it("rejects duplicate and non-loopback HTTP origins in the editor", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	const input = screen.getByLabelText("新しい接続先");
	const invalidInputs: Array<[string, RegExp]> = [
		["https://RACETIME.GG:443/", /重複するOrigin/],
		["http://example.com:8000", /HTTPを許可できるのはlocalhost/],
	];
	for (const [value, message] of invalidInputs) {
		fireEvent.change(input, {target: {value}});
		fireEvent.click(screen.getByRole("button", {name: "追加"}));
		expect(await screen.findByText(message)).toBeTruthy();
	}
	expect(screen.queryByText("接続許可先はありません。")).toBeNull();
	for (const call of sendMessage.mock.calls)
		expect(call[0]).not.toBe("racetime.v4.updateSettings");
});

it("keeps the edited origins when saving fails", async () => {
	updateResult = () => ({
		ok: false,
		error: {code: "settings_changed", message: "stale"},
	});
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("新しい接続先"), {
		target: {value: "http://localhost:8000"},
	});
	fireEvent.click(screen.getByRole("button", {name: "追加"}));
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(await screen.findByText("http://localhost:8000")).toBeTruthy();
	expect(await screen.findByRole("button", {name: "最新設定を採用"})).toBeTruthy();
});

it("shows 利用可能 only after a validated save and reverts to 未確認 when edited", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(await screen.findByText("利用可能")).toBeTruthy();
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc2"},
	});
	expect(await screen.findByText("未確認")).toBeTruthy();
});

it("does not claim validation when the spreadsheet is disabled", async () => {
	updateResult = () => ({
		ok: true,
		data: {
			revision: 1,
			settings: {
				spreadsheetId: null,
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
				maxResolvedMappings: 20,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			},
		},
	});
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(await screen.findByText(/Spreadsheet接続の確認は行っていません/)).toBeTruthy();
	expect(screen.getByText("未設定")).toBeTruthy();
	expect(screen.queryByText(/両シートを確認しました/)).toBeNull();
});

it("keeps input, blocks further saves, and offers recovery on a settings conflict", async () => {
	updateResult = () => ({
		ok: false,
		error: {code: "settings_changed", message: "stale"},
	});
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(await screen.findByText(/別の場所で更新されました/)).toBeTruthy();
	expect(screen.getByDisplayValue("abc")).toBeTruthy();
	expect(
		(screen.getByRole("button", {name: "保存"}) as HTMLButtonElement).disabled,
	).toBe(true);
	expect(screen.getByRole("button", {name: /最新設定を採用/})).toBeTruthy();
	expect(screen.getByRole("button", {name: /最新設定から再編集/})).toBeTruthy();
	expect(screen.queryByRole("button", {name: /再取得/})).toBeNull();
	expect(screen.getByText("spreadsheetId")).toBeTruthy();
});

it("adopts the latest saved settings after a conflict", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "mine"},
	});
	updateResult = () => ({
		ok: false,
		error: {code: "settings_changed", message: "stale"},
	});
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	await screen.findByText(/別の場所で更新されました/);
	updateResult = () => ({ok: true, data: initial});
	fireEvent.click(screen.getByRole("button", {name: /最新設定を採用/}));
	expect(await screen.findByDisplayValue("GameMappings")).toBeTruthy();
	expect(screen.queryByDisplayValue("mine")).toBeNull();
});

it("initializes from unsaved input and can still save afterwards", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	fireEvent.click(screen.getByRole("button", {name: "Spreadsheetを初期化"}));
	expect(await screen.findByText(/GameMappings: 新規作成/)).toBeTruthy();
	expect(sendMessage).toHaveBeenCalledWith(
		"racetime.v4.initializeSpreadsheet",
		{
			settings: {
				spreadsheetId: "abc",
				gameMappingsSheet: "GameMappings",
				categoryMappingsSheet: "CategoryMappings",
			},
		},
	);
	// A successful initialization must not mark the unsaved settings available.
	expect(screen.queryByText("利用可能")).toBeNull();
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(await screen.findByText("利用可能")).toBeTruthy();
});

it("cannot initialize without a spreadsheet id", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	expect(
		(
			screen.getByRole("button", {
				name: "Spreadsheetを初期化",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

it("blocks duplicate initialization and input edits while running", async () => {
	let resolve: (value: Envelope) => void = () => {};
	initializeResult = () =>
		new Promise<Envelope>((res) => {
			resolve = res;
		});
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	fireEvent.click(screen.getByRole("button", {name: "Spreadsheetを初期化"}));
	expect(await screen.findByRole("button", {name: "初期化中…"})).toBeTruthy();
	expect(
		(screen.getByLabelText("Spreadsheet URL または ID") as HTMLInputElement)
			.disabled,
	).toBe(true);
	expect(
		(screen.getByRole("button", {name: "保存"}) as HTMLButtonElement).disabled,
	).toBe(true);
	await act(async () => {
		resolve({
			ok: true,
			data: {gameMappings: "created", categoryMappings: "created"},
		});
	});
	expect(await screen.findByText(/CategoryMappings: 新規作成/)).toBeTruthy();
});

it("keeps the input when initialization fails", async () => {
	initializeResult = () => ({
		ok: false,
		error: {code: "spreadsheet_unavailable", message: "no access"},
	});
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	fireEvent.click(screen.getByRole("button", {name: "Spreadsheetを初期化"}));
	expect(await screen.findByText(/no access/)).toBeTruthy();
	expect(screen.getByDisplayValue("abc")).toBeTruthy();
});

it("keeps saves blocked when the latest settings cannot be fetched", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	updateResult = () => ({
		ok: false,
		error: {code: "settings_changed", message: "stale"},
	});
	getSettingsResult = () => ({
		ok: false,
		error: {code: "spreadsheet_unavailable", message: "reload failed"},
	});
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(
		await screen.findByRole("button", {name: /最新設定を再取得/}),
	).toBeTruthy();
	expect(
		(screen.getByRole("button", {name: "保存"}) as HTMLButtonElement).disabled,
	).toBe(true);
	expect(screen.getByDisplayValue("abc")).toBeTruthy();
	// Recovery: a successful refetch enables adoption without applying the input.
	getSettingsResult = () => ({ok: true, data: initial});
	fireEvent.click(screen.getByRole("button", {name: /最新設定を再取得/}));
	expect(
		await screen.findByRole("button", {name: /最新設定を採用/}),
	).toBeTruthy();
	expect(screen.queryByRole("button", {name: /最新設定を再取得/})).toBeNull();
});

it("blocks settings input while a save is in progress", async () => {
	let resolve: (value: Envelope) => void = () => {};
	updateResult = () =>
		new Promise<Envelope>((res) => {
			resolve = res;
		});
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	await waitFor(() =>
		expect(
			(screen.getByLabelText("Spreadsheet URL または ID") as HTMLInputElement)
				.disabled,
		).toBe(true),
	);
	expect(
		(screen.getByLabelText("GameMappings シート名") as HTMLInputElement)
			.disabled,
	).toBe(true);
	expect(
		(
			screen.getByRole("button", {
				name: "Spreadsheetを初期化",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	await act(async () => {
		resolve({ok: true, data: initial});
	});
	await waitFor(() =>
		expect(
			(screen.getByLabelText("Spreadsheet URL または ID") as HTMLInputElement)
				.disabled,
		).toBe(false),
	);
});

it("clears the initialization result when the target input changes", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.change(screen.getByLabelText("Spreadsheet URL または ID"), {
		target: {value: "abc"},
	});
	fireEvent.click(screen.getByRole("button", {name: "Spreadsheetを初期化"}));
	expect(await screen.findByText(/GameMappings: 新規作成/)).toBeTruthy();
	fireEvent.change(screen.getByLabelText("GameMappings シート名"), {
		target: {value: "Games"},
	});
	await waitFor(() =>
		expect(screen.queryByText(/GameMappings: 新規作成/)).toBeNull(),
	);
});

it("shows, edits and saves the Any expansion limit", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	const input = screen.getByLabelText("Any展開の最大件数") as HTMLInputElement;
	expect(input.value).toBe("20");
	sendMessage.mockClear();
	fireEvent.change(input, {target: {value: "30"}});
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(await screen.findByText("未設定")).toBeTruthy();
	expect(
		await screen.findByText(/Spreadsheet接続の確認は行っていません/),
	).toBeTruthy();
	expect(sendMessage).toHaveBeenCalledWith(
		"racetime.v4.updateSettings",
		expect.objectContaining({
			settings: expect.objectContaining({
				maxResolvedMappings: 30,
				allowedRaceOrigins: ["https://racetime.gg"],
				leaderboardTop: 20,
			}),
		}),
	);
});

it("rejects an invalid Any expansion limit before saving", async () => {
	for (const value of ["0", "-1", "1.5"]) {
		render(<Settings />);
		await screen.findByText("未設定");
		sendMessage.mockClear();
		fireEvent.change(screen.getByLabelText("Any展開の最大件数"), {
			target: {value},
		});
		expect(
			await screen.findByText(
				/Any展開の最大件数は1以上の整数で入力してください/,
			),
		).toBeTruthy();
		expect(
			(screen.getByRole("button", {name: "保存"}) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", {name: "保存"}));
		expect(sendMessage).not.toHaveBeenCalledWith(
			"racetime.v4.updateSettings",
			expect.anything(),
		);
		cleanup();
	}
});

it("shows and validates the leaderboard rank limit", async () => {
	render(<Settings />);
	await screen.findByText("未設定");
	const input = screen.getByLabelText(
		"リーダーボード取得順位数",
	) as HTMLInputElement;
	expect(input.value).toBe("20");
	fireEvent.change(input, {target: {value: "0"}});
	expect(
		await screen.findByText(/リーダーボード取得順位数は1以上の整数/),
	).toBeTruthy();
	expect(
		(screen.getByRole("button", {name: "保存"}) as HTMLButtonElement).disabled,
	).toBe(true);
});
