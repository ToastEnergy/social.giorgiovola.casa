import { goto } from '$app/navigation';
import { withoutAs } from './actingAs.svelte.js';
import { api } from './api.js';
import { dropDrafts, saveDrafts } from './composerDraft.js';
import { clearPageCache } from './pageCache.js';

/**
 * Switches the browser to another profile (an account signed in here, or an identity) without
 * leaving the page: every load runs again as the new profile, the root layout starts the page
 * over and reconnects the realtime stream and push when the profile in use changes. What's being
 * written in a post composer is saved first and put back by the composers that start again.
 *
 * Stays on the page being viewed (without its `?as=`, which belonged to the old profile's
 * context), or goes to `redirectTo` (a same-site path).
 */
export async function switchTo(username: string, redirectTo?: string) {
	const drafts = await saveDrafts(username);
	try {
		await api('auth/switch', { method: 'POST', json: { username } });
	} catch (e) {
		await dropDrafts(drafts);
		throw e;
	}
	// what the reading pages kept is the previous profile's
	clearPageCache();
	const target =
		redirectTo === undefined
			? withoutAs(new URL(location.href))
			: redirectTo.startsWith('/') && !redirectTo.startsWith('//')
			? redirectTo
			: '/';
	await goto(target, { refreshAll: true, replace: true, reset: false });
}

const PROFILES_KEY = 'recentProfiles';

/** the profile in use and the one before it in this browser, newest first */
function recentProfiles(): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? '[]');
		return Array.isArray(list) ? list.filter((u) => typeof u === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Notes the profile in use, so a double tap on the avatar can go back to the one before. Followed
 * on every page load rather than in switchTo: a login or another tab changes the profile too.
 */
export function rememberProfile(username: string) {
	const list = recentProfiles();
	if (list[0] === username) return;
	try {
		localStorage.setItem(
			PROFILES_KEY,
			JSON.stringify([username, ...list.filter((u) => u !== username)].slice(0, 2))
		);
	} catch {
		// storage blocked: the double tap falls back to the first other profile
	}
}

/** the profile used before the current one, if it can still be switched to from `available` */
export function previousProfile(available: string[]): string | undefined {
	return recentProfiles().find((u) => available.includes(u)) ?? available[0];
}
