import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import type { Account, LogEntry, Report } from '#lib/moderation.js';

export const load = (async ({ fetch, params, depends }) => {
	depends('app:admin');
	const name = encodeURIComponent(params.username.toLowerCase());
	const [account, log, reports] = await Promise.all([
		apiGet<Account>(fetch, `/admin/users/${name}`, { optional: true }),
		apiGet<Page<LogEntry>>(fetch, `/admin/log?username=${name}&limit=50`),
		apiGet<Page<Report>>(fetch, `/admin/reports?username=${name}&status=all&limit=20`)
	]);
	if (!account) error(404, 'User not found');
	return {
		account,
		log: log.items,
		moreLog: log.next_cursor !== null,
		reports: reports.items,
		moreReports: reports.next_cursor !== null
	};
}) satisfies PageServerLoad;
