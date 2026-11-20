import { page } from '$app/state';
import { contextProfile, activeProfiles, withAs as addAs } from './inbox.js';
import type { SwitcherAccount, SwitcherProfile } from './types.js';

/**
 * The profile the open page is shown as (`?as=username`, see contextProfile), null when it is
 * the profile in use. Reactive: reads the page's url, so call it in a template or a derived.
 */
export function actingAs(): SwitcherProfile | null {
	return contextProfile(page.url, (page.data.accounts ?? []) as SwitcherAccount[]);
}

/** `href` with the context profile carried on, so a link from a page in context stays in it. */
export const withAs = (href: string) => addAs(href, actingAs()?.username);

/** The profiles of the account in use: its own, its identities and the ones shared with it. */
export const myProfiles = (): SwitcherProfile[] =>
	activeProfiles((page.data.accounts ?? []) as SwitcherAccount[]);

/** The page's url without the context profile (`×` on the bar, a switch of the profile in use). */
export function withoutAs(url: { href: string }): string {
	const next = new URL(url.href);
	next.searchParams.delete('as');
	return next.pathname + next.search + next.hash;
}
