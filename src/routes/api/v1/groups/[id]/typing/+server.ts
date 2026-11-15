import type { RequestHandler } from './$types';
import { readJson, requireUser, v1 } from '#lib/server/api.js';
import { readTypingAction, typingInGroup } from '#lib/server/chat.js';
import { parseId } from '#lib/server/validation.js';

/** Shows a typing (or `{ "action": "recording" }`) indicator to the group's members. */
export const POST: RequestHandler = v1(async ({ locals, params, request }) =>
	typingInGroup(
		locals,
		requireUser(locals),
		parseId(params.id),
		readTypingAction(await readJson(request))
	)
);
