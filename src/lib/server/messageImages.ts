import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, identity_members, users } from './db/index.js';
import { uploadType } from './images.js';
import * as storage from './storage.js';
import { tokenError } from './auth.js';

/**
 * Message images and voice notes are only served to the conversation they were sent in: the
 * sender and recipient of a direct message, or the current members of the group of a group
 * message. That is who can read the conversation (GET /api/v1/conversations/…/messages and
 * /api/v1/groups/…/messages), so a file stops loading for someone who leaves or is removed.
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
 * message image or voice note (a post's, or nothing at all), otherwise whether one of the
 * request's profiles is in the conversation. Matches both `/uploads/` (images sent before they
 * became private) and `/dm-uploads/` paths.
 */
export async function messageMediaAccess(locals: App.Locals, file: string): Promise<ImageAccess> {
	const paths = sql`ARRAY[${'/uploads/' + file}, ${'/dm-uploads/' + file}]::text[]`;
	const profiles = await viewerProfiles(locals);
	const ids = sql`ARRAY[${sql.join(
		profiles.length ? profiles.map((id) => sql`${id}`) : [sql`NULL`],
		sql`, `
	)}]::int[]`;
	// `images &&` uses the GIN indexes on both tables, the audio test their audio_url indexes
	const inMessage = sql`(messages.images && ${paths}
		OR (messages.audio IS NOT NULL AND messages.audio->>'url' = ANY(${paths})))`;
	const inGroupMessage = sql`(group_messages.images && ${paths}
		OR (group_messages.audio IS NOT NULL AND group_messages.audio->>'url' = ANY(${paths})))`;
	const [row] = await db.execute<{ owned: boolean; allowed: boolean }>(sql`
		SELECT
			(EXISTS (SELECT 1 FROM messages WHERE ${inMessage})
				OR EXISTS (SELECT 1 FROM group_messages WHERE ${inGroupMessage})) AS owned,
			(EXISTS (SELECT 1 FROM messages
					WHERE ${inMessage}
						AND (sender_id = ANY(${ids}) OR recipient_id = ANY(${ids})))
				OR EXISTS (SELECT 1 FROM group_messages
					JOIN group_members ON group_members.group_id = group_messages.group_id
					WHERE ${inGroupMessage}
						AND group_members.user_id = ANY(${ids}))) AS allowed
	`);
	if (!row?.owned) return 'public';
	return row.allowed ? 'allowed' : 'denied';
}

// served like /uploads (and /previews); an SVG (from before uploads were re-encoded) opened on
// its own would otherwise run its scripts on our origin
export const SANDBOX = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

// a 404 is never cached, by the browser or Cloudflare: it may only mean "not yours", and the
// same URL answers 200 to someone in the conversation
export const notFound = () =>
	new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * The `Range` header of a request against an object of `total` bytes (RFC 9110): the bytes to
 * send, `unsatisfiable` (416), or null to send everything (no header, one we don't support such
 * as several ranges, or an `If-Range` naming another version).
 */
export function parseRange(
	headers: Headers,
	total: number,
	etag: string
): storage.ByteRange | 'unsatisfiable' | null {
	const header = headers.get('range');
	if (!header) return null;
	const ifRange = headers.get('if-range');
	if (ifRange !== null && ifRange.trim() !== etag) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m || (m[1] === '' && m[2] === '')) return null;
	if (m[1] === '') {
		// the last n bytes
		const n = Number(m[2]);
		if (n === 0 || total === 0) return 'unsatisfiable';
		return { start: Math.max(0, total - n), end: total - 1 };
	}
	const start = Number(m[1]);
	// a last position before the first one makes the header invalid: ignored
	if (m[2] !== '' && Number(m[2]) < start) return null;
	if (start >= total) return 'unsatisfiable';
	return { start, end: m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1) };
}

/** Whether an If-None-Match header names `etag`. */
const matches = (header: string | null, etag: string) =>
	!!header && (header.trim() === '*' || header.split(',').some((t) => t.trim() === etag));

/**
 * The response for an upload: a message image or voice note (`private`, read from `dm/` and then
 * `uploads/`, where images sent before they were private are) or a post's (`public`, `uploads/`
 * only). Answers HTTP Range requests (206), which iOS needs to play and seek in audio.
 */
export async function serveUpload(
	file: string,
	access: 'public' | 'private',
	request: Request
): Promise<Response> {
	const type = uploadType(file);
	if (!type) return notFound();
	const keys = access === 'private' ? [`dm/${file}`, `uploads/${file}`] : [`uploads/${file}`];
	// file names are random uuids and never rewritten, so the name is a strong validator
	const etag = `"${file}"`;
	const headers: Record<string, string> = {
		'Content-Type': type,
		'Accept-Ranges': 'bytes',
		ETag: etag,
		// a post's file never changes. A message's can be deleted or stop being yours, so it's
		// only kept in the browser, for a while
		'Cache-Control':
			access === 'private' ? 'private, max-age=3600' : 'public, max-age=31536000, immutable',
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': SANDBOX
	};
	const ranged = request.headers.has('range');
	const revalidating = matches(request.headers.get('if-none-match'), etag);
	for (const key of keys) {
		// the size first, to answer a range or a revalidation, which a plain GET doesn't need
		const found = ranged || revalidating ? await storage.head(key) : null;
		if ((ranged || revalidating) && !found) continue;
		if (revalidating) return new Response(null, { status: 304, headers });
		const range = found ? parseRange(request.headers, found.size, etag) : null;
		if (range === 'unsatisfiable')
			return new Response(null, {
				status: 416,
				headers: { ...headers, 'Content-Range': `bytes */${found?.size ?? 0}` }
			});
		const object = await storage.get(key, range ?? undefined);
		if (!object) continue;
		if (!range)
			return new Response(object.body, {
				headers: { ...headers, 'Content-Length': object.size.toString() }
			});
		return new Response(object.body, {
			status: 206,
			headers: {
				...headers,
				'Content-Length': String(range.end - range.start + 1),
				'Content-Range': `bytes ${range.start}-${range.end}/${found?.size}`
			}
		});
	}
	return notFound();
}

/**
 * The answer for GET /uploads/`file` or /dm-uploads/`file` (`route`). A post's image or voice
 * note (only under /uploads/) is public whatever the request's token. A message's answers the
 * token's error when an invalid one was sent (see authenticate), the same 404 as a missing file
 * when no profile of the request is in the conversation, and the file otherwise.
 */
export async function uploadResponse(
	locals: App.Locals,
	request: Request,
	file: string,
	route: 'uploads' | 'dm-uploads'
): Promise<Response> {
	if (!uploadType(file)) return notFound();
	const access = await messageMediaAccess(locals, file);
	if (access === 'public')
		return route === 'uploads' ? serveUpload(file, 'public', request) : notFound();
	if (locals.invalidToken) return tokenError(locals) ?? notFound();
	return access === 'allowed' ? serveUpload(file, 'private', request) : notFound();
}
