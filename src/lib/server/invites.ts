import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PUBLIC_URL } from '$app/env/public';
import { db, invites, users } from './db/index.js';
import { fail } from './api.js';
import { actionsLimited, findTarget, logAction } from './moderation.js';
import { INVITE_CODE_LENGTH, isInviteCode, normalizeInviteCode } from '../invites.js';

/**
 * Invites: the only way to sign up once the instance has an account. Admins give accounts a
 * number of invites (users.invites) and each one becomes a single use code when the account
 * creates it. A code only uses up the invite when someone signs up with it, so revoking it or
 * letting it expire gives it back: what an account can still hand out is its balance minus its
 * pending codes. Admins can also create codes outside any balance (by_staff).
 */

/** how long a code works */
export const INVITE_DAYS = 14;
export const MAX_INVITE_DAYS = 365;
export const MAX_INVITE_NOTE = 100;
/** the most invites one account can hold, and the most given at once */
export const MAX_BALANCE = 1000;
export const MAX_GRANT = 100;
/** the most codes an admin creates in one go */
export const MAX_BATCH = 50;

// no 0/o, 1/l/i: codes get read out and typed by hand. 12 of 31 symbols is about 59 bits, and
// wrong guesses are rate limited like the signup password was
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = INVITE_CODE_LENGTH;

function newCode() {
	let code = '';
	// rejection sampling keeps every symbol equally likely (256 isn't a multiple of 31)
	const limit = 256 - (256 % ALPHABET.length);
	while (code.length < CODE_LENGTH) {
		for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2))) {
			if (byte < limit && code.length < CODE_LENGTH) code += ALPHABET[byte % ALPHABET.length];
		}
	}
	return code;
}

const normalizeCode = normalizeInviteCode;
const isCode = isInviteCode;

/** The link to share: absolute when PUBLIC_URL is set. */
export const inviteUrl = (code: string) =>
	`${PUBLIC_URL.replace(/\/$/, '')}/register?invite=${code}`;

/** The inviter's picture for someone holding the code, who may not be signed in yet. */
const inviterAvatarUrl = (code: string) =>
	`${PUBLIC_URL.replace(/\/$/, '')}/api/v1/invites/${code}/avatar`;

export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';

// codes that can still be used, given the time of the query
const pendingSql = and(
	isNull(invites.used_at),
	isNull(invites.revoked_at),
	or(isNull(invites.expires_at), gt(invites.expires_at, sql`NOW()`))
)!;

const statusSql = sql<InviteStatus>`CASE
	WHEN ${invites.used_at} IS NOT NULL THEN 'used'
	WHEN ${invites.revoked_at} IS NOT NULL THEN 'revoked'
	WHEN ${invites.expires_at} IS NOT NULL AND ${invites.expires_at} <= NOW() THEN 'expired'
	ELSE 'pending' END`;

const usedByUser = alias(users, 'used_by_user');
const inviterUser = alias(users, 'inviter_user');

const usedByProfile = {
	username: usedByUser.username,
	name: usedByUser.name,
	avatar: usedByUser.avatar
};
const inviterProfile = {
	username: inviterUser.username,
	name: inviterUser.name,
	avatar: inviterUser.avatar
};

type Profile = { username: string; name: string; avatar: string | null };

/** An invite as the API shows it. */
function present(row: {
	id: number;
	code: string;
	note: string;
	by_staff: boolean;
	status: InviteStatus;
	created_at: Date;
	expires_at: Date | null;
	used_at: Date | null;
	used_by: Profile | null;
	inviter?: Profile | null;
}) {
	return {
		id: row.id,
		// a used code is spent, only the people involved matter then
		code: row.code,
		url: inviteUrl(row.code),
		note: row.note,
		status: row.status,
		by_staff: row.by_staff,
		created_at: row.created_at,
		expires_at: row.expires_at,
		used_at: row.used_at,
		used_by: row.used_by?.username ? row.used_by : null,
		...(row.inviter !== undefined ? { inviter: row.inviter?.username ? row.inviter : null } : {})
	};
}

export type Invite = ReturnType<typeof present>;

const columns = {
	id: invites.id,
	code: invites.code,
	note: invites.note,
	by_staff: invites.by_staff,
	status: statusSql,
	created_at: invites.created_at,
	expires_at: invites.expires_at,
	used_at: invites.used_at,
	used_by: usedByProfile
};

/** How many pending codes an account has out. */
async function pendingOf(accountId: number, tx: Pick<typeof db, 'select'> = db) {
	const [row] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(invites)
		.where(and(eq(invites.inviter_id, accountId), eq(invites.by_staff, false), pendingSql));
	return row.n;
}

/** The invites an account holds: all of them, the ones out as codes, the ones it can still give. */
export async function balanceOf(accountId: number) {
	const [[account], pending] = await Promise.all([
		db.select({ invites: users.invites }).from(users).where(eq(users.id, accountId)),
		pendingOf(accountId)
	]);
	const invites = account?.invites ?? 0;
	return { invites, pending, available: Math.max(0, invites - pending) };
}

/** The codes an account made, newest first (`limit + 1` rows before the id `cursor`). */
export async function listMyInvites(accountId: number, cursor: number | null, limit: number) {
	const rows = await db
		.select(columns)
		.from(invites)
		.leftJoin(usedByUser, eq(usedByUser.id, invites.used_by))
		.where(
			and(eq(invites.inviter_id, accountId), cursor !== null ? lt(invites.id, cursor) : undefined)
		)
		.orderBy(desc(invites.id))
		.limit(limit + 1);
	return rows.map(present);
}

function noteOf(raw: string) {
	const note = raw.replace(/\s+/g, ' ').trim();
	if (note.length > MAX_INVITE_NOTE)
		fail(400, `The note can be at most ${MAX_INVITE_NOTE} characters.`);
	return note;
}

const expiresIn = (days: number | null) =>
	days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/** Inserts codes, retrying the (astronomically unlikely) clash with an existing one. */
async function insertCodes(
	tx: Pick<typeof db, 'insert'>,
	values: Omit<typeof invites.$inferInsert, 'code'>[]
) {
	for (let attempt = 0; ; attempt++) {
		const rows = await tx
			.insert(invites)
			.values(values.map((v) => ({ ...v, code: newCode() })))
			.onConflictDoNothing({ target: invites.code })
			.returning({ id: invites.id });
		if (rows.length === values.length || attempt === 2) return rows.map((r) => r.id);
		// some were dropped: only those are made again
		values = values.slice(rows.length);
	}
}

async function getInvites(ids: number[]) {
	if (ids.length === 0) return [];
	const rows = await db
		.select({ ...columns, inviter: inviterProfile })
		.from(invites)
		.leftJoin(usedByUser, eq(usedByUser.id, invites.used_by))
		.leftJoin(inviterUser, eq(inviterUser.id, invites.inviter_id))
		.where(inArray(invites.id, ids))
		.orderBy(desc(invites.id));
	return rows.map(present);
}

/** Turns one of the account's invites into a code. */
export async function createInvite(accountId: number, rawNote: string) {
	const note = noteOf(rawNote);
	const id = await db.transaction(async (tx) => {
		// the row lock makes concurrent creates count each other's codes
		const [account] = await tx
			.select({ invites: users.invites })
			.from(users)
			.where(eq(users.id, accountId))
			.for('update');
		const pending = await pendingOf(accountId, tx);
		if (!account || account.invites - pending <= 0)
			fail(
				403,
				account?.invites
					? 'All your invites are out as codes: revoke one or wait for it to be used.'
					: "You don't have any invites. Ask an admin for some."
			);
		const [id] = await insertCodes(tx, [
			{ inviter_id: accountId, note, expires_at: expiresIn(INVITE_DAYS) }
		]);
		return id;
	});
	return (await getInvites([id]))[0];
}

/**
 * Revokes a pending code: the account's own (`ownerId`), or any as an admin (null). An invite
 * from a balance goes back to it.
 */
export async function revokeInvite(id: number, ownerId: number | null) {
	const [row] = await db
		.update(invites)
		.set({ revoked_at: sql`NOW()` })
		.where(
			and(
				eq(invites.id, id),
				ownerId !== null ? eq(invites.inviter_id, ownerId) : undefined,
				pendingSql
			)
		)
		.returning({ id: invites.id });
	if (!row) {
		const [exists] = await db
			.select({ inviter_id: invites.inviter_id })
			.from(invites)
			.where(eq(invites.id, id));
		if (!exists || (ownerId !== null && exists.inviter_id !== ownerId))
			fail(404, 'Invite not found.');
		fail(409, 'This invite was already used, revoked or has expired.');
	}
	return { message: 'Invite revoked.' };
}

/** What the sign up page shows for a code: who invited, or null when it can't be used. */
export async function lookupInvite(rawCode: string) {
	const code = normalizeCode(rawCode);
	if (!isCode(code)) return null;
	const [row] = await db
		.select({
			expires_at: invites.expires_at,
			by_staff: invites.by_staff,
			inviter: { ...inviterProfile, bio: inviterUser.bio },
			inviter_banned: inviterUser.banned_at,
			inviter_invites: inviterUser.invites
		})
		.from(invites)
		.leftJoin(inviterUser, eq(inviterUser.id, invites.inviter_id))
		.where(and(eq(invites.code, code), pendingSql));
	if (!row || !usable(row)) return null;
	return {
		code,
		// the code is all the holder has: on a members-only instance the profile and its avatar
		// are out of reach until they sign up, so the picture comes through the code too
		inviter: row.inviter?.username
			? { ...row.inviter, bio: row.inviter.bio ?? '', avatar_url: inviterAvatarUrl(code) }
			: null,
		expires_at: row.expires_at
	};
}

/** Whether a pending code still works: a balance code needs an inviter in good standing. */
const usable = (row: {
	by_staff: boolean;
	inviter_banned: Date | null;
	inviter_invites: number | null;
}) =>
	row.by_staff || (row.inviter_invites !== null && row.inviter_invites > 0 && !row.inviter_banned);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Uses a code for the account `accountId` just created in `tx`, taking the invite from the
 * inviter's balance. False when the code can't be used (the transaction should be rolled back).
 */
export async function redeemInvite(tx: Tx, rawCode: string, accountId: number) {
	const code = normalizeCode(rawCode);
	if (!isCode(code)) return false;
	// locks the code, so two sign ups can't both use it
	const [row] = await tx
		.select({ id: invites.id, by_staff: invites.by_staff, inviter_id: invites.inviter_id })
		.from(invites)
		.where(and(eq(invites.code, code), pendingSql))
		.for('update');
	if (!row) return false;
	if (!row.by_staff) {
		if (row.inviter_id === null) return false;
		const [taken] = await tx
			.update(users)
			.set({ invites: sql`${users.invites} - 1` })
			.where(and(eq(users.id, row.inviter_id), gt(users.invites, 0), isNull(users.banned_at)))
			.returning({ id: users.id });
		if (!taken) return false;
	}
	await tx
		.update(invites)
		.set({ used_at: sql`NOW()`, used_by: accountId })
		.where(eq(invites.id, row.id));
	return true;
}

/** Whether the next account needs an invite: every one but the very first does. */
export async function inviteRequired() {
	const rows = await db.select({ id: users.id }).from(users).where(isNull(users.owner_id)).limit(1);
	return rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// admins

function requireInviteAdmin(locals: App.Locals) {
	if (locals.role !== 'admin' || locals.accountId === null || !locals.user)
		fail(403, 'Only admins can do this');
	if (actionsLimited(locals.accountId)) fail(429, 'Too many actions, slow down.');
	return locals.accountId;
}

async function actorOf(accountId: number) {
	const [row] = await db
		.select({ username: users.username })
		.from(users)
		.where(eq(users.id, accountId));
	return { id: accountId, username: row?.username ?? '' };
}

export function countField(body: Record<string, unknown>, name: string, min: number, max: number) {
	const value = body[name];
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
		fail(400, `${name} must be a whole number between ${min} and ${max}`);
	return value;
}

/** `days` of an admin's codes: 14 when missing, null for never. */
export function daysField(body: Record<string, unknown>) {
	if (body.days === undefined) return INVITE_DAYS;
	if (body.days === null) return null;
	return countField(body, 'days', 1, MAX_INVITE_DAYS);
}

/** Codes an admin makes outside any balance. */
export async function createStaffInvites(
	locals: App.Locals,
	{ note, count, days }: { note: string; count: number; days: number | null }
) {
	const actor = requireInviteAdmin(locals);
	const clean = noteOf(note);
	const ids = await insertCodes(
		db,
		Array.from({ length: count }, () => ({
			inviter_id: actor,
			by_staff: true,
			note: clean,
			expires_at: expiresIn(days)
		}))
	);
	return { items: await getInvites(ids) };
}

export const INVITE_FILTERS = ['all', 'pending', 'used', 'expired', 'revoked'] as const;
export type InviteFilter = (typeof INVITE_FILTERS)[number];

/**
 * Every code, newest first (`limit + 1` rows before the id `cursor`): of one status, made by one
 * account (`username`, or one of its identities) or used by it.
 */
export async function listInvites({
	status,
	username,
	cursor,
	limit
}: {
	status: InviteFilter;
	username: string;
	cursor: number | null;
	limit: number;
}) {
	const filters: (SQL | undefined)[] = [];
	if (status !== 'all') filters.push(sql`${statusSql} = ${status}`);
	if (username) {
		const target = await findTarget(username);
		if (!target) return [];
		filters.push(or(eq(invites.inviter_id, target.id), eq(invites.used_by, target.id)));
	}
	if (cursor !== null) filters.push(lt(invites.id, cursor));
	const rows = await db
		.select({ ...columns, inviter: inviterProfile })
		.from(invites)
		.leftJoin(usedByUser, eq(usedByUser.id, invites.used_by))
		.leftJoin(inviterUser, eq(inviterUser.id, invites.inviter_id))
		.where(and(...filters))
		.orderBy(desc(invites.id))
		.limit(limit + 1);
	return rows.map(present);
}

/**
 * How many invites there are: what accounts can still hand out, what is out as codes, what got
 * used, and the accounts holding invites (most first).
 */
export async function inviteSummary() {
	const pendingByAccount = db
		.select({
			inviter_id: invites.inviter_id,
			n: sql<number>`count(*)::int`.as('n')
		})
		.from(invites)
		.where(and(eq(invites.by_staff, false), pendingSql))
		.groupBy(invites.inviter_id)
		.as('p');
	const holders = await db
		.select({
			username: users.username,
			name: users.name,
			avatar: users.avatar,
			invites: users.invites,
			pending: sql<number>`COALESCE(${pendingByAccount.n}, 0)`
		})
		.from(users)
		.leftJoin(pendingByAccount, eq(pendingByAccount.inviter_id, users.id))
		.where(and(isNull(users.owner_id), gt(users.invites, 0)))
		.orderBy(desc(users.invites), users.username);
	const [counts] = await db
		.select({
			pending_staff: sql<number>`count(*) FILTER (WHERE ${invites.by_staff} AND ${pendingSql})::int`,
			used: sql<number>`count(*) FILTER (WHERE ${isNotNull(invites.used_at)})::int`
		})
		.from(invites);
	const held = holders.reduce((sum, h) => sum + h.invites, 0);
	const pending = holders.reduce((sum, h) => sum + h.pending, 0);
	return {
		// invites accounts hold, codes out included
		held,
		// of those, the ones still to be turned into codes
		available: held - pending,
		// codes waiting to be used: from balances, and made by admins
		pending,
		pending_staff: counts.pending_staff,
		used: counts.used,
		accounts: holders.map((h) => ({
			username: h.username,
			name: h.name,
			avatar: h.avatar,
			invites: h.invites,
			pending: h.pending,
			available: h.invites - h.pending
		}))
	};
}

/**
 * Sets how many invites an account holds. Lowering it below the codes it has out revokes the
 * newest of them, so every pending code stays backed by an invite.
 */
export async function setInvites(locals: App.Locals, username: string, count: number) {
	const actorId = requireInviteAdmin(locals);
	const target = await findTarget(username);
	if (!target) fail(404, 'User not found.');
	const { from, revoked } = await db.transaction(async (tx) => {
		const [account] = await tx
			.select({ invites: users.invites })
			.from(users)
			.where(eq(users.id, target.id))
			.for('update');
		await tx.update(users).set({ invites: count }).where(eq(users.id, target.id));
		const pending = await tx
			.select({ id: invites.id })
			.from(invites)
			.where(and(eq(invites.inviter_id, target.id), eq(invites.by_staff, false), pendingSql))
			.orderBy(desc(invites.id));
		const extra = pending.slice(0, Math.max(0, pending.length - count)).map((p) => p.id);
		if (extra.length > 0)
			await tx
				.update(invites)
				.set({ revoked_at: sql`NOW()` })
				.where(inArray(invites.id, extra));
		return { from: account.invites, revoked: extra.length };
	});
	if (from !== count)
		await logAction({
			actor: await actorOf(actorId),
			target,
			action: 'invites',
			details: { from, to: count, revoked }
		});
	return {
		invites: count,
		message:
			`@${target.username} now has ${count} ${count === 1 ? 'invite' : 'invites'}.` +
			(revoked > 0
				? ` ${revoked} pending ${revoked === 1 ? 'code was' : 'codes were'} revoked.`
				: '')
	};
}

/** Gives every account in good standing (not banned) `count` more invites. */
export async function grantEveryone(locals: App.Locals, count: number) {
	const actorId = requireInviteAdmin(locals);
	const rows = await db
		.update(users)
		.set({ invites: sql`LEAST(${users.invites} + ${count}, ${MAX_BALANCE})` })
		.where(and(isNull(users.owner_id), isNull(users.banned_at)))
		.returning({ id: users.id });
	await logAction({
		actor: await actorOf(actorId),
		target: null,
		action: 'invites_everyone',
		details: { count, accounts: rows.length }
	});
	return {
		accounts: rows.length,
		message: `Gave ${count} ${count === 1 ? 'invite' : 'invites'} to ${rows.length} ${
			rows.length === 1 ? 'account' : 'accounts'
		}.`
	};
}

/** Invite facts for an account's moderation page: its balance, and who brought it in. */
export async function accountInvites(accountId: number) {
	const [balance, [invitedBy], [counts]] = await Promise.all([
		balanceOf(accountId),
		db
			.select({ inviter: inviterProfile, by_staff: invites.by_staff })
			.from(invites)
			.leftJoin(inviterUser, eq(inviterUser.id, invites.inviter_id))
			.where(eq(invites.used_by, accountId)),
		db
			.select({ used: sql<number>`count(*)::int` })
			.from(invites)
			.where(and(eq(invites.inviter_id, accountId), isNotNull(invites.used_by)))
	]);
	return {
		...balance,
		// people who signed up with its codes
		used: counts.used,
		invited_by: invitedBy?.inviter?.username ? invitedBy.inviter : null
	};
}
