import type {PlayerManagerAPI} from "@nanahuse/player-manager-protocol";
import {
	OPERATIONS,
	operationMessageName,
	RACES_REPLICANT,
	type RacesState,
	type RaceTimeAPI,
} from "@nanahuse/racetime-protocol";
import type NodeCG from "@nodecg/types";
import {createAPI} from "../api";
import {ParticipantResolver} from "../integrations/players";
import {HttpRaceTimeClient} from "../integrations/racetime/client";
import {SpreadsheetCategoryMappingsRepository} from "../integrations/spreadsheet/category-mappings-repository";
import {GoogleSheetsClient} from "../integrations/spreadsheet/google-sheets-client";
import {RaceService} from "../service";

export default function (nodecg: NodeCG.ServerAPI): RaceTimeAPI {
	const config = nodecg.bundleConfig as {
		spreadsheetId?: string;
		categoryMappingsSheet?: string;
	};
	const state = nodecg.Replicant<RacesState>(RACES_REPLICANT, {
		persistent: false,
		defaultValue: {schemaVersion: 1, races: []},
	});
	const players = new ParticipantResolver(
		() => nodecg.extensions["player-manager"] as PlayerManagerAPI | undefined,
	);
	const races = new RaceService(
		new HttpRaceTimeClient(),
		(url) => new WebSocket(url),
		players,
		(value) => {
			state.value = value;
		},
	);
	const repository = config.spreadsheetId
		? new SpreadsheetCategoryMappingsRepository(
				GoogleSheetsClient.create(config.spreadsheetId),
				{sheetName: config.categoryMappingsSheet ?? "CategoryMappings"},
			)
		: null;
	const api = createAPI(races, repository);
	nodecg.once("serverStopping", () => races.dispose());
	for (const operation of OPERATIONS) {
		nodecg.listenFor(operationMessageName(operation), (data, ack) => {
			void api.request(operation, data).then((result) => {
				if (ack && !ack.handled) ack(null, result);
			});
		});
	}
	return api;
}
