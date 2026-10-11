import {sheets} from "@googleapis/sheets";
import {GoogleAuth} from "google-auth-library";
import type {SpreadsheetClient, SpreadsheetValues} from "./client";
import {SpreadsheetClientError} from "./errors";

type ValuesApi = ReturnType<typeof sheets>["spreadsheets"]["values"];

export class GoogleSheetsClient implements SpreadsheetClient {
	constructor(
		private readonly api: ValuesApi,
		private readonly spreadsheetId: string,
	) {}

	static create(spreadsheetId: string): GoogleSheetsClient {
		const auth = new GoogleAuth({
			scopes: ["https://www.googleapis.com/auth/spreadsheets"],
		});
		return new GoogleSheetsClient(
			sheets({version: "v4", auth, timeout: 30_000}).spreadsheets.values,
			spreadsheetId,
		);
	}

	async readValues(range: string): Promise<SpreadsheetValues> {
		try {
			const response = await this.api.get({
				spreadsheetId: this.spreadsheetId,
				range,
			});
			return (response.data.values ?? []).map((row) =>
				row.map((cell: unknown) => (cell == null ? "" : String(cell))),
			);
		} catch (cause) {
			throw new SpreadsheetClientError(`Failed to read range "${range}".`, {
				cause,
			});
		}
	}

	async updateValues(
		updates: readonly {range: string; values: string[][]}[],
	): Promise<void> {
		try {
			await this.api.batchUpdate(
				{
					spreadsheetId: this.spreadsheetId,
					requestBody: {valueInputOption: "RAW", data: [...updates]},
				},
				{retry: false},
			);
		} catch (cause) {
			throw new SpreadsheetClientError(
				"Failed to update CategoryMappings cells.",
				{cause},
			);
		}
	}

	async appendValues(
		range: string,
		values: readonly (readonly string[])[],
	): Promise<void> {
		try {
			await this.api.append(
				{
					spreadsheetId: this.spreadsheetId,
					range,
					valueInputOption: "RAW",
					insertDataOption: "INSERT_ROWS",
					requestBody: {values: values.map((row) => [...row])},
				},
				{retry: false},
			);
		} catch (cause) {
			throw new SpreadsheetClientError(`Failed to append range "${range}".`, {
				cause,
			});
		}
	}
}
