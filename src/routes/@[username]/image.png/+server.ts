import type { RequestHandler } from './$types';
import { getProfileCard } from '#lib/server/follows.js';
import { LRU } from '#lib/server/cache.js';
import { renderProfileCard } from '#lib/server/socialCard.js';

// Uint8Array<ArrayBuffer> rather than Buffer: Response only accepts ArrayBuffer-backed views
const cache = new LRU<Uint8Array<ArrayBuffer>>(200);

/** The social card of a profile (og:image): its header as the profile page shows it. */
export const GET: RequestHandler = async ({ params }) => {
	const username = params.username.toLowerCase();
	const card = await getProfileCard(username, null);
	if (!card) return new Response('Not found', { status: 404 });
	const profile = {
		username: card.username,
		name: card.name,
		avatar: card.avatar,
		bot: card.bot,
		bio: card.bio,
		website: card.website,
		followers: card.followers,
		following: card.following
	};

	// keyed on everything drawn, so an edit or new followers never get a stale card
	const key = JSON.stringify(profile);
	let buffer = cache.get(key);
	if (!buffer) {
		buffer = await renderProfileCard(profile);
		cache.set(key, buffer);
	}
	return new Response(buffer, {
		headers: {
			'Content-Type': 'image/png',
			'Content-Length': buffer.length.toString(),
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
