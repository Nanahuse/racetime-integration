import type {
	CategoryMapping,
	CategoryMappingRecord,
	GameMapping,
	GameMappingRecord,
	ResolveCategoryMappingResult,
	Settings,
	SettingsState,
} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "./errors";
import type {CategoryMappingsRepository} from "./integrations/spreadsheet/category-mappings-repository";
import type {GameMappingsRepository} from "./integrations/spreadsheet/game-mappings-repository";

/** The two independent sheets that back the mapping model. */
export interface MappingsRepository {
	games: GameMappingsRepository;
	categories: CategoryMappingsRepository;
}

/**
 * Verifies that a Speedrun.com category belongs to the game referenced by the
 * parent Game Mapping. Runs inside the serialized section so a concurrent game
 * change cannot slip between the check and the write.
 */
export type CategoryIntegrityCheck = (
	game: GameMapping["speedrunCom"],
	category: CategoryMapping["speedrunCom"],
) => Promise<void>;

function slotKey(value: string): string {
	return value.trim();
}

export class MappingService {
	private queue: Promise<unknown> = Promise.resolve();
	private state: SettingsState;
	private repository: MappingsRepository | null;
	constructor(
		initial: SettingsState,
		private readonly persist: (state: SettingsState) => void,
		private readonly createRepository: (
			settings: Settings,
		) => MappingsRepository | null,
	) {
		this.state = structuredClone(initial);
		this.repository = createRepository(this.state.settings);
	}
	settings(): SettingsState {
		return structuredClone(this.state);
	}
	private serialize<T>(action: () => Promise<T>): Promise<T> {
		const task = this.queue.then(action);
		this.queue = task.catch(() => {});
		return task;
	}
	private requireRepository(): MappingsRepository {
		if (!this.repository)
			throw new IntegrationError(
				"spreadsheet_unavailable",
				"Configure spreadsheetId to manage mappings",
			);
		return this.repository;
	}
	private checkRevision(expected: number): void {
		if (this.state.revision !== expected)
			throw new IntegrationError(
				"settings_changed",
				"Spreadsheet settings changed; reload before writing",
			);
	}
	update(settings: Settings, expectedRevision: number): Promise<SettingsState> {
		const next = structuredClone(settings);
		return this.serialize(async () => {
			this.checkRevision(expectedRevision);
			const repository = this.createRepository(next);
			if (repository)
				await Promise.all([
					repository.games.list(),
					repository.categories.list(),
				]);
			const state = {revision: this.state.revision + 1, settings: next};
			this.persist(structuredClone(state));
			this.repository = repository;
			this.state = state;
			return this.settings();
		});
	}

	listGames(): Promise<{
		records: GameMappingRecord[];
		settingsRevision: number;
	}> {
		return this.serialize(async () => ({
			records: await this.requireRepository().games.list(),
			settingsRevision: this.state.revision,
		}));
	}
	findGame(categorySlug: string): Promise<{
		record: GameMappingRecord | null;
		settingsRevision: number;
	}> {
		return this.serialize(async () => ({
			record: await this.requireRepository().games.find(categorySlug),
			settingsRevision: this.state.revision,
		}));
	}
	saveGame(
		mapping: GameMapping,
		expectedRevision: string | null,
		settingsRevision: number,
	): Promise<{
		record: GameMappingRecord;
		action: "created" | "updated";
		settingsRevision: number;
	}> {
		const snapshot = structuredClone(mapping);
		return this.serialize(async () => {
			this.checkRevision(settingsRevision);
			const repository = this.requireRepository();
			const existing = await repository.games.find(
				snapshot.racetime.categorySlug,
			);
			if (
				existing &&
				existing.mapping.speedrunCom.gameId !== snapshot.speedrunCom.gameId
			) {
				const key = slotKey(snapshot.racetime.categorySlug);
				const children = await repository.categories.list();
				if (
					children.some(
						(record) => slotKey(record.mapping.racetime.categorySlug) === key,
					)
				)
					throw new IntegrationError(
						"game_mapping_conflict",
						"Cannot change the Speedrun.com game while child category mappings exist",
					);
			}
			return {
				...(await repository.games.save(snapshot, expectedRevision)),
				settingsRevision: this.state.revision,
			};
		});
	}
	deleteGame(
		categorySlug: string,
		expectedRevision: string,
		settingsRevision: number,
	): Promise<{deleted: true; settingsRevision: number}> {
		return this.serialize(async () => {
			this.checkRevision(settingsRevision);
			const repository = this.requireRepository();
			const key = slotKey(categorySlug);
			const children = await repository.categories.list();
			if (
				children.some(
					(record) => slotKey(record.mapping.racetime.categorySlug) === key,
				)
			)
				throw new IntegrationError(
					"game_mapping_conflict",
					"Remove child category mappings before deleting this game mapping",
				);
			await repository.games.delete(categorySlug, expectedRevision);
			return {deleted: true as const, settingsRevision: this.state.revision};
		});
	}

	listCategories(): Promise<{
		records: CategoryMappingRecord[];
		settingsRevision: number;
	}> {
		return this.serialize(async () => ({
			records: await this.requireRepository().categories.list(),
			settingsRevision: this.state.revision,
		}));
	}
	findCategory(
		categorySlug: string,
		goal: string,
	): Promise<{
		record: CategoryMappingRecord | null;
		settingsRevision: number;
	}> {
		return this.serialize(async () => ({
			record: await this.requireRepository().categories.find(
				categorySlug,
				goal,
			),
			settingsRevision: this.state.revision,
		}));
	}
	saveCategory(
		mapping: CategoryMapping,
		expectedRevision: string | null,
		settingsRevision: number,
		verify?: CategoryIntegrityCheck,
	): Promise<{
		record: CategoryMappingRecord;
		action: "created" | "updated";
		settingsRevision: number;
	}> {
		const snapshot = structuredClone(mapping);
		return this.serialize(async () => {
			this.checkRevision(settingsRevision);
			const repository = this.requireRepository();
			const parent = await repository.games.find(
				snapshot.racetime.categorySlug,
			);
			if (!parent)
				throw new IntegrationError(
					"game_mapping_missing",
					`No Game Mapping exists for "${snapshot.racetime.categorySlug}"`,
				);
			if (verify)
				await verify(parent.mapping.speedrunCom, snapshot.speedrunCom);
			return {
				...(await repository.categories.save(snapshot, expectedRevision)),
				settingsRevision: this.state.revision,
			};
		});
	}
	deleteCategory(
		categorySlug: string,
		goal: string,
		expectedRevision: string,
		settingsRevision: number,
	): Promise<{deleted: true; settingsRevision: number}> {
		return this.serialize(async () => {
			this.checkRevision(settingsRevision);
			await this.requireRepository().categories.delete(
				categorySlug,
				goal,
				expectedRevision,
			);
			return {deleted: true as const, settingsRevision: this.state.revision};
		});
	}
	resolve(
		categorySlug: string,
		goal: string,
	): Promise<ResolveCategoryMappingResult> {
		return this.serialize(async () => {
			const repository = this.requireRepository();
			const [game, category] = await Promise.all([
				repository.games.find(categorySlug),
				repository.categories.find(categorySlug, goal),
			]);
			if (!category) return {status: "unregistered"};
			if (!game)
				return {
					status: "inconsistent",
					message: `Category mapping "${categorySlug}" + "${goal}" has no Game Mapping.`,
				};
			return {
				status: "resolved",
				mapping: {
					game: game.mapping.speedrunCom,
					category: category.mapping.speedrunCom,
				},
			};
		});
	}
}
