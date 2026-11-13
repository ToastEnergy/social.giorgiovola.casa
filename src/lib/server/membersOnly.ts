import type { RequestEvent } from '@sveltejs/kit';
import { MEMBERS_ONLY } from '$app/env/private';
import { apiError } from './api.js';
import { isPublicPage } from '../membersOnly.js';

/**
 * MEMBERS_ONLY: nothing is readable without signing in (a session cookie, a `sgu_` token or a
 * bot's `sgc_` token). Deny by default: only the paths below stay open to signed-out visitors,
 * so a route added later is gated without having to remember it.
 */
export const membersOnly = () => MEMBERS_ONLY;

// what the login and registration pages need, plus /instance so clients can learn that the
// instance is members only (it hides the message of the day from signed-out visitors)
const PUBLIC_API = new Set([
	'/api/v1/instance',
	'/api/v1/auth/login',
	'/api/v1/auth/register',
	'/api/v1/auth/passkeys/options',
	'/api/v1/auth/passkeys/login',
	'/api/v1/auth/logout'
]);

function isPublic(event: RequestEvent) {
	const path = event.url.pathname.replace(/\/$/, '') || '/';
	// the bot API authenticates every request itself (a bot token), so it is never anonymous
	if (path.startsWith('/api/bot/')) return true;
	// the sign up page checks the invite code it was opened with (who invited, nothing else)
	if (/^\/api\/v1\/invites\/[^/]+$/.test(path)) return true;
	if (path.startsWith('/api/')) return PUBLIC_API.has(path);
	// the API reference, which holds no user content
	if (path === '/api.txt') return true;
	return isPublicPage(event.route.id);
}

const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * The answer for a signed-out request on a members-only instance, or null to let it through.
 * Pages go to the login page; SvelteKit's own data requests (client-side navigation) are let
 * through for the root layout to redirect (its API calls are refused here anyway).
 */
export function gate(event: RequestEvent): Response | null {
	if (!MEMBERS_ONLY || event.locals.user || isPublic(event)) return null;
	if (event.url.pathname.startsWith('/api/'))
		return apiError(401, 'This instance is members only: sign in first', {
			'WWW-Authenticate': 'Bearer',
			...noStore
		});
	if (event.isDataRequest) return null;
	if (event.request.method === 'GET' && event.request.headers.get('accept')?.includes('text/html'))
		return new Response(null, { status: 303, headers: { Location: '/login', ...noStore } });
	return new Response('Sign in first', { status: 401, headers: noStore });
}

/**
 * Images and cards that are readable once signed in must not land in a shared cache (a CDN in
 * front of the instance), which would hand them to anyone: their `public` caching becomes
 * `private` on a members-only instance.
 */
export function keepPrivate(event: RequestEvent, response: Response) {
	if (!MEMBERS_ONLY || isPublic(event)) return;
	const cache = response.headers.get('cache-control');
	if (!cache?.includes('public')) return;
	try {
		response.headers.set('Cache-Control', cache.replace('public', 'private'));
	} catch {
		// immutable headers (Response.redirect) carry no public caching
	}
}
