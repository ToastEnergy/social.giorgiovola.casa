import type { PageServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';
import type { Bot } from '#lib/settings.js';

export const load = (async ({ fetch }) => {
	const bots = await apiGet<{ items: Bot[]; max: number }>(fetch, '/me/bots');
	return { bots: bots.items, maxBots: bots.max };
}) satisfies PageServerLoad;
