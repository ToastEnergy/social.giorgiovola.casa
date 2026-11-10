import { router } from 'expo-router';
import { Hash } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ErrorBanner, Input, Loading, Txt, UserRow } from '@/components/ui';
import { api, errorMessage, withQuery } from '@/lib/api';
import { count } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { User } from '@/lib/types';

type Results = { query: string; users: User[]; hashtags: { tag: string; posts: number }[] };

export default function Search() {
	const { profileKey } = useSession();
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<Results | null>(null);
	const [error, setError] = useState<string | null>(null);

	// an empty query lists the trending hashtags
	useEffect(() => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => {
				api<Results>(withQuery('search', { q: query.trim(), limit: 20 }), {
					signal: controller.signal
				})
					.then((res) => {
						setResults(res);
						setError(null);
					})
					.catch((e) => {
						if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
					});
			},
			query ? 250 : 0
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query, profileKey]);

	const trending = !query.trim();
	return (
		<View style={{ flex: 1 }}>
			<View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
				<Input
					value={query}
					onChangeText={setQuery}
					placeholder="Search people and #hashtags"
					autoCorrect={false}
					returnKeyType="search"
					clearButtonMode="while-editing"
				/>
			</View>
			<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
				{error ? (
					<View style={{ padding: 20 }}>
						<ErrorBanner message={error} />
					</View>
				) : null}
				{!results && !error ? <Loading /> : null}
				{results?.users.map((user) => (
					<UserRow key={user.username} user={user} />
				))}
				{results?.hashtags.length ? (
					<Txt bold size={14} muted style={{ paddingHorizontal: 20, paddingTop: 15 }}>
						{trending ? 'Trending' : 'Hashtags'}
					</Txt>
				) : null}
				{results?.hashtags.map((hashtag) => (
					<Pressable
						key={hashtag.tag}
						onPress={() => router.push(`/hashtag/${encodeURIComponent(hashtag.tag)}`)}
						style={({ pressed }) => ({
							flexDirection: 'row',
							alignItems: 'center',
							gap: 10,
							paddingVertical: 10,
							paddingHorizontal: 20,
							backgroundColor: pressed ? colors.hover : 'transparent'
						})}
					>
						<Hash size={20} color={colors.accent} />
						<Txt bold style={{ flex: 1 }} numberOfLines={1}>
							{hashtag.tag}
						</Txt>
						<Txt size={14} muted>
							{count(hashtag.posts)} {hashtag.posts === 1 ? 'post' : 'posts'}
						</Txt>
					</Pressable>
				))}
				{results && !results.users.length && !results.hashtags.length ? (
					<Txt muted style={{ textAlign: 'center', padding: 40 }}>
						{trending ? 'No trending hashtags yet.' : 'Nothing found.'}
					</Txt>
				) : null}
			</ScrollView>
		</View>
	);
}
