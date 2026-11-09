// Downloading a page and reading its Open Graph tags, and downloading its image. Shared by the instance (LINK_PREVIEWS=local,
// src/lib/server/linkPreviews.ts) and the Cloudflare Worker (workers/link-preview), so it must
// stay free of node:*, $app/* and #lib imports: only web APIs that both runtimes have.

export type Meta = {
	title: string;
	description: string | null;
	/** an absolute https URL, or null */
	image: string | null;
	site_name: string | null;
};

export const MAX_URL = 2048;
export const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 4;
// the tags are in <head>, but some sites (YouTube) put ~800KB of scripts before them
const MAX_BYTES = 1024 * 1024;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;
const MAX_SITE_NAME = 100;

export type FetchMetaOptions = {
	/** runs before every request (the link and each redirect), throws to refuse the URL */
	check: (url: URL) => void | Promise<void>;
	userAgent: string;
};

/** http(s) on the default ports, without credentials. */
export function checkUrlShape(url: URL) {
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad protocol');
	if (url.port && url.port !== '80' && url.port !== '443') throw new Error('bad port');
	if (url.username || url.password) throw new Error('credentials in url');
}

/** Downloads the page (following redirects that pass `check`) and reads its meta tags. */
export async function fetchMeta(start: string, options: FetchMetaOptions): Promise<Meta | null> {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	let url = new URL(start);
	for (let hop = 0; ; hop++) {
		await options.check(url);
		const res = await fetch(url, {
			redirect: 'manual',
			signal,
			headers: {
				'user-agent': options.userAgent,
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

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Downloads a preview image (following redirects that pass `check`): https on every hop, an
 * image/* content type and at most `maxBytes`, or null. Only the bytes: decoding and re-encoding
 * happen on the instance (src/lib/server/images.ts), never in the worker, whose CPU time is tight.
 */
export async function fetchImage(
	start: string,
	options: FetchMetaOptions & { maxBytes?: number }
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | null> {
	const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	let url = new URL(start);
	for (let hop = 0; ; hop++) {
		// an http image would be mixed content, and so would a redirect to one
		if (url.protocol !== 'https:') return null;
		await options.check(url);
		const res = await fetch(url, {
			redirect: 'manual',
			signal,
			headers: { 'user-agent': options.userAgent, accept: 'image/*' }
		});
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel();
			const location = res.headers.get('location');
			if (!location || hop >= MAX_REDIRECTS) return null;
			url = new URL(location, url);
			continue;
		}
		const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		const declared = Number(res.headers.get('content-length') ?? 0);
		if (!res.ok || !type.startsWith('image/') || declared > maxBytes) {
			await res.body?.cancel();
			return null;
		}
		const bytes = await readCapped(res, maxBytes);
		return bytes ? { bytes, type } : null;
	}
}

/** The whole body, or null (and the download stopped) once it goes over `max` bytes. */
export async function readCapped(
	res: Response,
	max: number
): Promise<Uint8Array<ArrayBuffer> | null> {
	const reader = res.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

// byte-per-character decoding, never fails: enough to spot tags and the charset. Not TextDecoder
// ('latin1'), which not every runtime supports
function latin1(bytes: Uint8Array) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 8192)
		s += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return s;
}

/** The start of the body, up to </head> or MAX_BYTES, decoded with the page's charset. */
async function readHead(res: Response, type: string) {
	const reader = res.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let size = 0;
	let tail = '';
	while (size < MAX_BYTES) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.byteLength;
		tail = (tail + latin1(value)).slice(-4096);
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
		latin1(bytes.subarray(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
	try {
		return new TextDecoder(declared || 'utf-8').decode(bytes);
	} catch {
		return new TextDecoder('utf-8').decode(bytes);
	}
}

const clip = (text: string | null | undefined, max: number) => {
	if (!text) return null;
	return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

const clean = (s: string | undefined, max: number) =>
	clip(s && decodeEntities(s).replace(/\s+/g, ' ').trim(), max);

/** An absolute https URL resolved against `base`, or null (an http image would be mixed content). */
function httpsUrl(raw: string, base?: URL) {
	try {
		const resolved = new URL(raw, base);
		return resolved.protocol === 'https:' && resolved.href.length <= MAX_URL ? resolved.href : null;
	} catch {
		return null;
	}
}

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

	const title = clean(tags.get('og:title') ?? tags.get('twitter:title') ?? titleTag, MAX_TITLE);
	if (!title) return null;
	const description = clean(
		tags.get('og:description') ?? tags.get('twitter:description') ?? tags.get('description'),
		MAX_DESCRIPTION
	);
	const site_name = clean(tags.get('og:site_name') ?? tags.get('application-name'), MAX_SITE_NAME);
	const rawImage =
		tags.get('og:image:secure_url') ??
		tags.get('og:image') ??
		tags.get('og:image:url') ??
		tags.get('twitter:image') ??
		tags.get('twitter:image:src');
	const image = rawImage ? httpsUrl(decodeEntities(rawImage.trim()), base) : null;
	return { title, description, image, site_name };
}

/** A Meta received from elsewhere (the worker), held to the same limits as parseMeta. */
export function sanitizeMeta(value: unknown): Meta | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const str = (x: unknown) => (typeof x === 'string' ? x.trim() : null);
	const title = clip(str(v.title), MAX_TITLE);
	if (!title) return null;
	const image = str(v.image);
	return {
		title,
		description: clip(str(v.description), MAX_DESCRIPTION),
		image: image ? httpsUrl(image) : null,
		site_name: clip(str(v.site_name), MAX_SITE_NAME)
	};
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
