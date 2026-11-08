import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { inArray } from 'drizzle-orm';
import type { LinkPreview } from '#lib/types.js';
import { isHttpLink } from '#lib/utils.js';
import { PUBLIC_URL } from '$app/env/public';
import { db, link_previews } from './db/index.js';

// Previews of external links in posts: the Open Graph tags of the page, fetched server side (so
// readers never contact the site, except for the preview image) and cached in link_previews.
// Reads never wait on the network: a URL without a fresh row is fetched in the background and
// shows up on the next load. Writing a post waits a little for its own link (see warmLinkPreview).

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
// a page that had no preview (or was down) is retried sooner
const FAILED_FRESH_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 4;
// the tags are in <head>, but some sites (YouTube) put ~800KB of scripts before them
const MAX_BYTES = 1024 * 1024;
const MAX_URL = 2048;
const MAX_CONCURRENT = 4;

const ownHost = (() => {
	try {
		return PUBLIC_URL ? new URL(PUBLIC_URL).host.toLowerCase() : null;
	} catch {
		return null;
	}
})();

// markdown images are shown as images, not previewed
const markdownImage = /!\[[^\]]*\]\([^)]*\)/g;

/** The first external http(s) link of a post, or null. Links to this instance are left out. */
export function firstExternalLink(content: string): string | null {
	for (const raw of content.replace(markdownImage, ' ').split(/\s+/)) {
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

function refresh(url: string): Promise<void> {
	const pending = inFlight.get(url);
	if (pending) return pending;
	const job = (async () => {
		if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
		running++;
		try {
			const meta = await fetchMeta(url).catch(() => null);
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

type Meta = Omit<LinkPreview, 'url' | 'site_name'> & { site_name: string | null };

/** Downloads the page (following redirects to public hosts only) and reads its meta tags. */
async function fetchMeta(start: string): Promise<Meta | null> {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	let url = new URL(start);
	for (let hop = 0; ; hop++) {
		await assertPublic(url);
		const res = await fetch(url, {
			redirect: 'manual',
			signal,
			headers: {
				'user-agent': `Mozilla/5.0 (compatible; LinkPreview/1.0${
					ownHost ? `; +https://${ownHost}` : ''
				})`,
				accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
				'accept-language': 'en;q=0.9,*;q=0.5'
			}
		});
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel();
			const location = res.headers.get('location');
			if (!location || hop >= MAX_REDIRECTS) return null;
			url = new URL(location, url);
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel();
			return null;
		}
		const type = res.headers.get('content-type') ?? '';
		if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
			await res.body?.cancel();
			return null;
		}
		const html = await readHead(res, type);
		return parseMeta(html, url);
	}
}

/** The start of the body, up to </head> or MAX_BYTES, decoded with the page's charset. */
async function readHead(res: Response, type: string) {
	const reader = res.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let size = 0;
	let tail = '';
	const ascii = new TextDecoder('latin1');
	while (size < MAX_BYTES) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.byteLength;
		// latin1 never fails, enough to spot the end of <head>
		tail = (tail + ascii.decode(value)).slice(-4096);
		if (/<\/head>|<body[\s>]/i.test(tail)) break;
	}
	await reader.cancel().catch(() => {});
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const declared =
		type.match(/charset=["']?([\w-]+)/i)?.[1] ??
		ascii.decode(bytes.subarray(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
	try {
		return new TextDecoder(declared || 'utf-8').decode(bytes);
	} catch {
		return new TextDecoder('utf-8').decode(bytes);
	}
}

const clean = (s: string | undefined, max: number) => {
	const text = s && decodeEntities(s).replace(/\s+/g, ' ').trim();
	if (!text) return null;
	return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

/** Open Graph / Twitter card / plain HTML metadata of a page. */
export function parseMeta(html: string, base: URL): Meta | null {
	const end = html.search(/<\/head>/i);
	const head = end === -1 ? html : html.slice(0, end);
	const tags = new Map<string, string>();
	for (const [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
		const attrs = new Map<string, string>();
		for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
			attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
		const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
		const content = attrs.get('content');
		// the first one wins, like in most crawlers
		if (key && content !== undefined && !tags.has(key)) tags.set(key, content);
	}
	const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

	const title = clean(tags.get('og:title') ?? tags.get('twitter:title') ?? titleTag, 200);
	if (!title) return null;
	const description = clean(
		tags.get('og:description') ?? tags.get('twitter:description') ?? tags.get('description'),
		300
	);
	const site_name = clean(tags.get('og:site_name') ?? tags.get('application-name'), 100);

	let image: string | null = null;
	const rawImage =
		tags.get('og:image:secure_url') ??
		tags.get('og:image') ??
		tags.get('og:image:url') ??
		tags.get('twitter:image') ??
		tags.get('twitter:image:src');
	if (rawImage) {
		try {
			const resolved = new URL(decodeEntities(rawImage.trim()), base);
			// https only: an http image would be mixed content
			if (resolved.protocol === 'https:' && resolved.href.length <= MAX_URL) image = resolved.href;
		} catch {
			// not a URL
		}
	}
	return { title, description, image, site_name };
}

const named: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	laquo: '«',
	raquo: '»',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	middot: '·',
	bull: '•',
	copy: '©',
	reg: '®',
	trade: '™'
};

function decodeEntities(s: string) {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
		if (code[0] === '#') {
			const n =
				code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
			return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
		}
		return named[code.toLowerCase()] ?? entity;
	});
}

// --- SSRF guard: only public hosts on the default ports ---

async function assertPublic(url: URL) {
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad protocol');
	if (url.port && url.port !== '80' && url.port !== '443') throw new Error('bad port');
	if (url.username || url.password) throw new Error('credentials in url');
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
