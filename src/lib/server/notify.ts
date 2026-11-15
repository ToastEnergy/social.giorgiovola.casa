import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, inbox, likes, posts, users } from './db/index.js';
import { MENTION_RE } from '#lib/mentions.js';
import type { NotificationType } from '#lib/types.js';

/**
 * Creates the notifications (inbox rows) of each event, inside the transaction that wrote the
 * event. Each function returns the rows the event created, for realtime and push.
 *
 * The notify_* triggers still create the same rows until the next release drops them (deploys
 * are blue-green). They run first, inside the event's insert, so the inserts here usually do
 * nothing: the rows returned are those of this transaction, found by `created_at = NOW()` (the
 * transaction start, the default of created_at), whoever inserted them.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Notification = {
	id: number;
	user_id: number;
	sender_id: number | null;
	post_id: number | null;
	type: NotificationType;
};

type NewNotification = Omit<Notification, 'id'>;

const columns = {
	id: inbox.id,
	user_id: inbox.user_id,
	sender_id: inbox.sender_id,
	post_id: inbox.post_id,
	type: inbox.type
};

/** Inserts the rows, skipping the ones that exist, and returns those this transaction created. */
async function insert(tx: Tx, rows: NewNotification[]): Promise<Notification[]> {
	if (rows.length === 0) return [];
	const inserted = await tx.insert(inbox).values(rows).onConflictDoNothing().returning(columns);
	// rows a trigger inserted earlier in this transaction. a row from an earlier event (a like
	// toggled off and on) is older and isn't returned, so it isn't pushed again. goes with them
	const keys = rows.map(
		(r) =>
			sql`(${inbox.user_id} = ${r.user_id} AND ${inbox.sender_id} IS NOT DISTINCT FROM ${r.sender_id}
				AND ${inbox.post_id} IS NOT DISTINCT FROM ${r.post_id} AND ${inbox.type} = ${r.type})`
	);
	const existing = await tx
		.select(columns)
		.from(inbox)
		.where(and(sql`${inbox.created_at} = NOW()`, sql`(${sql.join(keys, sql` OR `)})`));
	const byId = new Map([...inserted, ...existing].map((r) => [r.id, r]));
	return [...byId.values()];
}

/**
 * A post was created: a reply notifies the parent's author, any other post the profiles it
 * @mentions, and a quote the quoted author (instead of a mention). Never the author itself.
 */
export async function onPostCreated(
	tx: Tx,
	post: {
		id: number;
		user_id: number;
		content: string;
		reply_to: number | null;
		quote_of: number | null;
	}
) {
	const rows: NewNotification[] = [];
	const notify = (userId: number | null, type: NotificationType) => {
		if (userId !== null && userId !== post.user_id)
			rows.push({ user_id: userId, sender_id: post.user_id, post_id: post.id, type });
	};

	if (post.reply_to !== null) {
		const [parent] = await tx
			.select({ user_id: posts.user_id })
			.from(posts)
			.where(eq(posts.id, post.reply_to));
		notify(parent?.user_id ?? null, 'reply');
		// replies don't notify their mentions (yet)
		return insert(tx, rows);
	}

	let quotedAuthor: number | null = null;
	if (post.quote_of !== null) {
		const [quoted] = await tx
			.select({ user_id: posts.user_id })
			.from(posts)
			.where(eq(posts.id, post.quote_of));
		quotedAuthor = quoted?.user_id ?? null;
	}

	// usernames as written: the triggers compare them case-sensitively
	const names = [...new Set([...post.content.matchAll(MENTION_RE)].map((m) => m[1]))];
	if (names.length) {
		const mentioned = await tx
			.select({ id: users.id })
			.from(users)
			.where(inArray(users.username, names));
		// the quoted author gets the quote instead
		for (const { id } of mentioned) if (id !== quotedAuthor) notify(id, 'mention');
	}
	notify(quotedAuthor, 'quote');
	return insert(tx, rows);
}

/**
 * `userId` liked a post: its author is notified, and when the post is a reply with at least 3
 * likes and more than its parent, the parent's author is ratioed and the reply's author told.
 */
export async function onLike(tx: Tx, userId: number, postId: number) {
	const rows: NewNotification[] = [];
	const [post] = await tx
		.select({
			user_id: posts.user_id,
			reply_to: posts.reply_to,
			likes: sql<number>`(SELECT count(*)::int FROM ${likes} WHERE ${likes.post_id} = ${posts.id})`
		})
		.from(posts)
		.where(eq(posts.id, postId));
	if (!post) return [];
	if (post.user_id !== null && post.user_id !== userId)
		rows.push({ user_id: post.user_id, sender_id: userId, post_id: postId, type: 'like' });

	if (post.reply_to !== null && post.user_id !== null) {
		const [parent] = await tx
			.select({
				user_id: posts.user_id,
				likes: sql<number>`(SELECT count(*)::int FROM ${likes} WHERE ${likes.post_id} = ${posts.id})`
			})
			.from(posts)
			.where(eq(posts.id, post.reply_to));
		if (
			parent &&
			parent.user_id !== null &&
			parent.user_id !== post.user_id &&
			post.likes >= 3 &&
			post.likes > parent.likes
		)
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

/** `userId` regiorged a post: its author is notified, unless it is their own. */
export async function onRegiorg(tx: Tx, userId: number, postId: number) {
	const [post] = await tx
		.select({ user_id: posts.user_id })
		.from(posts)
		.where(eq(posts.id, postId));
	if (!post || post.user_id === null || post.user_id === userId) return [];
	return insert(tx, [
		{ user_id: post.user_id, sender_id: userId, post_id: postId, type: 'regiorg' }
	]);
}

/** `followerId` followed `followedId`. Once per follower: following again doesn't notify. */
export async function onFollow(tx: Tx, followerId: number, followedId: number) {
	return insert(tx, [
		{ user_id: followedId, sender_id: followerId, post_id: null, type: 'follow' }
	]);
}
