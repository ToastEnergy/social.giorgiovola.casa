import type { RequestHandler } from './$types';
import {
	created,
	fail,
	offsetParams,
	rateLimit,
	readJson,
	requireUser,
	v1
} from '#lib/server/api.js';
import {
	addGifFavorite,
	GIF_FAVORITE_WRITES_PER_MINUTE,
	listGifFavorites,
	parseGif
} from '#lib/server/gifs.js';

/** The favorite GIFs of the profile in use, newest first. */
export const GET: RequestHandler = v1(({ locals, url }) => {
	const user = requireUser(locals);
	const { limit, offset } = offsetParams(url, 50, 100);
	return listGifFavorites(user.id, limit, offset);
});

/** Saves a GIF as a favorite: `{ gif }`, the same object a post or message takes. */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	const user = requireUser(locals);
	rateLimit(
		`gif-favorites:${user.id}`,
		GIF_FAVORITE_WRITES_PER_MINUTE,
		60_000,
		'You are saving GIFs too fast'
	);
	const gif = parseGif((await readJson(request)).gif);
	if (!gif) fail(400, 'Missing gif');
	const { created: isNew, favorite } = await addGifFavorite(user.id, gif);
	return isNew ? created(favorite) : favorite;
});
