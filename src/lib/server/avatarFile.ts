import * as storage from './storage.js';

const types: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif'
};

const FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** An uploaded avatar (a file name under avatars/ in storage) and its type, or null. */
export async function readAvatarFile(file: string) {
	const type = types[file.split('.').pop()?.toLowerCase() ?? ''];
	if (!type || !FILE_RE.test(file)) return null;
	const object = await storage.get(`avatars/${file}`);
	return object ? { body: object.body, type } : null;
}

/** The file name of a user's `avatar` (`/avatars/12.webp?hash=…`), null for the generated one. */
export function avatarFileOf(avatar: string | null) {
	return avatar ? /^\/avatars\/([^/?#]+)/.exec(avatar)?.[1] ?? null : null;
}
