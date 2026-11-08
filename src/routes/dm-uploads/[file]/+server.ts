import type { RequestHandler } from './$types';
import { uploadType } from '#lib/server/images.js';
import { messageImageAccess, notFound, serveUpload } from '#lib/server/messageImages.js';

// message images: only for the conversation they were sent in (cookie or bearer token). Someone
// else gets the same 404 as for a missing file, so the URL doesn't tell whether it exists
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!uploadType(params.file)) return notFound();
	if ((await messageImageAccess(locals, params.file)) !== 'allowed') return notFound();
	return serveUpload(params.file, 'private');
};
