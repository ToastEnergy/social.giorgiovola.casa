import type { RequestHandler } from './$types';
import { requireStaff, usernameParam, v1 } from '#lib/server/api.js';
import { getAccount } from '#lib/server/admin.js';

/**
 * Staff: the account behind a profile (an identity answers its owner), with its moderation state,
 * identities, counts and what you may do to it.
 */
export const GET: RequestHandler = v1(({ locals, params }) => {
	requireStaff(locals);
	return getAccount(locals, usernameParam(params.username));
});
