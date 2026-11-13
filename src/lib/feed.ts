import type { Cookies } from '@sveltejs/kit';

export type Feed = 'all' | 'following';

// the following feed is hidden for now: everyone gets "all", whatever their cookie or the url says
export const FOLLOWING_FEED_ENABLED = false;

const isFeed = (value: string | null | undefined): value is Feed =>
	value === 'all' || value === 'following';

/** The feed asked for in the url (`?feed=`), if any. */
export function feedParam(url: URL): Feed | null {
	if (!FOLLOWING_FEED_ENABLED) return null;
	const param = url.searchParams.get('feed');
	return isFeed(param) ? param : null;
}

/**
 * The feed the home page opens on, remembered in a cookie (a UI preference). Server only (the
 * root layout's load): the cookie is httpOnly. Choosing a feed in the url remembers it.
 */
export function rememberedFeed(url: URL, cookies: Cookies): Feed {
	if (!FOLLOWING_FEED_ENABLED) return 'all';
	const param = feedParam(url);
	if (param) {
		if (cookies.get('feed') !== param)
			cookies.set('feed', param, { path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: true });
		return param;
	}
	return cookies.get('feed') === 'following' ? 'following' : 'all';
}
