import { error, redirect } from '@sveltejs/kit';
import { ACT_AS_HEADER, API, FEATURES_HEADER } from './api.js';
import { contextProfile } from './inbox.js';
import type { SwitcherAccount } from './types.js';

/**
 * Page loads read their data from /api/v1 through SvelteKit's `fetch`, which forwards the
 * session cookie and runs the endpoint in-process during SSR. No load touches the database.
 */

type Fetch = typeof fetch;

type Options = {
	/** a 401 sends the visitor to the login page (the default) instead of showing an error */
	login?: boolean;
	/** a 404 resolves with null instead of showing the error page */
	optional?: boolean;
	/** answer as this other profile of the account (X-Act-As), see `loadAs` */
	as?: string | null;
};

export async function apiGet<T>(
	fetch: Fetch,
	path: string,
	options?: Options & { optional?: false }
): Promise<T>;
export async function apiGet<T>(
	fetch: Fetch,
	path: string,
	options: Options & { optional: true }
): Promise<T | null>;
export async function apiGet<T>(
	fetch: Fetch,
	path: string,
	{ login = true, optional = false, as = null }: Options = {}
): Promise<T | null> {
	const res = await fetch(`${API}${path}`, {
		headers: as ? { ...FEATURES_HEADER, [ACT_AS_HEADER]: as } : FEATURES_HEADER
	});
	if (res.ok) return res.json();
	if (res.status === 401 && login) redirect(303, '/login');
	if (res.status === 404 && optional) return null;
	const body = await res.json().catch(() => null);
	error(res.status, body?.error ?? 'Something went wrong');
}

/**
 * The profile a page load answers as: `?as=` when it names another profile of the account (the
 * layout's list, so a stale link is ignored), else null. Only waits for the layout when there is
 * an `as` to check.
 */
export async function loadAs(
	url: URL,
	parent: () => Promise<{ accounts: SwitcherAccount[] }>
): Promise<string | null> {
	if (!url.searchParams.has('as')) return null;
	return contextProfile(url, (await parent()).accounts)?.username ?? null;
}
