import {useEffect, useState} from "react";
import {
	type PlayerManagerStatus,
	playerManagerStatus,
} from "../api/player-manager";

const REFRESH_MS = 15_000;

/**
 * Polls the public Player Manager status so readiness is visible even while
 * no race is being monitored.
 */
export function usePlayerManagerStatus(): PlayerManagerStatus {
	const [status, setStatus] = useState<PlayerManagerStatus>({state: "loading"});
	useEffect(() => {
		let active = true;
		const refresh = async () => {
			const next = await playerManagerStatus();
			if (active) setStatus(next);
		};
		void refresh();
		const timer = setInterval(() => void refresh(), REFRESH_MS);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, []);
	return status;
}
