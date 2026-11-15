// Usage: bun scripts/backfill-image-sizes.ts [--dry-run]   (needs DATABASE_URL)
// With docker: docker compose exec web bun scripts/backfill-image-sizes.ts
//
// One-off: fills in image_sizes (see src/lib/server/db/schema.ts) for posts, messages and group
// messages whose images were uploaded before sizes were saved, by reading the stored files: from
// the S3 / R2 bucket when S3_BUCKET is set (falling back to the volumes, like the app), from the
// volumes otherwise. A row is only updated when every one of its images could be read; the
// others stay null and clients keep measuring them. Safe to run again, and while the app runs.
//
// Self-contained (the Docker image has no src/): the storage layout is copied from
// src/lib/server/storage.ts and src/lib/server/images.ts.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';

// the parts of Bun's S3 client used here (bun's types aren't installed)
type S3Client = {
	file(key: string): { exists(): Promise<boolean>; arrayBuffer(): Promise<ArrayBuffer> };
};
declare const Bun: {
	S3Client: new (options: {
		bucket: string;
		endpoint: string;
		region: string;
		accessKeyId: string;
		secretAccessKey: string;
	}) => S3Client;
};

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--dry-run');
if (unknown.length) {
	console.error(
		`Unknown argument: ${unknown.join(' ')}\nUsage: bun scripts/backfill-image-sizes.ts [--dry-run]`
	);
	process.exit(1);
}
const dryRun = args.includes('--dry-run');

const env = (name: string) => process.env[name]?.trim() || '';
const databaseUrl = env('DATABASE_URL');
if (!databaseUrl) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}
const s3 = env('S3_BUCKET')
	? new Bun.S3Client({
			bucket: env('S3_BUCKET'),
			endpoint: env('S3_ENDPOINT').replace(/\/+$/, ''),
			region: env('S3_REGION') || 'auto',
			accessKeyId: env('S3_ACCESS_KEY_ID'),
			secretAccessKey: env('S3_SECRET_ACCESS_KEY')
	  })
	: null;

// src/lib/server/storage.ts: where the fs driver keeps each key prefix
const DIRS = { uploads: 'static/uploads', dm: 'data/dm' } as const;
const UPLOAD_RE =
	/^\/(dm-)?uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]+)$/;

/** The storage keys a stored image path may be under, in the order the app reads them. */
function keysOf(url: string, message: boolean): string[] {
	const match = UPLOAD_RE.exec(url);
	if (!match) return [];
	const file = match[2];
	// message images are read from dm/ and then uploads/ (sent before they became private)
	return message ? [`dm/${file}`, `uploads/${file}`] : [`uploads/${file}`];
}

async function read(key: string): Promise<Buffer | null> {
	if (s3) {
		try {
			const object = s3.file(key);
			if (await object.exists()) return Buffer.from(await object.arrayBuffer());
		} catch (e) {
			console.warn(`  could not read ${key} from the bucket:`, e);
		}
	}
	const [prefix, file] = key.split('/') as [keyof typeof DIRS, string];
	try {
		return await fs.promises.readFile(path.join(DIRS[prefix], file));
	} catch {
		return null;
	}
}

type Size = { width: number; height: number };

/** The size the image is shown at (one frame, EXIF rotation applied), null when unreadable. */
async function sizeOf(url: string, message: boolean): Promise<Size | null> {
	for (const key of keysOf(url, message)) {
		const data = await read(key);
		if (!data) continue;
		try {
			const meta = await sharp(data).metadata();
			let width = meta.width;
			let height = meta.pageHeight ?? meta.height;
			// files from before uploads were re-encoded may still carry an EXIF rotation
			if ((meta.orientation ?? 1) >= 5) [width, height] = [height, width];
			return width > 0 && height > 0 ? { width, height } : null;
		} catch {
			return null;
		}
	}
	return null;
}

const sql = postgres(databaseUrl, { max: 2 });
const BATCH = 200;

async function backfill(table: 'posts' | 'messages' | 'group_messages') {
	const message = table !== 'posts';
	let lastId = 0;
	let filled = 0;
	let skipped = 0;
	for (;;) {
		const rows = await sql<{ id: number; images: string[] }[]>`
			SELECT id, images FROM ${sql(table)}
			WHERE id > ${lastId} AND image_sizes IS NULL AND cardinality(images) > 0
			ORDER BY id LIMIT ${BATCH}`;
		if (rows.length === 0) break;
		lastId = rows[rows.length - 1].id;
		for (const row of rows) {
			const sizes = await Promise.all(row.images.map((url) => sizeOf(url, message)));
			if (sizes.some((s) => s === null)) {
				skipped++;
				continue;
			}
			if (!dryRun)
				// only when nothing changed in between
				await sql`
					UPDATE ${sql(table)} SET image_sizes = ${sql.json(sizes as unknown as postgres.JSONValue)}
					WHERE id = ${row.id} AND image_sizes IS NULL AND images = ${row.images}`;
			filled++;
		}
	}
	console.log(
		`${table}: ${
			dryRun ? 'would fill' : 'filled'
		} ${filled}, skipped ${skipped} (an image missing or unreadable)`
	);
}

try {
	for (const table of ['posts', 'messages', 'group_messages'] as const) await backfill(table);
} finally {
	await sql.end();
}
