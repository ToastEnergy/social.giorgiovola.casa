import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Check, Code, LogOut, Plus, Settings, Shield, UserRound } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { confirm, toast } from '@/components/overlays';
import { Avatar, Txt } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { SwitcherAccount, SwitcherProfile } from '@/lib/types';

function MenuRow({
	icon,
	label,
	danger,
	onPress
}: {
	icon: React.ReactNode;
	label: string;
	danger?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			style={({ pressed }) => ({
				flexDirection: 'row',
				alignItems: 'center',
				gap: 12,
				paddingVertical: 14,
				paddingHorizontal: 20,
				backgroundColor: pressed ? colors.hover : 'transparent'
			})}
		>
			{icon}
			<Txt style={danger ? { color: colors.danger } : undefined}>{label}</Txt>
		</Pressable>
	);
}

/** The profile menu: the profiles to switch between, settings, moderation and logging out. */
export default function MeTab() {
	const session = useSession();
	const { me, accounts, server } = session;
	// each signed-in account with its identities, by its index in `accounts`
	const [switcher, setSwitcher] = useState<(SwitcherAccount | null)[]>([]);

	const tokens = accounts.map((a) => a.token).join();
	useFocusEffect(
		useCallback(() => {
			let stale = false;
			Promise.all(
				accounts.map((account) =>
					api<{ items: SwitcherAccount[] }>('auth/accounts', { token: account.token })
						.then((res) => res.items[0] ?? null)
						.catch(() => null)
				)
			).then((result) => {
				if (!stale) setSwitcher(result);
			});
			return () => {
				stale = true;
			};
		}, [tokens, me?.user.username])
	);

	async function use(index: number, profile: SwitcherProfile) {
		if (index === session.current && profile.username === me?.user.username) return;
		try {
			if (index !== session.current) await session.selectAccount(index);
			// a token keeps acting as the profile it last switched to
			await api('auth/switch', {
				method: 'POST',
				token: accounts[index].token,
				body: { username: profile.username }
			});
			await session.reloadMe();
			router.navigate('/');
		} catch (e) {
			toast(errorMessage(e));
		}
	}

	const profileRow = (index: number, profile: SwitcherProfile, identity: boolean) => {
		const active = index === session.current && profile.username === me?.user.username;
		const unread = profile.unread + profile.unreadMessages + profile.unreadReactions;
		return (
			<Pressable
				key={`${index}:${profile.username}`}
				onPress={() => use(index, profile)}
				accessibilityLabel={`Use @${profile.username}`}
				style={({ pressed }) => ({
					flexDirection: 'row',
					alignItems: 'center',
					gap: 10,
					paddingVertical: 8,
					paddingLeft: identity ? 40 : 20,
					paddingRight: 20,
					backgroundColor: pressed ? colors.hover : 'transparent'
				})}
			>
				<Avatar user={profile} size={identity ? 32 : 40} />
				<View style={{ flex: 1 }}>
					<Txt bold numberOfLines={1}>
						{profile.name}
					</Txt>
					<Txt size={13} muted numberOfLines={1}>
						@{profile.username}
						{profile.sharedBy ? ` · shared by @${profile.sharedBy}` : ''}
					</Txt>
				</View>
				{unread > 0 && !active ? (
					<View
						style={{
							backgroundColor: colors.accent,
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
				{active ? <Check size={18} color={colors.accent} /> : null}
			</Pressable>
		);
	};

	if (!me) return null;
	const icon = { size: 20, color: colors.foreground };
	return (
		<ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
			<Pressable
				onPress={() => router.push(`/user/${me.user.username}`)}
				style={{ flexDirection: 'row', alignItems: 'center', gap: 15, padding: 20 }}
			>
				<Avatar user={me.user} size={64} />
				<View style={{ flex: 1 }}>
					<Txt extrabold size={20} numberOfLines={1}>
						{me.user.name}
					</Txt>
					<Txt dim={0.7}>@{me.user.username}</Txt>
					{me.role !== 'user' ? (
						<Txt size={13} accent>
							{me.role === 'admin' ? 'Admin' : 'Moderator'}
						</Txt>
					) : null}
				</View>
			</Pressable>

			<MenuRow
				icon={<UserRound {...icon} />}
				label="Profile"
				onPress={() => router.push(`/user/${me.user.username}`)}
			/>
			<MenuRow
				icon={<Settings {...icon} />}
				label="Settings"
				onPress={() => router.push('/settings')}
			/>
			{me.role !== 'user' ? (
				<MenuRow
					icon={<Shield {...icon} />}
					label="Moderation"
					onPress={() => router.push('/admin')}
				/>
			) : null}
			<MenuRow
				icon={<Code {...icon} />}
				label="API documentation"
				onPress={() => WebBrowser.openBrowserAsync(`${server}/developers`).catch(() => {})}
			/>
			<View style={{ height: 1, backgroundColor: colors.line, marginVertical: 10 }} />
			<Txt bold size={14} muted style={{ paddingHorizontal: 20, paddingVertical: 5 }}>
				Switch profile
			</Txt>
			{switcher.map((account, index) =>
				account ? (
					<View key={account.username}>
						{profileRow(index, account, false)}
						{account.identities.map((identity) => profileRow(index, identity, true))}
					</View>
				) : null
			)}
			<MenuRow
				icon={<Plus {...icon} />}
				label="Add an account"
				onPress={() => router.push('/login?add=1')}
			/>

			<View style={{ height: 1, backgroundColor: colors.line, marginVertical: 10 }} />
			<MenuRow
				icon={<LogOut size={20} color={colors.danger} />}
				label={`Log out @${me.account?.username ?? me.user.username}`}
				danger
				onPress={async () => {
					if (
						await confirm('Log out?', 'This account is signed out on this device.', 'Log out', true)
					)
						session.signOut();
				}}
			/>
		</ScrollView>
	);
}
