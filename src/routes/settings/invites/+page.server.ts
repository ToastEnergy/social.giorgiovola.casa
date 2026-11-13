import type { PageServerLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import type { Invite, InviteBalance } from '#lib/invites.js';

export const load = (async ({ fetch, depends }) => {
	depends('app:invites');
	const res = await apiGet<Page<Invite> & InviteBalance>(fetch, '/me/invites?limit=100');
	return {
		balance: { invites: res.invites, pending: res.pending, available: res.available },
		invites: res.items
	};
}) satisfies PageServerLoad;
