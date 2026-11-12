import { api, withQuery } from './api';

// what the staff tools share (the web app's src/lib/moderation.ts)

export type ModerationAction = 'ban' | 'unban' | 'mute' | 'unmute' | 'role' | 'password';

/** Runs a staff action on the account behind `username`. Resolves with what to tell the user. */
export function moderate(
	username: string,
	action: ModerationAction,
	fields: { reason?: string; duration?: number | null; role?: string; password?: string } = {}
) {
	const base = `admin/users/${encodeURIComponent(username)}`;
	const timed = { reason: fields.reason ?? '', duration: fields.duration ?? null };
	const [path, method, body] = {
		ban: [`${base}/ban`, 'PUT', timed],
		unban: [`${base}/ban`, 'DELETE', undefined],
		mute: [`${base}/mute`, 'PUT', timed],
		unmute: [`${base}/mute`, 'DELETE', undefined],
		role: [`${base}/role`, 'PUT', { role: fields.role }],
		password: [`${base}/password`, 'PUT', { password: fields.password }]
	}[action] as [string, 'PUT' | 'DELETE', unknown];
	return api<{ message: string }>(path, { method, body });
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/** The lengths offered for bans and mutes; null is for good. */
export const DURATIONS: { label: string; seconds: number | null }[] = [
	{ label: '1 hour', seconds: HOUR },
	{ label: '1 day', seconds: DAY },
	{ label: '3 days', seconds: 3 * DAY },
	{ label: '1 week', seconds: 7 * DAY },
	{ label: '30 days', seconds: 30 * DAY },
	{ label: 'Permanent', seconds: null }
];

/** Reasons people pick from when they report, in the order the sheet lists them. */
export const REPORT_CATEGORIES = [
	{ value: 'spam', label: 'Spam', hint: 'Ads, scams, repeated or automated posts' },
	{
		value: 'harassment',
		label: 'Harassment',
		hint: 'Bullying, insults or threats against someone'
	},
	{ value: 'hate', label: 'Hate', hint: 'Attacks on people for who they are' },
	{ value: 'violence', label: 'Violence', hint: 'Threats or glorifying violence' },
	{ value: 'sexual', label: 'Sexual content', hint: 'Nudity or sexual content' },
	{ value: 'self_harm', label: 'Self-harm', hint: 'Someone may be at risk' },
	{ value: 'impersonation', label: 'Impersonation', hint: 'Pretending to be someone else' },
	{ value: 'other', label: 'Something else', hint: 'Tell the staff what is wrong' }
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value'];

export const categoryLabel = (value: string) =>
	REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;

/** How a log entry reads. */
export const LOG_ACTIONS: Record<string, string> = {
	ban: 'Ban',
	unban: 'Unban',
	mute: 'Mute',
	unmute: 'Unmute',
	role: 'Role change',
	password: 'Password reset',
	delete_post: 'Post deleted',
	delete_group: 'Group deleted',
	note: 'Note',
	report_resolved: 'Report resolved',
	report_dismissed: 'Report dismissed',
	report_reopened: 'Report reopened'
};

/** "in 3 days", "2 hours ago": for when a ban ends. (no Intl.RelativeTimeFormat: Hermes may lack it) */
export function relative(date: string, now = Date.now()) {
	const diff = (new Date(date).getTime() - now) / 1000;
	const abs = Math.abs(diff);
	const units: [string, number][] = [
		['year', 365 * DAY],
		['month', 30 * DAY],
		['week', 7 * DAY],
		['day', DAY],
		['hour', HOUR],
		['minute', 60]
	];
	// half a minute of slack: a ban set for an hour reads "in 1 hour", not "in 60 minutes"
	const [unit, seconds] = units.find(([, s]) => abs + 30 >= s) ?? ['second', 1];
	const n = Math.max(1, Math.round(abs / seconds));
	const text = `${n} ${unit}${n === 1 ? '' : 's'}`;
	return diff >= 0 ? `in ${text}` : `${text} ago`;
}

/** "· ends in 3 days" or "· permanent" */
export const untilLabel = (until: string | null | undefined) =>
	until ? `ends ${relative(until)}` : 'permanent';

/** The ban / mute / password screen (src/app/admin/action.tsx) for an account, with the ban or
 * mute it already has. */
export const actionHref = (
	username: string,
	action: 'ban' | 'mute' | 'password',
	current?: { reason: string | null; until: string | null | undefined } | null
) =>
	withQuery('/admin/action', {
		username,
		action,
		current: current ? '1' : null,
		reason: current?.reason,
		until: current?.until
	});
