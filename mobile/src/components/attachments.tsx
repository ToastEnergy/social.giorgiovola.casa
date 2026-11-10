import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { api, withQuery } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { Gif, Page, User } from '@/lib/types';
import { Avatar, Txt } from './ui';

export type Picked = { uri: string; mimeType?: string | null };

/** Lets the user choose up to `limit` images from the library. */
export async function pickImages(limit: number): Promise<Picked[]> {
	if (limit <= 0) return [];
	const result = await ImagePicker.launchImageLibraryAsync({
		mediaTypes: ['images'],
		allowsMultipleSelection: limit > 1,
		selectionLimit: limit,
		quality: 0.9
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

/** The images or GIF attached to what is being written, each with a remove button. */
export function AttachmentStrip({
	images,
	gif,
	onRemoveImage,
	onRemoveGif
}: {
	images: Picked[];
	gif: Gif | null;
	onRemoveImage: (index: number) => void;
	onRemoveGif: () => void;
}) {
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
		<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
			{images.map((image, index) => (
				<View key={image.uri}>
					<Image
						source={{ uri: image.uri }}
						style={{ width: 90, height: 90, borderRadius: 5, backgroundColor: '#111' }}
					/>
					{remove('Remove image', () => onRemoveImage(index))}
				</View>
			))}
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
		</ScrollView>
	);
}

/**
 * The @mention being typed at the cursor and who it could be. `apply` answers the text with the
 * chosen username filled in.
 */
export function useMentionSuggestions(text: string, cursor: number) {
	const before = text.slice(0, cursor);
	const match = /(?:^|[^a-zA-Z0-9_@/])@([a-zA-Z0-9_]*)$/.exec(before);
	const query = match ? match[1] : null;
	const [users, setUsers] = useState<User[]>([]);
	useEffect(() => {
		if (query === null) return setUsers([]);
		const controller = new AbortController();
		const timer = setTimeout(() => {
			api<Page<User>>(withQuery('search/users', { q: query, limit: 6 }), {
				signal: controller.signal
			})
				.then((page) => setUsers(page.items))
				.catch(() => {});
		}, 150);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);
	const apply = (user: User) => {
		const start = before.length - (query?.length ?? 0);
		return `${text.slice(0, start)}${user.username} ${text.slice(cursor)}`;
	};
	return { users: query === null ? [] : users, apply };
}

export function MentionSuggestions({
	users,
	onPick
}: {
	users: User[];
	onPick: (user: User) => void;
}) {
	if (!users.length) return null;
	return (
		<ScrollView
			horizontal
			keyboardShouldPersistTaps="always"
			showsHorizontalScrollIndicator={false}
			style={{ flexGrow: 0 }}
			contentContainerStyle={{ gap: 5, paddingVertical: 5 }}
		>
			{users.map((user) => (
				<Pressable
					key={user.username}
					onPress={() => onPick(user)}
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						gap: 5,
						borderWidth: 1,
						borderColor: colors.accent,
						borderRadius: 5,
						padding: 5
					}}
				>
					<Avatar user={user} size={24} />
					<Txt size={14}>@{user.username}</Txt>
				</Pressable>
			))}
		</ScrollView>
	);
}
