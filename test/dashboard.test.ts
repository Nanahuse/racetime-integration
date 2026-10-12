import {afterEach, expect, it, vi} from "vitest";
import {ApiError, request} from "../ui/dashboard/api/client";
import {
	beginRegistration,
	playerEditUrl,
} from "../ui/dashboard/api/player-manager";
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

it("sends protocol operations with the v2 message name and unwraps responses", async () => {
	sendMessage.mockResolvedValue({ok: true, data: {revision: 3}});
	expect(await request("getSettings", undefined)).toEqual({revision: 3});
	expect(sendMessage).toHaveBeenCalledWith(
		"racetime.v2.getSettings",
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
		"player-manager.v2.beginRegistration",
		"player-manager",
		{input: {racetime: "user1"}, createPlayerOnEmpty: true},
	);
	expect(session.url).toContain("Registration.html");
	expect(playerEditUrl("p1")).toContain("PlayerMapping.html?playerId=p1");
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
