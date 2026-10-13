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
	obsoletes: boolean;
	values: SpeedrunVariableValueOption[];
};

/**
 * Whether a Variable may be stored as `{mode: "any"}`: it obsoletes records,
 * is an enum (not user-defined), and offers at least one defined Value.
 */
export function supportsAnySelection(
	variable: SpeedrunVariableOption,
): boolean {
	return (
		variable.obsoletes && !variable.userDefined && variable.values.length > 0
	);
}

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
