import type { Cookies } from '@sveltejs/kit';
import type { SwitcherAccount, SwitcherProfile } from './types.js';

/** `all`: the notifications of every profile of the account; `own`: only the profile in use. */
export type InboxScope = 'all' | 'own';

/**
 * Whether the notifications page and the badge cover all the account's profiles, remembered in a
 * cookie (a UI preference, httpOnly: server only, the root layout's load). Choosing one in the
 * url (`?inbox=`, from the settings) remembers it. Everyone starts on `all`.
 */
export function rememberedInbox(url: URL, cookies: Cookies): InboxScope {
	const param = url.searchParams.get('inbox');
	if (param === 'all' || param === 'own') {
		if (cookies.get('inbox') !== param)
			cookies.set('inbox', param, { path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: true });
		return param;
	}
	return cookies.get('inbox') === 'own' ? 'own' : 'all';
}

/** The profiles of the account in use (its own, its identities and the ones shared with it). */
export function activeProfiles(accounts: SwitcherAccount[]): SwitcherProfile[] {
	const account = accounts.find((a) => a.active || a.identities.some((i) => i.active));
	return account ? [account, ...account.identities] : [];
}

/**
 * The profile a page is shown as (`?as=username`), when it is one of the account's other
 * profiles: its own, an identity or one shared with it, and not the profile in use. Anything
 * else is ignored, so a stale or edited link shows the page as the profile in use.
 */
export function contextProfile(
	url: { searchParams: { get(name: string): string | null } },
	accounts: SwitcherAccount[]
): SwitcherProfile | null {
	const as = url.searchParams.get('as')?.replace(/^@/, '').toLowerCase();
	if (!as) return null;
	return activeProfiles(accounts).find((p) => !p.active && p.username === as) ?? null;
}

/** `href` (a same-site path) in the context of the profile `as`; unchanged without one. */
export function withAs(href: string, as: string | null | undefined): string {
	if (!as || !href.startsWith('/') || href.startsWith('//')) return href;
	const hash = href.indexOf('#');
	const [path, fragment] = hash < 0 ? [href, ''] : [href.slice(0, hash), href.slice(hash)];
	if (/[?&]as=/.test(path)) return href;
	return `${path}${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(as)}${fragment}`;
}
