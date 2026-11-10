import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';

export const load = (async ({ fetch, parent }) => {
	// only admins change the instance settings
	if ((await parent()).role !== 'admin') redirect(303, '/admin');
	const motd = await apiGet<{ motd: string; custom: boolean; default: string; max: number }>(
		fetch,
		'/admin/motd'
	);
	// the default is shown as an empty field
	return { motd: motd.custom ? motd.motd : '', defaultMotd: motd.default, maxMotd: motd.max };
}) satisfies PageServerLoad;
