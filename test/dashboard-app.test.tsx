// @vitest-environment jsdom
import type {GameMappingRecord} from "@nanahuse/racetime-protocol";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {App} from "../ui/dashboard/App";

const sendMessage = vi.fn();
const sendMessageToBundle = vi.fn();
const Replicant = vi.fn(() => ({
	value: {schemaVersion: 1, races: []},
	on: (_event: string, listener: (value: unknown) => void) =>
		listener({schemaVersion: 1, races: []}),
	off: vi.fn(),
}));
(window as unknown as {nodecg: unknown}).nodecg = {
	sendMessage,
	sendMessageToBundle,
	Replicant,
};

const gameRecord: GameMappingRecord = {
	mapping: {
		racetime: {categorySlug: "game", categoryName: "Game One"},
		speedrunCom: {gameId: "g1", gameName: "SRC Game"},
	},
	revision: "g1r",
};

beforeEach(() => {
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {ready: true, error: null},
	});
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v2.", "");
		switch (operation) {
			case "listGameMappings":
				return {ok: true, data: {records: [gameRecord], settingsRevision: 0}};
			case "listCategoryMappings":
				return {ok: true, data: {records: [], settingsRevision: 0}};
			case "getSpeedrunCategoryVariables":
				return {ok: true, data: {variables: []}};
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
						categories: [],
						levels: [],
						platforms: [],
						regions: [],
						timingMethods: [],
					},
				};
			case "getSettings":
				return {
					ok: true,
					data: {
						revision: 0,
						settings: {
							spreadsheetId: null,
							gameMappingsSheet: "GameMappings",
							categoryMappingsSheet: "CategoryMappings",
						},
					},
				};
			default:
				throw new Error(`unexpected operation ${operation}`);
		}
	});
});

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
	sendMessageToBundle.mockReset();
});

it("shows the public Player Manager readiness in the header", async () => {
	render(<App />);
	expect(await screen.findByText("Ready")).toBeTruthy();
	expect(sendMessageToBundle).toHaveBeenCalledWith(
		"player-manager.v2.status",
		"player-manager",
		undefined,
	);
});

it("reflects an unavailable Player Manager", async () => {
	sendMessageToBundle.mockResolvedValue({
		ok: false,
		error: {code: "directory_unavailable", message: "down"},
	});
	render(<App />);
	expect(await screen.findByText("Unavailable")).toBeTruthy();
});

it("shows Idle when no races are monitored", async () => {
	render(<App />);
	expect(await screen.findByText("Idle")).toBeTruthy();
});

it("asks before discarding unsaved edits when switching tabs", async () => {
	render(<App />);
	fireEvent.click(screen.getByRole("button", {name: "Mappings"}));
	const item = await screen.findByText("Game One");
	await act(async () => {
		fireEvent.click(item);
	});
	fireEvent.change(screen.getByDisplayValue("Game One"), {
		target: {value: "Edited"},
	});

	fireEvent.click(screen.getByRole("button", {name: "Settings"}));
	expect(await screen.findByText(/未保存の変更があります/)).toBeTruthy();
	expect(screen.getByDisplayValue("Edited")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "キャンセル"}));
	expect(screen.queryByText(/未保存の変更があります/)).toBeNull();
	expect(screen.getByDisplayValue("Edited")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", {name: "Settings"}));
	await screen.findByText(/未保存の変更があります/);
	fireEvent.click(screen.getByRole("button", {name: "破棄して移動"}));
	expect(await screen.findByText("Spreadsheet 設定")).toBeTruthy();
});

it("switches tabs without prompting when there are no unsaved edits", async () => {
	render(<App />);
	fireEvent.click(screen.getByRole("button", {name: "Settings"}));
	expect(await screen.findByText("Spreadsheet 設定")).toBeTruthy();
	expect(screen.queryByText(/未保存の変更があります/)).toBeNull();
});
