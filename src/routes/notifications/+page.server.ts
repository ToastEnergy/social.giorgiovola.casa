import type { PageServerLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import type { NotificationGroup } from '#lib/types.js';

const PAGE_SIZE = 50;

export const load = (async ({ fetch }) => {
	const source = `/api/v1/notifications/grouped?limit=${PAGE_SIZE}`;
	const page = await apiGet<Page<NotificationGroup>>(fetch, source.slice('/api/v1'.length));
	return { groups: page.items, next: page.next_cursor, source };
}) satisfies PageServerLoad;
