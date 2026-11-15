import type { RequestHandler } from './$types';
import { keysetCursor, keysetPage, limitParam, requireUser, v1 } from '#lib/server/api.js';
import { listNotificationGroups } from '#lib/server/notifications.js';

/** Your notifications grouped (likes, regiorgs and follows per day), newest first. */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	const user = requireUser(locals);
	const limit = limitParam(url, 50, 200);
	const { after, offset } = keysetCursor(url);
	return keysetPage(await listNotificationGroups(user.id, limit, after, offset), limit);
});
