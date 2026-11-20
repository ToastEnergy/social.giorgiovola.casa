import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, getPage } from './api';
import { useBus } from './bus';
import { useSession } from './session';

/**
 * A paginated list ({ items, next_cursor }) of `path`, reloaded when the path or the profile in
 * use changes and when the stream reconnects. `key` tells repeated items apart across pages.
 */
export function usePaged<T>(
	path: string | null,
	key: (item: T) => string | number,
	limit?: number,
	/** the screen's context profile: the list is read as it (X-Act-As) */
	as?: string | null
) {
	const { profileKey } = useSession();
	const [items, setItems] = useState<T[]>([]);
	const [loading, setLoading] = useState(!!path);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const next = useRef<string | null>(null);
	const busy = useRef(false);
	// a load that finishes after the list moved on is dropped
	const run = useRef(0);
	const keyRef = useRef(key);
	keyRef.current = key;

	const load = useCallback(
		async (quiet = false) => {
			if (!path) return;
			const id = ++run.current;
			if (!quiet) setLoading(true);
			try {
				const page = await getPage<T>(path, null, limit, as);
				if (id !== run.current) return;
				next.current = page.next_cursor;
				setItems(page.items);
				setError(null);
			} catch (e) {
				if (id === run.current) setError(errorMessage(e));
			} finally {
				if (id === run.current) {
					setLoading(false);
					setRefreshing(false);
				}
			}
		},
		[path, limit, as]
	);

	// a new list (path or profile) starts out loading in the same render: an error or items left
	// from the one before would otherwise show for a frame before the effect below runs
	const listKey = path && profileKey ? `${profileKey} ${as ?? ''} ${path}` : null;
	const [shownKey, setShownKey] = useState(listKey);
	if (shownKey !== listKey) {
		setShownKey(listKey);
		setItems([]);
		setError(null);
		setLoading(!!path);
	}

	useEffect(() => {
		next.current = null;
		// screens mount under the start-up overlay before the stored session is read: without a
		// profile yet the request would go out without a token and answer 401
		if (!listKey) return;
		load();
	}, [load, listKey]);

	useBus('stream_open', () => load(true));

	const loadMore = useCallback(async () => {
		if (!path || !next.current || busy.current) return;
		busy.current = true;
		const id = run.current;
		try {
			const page = await getPage<T>(path, next.current, limit, as);
			if (id !== run.current) return;
			next.current = page.next_cursor;
			setItems((now) => {
				const seen = new Set(now.map(keyRef.current));
				return [...now, ...page.items.filter((item) => !seen.has(keyRef.current(item)))];
			});
		} catch {
			// scrolling again retries
		} finally {
			busy.current = false;
		}
	}, [path, limit, as]);

	const refresh = useCallback(() => {
		setRefreshing(true);
		load(true);
	}, [load]);

	return { items, setItems, loading, refreshing, error, refresh, loadMore, reload: load };
}
