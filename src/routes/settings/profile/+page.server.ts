import type { PageServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';
import type { Me } from '#lib/me.js';

export const load = (async ({ fetch }) => {
	const me = await apiGet<Me>(fetch, '/me');
	return { profile: me.user, account: me.account?.username ?? me.user.username };
}) satisfies PageServerLoad;
