import type { RequestHandler } from './$types';
import { created, requireUnmuted, v1 } from '#lib/server/api.js';
import { MAX_AUDIO_INPUT_BYTES } from '#lib/server/audio.js';
import { countAudioProcessing } from '#lib/server/audioUploads.js';
import { stageAudio } from '#lib/server/stagedAudio.js';
import { countUpload, readUploadBody } from '#lib/server/uploadInput.js';

/**
 * Uploads a whole voice note: the raw bytes as the body (any audio Content-Type), or multipart
 * with an `audio` file for browsers. Bots may too. It is transcoded in the background: answers
 * its id and status (`ready` with the duration and waveform when that took only a moment,
 * `processing` otherwise), to pass as `audio` with a post or message.
 */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	const user = requireUnmuted(locals);
	countUpload(locals, user.id);
	countAudioProcessing(locals, user.id);
	const audio = await readUploadBody(request, MAX_AUDIO_INPUT_BYTES, ['audio'], 'recording');
	return created(await stageAudio(user.id, audio));
});
