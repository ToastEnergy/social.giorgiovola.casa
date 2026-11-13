import { browser } from '$app/env';

/*
 * back and forward show a page at once: the reading pages (feeds, profiles, posts, notifications,
 * search) load through universal `+page.ts` loads wrapped in `cachedPage`, which keeps what they
 * returned for a while. a back/forward navigation (NavHistory) takes it from here, then the page
 * refreshes in the background. any other load, and every load on the server, goes to the API.
 * pages must not mutate their `data`: the same object comes back on the next back
 */

const TTL = 10 * 60_000;
const MAX = 40;

const cache = new Map<string, { at: number; data: unknown }>();
let traversing = false;
let served = false;

/** Runs `load`, or answers a back/forward navigation to `url` with what it returned last time. */
export async function cachedPage<T>(url: URL, load: () => Promise<T>): Promise<T> {
	// the server renders for everyone: never share a result there
	if (!browser) return load();
	const key = url.pathname + url.search;
	const hit = cache.get(key);
	if (traversing && hit && Date.now() - hit.at < TTL) {
		served = true;
		return hit.data as T;
	}
	const data = await load();
	cache.delete(key);
	cache.set(key, { at: Date.now(), data });
	while (cache.size > MAX) cache.delete(cache.keys().next().value!);
	return data;
}

/** Back/forward is starting: its data may come from the cache. */
export function startTraversal() {
	traversing = true;
	served = false;
}

/** The navigation finished. True when its data came from the cache (and should be refreshed). */
export function endTraversal() {
	const wasServed = served;
	traversing = false;
	served = false;
	return wasServed;
}

/** Another profile sees other data. */
export function clearPageCache() {
	cache.clear();
}
