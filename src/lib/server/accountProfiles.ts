import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, identity_members, users } from './db/index.js';

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
