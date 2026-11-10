import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { api, withQuery } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { Page, User } from '@/lib/types';
import { Input, Txt, UserRow } from './ui';

/** A search box and the profiles matching it (GET /search/users). */
export function UserPicker({
	onPick,
	selected,
	exclude,
	header,
	placeholder = 'Search people'
}: {
	onPick: (user: User) => void;
	/** usernames shown with a check mark (choosing several) */
	selected?: string[];
	/** usernames left out of the results */
	exclude?: string[];
	header?: React.ReactElement;
	placeholder?: string;
}) {
	const [query, setQuery] = useState('');
	const [users, setUsers] = useState<User[]>([]);
	useEffect(() => {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			api<Page<User>>(withQuery('search/users', { q: query.trim().replace(/^@/, ''), limit: 20 }), {
				signal: controller.signal
			})
				.then((page) => setUsers(page.items))
				.catch(() => {});
		}, 200);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);
	return (
		<FlatList
			data={users.filter((u) => !exclude?.includes(u.username))}
			keyExtractor={(user) => user.username}
			keyboardShouldPersistTaps="handled"
			ListHeaderComponent={
				<View>
					{header}
					<View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
						<Input
							value={query}
							onChangeText={setQuery}
							placeholder={placeholder}
							autoCorrect={false}
						/>
					</View>
				</View>
			}
			ListEmptyComponent={
				<Txt muted style={{ textAlign: 'center', padding: 30 }}>
					Nobody found.
				</Txt>
			}
			renderItem={({ item }) => (
				<UserRow
					user={item}
					onPress={() => onPick(item)}
					right={
						selected?.includes(item.username) ? <Check size={20} color={colors.accent} /> : null
					}
				/>
			)}
		/>
	);
}
