import type { RequestHandler } from './$types';
import { requireUser, v1 } from '#lib/server/api.js';
import { inboxProfileIds } from '#lib/server/accountProfiles.js';
import { markAllNotificationsRead, markAllNotificationsReadOf } from '#lib/server/notifications.js';

/** Marks every notification read: the profile in use's, or with `?profiles=` those of them. */
export const POST: RequestHandler = v1(async ({ locals, url }) => {
	const user = requireUser(locals);
	const profiles = await inboxProfileIds(locals, url);
	if (profiles) await markAllNotificationsReadOf(profiles);
	else await markAllNotificationsRead(user.id);
});
