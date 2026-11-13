import { allPages, api, messageOf, withCursor, type Page } from '#lib/api.js';
import type { Gif } from '#lib/types.js';

/**
 * The favorite GIFs of the profile in use (GET /api/v1/me/gifs/favorites), shared by every GIF
 * picker on the page. Loaded the first time a picker opens and kept until the page reloads
 * (switching profile reloads it); the stars change it optimistically.
 */
class GifFavorites {
	/** newest first */
	items: Gif[] = $state([]);
	loaded = $state(false);
	loading = $state(false);
	error: string | null = $state(null);
	readonly #slugs = $derived(new Set(this.items.map((g) => g.slug)));
	#request: Promise<void> | null = null;

	has(slug: string) {
		return this.#slugs.has(slug);
	}

	/** Loads the list once; again only after a failure. */
	load(): Promise<void> {
		if (this.loaded) return Promise.resolve();
		this.#request ??= (async () => {
			this.loading = true;
			this.error = null;
			try {
				const path = 'me/gifs/favorites?limit=100';
				this.items = await allPages(
					(cursor) => api<Page<Gif>>(cursor ? withCursor(path, cursor) : path),
					// the server keeps at most 200
					3
				);
				this.loaded = true;
			} catch (e) {
				this.error = messageOf(e, 'Could not load your favorite GIFs.');
			} finally {
				this.loading = false;
				this.#request = null;
			}
		})();
		return this.#request;
	}

	/** Saves or removes `gif`; throws the API's message when that fails (and undoes it). */
	async toggle(gif: Gif) {
		const before = this.items;
		if (this.has(gif.slug)) {
			this.items = before.filter((g) => g.slug !== gif.slug);
			try {
				await api(`me/gifs/favorites/${encodeURIComponent(gif.slug)}`, { method: 'DELETE' });
			} catch (e) {
				// already gone is what was asked for
				if ((e as { status?: number }).status === 404) return;
				this.items = before;
				throw e;
			}
		} else {
			this.items = [gif, ...before];
			try {
				await api('me/gifs/favorites', { method: 'POST', json: { gif } });
			} catch (e) {
				this.items = before;
				throw e;
			}
		}
	}
}

export const gifFavorites = new GifFavorites();
