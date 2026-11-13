import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	unique,
	uniqueIndex,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import type { Gif } from '../../types.js';

// Property names match the column names (snake_case) so rows line up with the types in
// src/lib/types.ts. The triggers that create notifications can't be expressed here, they live
// in a hand written migration (see drizzle/).

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
	'users',
	{
		id: serial('id').primaryKey(),
		username: text('username').notNull().unique(),
		name: text('name').notNull(),
		// email, password and salt are null for identities
		email: text('email').unique(),
		password: text('password'),
		salt: text('salt'),
		avatar: text('avatar'),
		// shown on the profile, may be empty
		bio: text('bio').notNull().default(''),
		// an http(s) URL shown on the profile, may be empty
		website: text('website').notNull().default(''),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		// identities: extra profiles owned by an account, usable only by switching to them
		// from the owning account (see src/routes/settings/accounts)
		owner_id: integer('owner_id').references((): AnyPgColumn => users.id, { onDelete: 'cascade' }),
		// bots are owned like identities but driven by the bot API (see bots below), never by
		// switching to them
		bot: boolean('bot').notNull().default(false),
		// the one post shown first on the profile, always one of its own; deleting it unpins it
		pinned_post_id: integer('pinned_post_id').references((): AnyPgColumn => posts.id, {
			onDelete: 'set null'
		}),
		// moderation lives on accounts, identities follow the account that owns them
		role: text('role', { enum: ['user', 'mod', 'admin'] })
			.notNull()
			.default('user'),
		// banned accounts can't sign in; muted ones can't post, reply or send messages
		banned_at: timestamptz('banned_at'),
		ban_reason: text('ban_reason'),
		muted_at: timestamptz('muted_at'),
		mute_reason: text('mute_reason'),
		// when a temporary ban or mute is lifted (src/lib/server/moderation.ts); null is for good
		banned_until: timestamptz('banned_until'),
		muted_until: timestamptz('muted_until'),
		// invites an admin gave the account that it hasn't turned into codes yet (see invites)
		invites: integer('invites').notNull().default(0)
	},
	(t) => [
		index('users_owner_id').on(t.owner_id),
		// the sweep that lifts temporary bans and mutes
		index('users_banned_until')
			.on(t.banned_until)
			.where(sql`${t.banned_until} IS NOT NULL`),
		index('users_muted_until')
			.on(t.muted_until)
			.where(sql`${t.muted_until} IS NOT NULL`),
		check('users_role_check', sql`${t.role} IN ('user', 'mod', 'admin')`),
		check('users_invites_check', sql`${t.invites} >= 0`),
		check(
			'users_identity_check',
			sql`(${t.owner_id} IS NULL AND ${t.email} IS NOT NULL AND ${t.password} IS NOT NULL AND ${t.salt} IS NOT NULL)
				OR (${t.owner_id} IS NOT NULL AND ${t.owner_id} != ${t.id} AND ${t.email} IS NULL AND ${t.password} IS NULL AND ${t.salt} IS NULL)`
		)
	]
);

// A signed in account: a browser session (kind cookie) or an API token (see src/lib/server/auth.ts).
export const sessions = pgTable(
	'sessions',
	{
		// the sha256 hex of the secret, which is never stored: the session cookie (a uuid; sessions
		// made before cookies were hashed hold the cookie itself until they expire, see cookieKeys)
		// or the bearer token, which is only shown once
		token: text('token')
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		// public id, so sessions can be listed and revoked without exposing the secret
		id: serial('id').notNull().unique(),
		// cookie: the web UI. token: from POST /api/v1/auth/login (or register, passkey login).
		// personal: a personal access token created by the user
		kind: text('kind', { enum: ['cookie', 'token', 'personal'] })
			.notNull()
			.default('cookie'),
		// what the client called itself, or the name of a personal access token
		name: text('name'),
		user_agent: text('user_agent'),
		// the account that is signed in
		user_id: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
		// the identity currently in use, null when acting as the account itself
		acting_id: integer('acting_id').references(() => users.id, { onDelete: 'set null' }),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		// sessions expire server side; null only for personal tokens made to never expire
		expires_at: timestamptz('expires_at').default(sql`NOW() + INTERVAL '30 days'`),
		// written at most every few minutes, shown in the session list
		last_used_at: timestamptz('last_used_at')
	},
	(t) => [
		index('sessions_user_id').on(t.user_id),
		check('sessions_kind_check', sql`${t.kind} IN ('cookie', 'token', 'personal')`)
	]
);

export const posts = pgTable(
	'posts',
	{
		id: serial('id').primaryKey(),
		user_id: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
		// may be empty when the post has images
		content: text('content').notNull(),
		// URL paths of the attached uploads (see src/lib/server/images.ts)
		images: text('images')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		// a KLIPY GIF instead of images (src/lib/server/gifs.ts); only its URLs, never a copy
		gif: jsonb('gif').$type<Gif>(),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		edited_at: timestamptz('edited_at'),
		reply_to: integer('reply_to').references((): AnyPgColumn => posts.id, { onDelete: 'cascade' }),
		// a quote regiorg: the post this one quotes. Deleting the quoted post keeps the quote, which
		// then shows the quoted post as unavailable (is_quote stays true)
		quote_of: integer('quote_of').references((): AnyPgColumn => posts.id, { onDelete: 'set null' }),
		is_quote: boolean('is_quote').notNull().default(false),
		// pinned by staff to the top of the home timeline for everyone; null when not pinned
		timeline_pinned_at: timestamptz('timeline_pinned_at')
	},
	(t) => [index('posts_quote_of').on(t.quote_of)]
);

// A poll attached to a post: one vote per profile, changeable until ends_at.
export const polls = pgTable(
	'polls',
	{
		post_id: integer('post_id')
			.primaryKey()
			.references(() => posts.id, { onDelete: 'cascade' }),
		// the choices, in order; votes point at them by index
		options: text('options').array().notNull(),
		ends_at: timestamptz('ends_at').notNull()
	},
	(t) => [check('polls_options_check', sql`cardinality(${t.options}) BETWEEN 2 AND 4`)]
);

export const poll_votes = pgTable(
	'poll_votes',
	{
		post_id: integer('post_id')
			.notNull()
			.references(() => polls.post_id, { onDelete: 'cascade' }),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// index into polls.options
		option: integer('option').notNull(),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.post_id, t.user_id] }),
		check('poll_votes_option_check', sql`${t.option} >= 0`)
	]
);

// Hashtags of a post, lowercased and without the "#". Written by the post API with
// extractHashtags (src/lib/hashtags.ts), which is the one definition of what a hashtag is.
export const post_hashtags = pgTable(
	'post_hashtags',
	{
		post_id: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull()
	},
	(t) => [
		// the tag first: hashtag pages and counts look rows up by tag
		primaryKey({ columns: [t.tag, t.post_id] }),
		index('post_hashtags_post_id').on(t.post_id)
	]
);

export const likes = pgTable(
	'likes',
	{
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		post_id: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.user_id, t.post_id] })]
);

// A regiorg reshares a post: it shows up on the regiorger's profile and in their followers'
// feeds, as of when it was regiorged.
export const regiorgs = pgTable(
	'regiorgs',
	{
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		post_id: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.user_id, t.post_id] }), index('regiorgs_post_id').on(t.post_id)]
);

export const inbox = pgTable(
	'inbox',
	{
		id: serial('id').primaryKey(),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		sender_id: integer('sender_id').references(() => users.id, { onDelete: 'cascade' }),
		post_id: integer('post_id').references(() => posts.id, { onDelete: 'cascade' }),
		// ratio: sender's reply (post_id) got more likes than the recipient's post
		// ratioed_by_you: the recipient's reply (post_id) got more likes than the sender's post
		// follow: the sender followed the recipient, post_id is null
		// regiorg: the sender regiorged the recipient's post
		// quote: the sender's post (post_id) quotes the recipient's post
		// invites: the sender (an admin) gave the recipient `invites` more, post_id is null
		type: text('type', {
			enum: [
				'mention',
				'reply',
				'like',
				'ratio',
				'ratioed_by_you',
				'follow',
				'regiorg',
				'quote',
				'invites'
			]
		}).notNull(),
		// invites: how many were given (grants add up while the notification is unread)
		invites: integer('invites'),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		read_at: timestamptz('read_at'),
		// set once a push for this row has been sent, so it never goes out twice
		pushed_at: timestamptz('pushed_at')
	},
	(t) => [
		unique().on(t.user_id, t.sender_id, t.post_id, t.type),
		// follows have no post, and nulls never conflict in the key above: one per follower, so
		// unfollowing and following again doesn't notify twice
		uniqueIndex('inbox_follow_unique')
			.on(t.user_id, t.sender_id)
			.where(sql`${t.type} = 'follow'`),
		check(
			'inbox_type_check',
			sql`${t.type} IN ('mention', 'reply', 'like', 'ratio', 'ratioed_by_you', 'follow', 'regiorg', 'quote', 'invites')`
		)
	]
);

// Direct messages between two profiles (an identity has its own conversations, like its own inbox).
export const messages = pgTable(
	'messages',
	{
		id: serial('id').primaryKey(),
		sender_id: integer('sender_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		recipient_id: integer('recipient_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		content: text('content').notNull(),
		// URL paths of uploaded images; a message may have images and no text
		images: text('images')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		// a KLIPY GIF instead of images, like posts.gif
		gif: jsonb('gif').$type<Gif>(),
		// the message this one answers; the reply stays when it is deleted
		reply_to_id: integer('reply_to_id').references((): AnyPgColumn => messages.id, {
			onDelete: 'set null'
		}),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		// the sender can change the text for an hour after sending
		edited_at: timestamptz('edited_at'),
		read_at: timestamptz('read_at')
	},
	(t) => [
		index('messages_sender_recipient').on(t.sender_id, t.recipient_id, t.id),
		index('messages_recipient_sender').on(t.recipient_id, t.sender_id, t.id),
		// deleting a message clears the replies to it
		index('messages_reply_to_id')
			.on(t.reply_to_id)
			.where(sql`${t.reply_to_id} IS NOT NULL`),
		index('messages_unread')
			.on(t.recipient_id, t.sender_id)
			.where(sql`${t.read_at} IS NULL`),
		// finds the message an image belongs to, to check who may see it (src/routes/dm-uploads)
		index('messages_images').using('gin', t.images),
		check('messages_not_self', sql`${t.sender_id} != ${t.recipient_id}`)
	]
);

// Group chats: conversations between several profiles. Any member can rename it, add people
// and leave; only the owner can remove others.
export const group_chats = pgTable('group_chats', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	// passes to the longest standing member when the owner leaves. Null once the owner's profile
	// is deleted: the longest standing member is then treated as the owner (see groups.ts)
	owner_id: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
	created_at: timestamptz('created_at').notNull().defaultNow()
});

export const group_members = pgTable(
	'group_members',
	{
		group_id: integer('group_id')
			.notNull()
			.references(() => group_chats.id, { onDelete: 'cascade' }),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		joined_at: timestamptz('joined_at').notNull().defaultNow(),
		// the latest group message this member has read: later ones sent by others are unread
		last_read_id: integer('last_read_id').notNull().default(0),
		// muted: no push, and the group's unread messages stay out of the messages badge
		muted: boolean('muted').notNull().default(false)
	},
	(t) => [
		primaryKey({ columns: [t.group_id, t.user_id] }),
		index('group_members_user_id').on(t.user_id)
	]
);

export const group_messages = pgTable(
	'group_messages',
	{
		id: serial('id').primaryKey(),
		group_id: integer('group_id')
			.notNull()
			.references(() => group_chats.id, { onDelete: 'cascade' }),
		// messages stay when their sender leaves the group, and go with their profile
		sender_id: integer('sender_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// message: written by sender_id. The others are events shown in the chat, never unread:
		// created (content: the name), added / removed (sender_id did it to target_id), left,
		// renamed (content: the new name), owner (sender_id became the owner)
		kind: text('kind', {
			enum: ['message', 'created', 'added', 'removed', 'left', 'renamed', 'owner']
		})
			.notNull()
			.default('message'),
		// who an added / removed event is about
		target_id: integer('target_id').references(() => users.id, { onDelete: 'cascade' }),
		content: text('content').notNull(),
		// URL paths of uploaded images; a message may have images and no text
		images: text('images')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		// a KLIPY GIF instead of images, like posts.gif
		gif: jsonb('gif').$type<Gif>(),
		// the message this one answers; the reply stays when it is deleted
		reply_to_id: integer('reply_to_id').references((): AnyPgColumn => group_messages.id, {
			onDelete: 'set null'
		}),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		// the sender can change the text for an hour after sending
		edited_at: timestamptz('edited_at')
	},
	(t) => [
		index('group_messages_group_id').on(t.group_id, t.id),
		// finds the message an image belongs to, like messages_images
		index('group_messages_images').using('gin', t.images),
		index('group_messages_reply_to_id')
			.on(t.reply_to_id)
			.where(sql`${t.reply_to_id} IS NOT NULL`),
		check(
			'group_messages_kind_check',
			sql`${t.kind} IN ('message', 'created', 'added', 'removed', 'left', 'renamed', 'owner')`
		)
	]
);

// Emoji reactions to messages: one per profile and message, changing it replaces the old one.
// read_at: when the message's sender saw it. Unread reactions mark the chat unread without
// touching where the chat reads from (messages.read_at / group_members.last_read_id).
export const message_reactions = pgTable(
	'message_reactions',
	{
		message_id: integer('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		read_at: timestamptz('read_at')
	},
	(t) => [
		primaryKey({ columns: [t.message_id, t.user_id] }),
		index('message_reactions_unread')
			.on(t.message_id)
			.where(sql`${t.read_at} IS NULL`)
	]
);

export const group_message_reactions = pgTable(
	'group_message_reactions',
	{
		message_id: integer('message_id')
			.notNull()
			.references(() => group_messages.id, { onDelete: 'cascade' }),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		read_at: timestamptz('read_at')
	},
	(t) => [
		primaryKey({ columns: [t.message_id, t.user_id] }),
		index('group_message_reactions_unread')
			.on(t.message_id)
			.where(sql`${t.read_at} IS NULL`)
	]
);

// Direct conversations a profile muted: no push for what peer_id sends, and its unread messages
// stay out of the messages badge. Groups are muted on group_members.
export const dm_mutes = pgTable(
	'dm_mutes',
	{
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		peer_id: integer('peer_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.user_id, t.peer_id] }),
		check('dm_mutes_not_self', sql`${t.user_id} != ${t.peer_id}`)
	]
);

// Blocking stops direct messages in both directions between the two profiles.
export const blocks = pgTable(
	'blocks',
	{
		blocker_id: integer('blocker_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		blocked_id: integer('blocked_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.blocker_id, t.blocked_id] }),
		index('blocks_blocked_id').on(t.blocked_id),
		check('blocks_not_self', sql`${t.blocker_id} != ${t.blocked_id}`)
	]
);

// Follows are between profiles: an identity follows and is followed on its own.
export const follows = pgTable(
	'follows',
	{
		follower_id: integer('follower_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		followed_id: integer('followed_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.follower_id, t.followed_id] }),
		index('follows_followed_id').on(t.followed_id),
		check('follows_not_self', sql`${t.follower_id} != ${t.followed_id}`)
	]
);

// Accounts an identity is shared with: they can switch to it and use it like the owner does,
// but only the owner (users.owner_id) can delete it or change who it is shared with.
export const identity_members = pgTable(
	'identity_members',
	{
		identity_id: integer('identity_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		account_id: integer('account_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.identity_id, t.account_id] }),
		index('identity_members_account_id').on(t.account_id),
		check('identity_members_not_self', sql`${t.identity_id} != ${t.account_id}`)
	]
);

// key/value settings (the web push VAPID key pair is generated on first use)
export const settings = pgTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

// A browser subscription hangs off the session that created it, so logging out (or the session
// expiring) stops the notifications for that account on that browser.
export const push_subscriptions = pgTable(
	'push_subscriptions',
	{
		session_token: text('session_token')
			.notNull()
			.references(() => sessions.token, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.session_token, t.endpoint] }),
		index('push_subscriptions_endpoint').on(t.endpoint)
	]
);

// A phone of the mobile app, registered with its push service token (FCM on Android). Like a
// browser subscription it hangs off the session or token that registered it, so logging out of
// the app stops the notifications for that account on that phone.
export const push_devices = pgTable(
	'push_devices',
	{
		session_token: text('session_token')
			.notNull()
			.references(() => sessions.token, { onDelete: 'cascade' }),
		platform: text('platform', { enum: ['android'] }).notNull(),
		token: text('token').notNull(),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.session_token, t.token] }),
		index('push_devices_token').on(t.token)
	]
);

// WebAuthn credentials, an optional way to sign in to an account next to its password.
// Identities have no passkeys of their own, like they have no password.
export const passkeys = pgTable(
	'passkeys',
	{
		// base64url credential id, as the browser reports it
		id: text('id').primaryKey(),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// base64url COSE public key
		public_key: text('public_key').notNull(),
		// the signature counter is a uint32, too big for int4
		counter: bigint('counter', { mode: 'number' }).notNull().default(0),
		transports: text('transports')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		name: text('name').notNull(),
		// synced passkeys (multiDevice + backed up) survive losing the device
		backed_up: boolean('backed_up').notNull().default(false),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		last_used_at: timestamptz('last_used_at')
	},
	(t) => [index('passkeys_user_id').on(t.user_id)]
);

// API credentials of a bot profile (users.bot). Only a hash of the token is stored: it is shown
// once when created or regenerated (see src/lib/server/bots.ts).
export const bots = pgTable('bots', {
	user_id: integer('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	// sha256 hex of the bearer token
	token_hash: text('token_hash').notNull().unique(),
	created_at: timestamptz('created_at').notNull().defaultNow(),
	last_used_at: timestamptz('last_used_at')
});

// Open Graph metadata of external links posted in posts, fetched server side and shared by every
// post linking the same URL (see src/lib/server/linkPreviews.ts). A row without a title is a
// failed fetch, kept so the URL isn't retried on every read.
export const link_previews = pgTable(
	'link_previews',
	{
		url: text('url').primaryKey(),
		title: text('title'),
		description: text('description'),
		// our copy of the page's image, /previews/<sha256 of its URL>.webp (previewImages.ts), or
		// null. Rows written before images were stored hold the site's https URL, never shown
		image: text('image'),
		site_name: text('site_name'),
		fetched_at: timestamptz('fetched_at').notNull().defaultNow()
	},
	// is a preview image still used before it's deleted, and the sweep of old rows
	(t) => [
		index('link_previews_image').on(t.image),
		index('link_previews_fetched_at').on(t.fetched_at)
	]
);

// Posts and profiles people reported to the staff. The post's text is copied when it is reported,
// so the report still shows what was said once the post is deleted (post_id becomes null).
export const reports = pgTable(
	'reports',
	{
		id: serial('id').primaryKey(),
		// the profile that reported, and the account behind it (rate limits, dedup)
		reporter_id: integer('reporter_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// the reported profile: the post's author, or the profile itself
		target_id: integer('target_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['post', 'profile'] }).notNull(),
		post_id: integer('post_id').references(() => posts.id, { onDelete: 'set null' }),
		post_content: text('post_content'),
		category: text('category').notNull(),
		details: text('details').notNull().default(''),
		status: text('status', { enum: ['open', 'resolved', 'dismissed'] })
			.notNull()
			.default('open'),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		resolved_at: timestamptz('resolved_at'),
		resolved_by: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),
		resolution_note: text('resolution_note')
	},
	(t) => [
		index('reports_status_id').on(t.status, t.id),
		index('reports_target_id').on(t.target_id),
		index('reports_post_id').on(t.post_id),
		check('reports_kind_check', sql`${t.kind} IN ('post', 'profile')`),
		check('reports_status_check', sql`${t.status} IN ('open', 'resolved', 'dismissed')`)
	]
);

// Everything staff did (and the bans and mutes that ran out), newest last: the moderation log. Notes
// staff leave on an account are entries too. The usernames are copied so the log still reads right
// once a profile is renamed or deleted.
export const moderation_log = pgTable(
	'moderation_log',
	{
		id: serial('id').primaryKey(),
		// null when the system did it (an expired ban) or the staff member was deleted
		actor_id: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
		actor_username: text('actor_username'),
		// the account acted on (moderation targets accounts, see moderation.ts)
		target_id: integer('target_id').references(() => users.id, { onDelete: 'set null' }),
		target_username: text('target_username'),
		action: text('action').notNull(),
		reason: text('reason'),
		// when a temporary ban or mute runs out
		expires_at: timestamptz('expires_at'),
		// what else the action is about: the deleted post's text, the new role, the report…
		details: jsonb('details').$type<Record<string, unknown>>(),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		index('moderation_log_target_id').on(t.target_id, t.id),
		index('moderation_log_actor_id').on(t.actor_id, t.id)
	]
);

// GIFs a profile saved to find again in the GIF picker: a copy of the GIF object a post stores
// (KLIPY's URLs, never the media), keyed by KLIPY's slug. Newest first.
export const gif_favorites = pgTable(
	'gif_favorites',
	{
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		slug: text('slug').notNull(),
		gif: jsonb('gif').$type<Gif>().notNull(),
		created_at: timestamptz('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.user_id, t.slug] }),
		index('gif_favorites_user_id_created_at').on(t.user_id, t.created_at)
	]
);

// Single use codes that let someone sign up (src/lib/server/invites.ts). Admins give accounts a
// number of invites (users.invites), which they turn into codes one at a time, or create codes
// themselves. A code counts once it is used; one revoked or expired unused gives the invite back.
export const invites = pgTable(
	'invites',
	{
		id: serial('id').primaryKey(),
		// kept readable so the person who made it can copy it again; single use and short lived
		code: text('code').notNull().unique(),
		// the account that created it; null once that account is deleted
		inviter_id: integer('inviter_id').references(() => users.id, { onDelete: 'set null' }),
		// made by an admin outside any balance, so revoking it gives nothing back
		by_staff: boolean('by_staff').notNull().default(false),
		// who it is for, only shown to the person who made it and to admins
		note: text('note').notNull().default(''),
		created_at: timestamptz('created_at').notNull().defaultNow(),
		// null never expires
		expires_at: timestamptz('expires_at'),
		used_at: timestamptz('used_at'),
		// the account that signed up with it
		used_by: integer('used_by')
			.unique()
			.references(() => users.id, { onDelete: 'set null' }),
		revoked_at: timestamptz('revoked_at')
	},
	(t) => [index('invites_inviter_id').on(t.inviter_id, t.id)]
);
