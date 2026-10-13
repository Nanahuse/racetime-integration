import {afterEach, expect, it, vi} from "vitest";
import {
	ApiError,
	isConflict,
	isSettingsChanged,
	request,
} from "../ui/dashboard/api/client";
import {
	beginRegistration,
	playerEditUrl,
	playerManagerStatus,
} from "../ui/dashboard/api/player-manager";
import {diffValues} from "../ui/dashboard/model/diff";
import {
	spreadsheetEditUrl,
	spreadsheetIdFromInput,
} from "../ui/dashboard/model/spreadsheet";

const sendMessage = vi.fn();
const sendMessageToBundle = vi.fn();
(globalThis as {window?: unknown}).window = {
	nodecg: {
		sendMessage,
		sendMessageToBundle,
		Replicant: vi.fn(),
	},
};

afterEach(() => {
	sendMessage.mockReset();
	sendMessageToBundle.mockReset();
});

it("sends protocol operations with the v4 message name and unwraps responses", async () => {
	sendMessage.mockResolvedValue({ok: true, data: {revision: 3}});
	expect(await request("getSettings", undefined)).toEqual({revision: 3});
	expect(sendMessage).toHaveBeenCalledWith(
		"racetime.v4.getSettings",
		undefined,
	);
	sendMessage.mockResolvedValue({
		ok: false,
		error: {code: "mapping_conflict", message: "conflict"},
	});
	await expect(request("getSettings", undefined)).rejects.toBeInstanceOf(
		ApiError,
	);
});

it("navigates to Player Manager through its public registration API and URLs", async () => {
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {
			registrationId: "r1",
			url: "/bundles/player-manager/dashboard/Registration.html?registrationId=r1",
		},
	});
	const session = await beginRegistration("user1");
	expect(sendMessageToBundle).toHaveBeenCalledWith(
		"player-manager.v3.beginRegistration",
		"player-manager",
		{input: {racetime: "user1"}, createPlayerOnEmpty: true},
	);
	expect(session.url).toContain("Registration.html");
	expect(playerEditUrl("p1")).toContain("PlayerMapping.html");
	expect(playerEditUrl("p1")).toContain("playerId=p1");
});

it("normalizes spreadsheet URLs and IDs", () => {
	expect(
		spreadsheetIdFromInput(
			"https://docs.google.com/spreadsheets/d/abc-123/edit#gid=0",
		),
	).toBe("abc-123");
	expect(spreadsheetIdFromInput(" abc_123 ")).toBe("abc_123");
	expect(spreadsheetIdFromInput("")).toBeNull();
	expect(spreadsheetEditUrl("abc")).toContain("/spreadsheets/d/abc/edit");
});

it("maps the public Player Manager status to dashboard states", async () => {
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {ready: true, error: null},
	});
	expect(await playerManagerStatus()).toEqual({state: "ready"});
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {ready: false, error: null},
	});
	expect(await playerManagerStatus()).toEqual({state: "loading"});
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {ready: false, error: "boom"},
	});
	expect(await playerManagerStatus()).toEqual({
		state: "error",
		message: "boom",
	});
	sendMessageToBundle.mockResolvedValue({
		ok: false,
		error: {code: "directory_unavailable", message: "down"},
	});
	expect(await playerManagerStatus()).toMatchObject({state: "unavailable"});
	sendMessageToBundle.mockRejectedValue(new Error("no bundle"));
	expect(await playerManagerStatus()).toMatchObject({
		state: "unavailable",
		message: "no bundle",
	});
	expect(sendMessageToBundle).toHaveBeenCalledWith(
		"player-manager.v3.status",
		"player-manager",
		undefined,
	);
});

it("separates revision conflicts from spreadsheet settings changes", () => {
	expect(isConflict(new ApiError("mapping_conflict", "x"))).toBe(true);
	expect(isConflict(new ApiError("game_mapping_conflict", "x"))).toBe(false);
	expect(isSettingsChanged(new ApiError("settings_changed", "x"))).toBe(true);
	expect(isSettingsChanged(new ApiError("mapping_conflict", "x"))).toBe(false);
});

it("diffs mapping values leaf-by-leaf for conflict review", () => {
	expect(diffValues({a: 1, b: {c: "x"}}, {a: 2, b: {c: "x"}})).toEqual([
		{path: "a", before: "1", after: "2"},
	]);
	expect(diffValues({a: 1}, {a: 1})).toEqual([]);
	expect(diffValues({a: null}, {a: "y"})).toEqual([
		{path: "a", before: "—", after: "y"},
	]);
});
