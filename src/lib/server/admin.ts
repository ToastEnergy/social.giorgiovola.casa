import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, identity_members, moderation_log, posts, reports, users } from './db/index.js';
import { fail } from './api.js';
import { hashPassword } from './password.js';
import {
	actionsLimited,
	banAccount,
	canModerate,
	findTarget,
	isStaff,
	logAction,
	muteAccount,
	setAccountRole,
	unbanAccount,
	unmuteAccount,
	type LogAction,
	type ModerationTarget
} from './moderation.js';
import { validatePassword } from './validation.js';
import { revokeAllSessions } from './session.js';
import { MAX_MOTD, setMotd } from './motd.js';

export const ADMIN_FILTERS = ['all', 'banned', 'muted', 'staff', 'reported'] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];
export const MAX_REASON = 200;
export const MAX_NOTE = 1000;
/** the longest temporary ban or mute, in seconds; longer is for good */
export const MAX_DURATION = 365 * 24 * 60 * 60;
export const MIN_DURATION = 60;

export const LOG_ACTIONS: LogAction[] = [
	'ban',
	'unban',
	'mute',
	'unmute',
	'role',
	'password',
	'delete_post',
	'note',
	'report_resolved',
	'report_dismissed',
	'report_reopened'
];

/** open reports against the account or any of its identities */
const openReportsOf = (accountId: SQL | number) => sql<number>`(
	SELECT count(*)::int FROM reports r JOIN users t ON t.id = r.target_id
	WHERE r.status = 'open' AND COALESCE(t.owner_id, t.id) = ${accountId})`;

/**
 * Accounts for the moderation list, newest first (`limit + 1` rows), with what the signed in
 * staff member may do to each. Identities follow the account that owns them, so only accounts are
 * listed, with their identities and the identities shared with them.
 */
export async function listAccounts(
	locals: App.Locals,
	{ q, filter, limit, offset }: { q: string; filter: AdminFilter; limit: number; offset: number }
) {
	const filters: (SQL | undefined)[] = [isNull(users.owner_id)];
	if (q) {
		const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
		filters.push(
			or(
				sql`${users.username} ILIKE ${like}`,
				sql`${users.name} ILIKE ${like}`,
				// searching an identity (or bot) finds the account behind it, and so does one shared
				// with the account; the table names are written out so they can't be mis-qualified
				sql`EXISTS (SELECT 1 FROM users i WHERE i.owner_id = users.id
					AND (i.username ILIKE ${like} OR i.name ILIKE ${like}))`,
				sql`EXISTS (SELECT 1 FROM identity_members m JOIN users i ON i.id = m.identity_id
					WHERE m.account_id = users.id AND (i.username ILIKE ${like} OR i.name ILIKE ${like}))`
			)
		);
	}
	if (filter === 'banned') filters.push(isNotNull(users.banned_at));
	if (filter === 'muted') filters.push(isNotNull(users.muted_at));
	if (filter === 'staff') filters.push(ne(users.role, 'user'));
	if (filter === 'reported') filters.push(sql`${openReportsOf(sql`users.id`)} > 0`);

	const rows = await db
		.select({
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
			created_at: users.created_at,
			open_reports: openReportsOf(sql`users.id`)
		})
		.from(users)
		.where(and(...filters))
		.orderBy(
			// the reported list puts the most reported first
			...(filter === 'reported' ? [desc(openReportsOf(sql`users.id`))] : []),
			desc(users.created_at),
			desc(users.id)
		)
		.limit(limit + 1)
		.offset(offset);

	const identities = await loadIdentities(rows.map((r) => r.id));
	// ids stay on the server
	return rows.map(({ id, ...row }) => ({
		...row,
		...identities(id),
		...permissions(locals, { id, role: row.role })
	}));
}

const permissions = (locals: App.Locals, target: Pick<ModerationTarget, 'id' | 'role'>) => {
	const allowed = canModerate(locals, target);
	return {
		self: target.id === locals.accountId,
		can_moderate: allowed,
		can_manage: locals.role === 'admin' && allowed
	};
};

/**
 * The identities (and bots) each account owns, with who they are shared with, and the
 * identities of others shared with it, so staff can see who is behind a profile.
 */
async function loadIdentities(accountIds: number[]) {
	if (accountIds.length === 0) return () => ({ identities: [], shared_with: [] });

	const owned = await db
		.select({
			id: users.id,
			owner_id: users.owner_id,
			username: users.username,
			name: users.name,
			avatar: users.avatar,
			bot: users.bot
		})
		.from(users)
		.where(inArray(users.owner_id, accountIds))
		.orderBy(asc(users.created_at), asc(users.id));

	const member = alias(users, 'member');
	const members =
		owned.length === 0
			? []
			: await db
					.select({ identity_id: identity_members.identity_id, username: member.username })
					.from(identity_members)
					.innerJoin(member, eq(member.id, identity_members.account_id))
					.where(
						inArray(
							identity_members.identity_id,
							owned.map((i) => i.id)
						)
					)
					.orderBy(asc(identity_members.created_at));

	const identity = alias(users, 'identity');
	const owner = alias(users, 'owner');
	const shared = await db
		.select({
			account_id: identity_members.account_id,
			username: identity.username,
			name: identity.name,
			avatar: identity.avatar,
			owner_username: owner.username
		})
		.from(identity_members)
		.innerJoin(identity, eq(identity.id, identity_members.identity_id))
		.innerJoin(owner, eq(owner.id, identity.owner_id))
		.where(inArray(identity_members.account_id, accountIds))
		.orderBy(asc(identity_members.created_at));

	return (accountId: number) => ({
		identities: owned
			.filter((i) => i.owner_id === accountId)
			.map((i) => ({
				username: i.username,
				name: i.name,
				avatar: i.avatar,
				bot: i.bot,
				members: members.filter((m) => m.identity_id === i.id).map((m) => m.username)
			})),
		shared_with: shared
			.filter((s) => s.account_id === accountId)
			.map((s) => ({
				username: s.username,
				name: s.name,
				avatar: s.avatar,
				owner_username: s.owner_username
			}))
	});
}

/**
 * One account as its moderation page shows it: its state, identities, what the caller may do,
 * and counts of its posts, followers and reports. `username` may be one of its identities.
 */
export async function getAccount(locals: App.Locals, username: string) {
	const target = await findTarget(username);
	if (!target) fail(404, 'User not found.');
	// the account and its identities
	const profiles = sql`(SELECT id FROM users WHERE id = ${target.id} OR owner_id = ${target.id})`;
	const [counts] = await db.execute<{
		posts: number;
		followers: number;
		open_reports: number;
		reports: number;
		reports_made: number;
		log_entries: number;
	}>(sql`SELECT
		(SELECT count(*)::int FROM posts WHERE user_id IN ${profiles}) AS posts,
		(SELECT count(*)::int FROM follows WHERE followed_id = ${target.id}) AS followers,
		${openReportsOf(target.id)} AS open_reports,
		(SELECT count(*)::int FROM reports r WHERE r.target_id IN ${profiles}) AS reports,
		(SELECT count(*)::int FROM reports r WHERE r.reporter_id IN ${profiles}) AS reports_made,
		(SELECT count(*)::int FROM moderation_log WHERE target_id = ${target.id}) AS log_entries`);
	const [email] = await db
		.select({ email: users.email })
		.from(users)
		.where(eq(users.id, target.id));
	const { id, ...account } = target;
	return {
		...account,
		// only admins see addresses (they reset passwords)
		email: locals.role === 'admin' ? email?.email ?? null : null,
		via: target.username !== username.toLowerCase() ? username.toLowerCase() : null,
		...(await loadIdentities([id]))(id),
		...permissions(locals, target),
		stats: counts
	};
}

/** Who is acting, as the log records it: the account, not the identity in use. */
async function actorOf(locals: App.Locals) {
	const id = locals.accountId!;
	if (locals.user && locals.user.id === id) return { id, username: locals.user.username };
	const [row] = await db.select({ username: users.username }).from(users).where(eq(users.id, id));
	return { id, username: row?.username ?? '' };
}

/**
 * The account behind `username` (an account or one of its identities), once the caller is
 * allowed to act on it.
 */
async function authorize(locals: App.Locals, username: string, adminOnly = false) {
	if (!locals.user || locals.accountId === null || !isStaff(locals.role))
		fail(403, 'Only moderators and admins can do this');
	if (adminOnly && locals.role !== 'admin') fail(403, 'Only admins can do this');
	if (actionsLimited(locals.accountId)) fail(429, 'Too many actions, slow down.');
	const target = await findTarget(username);
	if (!target) fail(404, 'User not found.');
	if (!canModerate(locals, target)) fail(403, `You can't moderate @${target.username}.`);
	return { target, actor: await actorOf(locals) };
}

const reasonOf = (raw: string) => raw.trim().slice(0, MAX_REASON) || null;

/** `duration` in seconds from a request body: null (for good) when missing or null. */
export function durationField(body: Record<string, unknown>): number | null {
	const value = body.duration;
	if (value === undefined || value === null) return null;
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < MIN_DURATION ||
		value > MAX_DURATION
	)
		fail(
			400,
			`duration must be a whole number of seconds between ${MIN_DURATION} and ${MAX_DURATION}, or null`
		);
	return value;
}

const untilOf = (duration: number | null) =>
	duration === null ? null : new Date(Date.now() + duration * 1000);

const untilText = (until: Date | null) => (until ? ` until ${until.toUTCString()}` : '');

export async function ban(
	locals: App.Locals,
	username: string,
	reason: string,
	duration: number | null
) {
	const { target, actor } = await authorize(locals, username);
	const until = untilOf(duration);
	const why = reasonOf(reason);
	await banAccount(target.id, why, until);
	await logAction({ actor, target, action: 'ban', reason: why, expires_at: until });
	return {
		message: `${target.banned_at ? 'Updated the ban of' : 'Banned'} @${target.username}${untilText(
			until
		)}.`,
		expires_at: until
	};
}

export async function unban(locals: App.Locals, username: string) {
	const { target, actor } = await authorize(locals, username);
	await unbanAccount(target.id);
	if (target.banned_at) await logAction({ actor, target, action: 'unban' });
	return { message: `Unbanned @${target.username}.` };
}

export async function mute(
	locals: App.Locals,
	username: string,
	reason: string,
	duration: number | null
) {
	const { target, actor } = await authorize(locals, username);
	const until = untilOf(duration);
	const why = reasonOf(reason);
	await muteAccount(target.id, why, until);
	await logAction({ actor, target, action: 'mute', reason: why, expires_at: until });
	return {
		message: `${target.muted_at ? 'Updated the mute of' : 'Muted'} @${target.username}${untilText(
			until
		)}.`,
		expires_at: until
	};
}

export async function unmute(locals: App.Locals, username: string) {
	const { target, actor } = await authorize(locals, username);
	await unmuteAccount(target.id);
	if (target.muted_at) await logAction({ actor, target, action: 'unmute' });
	return { message: `Unmuted @${target.username}.` };
}

/** Makes an account a mod, or a regular user again. Admins are made with `bun admin.ts`. */
export async function setRole(locals: App.Locals, username: string, role: unknown) {
	if (role !== 'mod' && role !== 'user') fail(400, 'role must be "mod" or "user"');
	const { target, actor } = await authorize(locals, username, true);
	await setAccountRole(target.id, role);
	if (target.role !== role)
		await logAction({ actor, target, action: 'role', details: { from: target.role, to: role } });
	return {
		message:
			role === 'mod'
				? `@${target.username} is now a mod.`
				: `@${target.username} is no longer a mod.`
	};
}

/** Sets a new password and signs the account out everywhere. Admin only. */
export async function resetPassword(locals: App.Locals, username: string, password: string) {
	const { target, actor } = await authorize(locals, username, true);
	const invalid = validatePassword(password);
	if (invalid) fail(400, invalid);
	const { salt, hash } = await hashPassword(password);
	await db.update(users).set({ password: hash, salt }).where(eq(users.id, target.id));
	await revokeAllSessions(target.id);
	await logAction({ actor, target, action: 'password' });
	return { message: `Password of @${target.username} reset.` };
}

/**
 * A note staff leave on an account, for the other staff: it goes in the moderation log. Staff
 * may note any account they can see, also ones they can't act on (their own, other staff).
 */
export async function addNote(locals: App.Locals, username: string, note: string) {
	if (locals.accountId === null || !isStaff(locals.role))
		fail(403, 'Only moderators and admins can do this');
	if (actionsLimited(locals.accountId)) fail(429, 'Too many actions, slow down.');
	const clean = note.trim();
	if (!clean) fail(400, 'note is empty');
	if (clean.length > MAX_NOTE) fail(400, `A note can be at most ${MAX_NOTE} characters.`);
	const target = await findTarget(username);
	if (!target) fail(404, 'User not found.');
	await logAction({ actor: await actorOf(locals), target, action: 'note', reason: clean });
	return { message: 'Note added.' };
}

/**
 * The moderation log, newest first (`limit + 1` rows before the id `cursor`): of one account
 * (`username`, or one of its identities), by one staff member (`actor`), or of one action.
 */
export async function listLog({
	username,
	actor,
	action,
	cursor,
	limit
}: {
	username: string;
	actor: string;
	action: string;
	cursor: number | null;
	limit: number;
}) {
	const filters: (SQL | undefined)[] = [];
	if (username) {
		const target = await findTarget(username);
		if (!target) return [];
		filters.push(eq(moderation_log.target_id, target.id));
	}
	if (actor) {
		const staff = await findTarget(actor);
		if (!staff) return [];
		filters.push(eq(moderation_log.actor_id, staff.id));
	}
	if (action) filters.push(eq(moderation_log.action, action));
	if (cursor !== null) filters.push(lt(moderation_log.id, cursor));

	const actorUser = alias(users, 'actor_user');
	const targetUser = alias(users, 'target_user');
	const rows = await db
		.select({
			id: moderation_log.id,
			action: moderation_log.action,
			// the current username, the one written down once the profile is gone
			actor: sql<string | null>`COALESCE(${actorUser.username}, ${moderation_log.actor_username})`,
			target: sql<
				string | null
			>`COALESCE(${targetUser.username}, ${moderation_log.target_username})`,
			target_name: targetUser.name,
			target_avatar: targetUser.avatar,
			reason: moderation_log.reason,
			expires_at: moderation_log.expires_at,
			details: moderation_log.details,
			created_at: moderation_log.created_at
		})
		.from(moderation_log)
		.leftJoin(actorUser, eq(actorUser.id, moderation_log.actor_id))
		.leftJoin(targetUser, eq(targetUser.id, moderation_log.target_id))
		.where(and(...filters))
		.orderBy(desc(moderation_log.id))
		.limit(limit + 1);
	return rows.map(({ target_name, target_avatar, ...row }) => ({
		...row,
		// system entries (a ban that ran out) have no actor
		system: row.actor === null,
		target_profile:
			row.target && target_name !== null
				? { username: row.target, name: target_name, avatar: target_avatar }
				: null
	}));
}

/** Counts for the top of the moderation panel. */
export async function overview() {
	const week = sql`NOW() - interval '7 days'`;
	const [open_reports, accounts, new_accounts, banned, muted, staff, posts_today, actions_week] =
		await Promise.all([
			db.$count(reports, eq(reports.status, 'open')),
			db.$count(users, isNull(users.owner_id)),
			db.$count(users, and(isNull(users.owner_id), gte(users.created_at, week))),
			db.$count(users, isNotNull(users.banned_at)),
			db.$count(users, isNotNull(users.muted_at)),
			db.$count(users, ne(users.role, 'user')),
			db.$count(posts, gte(posts.created_at, sql`NOW() - interval '1 day'`)),
			// what staff did, not the bans that ran out
			db.$count(
				moderation_log,
				and(gte(moderation_log.created_at, week), isNotNull(moderation_log.actor_id))
			)
		]);
	return { open_reports, accounts, new_accounts, banned, muted, staff, posts_today, actions_week };
}

/** Sets the message of the day shown in the post composer; empty resets it. Admin only. */
export async function updateMotd(locals: App.Locals, motd: string) {
	if (locals.role !== 'admin' || locals.accountId === null) fail(403, 'Only admins can do this');
	if (actionsLimited(locals.accountId)) fail(429, 'Too many actions, slow down.');
	// one line: it is an input placeholder
	const clean = motd.replace(/\s+/g, ' ').trim();
	if (clean.length > MAX_MOTD) fail(400, `The message can be at most ${MAX_MOTD} characters.`);
	await setMotd(clean);
	return {
		motd: clean,
		message: clean ? 'Message of the day updated.' : 'Message of the day reset.'
	};
}
