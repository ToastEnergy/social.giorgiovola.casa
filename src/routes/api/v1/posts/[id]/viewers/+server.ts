import type { RequestHandler } from './$types';
import { fail, requireAccount, v1 } from '#lib/server/api.js';
import { postViewers } from '#lib/server/accountProfiles.js';
import { parseId } from '#lib/server/validation.js';

/**
 * What each profile of your account did with a post: liked, regiorged, follows the author. For
 * the "like as…" picker. Account cookies and human tokens only.
 */
export const GET: RequestHandler = v1(async ({ locals, params }) => {
	requireAccount(locals);
	const id = parseId(params.id) ?? fail(404, 'Post not found');
	const items = (await postViewers(locals, id)) ?? fail(404, 'Post not found');
	return { items };
});
