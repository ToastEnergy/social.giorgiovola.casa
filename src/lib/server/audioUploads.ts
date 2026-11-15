import { rateLimit } from './api.js';

/** Rate limits of voice note uploads, on top of countUpload (uploadInput.ts). Per account. */

// transcoding is the expensive part: whole uploads and completed sessions
const MAX_PROCESSED = 20;
// a chunk every few seconds while recording, retries included
const MAX_CHUNKS = 120;

const owner = (locals: App.Locals, userId: number) => locals.accountId ?? userId;

/** Counts a recording about to be processed (a whole upload or a completed session). */
export function countAudioProcessing(locals: App.Locals, userId: number) {
	rateLimit(
		`audio:${owner(locals, userId)}`,
		MAX_PROCESSED,
		60_000,
		'You are uploading voice notes too fast'
	);
}

/** Counts a chunk of a voice note session. */
export function countAudioChunk(locals: App.Locals, userId: number) {
	rateLimit(`audio-chunks:${owner(locals, userId)}`, MAX_CHUNKS, 60_000, 'Uploading too fast');
}
