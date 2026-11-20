import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { blocks, db, inbox, inbox_removed, likes, posts, users } from './db/index.js';
import { mentionedUsernames } from '#lib/mentions.js';
import type { NotificationType } from '#lib/types.js';
import { siblingProfileIds } from './accountProfiles.js';
import { newGroupKey } from './notifications.js';
import { PUSH_CHANNEL } from './pushOutbox.js';

/**
 * Creates and removes the notifications (inbox rows) of each event, inside the transaction that
 * wrote the event. This is the only writer of these rows. Each function returns the rows the
 * event created or removed, for realtime (unread counts).
 *
 * - Nobody is notified of their own actions, nor of actions of another profile of the same account
 *   (an identity and its owner, or two identities of one owner). Bots still notify their owner.
 * - No row is created between two profiles when either blocks the other. Rows from before the
 *   block stay.
 * - Rows are created without pushed_at: the push worker (pushOutbox.ts) sends them after commit.
 * - Undoing a like, regiorg or follow removes its row. Redoing it within REPUSH_AFTER of the
 *   push brings the row back as it was (pushed, and read if it was), so toggling never pushes
 *   twice: see inbox_removed.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Notification = {
	id: number;
	user_id: number;
	sender_id: number | null;
	post_id: number | null;
	type: NotificationType;
};

/** What an event did to the notifications, for realtime and push (see publishNotifications). */
export type NotificationChanges = {
	created: Notification[];
	removed: Notification[];
	/** rows read because their account acted on them (markActedRead): unread counts only */
	read?: Notification[];
};

type NewNotification = Omit<Notification, 'id' | 'sender_id'> & { sender_id: number };

// a like, regiorg or follow undone and redone sooner than this after its push isn't pushed again
const REPUSH_AFTER = sql`interval '1 day'`;

const columns = {
	id: inbox.id,
	user_id: inbox.user_id,
	sender_id: inbox.sender_id,
	post_id: inbox.post_id,
	type: inbox.type
};

const removedKey = (r: NewNotification) =>
	sql`(${inbox_removed.user_id} = ${r.user_id} AND ${inbox_removed.sender_id} = ${r.sender_id}
		AND ${inbox_removed.post_id} IS NOT DISTINCT FROM ${r.post_id} AND ${inbox_removed.type} = ${r.type})`;

/**
 * Inserts the rows, skipping self-notifications, same-account pairs, blocked pairs and rows that exist, and returns
 * those it created.
 */
async function insert(tx: Tx, candidates: NewNotification[]): Promise<Notification[]> {
	let rows = candidates.filter((r) => r.user_id !== r.sender_id);
	if (rows.length === 0) return [];

	const pairs = rows.flatMap((r) => [
		sql`(${r.user_id}::int, ${r.sender_id}::int)`,
		sql`(${r.sender_id}::int, ${r.user_id}::int)`
	]);
	const blocked = await tx
		.select({ blocker_id: blocks.blocker_id, blocked_id: blocks.blocked_id })
		.from(blocks)
		.where(sql`(${blocks.blocker_id}, ${blocks.blocked_id}) IN (${sql.join(pairs, sql`, `)})`);
	const isBlocked = (a: number, b: number) =>
		blocked.some(
			(x) =>
				(x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a)
		);
	rows = rows.filter((r) => !isBlocked(r.user_id, r.sender_id));
	if (rows.length === 0) return [];

	// the inbox is per account, so one account's profiles would notify each other of its own
	// actions. a bot sender is real activity (it replying to its owner), so it still notifies
	const ids = [...new Set(rows.flatMap((r) => [r.user_id, r.sender_id]))];
	const profiles = await tx
		.select({
			id: users.id,
			owner: sql<number>`COALESCE(${users.owner_id}, ${users.id})`,
			bot: users.bot
		})
		.from(users)
		.where(inArray(users.id, ids));
	const info = new Map(profiles.map((p) => [p.id, p]));
	rows = rows.filter((r) => {
		const s = info.get(r.sender_id);
		const u = info.get(r.user_id);
		return !s || !u || s.bot || s.owner !== u.owner;
	});
	if (rows.length === 0) return [];

	// the same notification, removed by an undo not long after its push, comes back as it was. the
	// timestamps stay text: a JS Date would drop their microseconds
	const removed = await tx
		.delete(inbox_removed)
		.where(sql`(${sql.join(rows.map(removedKey), sql` OR `)})`)
		.returning({
			user_id: inbox_removed.user_id,
			sender_id: inbox_removed.sender_id,
			post_id: inbox_removed.post_id,
			type: inbox_removed.type,
			pushed_at: sql<string>`${inbox_removed.pushed_at}::text`,
			read_at: sql<string | null>`${inbox_removed.read_at}::text`,
			recent: sql<boolean>`${inbox_removed.pushed_at} > NOW() - ${REPUSH_AFTER}`
		});
	const values = rows.map((r) => {
		// the group the row is shown in (see notifications.ts), computed like its created_at
		const row = { ...r, group_key: newGroupKey(r.type, r.post_id) };
		const old = removed.find(
			(o) =>
				o.recent &&
				o.user_id === r.user_id &&
				o.sender_id === r.sender_id &&
				o.post_id === r.post_id &&
				o.type === r.type
		);
		if (!old) return row;
		return {
			...row,
			pushed_at: sql`${old.pushed_at}::timestamptz`,
			read_at: old.read_at === null ? null : sql`${old.read_at}::timestamptz`
		};
	});
	const created = await tx.insert(inbox).values(values).onConflictDoNothing().returning(columns);
	// wakes the push workers once this commits (rows brought back as pushed are skipped there)
	if (created.length) await tx.execute(sql`SELECT pg_notify(${PUSH_CHANNEL}, '')`);
	return created;
}

/**
 * Removes the like, regiorg or follow notifications matching `where` (an undo), remembering the
 * pushed ones in inbox_removed so redoing it doesn't push again. Returns the rows removed.
 */
async function remove(tx: Tx, type: 'like' | 'regiorg' | 'follow', where: SQL) {
	const match = and(eq(inbox.type, type), where);
	// forget what is too old to matter; few rows, and this keeps the table small
	await tx.delete(inbox_removed).where(sql`${inbox_removed.pushed_at} <= NOW() - ${REPUSH_AFTER}`);
	await tx
		.insert(inbox_removed)
		.select(
			tx
				.select({
					user_id: inbox.user_id,
					sender_id: sql<number>`${inbox.sender_id}`.as('sender_id'),
					post_id: inbox.post_id,
					type: inbox.type,
					// a push being sent right now counts as pushed
					pushed_at: sql<Date>`COALESCE(${inbox.pushed_at}, ${inbox.push_claimed_at})`.as(
						'pushed_at'
					),
					read_at: inbox.read_at
				})
				.from(inbox)
				.where(
					and(
						match,
						isNotNull(inbox.sender_id),
						or(isNotNull(inbox.pushed_at), isNotNull(inbox.push_claimed_at))
					)
				)
		)
		.onConflictDoUpdate({
			target: [
				inbox_removed.user_id,
				inbox_removed.sender_id,
				inbox_removed.post_id,
				inbox_removed.type
			],
			set: { pushed_at: sql`excluded.pushed_at`, read_at: sql`excluded.read_at` }
		});
	return tx.delete(inbox).where(match).returning(columns);
}

/** The author of a post, null when it is gone (or has no author). */
async function authorOf(tx: Tx, postId: number | null) {
	if (postId === null) return null;
	const [row] = await tx.select({ user_id: posts.user_id }).from(posts).where(eq(posts.id, postId));
	return row?.user_id ?? null;
}

type PostFields = {
	id: number;
	user_id: number;
	content: string;
	reply_to: number | null;
	quote_of: number | null;
};

/**
 * Who a post notifies by replying or quoting: the author of its parent (`reply`) or of the post
 * it quotes (`quote`). A post can't both reply and quote.
 */
async function targetOf(tx: Tx, post: PostFields) {
	if (post.reply_to !== null) {
		const userId = await authorOf(tx, post.reply_to);
		return userId === null ? null : { userId, type: 'reply' as const };
	}
	const userId = await authorOf(tx, post.quote_of);
	return userId === null ? null : { userId, type: 'quote' as const };
}

/** `mention` rows for the profiles named, but not `except` (who gets a reply or quote instead). */
async function mentionRows(
	tx: Tx,
	post: PostFields,
	usernames: string[],
	except: number | null
): Promise<NewNotification[]> {
	if (usernames.length === 0) return [];
	const mentioned = await tx
		.select({ id: users.id })
		.from(users)
		.where(inArray(users.username, usernames));
	return mentioned
		.filter(({ id }) => id !== except)
		.map(({ id }) => ({ user_id: id, sender_id: post.user_id, post_id: post.id, type: 'mention' }));
}

/**
 * A post was created: a reply notifies the parent's author (`reply`), a quote the quoted author
 * (`quote`), and the profiles it @mentions get a `mention`, except that author: one notification
 * each.
 */
export async function onPostCreated(tx: Tx, post: PostFields) {
	const target = await targetOf(tx, post);
	const rows = await mentionRows(
		tx,
		post,
		mentionedUsernames(post.content),
		target?.userId ?? null
	);
	if (target)
		rows.push({
			user_id: target.userId,
			sender_id: post.user_id,
			post_id: post.id,
			type: target.type
		});
	return insert(tx, rows);
}

/**
 * A post was edited (`post` has the new text): profiles it @mentions now and didn't before get
 * a `mention`, with the same exception as onPostCreated. Removed mentions keep theirs.
 */
export async function onPostEdited(tx: Tx, post: PostFields, previousContent: string) {
	const before = new Set(mentionedUsernames(previousContent));
	const added = mentionedUsernames(post.content).filter((u) => !before.has(u));
	if (added.length === 0) return [];
	const target = await targetOf(tx, post);
	return insert(tx, await mentionRows(tx, post, added, target?.userId ?? null));
}

const likeCount = sql<number>`(SELECT count(*)::int FROM ${likes} WHERE ${likes.post_id} = ${posts.id})`;

/**
 * `userId` liked a post: its author is notified, and when the post is a reply with at least 3
 * likes and more than its parent, the parent's author is ratioed and the reply's author told.
 */
export async function onLike(tx: Tx, userId: number, postId: number) {
	const rows: NewNotification[] = [];
	const [post] = await tx
		.select({ user_id: posts.user_id, reply_to: posts.reply_to, likes: likeCount })
		.from(posts)
		.where(eq(posts.id, postId));
	if (!post) return [];
	if (post.user_id !== null)
		rows.push({ user_id: post.user_id, sender_id: userId, post_id: postId, type: 'like' });

	if (post.reply_to !== null && post.user_id !== null) {
		const [parent] = await tx
			.select({ user_id: posts.user_id, likes: likeCount })
			.from(posts)
			.where(eq(posts.id, post.reply_to));
		if (parent && parent.user_id !== null && post.likes >= 3 && post.likes > parent.likes)
			rows.push(
				{ user_id: parent.user_id, sender_id: post.user_id, post_id: postId, type: 'ratio' },
				{
					user_id: post.user_id,
					sender_id: parent.user_id,
					post_id: postId,
					type: 'ratioed_by_you'
				}
			);
	}
	return insert(tx, rows);
}

/** `userId` unliked a post: its `like` notification goes. Ratio rows stay. */
export function onUnlike(tx: Tx, userId: number, postId: number) {
	return remove(tx, 'like', and(eq(inbox.sender_id, userId), eq(inbox.post_id, postId))!);
}

/** `userId` regiorged a post: its author is notified. */
export async function onRegiorg(tx: Tx, userId: number, postId: number) {
	const author = await authorOf(tx, postId);
	if (author === null) return [];
	return insert(tx, [{ user_id: author, sender_id: userId, post_id: postId, type: 'regiorg' }]);
}

/** `userId` un-regiorged a post: its `regiorg` notification goes. */
export function onUnregiorg(tx: Tx, userId: number, postId: number) {
	return remove(tx, 'regiorg', and(eq(inbox.sender_id, userId), eq(inbox.post_id, postId))!);
}

/** `followerId` followed `followedId`. */
export async function onFollow(tx: Tx, followerId: number, followedId: number) {
	return insert(tx, [
		{ user_id: followedId, sender_id: followerId, post_id: null, type: 'follow' }
	]);
}

/** `followerId` unfollowed `followedId`: the `follow` notification goes. */
export function onUnfollow(tx: Tx, followerId: number, followedId: number) {
	return remove(
		tx,
		'follow',
		and(eq(inbox.sender_id, followerId), eq(inbox.user_id, followedId), isNull(inbox.post_id))!
	);
}

/**
 * `actorId` acted on a post (replied, quoted, liked, regiorged): what the account's profiles
 * were told about it (mention, reply, quote, ratio) is read, there is nothing left to see. In
 * the transaction of the action. Returns the rows read, for their unread counts.
 */
export async function markActedOnPost(tx: Tx, actorId: number, postId: number) {
	const profiles = await siblingProfileIds(actorId, tx);
	return tx
		.update(inbox)
		.set({ read_at: sql`NOW()` })
		.where(
			and(
				inArray(inbox.user_id, profiles),
				eq(inbox.post_id, postId),
				inArray(inbox.type, ['mention', 'reply', 'quote', 'ratio']),
				isNull(inbox.read_at)
			)
		)
		.returning(columns);
}

/** `actorId` followed `followedId`: the account's unread follow notifications from them are read. */
export async function markActedOnFollow(tx: Tx, actorId: number, followedId: number) {
	const profiles = await siblingProfileIds(actorId, tx);
	return tx
		.update(inbox)
		.set({ read_at: sql`NOW()` })
		.where(
			and(
				inArray(inbox.user_id, profiles),
				eq(inbox.sender_id, followedId),
				eq(inbox.type, 'follow'),
				isNull(inbox.read_at)
			)
		)
		.returning(columns);
}
