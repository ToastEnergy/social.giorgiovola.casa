import type { RequestHandler } from './$types';
import { fail, rateLimit, requireUser, usernameParam, v1 } from '#lib/server/api.js';
import { playedDirect } from '#lib/server/chat.js';
import { parseId } from '#lib/server/validation.js';

// once per voice note listened to, with room for retries
const MAX_PLAYED = 120;

/** Marks the voice note of a message you received as played. Idempotent. */
export const POST: RequestHandler = v1(({ locals, params }) => {
	const user = requireUser(locals);
	rateLimit(`played:${user.id}`, MAX_PLAYED);
	return playedDirect(
		user,
		usernameParam(params.username),
		parseId(params.id) ?? fail(404, 'Voice note not found')
	);
});
