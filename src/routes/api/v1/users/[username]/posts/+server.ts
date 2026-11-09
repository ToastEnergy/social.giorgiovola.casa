import type { RequestHandler } from './$types';
import { fail, offsetPage, offsetParams, usernameParam, v1 } from '#lib/server/api.js';
import { profilePosts } from '#lib/server/feeds.js';

/**
 * A profile's posts, newest first: `?tab=posts` (its own posts, the pinned post left out; the
 * default), `?tab=replies` or `?tab=regiorgs` (the posts it regiorged, latest regiorg first).
 */
export const GET: RequestHandler = v1(async ({ locals, params, url }) => {
	const tab = url.searchParams.get('tab') ?? 'posts';
	if (tab !== 'posts' && tab !== 'replies' && tab !== 'regiorgs')
		fail(400, 'tab must be "posts", "replies" or "regiorgs"');
	const { limit, offset } = offsetParams(url);
	const rows =
		(await profilePosts(usernameParam(params.username), tab, locals.user, limit, offset)) ??
		fail(404, 'User not found');
	return offsetPage(rows, limit, offset);
});
