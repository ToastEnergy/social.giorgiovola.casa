import type { RequestHandler } from './$types';
import { fail, rateLimit, readJson, requireUser, v1 } from '#lib/server/api.js';
import { requestProfileIds } from '#lib/server/accountProfiles.js';
import { markSeen } from '#lib/server/notifications.js';
import { parseId } from '#lib/server/validation.js';

const MAX_IDS = 100;

/** A list of post ids, deduplicated; a 400 for anything else. */
function ids(body: Record<string, unknown>, field: string) {
	const value = body[field];
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_IDS)
		fail(400, `${field} must be a list of at most ${MAX_IDS} post ids`);
	return [
		...new Set(value.map((v) => parseId(v) ?? fail(400, `${field} must only hold post ids`)))
	];
}

function flag(body: Record<string, unknown>, field: string) {
	const value = body[field];
	if (value === undefined) return false;
	if (typeof value !== 'boolean') fail(400, `${field} must be true or false`);
	return value;
}

/** What you have seen: the notifications about it are read, for all your profiles. */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	const user = requireUser(locals);
	// called every few seconds while scrolling: per account, generous
	rateLimit(`seen:${locals.accountId ?? `bot${user.id}`}`, 120);
	const body = await readJson(request);
	const read = await markSeen(await requestProfileIds(locals), {
		posts: ids(body, 'posts'),
		engagement: ids(body, 'engagement'),
		followers: flag(body, 'followers'),
		invites: flag(body, 'invites')
	});
	return { read };
});
