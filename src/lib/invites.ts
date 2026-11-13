import type { Profile } from './moderation.js';

/** GET /api/v1/invites/{code}: who invited, with a picture that loads even on members-only instances */
export type InviteCheck = {
	code: string;
	inviter: (Profile & { bio?: string; avatar_url?: string }) | null;
	expires_at: string | null;
};

/** how long a code is */
export const INVITE_CODE_LENGTH = 12;

/**
 * What people type or paste: any case, spaces and dashes ignored, or a whole invite link. Shared
 * by the server and the sign up page, which checks a code once it looks complete.
 */
export function normalizeInviteCode(raw: string) {
	let value = raw.trim();
	const fromLink = /[?&]invite=([^&#\s]+)/.exec(value);
	if (fromLink) {
		try {
			value = decodeURIComponent(fromLink[1]);
		} catch {
			value = fromLink[1];
		}
	}
	return value.toLowerCase().replace(/[\s-]/g, '');
}

export const isInviteCode = (code: string) =>
	code.length === INVITE_CODE_LENGTH && /^[a-z0-9]+$/.test(code);

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
