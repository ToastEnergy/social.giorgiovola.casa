import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';
import type { Overview } from '#lib/moderation.js';

export const load = (async ({ fetch, parent, depends }) => {
	// every action in the panel invalidates this, so the counts stay right
	depends('app:admin');
	const { user, role } = await parent();
	if (!user) redirect(303, '/login');
	// staff only, and nothing to tell everyone else
	if (role === 'user') error(404, 'Not found');
	return { role, overview: await apiGet<Overview>(fetch, '/admin/overview') };
}) satisfies LayoutServerLoad;
