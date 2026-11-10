import { api } from './api.js';

export type Role = 'user' | 'mod' | 'admin';
export type ModerationAction = 'ban' | 'unban' | 'mute' | 'unmute' | 'role' | 'password';

/** Runs a staff action on the account behind `username`. Resolves with what to tell the user. */
export function moderate(
	username: string,
	action: ModerationAction,
	fields: { reason?: string; duration?: number | null; role?: string; password?: string } = {}
) {
	const base = `admin/users/${encodeURIComponent(username)}`;
	const timed = { reason: fields.reason ?? '', duration: fields.duration ?? null };
	const [path, method, json] = {
		ban: [`${base}/ban`, 'PUT', timed],
		unban: [`${base}/ban`, 'DELETE', undefined],
		mute: [`${base}/mute`, 'PUT', timed],
		unmute: [`${base}/mute`, 'DELETE', undefined],
		role: [`${base}/role`, 'PUT', { role: fields.role }],
		password: [`${base}/password`, 'PUT', { password: fields.password }]
	}[action] as [string, string, unknown];
	return api<{ message: string }>(path, { method, json });
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

/** Reasons people pick from when they report, in the order the dialog lists them. */
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

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/** GET /api/v1/admin/reports */
export type Report = {
	id: number;
	kind: 'post' | 'profile';
	category: string;
	details: string;
	status: ReportStatus;
	created_at: string;
	resolved_at: string | null;
	resolution_note: string | null;
	resolved_by: string | null;
	reporter: Profile;
	target: Profile;
	post: {
		id: number | null;
		content: string;
		images: string[];
		deleted: boolean;
		edited: boolean;
	} | null;
	account: { username: string; role: Role; banned: boolean; muted: boolean };
	related_open: number;
	can_moderate: boolean;
};

export type Profile = { username: string; name: string; avatar: string | null };

/** GET /api/v1/admin/log */
export type LogEntry = {
	id: number;
	action: string;
	actor: string | null;
	target: string | null;
	target_profile: Profile | null;
	reason: string | null;
	expires_at: string | null;
	details: Record<string, unknown> | null;
	created_at: string;
	system: boolean;
};

/** The state every account row and page shows. */
export type AccountState = {
	username: string;
	name: string;
	avatar: string | null;
	role: Role;
	banned_at: string | null;
	ban_reason: string | null;
	banned_until: string | null;
	muted_at: string | null;
	mute_reason: string | null;
	muted_until: string | null;
	created_at: string;
	identities: (Profile & { bot: boolean; members: string[] })[];
	shared_with: (Profile & { owner_username: string })[];
	self: boolean;
	can_moderate: boolean;
	can_manage: boolean;
};

/** GET /api/v1/admin/users */
export type AccountRow = AccountState & { open_reports: number };

/** GET /api/v1/admin/users/{username} */
export type Account = AccountState & {
	email: string | null;
	via: string | null;
	stats: {
		posts: number;
		followers: number;
		open_reports: number;
		reports: number;
		reports_made: number;
		log_entries: number;
	};
};

/** GET /api/v1/admin/overview */
export type Overview = {
	open_reports: number;
	accounts: number;
	new_accounts: number;
	banned: number;
	muted: number;
	staff: number;
	posts_today: number;
	actions_week: number;
};

/** How a log entry reads: "banned", "deleted a post of"… */
export const LOG_ACTIONS: Record<string, string> = {
	ban: 'Ban',
	unban: 'Unban',
	mute: 'Mute',
	unmute: 'Unmute',
	role: 'Role change',
	password: 'Password reset',
	delete_post: 'Post deleted',
	note: 'Note',
	report_resolved: 'Report resolved',
	report_dismissed: 'Report dismissed',
	report_reopened: 'Report reopened'
};

/** "in 3 days", "2 hours ago": for when a ban ends. */
export function relative(date: string | Date, now = Date.now()) {
	const diff = (new Date(date).getTime() - now) / 1000;
	const abs = Math.abs(diff);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 365 * DAY],
		['month', 30 * DAY],
		['week', 7 * DAY],
		['day', DAY],
		['hour', HOUR],
		['minute', 60]
	];
	for (const [unit, seconds] of units)
		if (abs >= seconds) return rtf.format(Math.round(diff / seconds), unit);
	return rtf.format(Math.round(diff), 'second');
}
