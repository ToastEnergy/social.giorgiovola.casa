import type { RequestHandler } from './$types';
import { requireAdmin, v1 } from '#lib/server/api.js';
import { inviteSummary } from '#lib/server/invites.js';

/** Admins: how many invites accounts hold and can still give, codes out and used, per account. */
export const GET: RequestHandler = v1(async ({ locals }) => {
	requireAdmin(locals);
	return inviteSummary();
});
