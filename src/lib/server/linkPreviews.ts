import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { inArray } from 'drizzle-orm';
import {
	FETCH_TIMEOUT_MS,
	MAX_URL,
	checkUrlShape,
	fetchMeta,
	sanitizeMeta,
	type Meta
} from '#lib/linkPreviewMeta.js';
import type { LinkPreview } from '#lib/types.js';
import { isHttpLink, unwrapMarkdownImages } from '#lib/utils.js';
import { LINK_PREVIEWS, LINK_PREVIEWS_SECRET, LINK_PREVIEWS_URL } from '$app/env/private';
import { PUBLIC_URL } from '$app/env/public';
import { db, link_previews } from './db/index.js';

// Previews of external links in posts: the Open Graph tags of the page, fetched server side (so
// readers never contact the site, except for the preview image) and cached in link_previews.
// Reads never wait on the network: a URL without a fresh row is fetched in the background and
// shows up on the next load. Writing a post waits a little for its own link (see warmLinkPreview).
//
// LINK_PREVIEWS picks who downloads the pages: `local` (this server, which shows its IP address
// to every linked site), `remote` (the Cloudflare Worker in workers/link-preview, at
// LINK_PREVIEWS_URL, for instances whose address is hidden behind a proxy) or `off`.

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
// a page that had no preview (or was down) is retried sooner
const FAILED_FRESH_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 4;
// how long to stop calling the worker after it failed, so an outage or a wrong secret doesn't
// mean one failing request per link on every page load
const WORKER_BACKOFF_MS = 60 * 1000;

/** Refuses an incomplete remote setup at startup instead of failing on every link later. */
export function checkLinkPreviewConfig() {
	if (LINK_PREVIEWS !== 'remote') return;
	if (!LINK_PREVIEWS_URL || !LINK_PREVIEWS_SECRET)
		throw new Error('LINK_PREVIEWS=remote needs LINK_PREVIEWS_URL and LINK_PREVIEWS_SECRET');
	let protocol = '';
	try {
		protocol = new URL(LINK_PREVIEWS_URL).protocol;
	} catch {
		// reported below
	}
	if (protocol !== 'https:' && protocol !== 'http:')
		throw new Error('LINK_PREVIEWS_URL must be an http(s) URL');
}

const ownHost = (() => {
	try {
		return PUBLIC_URL ? new URL(PUBLIC_URL).host.toLowerCase() : null;
	} catch {
		return null;
	}
})();

/** The first external http(s) link of a post, or null. Links to this instance are left out. */
export function firstExternalLink(content: string): string | null {
	// a markdown image is shown as a plain link, so it is previewed like one
	for (const raw of unwrapMarkdownImages(content).split(/\s+/)) {
		// punctuation right after a link ends the sentence, it isn't part of it
		const word = raw.replace(/[.,;:!?)\]}'"]+$/, '');
		if (word.length > MAX_URL || !isHttpLink(word)) continue;
		const url = new URL(word);
		if (url.host.toLowerCase() === ownHost) continue;
		url.hash = '';
		return url.href;
	}
	return null;
}

/** The preview of the first external link of each text (null when there's none, yet). */
export async function linkPreviews(contents: string[]): Promise<(LinkPreview | null)[]> {
	if (LINK_PREVIEWS === 'off') return contents.map(() => null);
	const urls = contents.map(firstExternalLink);
	const unique = [...new Set(urls.filter((u): u is string => u !== null))];
	if (unique.length === 0) return urls.map(() => null);

	const rows = await db.select().from(link_previews).where(inArray(link_previews.url, unique));
	const byUrl = new Map(rows.map((r) => [r.url, r]));
	for (const url of unique) {
		const row = byUrl.get(url);
		if (!row || isStale(row)) void refresh(url);
	}
	return urls.map((url) => {
		const row = url ? byUrl.get(url) : undefined;
		return row ? toPreview(row) : null;
	});
}

/**
 * Fetches the preview of a post's link if it isn't cached, waiting at most `waitMs` so posting
 * stays quick on slow sites (the fetch goes on in the background).
 */
export async function warmLinkPreview(content: string, waitMs = 2500) {
	if (LINK_PREVIEWS === 'off') return;
	const url = firstExternalLink(content);
	if (!url) return;
	const [row] = await db
		.select()
		.from(link_previews)
		.where(inArray(link_previews.url, [url]));
	if (row && !isStale(row)) return;
	await Promise.race([refresh(url), new Promise((resolve) => setTimeout(resolve, waitMs))]);
}

type Row = typeof link_previews.$inferSelect;

function isStale(row: Row) {
	const age = Date.now() - new Date(row.fetched_at).getTime();
	return age > (row.title ? FRESH_MS : FAILED_FRESH_MS);
}

function toPreview(row: Row): LinkPreview | null {
	if (!row.title) return null;
	return {
		url: row.url,
		title: row.title,
		description: row.description,
		image: row.image,
		site_name: row.site_name ?? new URL(row.url).hostname.replace(/^www\./, '')
	};
}

// one fetch per URL at a time, and only a few at once, so a timeline full of new links can't
// flood the server
const inFlight = new Map<string, Promise<void>>();
let running = 0;
const queue: (() => void)[] = [];
let workerDownUntil = 0;

function refresh(url: string): Promise<void> {
	const pending = inFlight.get(url);
	if (pending) return pending;
	if (LINK_PREVIEWS === 'remote' && Date.now() < workerDownUntil) return Promise.resolve();
	const job = (async () => {
		if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
		running++;
		try {
			const meta = LINK_PREVIEWS === 'remote' ? await remoteMeta(url) : await localMeta(url);
			const values = {
				title: meta?.title ?? null,
				description: meta?.description ?? null,
				image: meta?.image ?? null,
				site_name: meta?.site_name ?? null,
				fetched_at: new Date()
			};
			await db
				.insert(link_previews)
				.values({ url, ...values })
				.onConflictDoUpdate({ target: link_previews.url, set: values });
		} catch (e) {
			console.error('linkPreviews: refresh failed', e);
		} finally {
			running--;
			queue.shift()?.();
			inFlight.delete(url);
		}
	})();
	inFlight.set(url, job);
	return job;
}

const userAgent = `Mozilla/5.0 (compatible; LinkPreview/1.0${
	ownHost ? `; +https://${ownHost}` : ''
})`;

/** Downloads the page from this server: every hop must resolve to public addresses only. */
function localMeta(url: string): Promise<Meta | null> {
	return fetchMeta(url, { check: assertPublic, userAgent }).catch(() => null);
}

/**
 * Asks the worker (workers/link-preview) for the page's tags, so the linked site sees a
 * Cloudflare address instead of this server's. A page without a preview is `null`; a worker that
 * can't be reached or refuses the secret throws, so no row is written and the link is retried
 * once the worker is back instead of being cached as a failure for a day.
 */
async function remoteMeta(url: string): Promise<Meta | null> {
	try {
		const endpoint = new URL(LINK_PREVIEWS_URL);
		endpoint.searchParams.set('url', url);
		const res = await fetch(endpoint, {
			headers: { authorization: `Bearer ${LINK_PREVIEWS_SECRET}`, accept: 'application/json' },
			// the worker has FETCH_TIMEOUT_MS for the site, plus the round trip
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS + 3000)
		});
		if (!res.ok) {
			await res.body?.cancel();
			throw new Error(`worker answered ${res.status}`);
		}
		const body = (await res.json()) as { meta?: unknown } | null;
		return sanitizeMeta(body?.meta);
	} catch (e) {
		workerDownUntil = Date.now() + WORKER_BACKOFF_MS;
		throw e;
	}
}

// --- SSRF guard: only public hosts on the default ports ---

async function assertPublic(url: URL) {
	checkUrlShape(url);
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (host.toLowerCase() === ownHost?.split(':')[0]) throw new Error('own host');
	const addresses = isIP(host)
		? [host]
		: (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
	if (addresses.length === 0 || addresses.some(isPrivate)) throw new Error('private address');
}

function ipv4Private(ip: string) {
	const [a, b] = ip.split('.').map(Number);
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	);
}

/** The 8 groups of an IPv6 address as numbers (with an embedded IPv4 tail converted). */
function ipv6Groups(ip: string) {
	let s = ip.toLowerCase().split('%')[0];
	const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
	if (v4) {
		const [a, b, c, d] = v4[1].split('.').map(Number);
		s = s.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
	}
	const [left, right] = s.split('::');
	const l = left ? left.split(':') : [];
	const r = right !== undefined && right ? right.split(':') : [];
	const fill = s.includes('::') ? Array(8 - l.length - r.length).fill('0') : [];
	return [...l, ...fill, ...r].map((g) => parseInt(g || '0', 16));
}

function isPrivate(ip: string) {
	const kind = isIP(ip);
	if (kind === 4) return ipv4Private(ip);
	if (kind !== 6) return true;
	const g = ipv6Groups(ip);
	if (g.length !== 8 || g.some((n) => Number.isNaN(n))) return true;
	const toV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
	// ::ffff:a.b.c.d (mapped) and 64:ff9b::a.b.c.d (NAT64) reach IPv4 addresses
	if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return ipv4Private(toV4(g[6], g[7]));
	if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0))
		return ipv4Private(toV4(g[6], g[7]));
	// ::, ::1 and the deprecated IPv4-compatible range
	if (g.slice(0, 6).every((n) => n === 0)) return true;
	return (
		(g[0] & 0xfe00) === 0xfc00 || // unique local
		(g[0] & 0xffc0) === 0xfe80 || // link local
		(g[0] & 0xff00) === 0xff00 || // multicast
		g[0] === 0x2002 || // 6to4, may wrap a private IPv4
		(g[0] === 0x2001 && g[1] === 0) || // Teredo
		(g[0] === 0x2001 && g[1] === 0xdb8) // documentation
	);
}
