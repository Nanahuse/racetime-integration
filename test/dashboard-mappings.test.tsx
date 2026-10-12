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
let listRevision = 0;
let saveGame: () => Envelope = () => ({
	ok: true,
	data: {record: gameRecord, action: "updated", settingsRevision: 0},
});

beforeEach(() => {
	games = [];
	categories = [];
	variablesByCategory = {};
	listRevision = 0;
	saveGame = () => ({
		ok: true,
		data: {record: gameRecord, action: "updated", settingsRevision: 0},
	});
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v2.", "");
		switch (operation) {
			case "listGameMappings":
				return {
					ok: true,
					data: {records: games, settingsRevision: listRevision},
				};
			case "listCategoryMappings":
				return {
					ok: true,
					data: {records: categories, settingsRevision: listRevision},
				};
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
								type: "per-level",
								miscellaneous: false,
							},
							{
								id: "c2",
								name: "100%",
								type: "per-level",
								miscellaneous: false,
							},
						],
						levels: [{id: "l1", name: "Level 1"}],
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

async function selectFirstGame() {
	const item = await screen.findByText("Game One");
	await act(async () => {
		fireEvent.click(item);
	});
}

async function openNewGame() {
	const button = await screen.findByRole("button", {name: /新規/});
	await act(async () => {
		fireEvent.click(button);
	});
}

async function openNewCategory() {
	const button = await screen.findByRole("button", {name: /新規 Goal/});
	await act(async () => {
		fireEvent.click(button);
	});
	await waitFor(() =>
		expect(
			(screen.getByLabelText("SRC Category（必須）") as HTMLSelectElement)
				.disabled,
		).toBe(false),
	);
}

it("recovers from a save conflict and keeps edits until the user resolves it", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
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
	expect(
		await screen.findByRole("button", {name: /最新状態を採用/}),
	).toBeTruthy();
	expect(screen.getByDisplayValue("Game One Edited")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: /最新状態を採用/}));
	expect(await screen.findByDisplayValue("Server Name")).toBeTruthy();
});

it("blocks saving after reload detects a conflicting remote change", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
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
	const reload = screen.getByRole("button", {name: "保存先から再読込"});
	await act(async () => {
		fireEvent.click(reload);
	});
	expect(
		await screen.findByRole("button", {name: /最新状態を採用/}),
	).toBeTruthy();
	expect(
		(
			screen.getByRole("button", {
				name: /Game Mappingを保存/,
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

it("keeps unsaved edits when reload finds no remote change", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	fireEvent.change(screen.getByDisplayValue("Game One"), {
		target: {value: "Game One Edited"},
	});
	const reload = screen.getByRole("button", {name: "保存先から再読込"});
	await act(async () => {
		fireEvent.click(reload);
	});
	expect(await screen.findByDisplayValue("Game One Edited")).toBeTruthy();
	expect(
		(
			screen.getByRole("button", {
				name: /Game Mappingを保存/,
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
});

it("re-edits from the latest state without auto-applying the previous edit", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
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
	await screen.findByRole("button", {name: /最新状態から再編集/});
	fireEvent.click(screen.getByRole("button", {name: /最新状態から再編集/}));
	expect(await screen.findByDisplayValue("Server Name")).toBeTruthy();
	expect(screen.queryByDisplayValue("Game One Edited")).toBeNull();
	expect(screen.getByText("Game One Edited")).toBeTruthy();
});

it("prevents overwriting a record that was deleted on the server", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	fireEvent.change(screen.getByDisplayValue("Game One"), {
		target: {value: "Game One Edited"},
	});
	games = [];
	saveGame = () => ({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(await screen.findByText(/削除されています/)).toBeTruthy();
	expect(
		(
			screen.getByRole("button", {
				name: /最新状態から再編集/,
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

it("detects a conflict when a new mapping's key was created elsewhere", async () => {
	render(<Mappings />);
	await openNewGame();
	fireEvent.change(
		screen.getByLabelText("RaceTime category slug（一意キー）"),
		{
			target: {value: "game"},
		},
	);
	fireEvent.change(screen.getByLabelText("RaceTime category name（表示用）"), {
		target: {value: "New Game"},
	});
	games = [gameRecord];
	saveGame = () => ({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(
		await screen.findByRole("button", {name: /最新状態を採用/}),
	).toBeTruthy();
});

it("resets the edit session after the spreadsheet destination changed", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	fireEvent.change(screen.getByDisplayValue("Game One"), {
		target: {value: "Game One Edited"},
	});
	listRevision = 1;
	games = [];
	saveGame = () => ({
		ok: false,
		error: {code: "settings_changed", message: "changed"},
	});
	fireEvent.click(screen.getByRole("button", {name: /Game Mappingを保存/}));
	expect(
		await screen.findByText(/Spreadsheet設定が変更されました/),
	).toBeTruthy();
	expect(screen.queryByDisplayValue("Game One Edited")).toBeNull();
	expect(screen.getByText("Game One Edited")).toBeTruthy();
});

it("refuses to mix Game and Category data from different settings revisions", async () => {
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v2.", "");
		if (operation === "listGameMappings")
			return {ok: true, data: {records: [gameRecord], settingsRevision: 0}};
		if (operation === "listCategoryMappings")
			return {ok: true, data: {records: [], settingsRevision: 1}};
		throw new Error(`unexpected operation ${operation}`);
	});
	render(<Mappings />);
	expect(await screen.findByText(/一致しません/)).toBeTruthy();
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
	await selectFirstGame();
	await openNewCategory();
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

it("resets the level when the SRC category changes", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	await openNewCategory();
	const select = screen.getByLabelText("SRC Category（必須）");
	await act(async () => {
		fireEvent.change(select, {target: {value: "c1"}});
	});
	const level = (await screen.findByLabelText("Level")) as HTMLSelectElement;
	await act(async () => {
		fireEvent.change(level, {target: {value: "l1"}});
	});
	expect(level.value).toBe("l1");
	await act(async () => {
		fireEvent.change(select, {target: {value: "c2"}});
	});
	await waitFor(() =>
		expect((screen.getByLabelText("Level") as HTMLSelectElement).value).toBe(
			"",
		),
	);
});
