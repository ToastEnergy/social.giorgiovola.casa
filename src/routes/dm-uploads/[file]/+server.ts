import type { RequestHandler } from './$types';
import { uploadResponse } from '#lib/server/messageImages.js';

// message images: only for the conversation they were sent in (cookie or bearer token). Someone
// else gets the same 404 as for a missing file, so the URL doesn't tell whether it exists
export const GET: RequestHandler = ({ locals, params }) =>
	uploadResponse(locals, params.file, 'dm-uploads');
