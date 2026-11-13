import type { RequestHandler } from './$types';
import { fail, requireAdmin, v1 } from '#lib/server/api.js';
import { revokeInvite } from '#lib/server/invites.js';

/** Admins: revokes any pending code. One from an account's invites goes back to it. */
export const DELETE: RequestHandler = v1(async ({ locals, params }) => {
	requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1 || id > 2147483647) fail(404, 'Invite not found.');
	return revokeInvite(id, null);
});
