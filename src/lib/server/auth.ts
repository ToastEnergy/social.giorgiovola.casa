import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, exists, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PUBLIC_URL } from '$app/env/public';
import { db, identity_members, sessions, users } from './db/index.js';
import { authenticateBot } from './bots.js';
import { apiError } from './api.js';
import { membersOnly } from './membersOnly.js';
import {
	SESSION_DAYS,
	TOKEN_DAYS,
	USER_TOKEN_RE,
	cookieKeys as keysOfCookie,
	cookieTokens,
	hashToken,
	setSessionCookies
} from './session.js';

/**
 * The one way a request is authenticated, whatever the client: the web UI (session cookie), a
 * third-party client (`Authorization: Bearer sgu_…`, a human token) or a bot (`Bearer sgc_…`).
 * Every route reads the result from `locals`, which has the same shape for all of them.
 */

const publicOrigin = PUBLIC_URL ? new URL(PUBLIC_URL).origin : null;

function anonymous(locals: App.Locals) {
	locals.user = null;
	locals.accountId = null;
	locals.sessions = [];
	locals.role = 'user';
	locals.muted = false;
	locals.muteReason = null;
	locals.auth = 'anonymous';
	locals.sessionKey = null;
	locals.invalidToken = false;
}

/**
 * During SSR, page loads call /api/v1 through `event.fetch`, which runs each endpoint in-process
 * with the page's cookies. Those subrequests reuse the page request's resolved session instead
 * of looking it up (and touching last_used_at) again: `cookieKeys` remembers which cookies a
 * request was authenticated from, and `shareAuth` makes it visible to the requests it spawns.
 */
const cookieKeys = new WeakMap<App.Locals, string>();
const parentAuth = new AsyncLocalStorage<{ key: string; locals: App.Locals }>();

/** Runs `fn` (the rest of the request) so its in-process subrequests can reuse its session. */
export function shareAuth<T>(locals: App.Locals, fn: () => T): T {
	const key = cookieKeys.get(locals);
	return key === undefined ? fn() : parentAuth.run({ key, locals }, fn);
}

/** Writes at most one last_used_at (and expiry) every few minutes per session. */
const TOUCH_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Browser sessions and login tokens expire after that many days without use, not after that
 * many days since signing in: each use pushes the expiry back. Personal access tokens keep the
 * expiry chosen for them.
 */
const slidingDays = (kind: string) =>
	kind === 'cookie' ? SESSION_DAYS : kind === 'token' ? TOKEN_DAYS : null;

/**
 * Looks up session rows by key (`sessions.token`) with the account, the identity in use and the
 * moderation state that applies, in the order of `keys`. Expired, banned and wrong-kind rows are
 * left out.
 */
async function loadSessions(keys: string[], kind: 'cookie' | 'api') {
	// role, ban and mute belong to the account, whichever of its profiles is in use
	const account = alias(users, 'account');
	// the identity the session is acting as, if the account owns it or it is shared with it
	const profile = alias(users, 'profile');
	const owner = alias(users, 'owner');
	const rows = await db
		.select({
			token: sessions.token,
			kind: sessions.kind,
			expires_at: sessions.expires_at,
			last_used_at: sessions.last_used_at,
			account: {
				id: account.id,
				email: account.email,
				name: account.name,
				username: account.username,
				avatar: account.avatar,
				created_at: account.created_at,
				role: account.role,
				muted_at: account.muted_at,
				mute_reason: account.mute_reason
			},
			profile: {
				id: profile.id,
				email: profile.email,
				name: profile.name,
				username: profile.username,
				avatar: profile.avatar,
				created_at: profile.created_at,
				owner_id: profile.owner_id
			},
			owner_banned_at: owner.banned_at,
			owner_muted_at: owner.muted_at,
			owner_mute_reason: owner.mute_reason
		})
		.from(sessions)
		.innerJoin(account, eq(account.id, sessions.user_id))
		.leftJoin(
			profile,
			and(
				eq(profile.id, sessions.acting_id),
				or(
					eq(profile.owner_id, sessions.user_id),
					exists(
						db
							.select({ one: sql`1` })
							.from(identity_members)
							.where(
								and(
									eq(identity_members.identity_id, profile.id),
									eq(identity_members.account_id, sessions.user_id)
								)
							)
					)
				)
			)
		)
		.leftJoin(owner, eq(owner.id, profile.owner_id))
		.where(
			and(
				inArray(sessions.token, keys),
				kind === 'cookie' ? eq(sessions.kind, 'cookie') : ne(sessions.kind, 'cookie'),
				// banned accounts are signed out when banned, this covers any session left behind
				isNull(account.banned_at),
				sql`(${sessions.expires_at} IS NULL OR ${sessions.expires_at} > NOW())`
			)
		);
	return keys
		.map((key) => rows.find((r) => r.token === key))
		.filter((r): r is (typeof rows)[number] => !!r);
}

type SessionRow = Awaited<ReturnType<typeof loadSessions>>[number];

/** Fills locals from the active session row. */
function fromSession(locals: App.Locals, row: SessionRow) {
	const { account: a, profile: p, ...o } = row;
	// an identity that is no longer shared with the account, or whose owner was banned,
	// falls back to the account itself
	const acting = p && !o.owner_banned_at ? p : null;
	// a shared identity is muted when its owner is, so sharing it can't dodge a mute
	const mute = a.muted_at
		? a.mute_reason
		: acting && o.owner_muted_at
		? o.owner_mute_reason
		: undefined;
	locals.accountId = a.id;
	locals.role = a.role;
	locals.muted = mute !== undefined;
	locals.muteReason = mute ?? null;
	locals.sessionKey = row.token;
	locals.user = acting ?? {
		id: a.id,
		email: a.email,
		name: a.name,
		username: a.username,
		avatar: a.avatar,
		created_at: a.created_at,
		owner_id: null
	};
}

/**
 * Records a use of a session row: `last_used_at` when it is the one in use (`used`), and a
 * pushed back expiry for the kinds that slide, each at most every TOUCH_MS. Returns whether the
 * expiry moved, so the cookies can be renewed with it.
 */
function touch(row: SessionRow, used: boolean) {
	const now = Date.now();
	const days = slidingDays(row.kind);
	const renew =
		days !== null &&
		row.expires_at !== null &&
		row.expires_at.getTime() < now + days * DAY_MS - TOUCH_MS;
	const seen = used && (!row.last_used_at || now - row.last_used_at.getTime() > TOUCH_MS);
	if (!renew && !seen) return false;
	void db
		.update(sessions)
		.set({
			...(seen ? { last_used_at: sql`NOW()` } : {}),
			...(renew ? { expires_at: sql`NOW() + make_interval(days => ${days})` } : {})
		})
		.where(eq(sessions.token, row.token))
		.catch((e) => console.error('auth: touching the session failed', e));
	return renew;
}

const unauthorized = (message: string) => apiError(401, message, { 'WWW-Authenticate': 'Bearer' });

/** Whether the request comes from a page of another site (browsers send Origin cross-origin). */
function foreignOrigin(event: RequestEvent) {
	const origin = event.request.headers.get('origin');
	return origin !== null && origin !== event.url.origin && origin !== publicOrigin;
}

/**
 * Where bearer tokens are read: the API, and uploads, since a message image is only served to
 * whoever can read its conversation. On a members-only instance also avatars and link preview
 * images, which apps (no cookies) can only load with their token there. The bot API
 * (`/api/bot/*`) authenticates on its own.
 */
const isUpload = (pathname: string) =>
	pathname.startsWith('/uploads/') ||
	pathname.startsWith('/dm-uploads/') ||
	(membersOnly() &&
		(pathname.startsWith('/avatar/') ||
			pathname.startsWith('/avatars/') ||
			pathname.startsWith('/previews/')));
const readsBearer = (pathname: string) =>
	(pathname.startsWith('/api/') && !pathname.startsWith('/api/bot/')) || isUpload(pathname);

/**
 * The error an upload request's token got (see authenticate), kept until the route knows whether
 * the file is a message image. Not in locals, which in-process subrequests copy.
 */
const tokenErrors = new WeakMap<App.Locals, Response>();

/**
 * The answer for a request whose bearer token was refused, the one the API gives (401, or 403 /
 * 429 for a banned or rate limited bot), never cached. Null when no token was refused.
 */
export function tokenError(locals: App.Locals): Response | null {
	const response = tokenErrors.get(locals);
	if (!response) return null;
	tokenErrors.delete(locals);
	response.headers.set('Cache-Control', 'private, no-store');
	return response;
}

/** Fills locals from a bearer token, or returns the error response for an invalid one. */
async function fromToken(locals: App.Locals, request: Request, header: string) {
	const match = /^(?:Bearer|Bot) (\S+)$/i.exec(header);
	const token = match?.[1] ?? '';
	if (token.startsWith('sgc_')) {
		const bot = await authenticateBot(request);
		if (bot instanceof Response) return bot;
		// bots act as their own profile; they are no account, so account endpoints refuse them
		locals.user = bot.user;
		locals.muted = bot.muted;
		locals.muteReason = bot.muteReason;
		locals.auth = 'bot';
		return null;
	}
	if (!USER_TOKEN_RE.test(token)) return unauthorized('Missing or invalid token');
	const [row] = await loadSessions([hashToken(token)], 'api');
	if (!row) return unauthorized('Invalid or expired token, sign in again');
	fromSession(locals, row);
	touch(row, true);
	locals.auth = 'token';
	return null;
}

/**
 * Authenticates the request and fills `event.locals`. Returns an error response when a bearer
 * token was sent but is invalid (a wrong token never silently falls back to anonymous).
 *
 * Bearer tokens are only read where readsBearer says. On uploads (and the other images read with
 * a token) an invalid token doesn't stop the request: post images are public and always loaded
 * whatever the header said, so the request goes on anonymous with `locals.invalidToken` set, and
 * only a message image answers the error (tokenError).
 */
export async function authenticate(event: RequestEvent): Promise<Response | null> {
	const { locals, request, url, cookies } = event;
	anonymous(locals);

	const header = request.headers.get('authorization');
	// only our schemes count: another one (Basic auth from a proxy) is not ours to refuse
	const isOurs = header !== null && /^(?:Bearer|Bot)(?: |$)/i.test(header);
	if (isOurs && readsBearer(url.pathname)) {
		const error = await fromToken(locals, request, header);
		if (error && isUpload(url.pathname)) {
			// a sent token is still the only credential: no fallback to the cookies
			anonymous(locals);
			locals.invalidToken = true;
			tokenErrors.set(locals, error);
			return null;
		}
		return error;
	}

	// a page of another site can make the browser send our cookies along (same-site subdomains,
	// or a JSON request SvelteKit's form check doesn't cover): those requests are anonymous
	if (foreignOrigin(event)) return null;

	const tokens = cookieTokens(cookies);
	if (tokens.length === 0) return null;
	const key = tokens.join(' ');
	const parent = parentAuth.getStore();
	// a subrequest of a page with the same cookies: the page already resolved them
	if (parent?.key === key) {
		Object.assign(locals, parent.locals, { sessions: [...parent.locals.sessions] });
		cookieKeys.set(locals, key);
		return null;
	}
	const rows = await loadSessions(tokens.flatMap(keysOfCookie), 'cookie');
	// each cookie with the row it opens, in the cookie's order
	const valid = tokens.flatMap((token) => {
		const keys = keysOfCookie(token);
		const row = rows.find((r) => keys.includes(r.token));
		return row ? [{ token, row }] : [];
	});
	cookieKeys.set(locals, key);

	// every account signed in on the browser stays signed in while the browser is used, though
	// only the active one counts as used in the session list
	let renewed = false;
	valid.forEach((v, i) => {
		if (touch(v.row, i === 0)) renewed = true;
	});

	// the active session expired (or a token went stale): fall back to the next signed in account.
	// a renewed expiry is written to the cookies too, which would otherwise run out at the old one
	if (valid.length !== tokens.length || renewed)
		setSessionCookies(
			cookies,
			valid.map((v) => v.token)
		);

	locals.sessions = valid.map((v) => ({
		token: v.token,
		key: v.row.token,
		accountId: v.row.account.id
	}));
	if (valid.length > 0) {
		fromSession(locals, valid[0].row);
		locals.auth = 'cookie';
	}
	return null;
}
