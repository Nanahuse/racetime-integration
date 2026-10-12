// @vitest-environment jsdom
import type {SettingsState} from "@nanahuse/racetime-protocol";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
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
let updateResult: () => Envelope = () => ({
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

beforeEach(() => {
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
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v2.", "");
		if (operation === "getSettings") return {ok: true, data: initial};
		if (operation === "updateSettings") return updateResult();
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

it("keeps input, blocks further saves, and offers refetch on a settings conflict", async () => {
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
	expect(screen.getByRole("button", {name: /最新設定を再取得/})).toBeTruthy();
});
