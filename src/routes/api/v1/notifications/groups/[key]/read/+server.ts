import type { RequestHandler } from './$types';
import { fail, requireUser, v1 } from '#lib/server/api.js';
import { inboxProfileIds } from '#lib/server/accountProfiles.js';
import {
	GROUP_KEY,
	MULTI_GROUP_KEY,
	markMultiGroupRead,
	markNotificationGroupRead
} from '#lib/server/notifications.js';

/**
 * Marks every notification of a group (GET /notifications/grouped) read. With `?profiles=` the
 * keys are the ones of that mode (`p-<post_id>`, `<user_id>/<key>`).
 */
export const POST: RequestHandler = v1(async ({ locals, params, url }) => {
	const user = requireUser(locals);
	const profiles = await inboxProfileIds(locals, url);
	if (profiles) {
		if (!MULTI_GROUP_KEY.test(params.key) || !(await markMultiGroupRead(profiles, params.key)))
			fail(404, 'Notification not found');
		return;
	}
	if (!GROUP_KEY.test(params.key)) fail(404, 'Notification not found');
	if (!(await markNotificationGroupRead(user.id, params.key))) fail(404, 'Notification not found');
});
