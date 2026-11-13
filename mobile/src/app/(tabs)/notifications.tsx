import { router, useFocusEffect } from 'expo-router';
import {
	AtSign,
	Gift,
	Heart,
	MessageCircle,
	Quote,
	Repeat2,
	TrendingUp,
	UserPlus
} from 'lucide-react-native';
import { useCallback, useEffect, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { refreshColors } from '@/components/PostList';
import { Avatar, Button, ListState, Txt } from '@/components/ui';
import { api } from '@/lib/api';
import { count, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { NotificationGroup, NotificationType } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

const verbs: Record<NotificationType, string> = {
	like: 'liked your post',
	regiorg: 'regiorged your post',
	reply: 'replied to you',
	mention: 'mentioned you',
	quote: 'quoted your post',
	follow: 'followed you',
	ratio: 'ratioed your post',
	ratioed_by_you: 'got ratioed by your reply',
	invites: 'gave you invites'
};

/** What follows the senders' names: an invites notification says how many. */
function verbOf(group: NotificationGroup) {
	if (group.type !== 'invites' || !group.invites) return verbs[group.type] ?? '';
	return `gave you ${count(group.invites)} ${group.invites === 1 ? 'invite' : 'invites'}`;
}

function TypeIcon({ type }: { type: NotificationType }) {
	const props = { size: 16, color: colors.accent };
	switch (type) {
		case 'like':
			return <Heart {...props} color={colors.danger} fill={colors.danger} />;
		case 'regiorg':
			return <Repeat2 {...props} />;
		case 'reply':
			return <MessageCircle {...props} />;
		case 'mention':
			return <AtSign {...props} />;
		case 'quote':
			return <Quote {...props} />;
		case 'follow':
			return <UserPlus {...props} />;
		case 'invites':
			return <Gift {...props} />;
		default:
			return <TrendingUp {...props} />;
	}
}

/** "Alice, Bob and 3 others" */
function people(group: NotificationGroup) {
	const shown = group.senders.slice(0, group.count <= 3 ? 3 : 2).map((u) => u.name);
	const others = group.count - shown.length;
	if (others > 0)
		return `${shown.join(', ')} and ${count(others)} ${others === 1 ? 'other' : 'others'}`;
	if (shown.length <= 1) return shown[0] ?? 'Someone';
	return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

export default function Notifications() {
	const { me, unread, setUnread } = useSession();
	const list = usePaged<NotificationGroup>('notifications/grouped', (g) => g.key);
	const { items, setItems, reload } = list;

	// reloaded when the tab is opened again and when the unread count grows
	const last = useRef(unread.notifications);
	useEffect(() => {
		if (unread.notifications > last.current) reload(true);
		last.current = unread.notifications;
	}, [unread.notifications, reload]);
	const first = useRef(true);
	useFocusEffect(
		useCallback(() => {
			if (!first.current) reload(true);
			first.current = false;
		}, [reload])
	);

	function open(group: NotificationGroup) {
		if (group.unread > 0) {
			api(`notifications/groups/${encodeURIComponent(group.key)}/read`, { method: 'POST' }).catch(
				() => {}
			);
			setUnread({ notifications: Math.max(0, unread.notifications - group.unread) });
			const now = new Date().toISOString();
			setItems((groups) =>
				groups.map((g) => (g.key === group.key ? { ...g, unread: 0, read_at: now } : g))
			);
		}
		const sender = group.senders[0];
		if (group.type === 'invites') router.push('/settings/invites');
		else if (group.type === 'follow')
			router.push(
				group.count > 1 ? `/user/${me?.user.username}/followers` : `/user/${sender?.username}`
			);
		else if (group.post) router.push(`/post/${group.post.id}`);
		else if (sender) router.push(`/user/${sender.username}`);
	}

	async function readAll() {
		try {
			await api('notifications/read', { method: 'POST' });
		} catch {
			return;
		}
		setUnread({ notifications: 0 });
		const now = new Date().toISOString();
		setItems((groups) => groups.map((g) => (g.read_at ? g : { ...g, unread: 0, read_at: now })));
	}

	return (
		<FlatList
			data={items}
			keyExtractor={(group) => group.key}
			ListHeaderComponent={
				items.some((g) => !g.read_at) ? (
					<View style={{ paddingHorizontal: 20, paddingBottom: 10, alignItems: 'flex-start' }}>
						<Button size="sm" label="Mark all as read" onPress={readAll} />
					</View>
				) : undefined
			}
			ListEmptyComponent={
				<ListState loading={list.loading} error={list.error} empty="No notifications yet." />
			}
			onEndReached={list.loadMore}
			onEndReachedThreshold={0.6}
			refreshControl={
				<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} {...refreshColors} />
			}
			renderItem={({ item }) => (
				<Pressable
					onPress={() => open(item)}
					style={({ pressed }) => ({
						flexDirection: 'row',
						gap: 10,
						paddingVertical: 12,
						paddingHorizontal: 20,
						borderLeftWidth: 3,
						borderLeftColor: item.read_at ? 'transparent' : colors.accent,
						backgroundColor: pressed ? colors.hover : 'transparent'
					})}
				>
					<View style={{ paddingTop: 4 }}>
						<TypeIcon type={item.type} />
					</View>
					<View style={{ flex: 1, gap: 5 }}>
						<View style={{ flexDirection: 'row', alignItems: 'center' }}>
							{item.senders.map((sender, index) => (
								<View key={sender.username} style={{ marginLeft: index ? -8 : 0 }}>
									<Avatar user={sender} size={28} />
								</View>
							))}
							<View style={{ flex: 1 }} />
							<Txt size={13} muted>
								{timeAgo(item.created_at)}
							</Txt>
						</View>
						<Txt size={15}>
							<Txt bold size={15}>
								{people(item)}
							</Txt>{' '}
							{verbOf(item)}
						</Txt>
						{item.type === 'invites' ? (
							<Txt size={14} muted>
								Invite someone to join
							</Txt>
						) : null}
						{item.post?.content ? (
							<Txt size={14} muted numberOfLines={2}>
								{item.post.content}
							</Txt>
						) : null}
					</View>
				</Pressable>
			)}
		/>
	);
}
