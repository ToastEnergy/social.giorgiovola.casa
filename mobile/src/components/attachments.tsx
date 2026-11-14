import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import { ClipboardPaste, Pencil, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, View } from 'react-native';
import { colors } from '@/lib/theme';
import type { Gif } from '@/lib/types';
import { canEdit, PhotoEditor } from './PhotoEditor';
import { Txt } from './ui';

export type Picked = { uri: string; mimeType?: string | null };

/** Lets the user choose up to `limit` images from the library. */
export async function pickImages(limit: number): Promise<Picked[]> {
	if (limit <= 0) return [];
	const result = await ImagePicker.launchImageLibraryAsync({
		mediaTypes: ['images'],
		allowsMultipleSelection: limit > 1,
		selectionLimit: limit,
		// the original file, untouched: below 1 Android compresses every pick and keeps only the
		// first frame of a GIF. The server re-encodes uploads to WebP anyway
		quality: 1
	});
	if (result.canceled) return [];
	return result.assets.slice(0, limit).map((a) => ({ uri: a.uri, mimeType: a.mimeType }));
}

/** One image cropped square, for a profile picture. */
export async function pickAvatar(): Promise<Picked | null> {
	const result = await ImagePicker.launchImageLibraryAsync({
		mediaTypes: ['images'],
		allowsEditing: true,
		aspect: [1, 1],
		quality: 0.9
	});
	if (result.canceled || !result.assets[0]) return null;
	return { uri: result.assets[0].uri, mimeType: result.assets[0].mimeType };
}

/**
 * The images or GIF attached to what is being written, each with a remove button. With
 * `onReplaceImage`, tapping an image (not a GIF) opens the photo editor, and the edited copy
 * replaces it.
 */
export function AttachmentStrip({
	images,
	gif,
	onRemoveImage,
	onRemoveGif,
	onReplaceImage
}: {
	images: Picked[];
	gif: Gif | null;
	onRemoveImage: (index: number) => void;
	onRemoveGif: () => void;
	onReplaceImage?: (image: Picked, edited: Picked) => void;
}) {
	const [editing, setEditing] = useState<Picked | null>(null);
	if (!images.length && !gif) return null;
	const remove = (label: string, onPress: () => void) => (
		<Pressable
			accessibilityLabel={label}
			onPress={onPress}
			hitSlop={8}
			style={{
				position: 'absolute',
				top: 4,
				right: 4,
				backgroundColor: 'rgba(0,0,0,0.7)',
				borderRadius: 12,
				padding: 3
			}}
		>
			<X size={16} color={colors.foreground} />
		</Pressable>
	);
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={{ gap: 5 }}
		>
			{images.map((image, index) => {
				const thumb = (
					<Image
						source={{ uri: image.uri }}
						style={{ width: 90, height: 90, borderRadius: 5, backgroundColor: '#111' }}
					/>
				);
				return (
					<View key={image.uri}>
						{onReplaceImage && canEdit(image) ? (
							<Pressable accessibilityLabel="Edit image" onPress={() => setEditing(image)}>
								{thumb}
								<View
									style={{
										position: 'absolute',
										bottom: 4,
										left: 4,
										backgroundColor: 'rgba(12,11,11,0.8)',
										borderRadius: 12,
										padding: 5
									}}
								>
									<Pencil size={12} color={colors.foreground} />
								</View>
							</Pressable>
						) : (
							thumb
						)}
						{remove('Remove image', () => onRemoveImage(index))}
					</View>
				);
			})}
			{gif ? (
				<View>
					<Image
						source={{ uri: gif.poster }}
						style={{
							height: 90,
							aspectRatio: gif.width / gif.height || 1,
							borderRadius: 5,
							backgroundColor: '#111'
						}}
					/>
					{remove('Remove GIF', onRemoveGif)}
				</View>
			) : null}
			{editing ? (
				<PhotoEditor
					image={editing}
					onClose={(edited) => {
						setEditing(null);
						if (edited) onReplaceImage?.(editing, edited);
					}}
				/>
			) : null}
		</ScrollView>
	);
}

/**
 * Whether the clipboard holds an image, checked when the screen opens, when the app comes back
 * to the front and when something new is copied. Only asks whether there is one: reading it (which
 * iOS may confirm with a prompt) waits for `paste`.
 */
export function useClipboardImage() {
	const [available, setAvailable] = useState(false);
	useEffect(() => {
		let alive = true;
		const check = () =>
			Clipboard.hasImageAsync()
				.then((has) => alive && setAvailable(has))
				.catch(() => {});
		check();
		const app = AppState.addEventListener('change', (state) => state === 'active' && check());
		const copied = Clipboard.addClipboardListener(check);
		return () => {
			alive = false;
			app.remove();
			copied.remove();
		};
	}, []);
	/** the clipboard's image as a file, like a picked one; null when there's none (or it's refused) */
	const paste = async (): Promise<Picked | null> => {
		const image = await Clipboard.getImageAsync({ format: 'png' }).catch(() => null);
		if (!image) {
			setAvailable(false);
			return null;
		}
		// a file, not the data: URI, so drafts can keep it and uploads read it like any pick
		const dir = new Directory(Paths.cache, 'pasted-images');
		dir.create({ idempotent: true, intermediates: true });
		const file = new File(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
		file.create();
		await file.write(image.data.replace(/^data:[^,]*,/, ''), { encoding: 'base64' });
		return { uri: file.uri, mimeType: 'image/png' };
	};
	return { available, paste };
}

/** "Paste image": shown while the clipboard holds one, next to the other attach buttons. */
export function PasteImageButton({ onPress }: { onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Paste image from clipboard"
			hitSlop={6}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: 'row',
				alignItems: 'center',
				gap: 5,
				alignSelf: 'flex-start',
				borderWidth: 1,
				borderColor: colors.accent,
				borderRadius: 5,
				paddingVertical: 4,
				paddingHorizontal: 8,
				backgroundColor: pressed ? colors.accent : 'transparent'
			})}
		>
			<ClipboardPaste size={16} color={colors.foreground} />
			<Txt size={13}>Paste image</Txt>
		</Pressable>
	);
}
