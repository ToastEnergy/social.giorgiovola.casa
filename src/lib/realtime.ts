import { connection } from './connection.svelte.js';
import type { ChatMessage, GroupMessage, MessageReaction, Post } from './types';

/** Events pushed by /api/stream. */
export type RealtimeEvents = {
	post: Post;
	post_deleted: { id: number };
	counts: {
		id: number;
		likes?: number;
		replies_count?: number;
		regiorgs?: number;
		quotes?: number;
	};
	/** someone voted in a poll: the vote counts of each option */
	poll: { id: number; votes: number[] };
	/** someone regiorged a post: the post, with `regiorged_by` set */
	regiorg: Post;
	notifications: { count: number };
	message: ChatMessage;
	message_deleted: { id: number };
	/** the sender changed the text of a direct message: the whole message, as it is now */
	message_edited: ChatMessage;
	/** the reactions to a direct message changed: all of them, oldest first */
	message_reactions: { id: number; reactions: MessageReaction[] };
	messages_unread: { count: number; reactions: number };
	group_message: GroupMessage;
	group_message_deleted: { group_id: number; id: number };
	group_message_edited: GroupMessage;
	group_message_reactions: { group_id: number; id: number; reactions: MessageReaction[] };
	/** a group was renamed or its members changed (you may have been removed) */
	group_updated: { id: number };
	/** someone is writing to you: in a group, or in your direct conversation (group_id null) */
	typing: { group_id: number | null; user: { username: string; name: string } };
	/** the server's heartbeat, every 8 seconds: the stream is alive */
	ping: Record<string, never>;
	/** the build the server runs, sent on connect */
	version: { version: string };
	/** the stream (re)connected: anything sent while it was down was missed */
	open: undefined;
};

type Listener<K extends keyof RealtimeEvents> = (data: RealtimeEvents[K]) => void;

const listeners = new Map<string, Set<Listener<never>>>();
const resumeListeners = new Set<() => unknown>();

// the browser retries a dropped stream by itself, but gives up for good when the server answers
// with an error (a proxy's 502 while the app restarts): then it's opened again from here, backing
// off up to RETRY_MAX_MS
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
// hidden this long, the stream is opened again on return: a locked phone or a backgrounded app
// may have lost the connection without the page ever hearing about it
const STALE_AFTER_MS = 60_000;
// the server pings every 8s: hearing nothing for this long, the connection is dead even though
// the browser still thinks it's open (a network that changed or a NAT that forgot it)
const SILENT_AFTER_MS = 20_000;
const WATCHDOG_MS = 5000;
const VISIBLE_GRACE_MS = 10_000;

let source: EventSource | null = null;
let active = false;
/** the stream went down (or was never up) since the page's data was loaded */
let missed = false;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let hiddenAt: number | null = null;
/** when the stream last said anything (an event or the open) */
let heardAt = 0;
let watchdog: ReturnType<typeof setInterval> | undefined;

/** Subscribes to an event; returns the unsubscribe function. */
export function onRealtime<K extends keyof RealtimeEvents>(event: K, fn: Listener<K>) {
	let set = listeners.get(event);
	if (!set) listeners.set(event, (set = new Set()));
	set.add(fn as Listener<never>);
	return () => set.delete(fn as Listener<never>);
}

/**
 * Runs when the stream is back after being down, to reload what the open page shows (it may
 * return a promise: the status pill says "Updating" until it settles). Returns the unsubscribe
 * function. Unlike `open`, it doesn't run when the stream first opens.
 */
export function onResume(fn: () => unknown) {
	resumeListeners.add(fn);
	return () => resumeListeners.delete(fn);
}

const emit = (event: string, data?: unknown) => {
	for (const fn of listeners.get(event) ?? []) (fn as (d: unknown) => void)(data);
};

const events: (keyof RealtimeEvents)[] = [
	'post',
	'post_deleted',
	'counts',
	'regiorg',
	'poll',
	'notifications',
	'message',
	'message_deleted',
	'message_edited',
	'message_reactions',
	'messages_unread',
	'group_message',
	'group_message_deleted',
	'group_message_edited',
	'group_message_reactions',
	'group_updated',
	'typing',
	'ping',
	'version'
];

function open() {
	clearTimeout(retryTimer);
	source?.close();
	const es = new EventSource('/api/v1/stream');
	source = es;
	es.addEventListener('open', () => {
		if (source !== es) return;
		heardAt = Date.now();
		attempts = 0;
		const resumed = missed;
		missed = false;
		emit('open');
		if (resumed) void resume();
		else connection.state = 'open';
	});
	es.addEventListener('error', () => {
		if (source !== es) return;
		lost();
		// CONNECTING: the browser tries again by itself after the server's `retry`
		if (es.readyState !== EventSource.CLOSED) return;
		es.close();
		source = null;
		retryTimer = setTimeout(open, Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempts++));
	});
	for (const event of events) {
		es.addEventListener(event, (e) => {
			let data;
			try {
				data = JSON.parse((e as MessageEvent).data);
			} catch {
				return;
			}
			heardAt = Date.now();
			emit(event, data);
		});
	}
}

function lost() {
	missed = true;
	connection.state = navigator.onLine === false ? 'offline' : 'reconnecting';
}

async function resume() {
	connection.state = 'refreshing';
	await Promise.allSettled([...resumeListeners].map(async (fn) => fn()));
	// it may have dropped again meanwhile
	if (connection.state === 'refreshing') connection.state = 'open';
}

/** Opens the stream again now, skipping any wait, and reloads the page's data once it's up. */
function reopen() {
	if (!active) return;
	missed = true;
	attempts = 0;
	if (connection.state === 'open' || connection.state === 'refreshing')
		connection.state = 'reconnecting';
	open();
}

function onVisibility() {
	if (document.visibilityState === 'hidden') {
		hiddenAt = Date.now();
		return;
	}
	const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
	hiddenAt = null;
	if (!source || source.readyState !== EventSource.OPEN || away >= STALE_AFTER_MS) return reopen();
	// asleep in the background, the page heard nothing even if the stream is fine: give it a
	// heartbeat's time (and what was buffered meanwhile) before calling it dead
	heardAt = Math.max(heardAt, Date.now() - SILENT_AFTER_MS + VISIBLE_GRACE_MS);
}

// hidden pages have their timers slowed down or stopped: checked again once visible
function checkSilence() {
	if (document.visibilityState === 'hidden') return;
	if (source?.readyState === EventSource.OPEN && Date.now() - heardAt > SILENT_AFTER_MS) reopen();
}

function onOffline() {
	if (!active) return;
	missed = true;
	connection.state = 'offline';
}

// back from the back/forward cache: the stream was closed when the page was put away
function onPageShow(e: PageTransitionEvent) {
	if (e.persisted) reopen();
}

/** (Re)opens the stream. The server picks the user from the session cookie. */
export function connectRealtime() {
	disconnectRealtime();
	active = true;
	missed = false;
	document.addEventListener('visibilitychange', onVisibility);
	// Chrome freezes background pages: their connections may be gone when they're resumed
	document.addEventListener('resume', reopen);
	window.addEventListener('online', reopen);
	window.addEventListener('offline', onOffline);
	window.addEventListener('pageshow', onPageShow);
	watchdog = setInterval(checkSilence, WATCHDOG_MS);
	open();
}

export function disconnectRealtime() {
	active = false;
	clearTimeout(retryTimer);
	clearInterval(watchdog);
	source?.close();
	source = null;
	connection.state = 'connecting';
	document.removeEventListener('visibilitychange', onVisibility);
	document.removeEventListener('resume', reopen);
	window.removeEventListener('online', reopen);
	window.removeEventListener('offline', onOffline);
	window.removeEventListener('pageshow', onPageShow);
}
