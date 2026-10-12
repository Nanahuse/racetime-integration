// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import type {SpreadsheetValues} from "./client";
import type {SheetIssue} from "./errors";
import {buildColumnMap, type ColumnMap, valuesToRawRow} from "./sheet-columns";

export type SheetRowIssue = {code: string; message: string};

export type SheetRowConversion<T> =
	| {ok: true; value: T}
	| {ok: false; issues: readonly SheetRowIssue[]};

export type ParsedSheetEntry<C extends string, T> = {
	rowNumber: number;
	value: T;
	row: Record<C, string>;
};

/**
 * `empty` means the whole sheet is blank, so a header may safely be written.
 * `valid` means the header is recognized and every non-blank row is valid.
 * `invalid` marks headers or rows that must not be overwritten automatically.
 */
export type SheetParseStatus = "empty" | "valid" | "invalid";

export type SheetParseResult<C extends string, T> = {
	status: SheetParseStatus;
	map: ColumnMap<C> | null;
	columnCount: number;
	entries: ParsedSheetEntry<C, T>[];
	issues: SheetIssue[];
};

export type SheetParseOptions<C extends string, T> = {
	columns: readonly C[];
	convert: (row: Record<C, string>) => SheetRowConversion<T>;
	key: (value: T) => string;
	duplicateCode: string;
	duplicateMessage: (value: T, previousRow: number) => string;
};

function isBlankRow(values: readonly string[]): boolean {
	return values.every((value) => (value ?? "").trim() === "");
}

/**
 * Shared header/row validation used by both the repositories and the
 * spreadsheet initializer so the accepted format never diverges.
 */
export function parseSheetValues<C extends string, T>(
	values: SpreadsheetValues,
	options: SheetParseOptions<C, T>,
): SheetParseResult<C, T> {
	const {columns, convert, key, duplicateCode, duplicateMessage} = options;
	const header = values[0] ?? [];
	const headerPresent = !isBlankRow(header);
	const hasDataRows = values.slice(1).some((row) => !isBlankRow(row));
	const headerResult = buildColumnMap(header, columns);

	if (!headerPresent && !hasDataRows)
		return {
			status: "empty",
			map: null,
			columnCount: 0,
			entries: [],
			issues: headerResult.ok ? [] : [...headerResult.issues],
		};

	if (!headerResult.ok)
		return {
			status: "invalid",
			map: null,
			columnCount: 0,
			entries: [],
			issues: [...headerResult.issues],
		};

	const {map, columnCount} = headerResult;
	const entries: ParsedSheetEntry<C, T>[] = [];
	const issues: SheetIssue[] = [];
	const seenKeys = new Map<string, number>();

	for (let index = 1; index < values.length; index += 1) {
		const rawValues = values[index] ?? [];
		if (isBlankRow(rawValues)) continue;

		const rowNumber = index + 1;
		const row = valuesToRawRow(rawValues, map, columns);
		if (isBlankRow(Object.values(row))) continue;

		const conversion = convert(row);
		if (!conversion.ok) {
			for (const issue of conversion.issues)
				issues.push({
					code: issue.code,
					message: issue.message,
					row: rowNumber,
				});
			continue;
		}

		const rowKey = key(conversion.value);
		const previousRow = seenKeys.get(rowKey);
		if (previousRow !== undefined) {
			issues.push({
				code: duplicateCode,
				message: duplicateMessage(conversion.value, previousRow),
				row: rowNumber,
			});
			continue;
		}
		seenKeys.set(rowKey, rowNumber);
		entries.push({rowNumber, value: conversion.value, row});
	}

	if (issues.length > 0)
		return {status: "invalid", map, columnCount, entries, issues};

	return {status: "valid", map, columnCount, entries, issues: []};
}
