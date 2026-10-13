import {
	eventMessageName,
	BUNDLE_NAME as PLAYER_BUNDLE,
	type PlayerManagerAPI,
} from "@nanahuse/player-manager-protocol";
import {
	DEFAULT_MAX_RESOLVED_MAPPINGS,
	OPERATIONS,
	operationMessageName,
	RACES_REPLICANT,
	type RacesState,
	type RaceTimeAPI,
	SETTINGS_REPLICANT,
	type SettingsState,
} from "@nanahuse/racetime-protocol";
import type NodeCG from "@nodecg/types";
import {createAPI, parseSettingsState} from "../api";
import {IntegrationError} from "../errors";
import {ParticipantResolver} from "../integrations/players";
import {HttpRaceTimeClient} from "../integrations/racetime/client";
import {HttpSpeedrunClient} from "../integrations/speedrun/client";
import {SpreadsheetCategoryMappingsRepository} from "../integrations/spreadsheet/category-mappings-repository";
import {SpreadsheetGameMappingsRepository} from "../integrations/spreadsheet/game-mappings-repository";
import {GoogleSheetsClient} from "../integrations/spreadsheet/google-sheets-client";
import {MappingService} from "../mappings";
import {RaceService} from "../service";

export default function (nodecg: NodeCG.ServerAPI): RaceTimeAPI {
	const config = nodecg.bundleConfig as {
		spreadsheetId?: string;
		gameMappingsSheet?: string;
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
	const defaultSettings: SettingsState = {
		revision: 0,
		settings: {
			spreadsheetId: config.spreadsheetId ?? null,
			gameMappingsSheet: config.gameMappingsSheet ?? "GameMappings",
			categoryMappingsSheet: config.categoryMappingsSheet ?? "CategoryMappings",
			maxResolvedMappings: DEFAULT_MAX_RESOLVED_MAPPINGS,
		},
	};
	const settings = nodecg.Replicant<SettingsState>(SETTINGS_REPLICANT, {
		persistent: true,
		defaultValue: defaultSettings,
	});
	let initialSettings: SettingsState;
	try {
		initialSettings = parseSettingsState(settings.value);
	} catch (error) {
		// Only a malformed persisted configuration is recoverable; anything else
		// must keep failing the mount.
		if (!(error instanceof IntegrationError) || error.code !== "invalid_input")
			throw error;
		nodecg.log.warn(
			`racetime-settings was invalid and has been reset to defaults: ${error.message}`,
		);
		initialSettings = structuredClone(defaultSettings);
		settings.value = structuredClone(initialSettings);
	}
	const speedrun = new HttpSpeedrunClient({
		userAgent: `racetime-integration/${nodecg.bundleVersion}`,
	});
	const mappings = new MappingService(
		initialSettings,
		(next) => {
			settings.value = next;
		},
		(current) => {
			if (!current.spreadsheetId) return null;
			const client = GoogleSheetsClient.create(current.spreadsheetId);
			return {
				games: new SpreadsheetGameMappingsRepository(client, {
					sheetName: current.gameMappingsSheet,
				}),
				categories: new SpreadsheetCategoryMappingsRepository(client, {
					sheetName: current.categoryMappingsSheet,
				}),
			};
		},
	);
	const api = createAPI(races, mappings, speedrun, (spreadsheetId) =>
		GoogleSheetsClient.create(spreadsheetId),
	);
	const directoryChanged = (data: {directoryRevision?: unknown}) => {
		if (typeof data?.directoryRevision === "number")
			races.directoryChanged(data.directoryRevision);
	};
	nodecg.listenFor(
		eventMessageName("directoryChanged"),
		PLAYER_BUNDLE,
		directoryChanged,
	);
	nodecg.once("serverStopping", () => {
		nodecg.unlisten(
			eventMessageName("directoryChanged"),
			PLAYER_BUNDLE,
			directoryChanged,
		);
		races.dispose();
	});
	for (const operation of OPERATIONS) {
		nodecg.listenFor(operationMessageName(operation), (data, ack) => {
			void api.request(operation, data).then((result) => {
				if (ack && !ack.handled) ack(null, result);
			});
		});
	}
	return api;
}
