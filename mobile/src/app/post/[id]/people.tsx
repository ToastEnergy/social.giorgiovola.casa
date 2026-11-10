import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Avatar, ListState, TabRow, Txt, UserRow } from '@/components/ui';
import { colors } from '@/lib/theme';
import type { User } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

type Tab = 'likes' | 'regiorgs' | 'quotes';
type Quote = User & { id: number; content: string };

/** Who liked or regiorged a post, and the posts quoting it. */
export default function PostPeople() {
	const { id, tab: initial } = useLocalSearchParams<{ id: string; tab?: Tab }>();
	const [tab, setTab] = useState<Tab>(initial ?? 'likes');
	const list = usePaged<User | Quote>(`posts/${id}/${tab}`, (item) =>
		'id' in item ? item.id : item.username
	);
	return (
		<View style={{ flex: 1 }}>
			<Stack.Screen options={{ title: 'Post activity' }} />
			<TabRow
				tabs={[
					{ value: 'likes', label: 'Likes' },
					{ value: 'regiorgs', label: 'Regiorgios' },
					{ value: 'quotes', label: 'Quotes' }
				]}
				value={tab}
				onChange={setTab}
			/>
			<FlatList
				data={list.items}
				keyExtractor={(item) => ('id' in item ? String(item.id) : item.username)}
				onEndReached={list.loadMore}
				ListEmptyComponent={
					<ListState loading={list.loading} error={list.error} empty="Nobody yet." />
				}
				renderItem={({ item }) =>
					'id' in item ? (
						<Pressable
							onPress={() => router.push(`/post/${item.id}`)}
							style={({ pressed }) => ({
								flexDirection: 'row',
								gap: 10,
								paddingVertical: 10,
								paddingHorizontal: 20,
								backgroundColor: pressed ? colors.hover : 'transparent'
							})}
						>
							<Avatar user={item} size={40} />
							<View style={{ flex: 1 }}>
								<Txt bold numberOfLines={1}>
									{item.name}{' '}
									<Txt size={14} dim={0.7}>
										@{item.username}
									</Txt>
								</Txt>
								<Txt size={14} numberOfLines={3}>
									{item.content}
								</Txt>
							</View>
						</Pressable>
					) : (
						<UserRow user={item} />
					)
				}
			/>
		</View>
	);
}
