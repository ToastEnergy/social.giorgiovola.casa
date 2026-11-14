import { Stack } from 'expo-router/stack';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, Switch, View } from 'react-native';
import { Button, Hint, Notice, Section, Txt } from '@/components/ui';
import {
	channels,
	importance,
	Notifications,
	openNotificationSettings,
	pushInExpoGo,
	pushSupported,
	requestPushPermission,
	setPushEnabled,
	usePushState
} from '@/lib/push';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type Permission = 'granted' | 'ask' | 'blocked';

const row = {
	flexDirection: 'row',
	alignItems: 'center',
	gap: 10,
	paddingVertical: 12
} as const;

/** Push on this phone: on or off for every account here, the permission and Android's channels. */
export default function NotificationSettings() {
	const { accounts } = useSession();
	const { enabled, token, unavailable } = usePushState();
	const [permission, setPermission] = useState<Permission | null>(null);
	// whether each channel is on in Android's settings
	const [channelOn, setChannelOn] = useState<Record<string, boolean>>({});

	// read again on coming back from Android's settings, where all of it can change
	const refresh = useCallback(async () => {
		if (!Notifications) return;
		const p = await Notifications.getPermissionsAsync();
		setPermission(p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'blocked');
		const next: Record<string, boolean> = {};
		for (const { id } of channels) {
			const channel = await Notifications.getNotificationChannelAsync(id);
			next[id] = !channel || channel.importance !== importance.none;
		}
		setChannelOn(next);
	}, []);
	useEffect(() => {
		refresh().catch(() => {});
		const sub = AppState.addEventListener('change', (s) => {
			if (s === 'active') refresh().catch(() => {});
		});
		return () => sub.remove();
	}, [refresh]);

	async function allow() {
		const p = await requestPushPermission();
		setPermission(p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'blocked');
		if (!p.granted && !p.canAskAgain) openNotificationSettings();
		refresh().catch(() => {});
	}

	if (!pushSupported)
		return (
			<ScrollView contentContainerStyle={{ padding: 20 }}>
				<Stack.Screen options={{ title: 'Notifications' }} />
				<Section title="Push notifications">
					<Hint>
						{pushInExpoGo
							? 'Push notifications don’t work in Expo Go: use a development build to try them.'
							: 'Push notifications aren’t available on iPhone and iPad yet.'}{' '}
						Unread counts and new messages still arrive live while the app is open.
					</Hint>
				</Section>
			</ScrollView>
		);

	const on = enabled !== false;
	const working = on && permission === 'granted' && !!token;

	return (
		<ScrollView contentContainerStyle={{ padding: 20 }}>
			<Stack.Screen options={{ title: 'Notifications' }} />
			<Section title="Push notifications">
				<Pressable
					accessibilityRole="switch"
					accessibilityState={{ checked: on }}
					onPress={() => setPushEnabled(!on)}
					style={row}
				>
					<View style={{ flex: 1 }}>
						<Txt bold>Push notifications on this phone</Txt>
						<Hint>
							{accounts.length > 1
								? `For all ${accounts.length} accounts signed in here.`
								: 'For the account signed in here and its identities.'}
						</Hint>
					</View>
					<Switch
						value={on}
						onValueChange={setPushEnabled}
						trackColor={{ true: colors.accent, false: colors.line }}
					/>
				</Pressable>

				{on && permission === 'ask' ? (
					<Notice>
						The app isn’t allowed to show notifications yet.{'\n'}
						<Txt accent bold size={14} onPress={allow}>
							Allow notifications
						</Txt>
					</Notice>
				) : null}
				{on && permission === 'blocked' ? (
					<Notice>
						Notifications are turned off for this app in Android’s settings.{'\n'}
						<Txt accent bold size={14} onPress={() => openNotificationSettings()}>
							Open Android settings
						</Txt>
					</Notice>
				) : null}
				{on && permission === 'granted' && unavailable ? (
					<Notice>
						This phone couldn’t sign up for push notifications: check the connection, or this build
						of the app was made without Firebase.
					</Notice>
				) : null}
				{working ? <Hint>This phone gets push notifications.</Hint> : null}
				{!on ? (
					<Hint>
						Turned off, the server stops sending pushes to this phone. Unread counts and new
						messages still arrive live while the app is open.
					</Hint>
				) : null}
			</Section>

			{on && permission === 'granted' ? (
				<Section title="Categories">
					<Hint>Silence one kind of notification, or change its sound, in Android’s settings.</Hint>
					<View>
						{channels.map((channel) => (
							<Pressable
								key={channel.id}
								onPress={() => openNotificationSettings(channel.id)}
								style={({ pressed }) => [
									row,
									{
										marginHorizontal: -20,
										paddingHorizontal: 20,
										backgroundColor: pressed ? colors.hover : 'transparent'
									}
								]}
							>
								<View style={{ flex: 1 }}>
									<Txt bold>{channel.name}</Txt>
									<Hint>{channel.description}</Hint>
								</View>
								<Txt size={14} muted>
									{channelOn[channel.id] === false ? 'Off' : 'On'}
								</Txt>
								<ChevronRight size={20} color={colors.muted} />
							</Pressable>
						))}
					</View>
					<Button
						label="All notification settings"
						size="sm"
						style={{ alignSelf: 'flex-start' }}
						onPress={() => openNotificationSettings()}
					/>
				</Section>
			) : null}

			<Section title="Conversations">
				<Hint>
					To stop pushes from one chat, mute it from the top of the conversation. In a group, a
					message that mentions you still sends one.
				</Hint>
			</Section>
		</ScrollView>
	);
}
