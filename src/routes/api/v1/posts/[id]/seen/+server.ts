import type { RequestHandler } from './$types';
import { fail, requireUser, v1 } from '#lib/server/api.js';
import { requestProfileIds } from '#lib/server/accountProfiles.js';
import { markSeen } from '#lib/server/notifications.js';
import { parseId } from '#lib/server/validation.js';

/**
 * The post was on your screen: the unread mention, reply, quote and ratio notifications about
 * it, for every profile your account can use, are now read.
 */
export const POST: RequestHandler = v1(async ({ locals, params }) => {
	requireUser(locals);
	const id = parseId(params.id) ?? fail(404, 'Post not found');
	await markSeen(await requestProfileIds(locals), { posts: [id] });
});
