// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
/**
 * Thin abstraction over a spreadsheet provider. Keeping this interface free of
 * any Google SDK types lets the repository be tested with a fake and prevents
 * provider types from leaking into the domain.
 */
export type SpreadsheetValues = string[][];

export interface SpreadsheetClient {
	readValues(range: string): Promise<SpreadsheetValues>;
	updateValues(
		updates: readonly {range: string; values: string[][]}[],
	): Promise<void>;
	appendValues(
		range: string,
		values: readonly (readonly string[])[],
	): Promise<void>;
	/** Titles of every worksheet in the spreadsheet, in API order. */
	listSheets(): Promise<string[]>;
	createSheet(sheetName: string): Promise<void>;
}

/** Quote a sheet name for use in A1 notation. */
export function quoteSheetName(sheetName: string): string {
	return `'${sheetName.replace(/'/g, "''")}'`;
}

/** Convert a zero-based column index to a spreadsheet column letter (0 -> A). */
export function columnLetter(columnIndex: number): string {
	let index = columnIndex;
	let letters = "";
	do {
		const remainder = index % 26;
		letters = String.fromCharCode(65 + remainder) + letters;
		index = Math.floor(index / 26) - 1;
	} while (index >= 0);
	return letters;
}

/** Range used to read the whole table (all columns, all rows). */
export function sheetReadRange(sheetName: string): string {
	return `${quoteSheetName(sheetName)}!A1:ZZ`;
}

/** Range that the provider uses to locate the table when appending rows. */
export function sheetAppendRange(sheetName: string): string {
	return `${quoteSheetName(sheetName)}!A1`;
}
