import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Linking, Platform } from 'react-native';
import { api } from './api';
import { useSession } from './session';
import { colors } from './theme';

/**
 * Push notifications (Android only for now): the phone's FCM token is registered with
 * POST /push/devices for every account signed in here, and the server sends the same
 * notifications as to a browser. Logging out deletes the token's session, which stops them.
 * Turning push off in the settings unregisters the phone from every account signed in here.
 */

/** whether push works on this platform at all (iOS needs a paid Apple developer account) */
export const pushSupported = Platform.OS === 'android';

type PushState = {
	/** the choice in the settings, for the whole phone; null until read from storage */
	enabled: boolean | null;
	/** the FCM token, once there is one */
	token: string | null;
	/** no token could be had: built without Firebase, or offline */
	unavailable: boolean;
};

const ENABLED_KEY = 'push_enabled';
let state: PushState = { enabled: null, token: null, unavailable: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<PushState>) {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The push settings of this phone, shared by the layout and the settings screen. */
export const usePushState = () => useSyncExternalStore(subscribe, () => state);

SecureStore.getItemAsync(ENABLED_KEY)
	.then((saved) => setState({ enabled: saved !== 'false' }))
	.catch(() => setState({ enabled: true }));

export function setPushEnabled(enabled: boolean) {
	setState({ enabled });
	SecureStore.setItemAsync(ENABLED_KEY, String(enabled)).catch(() => {});
}

/** The Android channels the server sends to (its channelId), each can be silenced on its own. */
export const channels = [
	{
		id: 'messages',
		name: 'Messages',
		description: 'Direct and group messages',
		importance: Notifications.AndroidImportance.HIGH
	},
	{
		id: 'activity',
		name: 'Activity',
		description: 'Likes, replies, mentions, follows and the rest of your notifications',
		importance: Notifications.AndroidImportance.DEFAULT
	}
] as const;

/** Android's settings for one channel of the app, or for all its notifications. */
export async function openNotificationSettings(channelId?: string) {
	const app = Constants.expoConfig?.android?.package;
	try {
		if (!app) throw new Error('no package name');
		const extras = [{ key: 'android.provider.extra.APP_PACKAGE', value: app }];
		if (channelId)
			await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
				...extras,
				{ key: 'android.provider.extra.CHANNEL_ID', value: channelId }
			]);
		else await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', extras);
	} catch {
		// the app's page in the system settings is always there
		await Linking.openSettings();
	}
}

/** what the server puts in each push (the FCM `body` field, see /api.txt) */
type PushData = { url?: string; profile?: string };

/** The app screen for a web path of the instance; null when the app has none. */
export function appPath(url: string): string | null {
	const parts = url.split(/[?#]/)[0].split('/').filter(Boolean).map(decodeURIComponent);
	if (parts[0]?.startsWith('@')) {
		const username = parts[0].slice(1);
		return parts[1] ? `/post/${parts[1]}` : `/user/${username}`;
	}
	if (parts[0] === 'messages') {
		if (parts[1] === 'groups' && parts[2]) return `/group/${parts[2]}`;
		return parts[1] ? `/chat/${parts[1]}` : '/messages';
	}
	if (parts[0] === 'notifications') return '/notifications';
	if (parts[0] === 'settings' && parts[1] === 'invites') return '/settings/invites';
	return null;
}

// the screen in use, so a push for it isn't shown on top of it
let currentPath = '';
let currentProfile = '';

Notifications.setNotificationHandler({
	// only asked while the app is open: shown unless it is about the screen already open
	handleNotification: async (notification) => {
		const data = (notification.request.content.data ?? {}) as PushData;
		const here =
			!!data.url &&
			appPath(data.url) === currentPath &&
			(!data.profile || data.profile === currentProfile);
		return {
			shouldShowBanner: !here,
			shouldShowList: !here,
			shouldPlaySound: !here,
			shouldSetBadge: false
		};
	}
});

/** Creates the channels, so Android 13+ can ask for the permission and the settings list them. */
async function createChannels() {
	for (const { id, ...channel } of channels)
		await Notifications.setNotificationChannelAsync(id, { ...channel, lightColor: colors.accent });
}

/**
 * The FCM token, after asking for the permission once when `ask`. Null without permission or
 * Firebase. Turning push off still needs the token, to unregister it, but not the permission.
 */
async function deviceToken(ask: boolean): Promise<string | null> {
	if (ask) {
		await createChannels();
		let permission = await Notifications.getPermissionsAsync();
		if (!permission.granted && permission.canAskAgain)
			permission = await Notifications.requestPermissionsAsync();
		if (!permission.granted) return null;
	}
	try {
		const token = await Notifications.getDevicePushTokenAsync();
		const data = typeof token.data === 'string' ? token.data : null;
		setState({ unavailable: !data });
		return data;
	} catch (e) {
		// built without google-services.json (README: push in the mobile app), or offline
		console.warn('push: no device token', e);
		setState({ unavailable: true });
		return null;
	}
}

/** Asks for the permission from the settings; whether it is granted now. */
export async function requestPushPermission() {
	await createChannels();
	const permission = await Notifications.requestPermissionsAsync();
	if (permission.granted && !state.token) {
		const token = await deviceToken(false);
		if (token) setState({ token });
	}
	return permission;
}

/** Registers the phone for push and opens the notifications tapped. Mounted once, in the layout. */
export function PushNotifications() {
	const { ready, me, server, accounts, current, actAs } = useSession();
	const signedIn = !!me;
	const { enabled, token } = usePushState();
	// server, account token and device token already registered, or unregistered when turned off
	const registered = useRef(new Set<string>());
	const unregistered = useRef(new Set<string>());

	const pathname = usePathname();
	useEffect(() => {
		currentPath = pathname;
	}, [pathname]);
	useEffect(() => {
		currentProfile = me?.user.username ?? '';
	}, [me]);

	useEffect(() => {
		if (!pushSupported || !ready || !signedIn || enabled === null) return;
		let cancelled = false;
		deviceToken(enabled).then((t) => !cancelled && t && setState({ token: t }));
		const sub = Notifications.addPushTokenListener((t) => {
			if (typeof t.data === 'string') setState({ token: t.data });
		});
		return () => {
			cancelled = true;
			sub.remove();
		};
	}, [ready, signedIn, enabled]);

	// every account signed in here, including the ones added later. Turned off, the phone is
	// unregistered from each once per run, which also retries one that failed last time
	useEffect(() => {
		if (!token || enabled === null) return;
		const [done, undone] = enabled
			? [registered.current, unregistered.current]
			: [unregistered.current, registered.current];
		for (const account of accounts) {
			const key = `${server} ${account.token} ${token}`;
			if (done.has(key)) continue;
			done.add(key);
			undone.delete(key);
			api('push/devices', {
				method: enabled ? 'POST' : 'DELETE',
				server,
				token: account.token,
				body: enabled ? { platform: 'android', token } : { token }
			}).catch(() => done.delete(key));
		}
	}, [token, enabled, server, accounts]);

	// a tapped notification, also the one that started the app
	const response = Notifications.useLastNotificationResponse();
	const handled = useRef<string | null>(null);
	useEffect(() => {
		if (!response || !ready || !signedIn) return;
		if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
		const id = `${response.notification.request.identifier}:${response.notification.date}`;
		if (handled.current === id) return;
		handled.current = id;
		Notifications.clearLastNotificationResponseAsync().catch(() => {});
		const data = (response.notification.request.content.data ?? {}) as PushData;
		(async () => {
			// for another profile signed in here: switch to it first, trying the account in use first
			if (data.profile && data.profile !== me?.user.username) {
				const order = [current, ...accounts.map((_, i) => i).filter((i) => i !== current)];
				for (const index of order) {
					try {
						await actAs(index, data.profile);
						break;
					} catch {
						// not a profile of this account
					}
				}
			}
			if (!data.url) return;
			const path = appPath(data.url);
			// pages the app doesn't have open on the website
			if (path) router.push(path);
			else WebBrowser.openBrowserAsync(server + data.url).catch(() => {});
		})();
	}, [response, ready, signedIn, me, accounts, current, actAs, server]);

	return null;
}
