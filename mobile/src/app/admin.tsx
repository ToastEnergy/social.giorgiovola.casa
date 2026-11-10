import { Stack } from 'expo-router/stack';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { ask, showMenu, toast } from '@/components/overlays';
import { refreshColors } from '@/components/PostList';
import { Avatar, Button, ErrorBanner, Hint, Input, ListState, Txt } from '@/components/ui';
import { api, errorMessage, withQuery } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { AdminUser } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

const filters = ['all', 'banned', 'muted', 'staff'] as const;
type Filter = (typeof filters)[number];
type Motd = { motd: string; custom: boolean; default: string; max: number };

/** Moderation: ban, mute, roles, password resets and the message of the day. */
export default function Admin() {
	const { me } = useSession();
	const admin = me?.role === 'admin';
	const [query, setQuery] = useState('');
	const [search, setSearch] = useState('');
	const [filter, setFilter] = useState<Filter>('all');
	const [error, setError] = useState<string | null>(null);
	const [motd, setMotd] = useState<Motd | null>(null);
	const list = usePaged<AdminUser>(
		withQuery('admin/users', { q: search, filter }),
		(u) => u.username,
		25
	);

	useEffect(() => {
		const timer = setTimeout(() => setSearch(query.trim()), 300);
		return () => clearTimeout(timer);
	}, [query]);

	useEffect(() => {
		if (admin)
			api<Motd>('admin/motd')
				.then(setMotd)
				.catch(() => {});
	}, [admin]);

	const act = async (path: string, method: 'PUT' | 'DELETE', body?: unknown) => {
		setError(null);
		try {
			const res = await api<{ message: string }>(`admin/users/${path}`, { method, body });
			toast(res.message);
			list.reload(true);
		} catch (e) {
			setError(errorMessage(e));
		}
	};

	/** ban or mute with an optional reason */
	async function restrict(user: AdminUser, kind: 'ban' | 'mute') {
		const reason = await ask({
			title: `${kind === 'ban' ? 'Ban' : 'Mute'} @${user.username}?`,
			placeholder: 'Reason (optional)',
			maxLength: 200,
			confirm: kind === 'ban' ? 'Ban' : 'Mute'
		});
		if (reason === null) return;
		act(`${user.username}/${kind}`, 'PUT', { reason: reason.trim() || undefined });
	}

	const menu = (user: AdminUser) =>
		showMenu([
			user.can_moderate &&
				(user.muted_at
					? { label: 'Unmute', onPress: () => act(`${user.username}/mute`, 'DELETE') }
					: { label: 'Mute', danger: true, onPress: () => restrict(user, 'mute') }),
			user.can_moderate &&
				(user.banned_at
					? { label: 'Unban', onPress: () => act(`${user.username}/ban`, 'DELETE') }
					: { label: 'Ban', danger: true, onPress: () => restrict(user, 'ban') }),
			user.can_manage && {
				label: user.role === 'mod' ? 'Remove moderator role' : 'Make moderator',
				onPress: () =>
					act(`${user.username}/role`, 'PUT', { role: user.role === 'mod' ? 'user' : 'mod' })
			},
			user.can_manage && {
				label: 'Reset password',
				danger: true,
				onPress: async () => {
					const password = await ask({
						title: `New password for @${user.username}`,
						message: 'They are signed out everywhere.',
						secure: true,
						confirm: 'Reset'
					});
					if (password) act(`${user.username}/password`, 'PUT', { password });
				}
			}
		]);

	async function editMotd() {
		if (!motd) return;
		const value = await ask({
			title: 'Message of the day',
			message: `One line, shown above the timeline. Leave it empty for the default (“${motd.default}”).`,
			initial: motd.custom ? motd.motd : '',
			maxLength: motd.max,
			confirm: 'Save'
		});
		if (value === null) return;
		try {
			const res = await api<{ motd: string; message: string }>('admin/motd', {
				method: 'PUT',
				body: { motd: value.trim() }
			});
			setMotd({ ...motd, motd: res.motd, custom: !!value.trim() });
			toast(res.message);
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	return (
		<FlatList
			data={list.items}
			keyExtractor={(user) => user.username}
			keyboardShouldPersistTaps="handled"
			onEndReached={list.loadMore}
			onEndReachedThreshold={0.6}
			refreshControl={
				<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} {...refreshColors} />
			}
			ListHeaderComponent={
				<View style={{ padding: 20, gap: 12 }}>
					<Stack.Screen options={{ title: 'Moderation' }} />
					<ErrorBanner message={error} />
					{motd ? (
						<View style={{ gap: 8 }}>
							<Txt bold>Message of the day</Txt>
							<Txt muted>{motd.motd}</Txt>
							<Button
								size="sm"
								label="Edit"
								style={{ alignSelf: 'flex-start' }}
								onPress={editMotd}
							/>
						</View>
					) : null}
					<Input
						value={query}
						onChangeText={setQuery}
						placeholder="Search accounts"
						autoCorrect={false}
					/>
					<View style={{ flexDirection: 'row', gap: 5 }}>
						{filters.map((value) => (
							<Button
								key={value}
								size="sm"
								variant={filter === value ? 'primary' : 'default'}
								label={value[0].toUpperCase() + value.slice(1)}
								onPress={() => setFilter(value)}
							/>
						))}
					</View>
					<Hint>
						Actions target the account behind a profile; you can act on accounts ranked below you.
					</Hint>
				</View>
			}
			ListEmptyComponent={
				<ListState loading={list.loading} error={list.error} empty="No accounts found." />
			}
			renderItem={({ item }) => (
				<View
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						gap: 10,
						paddingVertical: 10,
						paddingHorizontal: 20
					}}
				>
					<Avatar user={item} size={40} link />
					<View style={{ flex: 1 }}>
						<Txt bold numberOfLines={1}>
							{item.name}{' '}
							<Txt size={14} dim={0.7}>
								@{item.username}
							</Txt>
						</Txt>
						<Txt size={13} muted numberOfLines={2}>
							{[
								item.role !== 'user' ? item.role : '',
								item.self ? 'you' : '',
								item.banned_at ? `banned${item.ban_reason ? ` (${item.ban_reason})` : ''}` : '',
								item.muted_at ? `muted${item.mute_reason ? ` (${item.mute_reason})` : ''}` : '',
								item.identities.length
									? `identities: ${item.identities.map((i) => `@${i.username}`).join(', ')}`
									: ''
							]
								.filter(Boolean)
								.join(' · ') || 'user'}
						</Txt>
					</View>
					{item.can_moderate || item.can_manage ? (
						<Button size="sm" label="Actions" onPress={() => menu(item)} />
					) : null}
				</View>
			)}
		/>
	);
}
