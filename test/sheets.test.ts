import {expect, it, vi} from "vitest";
import {SpreadsheetCategoryMappingsRepository} from "../src/integrations/spreadsheet/category-mappings-repository";
import {
	CATEGORY_MAPPING_SHEET_COLUMNS,
	categoryMappingToSheetRow,
} from "../src/integrations/spreadsheet/category-mappings-row";
import type {SpreadsheetClient} from "../src/integrations/spreadsheet/client";
import {GoogleSheetsClient} from "../src/integrations/spreadsheet/google-sheets-client";
import {MappingService} from "../src/mappings";
import {mapping} from "./fixtures";

function setup(header: string[] = [...CATEGORY_MAPPING_SHEET_COLUMNS]) {
	const values: string[][] = [header];
	let tick = 0;
	const client = {
		readValues: vi.fn(async () => structuredClone(values)),
		updateValues: vi
			.fn<SpreadsheetClient["updateValues"]>()
			.mockImplementation(async (updates) => {
				for (const update of updates) {
					const match = /!([A-Z]+)(\d+)$/.exec(update.range)!;
					const column =
						[...match[1]!].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) -
						1;
					values[Number(match[2]) - 1]![column] = update.values[0]![0]!;
				}
			}),
		appendValues: vi
			.fn<SpreadsheetClient["appendValues"]>()
			.mockImplementation(async (_, rows) => {
				values.push(...rows.map((r) => [...r]));
			}),
	};
	return {
		values,
		client,
		repository: new SpreadsheetCategoryMappingsRepository(client, {
			sheetName: "Category'Mappings",
			now: () => new Date(1791676800000 + tick++),
		}),
	};
}
it("reads and lists existing mappings with reordered columns, blanks and optional fields", async () => {
	const header = [...CATEGORY_MAPPING_SHEET_COLUMNS].reverse();
	const {values, repository, client} = setup(header);
	values.push(
		[],
		header.map((key) => categoryMappingToSheetRow(mapping, "")[key]),
	);
	expect(await repository.find(" game ", "Any%")).toMatchObject({
		mapping,
		revision: expect.any(String),
	});
	expect(await repository.list()).toEqual([
		await repository.find("game", "Any%"),
	]);
	expect(await repository.find("game", "other")).toBeNull();
	expect(client.readValues).toHaveBeenCalledWith("'Category''Mappings'!A1:ZZ");
});
it("distinguishes create and update and rejects stale edits, duplicate creates and missing updates", async () => {
	const {repository, client} = setup();
	const created = await repository.save(mapping, null);
	expect(created.action).toBe("created");
	const changed = structuredClone(mapping);
	changed.speedrunCom.gameName = "Changed";
	const updated = await repository.save(changed, created.record.revision);
	expect(updated.action).toBe("updated");
	expect(updated.record.revision).not.toBe(created.record.revision);
	await expect(
		repository.save(mapping, created.record.revision),
	).rejects.toMatchObject({code: "mapping_conflict"});
	await expect(repository.save(mapping, null)).rejects.toMatchObject({
		code: "mapping_conflict",
	});
	expect(client.updateValues).toHaveBeenCalledTimes(1);
	expect(client.appendValues).toHaveBeenCalledTimes(1);
	await repository.delete("game", "Any%", updated.record.revision);
	await expect(
		repository.save(mapping, updated.record.revision),
	).rejects.toMatchObject({code: "mapping_conflict"});
});
it("updates and deletes only owned cells while retaining unknown columns and formulas", async () => {
	const header = ["notes", ...[...CATEGORY_MAPPING_SHEET_COLUMNS].reverse()];
	const {repository, values, client} = setup(header);
	const row = categoryMappingToSheetRow(mapping, "old");
	values.push(
		header.map((key) =>
			key === "notes" ? "=SUM(Z1:Z2)" : row[key as keyof typeof row],
		),
	);
	const record = (await repository.find("game", "Any%"))!;
	const saved = await repository.save(mapping, record.revision);
	expect(
		client.updateValues.mock.calls[0]![0].some((u) => u.range.endsWith("!A2")),
	).toBe(false);
	await expect(
		repository.delete("game", "Any%", record.revision),
	).rejects.toMatchObject({code: "mapping_conflict"});
	await repository.delete("game", "Any%", saved.record.revision);
	expect(values[1]![0]).toBe("=SUM(Z1:Z2)");
	expect(values[1]!.slice(1).every((cell) => cell === "")).toBe(true);
	expect(await repository.list()).toEqual([]);
});
it("serializes concurrent creates so one wins and the other reports conflict", async () => {
	const {repository, client} = setup();
	const results = await Promise.allSettled([
		repository.save(mapping, null),
		repository.save(mapping, null),
	]);
	expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
	expect(client.appendValues).toHaveBeenCalledOnce();
});
it("rejects duplicate keys/headers, missing headers and malformed cells before mutation", async () => {
	for (const kind of [
		"key",
		"header",
		"missing",
		"json",
		"boolean",
		"timing",
	]) {
		const {repository, values, client} = setup();
		const row = CATEGORY_MAPPING_SHEET_COLUMNS.map(
			(key) => categoryMappingToSheetRow(mapping, "")[key],
		);
		values.push(row);
		if (kind === "key") values.push([...row]);
		if (kind === "header") values[0]!.push("src_game_id");
		if (kind === "missing") values[0]![0] = "wrong";
		if (kind === "json") row[8] = '{"difficulty":1}';
		if (kind === "boolean") row[11] = "maybe";
		if (kind === "timing") row[12] = "unknown";
		await expect(repository.save(mapping, null)).rejects.toMatchObject({
			name: "SheetValidationError",
		});
		expect(client.updateValues).not.toHaveBeenCalled();
		expect(client.appendValues).not.toHaveBeenCalled();
	}
});
it("recovers the write queue after a failed read", async () => {
	const {repository, client} = setup();
	client.readValues.mockRejectedValueOnce(new Error("offline"));
	await expect(repository.save(mapping, null)).rejects.toThrow("offline");
	await repository.save(mapping, null);
	expect(client.appendValues).toHaveBeenCalledOnce();
});
it("uses RAW and disables write retries at the Google boundary", async () => {
	const api = {
		get: vi.fn().mockResolvedValue({data: {values: [[1, false, null]]}}),
		batchUpdate: vi.fn().mockResolvedValue({}),
		append: vi.fn().mockResolvedValue({}),
	};
	const client = new GoogleSheetsClient(
		api as unknown as ConstructorParameters<typeof GoogleSheetsClient>[0],
		"sheet-id",
	);
	expect(await client.readValues("range")).toEqual([["1", "false", ""]]);
	await client.updateValues([{range: "A2", values: [["=unsafe"]]}]);
	expect(api.batchUpdate).toHaveBeenCalledWith(
		{
			spreadsheetId: "sheet-id",
			requestBody: {
				valueInputOption: "RAW",
				data: [{range: "A2", values: [["=unsafe"]]}],
			},
		},
		{retry: false},
	);
	await client.appendValues("A1", [["value"]]);
	expect(api.append).toHaveBeenCalledWith(
		expect.objectContaining({
			valueInputOption: "RAW",
			insertDataOption: "INSERT_ROWS",
		}),
		{retry: false},
	);
	api.get.mockRejectedValueOnce(new Error("credentials"));
	await expect(client.readValues("range")).rejects.toMatchObject({
		name: "SpreadsheetClientError",
	});
});
it("validates settings before committing and rejects stale writes after a destination switch", async () => {
	const a = setup(),
		b = setup();
	const persist = vi.fn();
	const service = new MappingService(
		{
			revision: 0,
			settings: {spreadsheetId: "a", categoryMappingsSheet: "CategoryMappings"},
		},
		persist,
		(settings) =>
			settings.spreadsheetId === "a" ? a.repository : b.repository,
	);
	const created = await service.save(mapping, null, 0);
	b.client.readValues.mockRejectedValueOnce(new Error("no access"));
	await expect(
		service.update({spreadsheetId: "b", categoryMappingsSheet: "Other"}, 0),
	).rejects.toThrow("no access");
	expect(service.settings().settings.spreadsheetId).toBe("a");
	expect(persist).not.toHaveBeenCalled();
	await service.update({spreadsheetId: "b", categoryMappingsSheet: "Other"}, 0);
	expect(persist).toHaveBeenCalledWith({
		revision: 1,
		settings: {spreadsheetId: "b", categoryMappingsSheet: "Other"},
	});
	await expect(
		service.save(mapping, created.record.revision, 0),
	).rejects.toMatchObject({code: "settings_changed"});
	await expect(
		service.delete("game", "Any%", created.record.revision, 0),
	).rejects.toMatchObject({code: "settings_changed"});
	expect(await service.list()).toEqual({records: [], settingsRevision: 1});
	const saved = await service.save(mapping, null, 1);
	expect(saved.action).toBe("created");
	await service.delete("game", "Any%", saved.record.revision, 1);
	expect((await service.list()).records).toEqual([]);
	await expect(
		service.update(
			{spreadsheetId: "a", categoryMappingsSheet: "CategoryMappings"},
			0,
		),
	).rejects.toMatchObject({code: "settings_changed"});
});
