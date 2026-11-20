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
