import type { RequestHandler } from './$types';
import { uploadResponse } from '#lib/server/messageImages.js';

// like avatars, uploads are written at runtime so adapter-node's static handler can't serve them.
// Post images are public and immutable (file names are random uuids). Message images sent before
// they moved to /dm-uploads are served like those, to the conversation only.
export const GET: RequestHandler = ({ locals, params }) =>
	uploadResponse(locals, params.file, 'uploads');
