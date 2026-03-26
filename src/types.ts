export type ResponseFormat = 'json' | 'ics' | 'rss';

export type TitoEvent = {
	banner_url: string;
	location: string;
	time: string;
	title: string;
	url: string;
};

export type EnrichedTitoEvent = {
	banner_url: string;
	location: string;
	location_map_url: string | null;
	title: string;
	url: string;
	start_time: string | null;
	end_time: string | null;
	parse_error?: string;
};

export type TitoResponse = {
	events?: {
		past?: TitoEvent[];
		unscheduled?: TitoEvent[];
		upcoming?: TitoEvent[];
	};
};

export type RequestTarget = {
	path: string;
	format: ResponseFormat;
};
