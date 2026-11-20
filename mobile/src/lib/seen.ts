import { AppState } from 'react-native';
import { api, auth } from './api';
import { clearTray } from './tray';

// what the viewer has looked at, reported to the server in batches so it can mark the matching
// notifications read (POST /notifications/seen), like src/lib/seen.ts on the website

const DELAY = 3000;

type Batch = { posts: number[]; engagement: number[]; followers: string[]; invites: boolean };
const empty = (): Batch => ({ posts: [], engagement: [], followers: [], invites: false });

// one queue per account token: seen is read for the account that was signed in when it was seen
const queues = new Map<string, Batch>();
// already reported (or queued), so scrolling past again sends nothing. keyed by account too
const reported = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

const pending = (b: Batch) =>
	b.posts.length > 0 || b.engagement.length > 0 || b.followers.length > 0 || b.invites;

function add(key: string, put: (b: Batch) => void) {
	const token = auth.token;
	if (!token) return;
	const id = `${token} ${key}`;
	if (reported.has(id)) return;
	reported.add(id);
	let queue = queues.get(token);
	if (!queue) queues.set(token, (queue = empty()));
	put(queue);
	timer ??= setTimeout(() => flushSeen(), DELAY);
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
function forget(token: string, b: Batch) {
	for (const id of b.posts) reported.delete(`${token} p${id}`);
	for (const id of b.engagement) reported.delete(`${token} e${id}`);
	for (const u of b.followers) reported.delete(`${token} f${u}`);
	if (b.invites) reported.delete(`${token} invites`);
}

async function send(token: string, b: Batch) {
	try {
		const res = await api<{ read?: number } | null>('notifications/seen', {
			method: 'POST',
			token,
			body: {
				...(b.posts.length && { posts: b.posts }),
				...(b.engagement.length && { engagement: b.engagement }),
				...(b.followers.length && { followers: b.followers }),
				...(b.invites && { invites: true })
			}
		});
		// what was read leaves the notification tray too
		if (res?.read) clearTray('read');
	} catch {
		forget(token, b);
	}
}

/** Sends what is queued now. */
export function flushSeen() {
	clearTimeout(timer);
	timer = undefined;
	const all = [...queues];
	queues.clear();
	for (const [token, q] of all) {
		if (!pending(q)) continue;
		// the endpoint takes at most 100 posts, 100 engagement ids and 20 usernames per request
		const posts = chunks(q.posts, 100);
		const engagement = chunks(q.engagement, 100);
		const followers = chunks(q.followers, 20);
		const n = Math.max(posts.length, engagement.length, followers.length, 1);
		for (let i = 0; i < n; i++) {
			const b: Batch = {
				posts: posts[i] ?? [],
				engagement: engagement[i] ?? [],
				followers: followers[i] ?? [],
				invites: i === 0 && q.invites
			};
			if (pending(b)) void send(token, b);
		}
	}
}

// going to the background may be the last chance to report what was seen
AppState.addEventListener('change', (state) => {
	if (state !== 'active') flushSeen();
});
