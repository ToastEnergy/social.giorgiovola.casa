import type { RequestHandler } from './$types';
import { readJson, requireStaff, usernameParam, v1 } from '#lib/server/api.js';
import { setIdentityLimit } from '#lib/server/admin.js';
import { limitField } from '#lib/server/identityLimit.js';

/**
 * Staff: sets how many identities the account behind a profile may own: `{ max_identities }`
 * (0–100), null to follow the instance's limit again. Mods only on accounts they can moderate.
 */
export const PUT: RequestHandler = v1(async ({ locals, params, request }) => {
	requireStaff(locals);
	const limit = limitField(await readJson(request), 'max_identities');
	return setIdentityLimit(locals, usernameParam(params.username), limit);
});
