import { parseScheduleTextToIsoRange } from '../utils/date-utils';
import { extractCalendarText, extractVenueInfo } from '../utils/html-extract';
import type { EnrichedTitoEvent, TitoEvent, TitoResponse } from '../types';

export async function enrichEvent(event: TitoEvent): Promise<EnrichedTitoEvent> {
	try {
		const eventPageResponse = await fetch(event.url);
		if (!eventPageResponse.ok) {
			throw new Error(`Failed to fetch event page ${event.url} with status ${eventPageResponse.status}`);
		}

		const html = await eventPageResponse.text();
		const scheduleText = extractCalendarText(html);
		const { start, end } = parseScheduleTextToIsoRange(scheduleText);
		const { location, locationMapUrl } = extractVenueInfo(html);

		return {
			banner_url: event.banner_url,
			location,
			location_map_url: locationMapUrl,
			title: event.title,
			url: event.url,
			start_time: start,
			end_time: end,
		};
	} catch (error) {
		return {
			banner_url: event.banner_url,
			location: event.location,
			location_map_url: null,
			title: event.title,
			url: event.url,
			start_time: null,
			end_time: null,
			parse_error: error instanceof Error ? error.message : 'Unknown parse error',
		};
	}
}

export function sortEventsByStartTime(events: EnrichedTitoEvent[]): EnrichedTitoEvent[] {
	return [...events].sort((left, right) => {
		if (left.start_time === null && right.start_time === null) {
			return 0;
		}

		if (left.start_time === null) {
			return 1;
		}

		if (right.start_time === null) {
			return -1;
		}

		return right.start_time.localeCompare(left.start_time);
	});
}

export async function flattenEvents(payload: TitoResponse): Promise<EnrichedTitoEvent[]> {
	const groupedEvents = payload.events;
	if (!groupedEvents) {
		return [];
	}

	const events = [groupedEvents.past, groupedEvents.unscheduled, groupedEvents.upcoming].flatMap(
		(group) => group ?? []
	);

	return Promise.all(events.map((event) => enrichEvent(event)));
}
