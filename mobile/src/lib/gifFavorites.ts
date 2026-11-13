import { useEffect, useSyncExternalStore } from 'react';
import { api, ApiError, errorMessage, withQuery } from './api';
import { useSession } from './session';
import type { Gif, Page } from './types';

// the favorite GIFs of the profile in use (GET /api/v1/me/gifs/favorites), shared by every GIF
// picker. loaded the first time a picker opens for a profile, kept until the profile changes;
// the stars change it optimistically

type State = {
	/** the profile the list is for (the session's profileKey) */
	key: string;
	/** newest first */
	items: Gif[];
	loaded: boolean;
	error: string | null;
};

let state: State = { key: '', items: [], loaded: false, error: null };
let request: { key: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Loads the list of the profile `key` once; again only after a failure. */
function load(key: string) {
	if (state.key !== key) set({ key, items: [], loaded: false, error: null });
	if (state.loaded || request?.key === key) return;
	const promise = (async () => {
		try {
			const items: Gif[] = [];
			let cursor: string | null = null;
			// the server keeps at most 200
			for (let i = 0; i < 3; i++) {
				const page: Page<Gif> = await api<Page<Gif>>(
					withQuery('me/gifs/favorites', { limit: 100, cursor })
				);
				items.push(...page.items);
				cursor = page.next_cursor;
				if (!cursor) break;
			}
			if (state.key === key) set({ items, loaded: true, error: null });
		} catch (e) {
			if (state.key === key) set({ error: errorMessage(e) });
		} finally {
			if (request?.key === key) request = null;
		}
	})();
	request = { key, promise };
}

/** without the list's own fields (favorited_at): what a post, message or POST takes */
export const plainGif = ({ provider, slug, title, video, poster, width, height }: Gif): Gif => ({
	provider,
	slug,
	title,
	video,
	poster,
	width,
	height
});

/** Saves or removes `gif`; throws the API's error when that fails (and undoes it). */
async function toggle(gif: Gif) {
	const key = state.key;
	const before = state.items;
	const undo = () => {
		if (state.key === key) set({ items: before });
	};
	if (before.some((g) => g.slug === gif.slug)) {
		set({ items: before.filter((g) => g.slug !== gif.slug) });
		try {
			await api(`me/gifs/favorites/${encodeURIComponent(gif.slug)}`, { method: 'DELETE' });
		} catch (e) {
			// already gone is what was asked for
			if (e instanceof ApiError && e.status === 404) return;
			undo();
			throw e;
		}
	} else {
		set({ items: [gif, ...before] });
		try {
			await api('me/gifs/favorites', { method: 'POST', body: { gif: plainGif(gif) } });
		} catch (e) {
			undo();
			throw e;
		}
	}
}

/** The favorite GIFs of the profile in use, loaded while `active`. */
export function useGifFavorites(active: boolean) {
	const { profileKey } = useSession();
	const now = useSyncExternalStore(subscribe, () => state);
	useEffect(() => {
		if (active && profileKey) load(profileKey);
	}, [active, profileKey]);
	// another profile's list until the effect above resets it
	const current = now.key === profileKey ? now : { ...now, items: [], loaded: false, error: null };
	return {
		items: current.items,
		loaded: current.loaded,
		error: current.error,
		has: (slug: string) => current.items.some((g) => g.slug === slug),
		toggle
	};
}
