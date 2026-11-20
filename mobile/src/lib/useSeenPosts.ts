import { useRef } from 'react';
import { seePost } from './seen';
import { useSession } from './session';
import type { Post } from './types';

/**
 * Props for a FlatList of posts: the ones that stay on screen for a moment are reported as seen,
 * so their notifications are read. Stable, as a FlatList doesn't take new ones while mounted.
 */
export function useSeenPosts() {
	const { me } = useSession();
	const mine = useRef(me?.user.username);
	mine.current = me?.user.username;
	return useRef({
		onViewableItemsChanged: ({ viewableItems }: { viewableItems: { item?: Post | null }[] }) => {
			// your own posts can't have a notification for you
			for (const { item } of viewableItems)
				if (item && item.user.username !== mine.current) seePost(item.id);
		},
		// a quarter of the post for a second: a tall post never gets to half of itself on screen
		viewabilityConfig: { itemVisiblePercentThreshold: 25, minimumViewTime: 1000 }
	}).current;
}
