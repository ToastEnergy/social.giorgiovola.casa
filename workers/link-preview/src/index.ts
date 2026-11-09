import { MAX_URL, checkUrlShape, fetchImage, fetchMeta } from '../../../src/lib/linkPreviewMeta.js';

// Downloads the pages linked in posts, and their preview images, for an instance with
// LINK_PREVIEWS=remote, so the linked sites see a Cloudflare address instead of the instance's
// (which a proxy in front of it is meant to hide). The instance caches the answers; this worker
// keeps nothing.
//
// GET /?url=<link> with `Authorization: Bearer <LINK_PREVIEWS_SECRET>`
//   200 { "meta": { title, description, image, site_name } | null }  (null: no preview)
// GET /image?url=<https image> with the same header
//   200 the image's bytes as the site sent them (image/*, at most 5 MB); 404 no usable image.
//   The instance decodes and re-encodes them: the worker never does image work (CPU limits)
// both: 400 bad url, 401 wrong secret, 405 not GET

interface Env {
	LINK_PREVIEWS_SECRET?: string;
	/** the instance's public URL, named in the user agent so site owners know who's asking */
	SITE_URL?: string;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});

const sha256 = async (text: string) =>
	crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

// compares digests so the comparison takes the same time whatever the secret's length
async function authorized(request: Request, secret: string) {
	const header = request.headers.get('authorization') ?? '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : '';
	const [a, b] = await Promise.all([sha256(token), sha256(secret)]);
	return crypto.subtle.timingSafeEqual(a, b);
}

export default {
	async fetch(request, env) {
		if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
		// no secret configured means nobody may use it: an open worker is a free fetch proxy
		if (!env.LINK_PREVIEWS_SECRET || !(await authorized(request, env.LINK_PREVIEWS_SECRET)))
			return json({ error: 'unauthorized' }, 401);

		const requestUrl = new URL(request.url);
		// the worker may be routed under a path on a custom domain, so only the last segment counts
		const image = requestUrl.pathname.replace(/\/+$/, '').endsWith('/image');
		const target = requestUrl.searchParams.get('url') ?? '';
		let url: URL;
		try {
			url = new URL(target);
			if (target.length > MAX_URL) throw new Error('too long');
			checkUrlShape(url);
			if (image && url.protocol !== 'https:') throw new Error('not https');
		} catch {
			return json(
				{
					error: image
						? 'url must be an https link on the default port'
						: 'url must be an http(s) link on the default port'
				},
				400
			);
		}

		// no DNS check here (unlike the instance's local mode): the worker runs on Cloudflare's
		// network, where the instance's private addresses aren't reachable
		const site = env.SITE_URL ? `; +${env.SITE_URL}` : '';
		const options = {
			check: checkUrlShape,
			userAgent: `Mozilla/5.0 (compatible; LinkPreview/1.0${site})`
		};

		if (image) {
			const file = await fetchImage(url.href, options).catch(() => null);
			if (!file) return json({ error: 'no usable image' }, 404);
			return new Response(file.bytes, {
				headers: {
					'content-type': file.type,
					'cache-control': 'no-store',
					'x-content-type-options': 'nosniff'
				}
			});
		}

		const meta = await fetchMeta(url.href, options).catch(() => null);
		return json({ meta });
	}
} satisfies ExportedHandler<Env>;
