import { browser } from '$app/env';

// what the viewer has looked at, reported to the server in batches so it can mark the matching
// notifications read (POST /api/v1/notifications/seen). browser only

const SEEN = '/api/v1/notifications/seen';
const STALE = '/api/v1/notifications/stale';
const DELAY = 3000;
const STALE_EVERY = 30_000;

type Batch = { posts: number[]; engagement: number[]; followers: string[]; invites: boolean };
const empty = (): Batch => ({ posts: [], engagement: [], followers: [], invites: false });

let queue = empty();
// already reported (or queued) in this page session, so scrolling past again sends nothing
const reported = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

const pending = (b: Batch) =>
	b.posts.length > 0 || b.engagement.length > 0 || b.followers.length > 0 || b.invites;

function add(key: string, put: (b: Batch) => void) {
	if (!browser || reported.has(key)) return;
	reported.add(key);
	put(queue);
	timer ??= setTimeout(flushSeen, DELAY);
}

/** A post of someone else was on screen. */
export const seePost = (id: number) => add(`p${id}`, (b) => b.posts.push(id));
/** The likes, regiorgs and counts of a post were looked at. */
export const seeEngagement = (id: number) => add(`e${id}`, (b) => b.engagement.push(id));
/** The followers list of a profile was opened (the server ignores profiles that aren't yours). */
export const seeFollowers = (username: string) =>
	add(`f${username}`, (b) => b.followers.push(username));
/** The invites page was opened. */
export const seeInvites = () => add('invites', (b) => (b.invites = true));

const chunks = <T>(list: T[], size: number) =>
	Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
		list.slice(i * size, (i + 1) * size)
	);

/** A batch that failed is dropped, but seeing the same things again reports them again. */
function forget(b: Batch) {
	for (const id of b.posts) reported.delete(`p${id}`);
	for (const id of b.engagement) reported.delete(`e${id}`);
	for (const u of b.followers) reported.delete(`f${u}`);
	if (b.invites) reported.delete('invites');
}

async function send(b: Batch, keepalive: boolean) {
	try {
		const res = await fetch(SEEN, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				...(b.posts.length && { posts: b.posts }),
				...(b.engagement.length && { engagement: b.engagement }),
				...(b.followers.length && { followers: b.followers }),
				...(b.invites && { invites: true })
			}),
			keepalive
		});
		if (!res.ok) return forget(b);
		const { read } = (await res.json().catch(() => ({}))) as { read?: number };
		if (read) closeStale();
	} catch {
		forget(b);
	}
}

/** Sends what is queued now. `keepalive` lets the request outlive the page. */
export function flushSeen(keepalive = false) {
	clearTimeout(timer);
	timer = undefined;
	if (!browser || !pending(queue)) return;
	const q = queue;
	queue = empty();
	// the endpoint takes at most 100 posts, 100 engagement ids and 20 usernames per request
	const n = Math.max(
		chunks(q.posts, 100).length,
		chunks(q.engagement, 100).length,
		chunks(q.followers, 20).length,
		1
	);
	const posts = chunks(q.posts, 100);
	const engagement = chunks(q.engagement, 100);
	const followers = chunks(q.followers, 20);
	for (let i = 0; i < n; i++) {
		const b: Batch = {
			posts: posts[i] ?? [],
			engagement: engagement[i] ?? [],
			followers: followers[i] ?? [],
			invites: i === 0 && q.invites
		};
		if (pending(b)) void send(b, keepalive);
	}
}

let lastStale = 0;

/**
 * Takes the notifications the server says have nothing unread left out of the tray. Does nothing
 * without a service worker, permission or when anything fails.
 */
export async function closeStale(throttle = false) {
	if (!browser || !('serviceWorker' in navigator) || !('Notification' in window)) return;
	if (Notification.permission !== 'granted') return;
	if (throttle && Date.now() - lastStale < STALE_EVERY) return;
	lastStale = Date.now();
	try {
		const registration = await navigator.serviceWorker.ready;
		const shown = (await registration.getNotifications()).filter((n) => n.tag);
		if (!shown.length) return;
		const tags = [...new Set(shown.map((n) => n.tag))];
		for (const part of chunks(tags, 100)) {
			const res = await fetch(STALE, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tags: part })
			});
			if (!res.ok) continue;
			const { stale } = (await res.json()) as { stale?: string[] };
			const gone = new Set(stale ?? []);
			for (const n of shown) if (gone.has(n.tag)) n.close();
		}
	} catch {
		// no worker or no answer: the tray stays as it is
	}
}

if (browser) {
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flushSeen(true);
		else void closeStale(true);
	});
	addEventListener('focus', () => void closeStale(true));
	addEventListener('pagehide', () => flushSeen(true));
}
