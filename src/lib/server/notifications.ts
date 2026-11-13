import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Notification, NotificationGroup } from '#lib/types.js';
import { db, inbox } from './db/index.js';
import { unreadMessageCount } from './messages.js';
import { unreadReactionCount } from './messageReactions.js';
import { pushUnread } from './realtime.js';

/** A profile's notifications, newest first (`limit + 1` rows, see offsetPage). */
export async function listNotifications(userId: number, limit: number, offset: number) {
	const rows = await db
		.select({
			id: inbox.id,
			// correlated subqueries: the table names are written out so they can't be mis-qualified
			sender: sql<Notification['sender']>`(
				SELECT jsonb_build_object('id', u.id, 'username', u.username, 'name', u.name, 'avatar', u.avatar)
				FROM users u WHERE u.id = inbox.sender_id
			)`,
			user_id: inbox.user_id,
			post: sql<Notification['post']>`(
				SELECT jsonb_build_object('content', p.content, 'id', p.id)
				FROM posts p WHERE p.id = inbox.post_id
			)`,
			type: inbox.type,
			invites: inbox.invites,
			created_at: inbox.created_at,
			read_at: inbox.read_at
		})
		.from(inbox)
		.where(eq(inbox.user_id, userId))
		.orderBy(desc(inbox.created_at), desc(inbox.id))
		.limit(limit + 1)
		.offset(offset);
	return rows as Notification[];
}

// Likes and regiorgs of one post, and follows, are grouped per UTC day: one entry instead of a
// row per person. The day keeps an old group from jumping back to the top on every new like.
// Replies, mentions, quotes and ratios have their own content, so they stay one per row.
const groupKey = sql<string>`CASE
	WHEN inbox.type IN ('like', 'regiorg')
		THEN inbox.type || '-' || inbox.post_id || '-' || to_char(inbox.created_at AT TIME ZONE 'UTC', 'YYYYMMDD')
	WHEN inbox.type = 'follow'
		THEN 'follow-' || to_char(inbox.created_at AT TIME ZONE 'UTC', 'YYYYMMDD')
	ELSE 'n-' || inbox.id
END`;

export const GROUP_KEY = /^(?:(?:like|regiorg)-\d{1,10}-\d{8}|follow-\d{8}|n-\d{1,10})$/;

/** A profile's notifications grouped (see groupKey), newest group first (`limit + 1` rows). */
export async function listNotificationGroups(userId: number, limit: number, offset: number) {
	const rows = (await db.execute(sql`
		SELECT g.key, g.type, g.count, g.unread, g.invites, g.created_at,
			CASE WHEN g.unread > 0 THEN NULL ELSE g.read_at END AS read_at,
			COALESCE((
				SELECT jsonb_agg(
					jsonb_build_object('id', u.id, 'username', u.username, 'name', u.name, 'avatar', u.avatar)
					ORDER BY array_position(g.sender_ids, u.id)
				)
				FROM users u WHERE u.id = ANY(g.sender_ids)
			), '[]'::jsonb) AS senders,
			(
				SELECT jsonb_build_object('content', p.content, 'id', p.id)
				FROM posts p WHERE p.id = g.post_id
			) AS post
		FROM (
			SELECT ${groupKey} AS key,
				min(inbox.type) AS type,
				min(inbox.post_id) AS post_id,
				-- invites are groups of one
				min(inbox.invites) AS invites,
				count(*)::int AS count,
				(count(*) FILTER (WHERE inbox.read_at IS NULL))::int AS unread,
				max(inbox.created_at) AS created_at,
				max(inbox.read_at) AS read_at,
				max(inbox.id) AS last_id,
				(array_agg(inbox.sender_id ORDER BY inbox.created_at DESC, inbox.id DESC)
					FILTER (WHERE inbox.sender_id IS NOT NULL))[1:3] AS sender_ids
			FROM inbox
			WHERE inbox.user_id = ${userId}
			GROUP BY 1
		) g
		ORDER BY g.created_at DESC, g.last_id DESC
		LIMIT ${limit + 1} OFFSET ${offset}
	`)) as unknown as NotificationGroup[];
	return rows.map((r) => ({
		...r,
		created_at: new Date(r.created_at),
		read_at: r.read_at && new Date(r.read_at)
	}));
}

/** Marks every notification of a group read. False when the profile has no such group. */
export async function markNotificationGroupRead(userId: number, key: string) {
	const [row] = (await db.execute(sql`
		WITH g AS (
			SELECT inbox.id, inbox.read_at FROM inbox
			WHERE inbox.user_id = ${userId} AND ${groupKey} = ${key}
		), updated AS (
			UPDATE inbox SET read_at = NOW()
			WHERE inbox.id IN (SELECT id FROM g WHERE read_at IS NULL)
			RETURNING inbox.id
		)
		SELECT (SELECT count(*) FROM g)::int AS found, (SELECT count(*) FROM updated)::int AS updated
	`)) as unknown as { found: number; updated: number }[];
	if (row.updated > 0) void pushUnread([userId]);
	return row.found > 0;
}

/** Unread notifications, messages and reactions to your messages (muted chats left out). */
export async function unreadCounts(userId: number) {
	const [notifications, messages, reactions] = await Promise.all([
		db.$count(inbox, and(eq(inbox.user_id, userId), isNull(inbox.read_at))),
		unreadMessageCount(userId),
		unreadReactionCount(userId)
	]);
	return { notifications, messages, reactions };
}

/** Marks one notification read. False when it isn't one of the profile's. */
export async function markNotificationRead(userId: number, id: number) {
	const updated = await db
		.update(inbox)
		.set({ read_at: sql`COALESCE(${inbox.read_at}, NOW())` })
		.where(and(eq(inbox.id, id), eq(inbox.user_id, userId)))
		.returning({ id: inbox.id });
	void pushUnread([userId]);
	return updated.length > 0;
}

export async function markAllNotificationsRead(userId: number) {
	await db
		.update(inbox)
		.set({ read_at: sql`NOW()` })
		.where(and(eq(inbox.user_id, userId), isNull(inbox.read_at)));
	void pushUnread([userId]);
}

/** The post was on the viewer's screen: their mention notification for it is now read. */
export async function markPostSeen(userId: number, postId: number) {
	const updated = await db
		.update(inbox)
		.set({ read_at: sql`NOW()` })
		.where(
			and(
				eq(inbox.user_id, userId),
				eq(inbox.post_id, postId),
				eq(inbox.type, 'mention'),
				isNull(inbox.read_at)
			)
		)
		.returning({ id: inbox.id });
	if (updated.length > 0) void pushUnread([userId]);
}
