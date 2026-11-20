import type { RequestHandler } from './$types';
import { keysetCursor, keysetPage, limitParam, requireUser, v1 } from '#lib/server/api.js';
import { inboxProfileIds } from '#lib/server/accountProfiles.js';
import { listNotificationGroups, listNotificationGroupsOf } from '#lib/server/notifications.js';

/**
 * Your notifications grouped (likes, regiorgs and follows per day), newest first. With
 * `?profiles=all` (or a list of usernames) the inbox of the whole account, see
 * listNotificationGroupsOf.
 */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	const user = requireUser(locals);
	const limit = limitParam(url, 50, 200);
	const { after, offset } = keysetCursor(url);
	const profiles = await inboxProfileIds(locals, url);
	if (profiles)
		return keysetPage(
			await listNotificationGroupsOf(profiles, user.id, limit, after, offset),
			limit
		);
	return keysetPage(await listNotificationGroups(user.id, limit, after, offset), limit);
});
