import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { settingsSections } from '#lib/settings.js';

// /settings opens the first section; every section has its own address
export const load = (() => {
	redirect(307, `/settings/${settingsSections[0].slug}`);
}) satisfies PageServerLoad;
