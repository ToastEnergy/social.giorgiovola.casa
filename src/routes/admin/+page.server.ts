import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import type { Report } from '#lib/moderation.js';

const STATUSES = ['open', 'resolved', 'dismissed', 'all'] as const;

export const load = (async ({ fetch, url, depends }) => {
	depends('app:admin');
	// the account list used to live here: old links (?q=, ?filter=) still find it
	if (['q', 'filter', 'page'].some((p) => url.searchParams.has(p)))
		redirect(307, `/admin/users${url.search}`);

	const asked = url.searchParams.get('status');
	const status = STATUSES.find((s) => s === asked) ?? 'open';
	const params = new URLSearchParams({ status, limit: '20' });
	// the reports against one account, from its case page
	const username = (url.searchParams.get('username') ?? '').trim().slice(0, 64);
	if (username) params.set('username', username);
	const cursor = url.searchParams.get('cursor');
	if (cursor && /^\d{1,10}$/.test(cursor)) params.set('cursor', cursor);
	const reports = await apiGet<Page<Report>>(fetch, `/admin/reports?${params}`);
	return { status, username, cursor, reports: reports.items, next: reports.next_cursor };
}) satisfies PageServerLoad;
