import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PostCard } from '@/components/PostCard';
import { refreshColors } from '@/components/PostList';
import { Avatar, ListState, Txt } from '@/components/ui';
import { api, errorMessage, getPage } from '@/lib/api';
import { useBus } from '@/lib/bus';
import { usePostSync } from '@/lib/posts';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Page, Post } from '@/lib/types';

/** An open post: the thread above it, the post, and its replies. */
export default function PostScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const { me, profileKey } = useSession();
	const insets = useSafeAreaInsets();
	const [post, setPostState] = useState<Post | null>(null);
	const [ancestors, setAncestors] = useState<Post[]>([]);
	const [replies, setReplies] = useState<Post[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const next = useRef<string | null>(null);
	const loadingMore = useRef(false);

	const load = useCallback(async () => {
		try {
			const [main, above, below] = await Promise.all([
				api<Post>(`posts/${id}`),
				api<Page<Post>>(`posts/${id}/ancestors`),
				getPage<Post>(`posts/${id}/replies`)
			]);
			setPostState(main);
			setAncestors(above.items);
			setReplies(below.items);
			next.current = below.next_cursor;
			setError(null);
			// opening a post reads the mention notification for it
			api(`posts/${id}/seen`, { method: 'POST' }).catch(() => {});
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setRefreshing(false);
		}
	}, [id]);

	useEffect(() => {
		load();
	}, [load, profileKey]);
	useBus('stream_open', load);

	async function loadMore() {
		if (!next.current || loadingMore.current) return;
		loadingMore.current = true;
		try {
			const page = await getPage<Post>(`posts/${id}/replies`, next.current);
			next.current = page.next_cursor;
			setReplies((now) => {
				const seen = new Set(now.map((p) => p.id));
				return [...now, ...page.items.filter((p) => !seen.has(p.id))];
			});
		} catch {
			// scrolling again retries
		} finally {
			loadingMore.current = false;
		}
	}

	// the three parts are synced as lists; the open post is a list of one
	usePostSync(setAncestors);
	usePostSync(setReplies);
	usePostSync((change) =>
		setPostState((now) => {
			if (!now) return now;
			const result = typeof change === 'function' ? change([now]) : change;
			return result[0] ?? null;
		})
	);
	// deleted (here or by someone else): nothing left to show
	useBus('post_deleted', (e: { id: number }) => {
		if (String(e.id) === id && router.canGoBack()) router.back();
	});

	// replies written while the post is open
	const addReply = (reply: Post) => {
		if (String(reply.reply_to?.id) !== id) return;
		setReplies((now) => (now.some((p) => p.id === reply.id) ? now : [...now, reply]));
	};
	useBus('post', addReply);
	useBus('post_created', addReply);

	return (
		<View style={{ flex: 1 }}>
			<Stack.Screen options={{ title: 'Post' }} />
			<FlatList
				data={post ? replies : []}
				keyExtractor={(reply) => String(reply.id)}
				renderItem={({ item }) => <PostCard post={item} hideReplyTo />}
				ListHeaderComponent={
					post ? (
						<View>
							{ancestors.map((ancestor) => (
								<PostCard key={ancestor.id} post={ancestor} hideReplyTo />
							))}
							<PostCard post={post} detail hideReplyTo={ancestors.length > 0} />
						</View>
					) : undefined
				}
				ListEmptyComponent={
					post ? (
						<Txt muted style={{ textAlign: 'center', padding: 30 }}>
							Nessuno ha ancora giorgiato qui
						</Txt>
					) : (
						<ListState loading={!error} error={error} empty="" />
					)
				}
				onEndReached={loadMore}
				onEndReachedThreshold={0.6}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={() => {
							setRefreshing(true);
							load();
						}}
						{...refreshColors}
					/>
				}
				contentContainerStyle={{ paddingBottom: 20 }}
			/>
			{post && me ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Reply"
					onPress={() => router.push(`/compose?reply=${post.id}`)}
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						gap: 10,
						paddingHorizontal: 20,
						paddingTop: 10,
						paddingBottom: insets.bottom + 10,
						borderTopWidth: 1,
						borderTopColor: colors.line,
						backgroundColor: colors.background
					}}
				>
					<Avatar user={me.user} size={32} />
					<Txt muted>Giorgia un commento</Txt>
				</Pressable>
			) : null}
		</View>
	);
}
