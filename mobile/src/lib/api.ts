import type { Page } from './types';

// which instance and token requests use. set by the session (src/lib/session.tsx)
export const auth: { server: string; token: string | null } = { server: '', token: null };

/** called when a request made with the current token answers 401: the token is gone */
let onUnauthorized: ((token: string) => void) | null = null;
export const setUnauthorizedHandler = (fn: typeof onUnauthorized) => (onUnauthorized = fn);

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;
	constructor(status: number, message: string, body: Record<string, unknown> = {}) {
		super(message);
		this.status = status;
		this.body = body;
	}
}

type Options = {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	/** sent as JSON */
	body?: unknown;
	/** a raw body (an image) with its content type, instead of `body` */
	raw?: { data: Blob; type: string };
	/** another instance or token than the current ones (signing in, other accounts) */
	server?: string;
	token?: string | null;
	signal?: AbortSignal;
};

/** Calls /api/v1/<path>. Throws ApiError with the server's message. */
export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
	const server = options.server ?? auth.server;
	const token = options.token === undefined ? auth.token : options.token;
	const method = options.method ?? 'GET';
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	// every write needs a Content-Type, even without a body
	if (method !== 'GET') headers['Content-Type'] = options.raw?.type ?? 'application/json';
	let res: Response;
	// a server that never answers shouldn't leave a spinner forever (uploads get longer)
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.raw ? 120_000 : 30_000);
	options.signal?.addEventListener('abort', () => controller.abort());
	try {
		res = await fetch(`${server}/api/v1/${path}`, {
			method,
			headers,
			body: options.raw
				? options.raw.data
				: method === 'GET'
				? undefined
				: JSON.stringify(options.body ?? {}),
			signal: controller.signal
		});
	} catch (e) {
		// aborted by the caller: its own business. by the timeout: the server is unreachable
		if ((e as Error).name === 'AbortError' && options.signal?.aborted) throw e;
		throw new ApiError(0, 'Could not reach the server.');
	} finally {
		clearTimeout(timeout);
	}
	if (res.status === 204) return undefined as T;
	const text = await res.text();
	let data: unknown = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		// the plain-text 403 that comes before the API, or a proxy's error page
	}
	if (!res.ok) {
		if (res.status === 401 && token && token === auth.token) onUnauthorized?.(token);
		const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
		const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status}).`;
		throw new ApiError(res.status, message, body);
	}
	return data as T;
}

/** Adds query parameters to a path, skipping empty ones. */
export function withQuery(
	path: string,
	params: Record<string, string | number | null | undefined>
) {
	const query = Object.entries(params)
		.filter(([, v]) => v !== null && v !== undefined && v !== '')
		.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
		.join('&');
	return query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path;
}

export const getPage = <T>(path: string, cursor?: string | null, limit?: number) =>
	api<Page<T>>(withQuery(path, { cursor, limit }));

export const errorMessage = (e: unknown) =>
	e instanceof Error ? e.message : 'Something went wrong.';

/**
 * Uploads a picked image (POST /uploads, raw bytes) and answers its upload id. Through
 * XMLHttpRequest rather than fetch, which can't report how much of the body went out.
 */
export async function uploadImage(
	image: { uri: string; mimeType?: string | null },
	options: {
		/** share uploaded, 0 to 1 */
		onProgress?: (share: number) => void;
		server?: string;
		token?: string | null;
	} = {}
) {
	let data: Blob;
	try {
		data = await (await fetch(image.uri)).blob();
	} catch {
		throw new ApiError(0, 'The image is no longer on this device.');
	}
	const server = options.server ?? auth.server;
	const token = options.token === undefined ? auth.token : options.token;
	return new Promise<string>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${server}/api/v1/uploads`);
		xhr.setRequestHeader('Accept', 'application/json');
		xhr.setRequestHeader('Content-Type', image.mimeType || data.type || 'image/jpeg');
		if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
		xhr.timeout = 120_000;
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable && e.total > 0) options.onProgress?.(e.loaded / e.total);
		};
		xhr.onload = () => {
			let body: Record<string, unknown> = {};
			try {
				body = JSON.parse(xhr.responseText) ?? {};
			} catch {
				// a proxy's error page
			}
			if (xhr.status >= 200 && xhr.status < 300 && typeof body.id === 'string')
				return resolve(body.id);
			if (xhr.status === 401 && token && token === auth.token) onUnauthorized?.(token);
			const message =
				typeof body.error === 'string' ? body.error : `Request failed (${xhr.status}).`;
			reject(new ApiError(xhr.status, message, body));
		};
		xhr.onerror = xhr.ontimeout = () => reject(new ApiError(0, 'Could not reach the server.'));
		xhr.send(data);
	});
}

/** The body of PUT /me/avatar and the like: the raw image. */
export async function imageBody(image: { uri: string; mimeType?: string | null }) {
	const data = await (await fetch(image.uri)).blob();
	return { data, type: image.mimeType || data.type || 'image/jpeg' };
}

/** A path on the instance (an upload, an avatar) as a full URL. */
export const assetUrl = (path: string) => (/^https?:\/\//.test(path) ? path : auth.server + path);

export const avatarUrl = (user: { username: string; avatar: string | null }, size = 96) =>
	user.avatar ? assetUrl(user.avatar) : `${auth.server}/avatar/${user.username}.png?size=${size}`;

/**
 * An image of the instance (an upload, an avatar, a link preview) with the token: message images
 * need it, and on a members-only instance every image does. Never sent to another host.
 */
export function instanceImage(path: string) {
	const uri = assetUrl(path);
	const ours = uri.startsWith(`${auth.server}/`);
	return {
		uri,
		headers: auth.token && ours ? { Authorization: `Bearer ${auth.token}` } : undefined
	};
}

export const avatarImage = (user: { username: string; avatar: string | null }, size = 96) =>
	instanceImage(avatarUrl(user, size));
