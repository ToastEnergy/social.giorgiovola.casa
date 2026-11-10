import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Bot, Ellipsis, Link as LinkIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ask, showMenu, toast, viewImages } from '@/components/overlays';
import { PostCard } from '@/components/PostCard';
import { PostList } from '@/components/PostList';
import { openLink, RichText } from '@/components/RichText';
import { Avatar, Button, ErrorBanner, IconButton, Loading, Notice, TabRow, Txt } from '@/components/ui';
import { api, auth, avatarUrl, errorMessage } from '@/lib/api';
import { useBus } from '@/lib/bus';
import { count, shortDate, websiteLabel } from '@/lib/format';
import { usePostSync } from '@/lib/posts';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Post, Profile } from '@/lib/types';

type Tab = 'posts' | 'replies' | 'regiorgs';

export default function UserScreen() {
	const params = useLocalSearchParams<{ username: string }>();
	const username = params.username.replace(/^@/, '').toLowerCase();
	const { me, profileKey } = useSession();
	const [profile, setProfile] = useState<Profile | null>(null);
	const [pinned, setPinned] = useState<Post[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>('posts');
	const [busy, setBusy] = useState(false);
	usePostSync(setPinned);

	const load = useCallback(async () => {
		try {
			const [user, pin] = await Promise.all([
				api<Profile>(`users/${username}`),
				api<{ post: Post | null }>(`users/${username}/pinned`)
			]);
			setProfile(user);
			setPinned(pin.post ? [pin.post] : []);
			setError(null);
		} catch (e) {
			setError(errorMessage(e));
		}
	}, [username]);
	useEffect(() => {
		load();
	}, [load, profileKey]);
	useBus('pins_changed', load);

	async function toggleFollow() {
		if (!profile) return;
		setBusy(true);
		try {
			const res = await api<{ followers: number; following: number; followed: boolean }>(
				`users/${username}/follow`,
				{ method: profile.followed ? 'DELETE' : 'PUT' }
			);
			setProfile({ ...profile, ...res });
		} catch (e) {
			toast(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}

	async function toggleBlock() {
		if (!profile) return;
		try {
			const res = await api<{ blocked: boolean; blocks_you: boolean }>(`users/${username}/block`, {
				method: profile.blocked ? 'DELETE' : 'PUT'
			});
			setProfile({ ...profile, ...res });
			toast(res.blocked ? 'Blocked' : 'Unblocked');
		} catch (e) {
			toast(errorMessage(e));
		}
	}

	/** staff: ban or mute the account behind this profile, or undo it */
	async function moderate(kind: 'ban' | 'mute', undo: boolean) {
		let reason: string | null = '';
		if (!undo) {
			reason = await ask({
				title: kind === 'ban' ? `Ban @${username}?` : `Mute @${username}?`,
				message:
					kind === 'ban'
						? 'They are signed out everywhere and can’t sign in.'
						: 'They can read, but not post or send messages.',
				placeholder: 'Reason (optional)',
				maxLength: 200,
				confirm: kind === 'ban' ? 'Ban' : 'Mute'
			});
			if (reason === null) return;
		}
		try {
			const res = await api<{ message: string }>(`admin/users/${username}/${kind}`, {
				method: undo ? 'DELETE' : 'PUT',
				body: undo ? {} : { reason: reason.trim() || undefined }
			});
			toast(res.message);
			load();
		} catch (e) {
			toast(errorMessage(e));
		}
	}

	const menu = () => {
		if (!profile) return;
		const moderation = profile.moderation;
		showMenu([
			{
				label: 'Copy link',
				icon: <LinkIcon size={18} color={colors.foreground} />,
				onPress: async () => {
					await Clipboard.setStringAsync(`${auth.server}/@${username}`);
					toast('Link copied');
				}
			},
			!profile.self && {
				label: profile.blocked ? 'Unblock' : 'Block',
				danger: !profile.blocked,
				onPress: toggleBlock
			},
			moderation && {
				label: moderation.muted ? 'Unmute account' : 'Mute account',
				danger: !moderation.muted,
				onPress: () => moderate('mute', moderation.muted)
			},
			moderation && {
				label: moderation.banned ? 'Unban account' : 'Ban account',
				danger: !moderation.banned,
				onPress: () => moderate('ban', moderation.banned)
			}
		]);
	};

	if (!profile)
		return (
			<View style={{ flex: 1, padding: 20 }}>
				<Stack.Screen options={{ title: `@${username}` }} />
				{error ? <ErrorBanner message={error} /> : <Loading />}
			</View>
		);

	const known = profile.followedBy;
	const header = (
		<View>
			<View style={{ padding: 20, gap: 10 }}>
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
					<Pressable
						accessibilityLabel="Open profile picture"
						onPress={() => viewImages([{ uri: avatarUrl(profile, 512) }])}
					>
						<Avatar user={profile} size={64} />
					</Pressable>
					<View style={{ flex: 1 }}>
						<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
							<Txt extrabold size={20} numberOfLines={1} style={{ flexShrink: 1 }}>
								{profile.name}
							</Txt>
							{profile.bot ? <Bot size={16} color={colors.muted} /> : null}
						</View>
						<Txt dim={0.7}>
							@{profile.username}
							{profile.followsYou ? ' · Follows you' : ''}
						</Txt>
					</View>
					<IconButton label="Profile options" onPress={menu}>
						<Ellipsis size={22} color={colors.foreground} />
					</IconButton>
				</View>
				{profile.bio ? <RichText content={profile.bio} /> : null}
				{profile.website ? (
					<Txt accent onPress={() => openLink(profile.website)} suppressHighlighting>
						{websiteLabel(profile.website)}
					</Txt>
				) : null}
				<Txt size={13} muted>
					Joined {shortDate(profile.created_at)}
				</Txt>
				<View style={{ flexDirection: 'row', gap: 20 }}>
					<Pressable onPress={() => router.push(`/user/${username}/followers`)}>
						<Txt>
							<Txt bold>{count(profile.followers)}</Txt>{' '}
							<Txt muted>{profile.followers === 1 ? 'follower' : 'followers'}</Txt>
						</Txt>
					</Pressable>
					<Pressable onPress={() => router.push(`/user/${username}/following`)}>
						<Txt>
							<Txt bold>{count(profile.following)}</Txt> <Txt muted>following</Txt>
						</Txt>
					</Pressable>
				</View>
				{known.total > 0 && !profile.self ? (
					<Pressable
						onPress={() => router.push(`/user/${username}/known`)}
						style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
					>
						<View style={{ flexDirection: 'row' }}>
							{known.users.map((user, index) => (
								<View key={user.username} style={{ marginLeft: index ? -8 : 0 }}>
									<Avatar user={user} size={24} />
								</View>
							))}
						</View>
						<Txt size={13} muted style={{ flex: 1 }}>
							Followed by {known.users.map((u) => u.name).join(', ')}
							{known.total > known.users.length
								? ` and ${count(known.total - known.users.length)} more you follow`
								: ''}
						</Txt>
					</Pressable>
				) : null}
				{profile.moderation?.banned || profile.moderation?.muted ? (
					<Notice>
						{profile.moderation.banned
							? `Banned${profile.moderation.ban_reason ? `: ${profile.moderation.ban_reason}` : ''}`
							: `Muted${profile.moderation.mute_reason ? `: ${profile.moderation.mute_reason}` : ''}`}
					</Notice>
				) : null}
				{profile.blocks_you ? <Notice>This profile blocked you.</Notice> : null}
				{me ? (
					<View style={{ flexDirection: 'row', gap: 10 }}>
						{profile.self ? (
							<Button
								size="sm"
								label="Edit profile"
								onPress={() => router.push('/settings/profile')}
							/>
						) : (
							<>
								<Button
									size="sm"
									variant={profile.followed ? 'default' : 'primary'}
									label={profile.followed ? 'Following' : 'Follow'}
									loading={busy}
									onPress={toggleFollow}
								/>
								{!profile.blocked && !profile.blocks_you ? (
									<Button
										size="sm"
										label="Message"
										onPress={() => router.push(`/chat/${username}`)}
									/>
								) : null}
								{profile.blocked ? (
									<Button size="sm" variant="danger" label="Unblock" onPress={toggleBlock} />
								) : null}
							</>
						)}
					</View>
				) : null}
			</View>
			<TabRow
				tabs={[
					{ value: 'posts', label: 'Posts' },
					{ value: 'replies', label: 'Replies' },
					{ value: 'regiorgs', label: 'Regiorgios' }
				]}
				value={tab}
				onChange={setTab}
			/>
			{tab === 'posts' ? pinned.map((post) => <PostCard key={post.id} post={post} />) : null}
		</View>
	);

	return (
		<View style={{ flex: 1 }}>
			<Stack.Screen options={{ title: `@${profile.username}` }} />
			<PostList
				path={`users/${username}/posts?tab=${tab}`}
				header={header}
				onRefresh={load}
				empty={tab === 'posts' && pinned.length ? '' : 'Nothing here yet.'}
			/>
		</View>
	);
}
