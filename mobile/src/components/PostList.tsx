import { useScrollToTop } from 'expo-router';
import { useRef } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { usePostSync } from '@/lib/posts';
import { colors } from '@/lib/theme';
import type { Post } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { PostCard } from './PostCard';
import { ListState } from './ui';

export const refreshColors = {
	tintColor: colors.accent,
	colors: [colors.accent],
	progressBackgroundColor: colors.background
};

/** A paginated list of posts from `path`, kept current by the stream. */
export function PostList({
	path,
	header,
	empty = 'Nothing here yet.',
	onRefresh,
	list
}: {
	path: string;
	header?: React.ReactElement | null;
	empty?: string;
	/** also called on pull to refresh, for what the header shows */
	onRefresh?: () => void;
	/** the list's state when the screen needs it too (adding new posts) */
	list?: ReturnType<typeof usePaged<Post>>;
}) {
	const own = usePaged<Post>(list ? null : path, (p) => p.id);
	const { items, setItems, loading, refreshing, error, refresh, loadMore } = list ?? own;
	usePostSync(setItems);
	const ref = useRef<FlatList<Post>>(null);
	useScrollToTop(ref);
	return (
		<FlatList
			ref={ref}
			data={items}
			keyExtractor={(post) => String(post.id)}
			renderItem={({ item }) => <PostCard post={item} />}
			ListHeaderComponent={header ?? undefined}
			ListEmptyComponent={<ListState loading={loading} error={error} empty={empty} />}
			onEndReached={loadMore}
			onEndReachedThreshold={0.6}
			refreshControl={
				<RefreshControl
					refreshing={refreshing}
					onRefresh={() => {
						refresh();
						onRefresh?.();
					}}
					{...refreshColors}
				/>
			}
			contentContainerStyle={{ paddingBottom: 90 }}
		/>
	);
}
