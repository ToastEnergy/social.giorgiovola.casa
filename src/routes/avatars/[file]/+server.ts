import type { RequestHandler } from './$types';
import { readAvatarFile } from '#lib/server/avatarFile.js';

// adapter-node only serves files that existed at build time, so avatars uploaded at runtime
// (in the storage module, static/avatars on local disk) have to be served by a route.
export const GET: RequestHandler = async ({ params }) => {
	const avatar = await readAvatarFile(params.file);
	if (!avatar) return new Response('Not found', { status: 404 });
	return new Response(avatar.body, {
		headers: { 'Content-Type': avatar.type, 'Cache-Control': 'public, max-age=31536000' }
	});
};
