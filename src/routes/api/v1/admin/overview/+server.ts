import type { RequestHandler } from './$types';
import { requireStaff, v1 } from '#lib/server/api.js';
import { overview } from '#lib/server/admin.js';

/** Staff: counts for the top of the moderation panel. */
export const GET: RequestHandler = v1(({ locals }) => {
	requireStaff(locals);
	return overview();
});
