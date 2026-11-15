import type { RequestHandler } from './$types';
import { readJson, requireUser, usernameParam, v1 } from '#lib/server/api.js';
import { readTypingAction, typingDirect } from '#lib/server/chat.js';

/**
 * Shows a typing indicator to the other side (send every few seconds while writing), or a
 * recording one with `{ "action": "recording" }`.
 */
export const POST: RequestHandler = v1(async ({ locals, params, request }) =>
	typingDirect(
		locals,
		requireUser(locals),
		usernameParam(params.username),
		readTypingAction(await readJson(request))
	)
);
