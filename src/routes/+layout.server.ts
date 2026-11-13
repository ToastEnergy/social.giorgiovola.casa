import type { LayoutServerLoad } from './$types';
import { apiGet } from '#lib/apiLoad.js';
import { userOf, type Me } from '#lib/me.js';
import type { SwitcherAccount } from '#lib/types.js';
import { readTimeCookies } from '#lib/time.svelte.js';
import type { GifConfig } from '#lib/klipy.js';
import { redirect } from '@sveltejs/kit';
import { isPublicPage } from '#lib/membersOnly.js';

export const load = (async ({ fetch, cookies, request, route }) => {
	// signed out is fine for /me and /auth/accounts: every page decides what that means for it
	const [me, accounts, instance] = await Promise.all([
		fetch('/api/v1/me').then((res) => (res.ok ? (res.json() as Promise<Me>) : null)),
		fetch('/api/v1/auth/accounts').then(async (res) =>
			res.ok ? ((await res.json()) as { items: SwitcherAccount[] }).items : []
		),
		apiGet<{ motd: string; gifs: GifConfig | null; members_only?: boolean }>(fetch, '/instance')
	]);
	// a members-only instance: signed-out visitors only see the login pages. The request hook
	// already redirects full page loads, this covers client-side navigation
	if (instance.members_only && !me && !isPublicPage(route.id)) redirect(303, '/login');
	return {
		user: me ? userOf(me) : null,
		role: me?.role ?? 'user',
		muted: me?.muted ?? false,
		muteReason: me?.mute_reason ?? null,
		// staff: the moderation item shows the reports waiting
		reportsCount: me?.open_reports ?? 0,
		notisCount: me?.unread.notifications ?? 0,
		// reactions to your messages make a chat unread too
		messagesCount: (me?.unread.messages ?? 0) + (me?.unread.reactions ?? 0),
		accounts,
		motd: instance.motd,
		// signed out on a members-only instance the realtime stream answers 401: don't open it
		membersOnly: instance.members_only ?? false,
		// KLIPY's settings for the GIF pickers, null when GIFs are off
		gifs: instance.gifs ?? null,
		// the reader's zone and locale (UI preference cookies), so dates render as in the browser
		time: readTimeCookies(cookies, request.headers.get('accept-language'))
	};
}) satisfies LayoutServerLoad;
