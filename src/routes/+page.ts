import type { PageLoad } from './$types';
import { isHttpError } from '@sveltejs/kit';
import type { Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import { cachedPage } from '#lib/pageCache.js';
import { FOLLOWING_FEED_ENABLED, feedParam, type Feed } from '#lib/feed.js';
import type { Post } from '#lib/types.js';

const PAGE_SIZE = 10;

const timeline = (fetch: typeof globalThis.fetch, feed: Feed) =>
	apiGet<Page<Post>>(fetch, `/timeline?feed=${feed}&limit=${PAGE_SIZE}`, { login: false });

const signedOut = (e: unknown) => {
	if (isHttpError(e, 401)) return null;
	throw e;
};

// universal, so back and forward can show it from the cache (#lib/pageCache.ts)
export const load = (async ({ fetch, depends, url, parent }) => {
	depends('app:posts');
	// the url's choice, else the one remembered in the cookie (read by the root layout). only
	// waits for the layout when it has to: otherwise its calls run alongside these
	let feed: Feed = feedParam(url) ?? (FOLLOWING_FEED_ENABLED ? (await parent()).feed : 'all');
	return cachedPage(url, async () => {
		const [timelinePage, pinned, following] = await Promise.all([
			// signed out, the following feed is a 401: show everything instead
			timeline(fetch, feed).catch(signedOut),
			apiGet<Page<Post>>(fetch, '/timeline/pinned'),
			feed === 'following'
				? apiGet<{ items: string[] }>(fetch, '/me/following', { login: false }).catch(signedOut)
				: null
		]);
		let page = timelinePage;
		if (!page) {
			feed = 'all';
			page = await timeline(fetch, feed);
		}
		return {
			feed,
			followingFeedEnabled: FOLLOWING_FEED_ENABLED,
			posts: page.items,
			next: page.next_cursor,
			source: `/api/v1/timeline?feed=${feed}&limit=${PAGE_SIZE}`,
			pinned: pinned.items,
			following: feed === 'following' ? following?.items ?? null : null
		};
	});
}) satisfies PageLoad;
