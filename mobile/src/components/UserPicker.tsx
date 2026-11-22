import { Check, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { api, withQuery } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { GroupSummary, Page, User } from '@/lib/types';
import { Avatar, Input, Txt, UserRow } from './ui';

// a profile or one of your groups, as they appear in the results
type Entry = { kind: 'user'; user: User } | { kind: 'group'; group: GroupSummary };

/** A search box and the profiles matching it (GET /search/users), plus matching groups of yours. */
export function UserPicker({
	onPick,
	onPickGroup,
	groups,
	selected,
	exclude,
	header,
	placeholder = 'Search people'
}: {
	onPick: (user: User) => void;
	/** called instead of `onPick` for a chosen group, when `groups` is given */
	onPickGroup?: (group: GroupSummary) => void;
	/** your groups, matched by name in the results */
	groups?: GroupSummary[];
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

	// groups match by name on the client: they're all already here
	const q = query.trim().toLowerCase();
	const matchingGroups = groups?.filter((g) => q && g.name.toLowerCase().includes(q)) ?? [];
	const entries: Entry[] = [
		...matchingGroups.map((group) => ({ kind: 'group' as const, group })),
		...users
			.filter((u) => !exclude?.includes(u.username))
			.map((user) => ({ kind: 'user' as const, user }))
	];
	return (
		<FlatList
			data={entries}
			keyExtractor={(entry) =>
				entry.kind === 'group' ? `g${entry.group.id}` : entry.user.username
			}
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
			renderItem={({ item }) =>
				item.kind === 'group' ? (
					<Pressable
						onPress={() => onPickGroup?.(item.group)}
						style={({ pressed }) => ({
							flexDirection: 'row',
							alignItems: 'center',
							gap: 10,
							paddingVertical: 10,
							paddingHorizontal: 20,
							backgroundColor: pressed ? colors.hover : 'transparent'
						})}
					>
						<View style={{ width: 40, height: 40 }}>
							{item.group.members.slice(0, 2).map((member, index) => (
								<View
									key={member.username}
									style={{ position: 'absolute', left: index * 12, top: index * 12 }}
								>
									<Avatar user={member} size={28} />
								</View>
							))}
							{item.group.members.length === 0 ? <Users size={28} color={colors.muted} /> : null}
						</View>
						<View style={{ flex: 1 }}>
							<Txt bold numberOfLines={1}>
								{item.group.name}
							</Txt>
							<Txt size={14} muted>
								{item.group.size} members
							</Txt>
						</View>
					</Pressable>
				) : (
					<UserRow
						user={item.user}
						onPress={() => onPick(item.user)}
						right={
							selected?.includes(item.user.username) ? (
								<Check size={20} color={colors.accent} />
							) : null
						}
					/>
				)
			}
		/>
	);
}
