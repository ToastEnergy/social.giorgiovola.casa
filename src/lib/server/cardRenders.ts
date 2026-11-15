import { LRU } from './cache.js';
import { clientIp, hit, isLimited } from './ratelimit.js';

/**
 * Rendering a social card is CPU work on the event loop, and every post or profile is a new cache
 * key, so walking the IDs would otherwise make the server draw cards without end. Only cache misses
 * are limited: per IP (when ADDRESS_HEADER makes it known), and overall by drawing one card at a
 * time with a short queue, so a flood waits or is turned away instead of piling up.
 */

// generous for link unfurlers, which fetch one card per shared link
const PER_IP = 30;
const WINDOW = 60_000;
// beyond this many waiting renders, answer 503 rather than queue more
const MAX_QUEUED = 10;

type Png = Uint8Array<ArrayBuffer>;

let tail: Promise<unknown> = Promise.resolve();
let queued = 0;
const inFlight = new Map<string, Promise<Png>>();

export type CardResult = Png | { status: 429 | 503; retryAfter: number };

/** The card cached under `key`, drawing it with `render` (rate limited) when it isn't. */
export async function cardFor(
	cache: LRU<Png>,
	key: string,
	getClientAddress: () => string,
	render: () => Promise<Png>
): Promise<CardResult> {
	const cached = cache.get(key);
	if (cached) return cached;
	// the same card asked for at once (a link shared in a busy chat) is drawn once
	const pending = inFlight.get(key);
	if (pending) return pending;

	const ip = clientIp(getClientAddress);
	const ipKey = ip && `card:${ip}`;
	if (ipKey && isLimited(ipKey, PER_IP)) return { status: 429, retryAfter: WINDOW / 1000 };
	if (queued >= MAX_QUEUED) return { status: 503, retryAfter: 5 };
	if (ipKey) hit(ipKey, WINDOW);

	queued++;
	const run = tail.then(render).finally(() => {
		queued--;
		inFlight.delete(key);
	});
	tail = run.catch(() => {});
	inFlight.set(key, run);
	const png = await run;
	cache.set(key, png);
	return png;
}

/** The response for a card, or for being turned away. */
export function cardResponse(result: CardResult) {
	if (result instanceof Uint8Array)
		return new Response(result, {
			headers: {
				'Content-Type': 'image/png',
				'Content-Length': result.length.toString(),
				// not immutable: a deleted post's card shouldn't stay cached for a week
				'Cache-Control': 'public, max-age=3600'
			}
		});
	return new Response(result.status === 429 ? 'Too many requests' : 'Busy, try again', {
		status: result.status,
		headers: { 'Retry-After': String(result.retryAfter), 'Cache-Control': 'no-store' }
	});
}
