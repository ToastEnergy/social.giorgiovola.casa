import type { PageServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';
import type { InviteCheck } from '#lib/invites.js';

export const load = (async ({ fetch, url }) => {
	const instance = await apiGet<{ invite_required?: boolean }>(fetch, '/instance');
	// opened from an invite link: say who it is from, or that it no longer works
	const code = url.searchParams.get('invite')?.trim() ?? '';
	const invite = code
		? await apiGet<InviteCheck>(fetch, `/invites/${encodeURIComponent(code)}`, {
				optional: true
		  })
		: null;
	return { inviteRequired: instance.invite_required !== false, code, invite };
}) satisfies PageServerLoad;
