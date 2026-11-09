import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, identity_members, users } from './db/index.js';
import { uploadType } from './images.js';
import * as storage from './storage.js';
import { tokenError } from './auth.js';

/**
 * Message images are only served to the conversation they were sent in: the sender and
 * recipient of a direct message, or the current members of the group of a group message. That
 * is who can read the conversation (GET /api/v1/conversations/…/messages and
 * /api/v1/groups/…/messages), so an image stops loading for someone who leaves or is removed.
 */

/**
 * Every profile the request is signed in as: each account signed in on this browser (or the
 * account of a token) with the identities it can act as, or the bot of a bot token. Not only the
 * active one, so images in an open chat keep loading after switching profiles.
 */
async function viewerProfiles(locals: App.Locals): Promise<number[]> {
	if (!locals.user) return [];
	if (locals.auth === 'bot') return [locals.user.id];
	// locals.sessions is only filled from cookies
	const accountIds =
		locals.auth === 'token' && locals.accountId !== null
			? [locals.accountId]
			: locals.sessions.map((s) => s.accountId);
	if (accountIds.length === 0) return [locals.user.id];

	const owner = alias(users, 'owner');
	const rows = await db
		.select({ id: users.id })
		.from(users)
		.leftJoin(owner, eq(owner.id, users.owner_id))
		.where(
			or(
				inArray(users.id, accountIds),
				// bots are owned too, but only used through the bot API (like the profile switcher)
				and(inArray(users.owner_id, accountIds), eq(users.bot, false)),
				// shared identities can't be used while their owner is banned
				and(
					inArray(
						users.id,
						db
							.select({ id: identity_members.identity_id })
							.from(identity_members)
							.where(inArray(identity_members.account_id, accountIds))
					),
					isNull(owner.banned_at)
				)
			)
		);
	return [...new Set([locals.user.id, ...rows.map((r) => r.id)])];
}

export type ImageAccess = 'public' | 'allowed' | 'denied';

/**
 * Who may see the upload `file` (a name as uploadType accepts it): `public` when it isn't a
 * message image (a post image, or nothing at all), otherwise whether one of the request's
 * profiles is in the conversation. Matches both `/uploads/` (images sent before they became
 * private) and `/dm-uploads/` paths.
 */
export async function messageImageAccess(locals: App.Locals, file: string): Promise<ImageAccess> {
	const paths = sql`ARRAY[${'/uploads/' + file}, ${'/dm-uploads/' + file}]::text[]`;
	const profiles = await viewerProfiles(locals);
	const ids = sql`ARRAY[${sql.join(
		profiles.length ? profiles.map((id) => sql`${id}`) : [sql`NULL`],
		sql`, `
	)}]::int[]`;
	// `images &&` uses the GIN indexes on both columns
	const [row] = await db.execute<{ owned: boolean; allowed: boolean }>(sql`
		SELECT
			(EXISTS (SELECT 1 FROM messages WHERE images && ${paths})
				OR EXISTS (SELECT 1 FROM group_messages WHERE images && ${paths})) AS owned,
			(EXISTS (SELECT 1 FROM messages
					WHERE images && ${paths}
						AND (sender_id = ANY(${ids}) OR recipient_id = ANY(${ids})))
				OR EXISTS (SELECT 1 FROM group_messages
					JOIN group_members ON group_members.group_id = group_messages.group_id
					WHERE group_messages.images && ${paths}
						AND group_members.user_id = ANY(${ids}))) AS allowed
	`);
	if (!row?.owned) return 'public';
	return row.allowed ? 'allowed' : 'denied';
}

// served like /uploads; an SVG (from before uploads were re-encoded) opened on its own would
// otherwise run its scripts on our origin
const SANDBOX = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

// a 404 is never cached, by the browser or Cloudflare: it may only mean "not yours", and the
// same URL answers 200 to someone in the conversation
export const notFound = () =>
	new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * The response for an upload: a message image (`private`, read from `dm/` and then `uploads/`,
 * where files sent before images were private are) or a post image (`public`, `uploads/` only).
 */
export async function serveUpload(file: string, access: 'public' | 'private'): Promise<Response> {
	const type = uploadType(file);
	if (!type) return notFound();
	const object =
		access === 'private'
			? (await storage.get(`dm/${file}`)) ?? (await storage.get(`uploads/${file}`))
			: await storage.get(`uploads/${file}`);
	if (!object) return notFound();
	return new Response(object.body, {
		headers: {
			'Content-Type': type,
			'Content-Length': object.size.toString(),
			// file names are random uuids, so a post image never changes. A message image can be
			// deleted or stop being yours, so it's only kept in the browser, for a while
			'Cache-Control':
				access === 'private' ? 'private, max-age=3600' : 'public, max-age=31536000, immutable',
			'Content-Security-Policy': SANDBOX
		}
	});
}

/**
 * The answer for GET /uploads/`file` or /dm-uploads/`file` (`route`). A post image (only under
 * /uploads/) is public whatever the request's token. A message image answers the token's error
 * when an invalid one was sent (see authenticate), the same 404 as a missing file when no
 * profile of the request is in the conversation, and the image otherwise.
 */
export async function uploadResponse(
	locals: App.Locals,
	file: string,
	route: 'uploads' | 'dm-uploads'
): Promise<Response> {
	if (!uploadType(file)) return notFound();
	const access = await messageImageAccess(locals, file);
	if (access === 'public') return route === 'uploads' ? serveUpload(file, 'public') : notFound();
	if (locals.invalidToken) return tokenError(locals) ?? notFound();
	return access === 'allowed' ? serveUpload(file, 'private') : notFound();
}
