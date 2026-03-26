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

export function parseTitoDate(dateValue: string): { year: number; month: number; day: number } {
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

export function parseScheduleTextToIsoRange(scheduleText: string): { start: string; end: string } {
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