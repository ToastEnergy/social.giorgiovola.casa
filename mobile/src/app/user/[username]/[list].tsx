import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Stack } from 'expo-router/stack';
import { FlatList, RefreshControl } from 'react-native';
import { toast } from '@/components/overlays';
import { refreshColors } from '@/components/PostList';
import { ViewingAsBar } from '@/components/ViewingAsBar';
import { Button, ListState, UserRow } from '@/components/ui';
import { ActingAsProvider, useAsParam } from '@/lib/actAs';
import { api, errorMessage } from '@/lib/api';
import { seeFollowers } from '@/lib/seen';
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
	const as = useAsParam();
	const list = usePaged<FollowEntry>(
		`users/${username}/${config.path}`,
		(u) => u.username,
		undefined,
		as
	);

	// the followers of your profile were looked at (the server ignores other profiles)
	useEffect(() => {
		if (kind === 'followers' && username) seeFollowers(username);
	}, [kind, username]);

	async function toggle(entry: FollowEntry) {
		try {
			const res = await api<{ followed: boolean }>(`users/${entry.username}/follow`, {
				method: entry.followed ? 'DELETE' : 'PUT',
				as
			});
			list.setItems((items) =>
				items.map((u) => (u.username === entry.username ? { ...u, followed: res.followed } : u))
			);
		} catch (e) {
			toast(errorMessage(e));
		}
	}

	return (
		<ActingAsProvider value={as}>
			<Stack.Screen options={{ title: `${config.title} · @${username}` }} />
			<ViewingAsBar as={as} />
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
		</ActingAsProvider>
	);
}
