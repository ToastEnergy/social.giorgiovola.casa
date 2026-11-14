import { router, useFocusEffect } from 'expo-router';
import { BellOff, SquarePen, Users } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { refreshColors } from '@/components/PostList';
import { SETTLE_MS } from '@/components/HomePager';
import { Avatar, Button, ListState, Txt } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useBus } from '@/lib/bus';
import { getHomePage, subscribeHomePage } from '@/lib/homePage';
import { timeAgo } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { DirectConversation, GroupConversation } from '@/lib/types';

type Row = DirectConversation | GroupConversation;

/** the chats list: the second page of the home tab's pager, loaded each time it's shown */
export function Inbox() {
	const [rows, setRows] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	const load = useCallback(async () => {
		try {
			const res = await api<{ direct: DirectConversation[]; groups: GroupConversation[] }>(
				'conversations'
			);
			setRows(
				[...res.direct, ...res.groups].sort((a, b) => b.created_at.localeCompare(a.created_at))
			);
			setError(null);
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, []);

	// fresh each time the page is opened; once there are chats to show, only after the slide, so
	// the list doesn't re-render while it moves. watched without state, so turning the page doesn't
	// re-render the list either
	const loaded = useRef(false);
	useFocusEffect(
		useCallback(() => {
			let later: ReturnType<typeof setTimeout> | undefined;
			let shown = false;
			const update = () => {
				const now = getHomePage().page === 1;
				if (now === shown) return;
				shown = now;
				clearTimeout(later);
				if (!now) return;
				if (!loaded.current) {
					loaded.current = true;
					load();
					return;
				}
				later = setTimeout(load, SETTLE_MS);
			};
			update();
			const unsubscribe = subscribeHomePage(update);
			return () => {
				unsubscribe();
				clearTimeout(later);
			};
		}, [load])
	);

	// anything that changes a preview or an unread count: reload, once per burst
	const soon = () => {
		clearTimeout(timer.current);
		timer.current = setTimeout(load, 300);
	};
	useBus('message', soon);
	useBus('group_message', soon);
	useBus('message_deleted', soon);
	useBus('group_message_deleted', soon);
	useBus('message_reactions', soon);
	useBus('group_message_reactions', soon);
	useBus('group_updated', soon);
	useBus('messages_unread', soon);
	useBus('chats_changed', soon);
	useBus('stream_open', soon);

	return (
		<FlatList
			data={rows}
			keyExtractor={(row) => ('group' in row ? `g${row.group.id}` : `u${row.peer.username}`)}
			ListHeaderComponent={
				<View style={{ flexDirection: 'row', gap: 10, padding: 20, paddingTop: 5 }}>
					<Button size="sm" onPress={() => router.push('/chat/new')}>
						<SquarePen size={16} color={colors.foreground} />
						<Txt bold size={14}>
							New message
						</Txt>
					</Button>
					<Button size="sm" onPress={() => router.push('/group/new')}>
						<Users size={16} color={colors.foreground} />
						<Txt bold size={14}>
							New group
						</Txt>
					</Button>
				</View>
			}
			ListEmptyComponent={
				<ListState loading={loading} error={error} empty="No conversations yet." />
			}
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
			renderItem={({ item }) => {
				const group = 'group' in item ? item : null;
				const title = group ? group.group.name : (item as DirectConversation).peer.name;
				const unread = item.unread + (item.unread_reactions ?? 0);
				const prefix = item.reaction
					? ''
					: group
					? group.event
						? ''
						: item.mine
						? 'You: '
						: group.sender
						? `${group.sender}: `
						: ''
					: item.mine
					? 'You: '
					: '';
				return (
					<Pressable
						onPress={() =>
							router.push(
								group
									? `/group/${group.group.id}`
									: `/chat/${(item as DirectConversation).peer.username}`
							)
						}
						style={({ pressed }) => ({
							flexDirection: 'row',
							alignItems: 'center',
							gap: 10,
							paddingVertical: 10,
							paddingHorizontal: 20,
							backgroundColor: pressed ? colors.hover : 'transparent'
						})}
					>
						{group ? (
							<View style={{ width: 45, height: 45 }}>
								{group.group.members.slice(0, 2).map((member, index) => (
									<View
										key={member.username}
										style={{ position: 'absolute', left: index * 15, top: index * 15 }}
									>
										<Avatar user={member} size={30} />
									</View>
								))}
								{group.group.members.length === 0 ? <Users size={30} color={colors.muted} /> : null}
							</View>
						) : (
							<Avatar user={(item as DirectConversation).peer} size={45} />
						)}
						<View style={{ flex: 1 }}>
							<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
								<Txt bold numberOfLines={1} style={{ flexShrink: 1 }}>
									{title}
								</Txt>
								{item.muted ? <BellOff size={13} color={colors.muted} /> : null}
								<View style={{ flex: 1 }} />
								<Txt size={13} muted>
									{timeAgo(item.created_at)}
								</Txt>
							</View>
							<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
								<Txt
									size={14}
									muted={!unread}
									bold={unread > 0}
									numberOfLines={1}
									style={{ flex: 1 }}
								>
									{item.preview ? prefix + item.preview : 'No messages yet'}
								</Txt>
								{unread > 0 ? (
									<View
										style={{
											backgroundColor: item.muted ? colors.line : colors.accent,
											borderRadius: 10,
											minWidth: 20,
											paddingHorizontal: 6,
											alignItems: 'center'
										}}
									>
										<Txt size={12} bold style={{ color: colors.background }}>
											{unread > 99 ? '99+' : unread}
										</Txt>
									</View>
								) : null}
							</View>
						</View>
					</Pressable>
				);
			}}
		/>
	);
}
