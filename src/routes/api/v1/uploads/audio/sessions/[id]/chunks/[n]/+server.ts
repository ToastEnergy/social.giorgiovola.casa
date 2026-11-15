import type { RequestHandler } from './$types';
import { fail, requireUnmuted, v1 } from '#lib/server/api.js';
import { countAudioChunk } from '#lib/server/audioUploads.js';
import { MAX_CHUNK_BYTES, putAudioChunk } from '#lib/server/stagedAudio.js';
import { readUploadBody } from '#lib/server/uploadInput.js';

/** Stores chunk `n` (from 0) of a session: its raw bytes. Sending a chunk again replaces it. */
export const PUT: RequestHandler = v1(async ({ locals, params, request }) => {
	const user = requireUnmuted(locals);
	countAudioChunk(locals, user.id);
	if (!/^\d{1,4}$/.test(params.n)) fail(400, 'The chunk number must be a whole number');
	const data = await readUploadBody(request, MAX_CHUNK_BYTES, ['chunk'], 'chunk');
	return putAudioChunk(user.id, params.id, Number(params.n), data);
});
