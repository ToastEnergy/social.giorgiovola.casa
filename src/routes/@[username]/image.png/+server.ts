import type { RequestHandler } from './$types';
import { getProfileCard } from '#lib/server/follows.js';
import { LRU } from '#lib/server/cache.js';
import { cardFor, cardResponse } from '#lib/server/cardRenders.js';
import { renderProfileCard } from '#lib/server/socialCard.js';

// Uint8Array<ArrayBuffer> rather than Buffer: Response only accepts ArrayBuffer-backed views
const cache = new LRU<Uint8Array<ArrayBuffer>>(200);

/** The social card of a profile (og:image): its header as the profile page shows it. */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
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
	return cardResponse(
		await cardFor(cache, JSON.stringify(profile), getClientAddress, () =>
			renderProfileCard(profile)
		)
	);
};
