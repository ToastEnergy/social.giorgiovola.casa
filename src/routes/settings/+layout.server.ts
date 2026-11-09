import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

// every section belongs to the signed in account; the sections load their own data from the API
export const load = (async ({ parent }) => {
	const { user } = await parent();
	if (!user) redirect(303, '/login');
}) satisfies LayoutServerLoad;
