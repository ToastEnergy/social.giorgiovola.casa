import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { appleAppIds } from '#lib/server/appLinks.js';

/** Lets the iOS apps listed in APPLE_APP_IDS use this instance's passkeys. */
export const GET: RequestHandler = () =>
	json(
		{ webcredentials: { apps: appleAppIds() } },
		{ headers: { 'Cache-Control': 'max-age=3600' } }
	);
