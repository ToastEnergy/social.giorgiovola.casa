import { api } from './api.js';
import { dropDrafts, saveDrafts } from './composerDraft.js';

/**
 * Switches the browser to another profile (an account signed in here, or an identity), then
 * reloads: the realtime stream, push and every page belong to the profile in use. What's being
 * written in a post composer is saved first and put back after the reload.
 */
export async function switchTo(username: string, redirectTo = location.pathname) {
	const drafts = await saveDrafts(username);
	try {
		await api('auth/switch', { method: 'POST', json: { username } });
	} catch (e) {
		await dropDrafts(drafts);
		throw e;
	}
	// same-site paths only
	location.href = redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/';
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
