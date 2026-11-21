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
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { refreshColors } from '@/components/PostList';
import { Avatar, Button, ListState, Txt } from '@/components/ui';
import { useAccountProfiles } from '@/lib/accountProfiles';
import { withAs } from '@/lib/actAs';
import { api } from '@/lib/api';
import { count, timeAgo } from '@/lib/format';
import { useInboxAll } from '@/lib/inboxScope';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { clearTray } from '@/lib/tray';
import type { NotificationGroup, NotificationType, SwitcherProfile } from '@/lib/types';
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

// a post that reached several profiles is one group of the inbox of all of them, so it can't say
// 'you' (like the website)
const merged: Partial<Record<NotificationType, string>> = {
	reply: 'replied to a post',
	mention: 'mentioned you in a post',
	quote: 'quoted a post',
	ratio: 'ratioed a post'
};

/** What follows the senders' names: an invites notification says how many. */
function verbOf(group: NotificationGroup) {
	const generic = group.recipients && merged[group.type];
	if (generic) return generic;
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
	// likes, regiorgs and follows are a row per person; a post group reaching several profiles has
	// a row per profile, all from its one author
	const people = ['like', 'regiorg', 'follow'].includes(group.type)
		? group.count
		: group.senders.length;
	const shown = group.senders.slice(0, people <= 3 ? 3 : 2).map((u) => u.name);
	const others = people - shown.length;
	if (others > 0)
		return `${shown.join(', ')} and ${count(others)} ${others === 1 ? 'other' : 'others'}`;
	if (shown.length <= 1) return shown[0] ?? 'Someone';
	return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** The profile a group is for: in the inbox of several profiles that is its recipient. */
function recipientOf(group: NotificationGroup, own?: string) {
	return group.recipients?.[0]?.username ?? own;
}

function FilterChip({
	label,
	unread,
	active,
	avatar,
	onPress
}: {
	label: string;
	unread: number;
	active: boolean;
	avatar?: SwitcherProfile;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="tab"
			accessibilityState={{ selected: active }}
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				gap: 6,
				paddingHorizontal: 10,
				paddingVertical: 10,
				borderBottomWidth: 2,
				borderBottomColor: active ? colors.accent : 'transparent',
				opacity: active ? 1 : 0.6
			}}
		>
			{avatar ? <Avatar user={avatar} size={20} /> : null}
			<Txt size={14} numberOfLines={1}>
				{label}
			</Txt>
			{unread > 0 ? (
				<Txt size={12} accent bold>
					{unread > 99 ? '99+' : unread}
				</Txt>
			) : null}
		</Pressable>
	);
}

export default function Notifications() {
	const { me, unread, setUnread, profileCounts } = useSession();
	const inboxAll = useInboxAll();
	const profiles = useAccountProfiles();
	// `all` or a profile of the account; the setting "only the profile in use" has no filter
	const [filter, setFilter] = useState('all');
	const several = inboxAll && profiles.length > 1;
	const scope = !inboxAll
		? null
		: several && profiles.some((p) => p.username === filter)
		? filter
		: 'all';
	const scopeQuery = scope ? `?profiles=${encodeURIComponent(scope)}` : '';
	// only groups with something unread (the old ones the list would bury); the reads keep the scope
	const [unreadOnly, setUnreadOnly] = useState(false);
	const groupedQuery = unreadOnly ? `${scopeQuery}${scope ? '&' : '?'}unread=1` : scopeQuery;
	const list = usePaged<NotificationGroup>(`notifications/grouped${groupedQuery}`, (g) => g.key);
	const { items, setItems, reload } = list;
	// each profile's unread count, fetched fresh whenever the badge's total changes (a frame, a read,
	// the tab opened): realtime frames alone can miss a read made elsewhere
	const [counts, setCounts] = useState<Record<string, number>>({});
	const refreshCounts = useCallback(() => {
		if (!inboxAll) return;
		api<{ profiles: { username: string; notifications: number }[] }>(
			'notifications/unread?profiles=all'
		)
			.then((res) =>
				setCounts(Object.fromEntries(res.profiles.map((p) => [p.username, p.notifications])))
			)
			.catch(() => {});
	}, [inboxAll]);
	useEffect(refreshCounts, [refreshCounts, unread.notifications, profileCounts]);
	const countOf = (p: SwitcherProfile) => counts[p.username] ?? p.unread;
	// the badge's total, which the session keeps up to date
	const allUnread = unread.notifications;

	// reloaded when the tab is opened again and when the unread count grows
	const last = useRef(unread.notifications);
	useEffect(() => {
		if (unread.notifications > last.current) reload(true);
		last.current = unread.notifications;
	}, [unread.notifications, reload]);
	const first = useRef(true);
	useFocusEffect(
		useCallback(() => {
			if (!first.current) {
				reload(true);
				refreshCounts();
			}
			first.current = false;
		}, [reload, refreshCounts])
	);

	function open(group: NotificationGroup) {
		if (group.unread > 0) {
			api(`notifications/groups/${encodeURIComponent(group.key)}/read${scopeQuery}`, {
				method: 'POST'
			})
				.then(() => {
					clearTray('read');
					refreshCounts();
				})
				.catch(() => {});
			setUnread({ notifications: Math.max(0, unread.notifications - group.unread) });
			const now = new Date().toISOString();
			setItems((groups) =>
				groups.map((g) => (g.key === group.key ? { ...g, unread: 0, read_at: now } : g))
			);
		}
		const sender = group.senders[0];
		// a group for another profile than the one in use opens as that profile (without switching):
		// the profile in use when it is among the recipients, else the first
		const recipients = group.recipients;
		const as =
			recipients?.length && !recipients.some((r) => r.username === me?.user.username)
				? recipients[0].username
				: null;
		const go = (href: string) => router.push(withAs(href, as));
		if (group.type === 'invites') go('/settings/invites');
		else if (group.type === 'follow')
			go(
				group.count > 1
					? `/user/${recipientOf(group, me?.user.username)}/followers`
					: `/user/${sender?.username}`
			);
		else if (group.post) go(`/post/${group.post.id}`);
		else if (sender) go(`/user/${sender.username}`);
	}

	async function readAll() {
		try {
			await api(`notifications/read${scopeQuery}`, { method: 'POST' });
		} catch {
			return;
		}
		// one profile: only its share of the badge goes
		const own = scope && scope !== 'all' ? profiles.find((p) => p.username === scope) : null;
		setUnread({ notifications: own ? Math.max(0, unread.notifications - countOf(own)) : 0 });
		const now = new Date().toISOString();
		setItems((groups) =>
			unreadOnly ? [] : groups.map((g) => (g.read_at ? g : { ...g, unread: 0, read_at: now }))
		);
		clearTray('read');
		refreshCounts();
	}

	return (
		<FlatList
			data={items}
			keyExtractor={(group) => group.key}
			ListHeaderComponent={
				<View>
					{several ? (
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							accessibilityLabel="Notifications of"
							style={{ borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 10 }}
						>
							<FilterChip
								label="All"
								unread={allUnread}
								active={scope === 'all'}
								onPress={() => setFilter('all')}
							/>
							{profiles.map((p) => (
								<FilterChip
									key={p.username}
									label={`@${p.username}`}
									avatar={p}
									unread={countOf(p)}
									active={scope === p.username}
									onPress={() => setFilter(p.username)}
								/>
							))}
						</ScrollView>
					) : null}
					<View
						style={{
							paddingHorizontal: 20,
							paddingBottom: 10,
							flexDirection: 'row',
							gap: 10,
							alignItems: 'flex-start'
						}}
					>
						<Button
							size="sm"
							label="Unread"
							variant={unreadOnly ? 'primary' : 'default'}
							onPress={() => setUnreadOnly((on) => !on)}
						/>
						{items.some((g) => !g.read_at) ? (
							<Button size="sm" label="Mark all as read" onPress={readAll} />
						) : null}
					</View>
				</View>
			}
			ListEmptyComponent={
				<ListState
					loading={list.loading}
					error={list.error}
					empty={unreadOnly ? 'No unread notifications' : 'No notifications yet.'}
				/>
			}
			onEndReached={list.loadMore}
			onEndReachedThreshold={0.6}
			refreshControl={
				<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} {...refreshColors} />
			}
			renderItem={({ item }) => {
				// recipients other than the profile in use get their avatars and a "to" line
				const foreign = item.recipients?.some((r) => r.username !== me?.user.username);
				return (
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
							{item.recipients && foreign ? (
								<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
									<View style={{ flexDirection: 'row' }}>
										{item.recipients.slice(0, 3).map((r, index) => (
											<View key={r.username} style={{ marginLeft: index ? -6 : 0 }}>
												<Avatar user={r} size={18} />
											</View>
										))}
									</View>
									<Txt size={13} muted numberOfLines={1} style={{ flex: 1 }}>
										to {item.recipients.map((r) => `@${r.username}`).join(', ')}
									</Txt>
								</View>
							) : null}
						</View>
					</Pressable>
				);
			}}
		/>
	);
}
