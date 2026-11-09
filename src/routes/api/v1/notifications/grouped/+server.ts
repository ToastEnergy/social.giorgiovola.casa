import type { RequestHandler } from './$types';
import { offsetPage, offsetParams, requireUser, v1 } from '#lib/server/api.js';
import { listNotificationGroups } from '#lib/server/notifications.js';

/** Your notifications grouped (likes, regiorgs and follows per day), newest first. */
export const GET: RequestHandler = v1(async ({ locals, url }) => {
	const user = requireUser(locals);
	const { limit, offset } = offsetParams(url, 50, 200);
	return offsetPage(await listNotificationGroups(user.id, limit, offset), limit, offset);
});
