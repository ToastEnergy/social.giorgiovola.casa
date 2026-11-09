import type { RequestHandler } from './$types';
import { fail, requireUser, v1 } from '#lib/server/api.js';
import { GROUP_KEY, markNotificationGroupRead } from '#lib/server/notifications.js';

/** Marks every notification of a group (GET /notifications/grouped) read. */
export const POST: RequestHandler = v1(async ({ locals, params }) => {
	const user = requireUser(locals);
	if (!GROUP_KEY.test(params.key)) fail(404, 'Notification not found');
	if (!(await markNotificationGroupRead(user.id, params.key))) fail(404, 'Notification not found');
});
