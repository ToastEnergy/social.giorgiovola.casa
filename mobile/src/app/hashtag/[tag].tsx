import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useState } from 'react';
import { PostList } from '@/components/PostList';
import { Txt } from '@/components/ui';
import { api } from '@/lib/api';
import { count } from '@/lib/format';

export default function Hashtag() {
	const { tag } = useLocalSearchParams<{ tag: string }>();
	const [info, setInfo] = useState<{ tag: string; posts: number } | null>(null);
	useEffect(() => {
		api<{ tag: string; posts: number }>(`hashtags/${encodeURIComponent(tag)}`)
			.then(setInfo)
			.catch(() => {});
	}, [tag]);
	return (
		<>
			<Stack.Screen options={{ title: `#${info?.tag ?? tag}` }} />
			<PostList
				path={`hashtags/${encodeURIComponent(tag)}/posts`}
				header={
					info ? (
						<Txt muted size={14} style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
							{count(info.posts)} {info.posts === 1 ? 'post' : 'posts'}
						</Txt>
					) : null
				}
				empty="No posts with this hashtag."
			/>
		</>
	);
}
