import type { RequestHandler } from './$types';
import * as storage from '#lib/server/storage.js';

// adapter-node only serves files that existed at build time, so avatars uploaded at runtime
// (in the storage module, static/avatars on local disk) have to be served by a route.
const types: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif'
};

const FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export const GET: RequestHandler = async ({ params }) => {
	const file = params.file;
	const ext = file.split('.').pop()?.toLowerCase() ?? '';
	const type = types[ext];
	if (!type || !FILE_RE.test(file)) return new Response('Not found', { status: 404 });

	const object = await storage.get(`avatars/${file}`);
	if (!object) return new Response('Not found', { status: 404 });
	return new Response(object.body, {
		headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000' }
	});
};
