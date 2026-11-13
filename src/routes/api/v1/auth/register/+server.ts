import type { RequestHandler } from './$types';
import { created, readJson, stringField, v1 } from '#lib/server/api.js';
import { registerAccount, startSession } from '#lib/server/login.js';
import { getMe } from '#lib/server/me.js';

/**
 * Creates an account and signs it in: `{ invite_code, email, name, username, password,
 * session?, client_name? }`. Answers like POST /auth/login, with 201. `signup_password` is the old
 * name of `invite_code`, still accepted for clients made before invites.
 */
export const POST: RequestHandler = v1(async (event) => {
	const body = await readJson(event.request);
	const accountId = await registerAccount(
		{
			inviteCode: stringField(body, 'invite_code') || stringField(body, 'signup_password'),
			email: stringField(body, 'email'),
			name: stringField(body, 'name'),
			username: stringField(body, 'username'),
			password: stringField(body, 'password')
		},
		event.getClientAddress
	);
	const session = await startSession(event, accountId, body.session, body.client_name);
	return created({ ...session, me: await getMe(accountId) });
});
