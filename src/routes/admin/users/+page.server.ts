import type { PageServerLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import type { AccountRow } from '#lib/moderation.js';

const PAGE_SIZE = 25;
const FILTERS = ['all', 'reported', 'banned', 'muted', 'staff'] as const;

export const load = (async ({ fetch, url, depends }) => {
	depends('app:admin');
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 64);
	const rawFilter = url.searchParams.get('filter');
	const filter = FILTERS.find((f) => f === rawFilter) ?? 'all';
	const rawPage = url.searchParams.get('page') ?? '0';
	const page = /^\d{1,4}$/.test(rawPage) ? Number(rawPage) : 0;

	const params = new URLSearchParams({ q, filter, limit: String(PAGE_SIZE) });
	if (page > 0) params.set('cursor', String(page * PAGE_SIZE));
	const accounts = await apiGet<Page<AccountRow>>(fetch, `/admin/users?${params}`);
	return { q, filter, page, hasMore: accounts.next_cursor !== null, users: accounts.items };
}) satisfies PageServerLoad;
