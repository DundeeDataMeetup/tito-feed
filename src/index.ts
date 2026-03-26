import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

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

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/^\/+|\/+$/g, '');

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

		return Response.json(events);
	},
} satisfies ExportedHandler<Env>;
