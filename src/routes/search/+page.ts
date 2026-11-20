import type { PageLoad } from './$types';
import { apiGet, loadAs } from '#lib/apiLoad.js';
import { cachedPage } from '#lib/pageCache.js';
import type { HashtagResult, UserResult } from '#lib/types.js';

const MAX_RESULTS = 20;

// universal, so back and forward can show it from the cache (#lib/pageCache.ts)
export const load = (async ({ fetch, url, parent }) =>
	cachedPage(url, async () => {
		const q = url.searchParams.get('q') ?? '';
		const as = await loadAs(url, parent);
		// signed in only, like the API: anonymous visitors go to the login page
		return apiGet<{ query: string; users: UserResult[]; hashtags: HashtagResult[] }>(
			fetch,
			`/search?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`,
			{ as }
		);
	})) satisfies PageLoad;
