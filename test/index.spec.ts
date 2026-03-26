import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import worker from "../src";

let cacheMatchSpy: ReturnType<typeof vi.spyOn>;
let cachePutSpy: ReturnType<typeof vi.spyOn>;

function mockTitoFeedFetches(upstreamPayload: unknown) {
	return vi.spyOn(globalThis, "fetch").mockImplementation((input: string | URL | Request) => {
		const requestUrl =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;

		if (requestUrl === "https://checkout.tito.io/dundee-data-meetup/feb-2026.json") {
			return Promise.resolve(
				new Response(JSON.stringify(upstreamPayload), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			);
		}

		if (requestUrl === "https://ti.to/dundee-data-meetup/feb-2026") {
			return Promise.resolve(
				new Response(
					'<html><div class="tito-event-homepage--basic-info-cal">6–8pm, February 24th, 2026</div><div class="tito-venues">Bonar Hall, Dundee <a href="https://maps.google.com/?q=bonar+hall">Map</a></div></html>',
					{ status: 200, headers: { "content-type": "text/html" } }
				)
			);
		}

		if (requestUrl === "https://ti.to/dundee-data-meetup/mar-2026") {
			return Promise.resolve(
				new Response(
					'<html><div class="tito-event-homepage--basic-info-cal">6:30-8:15pm, March 31st, 2026</div><div class="tito-venues">CodeBase, Dundee <a href="https://maps.google.com/?q=codebase+dundee">Map</a></div></html>',
					{ status: 200, headers: { "content-type": "text/html" } }
				)
			);
		}

		return Promise.reject(new Error(`Unexpected URL in test: ${requestUrl}`));
	});
}

beforeEach(() => {
	cacheMatchSpy = vi.spyOn(caches.default, "match").mockResolvedValue(undefined);
	cachePutSpy = vi.spyOn(caches.default, "put").mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Tito feed worker", () => {
	it("fetches Tito JSON, enriches events, and sorts by newest start_time first", async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			"http://example.com/dundee-data-meetup/feb-2026"
		);

		const upstreamPayload = {
			events: {
				past: [
					{
							banner_url:
							"https://do3z7e6uuakno.cloudfront.net/uploads/event/banner/1157681/b826381d06ec7389e7ffd33d9117e810.png",
						location: "Dundee, UK",
						time: "February 24th, 2026",
						title: "Dundee Data Meetup: February 2026",
						url: "https://ti.to/dundee-data-meetup/feb-2026",
					},
				],
				unscheduled: [],
				upcoming: [
					{
						banner_url:
							"https://do3z7e6uuakno.cloudfront.net/uploads/event/banner/1157682/b826381d06ec7389e7ffd33d9117e810.png",
						location: "Dundee, UK",
						time: "March 31st, 2026",
						title: "Dundee Data Meetup: March 2026",
						url: "https://ti.to/dundee-data-meetup/mar-2026",
					},
				],
			},
		};

		const fetchSpy = mockTitoFeedFetches(upstreamPayload);

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://checkout.tito.io/dundee-data-meetup/feb-2026.json"
		);
		const cacheRequest = cacheMatchSpy.mock.calls[0]?.[0] as Request;
		expect(cacheRequest.url).toBe("http://example.com/dundee-data-meetup/feb-2026.json");
		expect(cacheMatchSpy).toHaveBeenCalledTimes(1);
		expect(cachePutSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledWith("https://ti.to/dundee-data-meetup/feb-2026");
		expect(fetchSpy).toHaveBeenCalledWith("https://ti.to/dundee-data-meetup/mar-2026");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=3600");
		expect(await response.json()).toEqual([
			{
				banner_url:
					"https://do3z7e6uuakno.cloudfront.net/uploads/event/banner/1157682/b826381d06ec7389e7ffd33d9117e810.png",
				location: "CodeBase, Dundee Map",
				location_map_url: "https://maps.google.com/?q=codebase+dundee",
				title: "Dundee Data Meetup: March 2026",
				url: "https://ti.to/dundee-data-meetup/mar-2026",
				start_time: "2026-03-31T18:30:00.000Z",
				end_time: "2026-03-31T20:15:00.000Z",
			},
			{
				banner_url:
					"https://do3z7e6uuakno.cloudfront.net/uploads/event/banner/1157681/b826381d06ec7389e7ffd33d9117e810.png",
				location: "Bonar Hall, Dundee Map",
				location_map_url: "https://maps.google.com/?q=bonar+hall",
				title: "Dundee Data Meetup: February 2026",
				url: "https://ti.to/dundee-data-meetup/feb-2026",
				start_time: "2026-02-24T18:00:00.000Z",
				end_time: "2026-02-24T20:00:00.000Z",
			},
		]);
	});

	it("returns the same JSON output when .json is explicitly requested", async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			"http://example.com/dundee-data-meetup/feb-2026.json"
		);
		const upstreamPayload = {
			events: {
				past: [],
				unscheduled: [],
				upcoming: [
					{
						banner_url: "https://example.com/banner.png",
						location: "Dundee, UK",
						time: "March 31st, 2026",
						title: "March Event",
						url: "https://ti.to/dundee-data-meetup/mar-2026",
					},
				],
			},
		};

		const fetchSpy = mockTitoFeedFetches(upstreamPayload);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://checkout.tito.io/dundee-data-meetup/feb-2026.json"
		);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual([
			{
				banner_url: "https://example.com/banner.png",
				location: "CodeBase, Dundee Map",
				location_map_url: "https://maps.google.com/?q=codebase+dundee",
				title: "March Event",
				url: "https://ti.to/dundee-data-meetup/mar-2026",
				start_time: "2026-03-31T18:30:00.000Z",
				end_time: "2026-03-31T20:15:00.000Z",
			},
		]);
	});

	it("keeps processing when one event cannot be parsed and places it last", async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			"http://example.com/dundee-data-meetup/feb-2026"
		);

		const upstreamPayload = {
			events: {
				past: [
					{
						banner_url: "https://example.com/ok.png",
						location: "Dundee, UK",
						time: "March 31st, 2026",
						title: "Good Event",
						url: "https://ti.to/dundee-data-meetup/good",
					},
				],
				unscheduled: [],
				upcoming: [
					{
						banner_url: "https://example.com/bad.png",
						location: "Dundee, UK",
						time: "April 1st, 2026",
						title: "Bad Event",
						url: "https://ti.to/dundee-data-meetup/bad",
					},
				],
			},
		};

		vi.spyOn(globalThis, "fetch").mockImplementation((input: string | URL | Request) => {
			const requestUrl =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

			if (requestUrl === "https://checkout.tito.io/dundee-data-meetup/feb-2026.json") {
				return Promise.resolve(
					new Response(JSON.stringify(upstreamPayload), {
						status: 200,
						headers: { "content-type": "application/json" },
					})
				);
			}

			if (requestUrl === "https://ti.to/dundee-data-meetup/good") {
				return Promise.resolve(
					new Response(
						'<html><div class="tito-event-homepage--basic-info-cal">6-8pm, March 31st, 2026</div><div class="tito-venues">Abertay University, Dundee <a href="https://maps.google.com/?q=abertay">Map</a></div></html>',
						{ status: 200, headers: { "content-type": "text/html" } }
					)
				);
			}

			if (requestUrl === "https://ti.to/dundee-data-meetup/bad") {
				return Promise.resolve(
					new Response('<html><div class="different-class">missing calendar</div></html>', {
						status: 200,
						headers: { "content-type": "text/html" },
					})
				);
			}

			return Promise.reject(new Error(`Unexpected URL in test: ${requestUrl}`));
		});

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(cachePutSpy).toHaveBeenCalledTimes(1);
		expect(await response.json()).toEqual([
			{
				banner_url: "https://example.com/ok.png",
				location: "Abertay University, Dundee Map",
				location_map_url: "https://maps.google.com/?q=abertay",
				title: "Good Event",
				url: "https://ti.to/dundee-data-meetup/good",
				start_time: "2026-03-31T18:00:00.000Z",
				end_time: "2026-03-31T20:00:00.000Z",
			},
			{
				banner_url: "https://example.com/bad.png",
				location: "Dundee, UK",
				location_map_url: null,
				title: "Bad Event",
				url: "https://ti.to/dundee-data-meetup/bad",
				start_time: null,
				end_time: null,
				parse_error: "Could not find event calendar info block",
			},
		]);
	});

	it("returns 400 when no path is provided", async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			"http://example.com/"
		);

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Path is required" });
	});

	it("returns a cached response when present and skips upstream fetches", async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			"http://example.com/dundee-data-meetup/feb-2026?utm_source=test"
		);
		const cachedPayload = [
			{
				banner_url: "https://example.com/cached.png",
				location: "Cached Venue",
				location_map_url: "https://maps.google.com/?q=cached",
				title: "Cached Event",
				url: "https://ti.to/dundee-data-meetup/cached",
				start_time: "2026-04-01T18:00:00.000Z",
				end_time: "2026-04-01T20:00:00.000Z",
			},
		];

		cacheMatchSpy.mockResolvedValue(
			new Response(JSON.stringify(cachedPayload), {
				status: 200,
				headers: {
					"content-type": "application/json",
					"Cache-Control": "public, s-maxage=3600",
				},
			})
		);
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(cacheMatchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(cachePutSpy).not.toHaveBeenCalled();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(cachedPayload);
	});

	it("returns an iCal feed when .ics is requested", async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			"http://example.com/dundee-data-meetup/feb-2026.ics"
		);
		const upstreamPayload = {
			events: {
				past: [],
				unscheduled: [],
				upcoming: [
					{
						banner_url: "https://example.com/banner.png",
						location: "Dundee, UK",
						time: "March 31st, 2026",
						title: "March Event",
						url: "https://ti.to/dundee-data-meetup/mar-2026",
					},
				],
			},
		};

		mockTitoFeedFetches(upstreamPayload);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
		const body = await response.text();
		expect(body).toContain("BEGIN:VCALENDAR");
		expect(body).toContain("BEGIN:VEVENT");
		expect(body).toContain("SUMMARY:March Event");
		expect(body).toContain("DTSTART:20260331T183000Z");
		expect(body).toContain("URL;VALUE=URI:https://ti.to/dundee-data-meetup/mar-2026");
	});

	it("returns an RSS feed when .rss is requested", async () => {
		const request = new Request<unknown, IncomingRequestCfProperties>(
			"http://example.com/dundee-data-meetup/feb-2026.rss"
		);
		const upstreamPayload = {
			events: {
				past: [],
				unscheduled: [],
				upcoming: [
					{
						banner_url: "https://example.com/banner.png",
						location: "Dundee, UK",
						time: "March 31st, 2026",
						title: "March Event",
						url: "https://ti.to/dundee-data-meetup/mar-2026",
					},
				],
			},
		};

		mockTitoFeedFetches(upstreamPayload);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
		const body = await response.text();
		expect(body).toContain("<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\">");
		expect(body).toContain("<title><![CDATA[March Event]]></title>");
		expect(body).toContain("<link>https://ti.to/dundee-data-meetup/mar-2026</link>");
		expect(body).toContain("<description><![CDATA[Location: CodeBase, Dundee Map");
	});
});
