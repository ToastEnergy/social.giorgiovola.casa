import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, group_members, group_messages, inbox, messages, users } from './db/index.js';

/**
 * Which pushed notifications are still worth showing. Every push carries a tag (see push.ts):
 *
 * - `<type>:<post_id>` for like, regiorg, reply, mention, quote, ratio, ratioed_by_you
 * - `follow:<username>`, `invites:<user_id>`: of the profile receiving them
 * - `message:<sender>:<recipient>` (usernames), `group:<group_id>:<recipient username>`
 *
 * A tag is stale when nothing it stands for is unread any more for the profiles of the account,
 * so a phone can take it out of its tray. Tags that aren't one of these, or are for a profile
 * the account can't use (another account's, on a shared device), are left out: unknown.
 */
const POST_TAG = /^(like|regiorg|reply|mention|quote|ratio|ratioed_by_you):(\d{1,10})$/;
const MESSAGE_TAG = /^message:([a-z0-9_]{1,32}):([a-z0-9_]{1,32})$/;
const GROUP_TAG = /^group:(\d{1,10}):([a-z0-9_]{1,32})$/;
const FOLLOW_TAG = /^follow:([a-z0-9_]{1,32})$/;
const INVITES_TAG = /^invites:(\d{1,10})$/;

const INT4 = 2147483647;
const int = (s: string) => (Number(s) <= INT4 ? Number(s) : null);

export async function staleTags(profileIds: number[], tags: string[]): Promise<string[]> {
	if (profileIds.length === 0) return [];
	const unreadRow = and(inArray(inbox.user_id, profileIds), isNull(inbox.read_at));

	const stale = new Set<string>();
	const post: { tag: string; type: string; id: number }[] = [];
	const follow: { tag: string; username: string }[] = [];
	const invites: { tag: string; id: number }[] = [];
	const message: { tag: string; sender: string; recipient: string }[] = [];
	const group: { tag: string; id: number; username: string }[] = [];
	for (const tag of tags) {
		let m: RegExpMatchArray | null;
		if ((m = tag.match(POST_TAG))) {
			const id = int(m[2]);
			if (id) post.push({ tag, type: m[1], id });
		} else if ((m = tag.match(FOLLOW_TAG))) follow.push({ tag, username: m[1] });
		else if ((m = tag.match(INVITES_TAG))) {
			const id = int(m[1]);
			if (id && profileIds.includes(id)) invites.push({ tag, id });
		} else if ((m = tag.match(MESSAGE_TAG))) message.push({ tag, sender: m[1], recipient: m[2] });
		else if ((m = tag.match(GROUP_TAG))) {
			const id = int(m[1]);
			if (id) group.push({ tag, id, username: m[2] });
		}
	}

	// the usernames in tags: the account's profiles are the only recipients that count
	const names = [
		...new Set([
			...follow.map((t) => t.username),
			...message.flatMap((t) => [t.sender, t.recipient]),
			...group.map((t) => t.username)
		])
	];
	const byName = new Map<string, number>();
	if (names.length) {
		const rows = await db
			.select({ id: users.id, username: users.username })
			.from(users)
			.where(inArray(users.username, names));
		for (const r of rows) byName.set(r.username, r.id);
	}
	const mine = (username: string) => {
		const id = byName.get(username);
		return id !== undefined && profileIds.includes(id) ? id : null;
	};

	if (post.length) {
		const unread = await db
			.selectDistinct({ type: inbox.type, post_id: inbox.post_id })
			.from(inbox)
			.where(
				and(
					unreadRow,
					inArray(inbox.post_id, [...new Set(post.map((t) => t.id))]),
					inArray(inbox.type, [...new Set(post.map((t) => t.type))] as never[])
				)
			);
		const open = new Set(unread.map((r) => `${r.type}:${r.post_id}`));
		for (const t of post) if (!open.has(t.tag)) stale.add(t.tag);
	}

	const unreadOf = async (type: 'follow' | 'invites') => {
		const rows = await db
			.selectDistinct({ user_id: inbox.user_id })
			.from(inbox)
			.where(and(unreadRow, eq(inbox.type, type)));
		return new Set(rows.map((r) => r.user_id));
	};
	if (follow.length) {
		const open = await unreadOf('follow');
		for (const t of follow) {
			const id = mine(t.username);
			if (id !== null && !open.has(id)) stale.add(t.tag);
		}
	}
	if (invites.length) {
		const open = await unreadOf('invites');
		for (const t of invites) if (!open.has(t.id)) stale.add(t.tag);
	}

	// each pair is a tag the user can have at most 100 of: one indexed lookup each
	await Promise.all([
		...message.map(async (t) => {
			const recipient = mine(t.recipient);
			const sender = byName.get(t.sender);
			if (recipient === null || sender === undefined) return;
			const [row] = await db
				.select({ id: messages.id })
				.from(messages)
				.where(
					and(
						eq(messages.recipient_id, recipient),
						eq(messages.sender_id, sender),
						isNull(messages.read_at)
					)
				)
				.limit(1);
			if (!row) stale.add(t.tag);
		}),
		...group.map(async (t) => {
			const recipient = mine(t.username);
			if (recipient === null) return;
			// the same rule as the messages badge (groups.ts unreadFor): later than last_read_id, by
			// someone else, real messages. Not a member (left) means nothing unread
			const [row] = await db
				.select({ id: group_messages.id })
				.from(group_messages)
				.innerJoin(
					group_members,
					and(
						eq(group_members.group_id, group_messages.group_id),
						eq(group_members.user_id, recipient)
					)
				)
				.where(
					and(
						eq(group_messages.group_id, t.id),
						sql`${group_messages.id} > ${group_members.last_read_id}`,
						sql`${group_messages.sender_id} != ${recipient}`,
						eq(group_messages.kind, 'message')
					)
				)
				.limit(1);
			if (!row) stale.add(t.tag);
		})
	]);

	return tags.filter((t) => stale.has(t));
}
