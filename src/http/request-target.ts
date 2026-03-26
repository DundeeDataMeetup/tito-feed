import type { RequestTarget } from '../types';

export function parseRequestTarget(pathname: string): RequestTarget {
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

export function buildFeedTitle(path: string): string {
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