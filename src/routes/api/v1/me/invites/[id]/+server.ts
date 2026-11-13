import type { RequestHandler } from './$types';
import { fail, requireAccount, v1 } from '#lib/server/api.js';
import { revokeInvite } from '#lib/server/invites.js';

/** Revokes one of the account's pending codes; the invite goes back to it. */
export const DELETE: RequestHandler = v1(async ({ locals, params }) => {
	const { accountId } = requireAccount(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1 || id > 2147483647) fail(404, 'Invite not found.');
	return revokeInvite(id, accountId);
});
