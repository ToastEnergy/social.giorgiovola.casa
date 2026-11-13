import type { User } from './types';

/** GET /invites/:code. `bio` and `avatar_url` are missing on servers from before they existed */
export type InviteCheck = {
	code: string;
	inviter: (User & { bio?: string; avatar_url?: string }) | null;
	expires_at: string | null;
};

const CODE_LENGTH = 12;

/**
 * What people type or paste, as the server reads it (src/lib/invites.ts in the web app): any
 * case, spaces and dashes ignored, or a whole invite link.
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
	code.length === CODE_LENGTH && /^[a-z0-9]+$/.test(code);

/** The instance a pasted invite link (https://host/register?invite=…) is for, or null. */
export function serverOfInviteLink(raw: string) {
	const match = /^\s*(https?:\/\/[^/?#\s]+)\/register\?(?:[^#\s]*&)?invite=/i.exec(raw);
	return match ? match[1].toLowerCase() : null;
}

/** "in 5 days", "in 3 hours" */
export function expiresIn(iso: string) {
	const ms = new Date(iso).getTime() - Date.now();
	const days = Math.floor(ms / 86_400_000);
	if (days >= 1) return `in ${days} ${days === 1 ? 'day' : 'days'}`;
	const hours = Math.max(1, Math.ceil(ms / 3_600_000));
	return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** A username suggested from a name: "José Pérez" → "jose_perez" */
export const usernameOf = (name: string, max = 32) =>
	name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, max);
