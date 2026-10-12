export type DiffEntry = {path: string; before: string; after: string};

function format(value: unknown): string {
	if (value === undefined || value === null) return "—";
	if (typeof value === "string") return value === "" ? "—" : value;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function flatten(
	value: unknown,
	prefix: string,
	out: Map<string, string>,
): void {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		for (const [key, item] of Object.entries(value))
			flatten(item, prefix ? `${prefix}.${key}` : key, out);
		return;
	}
	out.set(prefix, format(value));
}

/**
 * Compares two mapping values leaf-by-leaf so the dashboard can show exactly
 * which fields differ between the local edit and the latest saved record.
 */
export function diffValues(before: unknown, after: unknown): DiffEntry[] {
	const left = new Map<string, string>();
	const right = new Map<string, string>();
	flatten(before, "", left);
	flatten(after, "", right);
	const paths = new Set([...left.keys(), ...right.keys()]);
	const entries: DiffEntry[] = [];
	for (const path of paths) {
		const beforeValue = left.get(path) ?? "—";
		const afterValue = right.get(path) ?? "—";
		if (beforeValue !== afterValue)
			entries.push({path, before: beforeValue, after: afterValue});
	}
	return entries.sort((a, b) => a.path.localeCompare(b.path));
}
