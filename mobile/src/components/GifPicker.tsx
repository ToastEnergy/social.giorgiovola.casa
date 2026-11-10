import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import type { Gif, GifConfig } from '@/lib/types';
import { ErrorBanner, Input, Loading, Txt } from './ui';

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
						onChangeText={setQuery}
						placeholder="Search KLIPY"
						autoCorrect={false}
						style={{ flex: 1 }}
					/>
					<Pressable accessibilityLabel="Close GIFs" onPress={onClose} hitSlop={10}>
						<X size={24} color={colors.foreground} />
					</Pressable>
				</View>
				{error ? (
					<View style={{ padding: 20 }}>
						<ErrorBanner message={error} />
					</View>
				) : null}
				<FlatList
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
						return (
							<Pressable
								accessibilityLabel={item.title || 'GIF'}
								style={{ flex: 1, margin: 5 }}
								onPress={() => {
									const gif = toGif(item);
									if (gif) onPick(gif, () => shareGif(config, gif.slug, query));
									onClose();
								}}
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
						);
					}}
				/>
			</View>
		</Modal>
	);
}
