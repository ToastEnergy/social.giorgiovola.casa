import type { RequestHandler } from './$types';
import { created, refuseBots, requireUnmuted, v1 } from '#lib/server/api.js';
import { stageImage } from '#lib/server/stagedUploads.js';
import { countUpload, readImageBody } from '#lib/server/uploadInput.js';
import { LIMITS } from '#lib/server/validation.js';

/**
 * Uploads one image for a post or message being written: the raw bytes as the body (any image
 * Content-Type), or multipart with an `image` file for browsers. It is compressed now, so sending
 * only attaches it. Answers `{ id }`, to pass in `uploads`. Unused uploads expire after a day.
 */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	refuseBots(locals, "Bots can't attach images");
	const user = requireUnmuted(locals);
	countUpload(locals, user.id);
	const image = await readImageBody(request, LIMITS.imageBytes, ['image']);
	const id = await stageImage(user.id, new File([new Uint8Array(image)], 'upload'));
	if (id instanceof Response) return id;
	return created({ id });
});
