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
	within,
} from "@testing-library/react";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {Mappings, MappingWorkspace} from "../ui/dashboard/components/Mappings";

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
			gameId: "g1",
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
let saveGame: () => Envelope | Promise<Envelope> = () => ({
	ok: true,
	data: {record: gameRecord, action: "updated", settingsRevision: 0},
});
let saveCategory: () => Envelope | Promise<Envelope> = () => ({
	ok: true,
	data: {record: childRecord, action: "created", settingsRevision: 0},
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
	saveCategory = () => ({
		ok: true,
		data: {record: childRecord, action: "created", settingsRevision: 0},
	});
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		const operation = name.replace("racetime.v5.", "");
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
			case "saveCategoryMapping":
				return saveCategory();
			default:
				throw new Error(`unexpected operation ${operation}`);
		}
	});
});

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
});

it("shows the RaceTime mapping as plain text without key inputs", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	expect(screen.getByText("Game One (game)")).toBeTruthy();
	expect(screen.queryByDisplayValue("game")).toBeNull();
	expect(screen.queryByLabelText("RaceTime category slug")).toBeNull();
	expect(screen.getByRole("button", {name: "SRCゲームを追加"})).toBeTruthy();
});

it("keeps SRC game IDs out of the management editor", async () => {
	games = [gameRecord];
	categories = [childRecord];
	render(<Mappings />);
	fireEvent.click(await screen.findByText("Game One"));
	fireEvent.click(await screen.findByRole("button", {name: "SRC Game の管理"}));
	expect(await screen.findByLabelText("SRC Game の表示名")).toBeTruthy();
	expect(screen.queryByLabelText("SRC Game（必須）")).toBeNull();
	expect(screen.queryByLabelText("SRCゲーム検索")).toBeNull();
});

it("reveals the SRC game search only when adding a game", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	expect(screen.queryByLabelText("SRCゲーム検索")).toBeNull();
	fireEvent.click(screen.getByRole("button", {name: "SRCゲームを追加"}));
	expect(screen.getByLabelText("SRCゲーム検索")).toBeTruthy();
	fireEvent.click(within(gameForm()).getByRole("button", {name: "キャンセル"}));
	expect(screen.queryByLabelText("SRCゲーム検索")).toBeNull();
});

it("keeps conditions collapsed and shows missing requirements", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	fireEvent.click(screen.getByRole("button", {name: /新規 Goal/}));
	expect(screen.getByText(/保存に必要な条件が不足しています/)).toBeTruthy();
	expect(
		(document.querySelector("details.mapping-conditions") as HTMLDetailsElement)
			.open,
	).toBe(false);
	expect(
		screen.getByText("カテゴリを選択するとVariablesを設定できます。"),
	).toBeTruthy();
});

it("renames a registered SRC game from the management menu", async () => {
	games = [gameRecord];
	saveGame = () => {
		const record: GameMappingRecord = {
			mapping: {
				...gameRecord.mapping,
				speedrunCom: {gameId: "g1", gameName: "Renamed SRC"},
			},
			revision: "g2r",
		};
		games = [record];
		return {
			ok: true,
			data: {record, action: "updated", settingsRevision: 0},
		};
	};
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "Renamed SRC"},
	});
	fireEvent.click(renameSaveButton());
	expect(
		await screen.findByText(/SRCゲームの表示名を保存しました/),
	).toBeTruthy();
	expect(await screen.findByRole("radio", {name: "Renamed SRC"})).toBeTruthy();
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

function gameForm() {
	return document.querySelector("form.game-registration") as HTMLElement;
}

function categoryForm() {
	return document.querySelector("form.category-editor") as HTMLElement;
}

function gameSaveButton() {
	return within(gameForm()).getByRole("button", {
		name: "保存",
	}) as HTMLButtonElement;
}

function categorySaveButton() {
	return within(categoryForm()).getByRole("button", {
		name: "保存",
	}) as HTMLButtonElement;
}

function openAddGame() {
	fireEvent.click(screen.getByRole("button", {name: "SRCゲームを追加"}));
}

function manageForm() {
	return document.querySelector(".game-manage") as HTMLElement;
}

function renameSaveButton() {
	return within(manageForm()).getByRole("button", {
		name: "保存",
	}) as HTMLButtonElement;
}

function openRename(name = "SRC Game") {
	fireEvent.click(screen.getByRole("button", {name: `${name} の管理`}));
}

function chooseGoalGame(name = "SRC Game") {
	fireEvent.click(screen.getByRole("radio", {name}));
}

async function openNewCategory() {
	const button = await screen.findByRole("button", {name: /新規 Goal/});
	await act(async () => {
		fireEvent.click(button);
	});
	fireEvent.change(screen.getByLabelText("RaceTime Goal"), {
		target: {value: "Any%"},
	});
	chooseGoalGame();
	await waitFor(() =>
		expect(
			(screen.getByLabelText("カテゴリ") as HTMLSelectElement).disabled,
		).toBe(false),
	);
}

it("recovers from a save conflict and keeps edits until the user resolves it", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "SRC Game Edited"},
	});
	games = [
		{
			mapping: {
				...gameRecord.mapping,
				speedrunCom: {gameId: "g1", gameName: "Server Name"},
			},
			revision: "g2r",
		},
	];
	saveGame = () => ({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	fireEvent.click(renameSaveButton());
	expect(
		await screen.findByRole("button", {name: /最新状態を採用/}),
	).toBeTruthy();
	expect(screen.getByDisplayValue("SRC Game Edited")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", {name: /最新状態を採用/}));
	expect(await screen.findByDisplayValue("Server Name")).toBeTruthy();
});

it("blocks saving after reload detects a conflicting remote change", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "SRC Game Edited"},
	});
	games = [
		{
			mapping: {
				...gameRecord.mapping,
				speedrunCom: {gameId: "g1", gameName: "Server Name"},
			},
			revision: "g2r",
		},
	];
	const reload = screen.getByRole("button", {name: "再読み込み"});
	await act(async () => {
		fireEvent.click(reload);
	});
	expect(
		await screen.findByRole("button", {name: /最新状態を採用/}),
	).toBeTruthy();
	expect(renameSaveButton().disabled).toBe(true);
});

it("keeps unsaved edits when reload finds no remote change", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "SRC Game Edited"},
	});
	const reload = screen.getByRole("button", {name: "再読み込み"});
	await act(async () => {
		fireEvent.click(reload);
	});
	expect(await screen.findByDisplayValue("SRC Game Edited")).toBeTruthy();
	expect(renameSaveButton().disabled).toBe(false);
});

it("re-edits from the latest state without auto-applying the previous edit", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "SRC Game Edited"},
	});
	games = [
		{
			mapping: {
				...gameRecord.mapping,
				speedrunCom: {gameId: "g1", gameName: "Server Name"},
			},
			revision: "g2r",
		},
	];
	saveGame = () => ({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	fireEvent.click(renameSaveButton());
	await screen.findByRole("button", {name: /最新状態から再編集/});
	fireEvent.click(screen.getByRole("button", {name: /最新状態から再編集/}));
	expect(await screen.findByDisplayValue("Server Name")).toBeTruthy();
	expect(screen.queryByDisplayValue("SRC Game Edited")).toBeNull();
	expect(screen.getByText("SRC Game Edited")).toBeTruthy();
});

it("prevents overwriting a record that was deleted on the server", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "SRC Game Edited"},
	});
	games = [];
	saveGame = () => ({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	fireEvent.click(renameSaveButton());
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
	const handler = sendMessage.getMockImplementation()!;
	sendMessage.mockImplementation((name: string, data?: unknown) =>
		name === "racetime.v5.searchSpeedrunGames"
			? Promise.resolve({
					ok: true,
					data: {games: [{id: "g1", name: "SRC Game", abbreviation: "S"}]},
				})
			: handler(name, data),
	);
	render(<Mappings />);
	await openNewGame();
	fireEvent.change(screen.getByLabelText("RaceTime category slug"), {
		target: {value: "game"},
	});
	fireEvent.change(screen.getByLabelText("RaceTime category name"), {
		target: {value: "New Game"},
	});
	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "SRC"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: "SRC Game (S)"}));
	games = [gameRecord];
	saveGame = () => ({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	fireEvent.click(gameSaveButton());
	expect(
		await screen.findByRole("button", {name: /最新状態を採用/}),
	).toBeTruthy();
});

it("resets the edit session after the spreadsheet destination changed", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "SRC Game Edited"},
	});
	listRevision = 1;
	games = [];
	saveGame = () => ({
		ok: false,
		error: {code: "settings_changed", message: "changed"},
	});
	fireEvent.click(renameSaveButton());
	expect(
		await screen.findByText(/Spreadsheet設定が変更されました/),
	).toBeTruthy();
	expect(screen.queryByDisplayValue("SRC Game Edited")).toBeNull();
});

it("refuses to mix Game and Category data from different settings revisions", async () => {
	sendMessage.mockImplementation(async (name: string) => {
		const operation = name.replace("racetime.v5.", "");
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
	const select = screen.getByLabelText("カテゴリ");
	await act(async () => {
		fireEvent.change(select, {target: {value: "c1"}});
	});
	expect(await screen.findByText("Difficulty")).toBeTruthy();
	await act(async () => {
		fireEvent.change(select, {target: {value: "c2"}});
	});
	await waitFor(() => expect(screen.queryByText("Difficulty")).toBeNull());
});

it("offers Any only for eligible variables and submits it", async () => {
	games = [gameRecord];
	variablesByCategory = {
		c1: [
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
			{
				id: "legacy",
				name: "Legacy",
				mandatory: false,
				userDefined: false,
				obsoletes: false,
				values: [{id: "x", label: "X"}],
			},
		],
	};
	render(<Mappings />);
	await selectFirstGame();
	await openNewCategory();
	const select = screen.getByLabelText("カテゴリ");
	await act(async () => {
		fireEvent.change(select, {target: {value: "c1"}});
	});
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
	expect(ruleset.value).toBe(anyOption!.value);
	const legacy = screen.getByLabelText("Legacy") as HTMLSelectElement;
	expect(
		Array.from(legacy.options).some((option) =>
			option.textContent?.startsWith("Any"),
		),
	).toBe(false);
	fireEvent.click(categorySaveButton());
	const call = await waitFor(() => {
		const found = sendMessage.mock.calls.find(
			([name]) => name === "racetime.v5.saveCategoryMapping",
		);
		expect(found).toBeTruthy();
		return found;
	});
	expect(call?.[1]).toMatchObject({
		mapping: {speedrunCom: {variables: {ruleset: {mode: "any"}}}},
	});
});

it("shows an error when a saved Any is no longer supported", async () => {
	games = [gameRecord];
	categories = [
		{
			mapping: {
				...childRecord.mapping,
				speedrunCom: {
					...childRecord.mapping.speedrunCom,
					variables: {ruleset: {mode: "any"}},
				},
			},
			revision: "any-r",
		},
	];
	variablesByCategory = {
		c1: [
			{
				id: "ruleset",
				name: "Ruleset",
				mandatory: false,
				userDefined: false,
				obsoletes: false,
				values: [{id: "x", label: "X"}],
			},
		],
	};
	render(<Mappings />);
	await selectFirstGame();
	fireEvent.click(await screen.findByRole("button", {name: /Any%/}));
	expect(
		await screen.findByText(
			/保存済みのAnyが現在のSpeedrun.com定義では利用できません/,
		),
	).toBeTruthy();
	expect(categorySaveButton().disabled).toBe(true);
	// The user can still fix it by choosing a concrete value.
	const select = (await screen.findByLabelText("Ruleset")) as HTMLSelectElement;
	await act(async () => {
		fireEvent.change(select, {target: {value: "x"}});
	});
	expect(categorySaveButton().disabled).toBe(false);
});

it("allows saving without a mandatory non-obsoleting variable", async () => {
	games = [gameRecord];
	variablesByCategory = {
		c1: [
			{
				id: "platform-mode",
				name: "Platform Mode",
				mandatory: true,
				userDefined: false,
				obsoletes: false,
				values: [{id: "standard", label: "Standard"}],
			},
		],
	};
	render(<Mappings />);
	await selectFirstGame();
	await openNewCategory();
	const select = screen.getByLabelText("カテゴリ");
	await act(async () => {
		fireEvent.change(select, {target: {value: "c1"}});
	});
	expect(await screen.findByLabelText("Platform Mode")).toBeTruthy();
	const save = categorySaveButton();
	expect((save as HTMLButtonElement).disabled).toBe(false);
	fireEvent.click(save);
	const call = await waitFor(() => {
		const found = sendMessage.mock.calls.find(
			([name]) => name === "racetime.v5.saveCategoryMapping",
		);
		expect(found).toBeTruthy();
		return found;
	});
	expect(call?.[1]).toMatchObject({
		mapping: {speedrunCom: {variables: {}}},
	});
});

it("detects a deleted Variable and lets the user remove it from the draft", async () => {
	games = [gameRecord];
	categories = [
		{
			mapping: {
				...childRecord.mapping,
				speedrunCom: {
					...childRecord.mapping.speedrunCom,
					variables: {ghost: {mode: "any"}},
				},
			},
			revision: "ghost-r",
		},
	];
	variablesByCategory = {c1: []};
	render(<Mappings />);
	await selectFirstGame();
	fireEvent.click(await screen.findByRole("button", {name: /Any%/}));
	expect(await screen.findByText("ghost")).toBeTruthy();
	expect(screen.getByText(/現在のSpeedrun.com定義に存在しません/)).toBeTruthy();
	const saveButton = () => categorySaveButton();
	expect(saveButton().disabled).toBe(true);
	fireEvent.click(screen.getByRole("button", {name: "変数 ghost を削除"}));
	await waitFor(() => expect(screen.queryByText("ghost")).toBeNull());
	expect(saveButton().disabled).toBe(false);
	// Revert restores the saved (inconsistent) state.
	const revert = (
		screen.getAllByRole("button", {name: "元に戻す"}) as HTMLButtonElement[]
	).find((button) => !button.disabled)!;
	fireEvent.click(revert);
	expect(await screen.findByText("ghost")).toBeTruthy();
	expect(saveButton().disabled).toBe(true);
});

it("resets the level when the SRC category changes", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	await openNewCategory();
	const select = screen.getByLabelText("カテゴリ");
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

it("blocks form input while a Game Mapping save is in progress", async () => {
	games = [gameRecord];
	let resolve: (value: Envelope) => void = () => {};
	saveGame = () =>
		new Promise<Envelope>((res) => {
			resolve = res;
		});
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "Edited"},
	});
	fireEvent.click(renameSaveButton());
	await waitFor(() =>
		expect(
			(screen.getByDisplayValue("Edited") as HTMLInputElement).disabled,
		).toBe(true),
	);
	// The list selection is locked while the save replaces the editing state.
	expect(
		(screen.getByRole("button", {name: /Game One/}) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	await act(async () => {
		resolve({
			ok: true,
			data: {record: gameRecord, action: "updated", settingsRevision: 0},
		});
	});
	expect(
		await screen.findByText(/SRCゲームの表示名を保存しました/),
	).toBeTruthy();
});

it("blocks form input while a Category Mapping save is in progress", async () => {
	games = [gameRecord];
	let resolve: (value: Envelope) => void = () => {};
	saveCategory = () =>
		new Promise<Envelope>((res) => {
			resolve = res;
		});
	render(<Mappings />);
	await selectFirstGame();
	await openNewCategory();
	const select = screen.getByLabelText("カテゴリ");
	await act(async () => {
		fireEvent.change(select, {target: {value: "c1"}});
	});
	await screen.findByText("このカテゴリにVariablesはありません。");
	fireEvent.click(categorySaveButton());
	await waitFor(() =>
		expect(
			(screen.getByLabelText("RaceTime Goal") as HTMLInputElement).disabled,
		).toBe(true),
	);
	expect((screen.getByLabelText("Level") as HTMLSelectElement).disabled).toBe(
		true,
	);
	await act(async () => {
		resolve({
			ok: true,
			data: {record: childRecord, action: "created", settingsRevision: 0},
		});
	});
	expect(
		await screen.findByText(/Category Mappingを保存しました/),
	).toBeTruthy();
});

it("keeps edits when a save fails", async () => {
	games = [gameRecord];
	saveGame = () => ({
		ok: false,
		error: {code: "internal_error", message: "boom"},
	});
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "Edited"},
	});
	fireEvent.click(renameSaveButton());
	expect(await screen.findByText(/boom|Operation failed/)).toBeTruthy();
	expect(screen.getByDisplayValue("Edited")).toBeTruthy();
	expect(renameSaveButton()).toBeTruthy();
});

it("keeps the Game Mapping editor open after saving in the manage view", async () => {
	games = [gameRecord];
	render(<Mappings />);
	await selectFirstGame();
	openRename();
	fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
		target: {value: "Edited"},
	});
	fireEvent.click(renameSaveButton());
	expect(
		await screen.findByText(/SRCゲームの表示名を保存しました/),
	).toBeTruthy();
	expect(renameSaveButton()).toBeTruthy();
	expect(screen.getByRole("button", {name: /新規 Goal/})).toBeTruthy();
});

it("keeps the Game Mapping editor open while Category changes are unsaved", async () => {
	games = [gameRecord];
	const handler = sendMessage.getMockImplementation()!;
	sendMessage.mockImplementation(async (name: string, data?: unknown) => {
		if (name === "racetime.v5.searchSpeedrunGames")
			return {
				ok: true,
				data: {games: [{id: "g2", name: "Second SRC", abbreviation: "S"}]},
			};
		return handler(name, data);
	});
	render(<Mappings />);
	await selectFirstGame();
	await openNewCategory();
	await act(async () => {
		fireEvent.change(screen.getByLabelText("カテゴリ"), {
			target: {value: "c1"},
		});
	});
	await screen.findByText("このカテゴリにVariablesはありません。");

	openAddGame();
	fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
		target: {value: "Second"},
	});
	fireEvent.click(screen.getByRole("button", {name: "検索"}));
	fireEvent.click(await screen.findByRole("button", {name: "Second SRC (S)"}));
	fireEvent.click(gameSaveButton());
	expect(await screen.findByText(/SRCゲームを追加しました/)).toBeTruthy();
	expect(screen.getByLabelText("カテゴリ")).toBeTruthy();
	expect(categorySaveButton()).toBeTruthy();
});

async function editNewCategory() {
	await openNewCategory();
	await act(async () => {
		fireEvent.change(screen.getByLabelText("カテゴリ"), {
			target: {value: "c1"},
		});
	});
	await screen.findByText("このカテゴリにVariablesはありません。");
}

it("keeps Category Mapping inputs and error visible when saving fails", async () => {
	games = [gameRecord];
	saveCategory = () => ({
		ok: false,
		error: {code: "internal_error", message: "category save failed"},
	});
	render(<Mappings />);
	await selectFirstGame();
	await editNewCategory();
	fireEvent.change(screen.getByLabelText("RaceTime Goal"), {
		target: {value: "Edited Goal"},
	});
	fireEvent.click(categorySaveButton());
	expect(await screen.findByText(/category save failed/)).toBeTruthy();
	expect(
		(screen.getByLabelText("RaceTime Goal") as HTMLInputElement).value,
	).toBe("Edited Goal");
	expect((screen.getByLabelText("カテゴリ") as HTMLSelectElement).value).toBe(
		"c1",
	);
	expect(categorySaveButton().disabled).toBe(false);
	expect(screen.queryByText(/Category Mappingを保存しました/)).toBeNull();
});

it.each([
	{gameDirty: false, reloadFails: false},
	{gameDirty: true, reloadFails: false},
	{gameDirty: false, reloadFails: true},
	{gameDirty: true, reloadFails: true},
])(
	"preserves Category save success with dirtyGame=$gameDirty and reloadFailure=$reloadFails",
	async ({gameDirty, reloadFails}) => {
		games = [gameRecord];
		let saved = false;
		const handler = sendMessage.getMockImplementation()!;
		sendMessage.mockImplementation(async (name: string, data?: unknown) => {
			if (saved && reloadFails && /list(Game|Category)Mappings$/.test(name))
				return {
					ok: false,
					error: {code: "mapping_conflict", message: "reload failed"},
				};
			return handler(name, data);
		});
		saveCategory = () => {
			saved = true;
			categories = [childRecord];
			return {
				ok: true,
				data: {record: childRecord, action: "created", settingsRevision: 0},
			};
		};
		render(<Mappings />);
		await selectFirstGame();
		await editNewCategory();
		if (gameDirty) {
			openRename();
			fireEvent.change(screen.getByLabelText("SRC Game の表示名"), {
				target: {value: "Unsaved Game"},
			});
		}
		fireEvent.click(categorySaveButton());
		expect(
			await screen.findByText("Category Mappingを保存しました。"),
		).toBeTruthy();
		if (reloadFails)
			expect(await screen.findByText(/reload failed/)).toBeTruthy();
		expect(screen.getByLabelText("カテゴリ")).toBeTruthy();
		if (gameDirty) {
			expect(screen.getByDisplayValue("Unsaved Game")).toBeTruthy();
			expect(renameSaveButton().disabled).toBe(false);
		}
		expect(screen.queryByText(/他の変更と競合しました/)).toBeNull();
	},
);

const secondGame: GameMappingRecord = {
	mapping: {
		...gameRecord.mapping,
		speedrunCom: {gameId: "g2", gameName: "Second SRC"},
	},
	revision: "g2r",
};

async function openMappingMode(mode: "manage" | "race") {
	if (mode === "manage") {
		render(<Mappings />);
		await selectFirstGame();
	} else {
		render(
			<MappingWorkspace
				mode='race'
				target={{categorySlug: "game", categoryName: "Game One", goal: "Any%"}}
			/>,
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", {name: "編集"}) as HTMLButtonElement)
					.disabled,
			).toBe(false),
		);
		fireEvent.click(screen.getByRole("button", {name: "編集"}));
	}
}

it.each(["manage", "race"] as const)(
	"adds and deletes one of several SRC games from %s",
	async (mode) => {
		games = [gameRecord];
		categories = [childRecord];
		const handler = sendMessage.getMockImplementation()!;
		sendMessage.mockImplementation(async (name: string, data?: unknown) => {
			if (name === "racetime.v5.searchSpeedrunGames")
				return {
					ok: true,
					data: {
						games: [
							{id: "g1", name: "Duplicate", abbreviation: "D"},
							{id: "g2", name: "Second SRC", abbreviation: "S"},
						],
					},
				};
			if (name === "racetime.v5.saveGameMapping") {
				const mapping = (data as {mapping: GameMappingRecord["mapping"]})
					.mapping;
				const record = {mapping, revision: "g2r"};
				games = [...games, record];
				return {
					ok: true,
					data: {record, action: "created", settingsRevision: 0},
				};
			}
			if (name === "racetime.v5.deleteGameMapping") {
				expect(data).toMatchObject({
					categorySlug: "game",
					gameId: "g2",
					expectedRevision: "g2r",
				});
				games = games.filter(
					(record) => record.mapping.speedrunCom.gameId !== "g2",
				);
				return {ok: true, data: {deleted: true, settingsRevision: 0}};
			}
			return handler(name, data);
		});
		await openMappingMode(mode);
		openAddGame();
		fireEvent.change(screen.getByLabelText("SRCゲーム検索"), {
			target: {value: "SRC"},
		});
		fireEvent.click(screen.getByRole("button", {name: "検索"}));
		expect(
			(
				(await screen.findByRole("button", {
					name: "Duplicate (D)",
				})) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", {name: "Second SRC (S)"}));
		fireEvent.click(gameSaveButton());
		expect(await screen.findByText("SRCゲームを追加しました。")).toBeTruthy();
		expect(await screen.findByRole("radio", {name: "Second SRC"})).toBeTruthy();
		expect(screen.getByRole("radio", {name: "SRC Game"})).toBeTruthy();
		fireEvent.click(screen.getByRole("button", {name: "Second SRC の管理"}));
		fireEvent.click(screen.getByRole("button", {name: "登録解除"}));
		fireEvent.click(screen.getByRole("button", {name: "登録解除を確定"}));
		expect(
			await screen.findByText("SRCゲームの登録を解除しました。"),
		).toBeTruthy();
		expect(screen.queryByRole("radio", {name: "Second SRC"})).toBeNull();
		expect(screen.getByRole("radio", {name: "SRC Game"})).toBeTruthy();
	},
);

it.each(["manage", "race"] as const)(
	"clears game-dependent Goal conditions and preserves its revision in %s",
	async (mode) => {
		games = [gameRecord, secondGame];
		categories = [
			{
				...childRecord,
				mapping: {
					...childRecord.mapping,
					speedrunCom: {
						...childRecord.mapping.speedrunCom,
						levelId: "l1",
						variables: {old: "one"},
						platformId: "p1",
						regionId: "r1",
						emulator: true,
						timingMethod: "realtime",
					},
				},
			},
		];
		variablesByCategory = {
			c1: [
				{
					id: "old",
					name: "Old Variable",
					mandatory: false,
					obsoletes: false,
					userDefined: false,
					values: [{id: "one", label: "One"}],
				},
			],
		};
		const handler = sendMessage.getMockImplementation()!;
		sendMessage.mockImplementation(async (name: string, data?: unknown) => {
			const result = (await handler(name, data)) as {
				ok: true;
				data: Record<string, unknown>;
			};
			if (
				name === "racetime.v5.getSpeedrunGameOptions" &&
				(data as {gameId: string}).gameId === "g2"
			)
				return {
					...result,
					data: {
						...result.data,
						categories: [
							{
								id: "c2",
								name: "Second Category",
								type: "per-level",
								miscellaneous: false,
							},
						],
						levels: [{id: "l2", name: "Second Level"}],
					},
				};
			return result;
		});
		await openMappingMode(mode);
		if (mode === "manage")
			fireEvent.click(
				await screen.findByRole("button", {name: /Any%.*SRC Game/}),
			);
		expect(await screen.findByText("Old Variable")).toBeTruthy();
		expect(
			(screen.getByRole("radio", {name: "SRC Game"}) as HTMLInputElement)
				.checked,
		).toBe(true);
		fireEvent.click(screen.getByRole("radio", {name: "Second SRC"}));
		await screen.findByRole("option", {name: /Second Category/});
		expect((screen.getByLabelText("カテゴリ") as HTMLSelectElement).value).toBe(
			"",
		);
		expect(screen.queryByLabelText("Level")).toBeNull();
		expect(screen.queryByText("Old Variable")).toBeNull();
		for (const field of ["Platform", "Region", "Emulator", "Timing Method"])
			expect((screen.getByLabelText(field) as HTMLSelectElement).value).toBe(
				field === "Emulator" ? "any" : "",
			);
		fireEvent.click(
			within(categoryForm()).getByRole("button", {name: "元に戻す"}),
		);
		expect(await screen.findByText("Old Variable")).toBeTruthy();
		expect(
			(screen.getByRole("radio", {name: "SRC Game"}) as HTMLInputElement)
				.checked,
		).toBe(true);
		expect((screen.getByLabelText("Level") as HTMLSelectElement).value).toBe(
			"l1",
		);
		fireEvent.click(screen.getByRole("radio", {name: "Second SRC"}));
		await screen.findByRole("option", {name: /Second Category/});
		fireEvent.change(screen.getByLabelText("カテゴリ"), {
			target: {value: "c2"},
		});
		await screen.findByText("このカテゴリにVariablesはありません。");
		expect((screen.getByLabelText("Level") as HTMLSelectElement).value).toBe(
			"",
		);
		fireEvent.click(categorySaveButton());
		await waitFor(() =>
			expect(sendMessage).toHaveBeenCalledWith(
				"racetime.v5.saveCategoryMapping",
				expect.objectContaining({
					expectedRevision: "c1r",
					mapping: expect.objectContaining({
						racetime: {categorySlug: "game", goal: "Any%"},
						speedrunCom: {
							gameId: "g2",
							categoryId: "c2",
							categoryName: "Second Category",
							levelId: null,
							variables: {},
							platformId: null,
							regionId: null,
							emulator: null,
							timingMethod: null,
						},
					}),
				}),
			),
		);
	},
);

it("lists every Goal alias with its SRC game and category name", async () => {
	games = [gameRecord, secondGame];
	categories = [
		childRecord,
		{
			...childRecord,
			mapping: {
				...childRecord.mapping,
				racetime: {...childRecord.mapping.racetime, goal: "Any Percent"},
			},
		},
		{
			...childRecord,
			mapping: {
				...childRecord.mapping,
				racetime: {...childRecord.mapping.racetime, goal: "All Stages"},
				speedrunCom: {
					...childRecord.mapping.speedrunCom,
					gameId: "g2",
					categoryId: "c2",
					categoryName: "Stages",
				},
			},
		},
	];
	render(<Mappings />);
	await selectFirstGame();
	expect(
		screen.getByRole("button", {name: /Any%.*SRC Game.*Any%/}),
	).toBeTruthy();
	expect(
		screen.getByRole("button", {name: /Any Percent.*SRC Game.*Any%/}),
	).toBeTruthy();
	expect(
		screen.getByRole("button", {name: /All Stages.*Second SRC.*Stages/}),
	).toBeTruthy();
	expect(screen.getAllByText("Game One", {selector: "strong"})).toHaveLength(1);
});

it.each([
	{mode: "manage", multiple: false},
	{mode: "manage", multiple: true},
	{mode: "race", multiple: false},
	{mode: "race", multiple: true},
] as const)(
	"requires explicit SRC game selection for a new Goal in $mode with multiple=$multiple",
	async ({mode, multiple}) => {
		games = multiple ? [gameRecord, secondGame] : [gameRecord];
		await openMappingMode(mode);
		if (mode === "manage")
			fireEvent.click(screen.getByRole("button", {name: /新規 Goal/}));
		const categorySelect = () =>
			screen.getByLabelText("カテゴリ") as HTMLSelectElement;
		expect(
			screen
				.getAllByRole("radio")
				.some((radio) => (radio as HTMLInputElement).checked),
		).toBe(false);
		expect(categorySelect().disabled).toBe(true);
		expect(
			sendMessage.mock.calls.filter(
				([name]) => name === "racetime.v5.getSpeedrunGameOptions",
			),
		).toHaveLength(0);
		const gameName = multiple ? "Second SRC" : "SRC Game";
		const gameId = multiple ? "g2" : "g1";
		fireEvent.click(screen.getByRole("radio", {name: gameName}));
		await waitFor(() => expect(categorySelect().disabled).toBe(false));
		expect(sendMessage).toHaveBeenCalledWith(
			"racetime.v5.getSpeedrunGameOptions",
			{gameId},
		);
		fireEvent.change(categorySelect(), {target: {value: "c1"}});
		await screen.findByText("このカテゴリにVariablesはありません。");
		expect(categorySelect().value).toBe("c1");
		expect(screen.queryByText(/未保存の変更があります/)).toBeNull();
	},
);

it.each(["manage", "race"] as const)(
	"uses the saved Goal's SRC game independently of the Game Mapping being edited in %s",
	async (mode) => {
		games = [gameRecord, secondGame];
		categories = [
			{
				...childRecord,
				mapping: {
					...childRecord.mapping,
					speedrunCom: {...childRecord.mapping.speedrunCom, gameId: "g2"},
				},
			},
		];
		await openMappingMode(mode);
		if (mode === "manage")
			fireEvent.click(screen.getByRole("button", {name: /Any%.*Second SRC/}));
		const categorySelect = () =>
			screen.getByLabelText("カテゴリ") as HTMLSelectElement;
		expect(
			(screen.getByRole("radio", {name: "Second SRC"}) as HTMLInputElement)
				.checked,
		).toBe(true);
		expect(
			(screen.getByRole("radio", {name: "SRC Game"}) as HTMLInputElement)
				.checked,
		).toBe(false);
		await waitFor(() => expect(categorySelect().disabled).toBe(false));
		expect(categorySelect().value).toBe("c1");
		fireEvent.click(screen.getByRole("radio", {name: "SRC Game"}));
		expect(categorySelect().value).toBe("");
	},
);
