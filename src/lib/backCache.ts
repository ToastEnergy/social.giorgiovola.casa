/*
 * back and forward show the page at once: the data of pages already seen (SvelteKit's
 * `__data.json` responses) is kept for a while and answers a back/forward navigation, then the
 * page refreshes in the background. without it every back waits for the server first.
 * SvelteKit fetches page data through `window.fetch` so it can be wrapped (production builds;
 * the dev server bypasses it)
 */

const TTL = 10 * 60_000;
const MAX = 40;

type Entry = { at: number; body: string; headers: [string, string][] };

const cache = new Map<string, Entry>();
let traversing = false;
let served = false;
let installed = false;

const isData = (url: URL) =>
	url.origin === location.origin && url.pathname.endsWith('/__data.json');

// only the reading pages, which a background refresh brings up to date without losing anything.
// chats keep their own state (and catch up by themselves), forms would lose what's typed
const cacheable = (url: URL) => {
	const path = url.pathname.slice(0, -'/__data.json'.length) || '/';
	return (
		path === '/' ||
		path.startsWith('/@') ||
		path.startsWith('/hashtag/') ||
		path === '/notifications' ||
		path === '/search'
	);
};

export function installBackCache() {
	if (installed) return;
	installed = true;
	const inner = window.fetch;
	window.fetch = async (input, init) => {
		const request = input instanceof Request ? input : null;
		const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
		const url = new URL(request?.url ?? String(input), location.href);
		if (method !== 'GET' || !isData(url) || !cacheable(url)) return inner(input, init);

		const key = url.href;
		const hit = cache.get(key);
		if (traversing && hit && Date.now() - hit.at < TTL) {
			served = true;
			return new Response(hit.body, { status: 200, headers: hit.headers });
		}
		const res = await inner(input, init);
		if (res.ok && !res.redirected)
			res
				.clone()
				.text()
				.then((body) => {
					cache.delete(key);
					cache.set(key, { at: Date.now(), body, headers: [...res.headers] });
					while (cache.size > MAX) cache.delete(cache.keys().next().value!);
				})
				.catch(() => {});
		return res;
	};
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
export function clearBackCache() {
	cache.clear();
}
