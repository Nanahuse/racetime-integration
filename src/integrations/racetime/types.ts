// Adapted and modified from Nanahuse/nodecg-race-layouts (Apache-2.0).
import type {RaceDuration, RaceInstant} from "@nanahuse/racetime-protocol";

/**
 * Normalized integration DTO for the RaceTime.gg Race Detail endpoint.
 *
 * This is intentionally much smaller than the real payload. Only the fields the
 * domain needs are parsed; the raw API shape never reaches the domain.
 */
export type RaceTimeEntrantDto = {
	userId: string;
	name: string;
	twitchLogin: string | null;
	status: string;
	/** Elapsed finish time parsed from the RaceTime.gg `finish_time`. */
	finishTime: RaceDuration | null;
	finishedAt: RaceInstant | null;
	place: number | null;
};

export type RaceTimeRaceDto = {
	version: number;
	name: string;
	slug: string;
	status: string;
	openedAt: RaceInstant;
	startedAt: RaceInstant | null;
	endedAt: RaceInstant | null;
	cancelledAt: RaceInstant | null;
	startDelay: RaceDuration;
	timeLimit: RaceDuration;
	info: string;
	ranked: boolean;
	recordable: boolean;
	recorded: boolean;
	timeLimitAutoComplete: boolean;
	entrantsCount: number;
	entrantsCountFinished: number;
	entrantsCountInactive: number;
	url: string;
	dataUrl: string;
	websocketUrl: string;
	categorySlug: string;
	categoryName: string;
	goal: string;
	entrants: RaceTimeEntrantDto[];
};
