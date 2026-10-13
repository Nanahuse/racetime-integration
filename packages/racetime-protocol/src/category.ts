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
 * A stored Variable selection. Concrete Value IDs are kept as plain strings;
 * `{mode: "any"}` means every defined Value of the Variable is matched. The
 * literal string `"any"` is never treated as the special mode.
 */
export type VariableSelection = string | {mode: "any"};

/**
 * Associates a RaceTime goal with a Speedrun.com category. The game is not
 * stored here; it is resolved through the parent {@link GameMapping}.
 */
export type SpeedrunCategorySelection = {
	categoryId: string;
	categoryName: string;
	levelId: string | null;
	variables: Record<string, VariableSelection>;
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

/**
 * A {@link SpeedrunCategorySelection} with every Variable expanded to a
 * concrete Value ID. `Any` never survives resolution.
 */
export type ResolvedSpeedrunCategorySelection = Omit<
	SpeedrunCategorySelection,
	"variables"
> & {variables: Record<string, string>};

/**
 * One concrete Speedrun.com lookup derived from a Category Mapping. `key` is a
 * stable identifier for the selection, independent of display order.
 */
export type ResolvedCategoryMapping = {
	key: string;
	label: string;
	game: {gameId: string; gameName: string};
	category: ResolvedSpeedrunCategorySelection;
};

export type ResolveCategoryMappingResult =
	| {status: "resolved"; mappings: ResolvedCategoryMapping[]}
	| {status: "unregistered"}
	| {status: "inconsistent"; message: string};
