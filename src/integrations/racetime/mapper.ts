import {
	type Race,
	type RaceResult,
	serializeRaceDuration,
	serializeRaceInstant,
} from "@nanahuse/racetime-protocol";
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
		openedAt: serializeRaceInstant(dto.openedAt),
		startedAt: serializeRaceInstant(dto.startedAt),
		endedAt: serializeRaceInstant(dto.endedAt),
		cancelledAt: serializeRaceInstant(dto.cancelledAt),
		startDelay: serializeRaceDuration(dto.startDelay)!,
		timeLimit: serializeRaceDuration(dto.timeLimit)!,
		info: dto.info,
		ranked: dto.ranked,
		recordable: dto.recordable,
		recorded: dto.recorded,
		timeLimitAutoComplete: dto.timeLimitAutoComplete,
		entrantsCount: dto.entrantsCount,
		entrantsCountFinished: dto.entrantsCountFinished,
		entrantsCountInactive: dto.entrantsCountInactive,
		category: {slug: dto.categorySlug, name: dto.categoryName, goal: dto.goal},
		entrants: dto.entrants.map((entrant) => ({
			...entrant,
			finishTime: serializeRaceDuration(entrant.finishTime),
			finishedAt: serializeRaceInstant(entrant.finishedAt),
		})),
		results: dto.entrants.map((entrant) => ({
			userId: entrant.userId,
			name: entrant.name,
			place: entrant.place,
			time: serializeRaceDuration(entrant.finishTime),
			finishedAt: serializeRaceInstant(entrant.finishedAt),
			status: normalizeResultStatus(entrant.status),
		})),
	};
}
