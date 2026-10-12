// @vitest-environment jsdom
import type {
	CategoryMappingRecord,
	GameMappingRecord,
} from "@nanahuse/racetime-protocol";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {Mappings} from "../ui/dashboard/components/Mappings";

type Envelope =
	| {ok: true; data: unknown}
	| {ok: false; error: {code: string; message: string}};

const sendMessage = vi.fn();
(window as unknown as {nodecg: unknown}).nodecg = {
	sendMessage,
	sendMessageToBundle: vi.fn(),
	Replicant: vi.fn(),
};

const gameRecord: GameMappingRecord = {
	mapping: {
		racetime: {categorySlug: "game", categoryName: "Game One"},
		speedrunCom: {gameId: "g1", gameName: "SRC Game"},
	},
	revision: "g1r",
};
const childRecord: CategoryMappingRecord = {
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

let games: GameMappingRecord[] = [];
let categories: CategoryMappingRecord[] = [];
let variablesByCategory: Record<string, unknown[]> = {};
let saveGame: () => Envelope = () => ({
	ok: true,
	data: {record: gameRecord, action: "updated", settingsRevision: 0},
});

beforeEach(() => {
	games = [];
	categories = [];
	variablesByCategory = {};
	saveGame = () => ({
		ok: true,
		data: {record: gameRecord, action: "updated", settingsRevision: 0},
	});
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v2.", "");
		switch (operation) {
			case "listGameMappings":
				return {ok: true, data: {records: games, settingsRevision: 0}};
			case "listCategoryMappings":
				return {ok: true, data: {records: categories, settingsRevision: 0}};
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
							{
								id: "c1",
								name: "Any%",
								type: "per-game",
								miscellaneous: false,
							},
							{
								id: "c2",
								name: "100%",
								type: "per-game",
								miscellaneous: false,
							},
						],
						levels: [],
						platforms: [],
						regions: [],
						timingMethods: [],
					},
				};
			case "getSpeedrunCategoryVariables": {
				const categoryId = (data as {categoryId?: string})?.categoryId ?? "";
				return {
					ok: true,
					data: {variables: variablesByCategory[categoryId] ?? []},
				};
			}
			case "searchSpeedrunGames":
				return {ok: true, data: {games: []}};
			case "saveGameMapping":
				return saveGame();
			default:
				throw new Error(`unexpected operation ${operation}`);
		}
	});
});

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
});

it("keeps a saved Game Mapping unique key read-only", async () => {
	games = [gameRecord];
	render(<Mappings />);
	const item = await screen.findByText("Game One");
	await act(async () => {
		fireEvent.click(item);
	});
	expect((screen.getByDisplayValue("game") as HTMLInputElement).readOnly).toBe(
		true,
	);
	expect(
		(screen.getByLabelText("SRCゲーム検索") as HTMLInputElement).disabled,
	).toBe(false);
});

it("disables SRC game selection while child category mappings exist", async () => {
	games = [gameRecord];
	categories = [childRecord];
	render(<Mappings />);
	fireEvent.click(await screen.findByText("Game One"));
	await waitFor(() =>
		expect(
			(screen.getByLabelText("SRCゲーム検索") as HTMLInputElement).disabled,
		).toBe(true),
	);
	expect(screen.getByText(/子Category Mappingが存在するため/)).toBeTruthy();
});

it("recovers from a save conflict and keeps edits until the user resolves it", async () => {
	games = [gameRecord];
	render(<Mappings />);
	fireEvent.click(await screen.findByText("Game One"));
	fireEvent.change(screen.getByDisplayValue("Game One"), {
		target: {value: "Game One Edited"},
	});
	games = [
		{
			mapping: {
				...gameRecord.mapping,
				racetime: {categorySlug: "game", categoryName: "Server Name"},
			},
			revision: "g2r",
		},
	];
	saveGame = () => ({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(await screen.findByText(/競合/)).toBeTruthy();
	expect(screen.getByDisplayValue("Game One Edited")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: /最新状態へ戻す/}));
	expect(await screen.findByDisplayValue("Server Name")).toBeTruthy();
});

it("does not auto-apply edits after the spreadsheet destination changed", async () => {
	games = [gameRecord];
	render(<Mappings />);
	fireEvent.click(await screen.findByText("Game One"));
	fireEvent.change(screen.getByDisplayValue("Game One"), {
		target: {value: "Game One Edited"},
	});
	saveGame = () => ({
		ok: false,
		error: {code: "settings_changed", message: "changed"},
	});
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(
		await screen.findByText(/Spreadsheet設定が変更されました/),
	).toBeTruthy();
	expect(screen.getByDisplayValue("Game One Edited")).toBeTruthy();
});

it("clears variables from the previous SRC category", async () => {
	games = [gameRecord];
	variablesByCategory = {
		c1: [
			{
				id: "diff",
				name: "Difficulty",
				mandatory: false,
				userDefined: false,
				values: [{id: "normal", label: "Normal"}],
			},
		],
		c2: [],
	};
	render(<Mappings />);
	const game = await screen.findByText("Game One");
	await act(async () => {
		fireEvent.click(game);
	});
	const newGoal = await screen.findByRole("button", {name: /新規 Goal/});
	await act(async () => {
		fireEvent.click(newGoal);
	});
	await waitFor(() =>
		expect(
			(screen.getByLabelText("SRC Category（必須）") as HTMLSelectElement)
				.disabled,
		).toBe(false),
	);
	const select = screen.getByLabelText("SRC Category（必須）");
	await act(async () => {
		fireEvent.change(select, {target: {value: "c1"}});
	});
	expect(await screen.findByText("Difficulty")).toBeTruthy();
	await act(async () => {
		fireEvent.change(select, {target: {value: "c2"}});
	});
	await waitFor(() => expect(screen.queryByText("Difficulty")).toBeNull());
});
