import { Image, type ImageSource } from 'expo-image';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { type ReactNode, useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { instanceImage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { Gif, ImageSize, LinkPreview, QuotedPost } from '@/lib/types';
import { viewImages } from './overlays';
import { openLink, RichText } from './RichText';
import { Avatar, Txt } from './ui';

/** A KLIPY GIF: a short muted looping video, loaded straight from KLIPY. */
export function GifMedia({ gif, maxHeight = 300 }: { gif: Gif; maxHeight?: number }) {
	const player = useVideoPlayer(gif.video, (p) => {
		p.loop = true;
		p.muted = true;
		p.play();
	});
	const ratio = gif.width / gif.height || 1;
	return (
		<View
			accessibilityLabel={gif.title || 'GIF'}
			// the native video view would swallow taps: a gif has nothing to tap, so they go to
			// what holds it (in a list, the post; in a chat, the message)
			pointerEvents="none"
			style={{
				aspectRatio: ratio,
				maxHeight,
				maxWidth: maxHeight * ratio,
				width: '100%',
				borderRadius: 5,
				overflow: 'hidden',
				backgroundColor: '#111'
			}}
		>
			<Image
				source={{ uri: gif.poster }}
				style={{ position: 'absolute', width: '100%', height: '100%' }}
			/>
			<VideoView
				player={player}
				nativeControls={false}
				contentFit="cover"
				style={{ width: '100%', height: '100%' }}
			/>
		</View>
	);
}

/** width / height of the images seen so far, so a list that remounts a row doesn't jump */
const ratios = new Map<string, number>();

/** The size of image `i`, when the API sent one that makes sense (older uploads have none). */
function sizeOf(sizes: ImageSize[] | null | undefined, i: number): ImageSize | null {
	const size = sizes?.[i];
	return size && size.width > 0 && size.height > 0 ? size : null;
}

/**
 * The images of a post or message: one at its own shape, or a grid of two columns, like the web
 * app. With `viewable` tapping opens the viewer; without it a tap goes to what holds them (in a
 * list, the post). `width` fixes the space they take (a chat bubble fits its content); without it
 * they fill their parent.
 */
export function ImageGrid({
	images,
	sizes,
	height = 220,
	width,
	viewable = true
}: {
	images: string[];
	/** the size of each image from the API, when it sent them */
	sizes?: ImageSize[] | null;
	/** the tallest a single image may be; several are square tiles */
	height?: number;
	width?: number;
	viewable?: boolean;
}) {
	if (!images.length) return null;
	// with the token: message images need it, and on a members-only instance all of them
	const sources: ImageSource[] = images.map(instanceImage);
	if (images.length === 1)
		return (
			<SingleImage
				url={images[0]}
				source={sources[0]}
				size={sizeOf(sizes, 0)}
				maxHeight={height}
				width={width}
				onPress={viewable ? () => viewImages(sources, 0) : undefined}
			/>
		);
	return (
		<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, width }}>
			{sources.map((source, index) => (
				<Tappable
					key={images[index]}
					onPress={viewable ? () => viewImages(sources, index) : undefined}
					style={{ flexBasis: '48%', flexGrow: 1, aspectRatio: 1 }}
				>
					<Image
						source={source}
						style={{ flex: 1, borderRadius: 5, backgroundColor: '#111' }}
						contentFit="cover"
						transition={100}
					/>
				</Tappable>
			))}
		</View>
	);
}

/** A button when it opens the viewer, else a plain view that leaves the tap to its parent. */
function Tappable({
	onPress,
	style,
	children
}: {
	onPress?: () => void;
	style: ViewStyle;
	children: ReactNode;
}) {
	if (!onPress) return <View style={style}>{children}</View>;
	return (
		<Pressable accessibilityLabel="Open image" onPress={onPress} style={style}>
			{children}
		</Pressable>
	);
}

/**
 * One image, uncropped, like the web app: as wide as it may be without being enlarged past its own
 * size, shrunk to stay under `maxHeight` when tall.
 */
function SingleImage({
	url,
	source,
	size,
	maxHeight,
	width,
	onPress
}: {
	url: string;
	source: ImageSource;
	size: ImageSize | null;
	maxHeight: number;
	width?: number;
	onPress?: () => void;
}) {
	// the API's size when it sent one, else what loading it told us; square until then
	const [loaded, setLoaded] = useState(() => ratios.get(url));
	const ratio = size ? size.width / size.height : loaded ?? 1;
	const widest = Math.min(maxHeight * ratio, size?.width ?? Infinity);
	const box: ViewStyle =
		width === undefined
			? { width: '100%', maxWidth: widest, aspectRatio: ratio }
			: (() => {
					const w = Math.min(width, widest);
					return { width: w, height: w / ratio };
			  })();
	return (
		<Tappable onPress={onPress} style={box}>
			<Image
				source={source}
				style={{ flex: 1, borderRadius: 5, backgroundColor: '#111' }}
				// contain: if the box guessed the shape wrong, the image still shows whole
				contentFit="contain"
				// measuring needs the image's own size: downscaled to the box, android reports the
				// decoded size, which follows the box, and resizing the box loads it again, so the
				// two chased each other (a flashing image in a box of the wrong shape)
				allowDownscaling={!!size}
				transition={100}
				onLoad={(e) => {
					// once per image: later loads (a resize, a recycled row) must not move it again
					if (size || ratios.has(url)) return;
					const next = e.source.width / e.source.height;
					if (!next || !isFinite(next)) return;
					ratios.set(url, next);
					setLoaded(next);
				}}
			/>
		</Tappable>
	);
}

/** A post shown inside another: the quoted one, or the first one linked in the text. */
export function QuoteCard({
	quote,
	viewable = true
}: {
	quote: QuotedPost | { deleted: true };
	/** tapping an image opens the viewer instead of the quoted post */
	viewable?: boolean;
}) {
	const frame = {
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 5,
		padding: 10,
		gap: 5
	} as const;
	if ('deleted' in quote)
		return (
			<View style={frame}>
				<Txt size={14} muted>
					This post was deleted.
				</Txt>
			</View>
		);
	return (
		<Pressable style={frame} onPress={() => router.push(`/post/${quote.id}`)}>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
				<Avatar user={quote.user} size={24} />
				<Txt bold size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
					{quote.user.name}
				</Txt>
				<Txt size={13} muted numberOfLines={1}>
					@{quote.user.username} · {timeAgo(quote.created_at)}
				</Txt>
			</View>
			{quote.content ? <RichText content={quote.content} size={14} numberOfLines={6} /> : null}
			<ImageGrid images={quote.images} sizes={quote.image_sizes} height={150} viewable={viewable} />
			{quote.gif ? <GifMedia gif={quote.gif} maxHeight={180} /> : null}
			{quote.is_quote ? (
				<Txt size={13} muted>
					Quotes another post
				</Txt>
			) : null}
		</Pressable>
	);
}

/** The Open Graph card of the first external link of a post. */
export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
	return (
		<Pressable
			onPress={() => openLink(preview.url)}
			style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 5, overflow: 'hidden' }}
		>
			{preview.image ? (
				<Image
					source={instanceImage(preview.image)}
					style={{ height: 150, backgroundColor: '#111' }}
					contentFit="cover"
				/>
			) : null}
			<View style={{ padding: 10, gap: 2 }}>
				<Txt size={13} muted numberOfLines={1}>
					{preview.site_name}
				</Txt>
				<Txt bold size={14} numberOfLines={2}>
					{preview.title}
				</Txt>
				{preview.description ? (
					<Txt size={13} muted numberOfLines={2}>
						{preview.description}
					</Txt>
				) : null}
			</View>
		</Pressable>
	);
}
