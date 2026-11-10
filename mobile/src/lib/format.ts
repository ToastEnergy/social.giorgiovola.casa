import type { GroupMessageKind, Post, User } from './types';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });
/** 49.4K */
export const count = (n: number) => compact.format(n);

/** "now", "5m", "3h", "2d", then the date. */
export function timeAgo(iso: string) {
	const date = new Date(iso);
	const seconds = (Date.now() - date.getTime()) / 1000;
	if (seconds < 60) return 'now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`;
	return shortDate(iso);
}

export function shortDate(iso: string) {
	const date = new Date(iso);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		year: sameYear ? undefined : 'numeric'
	});
}

export const fullDate = (iso: string) =>
	new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const clock = (iso: string) =>
	new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));

/** "Today", "Yesterday" or the date: the separators of a chat. */
export function dayLabel(iso: string) {
	const date = new Date(iso);
	const today = new Date();
	const yesterday = new Date(Date.now() - 86400_000);
	if (dayKey(date) === dayKey(today)) return 'Today';
	if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
	return date.toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'
	});
}

/** A profile website without the scheme, "www." or a trailing slash. */
export const websiteLabel = (url: string) =>
	url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export const RATIO_MIN_LIKES = 3;

/** A reply ratios its parent when it has at least 3 likes and more than the parent. */
export const isRatio = (post: Pick<Post, 'likes' | 'reply_to' | 'user'>) =>
	post.reply_to != null &&
	post.user.username !== post.reply_to.username &&
	post.likes >= RATIO_MIN_LIKES &&
	post.likes > (post.reply_to.likes ?? 0);

export function ratioPercent(post: Pick<Post, 'likes' | 'reply_to'>) {
	const total = post.likes + (post.reply_to?.likes ?? 0);
	return total === 0 ? 0 : Math.round((post.likes / total) * 100);
}

type Person = Pick<User, 'username' | 'name'>;

/** The line of a group chat event ("Alice added Bob"); the viewer reads "You". */
export function groupEventText(
	event: { kind: GroupMessageKind; sender: Person; target: Person | null; content: string },
	me: string | null | undefined
) {
	const who = (p: Person | null) => (!p ? 'someone' : p.username === me ? 'you' : p.name);
	const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const sender = capital(who(event.sender));
	switch (event.kind) {
		case 'created':
			return `${sender} created the group "${event.content}"`;
		case 'added':
			return `${sender} added ${who(event.target)}`;
		case 'removed':
			return `${sender} removed ${who(event.target)}`;
		case 'left':
			return `${sender} left`;
		case 'renamed':
			return `${sender} renamed the group to "${event.content}"`;
		case 'owner':
			return `${sender} ${event.sender.username === me ? 'are' : 'is'} now the owner`;
		default:
			return event.content;
	}
}
