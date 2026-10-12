// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
export class SpreadsheetIntegrationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = new.target.name;
	}
}

/** Low-level failure talking to the spreadsheet provider. */
export class SpreadsheetClientError extends SpreadsheetIntegrationError {}

/** A single problem found while reading or validating a generic sheet. */
export type SheetIssue = {
	code: string;
	message: string;
	/** 1-based spreadsheet row number, or null when the issue is sheet-wide. */
	row: number | null;
};

/** Generic whole-sheet validation failure (Category Mappings / Presentation). */
export class SheetValidationError extends SpreadsheetIntegrationError {
	readonly sheetName: string;
	readonly issues: readonly SheetIssue[];

	constructor(sheetName: string, issues: readonly SheetIssue[]) {
		super(
			`Sheet "${sheetName}" failed validation: ${issues.map((issue) => `${issue.row === null ? "" : `row ${issue.row}: `}${issue.message}`).join("; ")}`,
		);
		this.sheetName = sheetName;
		this.issues = issues;
	}
}
