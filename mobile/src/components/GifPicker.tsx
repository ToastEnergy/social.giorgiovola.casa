import { Image } from 'expo-image';
import { Star, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorMessage } from '@/lib/api';
import { plainGif, useGifFavorites } from '@/lib/gifFavorites';
import { colors } from '@/lib/theme';
import type { Gif, GifConfig } from '@/lib/types';
import { ErrorBanner, Input, Loading, TabRow, Txt } from './ui';

// searching KLIPY straight from the device, as its terms want (see "GIFs" in /api.txt)

type KlipyFile = { url: string; width: number; height: number };
type KlipyFormats = Partial<Record<'webp' | 'jpg' | 'mp4', KlipyFile>>;
type KlipyItem = {
	id: number;
	slug: string;
	title?: string;
	type: string;
	file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', KlipyFormats>>;
};

const base = (config: GifConfig) =>
	`https://api.klipy.com/api/v1/${encodeURIComponent(config.app_key)}/gifs`;

async function fetchGifs(config: GifConfig, query: string, page: number, signal: AbortSignal) {
	const q = query.trim();
	const params = [
		`page=${page}`,
		'per_page=24',
		`content_filter=${encodeURIComponent(config.content_filter)}`,
		'format_filter=webp,jpg,mp4',
		q ? `q=${encodeURIComponent(q)}` : ''
	]
		.filter(Boolean)
		.join('&');
	const res = await fetch(`${base(config)}/${q ? 'search' : 'trending'}?${params}`, { signal });
	if (res.status === 429) throw new Error('Too many GIF searches, try again later.');
	const body = res.ok ? await res.json().catch(() => null) : null;
	if (!body?.result || !Array.isArray(body.data?.data)) throw new Error('Could not load GIFs.');
	return { items: body.data.data as KlipyItem[], hasNext: !!body.data.has_next };
}

const thumbnailOf = (item: KlipyItem) =>
	item.file?.sm?.webp ?? item.file?.xs?.webp ?? item.file?.md?.webp ?? item.file?.sm?.jpg ?? null;

/** what a post or message stores: the medium MP4 and its still frame, KLIPY's URLs as they are */
function toGif(item: KlipyItem): Gif | null {
	if (item.type !== 'gif' || !item.slug) return null;
	const f = item.file;
	const video = f?.md?.mp4 ?? f?.hd?.mp4 ?? f?.sm?.mp4;
	const poster = f?.md?.jpg ?? f?.hd?.jpg ?? f?.sm?.jpg;
	if (!video || !poster) return null;
	return {
		provider: 'klipy',
		slug: item.slug,
		title: item.title ?? '',
		video: video.url,
		poster: poster.url,
		width: Math.round(video.width),
		height: Math.round(video.height)
	};
}

/** tells KLIPY the GIF was sent, with the search that found it; never fails */
function shareGif(config: GifConfig, slug: string, query: string) {
	fetch(`${base(config)}/share/${encodeURIComponent(slug)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(query.trim() ? { q: query.trim() } : {})
	}).catch(() => {});
}

export function GifPicker({
	config,
	visible,
	onClose,
	onPick
}: {
	config: GifConfig;
	visible: boolean;
	onClose: () => void;
	/** `sent` reports the GIF to KLIPY: call it once the post or message went out */
	onPick: (gif: Gif, sent: () => void) => void;
}) {
	const insets = useSafeAreaInsets();
	const [query, setQuery] = useState('');
	const [items, setItems] = useState<KlipyItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const page = useRef({ next: 1, hasNext: false, busy: false });
	/** KLIPY's results (trending or a search), or the saved GIFs: never mixed (KLIPY's terms) */
	const [tab, setTab] = useState<'klipy' | 'favorites'>('klipy');
	const favorites = useGifFavorites(visible);
	/** a star that couldn't be saved */
	const [favoriteError, setFavoriteError] = useState<string | null>(null);
	/** favorites whose poster no longer loads (KLIPY removed the GIF) */
	const [gone, setGone] = useState<Set<string>>(new Set());

	function pick(gif: Gif, found: string) {
		onPick(gif, () => shareGif(config, gif.slug, found));
		onClose();
	}

	async function toggleFavorite(gif: Gif) {
		setFavoriteError(null);
		try {
			await favorites.toggle(gif);
		} catch (e) {
			setFavoriteError(errorMessage(e));
		}
	}

	/** the corner of a tile: the hit area is bigger than the star, for fingers */
	function star(gif: Gif) {
		const saved = favorites.has(gif.slug);
		return (
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={saved ? 'Remove from favorites' : 'Add to favorites'}
				accessibilityState={{ selected: saved }}
				onPress={() => toggleFavorite(gif)}
				style={({ pressed }) => ({
					position: 'absolute',
					top: 0,
					right: 0,
					padding: 5,
					opacity: pressed ? 0.6 : 1
				})}
			>
				<View
					style={{
						width: 32,
						height: 32,
						borderRadius: 16,
						alignItems: 'center',
						justifyContent: 'center',
						backgroundColor: 'rgba(12, 11, 11, 0.8)'
					}}
				>
					<Star
						size={17}
						color={saved ? colors.accent : colors.foreground}
						fill={saved ? colors.accent : 'transparent'}
					/>
				</View>
			</Pressable>
		);
	}

	useEffect(() => {
		if (!visible) return;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			setLoading(true);
			try {
				const res = await fetchGifs(config, query, 1, controller.signal);
				setItems(res.items);
				page.current = { next: 2, hasNext: res.hasNext, busy: false };
				setError(null);
			} catch (e) {
				if ((e as Error).name !== 'AbortError') setError((e as Error).message);
			} finally {
				setLoading(false);
			}
		}, 300);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [config, query, visible]);

	async function more() {
		const state = page.current;
		if (!state.hasNext || state.busy) return;
		state.busy = true;
		try {
			const res = await fetchGifs(config, query, state.next, new AbortController().signal);
			// in the order received, as KLIPY asks
			setItems((now) => [...now, ...res.items]);
			page.current = { next: state.next + 1, hasNext: res.hasNext, busy: false };
		} catch {
			state.busy = false;
		}
	}

	return (
		<Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
			<View
				style={{
					flex: 1,
					backgroundColor: colors.background,
					paddingTop: insets.top + 10,
					paddingBottom: insets.bottom
				}}
			>
				<View
					style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20 }}
				>
					<Input
						value={query}
						onChangeText={(next) => {
							setQuery(next);
							// a search is always KLIPY's
							setTab('klipy');
						}}
						placeholder="Search KLIPY"
						autoCorrect={false}
						style={{ flex: 1 }}
					/>
					<Pressable accessibilityLabel="Close GIFs" onPress={onClose} hitSlop={10}>
						<X size={24} color={colors.foreground} />
					</Pressable>
				</View>
				<View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
					<TabRow
						tabs={[
							{ value: 'klipy', label: query.trim() ? 'Results' : 'Trending' },
							{
								value: 'favorites',
								label: favorites.loaded ? `Favorites ${favorites.items.length}` : 'Favorites'
							}
						]}
						value={tab}
						onChange={setTab}
					/>
				</View>
				{favoriteError ? (
					<View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
						<ErrorBanner message={favoriteError} />
					</View>
				) : null}
				{tab === 'favorites' ? (
					<FlatList
						key="favorites"
						data={favorites.items}
						keyExtractor={(gif) => gif.slug}
						numColumns={2}
						contentContainerStyle={{ padding: 15 }}
						ListEmptyComponent={
							favorites.error && !favorites.loaded ? (
								<Txt muted style={{ textAlign: 'center', padding: 40 }}>
									{favorites.error}
								</Txt>
							) : !favorites.loaded ? (
								<Loading />
							) : (
								<Txt muted style={{ textAlign: 'center', padding: 40 }}>
									No favorites yet. Tap the star on a GIF to save it here.
								</Txt>
							)
						}
						renderItem={({ item: gif }) => (
							<View style={{ flex: 1, margin: 5, maxWidth: '50%' }}>
								{gone.has(gif.slug) ? (
									<View
										style={{
											aspectRatio: 1,
											borderRadius: 5,
											backgroundColor: '#111',
											alignItems: 'center',
											justifyContent: 'center',
											padding: 5
										}}
									>
										<Txt muted size={13} style={{ textAlign: 'center' }}>
											No longer available
										</Txt>
									</View>
								) : (
									<Pressable
										accessibilityLabel={gif.title || 'GIF'}
										onPress={() => pick(plainGif(gif), '')}
									>
										<Image
											source={{ uri: gif.poster }}
											onError={() => setGone((now) => new Set(now).add(gif.slug))}
											style={{
												aspectRatio: gif.width / gif.height || 1,
												borderRadius: 5,
												backgroundColor: '#111'
											}}
										/>
									</Pressable>
								)}
								{star(gif)}
							</View>
						)}
					/>
				) : (
					<>
						{error ? (
							<View style={{ padding: 20 }}>
								<ErrorBanner message={error} />
							</View>
						) : null}
						<FlatList
							key="klipy"
							data={items.filter((item) => toGif(item) && thumbnailOf(item))}
							keyExtractor={(item, index) => `${item.slug}:${index}`}
							numColumns={2}
							onEndReached={more}
							contentContainerStyle={{ padding: 15 }}
							ListEmptyComponent={
								loading ? (
									<Loading />
								) : (
									<Txt muted style={{ textAlign: 'center', padding: 40 }}>
										No GIFs found.
									</Txt>
								)
							}
							renderItem={({ item }) => {
								const thumbnail = thumbnailOf(item)!;
								const gif = toGif(item)!;
								return (
									<View style={{ flex: 1, margin: 5, maxWidth: '50%' }}>
										<Pressable
											accessibilityLabel={item.title || 'GIF'}
											onPress={() => pick(gif, query)}
										>
											<Image
												source={{ uri: thumbnail.url }}
												style={{
													aspectRatio: thumbnail.width / thumbnail.height || 1,
													borderRadius: 5,
													backgroundColor: '#111'
												}}
											/>
										</Pressable>
										{favorites.loaded ? star(gif) : null}
									</View>
								);
							}}
						/>
					</>
				)}
			</View>
		</Modal>
	);
}
