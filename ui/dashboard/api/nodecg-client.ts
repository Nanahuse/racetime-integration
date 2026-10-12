export type BrowserReplicant<T> = {
	value?: T;
	on(event: "change", listener: (value: T) => void): void;
	off?(event: "change", listener: (value: T) => void): void;
};

export type DashboardNodeCG = {
	Replicant<T>(name: string): BrowserReplicant<T>;
	sendMessage<T>(name: string, data?: unknown): Promise<T>;
	sendMessageToBundle<T>(
		name: string,
		bundle: string,
		data?: unknown,
	): Promise<T>;
};

export function getNodeCG(): DashboardNodeCG {
	const value = (window as Window & {nodecg?: DashboardNodeCG}).nodecg;
	if (!value) throw new Error("NodeCG browser API is unavailable");
	return value;
}
