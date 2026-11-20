import { inArray, sql } from 'drizzle-orm';
import { db, users } from './db/index.js';

/**
 * Per-profile unread counts as columns of a select from `users`: notifications, messages and
 * reactions to the profile's messages. Shared by the account switcher and the unread breakdown
 * of the inbox, so they can't drift apart.
 */
export const profileUnreadColumns = {
	// correlated subquery: the table names are written out so they can't be mis-qualified
	unread: sql<number>`(
		SELECT COUNT(*) FROM inbox WHERE inbox.user_id = users.id AND inbox.read_at IS NULL
	)::int`,
	unread_messages: sql<number>`(
		(SELECT COUNT(*) FROM messages WHERE messages.recipient_id = users.id AND messages.read_at IS NULL
			AND NOT EXISTS (SELECT 1 FROM dm_mutes
				WHERE dm_mutes.user_id = users.id AND dm_mutes.peer_id = messages.sender_id))
		+ (SELECT COUNT(*) FROM group_messages
			JOIN group_members ON group_members.group_id = group_messages.group_id
				AND group_members.user_id = users.id
			WHERE group_messages.id > group_members.last_read_id
				AND group_messages.sender_id != users.id
				AND group_messages.kind = 'message'
				AND NOT group_members.muted)
	)::int`,
	// reactions others made to the profile's messages it hasn't seen yet
	unread_reactions: sql<number>`(
		(SELECT COUNT(*) FROM message_reactions
			JOIN messages ON messages.id = message_reactions.message_id
			WHERE messages.sender_id = users.id AND message_reactions.read_at IS NULL
				AND NOT EXISTS (SELECT 1 FROM dm_mutes
					WHERE dm_mutes.user_id = users.id AND dm_mutes.peer_id = messages.recipient_id))
		+ (SELECT COUNT(*) FROM group_message_reactions
			JOIN group_messages ON group_messages.id = group_message_reactions.message_id
			JOIN group_members ON group_members.group_id = group_messages.group_id
				AND group_members.user_id = users.id
			WHERE group_messages.sender_id = users.id
				AND group_message_reactions.read_at IS NULL
				AND NOT group_members.muted)
	)::int`
};

/** The unread counts of each of `profileIds`, with the username of the profile. */
export async function profileUnreadCounts(profileIds: number[]) {
	if (profileIds.length === 0) return [];
	const rows = await db
		.select({ id: users.id, username: users.username, ...profileUnreadColumns })
		.from(users)
		.where(inArray(users.id, profileIds));
	return rows.map((r) => ({
		id: r.id,
		username: r.username,
		notifications: r.unread,
		messages: r.unread_messages,
		reactions: r.unread_reactions
	}));
}
