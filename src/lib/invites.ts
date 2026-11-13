import type { Profile } from './moderation.js';

/** GET /api/v1/invites/{code} */
export type InviteCheck = { code: string; inviter: Profile | null; expires_at: string | null };

export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';

/** An invite code as /api/v1/me/invites and /api/v1/admin/invites list it. */
export type Invite = {
	id: number;
	code: string;
	url: string;
	note: string;
	status: InviteStatus;
	by_staff: boolean;
	created_at: string;
	expires_at: string | null;
	used_at: string | null;
	used_by: Profile | null;
	/** only in the admin list */
	inviter?: Profile | null;
};

/** How many invites an account holds, has out as codes, and can still give. */
export type InviteBalance = { invites: number; pending: number; available: number };

/** GET /api/v1/admin/invites/summary */
export type InviteSummary = {
	held: number;
	available: number;
	pending: number;
	pending_staff: number;
	used: number;
	accounts: (Profile & InviteBalance)[];
};

export const STATUS_LABELS: Record<InviteStatus, string> = {
	pending: 'Pending',
	used: 'Used',
	expired: 'Expired',
	revoked: 'Revoked'
};

/** The link to share, absolute even when the server only knows its path. */
export const linkOf = (invite: Pick<Invite, 'url'>) =>
	new URL(invite.url, location.origin).toString();

/**
 * Copies a link, falling back to a hidden field and execCommand where the clipboard API isn't
 * allowed (an insecure origin). Says whether it worked.
 */
export async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const field = document.createElement('textarea');
		field.value = text;
		field.style.position = 'fixed';
		field.style.opacity = '0';
		document.body.append(field);
		field.select();
		const ok = document.execCommand('copy');
		field.remove();
		return ok;
	}
}

/** How long until a code expires, in words: "in 14 days", "tomorrow", "in 3 hours". */
export function expiresIn(date: string, now = Date.now()) {
	const ms = new Date(date).getTime() - now;
	const hours = Math.floor(ms / 3_600_000);
	if (hours < 1) return 'in less than an hour';
	if (hours < 24) return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
	const days = Math.round(ms / 86_400_000);
	return days === 1 ? 'tomorrow' : `in ${days} days`;
}
