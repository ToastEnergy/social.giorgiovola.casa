import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { db } from './db/index.js';
import * as storage from './storage.js';
import { limitConcurrency } from './concurrency.js';

/**
 * Formats accepted on upload. Everything is re-encoded to WebP before it's stored; the other
 * entries are only used to serve files written before that.
 */
export const IMAGE_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	svg: 'image/svg+xml'
};

const ascii = (buf: Buffer, start: number, end: number) =>
	buf.subarray(start, end).toString('latin1');

const SVG_RE =
	/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

/**
 * Detects the image type from the file's magic bytes (one of the keys of IMAGE_TYPES);
 * the client-declared MIME type and file name are not trusted.
 */
export function sniffImage(buf: Buffer): string | null {
	if (
		buf.length >= 8 &&
		buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	)
		return 'png';
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
	const head = ascii(buf, 0, 6);
	if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
	if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP')
		return 'webp';
	if (buf.length >= 12 && ascii(buf, 4, 8) === 'ftyp') {
		const brand = ascii(buf, 8, 12);
		if (brand === 'avif' || brand === 'avis') return 'avif';
	}
	// "BM", four reserved zero bytes at offset 6, then a known DIB header size at offset 14
	if (
		buf.length >= 26 &&
		buf[0] === 0x42 &&
		buf[1] === 0x4d &&
		buf.readUInt32LE(6) === 0 &&
		[12, 40, 52, 56, 64, 108, 124].includes(buf.readUInt32LE(14))
	)
		return 'bmp';
	// reserved 0, type 1 (icon), at least one image
	if (
		buf.length >= 22 &&
		buf.readUInt16LE(0) === 0 &&
		buf.readUInt16LE(2) === 1 &&
		buf.readUInt16LE(4) > 0
	)
		return 'ico';
	const text = buf
		.subarray(0, 4096)
		.toString('utf8')
		.replace(/^\uFEFF/, '');
	if (SVG_RE.test(text)) return 'svg';
	return null;
}

const FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z]+)$/;

/** The content type for an upload file name as written by saveUpload, null for anything else. */
export function uploadType(file: string): string | null {
	const ext = FILE_RE.exec(file)?.[1];
	return ext ? IMAGE_TYPES[ext] ?? null : null;
}

// decoding a huge (or decompression-bomb) image would eat the server's memory
const MAX_INPUT_PIXELS = 100_000_000;

export class ImageError extends Error {}

// every decode holds the whole bitmap in memory: a burst of uploads queues instead
const decoding = limitConcurrency(4);

const tooLarge = (width: number, height: number) =>
	!(width > 0 && height > 0) || width * height > MAX_INPUT_PIXELS;

/**
 * The size BMP and ICO files declare, checked before skia decodes them: it allocates the whole
 * bitmap first (a small RLE-compressed BMP can declare gigapixels). An ICO is as large as its
 * largest entry, whose PNG data can be any size.
 */
function declaredTooLarge(buf: Buffer, ext: 'bmp' | 'ico'): boolean {
	if (ext === 'bmp') {
		// a 12-byte core header has 16-bit sizes, the others signed 32-bit (negative = top-down)
		const core = buf.readUInt32LE(14) === 12;
		const width = core ? buf.readUInt16LE(18) : Math.abs(buf.readInt32LE(18));
		const height = core ? buf.readUInt16LE(20) : Math.abs(buf.readInt32LE(22));
		return tooLarge(width, height);
	}
	const count = buf.readUInt16LE(4);
	if (buf.length < 6 + count * 16) return true;
	for (let i = 0; i < count; i++) {
		const entry = 6 + i * 16;
		let width = buf[entry] || 256;
		let height = buf[entry + 1] || 256;
		const offset = buf.readUInt32LE(entry + 12);
		// an embedded PNG: its IHDR has the real size
		if (buf.length >= offset + 24 && buf.readUInt32BE(offset) === 0x89504e47) {
			width = buf.readUInt32BE(offset + 16);
			height = buf.readUInt32BE(offset + 20);
		}
		if (tooLarge(width, height)) return true;
	}
	return false;
}

/** A sharp pipeline for a sniffed image. libvips can't read BMP and ICO, skia decodes those. */
async function decode(buf: Buffer, ext: string) {
	const options = { animated: true, limitInputPixels: MAX_INPUT_PIXELS };
	// limitInputPixels counts every frame of an animation together
	if (ext !== 'bmp' && ext !== 'ico') return sharp(buf, options).rotate();
	if (declaredTooLarge(buf, ext)) throw new ImageError('Image too large');
	const img = await loadImage(buf);
	if (img.width * img.height > MAX_INPUT_PIXELS) throw new ImageError('Image too large');
	const ctx = createCanvas(img.width, img.height).getContext('2d');
	ctx.drawImage(img, 0, 0);
	const { data } = ctx.getImageData(0, 0, img.width, img.height);
	return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
		raw: { width: img.width, height: img.height, channels: 4 }
	});
}

/**
 * Re-encodes an image as WebP: EXIF orientation applied, metadata (GPS and the like) stripped,
 * animations kept, and scaled down to fit in `size` (a square crop for avatars). SVGs are
 * rasterized, so no scripts can ever be served back. Throws ImageError when it can't be decoded.
 */
export function toWebp(
	buf: Buffer,
	ext: string,
	options: { size: number; square?: boolean }
): Promise<Buffer> {
	return decoding(() => encode(buf, ext, options));
}

async function encode(
	buf: Buffer,
	ext: string,
	{ size, square = false }: { size: number; square?: boolean }
): Promise<Buffer> {
	try {
		const image = await decode(buf, ext);
		let width = size;
		let height = size;
		if (square) {
			// crop to a square without upscaling small images
			const meta = await image.metadata();
			const side = Math.min(size, meta.width, meta.pageHeight ?? meta.height);
			width = height = side;
		}
		return await image
			.resize(width, height, { fit: square ? 'cover' : 'inside', withoutEnlargement: true })
			.webp({ quality: 82, effort: 4 })
			.toBuffer();
	} catch (e) {
		if (e instanceof ImageError) throw e;
		throw new ImageError('Invalid or corrupted image');
	}
}

/** Longest side of a stored post image; bigger ones are scaled down. */
export const POST_IMAGE_SIZE = 2048;
export const AVATAR_SIZE = 512;

/**
 * Kinds of uploaded images: the storage key prefix and the URL path they're served under. Every
 * upload is a WebP file named by a random uuid.
 */
const UPLOAD_KINDS = {
	// post images, public
	uploads: { key: 'uploads/', path: '/uploads/' },
	// message images, only served to the conversation (src/routes/dm-uploads)
	dm: { key: 'dm/', path: '/dm-uploads/' }
} as const;

export type UploadKind = keyof typeof UPLOAD_KINDS;

/**
 * The storage key for an upload's URL path (as saveUpload returns it), null for paths that aren't
 * ours.
 */
export function uploadKey(url: string): string | null {
	for (const kind of Object.values(UPLOAD_KINDS)) {
		if (!url.startsWith(kind.path)) continue;
		const file = url.slice(kind.path.length);
		return uploadType(file) ? kind.key + file : null;
	}
	return null;
}

/** Stores a WebP image of `kind` under a random name; returns its URL path. */
export async function storeUpload(kind: UploadKind, data: Uint8Array): Promise<string> {
	const file = `${crypto.randomUUID()}.webp`;
	await storage.put(UPLOAD_KINDS[kind].key + file, data, 'image/webp');
	return UPLOAD_KINDS[kind].path + file;
}

/** Writes a post image; returns the URL path stored with it. */
export const saveUpload = (buf: Buffer) => storeUpload('uploads', buf);

/** Writes a message image; returns the URL path stored with it. */
export const saveMessageUpload = (buf: Buffer) => storeUpload('dm', buf);

/**
 * Removes uploaded files by their URL path. Paths that aren't ours are ignored. A message image
 * is served from `uploads/` until its file is moved to `dm/`, so both are removed.
 */
export async function removeUploads(urls: string[]) {
	const keys = urls.flatMap((url) => {
		const key = uploadKey(url);
		if (!key) return [];
		return key.startsWith('dm/') ? [key, 'uploads/' + key.slice('dm/'.length)] : [key];
	});
	try {
		await storage.remove(keys);
	} catch (e) {
		console.error('failed to remove uploads', keys, e);
	}
}

/**
 * Images of the given posts and of every reply below them (replies are deleted along with their
 * parent). Call before deleting, then pass the result to removeUploads once the delete succeeded.
 */
export async function imagesOfPostTrees(where: ReturnType<typeof sql>): Promise<string[]> {
	const rows = await db.execute<{ image: string }>(sql`
		WITH RECURSIVE tree AS (
			SELECT id, images FROM posts WHERE ${where}
			UNION
			SELECT p.id, p.images FROM posts p INNER JOIN tree ON p.reply_to = tree.id
		)
		SELECT unnest(images) AS image FROM tree
	`);
	return rows.map((r) => r.image);
}

/**
 * Images of the direct messages the profile sent or received and of the group messages it sent:
 * they go away with it (ON DELETE CASCADE). Call before deleting, then pass the result to
 * removeUploads once the delete succeeded.
 */
export async function imagesOfMessagesOf(userId: number): Promise<string[]> {
	const rows = await db.execute<{ image: string }>(sql`
		SELECT unnest(images) AS image FROM messages
		WHERE sender_id = ${userId} OR recipient_id = ${userId}
		UNION ALL
		SELECT unnest(images) AS image FROM group_messages WHERE sender_id = ${userId}
	`);
	return rows.map((r) => r.image);
}
