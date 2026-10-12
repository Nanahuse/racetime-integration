import type {TimingMethod} from "./category.js";

export type SpeedrunTimingMethods = {
	realtime: boolean;
	realtimeNoLoads: boolean;
	ingame: boolean;
};

export type SpeedrunGameSummary = {
	id: string;
	name: string;
	abbreviation: string;
};

export type SpeedrunCategoryOption = {
	id: string;
	name: string;
	type: "per-game" | "per-level";
	miscellaneous: boolean;
};

export type SpeedrunLevelOption = {id: string; name: string};

export type SpeedrunVariableValueOption = {id: string; label: string};

export type SpeedrunVariableOption = {
	id: string;
	name: string;
	mandatory: boolean;
	userDefined: boolean;
	values: SpeedrunVariableValueOption[];
};

export type SpeedrunPlatformOption = {id: string; name: string};

export type SpeedrunRegionOption = {id: string; name: string};

export type SpeedrunGame = SpeedrunGameSummary & {
	platformIds: string[];
	regionIds: string[];
	timingMethods: SpeedrunTimingMethods;
};

export type SpeedrunGameOptions = {
	game: SpeedrunGame;
	categories: SpeedrunCategoryOption[];
	levels: SpeedrunLevelOption[];
	platforms: SpeedrunPlatformOption[];
	regions: SpeedrunRegionOption[];
	timingMethods: TimingMethod[];
};
