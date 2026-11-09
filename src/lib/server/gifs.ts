import { KLIPY_APP_KEY, KLIPY_CONTENT_FILTER } from '$app/env/private';
import type { Gif } from '#lib/types.js';
import { fail } from './api.js';

/**
 * GIFs come from KLIPY (https://docs.klipy.com). Its terms decide the shape of this feature:
 * clients search KLIPY themselves, from the browser, with the public app key /api/v1/instance
 * hands out, and its media is loaded from KLIPY's URLs as they are, never copied or proxied. So
 * the server never calls KLIPY: a post or message only stores the URLs of the chosen GIF, after
 * checking they point at KLIPY's media hosts.
 */

/** What clients need to search KLIPY, null when GIFs are off on this instance. */
export function gifConfig() {
	if (!KLIPY_APP_KEY) return null;
	return {
		provider: 'klipy' as const,
		app_key: KLIPY_APP_KEY,
		content_filter: KLIPY_CONTENT_FILTER as 'off' | 'low' | 'medium' | 'high'
	};
}

// static.klipy.com, static1.klipy.com, static2.klipy.com (docs.klipy.com/network-requirements),
// the same hosts as media-src in the CSP (vite.config.ts)
const MEDIA_HOST = /^static[12]?\.klipy\.com$/;
const SLUG_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_URL = 500;
const MAX_TITLE = 200;
const MAX_SIDE = 4096;

/** A KLIPY media URL, kept exactly as given; null when it isn't one. */
function mediaUrl(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.length > MAX_URL) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
	return MEDIA_HOST.test(url.hostname) ? raw : null;
}

const side = (raw: unknown) =>
	typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= MAX_SIDE ? raw : null;

/**
 * The `gif` of a new post or message: undefined when it has none, the checked GIF otherwise.
 * Throws a 400 for anything else, and a 403 when GIFs are off.
 */
export function parseGif(raw: unknown): Gif | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	// multipart sends it as a JSON string
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw);
		} catch {
			fail(400, 'gif must be an object');
		}
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
		fail(400, 'gif must be an object');
	if (!KLIPY_APP_KEY) fail(403, 'GIFs are turned off on this instance');
	const g = raw as Record<string, unknown>;
	if (g.provider !== undefined && g.provider !== 'klipy') fail(400, 'gif.provider must be "klipy"');
	if (typeof g.slug !== 'string' || !SLUG_RE.test(g.slug)) fail(400, 'Invalid gif.slug');
	if (g.title != null && typeof g.title !== 'string') fail(400, 'gif.title must be a string');
	const video = mediaUrl(g.video);
	if (!video) fail(400, 'gif.video must be an https URL on static.klipy.com');
	const poster = mediaUrl(g.poster);
	if (!poster) fail(400, 'gif.poster must be an https URL on static.klipy.com');
	const width = side(g.width);
	const height = side(g.height);
	if (width === null || height === null)
		fail(400, `gif.width and gif.height must be whole numbers from 1 to ${MAX_SIDE}`);
	return {
		provider: 'klipy',
		slug: g.slug,
		title: typeof g.title === 'string' ? g.title.trim().slice(0, MAX_TITLE) : '',
		video,
		poster,
		width,
		height
	};
}
