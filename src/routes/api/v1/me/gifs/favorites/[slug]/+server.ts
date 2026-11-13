import type { RequestHandler } from './$types';
import { fail, rateLimit, requireUser, v1 } from '#lib/server/api.js';
import { GIF_FAVORITE_WRITES_PER_MINUTE, removeGifFavorite } from '#lib/server/gifs.js';

/** Removes a GIF, by its KLIPY slug, from the favorites of the profile in use. */
export const DELETE: RequestHandler = v1(async ({ locals, params }) => {
	const user = requireUser(locals);
	rateLimit(
		`gif-favorites:${user.id}`,
		GIF_FAVORITE_WRITES_PER_MINUTE,
		60_000,
		'You are saving GIFs too fast'
	);
	if (!(await removeGifFavorite(user.id, params.slug))) fail(404, 'Not a favorite GIF');
});
