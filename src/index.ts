import { createCacheKey, withCacheHeaders } from './http/cache-utils';
import { createFormattedResponse } from './http/response-formats';
import { parseRequestTarget } from './http/request-target';
import { flattenEvents, sortEventsByStartTime } from './processing/enrich-events';
import type { RequestTarget, TitoResponse } from './types';

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
