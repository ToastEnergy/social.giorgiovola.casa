import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Notification, NotificationGroup, NotificationType } from '#lib/types.js';
import { db, inbox } from './db/index.js';
import { unreadMessageCount } from './messages.js';
import { unreadReactionCount } from './messageReactions.js';
import { pushUnread } from './realtime.js';
import { profileUnreadCounts } from './profileUnread.js';

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
function inGroup(t: string, userId: number | SQL, key: SQL) {
	const r = sql.raw(t);
	return sql`${r}.user_id = ${userId} AND (
		${r}.group_key = ${key}
		OR (${r}.group_key IS NULL AND ${r}.type NOT IN ${sql.raw(GROUPED)}
			-- the same digits as GROUP_KEY; bigint, so ten of them can't overflow the cast
			AND ${r}.id = (CASE WHEN ${key} ~ '^n-[0-9]{1,10}$' THEN substr(${key}, 3)::bigint END))
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

// ---------------------------------------------------------------------------------------------
// the inbox of an account: several profiles at once (?profiles=)
//
// Same groups, except that what is about one post is one group across the profiles it reached:
// a reply that also mentions another of your profiles is one entry ('p-<post_id>', with the
// strongest type and every recipient). Likes, regiorgs, follows and invites are about one
// profile, so they keep their own key with the recipient in front ('<user_id>/like-12-20261120',
// '<user_id>/n-99'). The two key formats never meet: these keys only work with ?profiles=.

const POSTED = `('mention', 'reply', 'quote', 'ratio')`;

// a row is merged by post when it has one; the odd row of these types without a post stays alone
const isPosted = (t: string) => `(${t}.type IN ${POSTED} AND ${t}.post_id IS NOT NULL)`;
const ownKey = (t: string) => `COALESCE(${t}.group_key, ${computedKey(t)})`;
const multiKey = (t: string) =>
	`CASE WHEN ${isPosted(t)} THEN 'p-' || ${t}.post_id ELSE ${t}.user_id || '/' || ${ownKey(t)} END`;

export const MULTI_GROUP_KEY =
	/^(?:p-\d{1,10}|\d{1,10}\/(?:(?:like|regiorg)-\d{1,10}-\d{8}|follow-\d{8}|n-\d{1,10}))$/;

// postgres-js would expand a JS array into a list, so the ids are spelled out
const idArray = (ids: number[]) =>
	sql`ARRAY[${sql.join(
		ids.map((i) => sql`${i}::int`),
		sql`, `
	)}]::int[]`;

/**
 * listNotificationGroups for `profileIds` together (the inbox of an account), with the profiles
 * each group reached in `recipients`, `currentId` first. Same walk and cursors; the "next row" is
 * one LIMIT 1 index scan of inbox_user_created per profile (a LATERAL join over the ids), and the
 * newest of those, so the rows are never sorted across profiles.
 */
export async function listNotificationGroupsOf(
	profileIds: number[],
	currentId: number,
	limit: number,
	cursor: GroupCursor | null,
	offset = 0
) {
	const ids = idArray(profileIds);
	const at =
		cursor && sql`('epoch'::timestamptz + ${cursor.at}::bigint * interval '1 microsecond')`;
	const start = cursor ? sql`(inbox.created_at, inbox.id) < (${at}, ${cursor.id}::int)` : sql`true`;
	const above = cursor && sql`(m.created_at, m.id) >= (${at}, ${cursor.id}::int)`;
	// is the group of this row (r) one without a notification at or above the cursor? a post
	// group is its rows of the post across the profiles, the others one profile's group, as in
	// listNotificationGroups
	const onPage = cursor
		? sql`(SELECT (NOT r.posted AND r.own_key LIKE 'n-%') OR NOT (
			EXISTS (SELECT 1 FROM inbox m
				WHERE r.posted AND m.user_id = ANY(${ids}) AND m.post_id = r.post_id
					AND m.type IN ${sql.raw(POSTED)} AND ${above})
			OR EXISTS (SELECT 1 FROM inbox m
				WHERE NOT r.posted AND m.user_id = r.user_id AND m.group_key = r.own_key AND ${above})
			OR EXISTS (SELECT 1 FROM inbox m
				WHERE NOT r.posted AND m.user_id = r.user_id AND m.group_key IS NULL
					AND m.type IN ${sql.raw(GROUPED)}
					AND ${sql.raw(computedKey('m'))} = r.own_key AND ${above})
		) AS on_page OFFSET 0)`
		: sql`(SELECT true AS on_page)`;
	const next = (after: SQL, seen: SQL) => sql`(
		SELECT c.* FROM unnest(${ids}) AS prof(pid)
		CROSS JOIN LATERAL (
			SELECT inbox.created_at, inbox.id, inbox.user_id, inbox.post_id,
				${sql.raw(isPosted('inbox'))} AS posted,
				${sql.raw(ownKey('inbox'))} AS own_key,
				${sql.raw(multiKey('inbox'))} AS key
			FROM inbox
			WHERE inbox.user_id = prof.pid AND ${after} AND ${sql.raw(multiKey('inbox'))} <> ALL(${seen})
			ORDER BY inbox.created_at DESC, inbox.id DESC LIMIT 1
		) c
		ORDER BY c.created_at DESC, c.id DESC LIMIT 1
	)`;
	const rows = (await db.execute(sql`
		WITH RECURSIVE walk AS (
			SELECT r.created_at, r.id, r.user_id, r.post_id, r.posted, r.own_key, r.key,
				ARRAY[r.key] AS seen, e.on_page, e.on_page::int AS found
			FROM ${next(start, sql`'{}'::text[]`)} r
			CROSS JOIN LATERAL ${onPage} e
			UNION ALL
			SELECT r.created_at, r.id, r.user_id, r.post_id, r.posted, r.own_key, r.key,
				w.seen || r.key, e.on_page, w.found + e.on_page::int
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
			COALESCE((
				SELECT jsonb_agg(
					jsonb_build_object('id', u.id, 'username', u.username, 'name', u.name, 'avatar', u.avatar)
					ORDER BY (u.id <> ${currentId}::int), u.id
				)
				FROM users u WHERE u.id = ANY(g.recipient_ids)
			), '[]'::jsonb) AS recipients,
			(
				SELECT jsonb_build_object('content', p.content, 'id', p.id)
				FROM posts p WHERE p.id = g.post_id
			) AS post,
			(extract(epoch FROM walk.created_at) * 1000000)::bigint || '-' || walk.id AS cursor
		FROM walk
		CROSS JOIN LATERAL (
			SELECT walk.key,
				-- the strongest type: reply > quote > ratio > mention (the others are alone)
				(array_agg(gr.type ORDER BY CASE gr.type WHEN 'reply' THEN 0 WHEN 'quote' THEN 1
					WHEN 'ratio' THEN 2 ELSE 3 END))[1] AS type,
				min(gr.post_id) AS post_id,
				min(gr.invites) AS invites,
				count(*)::int AS count,
				(count(*) FILTER (WHERE gr.read_at IS NULL))::int AS unread,
				max(gr.created_at) AS created_at,
				max(gr.read_at) AS read_at,
				(array_agg(gr.sender_id ORDER BY gr.created_at DESC, gr.id DESC)
					FILTER (WHERE gr.sender_id IS NOT NULL))[1:3] AS sender_ids,
				array_agg(DISTINCT gr.user_id) AS recipient_ids
			FROM (
				-- one branch applies per walk row; its condition keeps the other from running
				SELECT inbox.* FROM inbox
				WHERE walk.posted AND inbox.user_id = ANY(${ids}) AND inbox.post_id = walk.post_id
					AND inbox.type IN ${sql.raw(POSTED)}
				UNION ALL
				SELECT inbox.* FROM inbox
				WHERE NOT walk.posted AND ${inGroup('inbox', sql`walk.user_id`, sql`walk.own_key`)}
			) gr
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

/**
 * Marks a group of listNotificationGroupsOf read (a MULTI_GROUP_KEY): the rows of a post across
 * `profileIds`, or one profile's group. False when there is no such group among them.
 */
export async function markMultiGroupRead(profileIds: number[], key: string) {
	const ids = idArray(profileIds);
	let rows: SQL;
	if (key.startsWith('p-')) {
		rows = sql`inbox.user_id = ANY(${ids}) AND inbox.post_id = ${Number(key.slice(2))}
			AND inbox.type IN ${sql.raw(POSTED)}`;
	} else {
		const slash = key.indexOf('/');
		const userId = Number(key.slice(0, slash));
		if (!profileIds.includes(userId)) return false;
		rows = inGroup('inbox', userId, sql`${key.slice(slash + 1)}::text`);
	}
	const [res] = (await db.execute(sql`
		WITH g AS (SELECT inbox.id, inbox.read_at FROM inbox WHERE ${rows}),
		updated AS (
			UPDATE inbox SET read_at = NOW()
			WHERE inbox.id IN (SELECT id FROM g WHERE read_at IS NULL)
			RETURNING inbox.user_id
		)
		SELECT (SELECT count(*) FROM g)::int AS found,
			COALESCE((SELECT array_agg(DISTINCT user_id) FROM updated), '{}') AS changed
	`)) as unknown as { found: number; changed: number[] }[];
	if (res.changed.length > 0) void pushUnread(res.changed);
	return res.found > 0;
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

/**
 * unreadCounts of the profile in use, plus each of `profileIds` (the account's, see
 * accountProfiles.ts) and the unread notifications over all of them as `total`.
 */
export async function unreadCountsOf(userId: number, profileIds: number[]) {
	const [current, rows] = await Promise.all([
		unreadCounts(userId),
		profileUnreadCounts(profileIds)
	]);
	// the profile in use first, then in the order of the ids
	const order = (id: number) => (id === userId ? -1 : profileIds.indexOf(id));
	const profiles = rows
		.sort((a, b) => order(a.id) - order(b.id))
		.map((r) => ({
			username: r.username,
			notifications: r.notifications,
			messages: r.messages,
			reactions: r.reactions
		}));
	return {
		...current,
		total: profiles.reduce((n, p) => n + p.notifications, 0),
		profiles
	};
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

/** Marks every notification of all of `profileIds` read. */
export async function markAllNotificationsReadOf(profileIds: number[]) {
	if (profileIds.length === 0) return;
	const rows = await db
		.update(inbox)
		.set({ read_at: sql`NOW()` })
		.where(and(inArray(inbox.user_id, profileIds), isNull(inbox.read_at)))
		.returning({ user_id: inbox.user_id });
	void pushUnread(new Set(rows.map((r) => r.user_id)));
}

export async function markAllNotificationsRead(userId: number) {
	await db
		.update(inbox)
		.set({ read_at: sql`NOW()` })
		.where(and(eq(inbox.user_id, userId), isNull(inbox.read_at)));
	void pushUnread([userId]);
}

/** What was seen, see markSeen. */
export type Seen = {
	/** posts that were on screen */
	posts?: number[];
	/** posts whose page or people list was opened */
	engagement?: number[];
	/** the profiles (ids) whose followers list was opened */
	followers?: number[];
	/** the invites page was opened */
	invites?: boolean;
};

const POST_TYPES = ['mention', 'reply', 'quote', 'ratio'] as const;
const ENGAGEMENT_TYPES = ['like', 'regiorg', 'ratioed_by_you'] as const;

/**
 * Seen means read: marks the unread notifications of `profileIds` (the profiles an account can
 * use, the inbox is per account) about what was seen. One update per kind, by inbox_post_id.
 * Returns how many were read; the profiles it changed get their fresh unread count.
 */
export async function markSeen(profileIds: number[], seen: Seen) {
	if (profileIds.length === 0) return 0;
	const ofProfiles = inArray(inbox.user_id, profileIds);
	const changed = new Set<number>();
	let read = 0;
	const run = async (where: SQL | undefined) => {
		const rows = await db
			.update(inbox)
			.set({ read_at: sql`NOW()` })
			.where(and(ofProfiles, isNull(inbox.read_at), where))
			.returning({ user_id: inbox.user_id });
		read += rows.length;
		for (const r of rows) changed.add(r.user_id);
	};
	if (seen.posts?.length)
		await run(and(inArray(inbox.post_id, seen.posts), inArray(inbox.type, [...POST_TYPES])));
	if (seen.engagement?.length)
		await run(
			and(inArray(inbox.post_id, seen.engagement), inArray(inbox.type, [...ENGAGEMENT_TYPES]))
		);
	if (seen.followers?.length)
		await run(and(inArray(inbox.user_id, seen.followers), eq(inbox.type, 'follow')));
	if (seen.invites) await run(eq(inbox.type, 'invites'));
	if (changed.size > 0) void pushUnread(changed);
	return read;
}
