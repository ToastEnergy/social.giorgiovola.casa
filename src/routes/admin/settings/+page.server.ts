import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';

export const load = (async ({ fetch, parent }) => {
	// only admins change the instance settings
	if ((await parent()).role !== 'admin') redirect(303, '/admin');
	const [motd, identityLimit] = await Promise.all([
		apiGet<{ motd: string; custom: boolean; default: string; max: number }>(fetch, '/admin/motd'),
		apiGet<{ limit: number; custom: boolean; default: number; max: number }>(
			fetch,
			'/admin/identity-limit'
		)
	]);
	return {
		// the default is shown as an empty field
		motd: motd.custom ? motd.motd : '',
		defaultMotd: motd.default,
		maxMotd: motd.max,
		identityLimit
	};
}) satisfies PageServerLoad;
