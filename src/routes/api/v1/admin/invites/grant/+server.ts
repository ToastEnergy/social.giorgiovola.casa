import type { RequestHandler } from './$types';
import { readJson, requireAdmin, v1 } from '#lib/server/api.js';
import { MAX_GRANT, countField, grantEveryone } from '#lib/server/invites.js';

/** Admins: gives every account that isn't banned `{ count }` (1–100) more invites. */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	requireAdmin(locals);
	return grantEveryone(locals, countField(await readJson(request), 'count', 1, MAX_GRANT));
});
