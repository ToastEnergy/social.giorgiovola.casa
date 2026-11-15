import { onRealtime } from './realtime';

/**
 * Typing indicators. Who is writing to you, per conversation: `dm:<username>` for a direct one,
 * `group:<id>` for a group. Writers send a signal every few seconds (sendTyping), and an entry
 * fades out when they stop, or as soon as their message arrives.
 */

// how often a writer signals, and how long an entry lasts without a new signal
const SEND_EVERY_MS = 3000;
const EXPIRE_MS = 6000;

/** what they are doing: writing a message or recording a voice note */
export type TypingAction = 'typing' | 'recording';
type Typer = { username: string; name: string; action: TypingAction };

export const dmKey = (username: string) => `dm:${username}`;
export const groupKey = (id: number) => `group:${id}`;

const typers = $state<Record<string, Typer[]>>({});
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function stop(key: string, username: string) {
	const id = `${key}/${username}`;
	clearTimeout(timers.get(id));
	timers.delete(id);
	const list = typers[key];
	if (!list?.some((t) => t.username === username)) return;
	const rest = list.filter((t) => t.username !== username);
	if (rest.length > 0) typers[key] = rest;
	else delete typers[key];
}

function start(key: string, typer: Typer) {
	const id = `${key}/${typer.username}`;
	clearTimeout(timers.get(id));
	timers.set(
		id,
		setTimeout(() => stop(key, typer.username), EXPIRE_MS)
	);
	const list = typers[key] ?? [];
	const at = list.findIndex((t) => t.username === typer.username);
	if (at === -1) typers[key] = [...list, typer];
	// from typing to recording (or back): the line says what they do now
	else if (list[at].action !== typer.action)
		typers[key] = list.map((t, i) => (i === at ? typer : t));
}

let listening = false;

/** Starts listening to the stream; call from components that show indicators. Idempotent. */
export function listenTyping() {
	if (listening) return;
	listening = true;
	onRealtime('typing', ({ group_id, user, action }) =>
		start(group_id === null ? dmKey(user.username) : groupKey(group_id), {
			...user,
			// older servers don't say: typing
			action: action === 'recording' ? 'recording' : 'typing'
		})
	);
	// a message from someone means they are done writing it
	onRealtime('message', (m) => stop(dmKey(m.sender), m.sender));
	onRealtime('group_message', (m) => stop(groupKey(m.group_id), m.sender.username));
	// switching profile reconnects the stream: indicators were for the previous one
	onRealtime('open', () => {
		for (const key of Object.keys(typers)) for (const t of typers[key]) stop(key, t.username);
	});
}

/** Who is writing in a conversation, in the order they started. Reactive. */
export const typingIn = (key: string): Typer[] => typers[key] ?? [];

/**
 * "Alice is typing…", "Alice and Bob are typing…", "Alice, Bob and 2 others are typing…", and
 * "Alice is recording a voice message…" for those recording one; both when some do each.
 */
export function typingText(list: Typer[]) {
	const recording = list.filter((t) => t.action === 'recording');
	const typing = list.filter((t) => t.action !== 'recording');
	return [phrase(typing, 'typing'), phrase(recording, 'recording a voice message')]
		.filter(Boolean)
		.join(' ');
}

function phrase(list: Typer[], doing: string) {
	const names = list.map((t) => t.name);
	if (names.length === 0) return '';
	if (names.length === 1) return `${names[0]} is ${doing}…`;
	if (names.length === 2) return `${names[0]} and ${names[1]} are ${doing}…`;
	const others = names.length - 2;
	return `${names[0]}, ${names[1]} and ${others} other${others > 1 ? 's' : ''} are ${doing}…`;
}

const lastSent = new Map<string, number>();

/**
 * Signals that you are writing (or recording a voice note) in a conversation, at most every few
 * seconds for each.
 */
export function sendTyping(target: { to: string } | { group: number }, action: TypingAction = 'typing') {
	const key = 'to' in target ? dmKey(target.to) : groupKey(target.group);
	const now = Date.now();
	if (now - (lastSent.get(`${key}/${action}`) ?? 0) < SEND_EVERY_MS) return;
	lastSent.set(`${key}/${action}`, now);
	const url =
		'to' in target
			? `/api/v1/conversations/${encodeURIComponent(target.to)}/typing`
			: `/api/v1/groups/${target.group}/typing`;
	fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: action === 'typing' ? undefined : JSON.stringify({ action })
	}).catch(() => {});
}

/** Your message went out: the next keystroke (or recording) signals again right away. */
export function resetTyping(target: { to: string } | { group: number }) {
	const key = 'to' in target ? dmKey(target.to) : groupKey(target.group);
	lastSent.delete(`${key}/typing`);
	lastSent.delete(`${key}/recording`);
}
