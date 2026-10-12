import type {
	CategoryMapping,
	Settings,
	SettingsState,
} from "@nanahuse/racetime-protocol";
import {IntegrationError} from "./errors";
import type {CategoryMappingsRepository} from "./integrations/spreadsheet/category-mappings-repository";

export class MappingService {
	private queue: Promise<unknown> = Promise.resolve();
	private state: SettingsState;
	private repository: CategoryMappingsRepository | null;
	constructor(
		initial: SettingsState,
		private readonly persist: (state: SettingsState) => void,
		private readonly createRepository: (
			settings: Settings,
		) => CategoryMappingsRepository | null,
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
	private requireRepository(): CategoryMappingsRepository {
		if (!this.repository)
			throw new IntegrationError(
				"spreadsheet_unavailable",
				"Configure spreadsheetId to use CategoryMappings",
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
			if (repository) await repository.list();
			const state = {revision: this.state.revision + 1, settings: next};
			this.persist(structuredClone(state));
			this.repository = repository;
			this.state = state;
			return this.settings();
		});
	}
	find(categorySlug: string, goal: string) {
		return this.serialize(async () => ({
			record: await this.requireRepository().find(categorySlug, goal),
			settingsRevision: this.state.revision,
		}));
	}
	list() {
		return this.serialize(async () => ({
			records: await this.requireRepository().list(),
			settingsRevision: this.state.revision,
		}));
	}
	save(
		mapping: CategoryMapping,
		expectedRevision: string | null,
		settingsRevision: number,
	) {
		const snapshot = structuredClone(mapping);
		return this.serialize(async () => {
			this.checkRevision(settingsRevision);
			return {
				...(await this.requireRepository().save(snapshot, expectedRevision)),
				settingsRevision: this.state.revision,
			};
		});
	}
	delete(
		categorySlug: string,
		goal: string,
		expectedRevision: string,
		settingsRevision: number,
	) {
		return this.serialize(async () => {
			this.checkRevision(settingsRevision);
			await this.requireRepository().delete(
				categorySlug,
				goal,
				expectedRevision,
			);
			return {deleted: true as const, settingsRevision: this.state.revision};
		});
	}
}
