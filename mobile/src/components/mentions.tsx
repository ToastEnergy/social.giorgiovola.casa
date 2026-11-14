import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, withQuery } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { Page, User } from '@/lib/types';
import { Avatar, Txt } from './ui';

/** at most this many suggestions, like the web app */
const MAX = 6;

/**
 * The @mention being typed at the cursor and who it could be: profiles from search, or from
 * `source` (a group's members) when given. `apply` answers the text with the chosen username
 * filled in, and where the cursor goes after it.
 */
export function useMentionSuggestions(
	text: string,
	cursor: number,
	source?: (query: string) => User[]
) {
	const before = text.slice(0, cursor);
	// the same rule as the web app (MentionInput.svelte)
	const match = /(?:^|[^a-zA-Z0-9_@/])@([a-zA-Z0-9_]{0,32})$/.exec(before);
	const query = match ? match[1].toLowerCase() : null;
	const [users, setUsers] = useState<User[]>([]);
	// a local list is filtered as it's typed; otherwise everyone is searched
	const local = source && query !== null ? source(query).slice(0, MAX) : null;
	const searching = !source;
	useEffect(() => {
		if (query === null || !searching) return setUsers([]);
		const controller = new AbortController();
		const timer = setTimeout(() => {
			api<Page<User>>(withQuery('search/users', { q: query, limit: MAX }), {
				signal: controller.signal
			})
				.then((page) => setUsers(page.items))
				.catch(() => {});
		}, 150);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query, searching]);
	const apply = (user: User) => {
		const start = before.length - (match?.[1].length ?? 0);
		const inserted = `${user.username} `;
		return {
			text: `${text.slice(0, start)}${inserted}${text.slice(cursor)}`,
			cursor: start + inserted.length
		};
	};
	return { users: query === null ? [] : local ?? users, apply };
}

/**
 * Who the @mention being typed could be: a list of profiles (avatar, name, @username) in a
 * bordered box, like the web app's. Shared by the post composer and the chat input.
 */
export function MentionSuggestions({
	users,
	onPick,
	max = MAX
}: {
	users: User[];
	onPick: (user: User) => void;
	/** fewer rows where room is short (above the chat input) */
	max?: number;
}) {
	if (!users.length) return null;
	return (
		<View
			accessibilityRole="list"
			style={{
				borderWidth: 1,
				borderColor: colors.accent,
				borderRadius: 6,
				backgroundColor: colors.background,
				overflow: 'hidden'
			}}
		>
			{users.slice(0, max).map((user) => (
				<Pressable
					key={user.username}
					accessibilityRole="button"
					accessibilityLabel={`Mention @${user.username}`}
					onPress={() => onPick(user)}
					style={({ pressed }) => ({
						flexDirection: 'row',
						alignItems: 'center',
						gap: 10,
						padding: 10,
						backgroundColor: pressed ? colors.panel : 'transparent'
					})}
				>
					<Avatar user={user} size={32} />
					<View style={{ flex: 1, minWidth: 0 }}>
						<Txt extrabold size={15} numberOfLines={1}>
							{user.name}
						</Txt>
						<Txt size={13} dim={0.7} numberOfLines={1}>
							@{user.username}
						</Txt>
					</View>
				</Pressable>
			))}
		</View>
	);
}
