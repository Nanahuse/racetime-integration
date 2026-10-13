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
			},
		},
	});
	initializeResult = () => ({
		ok: true,
		data: {gameMappings: "created", categoryMappings: "created"},
	});
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v3.", "");
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
			},
		},
	});
	render(<Settings />);
	await screen.findByText("未設定");
	fireEvent.click(screen.getByRole("button", {name: "保存"}));
	expect(await screen.findByText(/未設定として保存/)).toBeTruthy();
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
		"racetime.v3.initializeSpreadsheet",
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
