import type { Gif } from '#lib/types.js';

/**
 * Searching KLIPY for GIFs, from the browser. KLIPY's terms want requests and media loads to come
 * from the user's own client, so this never goes through our server: /api/v1/instance hands out
 * the (public) app key, and a post or message then only carries the chosen GIF's URLs.
 * https://docs.klipy.com/gifs-api
 */

/** `gifs` of GET /api/v1/instance */
export type GifConfig = {
	provider: 'klipy';
	app_key: string;
	content_filter: 'off' | 'low' | 'medium' | 'high';
};

type KlipyFile = { url: string; width: number; height: number; size?: number };
type KlipyFormats = Partial<Record<'gif' | 'webp' | 'jpg' | 'mp4' | 'webm', KlipyFile>>;

export type KlipyItem = {
	id: number;
	slug: string;
	title?: string;
	/** `gif`; `ad` for ads, which this instance should have turned off in the partner panel */
	type: string;
	file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', KlipyFormats>>;
	/** a tiny blurred JPEG as a data: URL, to show while the GIF loads */
	blur_preview?: string;
};

export type KlipyPage = { items: KlipyItem[]; hasNext: boolean };

const BASE = 'https://api.klipy.com/api/v1/';
const PER_PAGE = 24;

const endpoint = (config: GifConfig, path: string) =>
	`${BASE}${encodeURIComponent(config.app_key)}/${path}`;

/** KLIPY's `locale`: a country code, taken from the browser's language when it names one. */
function locale() {
	const region = navigator.language.split('-')[1];
	return region && /^[a-z]{2}$/i.test(region) ? region.toLowerCase() : null;
}

export class KlipyError extends Error {}

/** A page of trending GIFs, or of the search results for `query`. */
export async function fetchGifs(
	config: GifConfig,
	query: string,
	page: number,
	signal?: AbortSignal
): Promise<KlipyPage> {
	const q = query.trim();
	const params = new URLSearchParams({
		page: String(page),
		per_page: String(PER_PAGE),
		content_filter: config.content_filter,
		// all the picker and posts use: smaller responses
		format_filter: 'webp,jpg,mp4'
	});
	if (q) params.set('q', q);
	const loc = locale();
	if (loc) params.set('locale', loc);
	const res = await fetch(`${endpoint(config, q ? 'gifs/search' : 'gifs/trending')}?${params}`, {
		signal,
		// KLIPY doesn't need to know which page of ours the search came from
		referrerPolicy: 'no-referrer'
	});
	if (res.status === 429) throw new KlipyError('Too many GIF searches, try again later.');
	if (!res.ok) throw new KlipyError('Could not load GIFs.');
	const body = await res.json().catch(() => null);
	const data = body?.data;
	if (!body?.result || !Array.isArray(data?.data)) throw new KlipyError('Could not load GIFs.');
	return { items: data.data as KlipyItem[], hasNext: !!data.has_next };
}

/** The smallest animated preview of an item for the picker grid. */
export function thumbnailOf(item: KlipyItem): KlipyFile | null {
	const f = item.file;
	return f?.sm?.webp ?? f?.xs?.webp ?? f?.md?.webp ?? f?.sm?.jpg ?? null;
}

/**
 * What a post or message stores of an item: the medium MP4 and its still frame, with KLIPY's
 * URLs as they are. Null for anything that isn't a usable GIF.
 */
export function toGif(item: KlipyItem): Gif | null {
	if (item.type !== 'gif' || !item.slug) return null;
	const f = item.file;
	const video = f?.md?.mp4 ?? f?.hd?.mp4 ?? f?.sm?.mp4;
	const poster = f?.md?.jpg ?? f?.hd?.jpg ?? f?.sm?.jpg;
	if (!video || !poster) return null;
	return {
		provider: 'klipy',
		slug: item.slug,
		title: item.title ?? '',
		video: video.url,
		poster: poster.url,
		width: Math.round(video.width),
		height: Math.round(video.height)
	};
}

/**
 * Tells KLIPY a GIF was sent (its share trigger, which ranks results), with the search that found
 * it. Never fails: it doesn't matter to the user.
 */
export function shareGif(config: GifConfig, slug: string, query: string) {
	fetch(endpoint(config, `gifs/share/${encodeURIComponent(slug)}`), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(query.trim() ? { q: query.trim() } : {}),
		referrerPolicy: 'no-referrer',
		keepalive: true
	}).catch(() => {});
}
