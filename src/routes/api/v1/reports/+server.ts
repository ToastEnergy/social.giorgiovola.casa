import type { RequestHandler } from './$types';
import { created, readJson, requireUser, v1 } from '#lib/server/api.js';
import { createReport } from '#lib/server/reports.js';

/**
 * Reports a post (`{ post_id, category, details? }`) or a profile (`{ username, category,
 * details? }`) to the staff. Bots can't report.
 */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	requireUser(locals);
	return created(await createReport(locals, await readJson(request)));
});
