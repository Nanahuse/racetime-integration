export type TimingMethod = "realtime" | "realtime_noloads" | "ingame";

/**
 * Associates a RaceTime game (identified by its category slug) with a
 * Speedrun.com game. The slug is the unique key; names are display-only.
 */
export type GameMapping = {
	racetime: {categorySlug: string; categoryName: string};
	speedrunCom: {gameId: string; gameName: string};
};

/**
 * Associates a RaceTime goal with a Speedrun.com category. The game is not
 * stored here; it is resolved through the parent {@link GameMapping}.
 */
export type SpeedrunCategorySelection = {
	categoryId: string;
	categoryName: string;
	levelId: string | null;
	variables: Record<string, string>;
	platformId: string | null;
	regionId: string | null;
	emulator: boolean | null;
	timingMethod: TimingMethod | null;
};

export type CategoryMapping = {
	racetime: {categorySlug: string; goal: string};
	speedrunCom: SpeedrunCategorySelection;
};

export type MappingRecord<T> = {mapping: T; revision: string};
export type GameMappingRecord = MappingRecord<GameMapping>;
export type CategoryMappingRecord = MappingRecord<CategoryMapping>;

/** Result of combining a Game Mapping and a Category Mapping for consumers. */
export type ResolvedCategoryMapping = {
	game: {gameId: string; gameName: string};
	category: SpeedrunCategorySelection;
};

export type ResolveCategoryMappingResult =
	| {status: "resolved"; mapping: ResolvedCategoryMapping}
	| {status: "unregistered"}
	| {status: "inconsistent"; message: string};
