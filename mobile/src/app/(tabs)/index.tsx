import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { PostCard } from '@/components/PostCard';
import { PostList } from '@/components/PostList';
import { HomePager } from '@/components/HomePager';
import { Inbox } from '@/components/Inbox';
import { Notice, TabRow } from '@/components/ui';
import { api } from '@/lib/api';
import { useBus } from '@/lib/bus';
import { setHomeFocused, useHomePage } from '@/lib/homePage';
import { usePostSync } from '@/lib/posts';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Page, Post } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import * as SecureStore from 'expo-secure-store';

type Feed = 'all' | 'following';

// the feed, and a swipe to the left away (like Instagram), the messages
export default function Home() {
	const { page } = useHomePage();
	const navigation = useNavigation();
	useEffect(() => {
		navigation.setOptions({ title: page === 1 ? 'Messages' : 'Home' });
	}, [navigation, page]);
	// the tab bar lights up the messages icon while they show here
	useFocusEffect(
		useCallback(() => {
			setHomeFocused(true);
			return () => setHomeFocused(false);
		}, [])
	);
	return <HomePager pages={[<Feed key="feed" />, <Inbox key="inbox" active={page === 1} />]} />;
}

function Feed() {
	const { me, profileKey } = useSession();
	const [feed, setFeedState] = useState<Feed>('all');
	const [pinned, setPinned] = useState<Post[]>([]);
	const list = usePaged<Post>(`timeline?feed=${feed}`, (p) => p.id);
	usePostSync(setPinned);
	// who the profile follows, to tell which new posts belong in the following feed
	const following = useRef(new Set<string>());

	// the chosen feed is remembered, like the web app's feed cookie
	useEffect(() => {
		SecureStore.getItemAsync('feed').then((saved) => {
			if (saved === 'following') setFeedState('following');
		});
	}, []);
	const setFeed = (next: Feed) => {
		setFeedState(next);
		SecureStore.setItemAsync('feed', next).catch(() => {});
	};

	const loadPinned = useCallback(() => {
		api<Page<Post>>('timeline/pinned')
			.then((page) => setPinned(page.items))
			.catch(() => {});
	}, []);
	useEffect(loadPinned, [loadPinned, profileKey]);
	useBus('pins_changed', loadPinned);
	useBus('stream_open', loadPinned);

	useEffect(() => {
		if (feed !== 'following') return;
		api<{ items: string[] }>('me/following')
			.then((res) => (following.current = new Set(res.items)))
			.catch(() => {});
	}, [feed, profileKey]);

	// new top-level posts show up at the top as they are written
	const add = (post: Post) => {
		if (post.reply_to) return;
		const own = post.user.username === me?.user.username;
		if (feed === 'following' && !own && !following.current.has(post.user.username)) return;
		list.setItems((posts) => (posts.some((p) => p.id === post.id) ? posts : [post, ...posts]));
	};
	useBus('post', add);
	useBus('post_created', add);

	const pinnedIds = new Set(pinned.map((p) => p.id));
	const header = (
		<View>
			<TabRow
				tabs={[
					{ value: 'all', label: 'All' },
					{ value: 'following', label: 'Following' }
				]}
				value={feed}
				onChange={setFeed}
			/>
			{me?.muted ? (
				<View style={{ padding: 20, paddingBottom: 0 }}>
					<Notice>
						Your account is muted{me.mute_reason ? `: ${me.mute_reason}` : ''}. You can read, but
						not post or send messages.
					</Notice>
				</View>
			) : null}
			{pinned.map((post) => (
				<PostCard key={post.id} post={post} />
			))}
		</View>
	);

	return (
		<View style={{ flex: 1 }}>
			<PostList
				path={`timeline?feed=${feed}`}
				list={{ ...list, items: list.items.filter((p) => !pinnedIds.has(p.id)) }}
				header={header}
				onRefresh={loadPinned}
				empty={
					feed === 'following'
						? 'Nothing here yet: follow someone to see their posts.'
						: 'No posts yet.'
				}
			/>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="New post"
				onPress={() => router.push('/compose')}
				style={({ pressed }) => ({
					position: 'absolute',
					right: 20,
					bottom: 20,
					width: 56,
					height: 56,
					borderRadius: 28,
					backgroundColor: colors.accent,
					alignItems: 'center',
					justifyContent: 'center',
					opacity: pressed ? 0.8 : 1
				})}
			>
				<Plus size={28} strokeWidth={2.5} color={colors.background} />
			</Pressable>
		</View>
	);
}
