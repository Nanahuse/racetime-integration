export type StatusTone =
	| "success"
	| "progress"
	| "warning"
	| "error"
	| "neutral";

export function statusTone(state: string): StatusTone {
	if (["ready", "connected", "available", "saved", "resolved"].includes(state))
		return "success";
	if (
		["loading", "connecting", "reconnecting", "pending", "saving"].includes(
			state,
		)
	)
		return "progress";
	if (["dirty", "unverified", "unregistered", "idle"].includes(state))
		return "warning";
	if (["error", "inconsistent", "unavailable"].includes(state)) return "error";
	return "neutral";
}
