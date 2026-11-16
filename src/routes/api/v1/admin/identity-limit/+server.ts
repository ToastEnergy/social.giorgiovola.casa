import type { RequestHandler } from './$types';
import { readJson, requireAdmin, requireStaff, v1 } from '#lib/server/api.js';
import { identityLimitSettings, updateGlobalIdentityLimit } from '#lib/server/admin.js';
import { limitField } from '#lib/server/identityLimit.js';

/** Staff: how many identities accounts without their own limit may own. */
export const GET: RequestHandler = v1(({ locals }) => {
	requireStaff(locals);
	return identityLimitSettings(locals);
});

/** Admins: sets it: `{ max_identities }` (0–100), null goes back to the default. */
export const PUT: RequestHandler = v1(async ({ locals, request }) => {
	requireAdmin(locals);
	return updateGlobalIdentityLimit(locals, limitField(await readJson(request), 'max_identities'));
});
