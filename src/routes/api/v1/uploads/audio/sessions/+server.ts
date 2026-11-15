import type { RequestHandler } from './$types';
import { created, requireUnmuted, v1 } from '#lib/server/api.js';
import { openAudioSession } from '#lib/server/stagedAudio.js';
import { countUpload } from '#lib/server/uploadInput.js';

/**
 * Opens a chunked voice note upload, for long recordings: PUT its chunks while recording, then
 * complete it. Its id is the voice note's.
 */
export const POST: RequestHandler = v1(async ({ locals }) => {
	const user = requireUnmuted(locals);
	countUpload(locals, user.id);
	return created(await openAudioSession(user.id));
});
