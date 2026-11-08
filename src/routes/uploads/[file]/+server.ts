import type { RequestHandler } from './$types';
import { uploadType } from '#lib/server/images.js';
import { messageImageAccess, notFound, serveUpload } from '#lib/server/messageImages.js';

// like avatars, uploads are written at runtime so adapter-node's static handler can't serve them.
// Post images are public and immutable (file names are random uuids). Message images sent before
// they moved to /dm-uploads are served like those, to the conversation only.
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!uploadType(params.file)) return notFound();
	const access = await messageImageAccess(locals, params.file);
	if (access === 'denied') return notFound();
	return serveUpload(params.file, access === 'public' ? 'public' : 'private');
};
