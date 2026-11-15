import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Notification, NotificationGroup, NotificationType } from '#lib/types.js';
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
// Replies, mentions, quotes, ratios and invites have their own content, so they stay one per row.
//
// The key is stored in inbox.group_key when the row is created (newGroupKey, see notify.ts), so
// a page only reads the rows it shows. The others have no key: theirs is 'n-<id>'. Keys are part
// of the API (POST /notifications/groups/:key/read): don't change their format.

const GROUPED = `('like', 'regiorg', 'follow')`;

/** The key of a row of `t`, computed from its columns (the format of newGroupKey). */
const computedKey = (t: string) => `CASE
	WHEN ${t}.type IN ('like', 'regiorg')
		THEN ${t}.type || '-' || ${t}.post_id || '-' || to_char(${t}.created_at AT TIME ZONE 'UTC', 'YYYYMMDD')
	WHEN ${t}.type = 'follow'
		THEN 'follow-' || to_char(${t}.created_at AT TIME ZONE 'UTC', 'YYYYMMDD')
	ELSE 'n-' || ${t}.id
END`;

// a row's group. the previous release inserts likes, regiorgs and follows without a key while a
// deploy switches over: theirs is computed (inbox_group_key_missing finds them)
const keyOf = (t: string) => sql.raw(`COALESCE(${t}.group_key, ${computedKey(t)})`);

/**
 * `userId`'s rows of `t` in the group `key` (an SQL text expression): by group_key, by id for
 * 'n-<id>', or computed for the rows inserted without a key. Each branch has its index.
 */
function inGroup(t: string, userId: number, key: SQL) {
	const r = sql.raw(t);
	return sql`${r}.user_id = ${userId} AND (
		${r}.group_key = ${key}
		OR (${r}.group_key IS NULL AND ${r}.type NOT IN ${sql.raw(GROUPED)}
			AND ${r}.id = (CASE WHEN ${key} ~ '^n-[0-9]{1,9}$' THEN substr(${key}, 3)::int END))
		OR (${r}.group_key IS NULL AND ${r}.type IN ${sql.raw(GROUPED)}
			AND ${sql.raw(computedKey(t))} = ${key})
	)`;
}

/** The group_key of a new row, in SQL: from NOW(), which is the created_at it gets. */
export function newGroupKey(type: NotificationType, postId: number | null): SQL | null {
	const day = sql`to_char(NOW() AT TIME ZONE 'UTC', 'YYYYMMDD')`;
	if (type === 'like' || type === 'regiorg')
		return sql`${type}::text || '-' || ${postId}::int || '-' || ${day}`;
	if (type === 'follow') return sql`'follow-' || ${day}`;
	return null;
}

export const GROUP_KEY = /^(?:(?:like|regiorg)-\d{1,10}-\d{8}|follow-\d{8}|n-\d{1,10})$/;

/** Where a page of groups ended: the newest notification of its last group. */
export type GroupCursor = { at: string; id: number };

/**
 * A profile's notifications grouped (see above), newest group first: `limit + 1` groups after
 * `cursor`, or `offset` groups in (the offsets older clients may still hold), each with the
 * cursor of its position.
 *
 * Groups are ordered by their newest notification. A walk down the inbox, newest first, takes
 * the next row of a group it hasn't met until it has enough groups (a loose index scan, as in
 * Mastodon's grouped notifications); only those groups are then counted. A group with a
 * notification above the cursor isn't on this page: it was on an earlier one, or got a new
 * notification since and moved up. So later pages never repeat or skip a group.
 */
export async function listNotificationGroups(
	userId: number,
	limit: number,
	cursor: GroupCursor | null,
	offset = 0
) {
	const at =
		cursor && sql`('epoch'::timestamptz + ${cursor.at}::bigint * interval '1 microsecond')`;
	const start = cursor ? sql`(inbox.created_at, inbox.id) < (${at}, ${cursor.id}::int)` : sql`true`;
	// the group of a row met by the walk has no notification at or above the cursor ('n-<id>' is
	// that one row). OFFSET 0 keeps it from being inlined, and run, twice
	const above = cursor && sql`(m.created_at, m.id) >= (${at}, ${cursor.id}::int)`;
	const onPage = cursor
		? sql`(SELECT r.key LIKE 'n-%' OR NOT (
			EXISTS (SELECT 1 FROM inbox m
				WHERE m.user_id = ${userId} AND m.group_key = r.key AND ${above})
			OR EXISTS (SELECT 1 FROM inbox m
				WHERE m.user_id = ${userId} AND m.group_key IS NULL AND m.type IN ${sql.raw(GROUPED)}
					AND ${sql.raw(computedKey('m'))} = r.key AND ${above})
		) AS on_page OFFSET 0)`
		: sql`(SELECT true AS on_page)`;
	// the next row, after `after`, of a group not in `seen`
	const next = (after: SQL, seen: SQL) => sql`(
		SELECT inbox.created_at, inbox.id, ${keyOf('inbox')} AS key FROM inbox
		WHERE inbox.user_id = ${userId} AND ${after} AND ${keyOf('inbox')} <> ALL(${seen})
		ORDER BY inbox.created_at DESC, inbox.id DESC LIMIT 1
	)`;
	const rows = (await db.execute(sql`
		WITH RECURSIVE walk AS (
			SELECT r.created_at, r.id, r.key, ARRAY[r.key] AS seen, e.on_page,
				e.on_page::int AS found
			FROM ${next(start, sql`'{}'::text[]`)} r
			CROSS JOIN LATERAL ${onPage} e
			UNION ALL
			SELECT r.created_at, r.id, r.key, w.seen || r.key, e.on_page,
				w.found + e.on_page::int
			FROM walk w
			CROSS JOIN LATERAL ${next(sql`(inbox.created_at, inbox.id) < (w.created_at, w.id)`, sql`w.seen`)} r
			CROSS JOIN LATERAL ${onPage} e
			WHERE w.found < ${limit + 1 + offset}
		)
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
			) AS post,
			-- the position as text: a JS Date would drop the microseconds
			(extract(epoch FROM walk.created_at) * 1000000)::bigint || '-' || walk.id AS cursor
		FROM walk
		CROSS JOIN LATERAL (
			SELECT walk.key,
				min(inbox.type) AS type,
				min(inbox.post_id) AS post_id,
				-- invites are groups of one
				min(inbox.invites) AS invites,
				count(*)::int AS count,
				(count(*) FILTER (WHERE inbox.read_at IS NULL))::int AS unread,
				max(inbox.created_at) AS created_at,
				max(inbox.read_at) AS read_at,
				(array_agg(inbox.sender_id ORDER BY inbox.created_at DESC, inbox.id DESC)
					FILTER (WHERE inbox.sender_id IS NOT NULL))[1:3] AS sender_ids
			FROM inbox
			WHERE ${inGroup('inbox', userId, sql`walk.key`)}
		) g
		WHERE walk.on_page
		ORDER BY walk.created_at DESC, walk.id DESC
		LIMIT ${limit + 1} OFFSET ${offset}
	`)) as unknown as (NotificationGroup & { cursor: string })[];
	return rows.map(({ cursor, ...r }) => ({
		item: { ...r, created_at: new Date(r.created_at), read_at: r.read_at && new Date(r.read_at) },
		cursor
	}));
}

/** Marks every notification of a group read. False when the profile has no such group. */
export async function markNotificationGroupRead(userId: number, key: string) {
	const [row] = (await db.execute(sql`
		WITH g AS (
			SELECT inbox.id, inbox.read_at FROM inbox WHERE ${inGroup('inbox', userId, sql`${key}::text`)}
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
