import { Feed } from 'feed';
import ical from 'ical-generator';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

// 1 hour cache TTL
const EDGE_CACHE_TTL_SECONDS = 3600;

type ResponseFormat = 'json' | 'ics' | 'rss';

type TitoEvent = {
	banner_url: string;
	location: string;
	time: string;
	title: string;
	url: string;
};

type EnrichedTitoEvent = {
	banner_url: string;
	location: string;
	location_map_url: string | null;
	title: string;
	url: string;
	start_time: string | null;
	end_time: string | null;
	parse_error?: string;
};

type TitoResponse = {
	events?: {
		past?: TitoEvent[];
		unscheduled?: TitoEvent[];
		upcoming?: TitoEvent[];
	};
};

type RequestTarget = {
	path: string;
	format: ResponseFormat;
};

const MONTH_INDEX: Record<string, number> = {
	january: 0,
	february: 1,
	march: 2,
	april: 3,
	may: 4,
	june: 5,
	july: 6,
	august: 7,
	september: 8,
	october: 9,
	november: 10,
	december: 11,
};

function parseTitoDate(dateValue: string): { year: number; month: number; day: number } {
	const match = dateValue.match(/^([A-Za-z]+)\s+(\d{1,2})(st|nd|rd|th),\s*(\d{4})$/);
	if (!match) {
		throw new Error(`Invalid date format: ${dateValue}`);
	}

	const [, monthName, dayValue, , yearValue] = match;
	const month = MONTH_INDEX[monthName.toLowerCase()];
	if (month === undefined) {
		throw new Error(`Invalid month name: ${monthName}`);
	}

	const day = Number(dayValue);
	const year = Number(yearValue);
	const parsed = new Date(Date.UTC(year, month, day));

	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month ||
		parsed.getUTCDate() !== day
	) {
		throw new Error(`Invalid date value: ${dateValue}`);
	}

	return { year, month, day };
}

function convertHourTo24(hour: number, meridiem: 'am' | 'pm'): number {
	if (hour < 1 || hour > 12) {
		throw new Error(`Invalid hour value: ${hour}`);
	}

	if (meridiem === 'am') {
		return hour === 12 ? 0 : hour;
	}

	return hour === 12 ? 12 : hour + 12;
}

function parseTimeToken(token: string): { hour: number; minute: number; meridiem?: 'am' | 'pm' } {
	const match = token.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
	if (!match) {
		throw new Error(`Invalid time token: ${token}`);
	}

	const [, hourValue, minuteValue, meridiemValue] = match;
	return {
		hour: Number(hourValue),
		minute: minuteValue ? Number(minuteValue) : 0,
		meridiem: meridiemValue as 'am' | 'pm' | undefined,
	};
}

function parseScheduleTextToIsoRange(scheduleText: string): { start: string; end: string } {
	const normalized = scheduleText.replace(/\u2013|\u2014/g, '-').replace(/\s+/g, ' ').trim();
	const match = normalized.match(/^([^,]+),\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th),\s*\d{4})$/);
	if (!match) {
		throw new Error(`Invalid schedule text format: ${scheduleText}`);
	}

	const [, timeRangeRaw, dateRaw] = match;
	const rangeMatch = timeRangeRaw.match(/^(.*?)\s*-\s*(.*?)$/);
	if (!rangeMatch) {
		throw new Error(`Invalid time range format: ${timeRangeRaw}`);
	}

	const [, startRaw, endRaw] = rangeMatch;
	const startToken = parseTimeToken(startRaw);
	const endToken = parseTimeToken(endRaw);

	const endMeridiem = endToken.meridiem;
	if (!endMeridiem) {
		throw new Error(`Missing meridiem for end time: ${endRaw}`);
	}

	const startMeridiem = startToken.meridiem ?? endMeridiem;
	const { year, month, day } = parseTitoDate(dateRaw);

	const startHour = convertHourTo24(startToken.hour, startMeridiem);
	const endHour = convertHourTo24(endToken.hour, endMeridiem);

	const startDate = new Date(Date.UTC(year, month, day, startHour, startToken.minute, 0, 0));
	const endDate = new Date(Date.UTC(year, month, day, endHour, endToken.minute, 0, 0));

	if (endDate <= startDate) {
		endDate.setUTCDate(endDate.getUTCDate() + 1);
	}

	return {
		start: startDate.toISOString(),
		end: endDate.toISOString(),
	};
}

type Parse5ParentNode = DefaultTreeAdapterMap['documentFragment'] | DefaultTreeAdapterMap['element'];
type Parse5ChildNode = Parse5ParentNode['childNodes'][number];

function isElementNode(node: Parse5ChildNode): node is DefaultTreeAdapterMap['element'] {
	return 'tagName' in node;
}

function getClassList(node: DefaultTreeAdapterMap['element']): string[] {
	const classAttribute = node.attrs.find((attribute) => attribute.name === 'class');
	return classAttribute ? classAttribute.value.split(/\s+/).filter(Boolean) : [];
}

function findFirstElementByClass(
	root: Parse5ParentNode,
	className: string
): DefaultTreeAdapterMap['element'] | null {
	for (const childNode of root.childNodes) {
		if (!isElementNode(childNode)) {
			continue;
		}

		if (getClassList(childNode).includes(className)) {
			return childNode;
		}

		const nestedMatch = findFirstElementByClass(childNode, className);
		if (nestedMatch) {
			return nestedMatch;
		}
	}

	return null;
}

function findFirstElementByTagName(
	root: Parse5ParentNode,
	tagName: string
): DefaultTreeAdapterMap['element'] | null {
	for (const childNode of root.childNodes) {
		if (!isElementNode(childNode)) {
			continue;
		}

		if (childNode.tagName === tagName) {
			return childNode;
		}

		const nestedMatch = findFirstElementByTagName(childNode, tagName);
		if (nestedMatch) {
			return nestedMatch;
		}
	}

	return null;
}

function getNodeTextContent(root: Parse5ParentNode): string {
	const textParts: string[] = [];

	for (const childNode of root.childNodes) {
		if ('value' in childNode) {
			textParts.push(childNode.value);
			continue;
		}

		if (isElementNode(childNode)) {
			textParts.push(getNodeTextContent(childNode));
		}
	}

	return textParts.join(' ').replace(/\s+/g, ' ').trim();
}

function extractCalendarText(eventPageHtml: string): string {
	const document = parseFragment(eventPageHtml);
	const calendarElement = findFirstElementByClass(document, 'tito-event-homepage--basic-info-cal');
	if (!calendarElement) {
		throw new Error('Could not find event calendar info block');
	}

	return getNodeTextContent(calendarElement);
}

function extractVenueInfo(eventPageHtml: string): { location: string; locationMapUrl: string | null } {
	const document = parseFragment(eventPageHtml);
	const venueElement = findFirstElementByClass(document, 'tito-venues');
	if (!venueElement) {
		throw new Error('Could not find event venue block');
	}

	const anchorElement = findFirstElementByTagName(venueElement, 'a');

	return {
		location: getNodeTextContent(venueElement),
		locationMapUrl: anchorElement?.attrs.find((attribute) => attribute.name === 'href')?.value ?? null,
	};
}

async function enrichEvent(event: TitoEvent): Promise<EnrichedTitoEvent> {
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

function sortEventsByStartTime(events: EnrichedTitoEvent[]): EnrichedTitoEvent[] {
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

async function flattenEvents(payload: TitoResponse): Promise<EnrichedTitoEvent[]> {
	const groupedEvents = payload.events;
	if (!groupedEvents) {
		return [];
	}

	const events = [groupedEvents.past, groupedEvents.unscheduled, groupedEvents.upcoming].flatMap(
		(group) => group ?? []
	);

	return Promise.all(events.map((event) => enrichEvent(event)));
}

function parseRequestTarget(pathname: string): RequestTarget {
	const normalizedPath = pathname.replace(/^\/+|\/+$/g, '');
	if (!normalizedPath) {
		return { path: '', format: 'json' };
	}

	if (normalizedPath.endsWith('.json')) {
		return { path: normalizedPath.slice(0, -'.json'.length), format: 'json' };
	}

	if (normalizedPath.endsWith('.ics')) {
		return { path: normalizedPath.slice(0, -'.ics'.length), format: 'ics' };
	}

	if (normalizedPath.endsWith('.rss')) {
		return { path: normalizedPath.slice(0, -'.rss'.length), format: 'rss' };
	}

	const lastSegment = normalizedPath.split('/').pop() ?? normalizedPath;
	if (/\.[A-Za-z0-9]+$/.test(lastSegment)) {
		throw new Error(`Unsupported format extension in path: ${lastSegment}`);
	}

	return { path: normalizedPath, format: 'json' };
}

function buildFeedTitle(path: string): string {
	return path
		.split('/')
		.filter(Boolean)
		.map((segment) =>
			segment
				.split('-')
				.filter(Boolean)
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(' ')
		)
		.join(' / ');
}

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

function serializeICal(events: EnrichedTitoEvent[], path: string): Response {
	const calendarName = buildFeedTitle(path) || 'Tito Feed';
	const calendar = ical({
		name: calendarName,
		prodId: { company: 'tito-feed', product: 'tito-feed' },
	});

	events
		.filter((event) => event.start_time !== null && event.end_time !== null)
		.forEach((event) => {
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

function createFormattedResponse(
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

function createCacheKey(request: Request): Request {
	const url = new URL(request.url);
	const target = parseRequestTarget(url.pathname);
	url.search = '';
	url.pathname = `/${target.path}${target.format === 'json' ? '.json' : `.${target.format}`}`;
	return new Request(url.toString(), { method: 'GET' });
}

function withCacheHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', `public, s-maxage=${EDGE_CACHE_TTL_SECONDS}`);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method !== 'GET') {
			return new Response('Method Not Allowed', {
				status: 405,
				headers: { Allow: 'GET' },
			});
		}

		const url = new URL(request.url);
		let target: RequestTarget;
		try {
			target = parseRequestTarget(url.pathname);
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : 'Invalid request path' },
				{ status: 400 }
			);
		}

		const cache = caches.default;
		const cacheKey = createCacheKey(request);
		const cachedResponse = await cache.match(cacheKey);
		if (cachedResponse) {
			return cachedResponse;
		}

		const { path, format } = target;

		if (!path) {
			return Response.json({ error: 'Path is required' }, { status: 400 });
		}

		const titoUrl = `https://checkout.tito.io/${path}.json`;
		const upstreamResponse = await fetch(titoUrl);

		if (!upstreamResponse.ok) {
			return Response.json(
				{ error: 'Failed to fetch Tito event feed', status: upstreamResponse.status },
				{ status: upstreamResponse.status }
			);
		}

		const payload = (await upstreamResponse.json()) as TitoResponse;
		const events = sortEventsByStartTime(await flattenEvents(payload));
		const response = withCacheHeaders(createFormattedResponse(events, path, format, url));

		ctx.waitUntil(cache.put(cacheKey, response.clone()));

		return response;
	},
} satisfies ExportedHandler<Env>;
