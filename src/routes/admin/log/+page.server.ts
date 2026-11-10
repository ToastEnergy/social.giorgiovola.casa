import type { PageServerLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import type { LogEntry } from '#lib/moderation.js';

export const load = (async ({ fetch, url, depends }) => {
	depends('app:admin');
	const read = (name: string) => (url.searchParams.get(name) ?? '').trim().slice(0, 64);
	const filters = { username: read('username'), actor: read('actor'), action: read('action') };
	const params = new URLSearchParams({ limit: '30' });
	for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
	const cursor = read('cursor');
	if (/^\d{1,10}$/.test(cursor)) params.set('cursor', cursor);
	const log = await apiGet<Page<LogEntry>>(fetch, `/admin/log?${params}`);
	return { ...filters, cursor, entries: log.items, next: log.next_cursor };
}) satisfies PageServerLoad;
