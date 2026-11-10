import type { RequestHandler } from './$types';
import { fail, idCursor, limitParam, requireStaff, usernameParam, v1 } from '#lib/server/api.js';
import { LOG_ACTIONS, listLog } from '#lib/server/admin.js';
import type { LogAction } from '#lib/server/moderation.js';

/**
 * Staff: the moderation log, newest first. `?username=` keeps one account's entries (an identity
 * finds its owner), `?actor=` one staff member's, `?action=` one kind of entry.
 */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	requireStaff(locals);
	const param = (name: string) =>
		usernameParam((url.searchParams.get(name) ?? '').trim()).slice(0, 64);
	const action = url.searchParams.get('action') ?? '';
	if (action && !LOG_ACTIONS.includes(action as LogAction))
		fail(400, `action must be one of ${LOG_ACTIONS.join(', ')}`);
	const limit = limitParam(url, 30, 100);
	const rows = await listLog({
		username: param('username'),
		actor: param('actor'),
		action,
		cursor: idCursor(url),
		limit
	});
	const items = rows.slice(0, limit);
	return {
		items,
		next_cursor: rows.length > limit ? String(items[items.length - 1].id) : null
	};
});
