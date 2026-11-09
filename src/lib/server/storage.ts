import fs from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import {
	S3_ACCESS_KEY_ID,
	S3_BUCKET,
	S3_ENDPOINT,
	S3_REGION,
	S3_SECRET_ACCESS_KEY
} from '$app/env/private';

/**
 * Where avatars, post images, message images and link preview images are kept: the local
 * filesystem (the default) or an S3-compatible bucket (Cloudflare R2) when S3_BUCKET is set. Keys
 * are `uploads/<file>`, `avatars/<file>`, `dm/<file>` and `previews/<file>`; callers never build
 * file paths themselves. Every image is re-encoded with sharp (images.ts toWebp) before it's put.
 */

export type StoredObject = {
	body: ReadableStream<Uint8Array<ArrayBuffer>> | Uint8Array<ArrayBuffer>;
	size: number;
};

type Driver = {
	put(key: string, data: Uint8Array, contentType: string): Promise<void>;
	get(key: string): Promise<StoredObject | null>;
	head(key: string): Promise<{ size: number } | null>;
	remove(keys: string[]): Promise<void>;
};

// one level below a known prefix, file name characters only: keys can't escape their directory
const KEY_RE = /^(uploads|avatars|dm|previews)\/([A-Za-z0-9_-][A-Za-z0-9._-]*)$/;

function checkKey(key: string) {
	const match = KEY_RE.exec(key);
	if (!match) throw new Error(`invalid storage key: ${key}`);
	return { prefix: match[1], file: match[2] };
}

// dm/ is kept outside static/: the vite dev server serves static/ as-is, which would make private
// files public in development
const FS_DIRS: Record<string, string> = {
	uploads: 'static/uploads',
	avatars: 'static/avatars',
	dm: 'data/dm',
	// link preview images (src/lib/server/previewImages.ts), public but served by their own route
	previews: 'data/previews'
};

const fsPath = (key: string) => {
	const { prefix, file } = checkKey(key);
	return path.join(FS_DIRS[prefix], file);
};

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

const fsDriver: Driver = {
	async put(key, data) {
		const file = fsPath(key);
		await fs.promises.mkdir(path.dirname(file), { recursive: true });
		await fs.promises.writeFile(file, data);
	},
	async get(key) {
		try {
			// files are at most a few MB (images are scaled down before they're stored)
			const body: Uint8Array<ArrayBuffer> = await fs.promises.readFile(fsPath(key));
			return { body, size: body.byteLength };
		} catch (e) {
			if (isMissing(e)) return null;
			throw e;
		}
	},
	async head(key) {
		try {
			const stat = await fs.promises.stat(fsPath(key));
			return stat.isFile() ? { size: stat.size } : null;
		} catch (e) {
			if (isMissing(e)) return null;
			throw e;
		}
	},
	async remove(keys) {
		await Promise.all(keys.map((key) => fs.promises.rm(fsPath(key), { force: true })));
	}
};

/**
 * Path-style requests (`<endpoint>/<bucket>/<key>`) signed with aws4fetch, which only needs
 * fetch and WebCrypto, so it runs under Node (vite dev) and Bun (the production build) alike.
 */
export function s3Driver(config: {
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	fetch?: typeof fetch;
}): Driver {
	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: 's3',
		region: config.region,
		retries: 2
	});
	const base = `${config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}`;
	const url = (key: string) => {
		const { prefix, file } = checkKey(key);
		return `${base}/${prefix}/${encodeURIComponent(file)}`;
	};
	const send = async (key: string, init: RequestInit) => {
		const request = await client.sign(url(key), init);
		return (config.fetch ?? fetch)(request);
	};
	const failed = async (res: Response, what: string, key: string) => {
		const text = await res.text().catch(() => '');
		return new Error(`storage ${what} ${key} failed: ${res.status} ${text.slice(0, 300)}`);
	};

	return {
		async put(key, data, contentType) {
			const res = await send(key, {
				method: 'PUT',
				// a Buffer's type allows a SharedArrayBuffer, which fetch doesn't take; ours never are
				body: data as Uint8Array<ArrayBuffer>,
				headers: { 'Content-Type': contentType, 'Content-Length': String(data.byteLength) }
			});
			if (!res.ok) throw await failed(res, 'put', key);
			await res.body?.cancel();
		},
		async get(key) {
			const res = await send(key, { method: 'GET' });
			if (res.status === 404) {
				await res.body?.cancel();
				return null;
			}
			if (!res.ok || !res.body) throw await failed(res, 'get', key);
			return { body: res.body, size: Number(res.headers.get('Content-Length') ?? 0) };
		},
		async head(key) {
			const res = await send(key, { method: 'HEAD' });
			if (res.status === 404) return null;
			if (!res.ok) throw await failed(res, 'head', key);
			return { size: Number(res.headers.get('Content-Length') ?? 0) };
		},
		async remove(keys) {
			// DeleteObject answers 204 whether or not the key existed
			const results = await Promise.allSettled(
				keys.map(async (key) => {
					const res = await send(key, { method: 'DELETE' });
					if (!res.ok && res.status !== 404) throw await failed(res, 'delete', key);
					await res.body?.cancel();
				})
			);
			const error = results.find((r) => r.status === 'rejected');
			if (error) throw error.reason;
		}
	};
}

/**
 * Temporary, until the files on disk are migrated to the bucket: reads that miss the bucket try the
 * local files, so the app can run against the bucket before the old files are uploaded. Removes
 * also delete the local copy, otherwise a deleted image would still be served from disk.
 */
function withFsFallback(bucket: Driver): Driver {
	return {
		put: bucket.put,
		async get(key) {
			return (await bucket.get(key)) ?? fsDriver.get(key);
		},
		async head(key) {
			return (await bucket.head(key)) ?? fsDriver.head(key);
		},
		async remove(keys) {
			await Promise.all([bucket.remove(keys), fsDriver.remove(keys)]);
		}
	};
}

const missingConfig = S3_BUCKET
	? Object.entries({ S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY })
			.filter(([, value]) => !value)
			.map(([name]) => name)
	: [];

/**
 * Throws when S3_BUCKET is set without its endpoint or keys, so a half-configured bucket stops the
 * app at startup (the init hook) instead of failing on the first upload.
 */
export function checkStorageConfig() {
	if (missingConfig.length) {
		throw new Error(`S3_BUCKET is set without ${missingConfig.join(', ')}`);
	}
}

const driver: Driver = S3_BUCKET
	? withFsFallback(
			s3Driver({
				endpoint: S3_ENDPOINT,
				bucket: S3_BUCKET,
				region: S3_REGION,
				accessKeyId: S3_ACCESS_KEY_ID,
				secretAccessKey: S3_SECRET_ACCESS_KEY
			})
	  )
	: fsDriver;

/** Stores `data` under `key`, replacing what was there. */
export const put = (key: string, data: Uint8Array, contentType: string) =>
	driver.put(key, data, contentType);

/** The object under `key`, null when it doesn't exist. */
export const get = (key: string) => driver.get(key);

/** The size of the object under `key`, null when it doesn't exist. */
export const head = (key: string) => driver.head(key);

/** Deletes objects; keys that don't exist are fine. */
export const remove = (keys: string[]) => (keys.length ? driver.remove(keys) : Promise.resolve());
