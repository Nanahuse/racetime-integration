import {useEffect, useState} from "react";
import {type BrowserReplicant, getNodeCG} from "../api/nodecg-client";

export type ReplicantSnapshot<T> = {ready: boolean; value: T | undefined};

export function useReplicant<T>(name: string): ReplicantSnapshot<T> {
	const [snapshot, setSnapshot] = useState<ReplicantSnapshot<T>>({
		ready: false,
		value: undefined,
	});
	useEffect(() => {
		let replicant: BrowserReplicant<T> | undefined;
		try {
			replicant = getNodeCG().Replicant<T>(name);
		} catch {
			return;
		}
		const listener = (value: T) => setSnapshot({ready: true, value});
		replicant.on("change", listener);
		if (replicant.value !== undefined)
			setSnapshot({ready: true, value: replicant.value});
		return () => replicant?.off?.("change", listener);
	}, [name]);
	return snapshot;
}
