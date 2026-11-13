import type { PageLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';
import { cachedPage } from '#lib/pageCache.js';
import type { HashtagResult, UserResult } from '#lib/types.js';

const MAX_RESULTS = 20;

// universal, so back and forward can show it from the cache (#lib/pageCache.ts)
export const load = (async ({ fetch, url }) =>
	cachedPage(url, () => {
		const q = url.searchParams.get('q') ?? '';
		// signed in only, like the API: anonymous visitors go to the login page
		return apiGet<{ query: string; users: UserResult[]; hashtags: HashtagResult[] }>(
			fetch,
			`/search?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`
		);
	})) satisfies PageLoad;
