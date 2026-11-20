import type { RequestHandler } from './$types';
import { requireUser, v1 } from '#lib/server/api.js';
import { inboxProfileIds } from '#lib/server/accountProfiles.js';
import { unreadCounts, unreadCountsOf } from '#lib/server/notifications.js';

/**
 * `{ notifications, messages, reactions }` of the profile in use: unread notifications, messages
 * (muted chats left out) and reactions to its messages. With `?profiles=` also `total` and
 * `profiles` (the same three counts of each).
 */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	const user = requireUser(locals);
	const profiles = await inboxProfileIds(locals, url);
	return profiles ? unreadCountsOf(user.id, profiles) : unreadCounts(user.id);
});
