import { EDGE_CACHE_TTL_SECONDS } from '../settings';
import { parseRequestTarget } from './request-target';

export function createCacheKey(request: Request): Request {
	const url = new URL(request.url);
	const target = parseRequestTarget(url.pathname);
	url.search = '';
	url.pathname = `/${target.path}${target.format === 'json' ? '.json' : `.${target.format}`}`;
	return new Request(url.toString(), { method: 'GET' });
}

export function withCacheHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', `public, s-maxage=${EDGE_CACHE_TTL_SECONDS}`);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
