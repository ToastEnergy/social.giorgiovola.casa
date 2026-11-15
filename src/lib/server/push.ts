import * as webpush from 'web-push';
import { and, desc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	db,
	dm_mutes,
	group_members,
	inbox,
	posts,
	push_devices,
	push_subscriptions,
	sessions,
	settings,
	users
} from './db/index.js';
import { PUBLIC_URL } from '$app/env/public';
import type { ChatMessage, GroupMessage, NotificationType } from '#lib/types.js';
import { mentions } from '#lib/mentions.js';
import { fcmConfigured, sendFcm } from './fcm.js';

/**
 * Push notifications: web push to the browsers subscribed by the recipient's account(s), and FCM
 * to the phones of the Android app they are signed in on.
 */

type Vapid = { publicKey: string; privateKey: string };

// The key pair is created once and kept in the database, so there is nothing to configure.
let vapid: Promise<Vapid> | null = null;

async function loadVapid(): Promise<Vapid> {
	const read = async () => {
		const rows = await db
			.select()
			.from(settings)
			.where(inArray(settings.key, ['vapid_public', 'vapid_private']));
		const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
		return map.vapid_public && map.vapid_private
			? { publicKey: map.vapid_public, privateKey: map.vapid_private }
			: null;
	};
	const existing = await read();
	if (existing) return existing;
	const keys = webpush.generateVAPIDKeys();
	// concurrent first uses: whoever inserts first wins, the others read it back
	await db
		.insert(settings)
		.values([
			{ key: 'vapid_public', value: keys.publicKey },
			{ key: 'vapid_private', value: keys.privateKey }
		])
		.onConflictDoNothing();
	const stored = await read();
	if (!stored) throw new Error('push: could not store the VAPID keys');
	return stored;
}

export function getVapid() {
	if (!vapid) {
		vapid = loadVapid().catch((e) => {
			vapid = null;
			throw e;
		});
	}
	return vapid;
}

// Subscriptions are only accepted from the real push services: the server POSTs to the stored
// endpoint, so an arbitrary URL would let a user make it call internal addresses.
const PUSH_HOSTS = [
	'fcm.googleapis.com',
	'push.services.mozilla.com',
	'push.apple.com',
	'notify.windows.com'
];

export function isPushEndpoint(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2048) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			!url.port &&
			!url.username &&
			PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
		);
	} catch {
		return false;
	}
}

const subject = () =>
	PUBLIC_URL?.startsWith('https://') ? PUBLIC_URL : 'mailto:admin@example.com';

type Row = {
	type: NotificationType;
	post_id: number;
	content: string | null;
	sender_name: string | null;
	sender_username: string | null;
	recipient_username: string;
	identity: boolean;
	recipient_id: number;
	/** other unread notifications of the same kind for this post (likes, regiorgs) */
	others: number;
};

/** Grouped notifications (likes, regiorgs, follows) name one sender and count the rest. */
const groupTitle = (name: string, others: number) =>
	others === 0 ? name : `${name} and ${others} ${others === 1 ? 'other' : 'others'}`;

/** Types grouped on the notifications page: their pushes replace each other per post. */
const GROUPED: NotificationType[] = ['like', 'regiorg'];

/** Whether the notification's post belongs to the recipient (else to the sender). */
export const recipientOwnsPost = (type: NotificationType) =>
	type === 'like' || type === 'ratioed_by_you' || type === 'regiorg';

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max)}…` : text);

function payloadFor(row: Row) {
	const sender = row.sender_name ?? 'Someone';
	const verbs: Record<NotificationType, string> = {
		like: 'liked your post',
		reply: 'replied to your post',
		mention: 'mentioned you in a post',
		ratio: 'ratioed your post',
		ratioed_by_you: 'got ratioed by your reply',
		// follows go through sendFollowPush
		follow: 'followed you',
		regiorg: 'regiorged your post',
		quote: 'quoted your post',
		// invites go through sendInvitesPush
		invites: 'gave you invites'
	};
	const verb = verbs[row.type];
	// likes and regiorgs are of the recipient's own post: no need to quote it back
	let body =
		row.type === 'like' || row.type === 'regiorg' || !row.content
			? verb
			: `${verb}: ${clip(row.content)}`;
	// identities share the devices of the accounts using them: say which profile it is for
	if (row.identity) body += ` (@${row.recipient_username})`;
	// the link matches the notifications page: likes and ratios won point at the recipient's own post
	const owner = recipientOwnsPost(row.type) ? row.recipient_username : row.sender_username;
	return {
		title: GROUPED.includes(row.type) ? groupTitle(sender, row.others) : sender,
		body,
		url: owner ? `/@${owner}/${row.post_id}` : '/notifications',
		tag: `${row.type}:${row.post_id}`
	};
}

type Payload = { title: string; body: string; url: string; tag: string };

/** How a push went: 'retry' when nothing reached any device and trying again may help. */
type Outcome = 'sent' | 'retry';

/** What sending to a set of devices did: how many got it, and how many failed transiently. */
type Tally = { sent: number; transient: number };

/**
 * Sends a notification to every browser and phone of an account that can use this profile:
 * the account itself, or the owner of an identity and the accounts it is shared with. 'retry'
 * only when no device got it and at least one failed for a reason that may pass: a device that
 * did get it shouldn't get it twice.
 */
async function deliver(profileId: number, payload: Payload): Promise<Outcome> {
	// bots notify nobody: their owner would get a push for everything the bot receives
	const sessionsOfProfile = sql`${sessions.user_id} IN (
		SELECT COALESCE(owner_id, id) FROM users WHERE id = ${profileId} AND NOT bot
		UNION SELECT account_id FROM identity_members WHERE identity_id = ${profileId}
	)`;
	const tallies = await Promise.all([
		deliverWeb(sessionsOfProfile, payload),
		deliverApp(profileId, sessionsOfProfile, payload)
	]);
	const sent = tallies.reduce((n, t) => n + t.sent, 0);
	const transient = tallies.reduce((n, t) => n + t.transient, 0);
	return sent === 0 && transient > 0 ? 'retry' : 'sent';
}

// a push service that is overloaded or down, or a network error (no status)
const transientStatus = (status: number | undefined) =>
	status === undefined || status === 429 || status >= 500;

async function deliverWeb(sessionsOfProfile: SQL, payload: Payload): Promise<Tally> {
	const keys = await getVapid();
	const options = {
		vapidDetails: { subject: subject(), ...keys },
		TTL: 60 * 60 * 24,
		urgency: 'normal' as const
	};
	const subs = await db
		.selectDistinctOn([push_subscriptions.endpoint], {
			endpoint: push_subscriptions.endpoint,
			p256dh: push_subscriptions.p256dh,
			auth: push_subscriptions.auth
		})
		.from(push_subscriptions)
		.innerJoin(sessions, eq(sessions.token, push_subscriptions.session_token))
		.where(sessionsOfProfile);
	const message = JSON.stringify(payload);
	const tally: Tally = { sent: 0, transient: 0 };
	await Promise.all(
		subs.map(async (sub) => {
			try {
				await webpush.sendNotification(
					{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
					message,
					options
				);
				tally.sent++;
			} catch (e) {
				const status = (e as { statusCode?: number }).statusCode;
				// the browser dropped the subscription
				if (status === 404 || status === 410)
					await db.delete(push_subscriptions).where(eq(push_subscriptions.endpoint, sub.endpoint));
				else {
					console.error('push: send failed', status ?? e);
					if (transientStatus(status)) tally.transient++;
				}
			}
		})
	);
	return tally;
}

async function deliverApp(
	profileId: number,
	sessionsOfProfile: SQL,
	payload: Payload
): Promise<Tally> {
	const tally: Tally = { sent: 0, transient: 0 };
	if (!fcmConfigured()) return tally;
	// one per phone, even when several of its accounts can use the profile
	const devices = await db
		.selectDistinct({ token: push_devices.token })
		.from(push_devices)
		.innerJoin(sessions, eq(sessions.token, push_devices.session_token))
		.where(and(eq(push_devices.platform, 'android'), sessionsOfProfile));
	if (devices.length === 0) return tally;
	// the app switches to the profile the notification is for before opening it
	const [profile] = await db
		.select({ username: users.username })
		.from(users)
		.where(eq(users.id, profileId));
	const channel =
		payload.tag.startsWith('message:') || payload.tag.startsWith('group:')
			? 'messages'
			: 'activity';
	await Promise.all(
		devices.map(async ({ token }) => {
			try {
				const result = await sendFcm(token, { ...payload, channel, profile: profile?.username });
				if (result === 'sent') tally.sent++;
				else if (result === 'retry') tally.transient++;
				else if (result === 'gone')
					await db.delete(push_devices).where(eq(push_devices.token, token));
			} catch (e) {
				// a network error, or no access token
				console.error('push: fcm send failed', e);
				tally.transient++;
			}
		})
	);
	return tally;
}

/** Notifies the recipient of a direct message, unless they muted the conversation. */
export async function sendMessagePush(
	recipientId: number,
	senderId: number,
	message: ChatMessage,
	senderName: string
) {
	try {
		const [recipient] = await db
			.select({
				id: users.id,
				owner_id: users.owner_id,
				muted: sql<boolean>`EXISTS (SELECT 1 FROM ${dm_mutes} WHERE ${dm_mutes.user_id} = ${recipientId} AND ${dm_mutes.peer_id} = ${senderId})`
			})
			.from(users)
			.where(eq(users.id, recipientId));
		if (!recipient || recipient.muted) return;
		let body = message.content ? clip(message.content) : message.gif ? '🎞️ GIF' : '📷 Photo';
		// identities share the devices of the accounts using them: say which profile it is for
		if (recipient.owner_id !== null) body += ` (@${message.recipient})`;
		await deliver(recipient.id, {
			title: senderName,
			body,
			url: `/messages/${message.sender}`,
			// no image: message images are private, push services and lock screens shouldn't see them
			tag: `message:${message.sender}:${message.recipient}`
		});
	} catch (e) {
		console.error('push: sendMessagePush failed', e);
	}
}

/**
 * Notifies the members of a group chat, except its sender, of a new message. Who muted the group
 * only hears about the messages that mention them.
 */
export async function sendGroupMessagePush(
	recipientIds: number[],
	message: GroupMessage,
	groupName: string
) {
	try {
		if (recipientIds.length === 0) return;
		const recipients = await db
			.select({
				id: users.id,
				username: users.username,
				owner_id: users.owner_id,
				muted: group_members.muted
			})
			.from(users)
			.innerJoin(
				group_members,
				and(eq(group_members.user_id, users.id), eq(group_members.group_id, message.group_id))
			)
			.where(inArray(users.id, recipientIds));
		const text = message.content ? clip(message.content) : message.gif ? '🎞️ GIF' : '📷 Photo';
		for (const recipient of recipients) {
			const mentioned = mentions(message.content.toLowerCase(), recipient.username);
			if (recipient.muted && !mentioned) continue;
			let body = mentioned
				? `${message.sender.name} mentioned you: ${text}`
				: `${message.sender.name}: ${text}`;
			// identities share the devices of the accounts using them: say which profile it is for
			if (recipient.owner_id !== null) body += ` (@${recipient.username})`;
			await deliver(recipient.id, {
				title: groupName,
				body,
				url: `/messages/groups/${message.group_id}`,
				tag: `group:${message.group_id}:${recipient.username}`
			});
		}
	} catch (e) {
		console.error('push: sendGroupMessagePush failed', e);
	}
}

/** An inbox row whose push the worker claimed (pushOutbox.ts). */
export type PendingPush = {
	id: number;
	user_id: number;
	sender_id: number | null;
	post_id: number | null;
	type: NotificationType;
	invites: number | null;
};

type Payloads = Map<number, { recipientId: number; payload: Payload }>;

/**
 * The push a row is part of: each push replaces the previous one of its tag on the device, so
 * the rows of one tag (likes and regiorgs of a post, a profile's follows, its invites) are sent
 * as one. Any other row is a push of its own.
 */
function pushGroupOf(row: PendingPush) {
	if (GROUPED.includes(row.type)) return `${row.type}:${row.user_id}:${row.post_id}`;
	if (row.type === 'follow' || row.type === 'invites') return `${row.type}:${row.user_id}`;
	return `row:${row.id}`;
}

/**
 * Sends the pushes of the rows the worker claimed, one per group (pushGroupOf), named after its
 * newest row and counting the others. Answers the ids of the rows done (sent, or with nothing to
 * send) and of those to try again later.
 */
export async function sendPending(rows: PendingPush[]) {
	const groups = new Map<string, PendingPush[]>();
	for (const row of rows)
		groups.set(pushGroupOf(row), [...(groups.get(pushGroupOf(row)) ?? []), row]);
	const newest = [...groups.values()].map((g) => g.reduce((a, b) => (b.id > a.id ? b : a)));

	// the push of each group, from its newest row. a row gone since the claim (an unlike, a
	// deleted post) isn't found, and its group has nothing to send
	const payloads: Payloads = new Map();
	const failed = new Set<number>();
	for (const [kind, build] of [
		['post', postPayloads],
		['follow', followPayloads],
		['invites', invitesPayloads]
	] as const) {
		try {
			await build(newest, payloads);
		} catch (e) {
			console.error(`push: reading the ${kind} pushes failed`, e);
			for (const n of newest) if (!payloads.has(n.id)) failed.add(n.id);
		}
	}

	const done: number[] = [];
	const retry: number[] = [];
	for (const n of newest) {
		let outcome: Outcome = failed.has(n.id) ? 'retry' : 'sent';
		const push = payloads.get(n.id);
		if (push) {
			try {
				outcome = await deliver(push.recipientId, push.payload);
			} catch (e) {
				console.error('push: send failed', e);
				outcome = 'retry';
			}
		}
		(outcome === 'retry' ? retry : done).push(...groups.get(pushGroupOf(n))!.map((r) => r.id));
	}
	return { done, retry };
}

/** Pushes of the post notifications (likes, replies, mentions…) among `rows`. */
async function postPayloads(rows: PendingPush[], out: Payloads) {
	const ids = rows.filter((n) => n.post_id !== null).map((n) => n.id);
	if (ids.length === 0) return;
	const sender = alias(users, 'sender');
	const recipient = alias(users, 'recipient');
	const found = await db
		.select({
			id: inbox.id,
			type: inbox.type,
			post_id: sql<number>`${inbox.post_id}`,
			content: posts.content,
			sender_name: sender.name,
			sender_username: sender.username,
			recipient_username: recipient.username,
			identity: sql<boolean>`${recipient.owner_id} IS NOT NULL`,
			recipient_id: recipient.id,
			// the push replaces the previous one of the same tag, so it speaks for all of them
			others: sql<number>`CASE WHEN ${inbox.type} IN ('like', 'regiorg') THEN (
				SELECT count(*)::int FROM inbox o
				WHERE o.user_id = ${inbox.user_id} AND o.post_id = ${inbox.post_id}
					AND o.type = ${inbox.type} AND o.sender_id IS DISTINCT FROM ${inbox.sender_id}
					AND o.read_at IS NULL
			) ELSE 0 END`
		})
		.from(inbox)
		.innerJoin(recipient, eq(recipient.id, inbox.user_id))
		.leftJoin(sender, eq(sender.id, inbox.sender_id))
		.leftJoin(posts, eq(posts.id, inbox.post_id))
		.where(inArray(inbox.id, ids));
	for (const row of found)
		out.set(row.id, { recipientId: row.recipient_id, payload: payloadFor(row) });
}

/** Pushes of the follow notifications among `rows`: one tag for all of a profile's follows. */
async function followPayloads(rows: PendingPush[], out: Payloads) {
	const follows = rows.filter((n) => n.type === 'follow' && n.sender_id !== null);
	if (follows.length === 0) return;
	const profileIds = [...new Set(follows.flatMap((n) => [n.user_id, n.sender_id!]))];
	const found = await db
		.select({
			id: users.id,
			name: users.name,
			username: users.username,
			owner_id: users.owner_id
		})
		.from(users)
		.where(inArray(users.id, profileIds));
	for (const n of follows) {
		const sender = found.find((u) => u.id === n.sender_id);
		const recipient = found.find((u) => u.id === n.user_id);
		if (!sender || !recipient) continue;
		// the push replaces the previous one and counts the unread rest
		const others = await db.$count(
			inbox,
			and(
				eq(inbox.type, 'follow'),
				eq(inbox.user_id, n.user_id),
				sql`${inbox.sender_id} IS DISTINCT FROM ${n.sender_id}`,
				isNull(inbox.read_at)
			)
		);
		let body = 'followed you';
		// identities share the owner's devices: say which profile it is for
		if (recipient.owner_id !== null) body += ` (@${recipient.username})`;
		// the profile itself: deliver finds the accounts using it, and skips bots
		out.set(n.id, {
			recipientId: recipient.id,
			payload: {
				title: groupTitle(sender.name, others),
				body,
				url: others === 0 ? `/@${sender.username}` : '/notifications',
				tag: `follow:${recipient.username}`
			}
		});
	}
}

/**
 * Pushes of the invites notifications among `rows`. A grant that adds to an unread notification
 * makes it pending again (invites.ts), so it goes out again with the new total.
 */
async function invitesPayloads(rows: PendingPush[], out: Payloads) {
	const grants = rows.filter((n) => n.type === 'invites');
	if (grants.length === 0) return;
	const senderIds = [...new Set(grants.map((g) => g.sender_id).filter((id) => id !== null))];
	const senders = senderIds.length
		? await db
				.select({ id: users.id, name: users.name })
				.from(users)
				.where(inArray(users.id, senderIds))
		: [];
	for (const row of grants) {
		const n = row.invites ?? 0;
		out.set(row.id, {
			recipientId: row.user_id,
			payload: {
				title: senders.find((s) => s.id === row.sender_id)?.name ?? 'Invites',
				body: `gave you ${n} ${n === 1 ? 'invite' : 'invites'}: invite someone to join`,
				url: '/settings/invites',
				// per account: a browser can be signed in to several
				tag: `invites:${row.user_id}`
			}
		});
	}
}

const MAX_PER_SESSION = 10;
const KEY = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Stores (or refreshes) a push subscription for the session or token in use (`sessionKey`), so
 * signing out stops it. Returns false when the subscription isn't valid.
 */
export async function subscribePush(sessionKey: string, body: Record<string, unknown>) {
	const endpoint = body.endpoint;
	const keys = (body.keys ?? {}) as { p256dh?: unknown; auth?: unknown };
	const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
	const auth = typeof keys.auth === 'string' ? keys.auth : '';
	if (!isPushEndpoint(endpoint) || !KEY.test(p256dh) || !KEY.test(auth)) return false;

	await db.transaction(async (tx) => {
		await tx
			.insert(push_subscriptions)
			.values({ session_token: sessionKey, endpoint, p256dh, auth })
			.onConflictDoUpdate({
				target: [push_subscriptions.session_token, push_subscriptions.endpoint],
				set: { p256dh, auth }
			});
		const keep = tx
			.select({ endpoint: push_subscriptions.endpoint })
			.from(push_subscriptions)
			.where(eq(push_subscriptions.session_token, sessionKey))
			.orderBy(desc(push_subscriptions.created_at))
			.limit(MAX_PER_SESSION);
		await tx
			.delete(push_subscriptions)
			.where(
				and(
					eq(push_subscriptions.session_token, sessionKey),
					notInArray(push_subscriptions.endpoint, keep)
				)
			);
	});
	return true;
}

export const unsubscribePush = (sessionKey: string, endpoint: string) =>
	db
		.delete(push_subscriptions)
		.where(
			and(
				eq(push_subscriptions.session_token, sessionKey),
				eq(push_subscriptions.endpoint, endpoint)
			)
		);

const MAX_DEVICES_PER_SESSION = 5;
// FCM registration tokens: letters, digits and - _ : (about 160 characters today)
const DEVICE_TOKEN = /^[A-Za-z0-9_:.-]{20,4096}$/;

/**
 * Registers a phone of the mobile app for the session or token in use (`sessionKey`), so logging
 * out stops it. Returns false when the platform or token isn't valid.
 */
export async function registerPushDevice(sessionKey: string, body: Record<string, unknown>) {
	const platform = body.platform;
	const token = body.token;
	if (platform !== 'android' || typeof token !== 'string' || !DEVICE_TOKEN.test(token))
		return false;
	await db.transaction(async (tx) => {
		await tx
			.insert(push_devices)
			.values({ session_token: sessionKey, platform, token })
			.onConflictDoNothing();
		const keep = tx
			.select({ token: push_devices.token })
			.from(push_devices)
			.where(eq(push_devices.session_token, sessionKey))
			.orderBy(desc(push_devices.created_at))
			.limit(MAX_DEVICES_PER_SESSION);
		await tx
			.delete(push_devices)
			.where(and(eq(push_devices.session_token, sessionKey), notInArray(push_devices.token, keep)));
	});
	return true;
}

export const unregisterPushDevice = (sessionKey: string, token: string) =>
	db
		.delete(push_devices)
		.where(and(eq(push_devices.session_token, sessionKey), eq(push_devices.token, token)));
