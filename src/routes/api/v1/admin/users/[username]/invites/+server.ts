import type { RequestHandler } from './$types';
import { readJson, requireAdmin, usernameParam, v1 } from '#lib/server/api.js';
import { MAX_BALANCE, countField, setInvites } from '#lib/server/invites.js';

/** Admins: sets how many invites an account holds: `{ invites }` (0–1000). */
export const PUT: RequestHandler = v1(async ({ locals, params, request }) => {
	requireAdmin(locals);
	const count = countField(await readJson(request), 'invites', 0, MAX_BALANCE);
	return setInvites(locals, usernameParam(params.username), count);
});
