export type TimingMethod = "realtime" | "realtime_noloads" | "ingame";
export type SpeedrunCategorySelection = {
	gameId: string;
	gameName: string;
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
	racetime: {categorySlug: string; categoryName: string; goal: string};
	speedrunCom: SpeedrunCategorySelection;
};
