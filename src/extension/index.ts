import {
	BUNDLE_NAME as PLAYER_BUNDLE,
	type PlayerManagerAPI,
	eventMessageName as playerEventMessageName,
} from "@nanahuse/player-manager-protocol";
import {
	DEFAULT_ALLOWED_RACE_ORIGINS,
	DEFAULT_LEADERBOARD_TOP,
	DEFAULT_MAX_RESOLVED_MAPPINGS,
	eventMessageName,
	OPERATIONS,
	operationMessageName,
	RACES_REPLICANT,
	type RacesState,
	type RaceTimeAPI,
	SETTINGS_REPLICANT,
	normalizeAllowedRaceOrigins,
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
import {SpeedrunRecordService} from "../speedrun-records";

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
		(event) => {
			const name = eventMessageName(event.type);
			const report = (error: unknown) =>
				nodecg.log.warn(
					`Failed to send ${name}: ${error instanceof Error ? error.message : String(error)}`,
				);
			try {
				void Promise.resolve(nodecg.sendMessage(name, event.payload)).catch(
					report,
				);
			} catch (error) {
				report(error);
			}
		},
		(error, event) => {
			nodecg.log.warn(`Race event notification failed: ${event.type}`, error);
		},
	);
	const defaultSettings: SettingsState = {
		revision: 0,
		settings: {
			spreadsheetId: config.spreadsheetId ?? null,
			gameMappingsSheet: config.gameMappingsSheet ?? "GameMappings",
			categoryMappingsSheet: config.categoryMappingsSheet ?? "CategoryMappings",
			allowedRaceOrigins: [...DEFAULT_ALLOWED_RACE_ORIGINS],
			maxResolvedMappings: DEFAULT_MAX_RESOLVED_MAPPINGS,
			leaderboardTop: DEFAULT_LEADERBOARD_TOP,
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
		const storedSettings =
			settings.value &&
			typeof settings.value === "object" &&
			"settings" in settings.value &&
			settings.value.settings &&
			typeof settings.value.settings === "object"
				? settings.value.settings
				: null;
		if (
			storedSettings &&
			Object.hasOwn(storedSettings, "allowedRaceOrigins")
		) {
			try {
				normalizeAllowedRaceOrigins(storedSettings.allowedRaceOrigins);
			} catch {
				throw error;
			}
		}
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
	if (
		settings.value &&
		typeof settings.value === "object" &&
		"settings" in settings.value &&
		settings.value.settings &&
		typeof settings.value.settings === "object" &&
		["maxResolvedMappings", "leaderboardTop", "allowedRaceOrigins"].some(
			(field) => !(field in settings.value.settings),
		)
	)
		settings.value = structuredClone(initialSettings);
	races.setAllowedRaceOrigins(initialSettings.settings.allowedRaceOrigins);
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
		(next) => races.setAllowedRaceOrigins(next.settings.allowedRaceOrigins),
	);
	const records = new SpeedrunRecordService(
		mappings,
		speedrun,
		players,
		() => mappings.settings().settings.leaderboardTop,
	);
	const api = createAPI(
		races,
		mappings,
		speedrun,
		(spreadsheetId) => GoogleSheetsClient.create(spreadsheetId),
		records,
	);
	const directoryChanged = (data: {directoryRevision?: unknown}) => {
		if (typeof data?.directoryRevision === "number")
			races.directoryChanged(data.directoryRevision);
	};
	nodecg.listenFor(
		playerEventMessageName("directoryChanged"),
		PLAYER_BUNDLE,
		directoryChanged,
	);
	nodecg.once("serverStopping", () => {
		nodecg.unlisten(
			playerEventMessageName("directoryChanged"),
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
