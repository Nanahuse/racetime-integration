import {
	type ResolvedCategoryMapping,
	type ResolvedSpeedrunCategorySelection,
	type SpeedrunCategorySelection,
	type SpeedrunVariableOption,
	supportsAnySelection,
	type VariableSelection,
} from "@nanahuse/racetime-protocol";

export type AnyExpansionResult =
	| {ok: true; mappings: ResolvedCategoryMapping[]}
	| {ok: false; status: "inconsistent"; message: string}
	| {
			ok: false;
			status: "limit_exceeded";
			required: number;
			limit: number;
			message: string;
	  };

/** Variable IDs stored as `{mode: "any"}`. */
export function anyVariableIds(
	variables: Record<string, VariableSelection>,
): string[] {
	return Object.entries(variables)
		.filter(([, value]) => typeof value !== "string")
		.map(([id]) => id);
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function concreteVariables(
	variables: Record<string, VariableSelection>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [id, value] of Object.entries(variables))
		if (typeof value === "string") result[id] = value;
	return result;
}

function sortedEntries(variables: Record<string, string>): [string, string][] {
	return Object.entries(variables).sort(([a], [b]) => compareText(a, b));
}

/**
 * Stable identifier for a concrete lookup. Built only from the SRC game,
 * category and normalized variable set so display order and names never affect
 * it, and equal conditions always produce the same key.
 */
export function resolvedMappingKey(
	gameId: string,
	category: ResolvedSpeedrunCategorySelection,
): string {
	return JSON.stringify({
		gameId,
		categoryId: category.categoryId,
		levelId: category.levelId,
		variables: sortedEntries(category.variables),
		platformId: category.platformId,
		regionId: category.regionId,
		emulator: category.emulator,
		timingMethod: category.timingMethod,
	});
}

function resolvedMappingLabel(
	categoryName: string,
	labels: readonly {name: string; value: string}[],
): string {
	if (labels.length === 0) return categoryName;
	return `${categoryName} (${labels
		.map(({name, value}) => `${name}: ${value}`)
		.join(", ")})`;
}

function toResolvedMapping(
	game: {gameId: string; gameName: string},
	categoryName: string,
	base: Omit<SpeedrunCategorySelection, "variables" | "categoryName">,
	variables: Record<string, string>,
	labels: readonly {name: string; value: string}[],
): ResolvedCategoryMapping {
	const category: ResolvedSpeedrunCategorySelection = {
		categoryName,
		...base,
		variables,
	};
	return {
		key: resolvedMappingKey(game.gameId, category),
		label: resolvedMappingLabel(categoryName, labels),
		game: {...game},
		category,
	};
}

/**
 * Exact product of `counts` using BigInt so an extreme cartesian product is
 * measured without integer overflow and without materializing any mapping.
 */
function productCount(counts: readonly number[]): bigint {
	let product = 1n;
	for (const count of counts) product *= BigInt(count);
	return product;
}

/**
 * Expands a stored Category Mapping into concrete lookups. `Any` Variables are
 * replaced by every defined Value, producing the cartesian product across all
 * such Variables. When the product would exceed `maxMappings` the expansion is
 * rejected before any mapping is built. Pure: it performs no I/O and relies
 * only on the supplied Speedrun.com definitions.
 */
export function expandCategoryMapping(
	game: {gameId: string; gameName: string},
	category: SpeedrunCategorySelection,
	definitions: readonly SpeedrunVariableOption[],
	maxMappings: number,
): AnyExpansionResult {
	const {variables, categoryName, ...base} = category;
	const anyIds = anyVariableIds(variables).sort(compareText);
	if (anyIds.length === 0)
		return {
			ok: true,
			mappings: [
				toResolvedMapping(
					game,
					categoryName,
					base,
					concreteVariables(variables),
					[],
				),
			],
		};

	const byId = new Map(definitions.map((variable) => [variable.id, variable]));
	const axes: {
		id: string;
		name: string;
		values: string[];
		labels: Map<string, string>;
	}[] = [];
	for (const id of anyIds) {
		const variable = byId.get(id);
		if (!variable)
			return {
				ok: false,
				status: "inconsistent",
				message: `Variable "${id}" is no longer defined for category "${category.categoryId}".`,
			};
		if (!supportsAnySelection(variable))
			return {
				ok: false,
				status: "inconsistent",
				message: `Variable "${id}" no longer supports Any.`,
			};
		axes.push({
			id,
			name: variable.name,
			values: [...variable.values].map((value) => value.id).sort(compareText),
			labels: new Map(variable.values.map((value) => [value.id, value.label])),
		});
	}

	const required = productCount(axes.map((axis) => axis.values.length));
	if (required > BigInt(maxMappings)) {
		const safe =
			required <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(required) : null;
		return {
			ok: false,
			status: "limit_exceeded",
			required: safe ?? Number.POSITIVE_INFINITY,
			limit: maxMappings,
			message: `Any expansion requires ${
				safe ?? "more than 9007199254740991"
			} mappings, but the configured limit is ${maxMappings}.`,
		};
	}

	const mappings: ResolvedCategoryMapping[] = [];
	const assigned: Record<string, string> = concreteVariables(variables);
	const labels: {name: string; value: string}[] = [];
	const walk = (index: number): void => {
		if (index === axes.length) {
			mappings.push(
				toResolvedMapping(game, categoryName, base, {...assigned}, [...labels]),
			);
			return;
		}
		const axis = axes[index]!;
		for (const value of axis.values) {
			assigned[axis.id] = value;
			labels.push({name: axis.name, value: axis.labels.get(value) ?? value});
			walk(index + 1);
			labels.pop();
		}
	};
	walk(0);
	return {ok: true, mappings};
}
