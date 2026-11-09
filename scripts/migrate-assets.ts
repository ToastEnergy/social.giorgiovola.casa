// Usage: bun scripts/migrate-assets.ts [--dry-run] [--delete-local] [--delete-orphans] [--purge]
//        bun scripts/migrate-assets.ts --purge-only [--dry-run]
// With docker: docker compose exec web bun scripts/migrate-assets.ts …
//
// Moves the avatars and images on local disk (static/uploads, static/avatars, data/dm) into the
// S3 / R2 bucket and makes old message images private (README: moving existing assets to the
// bucket). Safe to stop and run again: what is already in the bucket is skipped.
//
// 1. message images: every path in messages.images and group_messages.images
// 2. upload: static/uploads → dm/<file> (message images) or uploads/<file>, static/avatars →
//    avatars/<file>, data/dm → dm/<file>
// 3. verify that every path the database references is in the bucket; stops if anything is missing
// 4. rewrite message rows from /uploads/x to /dm-uploads/x
// 5. orphans: objects and local files nothing references (--delete-orphans deletes them)
// 6. Cloudflare: the /uploads/ URLs of message images and orphans to purge (--purge purges them)
//
// Self-contained (the Docker image has no src/): the key layout and the file name checks are
// copied from src/lib/server/storage.ts, src/lib/server/images.ts and src/routes/avatars.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

// the parts of Bun's S3 client used here (bun's types aren't installed)
type S3ListObject = { key: string; size?: number; lastModified?: string };
type S3Client = {
	list(options: {
		prefix?: string;
		continuationToken?: string;
		maxKeys?: number;
	}): Promise<{ contents?: S3ListObject[]; isTruncated?: boolean; nextContinuationToken?: string }>;
	write(key: string, data: Blob | ArrayBuffer, options?: { type?: string }): Promise<number>;
	file(key: string): Blob;
	delete(key: string): Promise<void>;
};
declare const Bun: {
	S3Client: new (options: {
		bucket: string;
		endpoint: string;
		region: string;
		accessKeyId: string;
		secretAccessKey: string;
	}) => S3Client;
	file(path: string): Blob;
};

const USAGE = `Usage: bun scripts/migrate-assets.ts [--dry-run] [--delete-local] [--delete-orphans] [--purge]
       bun scripts/migrate-assets.ts --purge-only [--dry-run]

  --dry-run         report what would happen; changes nothing in the bucket, the database,
                    the local files or Cloudflare
  --delete-local    after a successful verification, delete the local files that are in the bucket
  --delete-orphans  delete objects and local files that nothing references
  --purge           purge the printed URLs from Cloudflare (CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN)
  --purge-only      only step 6, without a bucket: print the URLs, and purge them when
                    CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN are set`;

const FLAGS = ['--dry-run', '--delete-local', '--delete-orphans', '--purge', '--purge-only'];
const args = process.argv.slice(2);
const unknown = args.filter((a) => !FLAGS.includes(a));
if (unknown.length) {
	console.error(`Unknown argument: ${unknown.join(' ')}\n\n${USAGE}`);
	process.exit(1);
}
const dryRun = args.includes('--dry-run');
const deleteLocal = args.includes('--delete-local');
const deleteOrphans = args.includes('--delete-orphans');
const purgeOnly = args.includes('--purge-only');
const purge = args.includes('--purge') || purgeOnly;
if (purgeOnly && (deleteLocal || deleteOrphans)) {
	console.error(
		`--purge-only can't be combined with --delete-local or --delete-orphans\n\n${USAGE}`
	);
	process.exit(1);
}

const env = (name: string) => process.env[name]?.trim() || '';

const databaseUrl = env('DATABASE_URL');
if (!databaseUrl) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const publicUrl = env('PUBLIC_URL').replace(/\/+$/, '');
const zoneId = env('CLOUDFLARE_ZONE_ID');
const cfToken = env('CLOUDFLARE_API_TOKEN');
const canPurge = Boolean(zoneId && cfToken);
if (args.includes('--purge') && !canPurge) {
	console.error('--purge needs CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN');
	process.exit(1);
}
if (purge && !publicUrl) {
	console.error('PUBLIC_URL is not set: it is needed to build the URLs to purge');
	process.exit(1);
}

const s3Config = {
	bucket: env('S3_BUCKET'),
	endpoint: env('S3_ENDPOINT').replace(/\/+$/, ''),
	region: env('S3_REGION') || 'auto',
	accessKeyId: env('S3_ACCESS_KEY_ID'),
	secretAccessKey: env('S3_SECRET_ACCESS_KEY')
};
if (!purgeOnly) {
	const missing = Object.entries({
		S3_BUCKET: s3Config.bucket,
		S3_ENDPOINT: s3Config.endpoint,
		S3_ACCESS_KEY_ID: s3Config.accessKeyId,
		S3_SECRET_ACCESS_KEY: s3Config.secretAccessKey
	})
		.filter(([, value]) => !value)
		.map(([name]) => name);
	if (missing.length) {
		console.error(
			`Not set: ${missing.join(', ')}. Configure the bucket first (README: storing assets in ` +
				'S3 / R2), or run with --purge-only.'
		);
		process.exit(1);
	}
}

// --- naming rules, as in the app ------------------------------------------------------------

// src/lib/server/images.ts: uploads are named by a random uuid
const UPLOAD_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	svg: 'image/svg+xml'
};
const UPLOAD_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z]+)$/;
const uploadType = (file: string) => {
	const ext = UPLOAD_RE.exec(file)?.[1];
	return ext ? UPLOAD_TYPES[ext] ?? null : null;
};

// src/routes/avatars/[file]/+server.ts
const AVATAR_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif'
};
const AVATAR_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const avatarType = (file: string) =>
	AVATAR_RE.test(file) ? AVATAR_TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? null : null;

// src/lib/server/storage.ts: where the fs driver keeps each key prefix
const DIRS = { uploads: 'static/uploads', avatars: 'static/avatars', dm: 'data/dm' } as const;
type Prefix = keyof typeof DIRS;

/** The upload file name of a stored /uploads/x or /dm-uploads/x path, null for anything else. */
function uploadFile(url: string): string | null {
	const match = /^\/(?:dm-)?uploads\/([^/?#]+)$/.exec(url);
	return match && uploadType(match[1]) ? match[1] : null;
}

/** The avatar file name of a users.avatar value (`/avatars/<file>?hash=…`), null for others. */
function avatarFile(url: string): string | null {
	const match = /^\/avatars\/([^/?#]+)(?:\?.*)?$/.exec(url);
	return match && avatarType(match[1]) ? match[1] : null;
}

const typeOf = (key: string) => {
	const [prefix, file] = key.split('/');
	return (prefix === 'avatars' ? avatarType(file) : uploadType(file)) ?? 'application/octet-stream';
};

// objects and files this new are left alone by the orphan step: the app may have just stored them
// for a post or message that wasn't committed yet when the database was read
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const UPLOAD_CONCURRENCY = 8;
// Cloudflare's purge by URL takes at most 100 URLs per request (500 on Enterprise) and 800 URLs
// a second on the Free plan (https://developers.cloudflare.com/cache/how-to/purge-cache/)
const PURGE_BATCH = 100;
const PURGE_PAUSE_MS = 250;

const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const client = purgeOnly ? null : new Bun.S3Client(s3Config);

const step = (n: number, title: string) => console.log(`\n== ${n}. ${title}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` on every item, `limit` at a time; returns the errors. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
	const errors: { item: T; error: unknown }[] = [];
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next++];
			try {
				await fn(item);
			} catch (error) {
				errors.push({ item, error });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return errors;
}

// --- reading the state ----------------------------------------------------------------------

type References = {
	/** upload files referenced by posts.images */
	posts: Set<string>;
	/** upload files referenced by either message table (/uploads/ or /dm-uploads/) */
	messages: Set<string>;
	/** avatar files referenced by users.avatar */
	avatars: Set<string>;
	/** message rows still holding an /uploads/ path, per table */
	toRewrite: { messages: number; group_messages: number };
	/** referenced paths that aren't ours (not uploads or avatars of this app), skipped */
	foreign: number;
};

async function readReferences(): Promise<References> {
	const refs: References = {
		posts: new Set(),
		messages: new Set(),
		avatars: new Set(),
		toRewrite: { messages: 0, group_messages: 0 },
		foreign: 0
	};
	const add = (set: Set<string>, file: string | null) => {
		if (file) set.add(file);
		else refs.foreign++;
	};
	for (const row of await sql<{ path: string }[]>`SELECT unnest(images) AS path FROM posts`) {
		add(refs.posts, uploadFile(row.path));
	}
	for (const table of ['messages', 'group_messages'] as const) {
		const rows = await sql<{ path: string }[]>`SELECT unnest(images) AS path FROM ${sql(table)}`;
		for (const row of rows) add(refs.messages, uploadFile(row.path));
		const [{ count }] = await sql<{ count: number }[]>`
			SELECT COUNT(*)::int AS count FROM ${sql(table)}
			WHERE EXISTS (SELECT 1 FROM unnest(images) AS p WHERE p LIKE '/uploads/%')
		`;
		refs.toRewrite[table] = count;
	}
	const avatars = await sql<{ avatar: string }[]>`
		SELECT avatar FROM users WHERE avatar IS NOT NULL AND avatar <> ''
	`;
	for (const row of avatars) add(refs.avatars, avatarFile(row.avatar));
	return refs;
}

/** The keys the app reads for what the database references. */
function expectedKeys(refs: References) {
	const keys = new Set<string>();
	for (const file of refs.posts) keys.add(`uploads/${file}`);
	for (const file of refs.messages) keys.add(`dm/${file}`);
	for (const file of refs.avatars) keys.add(`avatars/${file}`);
	return keys;
}

type LocalFile = { prefix: Prefix; file: string; path: string; size: number; mtime: number };

/** The files in the fs driver's directories with names the app could have written. */
function readLocalFiles() {
	const files: LocalFile[] = [];
	let skipped = 0;
	for (const prefix of Object.keys(DIRS) as Prefix[]) {
		const dir = DIRS[prefix];
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw e;
		}
		for (const entry of entries) {
			// staged/ (the old place of images picked in the composer) and anything else that isn't
			// an upload or avatar the app wrote
			const valid = prefix === 'avatars' ? avatarType(entry.name) : uploadType(entry.name);
			if (!entry.isFile() || !valid) {
				skipped++;
				continue;
			}
			const filePath = path.join(dir, entry.name);
			const stat = fs.statSync(filePath);
			files.push({
				prefix,
				file: entry.name,
				path: filePath,
				size: stat.size,
				mtime: stat.mtimeMs
			});
		}
	}
	return { files, skipped };
}

type BucketObject = { size: number; mtime: number };

async function listBucket(s3: S3Client) {
	const objects = new Map<string, BucketObject>();
	for (const prefix of Object.keys(DIRS)) {
		let continuationToken: string | undefined;
		do {
			const page = await s3.list({ prefix: `${prefix}/`, continuationToken, maxKeys: 1000 });
			for (const object of page.contents ?? []) {
				const mtime = object.lastModified ? Date.parse(object.lastModified) : Date.now();
				objects.set(object.key, { size: object.size ?? 0, mtime });
			}
			continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
		} while (continuationToken);
	}
	return objects;
}

/** The keys a local file belongs under in the bucket. */
function targetKeys(local: LocalFile, refs: References): string[] {
	if (local.prefix !== 'uploads') return [`${local.prefix}/${local.file}`];
	const keys: string[] = [];
	if (refs.messages.has(local.file)) keys.push(`dm/${local.file}`);
	// post images and unreferenced files (kept, and reported as orphans in step 5)
	if (refs.posts.has(local.file) || keys.length === 0) keys.push(`uploads/${local.file}`);
	return keys;
}

// --- steps ----------------------------------------------------------------------------------

async function purgeUrls(urls: string[]) {
	step(6, 'Cloudflare purge');
	if (urls.length === 0) {
		console.log('nothing to purge');
		return true;
	}
	console.log(
		`${plural(urls.length, 'URL')} of message images and orphans that Cloudflare may still cache:`
	);
	for (const url of urls) console.log(`  ${url}`);
	if (!purge) {
		console.log(
			'not purged: run with --purge (and CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN) to purge them'
		);
		return true;
	}
	if (!canPurge) {
		console.log('not purged: set CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN to purge them');
		return true;
	}
	if (dryRun) {
		console.log(
			`dry run: would purge them in ${plural(Math.ceil(urls.length / PURGE_BATCH), 'request')}`
		);
		return true;
	}
	const endpoint = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
		zoneId
	)}/purge_cache`;
	let purged = 0;
	for (let i = 0; i < urls.length; i += PURGE_BATCH) {
		const files = urls.slice(i, i + PURGE_BATCH);
		for (let attempt = 1; ; attempt++) {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ files })
			});
			const body = (await res.json().catch(() => null)) as {
				success?: boolean;
				errors?: { code: number; message: string }[];
			} | null;
			if (res.ok && body?.success) break;
			if (res.status === 429 && attempt < 5) {
				await sleep(Number(res.headers.get('Retry-After') ?? 0) * 1000 || 5000 * attempt);
				continue;
			}
			const reason = body?.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? '';
			console.error(`purge failed: ${res.status} ${reason}`);
			console.log(`purged ${purged} of ${urls.length}; run again to purge the rest`);
			return false;
		}
		purged += files.length;
		if (i + PURGE_BATCH < urls.length) await sleep(PURGE_PAUSE_MS);
	}
	console.log(`purged ${plural(purged, 'URL')}`);
	return true;
}

/** The URLs Cloudflare may hold: message images and orphans, once served publicly from /uploads. */
function purgeList(messageFiles: Iterable<string>, orphanUploads: Iterable<string>) {
	const files = new Set([...messageFiles, ...orphanUploads]);
	return [...files].sort().map((file) => `${publicUrl}/uploads/${file}`);
}

async function purgeOnlyRun() {
	if (dryRun) console.log('Dry run: nothing is changed.');
	step(1, 'message images');
	const refs = await readReferences();
	console.log(`${plural(refs.messages.size, 'message image')} in the database`);
	const { files } = readLocalFiles();
	// without a bucket only the local files can be checked for orphans
	const orphans = files.filter(
		(f) => f.prefix === 'uploads' && !refs.posts.has(f.file) && !refs.messages.has(f.file)
	);
	console.log(`${plural(orphans.length, 'unreferenced file')} in ${DIRS.uploads}`);
	return purgeUrls(
		purgeList(
			refs.messages,
			orphans.map((f) => f.file)
		)
	);
}

async function fullRun(s3: S3Client) {
	if (dryRun) console.log('Dry run: nothing is changed.');

	step(1, 'message images');
	let refs = await readReferences();
	console.log(
		`${plural(refs.messages.size, 'message image')}, ${plural(refs.posts.size, 'post image')}, ` +
			`${plural(refs.avatars.size, 'avatar')} referenced in the database`
	);
	if (refs.foreign)
		console.log(`${plural(refs.foreign, 'other path')} (not stored by this app) ignored`);

	step(2, 'upload');
	const { files: localFiles, skipped } = readLocalFiles();
	const bucket = await listBucket(s3);
	console.log(
		`${plural(localFiles.length, 'local file')} (${skipped} other entries skipped), ` +
			`${plural(bucket.size, 'object')} already in the bucket`
	);
	type Upload = { key: string; size: number; from: LocalFile | { key: string } };
	const uploads = new Map<string, Upload>();
	let present = 0;
	for (const local of localFiles) {
		for (const key of targetKeys(local, refs)) {
			if (bucket.get(key)?.size === local.size) present++;
			// data/dm wins over static/uploads for the same dm/ key: it's the newer copy
			else if (!uploads.has(key) || local.prefix === 'dm') {
				uploads.set(key, { key, size: local.size, from: local });
			}
		}
	}
	// message images the app put in the bucket under uploads/ (before they became private)
	for (const file of refs.messages) {
		const key = `dm/${file}`;
		const old = bucket.get(`uploads/${file}`);
		if (!bucket.has(key) && !uploads.has(key) && old) {
			uploads.set(key, { key, size: old.size, from: { key: `uploads/${file}` } });
		}
	}
	console.log(`${present} already in the bucket with the same size, ${uploads.size} to upload`);
	if (dryRun) {
		for (const upload of uploads.values()) {
			const from = 'path' in upload.from ? upload.from.path : upload.from.key;
			console.log(`  would upload ${from} → ${upload.key}`);
		}
	} else {
		let done = 0;
		const errors = await pool([...uploads.values()], UPLOAD_CONCURRENCY, async (upload) => {
			const data =
				'path' in upload.from
					? Bun.file(upload.from.path)
					: await s3.file(upload.from.key).arrayBuffer();
			await s3.write(upload.key, data, { type: typeOf(upload.key) });
			bucket.set(upload.key, { size: upload.size, mtime: Date.now() });
			if (++done % 100 === 0) console.log(`  ${done} of ${uploads.size}`);
		});
		for (const { item, error } of errors) {
			console.error(`  failed ${item.key}: ${error instanceof Error ? error.message : error}`);
		}
		console.log(`uploaded ${done}, failed ${errors.length}`);
		if (errors.length) {
			console.error('\nSome uploads failed; run the script again to retry them.');
			return false;
		}
	}

	step(3, 'verify');
	// a dry run counts what it would upload as there
	const inBucket = (key: string) => bucket.has(key) || (dryRun && uploads.has(key));
	const expected = expectedKeys(refs);
	const missing = [...expected].filter((key) => !inBucket(key)).sort();
	if (missing.length) {
		console.error(`${plural(missing.length, 'referenced file')} missing from the bucket:`);
		for (const key of missing) console.error(`  ${key}`);
		console.error(
			'\nNothing is rewritten or deleted until every referenced file is in the bucket. Find the ' +
				'missing files (an older volume or backup) and put them in the local directories, then ' +
				'run the script again.'
		);
		return false;
	}
	console.log(`all ${plural(expected.size, 'referenced file')} are in the bucket`);

	step(4, 'rewrite message image paths');
	const toRewrite = refs.toRewrite.messages + refs.toRewrite.group_messages;
	if (toRewrite === 0) {
		console.log('nothing to rewrite');
	} else if (dryRun) {
		console.log(
			`would rewrite /uploads/ to /dm-uploads/ in ${plural(
				refs.toRewrite.messages,
				'direct message'
			)} ` + `and ${plural(refs.toRewrite.group_messages, 'group message')}`
		);
	} else {
		const counts = await sql.begin(async (tx) => {
			const result: Record<string, number> = {};
			for (const table of ['messages', 'group_messages'] as const) {
				const rows = await tx`
					UPDATE ${tx(table)} SET images = ARRAY(
						SELECT regexp_replace(p, '^/uploads/', '/dm-uploads/')
						FROM unnest(images) WITH ORDINALITY AS t(p, i) ORDER BY i
					)
					WHERE EXISTS (SELECT 1 FROM unnest(images) AS p WHERE p LIKE '/uploads/%')
				`;
				result[table] = rows.count;
			}
			return result;
		});
		console.log(
			`rewrote ${plural(counts.messages, 'direct message')} and ` +
				`${plural(counts.group_messages, 'group message')}`
		);
	}

	if (deleteLocal) {
		console.log('\n-- delete local files that are in the bucket');
		const confirmed = localFiles.filter((local) =>
			targetKeys(local, refs).every(
				(key) => ((dryRun && uploads.get(key)) || bucket.get(key))?.size === local.size
			)
		);
		const kept = localFiles.length - confirmed.length;
		if (dryRun) {
			console.log(`would delete ${plural(confirmed.length, 'local file')}, keep ${kept}`);
		} else {
			for (const local of confirmed) fs.rmSync(local.path, { force: true });
			console.log(`deleted ${plural(confirmed.length, 'local file')}, kept ${kept}`);
		}
	}

	step(5, 'orphans');
	// read again: posts and messages may have been sent while the files were uploading
	refs = await readReferences();
	const referenced = expectedKeys(refs);
	const isReferencedLocal = (local: LocalFile) =>
		local.prefix === 'avatars'
			? refs.avatars.has(local.file)
			: refs.posts.has(local.file) || refs.messages.has(local.file);
	const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
	const orphanObjects = [...bucket]
		.filter(([key, object]) => !referenced.has(key) && object.mtime < cutoff)
		.map(([key]) => key)
		.sort();
	const orphanFiles = localFiles.filter(
		(local) => fs.existsSync(local.path) && !isReferencedLocal(local) && local.mtime < cutoff
	);
	const recent =
		[...bucket].filter(([key, object]) => !referenced.has(key) && object.mtime >= cutoff).length +
		localFiles.filter((l) => !isReferencedLocal(l) && l.mtime >= cutoff).length;
	console.log(
		`${plural(orphanObjects.length, 'object')} in the bucket and ` +
			`${plural(orphanFiles.length, 'local file')} referenced by nothing` +
			(recent ? ` (${recent} newer than an hour left alone)` : '')
	);
	for (const key of orphanObjects) console.log(`  bucket ${key}`);
	for (const local of orphanFiles) console.log(`  local  ${local.path}`);
	if (deleteOrphans && (orphanObjects.length || orphanFiles.length)) {
		if (dryRun) {
			console.log('dry run: would delete them');
		} else {
			const errors = await pool(orphanObjects, UPLOAD_CONCURRENCY, (key) => s3.delete(key));
			for (const { item, error } of errors) {
				console.error(
					`  failed to delete ${item}: ${error instanceof Error ? error.message : error}`
				);
			}
			for (const local of orphanFiles) fs.rmSync(local.path, { force: true });
			console.log(
				`deleted ${plural(orphanObjects.length - errors.length, 'object')} and ` +
					`${plural(orphanFiles.length, 'local file')}`
			);
			if (errors.length) return false;
		}
	} else if (orphanObjects.length || orphanFiles.length) {
		console.log('kept: run with --delete-orphans to delete them');
	}

	// orphans served from /uploads/ (not avatars: their URLs carry a ?hash= that isn't known)
	const orphanUploads = [
		...orphanObjects.filter((key) => key.startsWith('uploads/')).map((key) => key.slice(8)),
		...orphanFiles.filter((f) => f.prefix === 'uploads').map((f) => f.file)
	];
	if (!publicUrl) {
		step(6, 'Cloudflare purge');
		console.log('skipped: PUBLIC_URL is not set');
		return true;
	}
	return purgeUrls(purgeList(refs.messages, orphanUploads));
}

let ok: boolean;
try {
	ok = client ? await fullRun(client) : await purgeOnlyRun();
} finally {
	await sql.end();
}
console.log(ok ? '\nDone.' : '\nStopped with errors.');
process.exit(ok ? 0 : 1);
