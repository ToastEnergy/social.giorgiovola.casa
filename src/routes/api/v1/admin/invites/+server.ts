import type { RequestHandler } from './$types';
import {
	created,
	fail,
	idCursor,
	limitParam,
	readJson,
	requireAdmin,
	stringField,
	v1
} from '#lib/server/api.js';
import {
	INVITE_FILTERS,
	MAX_BATCH,
	countField,
	createStaffInvites,
	daysField,
	listInvites,
	type InviteFilter
} from '#lib/server/invites.js';

/** Admins: every invite code, newest first: `?status=` (pending, used…) and `?username=`. */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	requireAdmin(locals);
	const status = url.searchParams.get('status') || 'all';
	if (!INVITE_FILTERS.includes(status as InviteFilter))
		fail(400, `status must be one of ${INVITE_FILTERS.join(', ')}`);
	const limit = limitParam(url, 50, 100);
	const rows = await listInvites({
		status: status as InviteFilter,
		username: (url.searchParams.get('username') ?? '').replace(/^@/, '').trim().toLowerCase(),
		cursor: idCursor(url),
		limit
	});
	return {
		items: rows.slice(0, limit),
		next_cursor: rows.length > limit ? String(rows[limit - 1].id) : null
	};
});

/** Admins: codes outside any account's invites: `{ note?, count? (1–50), days? (null: never) }`. */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	requireAdmin(locals);
	const body = await readJson(request);
	return created(
		await createStaffInvites(locals, {
			note: stringField(body, 'note'),
			count: body.count === undefined ? 1 : countField(body, 'count', 1, MAX_BATCH),
			days: daysField(body)
		})
	);
});
