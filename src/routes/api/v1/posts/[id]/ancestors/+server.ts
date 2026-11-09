import type { RequestHandler } from './$types';
import { fail, limitParam, v1 } from '#lib/server/api.js';
import { getAncestors, MAX_ANCESTORS } from '#lib/server/posts.js';
import { parseId } from '#lib/server/validation.js';

/** The posts a reply answers, root first: the thread above it. One page, no cursor. */
export const GET: RequestHandler = v1(async ({ locals, params, url }) => {
	const id = parseId(params.id) ?? fail(404, 'Post not found');
	const limit = limitParam(url, 20, MAX_ANCESTORS);
	const items = (await getAncestors(id, locals.user, limit)) ?? fail(404, 'Post not found');
	return { items, next_cursor: null };
});
