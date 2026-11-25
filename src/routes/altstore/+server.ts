import type { RequestHandler } from './$types';
import { ADD_ALTSTORE_SOURCE } from '#lib/altStore.js';

// GitHub drops altstore:// links, so the README's badge goes through here
export const GET: RequestHandler = () =>
	new Response(null, { status: 302, headers: { Location: ADD_ALTSTORE_SOURCE } });
