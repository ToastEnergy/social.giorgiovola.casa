import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, identity_members, users } from './db/index.js';
import { fail } from './api.js';

// anything with select: the db or a transaction
type Executor = Pick<typeof db, 'select'>;

/**
 * Every profile an account can use: itself, the identities it owns and the identities shared
 * with it (not while their owner is banned, like getSwitcher). Bots are left out: they are only
 * used through the bot API. The inbox is per account, so this is whose notifications are read
 * together.
 */
export async function accountProfileIds(accountId: number, ex: Executor = db): Promise<number[]> {
	const owner = alias(users, 'owner');
	const rows = await ex
		.select({ id: users.id })
		.from(users)
		.leftJoin(identity_members, eq(identity_members.identity_id, users.id))
		.leftJoin(owner, eq(owner.id, users.owner_id))
		.where(
			or(
				eq(users.id, accountId),
				and(eq(users.owner_id, accountId), eq(users.bot, false)),
				and(eq(identity_members.account_id, accountId), isNull(owner.banned_at))
			)
		);
	return [...new Set(rows.map((r) => r.id))];
}

/**
 * The profiles whose notifications a request reads: a bot's own profile, else everything its
 * account can use.
 */
export async function requestProfileIds(locals: App.Locals, ex: Executor = db): Promise<number[]> {
	if (!locals.user) return [];
	if (locals.auth === 'bot' || locals.accountId === null) return [locals.user.id];
	const ids = await accountProfileIds(locals.accountId, ex);
	// the profile in use is always one of them, even if the lookup raced a change
	return ids.includes(locals.user.id) ? ids : [...ids, locals.user.id];
}

/**
 * The profiles of the account `profileId` belongs to (its owner, for an identity): for what an
 * action of a profile reads, where the service doesn't know which account acted. A bot is only
 * itself, and so is a shared identity: any of its members may be the one acting, so the
 * owner's other profiles aren't touched.
 */
export async function siblingProfileIds(profileId: number, ex: Executor = db): Promise<number[]> {
	const [row] = await ex
		.select({
			owner_id: users.owner_id,
			bot: users.bot,
			shared: sql<boolean>`EXISTS (SELECT 1 FROM identity_members
				WHERE identity_members.identity_id = ${profileId})`
		})
		.from(users)
		.where(eq(users.id, profileId));
	if (!row || row.bot || row.shared) return [profileId];
	return accountProfileIds(row.owner_id ?? profileId, ex);
}

/** The ids of the profiles named `usernames`, among `within`. */
export async function profileIdsNamed(usernames: string[], within: number[]): Promise<number[]> {
	if (usernames.length === 0 || within.length === 0) return [];
	const rows = await db
		.select({ id: users.id })
		.from(users)
		.where(and(inArray(users.username, usernames), inArray(users.id, within)));
	return rows.map((r) => r.id);
}

/**
 * `?profiles=` of the inbox endpoints: null without it (the profile in use only, as before, and
 * always for a bot), else the ids of `all` the account's profiles or of the usernames listed
 * (comma separated). A name that isn't one of the account's profiles is a 400, so a typo
 * doesn't quietly show less than asked for.
 */
export async function inboxProfileIds(locals: App.Locals, url: URL): Promise<number[] | null> {
	const raw = url.searchParams.get('profiles');
	if (raw === null || raw === '' || !locals.user || locals.auth === 'bot') return null;
	const all = await requestProfileIds(locals);
	if (raw === 'all') return all;
	const names = [...new Set(raw.split(',').map((n) => n.trim()))];
	if (names.length > 50 || names.some((n) => !/^[A-Za-z0-9_.-]{1,64}$/.test(n)))
		fail(400, 'Invalid profiles');
	const ids = await profileIdsNamed(names, all);
	if (ids.length < names.length) fail(400, 'Unknown profile in profiles');
	return ids;
}
