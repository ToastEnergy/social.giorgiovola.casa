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
