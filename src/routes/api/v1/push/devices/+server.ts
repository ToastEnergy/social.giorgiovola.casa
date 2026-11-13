import type { RequestHandler } from './$types';
import { fail, rateLimit, readJson, requireUser, stringField, v1 } from '#lib/server/api.js';
import { registerPushDevice, unregisterPushDevice } from '#lib/server/push.js';

/** A device hangs off the session or token in use, like a web push subscription (bots get none). */
function sessionKey(locals: App.Locals) {
	requireUser(locals);
	if (!locals.sessionKey) fail(403, "Bots can't subscribe to push notifications");
	return locals.sessionKey;
}

/**
 * Registers a phone of the mobile app for push notifications: `{ platform: "android", token }`,
 * the FCM registration token. Logging out of the session or token stops it.
 */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	const key = sessionKey(locals);
	rateLimit(`push-devices:${key}`, 20, 60_000, 'Registering too often');
	if (!(await registerPushDevice(key, await readJson(request)))) fail(400, 'Invalid push device');
});

/** Unregisters a phone: `{ token }`. */
export const DELETE: RequestHandler = v1(async ({ locals, request }) => {
	const key = sessionKey(locals);
	const token = stringField(await readJson(request), 'token');
	if (!token) fail(400, 'Missing token');
	await unregisterPushDevice(key, token);
});
