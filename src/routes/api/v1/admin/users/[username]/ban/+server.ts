import type { RequestHandler } from './$types';
import { readJson, requireStaff, stringField, usernameParam, v1 } from '#lib/server/api.js';
import { durationField, ban, unban } from '#lib/server/admin.js';

/** Staff: bans the account behind a profile (`{ reason?, duration? }`, duration in seconds, null for good) and signs it out everywhere. */
export const PUT: RequestHandler = v1(async ({ locals, params, request }) => {
	requireStaff(locals);
	const body = await readJson(request);
	return ban(
		locals,
		usernameParam(params.username),
		stringField(body, 'reason'),
		durationField(body)
	);
});

/** Staff: lifts the ban. */
export const DELETE: RequestHandler = v1(({ locals, params }) => {
	requireStaff(locals);
	return unban(locals, usernameParam(params.username));
});
