import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { db, moderation_log, users } from './db/index.js';
import { hit, isLimited } from './ratelimit.js';
import { closeBotStreams } from './realtime.js';
import { revokeAllSessions } from './session.js';

export type Role = 'user' | 'mod' | 'admin';

const RANK: Record<Role, number> = { user: 0, mod: 1, admin: 2 };

export const isStaff = (role: Role) => role !== 'user';

/** Staff can only act on people ranked strictly below them: mods on users, admins on mods too. */
export const outranks = (actor: Role, target: Role) => RANK[actor] > RANK[target];

// staff actions are cheap to spam by accident (and password resets hash with scrypt)
const WINDOW_MS = 60_000;
const MAX_ACTIONS = 60;

/** True when this staff member is acting too fast. Counts the attempt. */
export function actionsLimited(actorId: number) {
	const key = `moderation:${actorId}`;
	if (isLimited(key, MAX_ACTIONS)) return true;
	hit(key, WINDOW_MS);
	return false;
}

export type ModerationTarget = {
	/** the account: the owner when the username belongs to an identity */
	id: number;
	username: string;
	name: string;
	avatar: string | null;
	role: Role;
	banned_at: Date | null;
	ban_reason: string | null;
	banned_until: Date | null;
	muted_at: Date | null;
	mute_reason: string | null;
	muted_until: Date | null;
	created_at: Date;
};

const targetColumns = {
	id: users.id,
	username: users.username,
	name: users.name,
	avatar: users.avatar,
	role: users.role,
	banned_at: users.banned_at,
	ban_reason: users.ban_reason,
	banned_until: users.banned_until,
	muted_at: users.muted_at,
	mute_reason: users.mute_reason,
	muted_until: users.muted_until,
	created_at: users.created_at
};

/** Moderation always targets the account, so an identity can't be used to dodge a ban or mute. */
export async function findTarget(username: string): Promise<ModerationTarget | null> {
	const [profile] = await db
		.select({ id: users.id, owner_id: users.owner_id })
		.from(users)
		.where(eq(users.username, username.toLowerCase()));
	if (!profile) return null;
	return findTargetById(profile.owner_id ?? profile.id);
}

/** The account with this id, as findTarget answers it. */
export async function findTargetById(id: number): Promise<ModerationTarget | null> {
	const [account] = await db.select(targetColumns).from(users).where(eq(users.id, id));
	return account ?? null;
}

/** Whether the signed in staff member may moderate this target (never themselves). */
export function canModerate(locals: App.Locals, target: Pick<ModerationTarget, 'id' | 'role'>) {
	return (
		locals.accountId !== null &&
		locals.accountId !== target.id &&
		outranks(locals.role, target.role)
	);
}

/** Whether the signed in staff member may delete a post written by an account with this role. */
export const canDeletePostOf = (locals: App.Locals, authorRole: Role) =>
	isStaff(locals.role) && outranks(locals.role, authorRole);

export type LogAction =
	| 'ban'
	| 'unban'
	| 'mute'
	| 'unmute'
	| 'role'
	| 'password'
	| 'delete_post'
	| 'note'
	| 'report_resolved'
	| 'report_dismissed'
	| 'report_reopened';

/** Writes a moderation log entry. `actor` null is the system (a ban that ran out). */
export async function logAction(entry: {
	actor: { id: number; username: string } | null;
	target: { id: number; username: string } | null;
	action: LogAction;
	reason?: string | null;
	expires_at?: Date | null;
	details?: Record<string, unknown> | null;
}) {
	await db.insert(moderation_log).values({
		actor_id: entry.actor?.id ?? null,
		actor_username: entry.actor?.username ?? null,
		target_id: entry.target?.id ?? null,
		target_username: entry.target?.username ?? null,
		action: entry.action,
		reason: entry.reason ?? null,
		expires_at: entry.expires_at ?? null,
		details: entry.details ?? null
	});
}

/**
 * Bans the account, or changes the reason and end of a ban it already has. `until` null bans
 * for good.
 */
export async function banAccount(id: number, reason: string | null, until: Date | null) {
	await db
		.update(users)
		.set({
			banned_at: sql`COALESCE(${users.banned_at}, NOW())`,
			ban_reason: reason,
			banned_until: until
		})
		.where(eq(users.id, id));
	// signs them out everywhere (push subscriptions go with the sessions)
	await revokeAllSessions(id);
	// the bot API checks bans per request, open bot streams have to be ended
	const owned = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.owner_id, id), eq(users.bot, true)));
	closeBotStreams(owned.map((b) => b.id));
}

export const unbanAccount = (id: number) =>
	db
		.update(users)
		.set({ banned_at: null, ban_reason: null, banned_until: null })
		.where(eq(users.id, id));

/** Mutes the account, or changes the reason and end of its mute. `until` null mutes for good. */
export const muteAccount = (id: number, reason: string | null, until: Date | null) =>
	db
		.update(users)
		.set({
			muted_at: sql`COALESCE(${users.muted_at}, NOW())`,
			mute_reason: reason,
			muted_until: until
		})
		.where(eq(users.id, id));

export const unmuteAccount = (id: number) =>
	db
		.update(users)
		.set({ muted_at: null, mute_reason: null, muted_until: null })
		.where(eq(users.id, id));

export const setAccountRole = (id: number, role: Role) =>
	db.update(users).set({ role }).where(eq(users.id, id));

/** Whether a ban (or mute) with this end still holds now. */
export const stillActive = (since: Date | null, until: Date | null) =>
	since !== null && (until === null || until.getTime() > Date.now());

/** Lifts the temporary bans and mutes that ran out, and logs it. */
async function liftExpired() {
	const unbanned = await db
		.update(users)
		.set({ banned_at: null, ban_reason: null, banned_until: null })
		.where(and(isNotNull(users.banned_until), lte(users.banned_until, sql`NOW()`)))
		.returning({ id: users.id, username: users.username });
	const unmuted = await db
		.update(users)
		.set({ muted_at: null, mute_reason: null, muted_until: null })
		.where(and(isNotNull(users.muted_until), lte(users.muted_until, sql`NOW()`)))
		.returning({ id: users.id, username: users.username });
	for (const target of unbanned)
		await logAction({ actor: null, target, action: 'unban', details: { expired: true } });
	for (const target of unmuted)
		await logAction({ actor: null, target, action: 'unmute', details: { expired: true } });
}

/**
 * Whether the account's ban still holds. One that ran out is lifted right away, so signing in
 * doesn't wait for the sweep.
 */
export async function stillBanned(account: {
	id: number;
	username: string;
	banned_at: Date | null;
	banned_until: Date | null;
}) {
	if (!account.banned_at) return false;
	if (stillActive(account.banned_at, account.banned_until)) return true;
	const lifted = await db
		.update(users)
		.set({ banned_at: null, ban_reason: null, banned_until: null })
		.where(
			and(
				eq(users.id, account.id),
				isNotNull(users.banned_until),
				lte(users.banned_until, sql`NOW()`)
			)
		)
		.returning({ id: users.id });
	if (lifted.length > 0)
		await logAction({ actor: null, target: account, action: 'unban', details: { expired: true } });
	return false;
}

// a temporary ban or mute ends within a minute of its time (login also lets an ended ban in)
setInterval(() => {
	liftExpired().catch((e) => console.error('moderation: lifting expired bans failed', e));
}, 60_000).unref?.();

/** What a muted account is told when it tries to post or send a message. */
export const mutedMessage = (locals: App.Locals) =>
	`You are muted and can't post or send messages.${
		locals.muteReason ? ` Reason: ${locals.muteReason}` : ''
	}`;

/** What a banned account is told when it signs in. */
export const bannedMessage = (reason: string | null, until: Date | null) =>
	`This account has been banned${until ? ` until ${until.toUTCString()}` : ''}.${
		reason ? ` Reason: ${reason}` : ''
	}`;
