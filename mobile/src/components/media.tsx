import { Image, type ImageSource } from 'expo-image';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { instanceImage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { Gif, LinkPreview, QuotedPost } from '@/lib/types';
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

/**
 * The images of a post or message: one at its own shape, or a grid of two columns. Tapping opens
 * the viewer. `width` fixes the space they take (a chat bubble fits its content); without it they
 * fill their parent.
 */
export function ImageGrid({
	images,
	height = 220,
	width
}: {
	images: string[];
	/** the tallest a single image may be; several are square tiles */
	height?: number;
	width?: number;
}) {
	if (!images.length) return null;
	// with the token: message images need it, and on a members-only instance all of them
	const sources: ImageSource[] = images.map(instanceImage);
	if (images.length === 1)
		return <SingleImage url={images[0]} source={sources[0]} maxHeight={height} width={width} />;
	return (
		<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, width }}>
			{sources.map((source, index) => (
				<Pressable
					key={images[index]}
					accessibilityLabel="Open image"
					onPress={() => viewImages(sources, index)}
					style={{ flexBasis: '48%', flexGrow: 1, aspectRatio: 1 }}
				>
					<Image
						source={source}
						style={{ flex: 1, borderRadius: 5, backgroundColor: '#111' }}
						contentFit="cover"
						transition={100}
					/>
				</Pressable>
			))}
		</View>
	);
}

/** One image, uncropped: as wide as it may be, shrunk to stay under `maxHeight` when tall. */
function SingleImage({
	url,
	source,
	maxHeight,
	width
}: {
	url: string;
	source: ImageSource;
	maxHeight: number;
	width?: number;
}) {
	// the API doesn't send image sizes: square until it has loaded
	const [ratio, setRatio] = useState(() => ratios.get(url) ?? 1);
	const size =
		width === undefined
			? ({ width: '100%', maxWidth: maxHeight * ratio, maxHeight, aspectRatio: ratio } as const)
			: (() => {
					const w = Math.min(width, maxHeight * ratio);
					return { width: w, height: w / ratio };
			  })();
	return (
		<Pressable accessibilityLabel="Open image" onPress={() => viewImages([source], 0)} style={size}>
			<Image
				source={source}
				style={{ flex: 1, borderRadius: 5, backgroundColor: '#111' }}
				contentFit="cover"
				transition={100}
				onLoad={(e) => {
					const next = e.source.width / e.source.height;
					if (!next || !isFinite(next)) return;
					ratios.set(url, next);
					setRatio(next);
				}}
			/>
		</Pressable>
	);
}

/** A post shown inside another: the quoted one, or the first one linked in the text. */
export function QuoteCard({ quote }: { quote: QuotedPost | { deleted: true } }) {
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
			<ImageGrid images={quote.images} height={150} />
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
