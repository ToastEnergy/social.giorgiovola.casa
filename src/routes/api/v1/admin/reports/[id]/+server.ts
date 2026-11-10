import type { RequestHandler } from './$types';
import { fail, readJson, requireStaff, v1 } from '#lib/server/api.js';
import { setReportStatus } from '#lib/server/reports.js';
import { parseId } from '#lib/server/validation.js';

/**
 * Staff: `{ status: "resolved" | "dismissed" | "open", note?, related? }`. `related: true` also
 * closes the other open reports of the same post or profile.
 */
export const PATCH: RequestHandler = v1(async ({ locals, params, request }) => {
	requireStaff(locals);
	const id = parseId(params.id) ?? fail(404, 'Report not found');
	return setReportStatus(locals, id, await readJson(request));
});
