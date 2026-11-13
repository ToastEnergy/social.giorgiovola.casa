import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import type { Invite, InviteSummary } from '#lib/invites.js';

const STATUSES = ['all', 'pending', 'used', 'expired', 'revoked'];

export const load = (async ({ fetch, url, parent, depends }) => {
	depends('app:admin');
	// only admins hand out invites
	if ((await parent()).role !== 'admin') redirect(303, '/admin');
	const read = (name: string) => (url.searchParams.get(name) ?? '').trim().slice(0, 64);
	const status = STATUSES.includes(read('status')) ? read('status') : 'all';
	const username = read('username').replace(/^@/, '');
	const cursor = read('cursor');
	const params = new URLSearchParams({ limit: '50', status });
	if (username) params.set('username', username);
	if (/^\d{1,10}$/.test(cursor)) params.set('cursor', cursor);
	const [summary, list] = await Promise.all([
		apiGet<InviteSummary>(fetch, '/admin/invites/summary'),
		apiGet<Page<Invite>>(fetch, `/admin/invites?${params}`)
	]);
	return { summary, status, username, cursor, invites: list.items, next: list.next_cursor };
}) satisfies PageServerLoad;
