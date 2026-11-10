import type { RequestHandler } from './$types';
import { fail, idCursor, limitParam, requireStaff, usernameParam, v1 } from '#lib/server/api.js';
import { REPORT_STATUSES, listReports, type ReportStatus } from '#lib/server/reports.js';

/**
 * Staff: reports, newest first. `?status=` is open (the default), resolved, dismissed or all;
 * `?username=` keeps the reports against one account and its identities.
 */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	requireStaff(locals);
	const status = url.searchParams.get('status') || 'open';
	if (status !== 'all' && !REPORT_STATUSES.includes(status as ReportStatus))
		fail(400, `status must be one of ${REPORT_STATUSES.join(', ')} or all`);
	const limit = limitParam(url, 25, 100);
	const rows = await listReports(locals, {
		status: status as ReportStatus | 'all',
		username: usernameParam((url.searchParams.get('username') ?? '').trim()).slice(0, 64),
		cursor: idCursor(url),
		limit
	});
	const items = rows.slice(0, limit);
	return {
		items,
		next_cursor: rows.length > limit ? String(items[items.length - 1].id) : null
	};
});
