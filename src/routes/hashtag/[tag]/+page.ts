import type { PageLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import { cachedPage } from '#lib/pageCache.js';
import type { Post } from '#lib/types.js';

const PAGE_SIZE = 10;

// universal, so back and forward can show it from the cache (#lib/pageCache.ts)
export const load = (async ({ params, fetch, depends, url }) => {
	depends('app:posts');
	return cachedPage(url, async () => {
		const info = await apiGet<{ tag: string; posts: number }>(
			fetch,
			`/hashtags/${encodeURIComponent(params.tag)}`,
			{ login: false }
		);
		const source = `/api/v1/hashtags/${encodeURIComponent(info.tag)}/posts?limit=${PAGE_SIZE}`;
		const page = await apiGet<Page<Post>>(fetch, source.slice('/api/v1'.length), { login: false });
		return { tag: info.tag, count: info.posts, posts: page.items, next: page.next_cursor, source };
	});
}) satisfies PageLoad;
