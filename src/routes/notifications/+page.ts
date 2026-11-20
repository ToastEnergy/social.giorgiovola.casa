import type { PageLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import { cachedPage } from '#lib/pageCache.js';
import { activeProfiles } from '#lib/inbox.js';
import type { NotificationGroup } from '#lib/types.js';

const PAGE_SIZE = 50;

// universal, so back and forward can show it from the cache (#lib/pageCache.ts)
export const load = (async ({ fetch, url, parent }) =>
	cachedPage(url, async () => {
		const { inboxAll, accounts } = await parent();
		// `all`, one profile of the account (?profile=) or null: only the profile in use, with the
		// plain keys. the reads use the same ?profiles= as the list
		let scope: string | null = null;
		if (inboxAll) {
			const profile = url.searchParams.get('profile');
			scope = activeProfiles(accounts).some((p) => p.username === profile) ? profile : 'all';
		}
		const source = `/api/v1/notifications/grouped?limit=${PAGE_SIZE}${
			scope ? `&profiles=${encodeURIComponent(scope)}` : ''
		}`;
		const page = await apiGet<Page<NotificationGroup>>(fetch, source.slice('/api/v1'.length));
		return { groups: page.items, next: page.next_cursor, source, scope };
	})) satisfies PageLoad;
