import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, link_previews } from './db/index.js';
import { ImageError, sniffImage, toWebp } from './images.js';
import { SANDBOX, notFound } from './messageImages.js';
import * as storage from './storage.js';

/**
 * The images of link preview cards, kept by us so readers' browsers never load anything from the
 * linked site. Downloaded by linkPreviews.ts (from this server or the worker), re-encoded here as
 * a small WebP and stored under `previews/<sha256 of the source URL>.webp`, so a site's shared
 * og:image is stored once. `link_previews.image` holds the path they're served at.
 */

// the card is at most one column wide (640px): 2x for sharp screens, but a modest quality
const PREVIEW_SIZE = 1200;
const PREVIEW_QUALITY = 70;

const PATH = '/previews/';
const FILE_RE = /^[0-9a-f]{64}\.webp$/;

/** The path the image downloaded from `source` is (or would be) served at. */
export function previewPath(source: string) {
	return PATH + crypto.createHash('sha256').update(source).digest('hex') + '.webp';
}

/** Whether `image` (a `link_previews.image` value) is one of our paths, not an external URL. */
export function isPreviewPath(image: string | null): image is string {
	return !!image && image.startsWith(PATH) && FILE_RE.test(image.slice(PATH.length));
}

const keyOf = (path: string) => 'previews/' + path.slice(PATH.length);

// a file is only written, or deleted once no row uses it, while holding its lock: otherwise a
// refresh that just found the file could save a row pointing at it as another one deletes it.
// In memory, like the rate limits: the app runs as a single process
const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` while holding the lock of `path` (no lock for null). */
export async function withPreviewLock<T>(path: string | null, fn: () => Promise<T>): Promise<T> {
	if (!path) return fn();
	const run = (locks.get(path) ?? Promise.resolve()).then(fn);
	const tail = run.catch(() => {});
	locks.set(path, tail);
	try {
		return await run;
	} finally {
		if (locks.get(path) === tail) locks.delete(path);
	}
}

/**
 * Makes sure the image of `source` is stored, downloading it with `download` unless it already
 * is. Returns its path, or null when there is no usable image. Call under withPreviewLock.
 */
export async function storePreviewImage(
	source: string,
	download: (source: string) => Promise<Uint8Array | null>
): Promise<string | null> {
	const path = previewPath(source);
	// already there (another page with the same image, or this one before a refresh): the file
	// is immutable once served, so it isn't downloaded again
	if (await storage.head(keyOf(path))) return path;
	const bytes = await download(source).catch(() => null);
	if (!bytes) return null;
	const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// the declared content type isn't trusted, and nothing but a re-encoded WebP is ever stored
	const ext = sniffImage(buffer);
	if (!ext) return null;
	let webp: Buffer;
	try {
		webp = await toWebp(buffer, ext, {
			size: PREVIEW_SIZE,
			quality: PREVIEW_QUALITY,
			animated: false
		});
	} catch (e) {
		if (e instanceof ImageError) return null;
		throw e;
	}
	await storage.put(keyOf(path), webp, 'image/webp');
	return path;
}

/** Deletes a preview image once no row uses it. External URLs (rows from before) are ignored. */
export async function dropPreviewImage(image: string | null) {
	if (!isPreviewPath(image)) return;
	await withPreviewLock(image, async () => {
		const [used] = await db
			.select({ url: link_previews.url })
			.from(link_previews)
			.where(eq(link_previews.image, image))
			.limit(1);
		if (!used) await storage.remove([keyOf(image)]);
	}).catch((e) => console.error('previewImages: failed to remove', image, e));
}

/** The response for GET /previews/`file`. */
export async function servePreview(file: string): Promise<Response> {
	if (!FILE_RE.test(file)) return notFound();
	const object = await storage.get('previews/' + file);
	if (!object) return notFound();
	return new Response(object.body, {
		headers: {
			'Content-Type': 'image/webp',
			'Content-Length': object.size.toString(),
			// named by the source URL and never rewritten while it exists
			'Cache-Control': 'public, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': SANDBOX
		}
	});
}
