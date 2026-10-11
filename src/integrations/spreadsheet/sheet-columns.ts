// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import type {SheetIssue} from "./errors";

export const SHEET_HEADER_ISSUE_CODES = {
	headerMissingColumn: "header_missing_column",
} as const;

export type ColumnMap<C extends string> = Record<C, number>;

export type BuildColumnMapResult<C extends string> =
	| {ok: true; map: ColumnMap<C>; columnCount: number}
	| {ok: false; issues: SheetIssue[]};

/**
 * Build a header-name -> column-index map. Columns are matched by header name,
 * so sheet column order does not matter.
 */
export function buildColumnMap<C extends string>(
	header: readonly string[],
	columns: readonly C[],
): BuildColumnMapResult<C> {
	const normalizedHeader = header.map((value) => value.trim());
	const map = {} as ColumnMap<C>;
	const issues: SheetIssue[] = [];

	for (const column of columns) {
		const index = normalizedHeader.indexOf(column);
		if (index === -1) {
			issues.push({
				code: SHEET_HEADER_ISSUE_CODES.headerMissingColumn,
				message: `Missing column "${column}".`,
				row: 1,
			});
		} else if (normalizedHeader.lastIndexOf(column) !== index) {
			issues.push({
				code: "duplicate_column",
				message: `Duplicate column "${column}".`,
				row: 1,
			});
		} else {
			map[column] = index;
		}
	}

	if (issues.length > 0) {
		return {ok: false, issues};
	}
	return {ok: true, map, columnCount: normalizedHeader.length};
}

/** Read a row by column name without trimming (row modules normalize fields). */
export function valuesToRawRow<C extends string>(
	values: readonly string[],
	map: ColumnMap<C>,
	columns: readonly C[],
): Record<C, string> {
	const row = {} as Record<C, string>;
	for (const column of columns) {
		row[column] = values[map[column]] ?? "";
	}
	return row;
}
