import type { RequestHandler } from './$types';
import { uploadType } from '#lib/server/images.js';
import * as storage from '#lib/server/storage.js';

// like avatars, uploads are written at runtime so adapter-node's static handler can't serve them.
// File names are random uuids, so responses are immutable.
export const GET: RequestHandler = async ({ params }) => {
	const type = uploadType(params.file);
	if (!type) return new Response('Not found', { status: 404 });

	const object = await storage.get(`uploads/${params.file}`);
	if (!object) return new Response('Not found', { status: 404 });
	return new Response(object.body, {
		headers: {
			'Content-Type': type,
			'Content-Length': object.size.toString(),
			'Cache-Control': 'public, max-age=31536000, immutable',
			// an SVG opened on its own would otherwise run its scripts on our origin
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
		}
	});
};
