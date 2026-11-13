import type { RequestHandler } from './$types';
import {
	created,
	idCursor,
	limitParam,
	rateLimit,
	readJson,
	requireAccount,
	stringField,
	v1
} from '#lib/server/api.js';
import { balanceOf, createInvite, listMyInvites } from '#lib/server/invites.js';

/** The account's invites: how many it holds and can still give, and the codes it made. */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	const { accountId } = requireAccount(locals);
	const limit = limitParam(url, 50, 100);
	const rows = await listMyInvites(accountId, idCursor(url), limit);
	return {
		...(await balanceOf(accountId)),
		items: rows.slice(0, limit),
		next_cursor: rows.length > limit ? String(rows[limit - 1].id) : null
	};
});

/** Turns one of the account's invites into a code: `{ note? }`. */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	const { accountId } = requireAccount(locals);
	rateLimit(`invites:${accountId}`, 20, 60 * 60_000, 'Too many invites created');
	const invite = await createInvite(accountId, stringField(await readJson(request), 'note'));
	return created({ ...invite, balance: await balanceOf(accountId) });
});
