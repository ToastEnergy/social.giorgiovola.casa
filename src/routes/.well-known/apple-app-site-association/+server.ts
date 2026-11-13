import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { appleAppIds } from '#lib/server/appLinks.js';

/**
 * Lets the iOS apps listed in APPLE_APP_IDS use this instance's passkeys (webcredentials) and open
 * its invite links (applinks: /register?invite=…, the rest of the site stays in the browser).
 */
export const GET: RequestHandler = () => {
	const apps = appleAppIds();
	return json(
		{
			webcredentials: { apps },
			applinks: {
				details: apps.length
					? [{ appIDs: apps, components: [{ '/': '/register', '?': { invite: '?*' } }] }]
					: []
			}
		},
		{ headers: { 'Cache-Control': 'max-age=3600' } }
	);
};
