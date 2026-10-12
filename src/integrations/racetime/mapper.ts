import type {Race, RaceResult} from "@nanahuse/racetime-protocol";
import type {RaceTimeRaceDto} from "./types";

export function normalizeResultStatus(status: string): RaceResult["status"] {
	if (status === "done") return "finished";
	if (status === "dnf" || status === "dq") return status;
	return "other";
}

export function mapRace(dto: RaceTimeRaceDto, url: string): Race {
	return {
		raceId: `${dto.categorySlug}/${dto.slug}`,
		url,
		version: dto.version,
		name: dto.name,
		status: dto.status,
		category: {slug: dto.categorySlug, name: dto.categoryName, goal: dto.goal},
		entrants: dto.entrants.map((entrant) => ({...entrant})),
		results: dto.entrants.map((entrant) => ({
			userId: entrant.userId,
			name: entrant.name,
			place: entrant.place,
			time: entrant.finishTime,
			status: normalizeResultStatus(entrant.status),
		})),
	};
}
