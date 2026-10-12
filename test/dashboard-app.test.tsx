// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
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

afterEach(() => {
	cleanup();
	sendMessage.mockReset();
	sendMessageToBundle.mockReset();
});

it("shows the public Player Manager readiness in the header", async () => {
	sendMessageToBundle.mockResolvedValue({
		ok: true,
		data: {ready: true, error: null},
	});
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
