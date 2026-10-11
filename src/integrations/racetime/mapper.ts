import type {Race} from "@nanahuse/racetime-protocol";
import type {RaceTimeRaceDto} from "./types";

export function mapRace(dto: RaceTimeRaceDto, url: string): Race {
	return {
		url,
		version: dto.version,
		name: dto.name,
		status: dto.status,
		category: {slug: dto.categorySlug, name: dto.categoryName, goal: dto.goal},
		entrants: dto.entrants.map((entrant) => ({...entrant})),
	};
}
