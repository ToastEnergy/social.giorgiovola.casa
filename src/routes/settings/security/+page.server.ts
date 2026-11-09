import type { PageServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';
import type { Me } from '#lib/me.js';
import type { Passkey, Session } from '#lib/settings.js';

export const load = (async ({ fetch }) => {
	const [me, passkeys, sessions] = await Promise.all([
		apiGet<Me>(fetch, '/me'),
		apiGet<{ items: Passkey[]; max: number; rp_id: string; user_handle: string }>(
			fetch,
			'/me/passkeys'
		),
		apiGet<{ items: Session[] }>(fetch, '/auth/sessions')
	]);
	return {
		account: me.account?.username ?? me.user.username,
		email: me.user.email,
		identity: me.user.identity,
		passkeys: passkeys.items,
		maxPasskeys: passkeys.max,
		rpID: passkeys.rp_id,
		userHandle: passkeys.user_handle,
		sessions: sessions.items
	};
}) satisfies PageServerLoad;
