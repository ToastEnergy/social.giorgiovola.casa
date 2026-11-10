import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { FlatList, RefreshControl } from 'react-native';
import { toast } from '@/components/overlays';
import { refreshColors } from '@/components/PostList';
import { Button, ListState, UserRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { FollowEntry } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

const lists = {
	followers: { path: 'followers', title: 'Followers', empty: 'No followers yet.' },
	following: { path: 'following', title: 'Following', empty: 'Not following anyone yet.' },
	known: { path: 'followers/known', title: 'Followers you know', empty: 'Nobody you follow.' }
};

/** /user/:username/followers, /following and /known (its followers that you follow too). */
export default function FollowList() {
	const { username, list: kind } = useLocalSearchParams<{
		username: string;
		list: keyof typeof lists;
	}>();
	const config = lists[kind] ?? lists.followers;
	const list = usePaged<FollowEntry>(`users/${username}/${config.path}`, (u) => u.username);

	async function toggle(entry: FollowEntry) {
		try {
			const res = await api<{ followed: boolean }>(`users/${entry.username}/follow`, {
				method: entry.followed ? 'DELETE' : 'PUT'
			});
			list.setItems((items) =>
				items.map((u) => (u.username === entry.username ? { ...u, followed: res.followed } : u))
			);
		} catch (e) {
			toast(errorMessage(e));
		}
	}

	return (
		<>
			<Stack.Screen options={{ title: `${config.title} · @${username}` }} />
			<FlatList
				data={list.items}
				keyExtractor={(user) => user.username}
				onEndReached={list.loadMore}
				onEndReachedThreshold={0.6}
				refreshControl={
					<RefreshControl
						refreshing={list.refreshing}
						onRefresh={list.refresh}
						{...refreshColors}
					/>
				}
				ListEmptyComponent={
					<ListState loading={list.loading} error={list.error} empty={config.empty} />
				}
				renderItem={({ item }) => (
					<UserRow
						user={item}
						subtitle={[item.followsYou ? 'Follows you' : '', item.bio].filter(Boolean).join(' · ')}
						right={
							item.self ? null : (
								<Button
									size="sm"
									variant={item.followed ? 'default' : 'primary'}
									label={item.followed ? 'Following' : 'Follow'}
									onPress={() => toggle(item)}
								/>
							)
						}
					/>
				)}
			/>
		</>
	);
}
