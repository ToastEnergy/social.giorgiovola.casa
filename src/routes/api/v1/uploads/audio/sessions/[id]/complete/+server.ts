import type { RequestHandler } from './$types';
import { fail, readJson, requireUnmuted, v1 } from '#lib/server/api.js';
import { countAudioProcessing } from '#lib/server/audioUploads.js';
import { completeAudioSession } from '#lib/server/stagedAudio.js';

/**
 * Ends a session: `{ chunks }`, how many were sent (0 to chunks - 1). They are joined and
 * transcoded; answers like POST /api/v1/uploads/audio.
 */
export const POST: RequestHandler = v1(async ({ locals, params, request }) => {
	const user = requireUnmuted(locals);
	const { chunks } = await readJson(request);
	if (typeof chunks !== 'number') fail(400, 'chunks must be the number of chunks sent');
	countAudioProcessing(locals, user.id);
	return completeAudioSession(user.id, params.id, chunks);
});
