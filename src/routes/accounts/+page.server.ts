import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

// identities and accounts moved to a section of the settings; old links and bookmarks still work
export const load = (({ url }) => {
	redirect(308, `/settings/accounts${url.search}`);
}) satisfies PageServerLoad;
