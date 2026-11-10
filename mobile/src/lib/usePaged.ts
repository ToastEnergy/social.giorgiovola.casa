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
	limit?: number
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
				const page = await getPage<T>(path, null, limit);
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
		[path, limit]
	);

	useEffect(() => {
		setItems([]);
		next.current = null;
		load();
	}, [load, profileKey]);

	useBus('stream_open', () => load(true));

	const loadMore = useCallback(async () => {
		if (!path || !next.current || busy.current) return;
		busy.current = true;
		const id = run.current;
		try {
			const page = await getPage<T>(path, next.current, limit);
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
	}, [path, limit]);

	const refresh = useCallback(() => {
		setRefreshing(true);
		load(true);
	}, [load]);

	return { items, setItems, loading, refreshing, error, refresh, loadMore, reload: load };
}
