import { Image } from 'expo-image';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { composerHref, dismissOutgoing, useOutgoing, type Outgoing } from '@/lib/posting';
import { colors } from '@/lib/theme';
import { Button, IconButton, Txt } from './ui';
import { UploadProgress } from './UploadProgress';

/** how long a failed post's card stays: its draft is back in the composer anyway */
const ERROR_MS = 10_000;

/**
 * The posts on their way (src/lib/posting.ts), floating above the screens: what's being sent with
 * each image's upload, or why it failed with a way back to the composer. Mounted once in the root
 * layout.
 */
export function PostingStatus() {
	const outgoing = useOutgoing();
	const insets = useSafeAreaInsets();
	if (!outgoing.length) return null;
	return (
		<View
			pointerEvents="box-none"
			style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 140, gap: 5 }}
		>
			{outgoing.map((o) => (
				<Card key={o.key} outgoing={o} />
			))}
		</View>
	);
}

function Card({ outgoing: o }: { outgoing: Outgoing }) {
	const failed = !!o.error;
	useEffect(() => {
		if (!failed) return;
		const timer = setTimeout(() => dismissOutgoing(o.key), ERROR_MS);
		return () => clearTimeout(timer);
	}, [failed, o.key]);
	const what = o.composer.startsWith('reply:') ? 'reply' : 'post';
	return (
		<View
			accessibilityLiveRegion="polite"
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				gap: 10,
				padding: 10,
				borderRadius: 5,
				borderWidth: 1,
				borderColor: failed ? colors.danger : colors.accent,
				backgroundColor: colors.background
			}}
		>
			{failed ? null : <ActivityIndicator size="small" color={colors.accent} />}
			<View style={{ flex: 1, gap: 5 }}>
				<Txt size={14} bold style={failed ? { color: colors.danger } : undefined}>
					{failed ? `Your ${what} wasn’t sent` : `Sending your ${what}…`}
				</Txt>
				<Txt size={13} muted numberOfLines={failed ? 2 : 1}>
					{failed
						? `${o.error} It’s back in the composer.`
						: o.draft.content.trim() || (o.draft.gif ? 'GIF' : 'Images')}
				</Txt>
				{!failed && o.draft.images.length ? (
					<View style={{ flexDirection: 'row', gap: 5 }}>
						{o.draft.images.map((image, i) => (
							<View key={image.uri} style={{ width: 40, height: 40 }}>
								<Image
									source={{ uri: image.uri }}
									style={{ width: 40, height: 40, borderRadius: 5, backgroundColor: '#111' }}
								/>
								{(o.progress[i] ?? 0) < 2 ? (
									<View
										style={{
											position: 'absolute',
											top: 0,
											left: 0,
											right: 0,
											bottom: 0,
											borderRadius: 5,
											backgroundColor: 'rgba(0,0,0,0.5)',
											alignItems: 'center',
											justifyContent: 'center'
										}}
									>
										<UploadProgress progress={o.progress[i] ?? 0} size={22} />
									</View>
								) : null}
							</View>
						))}
					</View>
				) : null}
			</View>
			{failed ? (
				<>
					<Button
						size="sm"
						label="Open"
						onPress={() => {
							dismissOutgoing(o.key);
							router.push(composerHref(o.composer));
						}}
					/>
					<IconButton label="Dismiss" onPress={() => dismissOutgoing(o.key)}>
						<X size={18} color={colors.muted} />
					</IconButton>
				</>
			) : null}
		</View>
	);
}
