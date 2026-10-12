/**
 * Accepts a full Google Sheets URL or a bare spreadsheet ID and normalizes it
 * to the ID the API expects. Returns null for empty input.
 */
export function spreadsheetIdFromInput(input: string): string | null {
	const trimmed = input.trim();
	if (trimmed === "") return null;
	const match = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(trimmed);
	return match ? match[1]! : trimmed;
}

export function spreadsheetEditUrl(spreadsheetId: string): string {
	return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}
