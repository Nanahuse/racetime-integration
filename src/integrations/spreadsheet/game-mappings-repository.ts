// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import {createHash} from "node:crypto";
import type {GameMapping, GameMappingRecord} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "../../errors";
import {
	columnLetter,
	quoteSheetName,
	type SpreadsheetClient,
	type SpreadsheetValues,
	sheetAppendRange,
	sheetReadRange,
} from "./client";
import {SheetValidationError} from "./errors";
import {
	GAME_MAPPING_ROW_ISSUE_CODES,
	GAME_MAPPING_SHEET_COLUMNS,
	type GameMappingSheetColumn,
	type GameMappingSheetRow,
	gameMappingSheetRowToMapping,
	gameMappingToSheetRow,
	validateGameMapping,
} from "./game-mappings-row";
import type {ColumnMap} from "./sheet-columns";
import {parseSheetValues} from "./sheet-parse";

export interface GameMappingsRepository {
	find(categorySlug: string): Promise<GameMappingRecord | null>;
	list(): Promise<GameMappingRecord[]>;
	save(
		mapping: GameMapping,
		expectedRevision: string | null,
	): Promise<{record: GameMappingRecord; action: "created" | "updated"}>;
	delete(categorySlug: string, expectedRevision: string): Promise<void>;
}

export type SpreadsheetGameMappingsRepositoryOptions = {
	sheetName: string;
	now?: () => Date;
};

type GameMappingEntry = {
	rowNumber: number;
	mapping: GameMapping;
	revision: string;
};

type ParsedGameMappingsSheet = {
	map: ColumnMap<GameMappingSheetColumn>;
	columnCount: number;
	entries: GameMappingEntry[];
};

function mappingKey(categorySlug: string): string {
	return categorySlug.trim();
}

function positionRow(
	row: GameMappingSheetRow,
	map: ColumnMap<GameMappingSheetColumn>,
	columnCount: number,
): string[] {
	const width = Math.max(columnCount, GAME_MAPPING_SHEET_COLUMNS.length);
	const output = new Array<string>(width).fill("");
	for (const column of GAME_MAPPING_SHEET_COLUMNS) {
		output[map[column]] = row[column];
	}
	return output;
}

function rowRevision(row: GameMappingSheetRow): string {
	return createHash("sha256")
		.update(
			JSON.stringify(GAME_MAPPING_SHEET_COLUMNS.map((column) => row[column])),
		)
		.digest("hex");
}

export class SpreadsheetGameMappingsRepository
	implements GameMappingsRepository
{
	private writes: Promise<unknown> = Promise.resolve();
	private readonly client: SpreadsheetClient;
	private readonly sheetName: string;
	private readonly now: () => Date;

	constructor(
		client: SpreadsheetClient,
		options: SpreadsheetGameMappingsRepositoryOptions,
	) {
		this.client = client;
		this.sheetName = options.sheetName;
		this.now = options.now ?? (() => new Date());
	}

	async find(categorySlug: string): Promise<GameMappingRecord | null> {
		const parsed = this.parse(
			await this.client.readValues(sheetReadRange(this.sheetName)),
		);
		const key = mappingKey(categorySlug);
		const entry = parsed.entries.find(
			(candidate) =>
				mappingKey(candidate.mapping.racetime.categorySlug) === key,
		);
		return entry ? {mapping: entry.mapping, revision: entry.revision} : null;
	}

	async list(): Promise<GameMappingRecord[]> {
		return this.parse(
			await this.client.readValues(sheetReadRange(this.sheetName)),
		).entries.map(({mapping, revision}) => ({mapping, revision}));
	}

	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const write = this.writes.then(operation);
		this.writes = write.catch(() => {});
		return write;
	}

	save(
		mapping: GameMapping,
		expectedRevision: string | null,
	): Promise<{record: GameMappingRecord; action: "created" | "updated"}> {
		const snapshot = structuredClone(mapping);
		return this.serialize(() => this.write(snapshot, expectedRevision));
	}

	delete(categorySlug: string, expectedRevision: string): Promise<void> {
		return this.serialize(async () => {
			const parsed = this.parse(
				await this.client.readValues(sheetReadRange(this.sheetName)),
			);
			const entry = parsed.entries.find(
				(item) =>
					mappingKey(item.mapping.racetime.categorySlug) ===
					mappingKey(categorySlug),
			);
			if (!entry || entry.revision !== expectedRevision)
				throw new IntegrationError(
					"mapping_conflict",
					"Game mapping changed or was deleted; reload before deleting",
				);
			await this.client.updateValues(
				GAME_MAPPING_SHEET_COLUMNS.map((column) => ({
					range: `${quoteSheetName(this.sheetName)}!${columnLetter(parsed.map[column])}${entry.rowNumber}`,
					values: [[""]],
				})),
			);
		});
	}

	private async write(
		mapping: GameMapping,
		expectedRevision: string | null,
	): Promise<{record: GameMappingRecord; action: "created" | "updated"}> {
		const incomingIssues = validateGameMapping(mapping);
		if (incomingIssues.length > 0) {
			throw new SheetValidationError(
				this.sheetName,
				incomingIssues.map((issue) => ({
					code: issue.code,
					message: issue.message,
					row: null,
				})),
			);
		}

		const values = await this.client.readValues(sheetReadRange(this.sheetName));
		const parsed = this.parse(values);

		const row = gameMappingToSheetRow(mapping, this.now().toISOString());
		const key = mappingKey(mapping.racetime.categorySlug);
		const existing = parsed.entries.find(
			(candidate) =>
				mappingKey(candidate.mapping.racetime.categorySlug) === key,
		);
		if ((existing?.revision ?? null) !== expectedRevision)
			throw new IntegrationError(
				"mapping_conflict",
				"Game mapping changed or already exists; reload before saving",
			);
		const record = {mapping, revision: rowRevision(row)};

		if (existing) {
			await this.client.updateValues(
				GAME_MAPPING_SHEET_COLUMNS.map((column) => ({
					range: `${quoteSheetName(this.sheetName)}!${columnLetter(parsed.map[column])}${existing.rowNumber}`,
					values: [[row[column]]],
				})),
			);
			return {record, action: "updated"};
		}

		await this.client.appendValues(sheetAppendRange(this.sheetName), [
			positionRow(row, parsed.map, parsed.columnCount),
		]);
		return {record, action: "created"};
	}

	private parse(values: SpreadsheetValues): ParsedGameMappingsSheet {
		const result = parseSheetValues(values, {
			columns: GAME_MAPPING_SHEET_COLUMNS,
			convert: (row) => {
				const conversion = gameMappingSheetRowToMapping(row);
				return conversion.ok
					? {ok: true as const, value: conversion.mapping}
					: conversion;
			},
			key: (mapping) => mappingKey(mapping.racetime.categorySlug),
			duplicateCode: GAME_MAPPING_ROW_ISSUE_CODES.duplicateKey,
			duplicateMessage: (mapping, previousRow) =>
				`Duplicate game mapping key "${mapping.racetime.categorySlug}" (also on row ${previousRow}).`,
		});
		if (result.status !== "valid" || !result.map)
			throw new SheetValidationError(this.sheetName, result.issues);
		return {
			map: result.map,
			columnCount: Math.max(
				result.columnCount,
				GAME_MAPPING_SHEET_COLUMNS.length,
			),
			entries: result.entries.map((entry) => ({
				rowNumber: entry.rowNumber,
				mapping: entry.value,
				revision: rowRevision(entry.row),
			})),
		};
	}
}
