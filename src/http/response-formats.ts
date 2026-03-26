import { Feed } from 'feed';
import ical from 'ical-generator';
import { EDGE_CACHE_TTL_SECONDS } from '../settings';
import type { EnrichedTitoEvent, ResponseFormat } from '../types';
import { buildFeedTitle } from './request-target';

function createEventDescription(event: EnrichedTitoEvent): string {
	const parts = [
		`Location: ${event.location}`,
		event.location_map_url ? `Map: ${event.location_map_url}` : null,
		event.parse_error ? `Parse error: ${event.parse_error}` : null,
	].filter((value): value is string => value !== null);

	return parts.join('\n');
}

function serializeJson(events: EnrichedTitoEvent[]): Response {
	return Response.json(events);
}

function hasSchedule(
	event: EnrichedTitoEvent
): event is EnrichedTitoEvent & { start_time: string; end_time: string } {
	return event.start_time !== null && event.end_time !== null;
}

function serializeICal(events: EnrichedTitoEvent[], path: string): Response {
	const calendarName = buildFeedTitle(path) || 'Tito Feed';
	const calendar = ical({
		name: calendarName,
		prodId: { company: 'tito-feed', product: 'tito-feed' },
	});

	events.filter(hasSchedule).forEach((event) => {
		calendar.createEvent({
			id: event.url,
			start: new Date(event.start_time),
			end: new Date(event.end_time),
			summary: event.title,
			description: createEventDescription(event),
			location: event.location,
			url: event.url,
		});
	});

	return new Response(calendar.toString(), {
		headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
	});
}

function serializeRss(events: EnrichedTitoEvent[], path: string, requestUrl: URL): Response {
	const feedTitle = buildFeedTitle(path) || 'Tito Feed';
	const feedPath = `/${path}.rss`;
	const feed = new Feed({
		title: feedTitle,
		id: requestUrl.origin + feedPath,
		link: `${requestUrl.origin}/${path}`,
		description: `Feed for ${feedTitle}`,
		generator: 'tito-feed',
		feedLinks: {
			rss: requestUrl.origin + feedPath,
		},
		updated: new Date(),
		ttl: EDGE_CACHE_TTL_SECONDS / 60,
	});

	events.forEach((event) => {
		feed.addItem({
			title: event.title,
			id: event.url,
			link: event.url,
			description: createEventDescription(event),
			date: new Date(event.start_time ?? event.end_time ?? Date.now()),
			published: event.start_time ? new Date(event.start_time) : undefined,
		});
	});

	return new Response(feed.rss2(), {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
	});
}

export function createFormattedResponse(
	events: EnrichedTitoEvent[],
	path: string,
	format: ResponseFormat,
	requestUrl: URL
): Response {
	switch (format) {
		case 'ics':
			return serializeICal(events, path);
		case 'rss':
			return serializeRss(events, path, requestUrl);
		case 'json':
		default:
			return serializeJson(events);
	}
}
