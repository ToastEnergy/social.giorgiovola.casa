import { eq } from 'drizzle-orm';
import { db, settings, users } from './db/index.js';
import { fail } from './api.js';
import { MAX_IDENTITIES } from './accounts.js';

/**
 * How many identities an account may own: its own limit when staff set one, else the instance's
 * (an admin setting, MAX_IDENTITIES until changed). Bots don't count.
 */

/** The highest limit staff can set, for an account or the instance. */
export const MAX_IDENTITY_LIMIT = 100;

const KEY = 'max_identities';

// read on every identity creation and list, so it is kept in memory like the motd
let cached: Promise<number> | null = null;

export function getGlobalIdentityLimit(): Promise<number> {
	cached ??= db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, KEY))
		.then((rows) => {
			const n = Number(rows[0]?.value);
			return rows[0] && Number.isInteger(n) && n >= 0 ? n : MAX_IDENTITIES;
		})
		.catch((e) => {
			// don't keep a failed read around
			cached = null;
			throw e;
		});
	return cached;
}

/** Sets the instance's limit; null goes back to the default. */
export async function setGlobalIdentityLimit(limit: number | null) {
	if (limit === null) {
		await db.delete(settings).where(eq(settings.key, KEY));
	} else {
		const value = String(limit);
		await db
			.insert(settings)
			.values({ key: KEY, value })
			.onConflictDoUpdate({ target: settings.key, set: { value } });
	}
	cached = Promise.resolve(limit ?? MAX_IDENTITIES);
}

/** The limit that applies with the account's own one (null when it has none). */
export async function effectiveLimit(own: number | null) {
	return own ?? (await getGlobalIdentityLimit());
}

/** The limit of one account. */
export async function identityLimitOf(accountId: number) {
	const [row] = await db
		.select({ max_identities: users.max_identities })
		.from(users)
		.where(eq(users.id, accountId));
	return effectiveLimit(row?.max_identities ?? null);
}

/** `name` from a request body: a whole number from 0 to MAX_IDENTITY_LIMIT, or null. */
export function limitField(body: Record<string, unknown>, name: string): number | null {
	const value = body[name];
	if (value === null) return null;
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > MAX_IDENTITY_LIMIT
	)
		fail(400, `${name} must be a whole number between 0 and ${MAX_IDENTITY_LIMIT}, or null`);
	return value;
}
