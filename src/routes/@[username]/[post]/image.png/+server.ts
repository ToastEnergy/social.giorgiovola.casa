import type { RequestHandler } from './$types';
import { getPost } from '#lib/server/feeds.js';
import { parseId } from '#lib/server/validation.js';
import { LRU } from '#lib/server/cache.js';
import { cardFor, cardResponse } from '#lib/server/cardRenders.js';
import { renderPostCard } from '#lib/server/socialCard.js';

// Uint8Array<ArrayBuffer> rather than Buffer: Response only accepts ArrayBuffer-backed views
const cache = new LRU<Uint8Array<ArrayBuffer>>(200);

/** The social card of a post (og:image), drawn like the post (#lib/server/socialCard.ts). */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	const id = parseId(params.post);
	if (id === null) return notFound();
	const post = await getPost(id, null);
	// the URL names the author: another username is another post
	if (!post || post.user.username !== params.username.toLowerCase()) return notFound();

	// keyed on everything drawn, so an edit, a rename or new likes never get a stale card
	return cardResponse(
		await cardFor(cache, JSON.stringify(post), getClientAddress, () => renderPostCard(post))
	);
};

const notFound = () => new Response('Not found', { status: 404 });
