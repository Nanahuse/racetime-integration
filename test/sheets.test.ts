import {expect, it, vi} from "vitest";
import {SpreadsheetCategoryMappingsRepository} from "../src/integrations/spreadsheet/category-mappings-repository";
import {
	CATEGORY_MAPPING_SHEET_COLUMNS,
	categoryMappingToSheetRow,
} from "../src/integrations/spreadsheet/category-mappings-row";
import type {SpreadsheetClient} from "../src/integrations/spreadsheet/client";
import {GoogleSheetsClient} from "../src/integrations/spreadsheet/google-sheets-client";
import {mapping} from "./fixtures";

function setup(header: string[] = [...CATEGORY_MAPPING_SHEET_COLUMNS]) {
	const values: string[][] = [header];
	const client = {
		readValues: vi.fn(async () => structuredClone(values)),
		updateValues: vi
			.fn<SpreadsheetClient["updateValues"]>()
			.mockResolvedValue(),
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
			now: () => new Date("2026-10-11T00:00:00Z"),
		}),
	};
}
it("reads existing CategoryMappings with reordered columns, blanks and optional fields", async () => {
	const header = [...CATEGORY_MAPPING_SHEET_COLUMNS].reverse();
	const {values, repository, client} = setup(header);
	values.push(
		[],
		header.map((key) => categoryMappingToSheetRow(mapping, "")[key]),
	);
	expect(await repository.find(" game ", "Any%")).toEqual(mapping);
	expect(await repository.find("game", "other")).toBeNull();
	expect(client.readValues).toHaveBeenCalledWith("'Category''Mappings'!A1:ZZ");
});
it("writes only owned columns, leaving unknown columns and formulas untouched", async () => {
	const header = ["notes", ...[...CATEGORY_MAPPING_SHEET_COLUMNS].reverse()];
	const {repository, values, client} = setup(header);
	const row = categoryMappingToSheetRow(mapping, "old");
	values.push(
		header.map((key) =>
			key === "notes" ? "=SUM(Z1:Z2)" : row[key as keyof typeof row],
		),
	);
	await repository.upsert(mapping);
	const updates = client.updateValues.mock.calls[0]![0];
	expect(updates).toHaveLength(14);
	expect(updates.some((u) => u.range.endsWith("!A2"))).toBe(false);
	expect(updates).toContainEqual({
		range: "'Category''Mappings'!B2",
		values: [["2026-10-11T00:00:00.000Z"]],
	});
	expect(client.appendValues).not.toHaveBeenCalled();
});
it("serializes concurrent upserts so the second updates the inserted row", async () => {
	const {repository, client} = setup();
	await Promise.all([repository.upsert(mapping), repository.upsert(mapping)]);
	expect(client.appendValues).toHaveBeenCalledTimes(1);
	expect(client.updateValues).toHaveBeenCalledTimes(1);
});
it("rejects duplicate keys, duplicate headers, missing headers and malformed cells before writing", async () => {
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
		await expect(repository.upsert(mapping)).rejects.toMatchObject({
			name: "SheetValidationError",
		});
		expect(client.updateValues).not.toHaveBeenCalled();
		expect(client.appendValues).not.toHaveBeenCalled();
	}
});
it("does not poison the write queue after failure", async () => {
	const {repository, client} = setup();
	client.readValues.mockRejectedValueOnce(new Error("offline"));
	await expect(repository.upsert(mapping)).rejects.toThrow("offline");
	await repository.upsert(mapping);
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
