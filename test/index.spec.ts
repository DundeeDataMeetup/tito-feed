import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src";


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

		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation((input: string | URL | Request) => {
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

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://checkout.tito.io/dundee-data-meetup/feb-2026.json"
		);
		expect(fetchSpy).toHaveBeenCalledWith("https://ti.to/dundee-data-meetup/feb-2026");
		expect(fetchSpy).toHaveBeenCalledWith("https://ti.to/dundee-data-meetup/mar-2026");
		expect(response.status).toBe(200);
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
});
