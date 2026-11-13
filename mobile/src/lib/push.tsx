import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api } from './api';
import { useSession } from './session';
import { colors } from './theme';

/**
 * Push notifications (Android only for now): the phone's FCM token is registered with
 * POST /push/devices for every account signed in here, and the server sends the same
 * notifications as to a browser. Logging out deletes the token's session, which stops them.
 */

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

/** The channels the server sends to (channelId), so each can be silenced in Android's settings. */
async function createChannels() {
	await Notifications.setNotificationChannelAsync('messages', {
		name: 'Messages',
		description: 'Direct and group messages',
		importance: Notifications.AndroidImportance.HIGH,
		lightColor: colors.accent
	});
	await Notifications.setNotificationChannelAsync('activity', {
		name: 'Activity',
		description: 'Likes, replies, mentions, follows and the rest of your notifications',
		importance: Notifications.AndroidImportance.DEFAULT,
		lightColor: colors.accent
	});
}

/** The FCM token, after asking for the permission once. Null without permission or Firebase. */
async function deviceToken(): Promise<string | null> {
	// Android 13+ only asks for the permission once a channel exists
	await createChannels();
	let permission = await Notifications.getPermissionsAsync();
	if (!permission.granted && permission.canAskAgain)
		permission = await Notifications.requestPermissionsAsync();
	if (!permission.granted) return null;
	try {
		const token = await Notifications.getDevicePushTokenAsync();
		return typeof token.data === 'string' ? token.data : null;
	} catch (e) {
		// built without google-services.json (README: push in the mobile app), or offline
		console.warn('push: no device token', e);
		return null;
	}
}

/** Registers the phone for push and opens the notifications tapped. Mounted once, in the layout. */
export function PushNotifications() {
	const { ready, me, server, accounts, current, actAs } = useSession();
	const signedIn = !!me;
	const [token, setToken] = useState<string | null>(null);
	// server, account token and device token already registered
	const registered = useRef(new Set<string>());

	const pathname = usePathname();
	useEffect(() => {
		currentPath = pathname;
	}, [pathname]);
	useEffect(() => {
		currentProfile = me?.user.username ?? '';
	}, [me]);

	useEffect(() => {
		if (Platform.OS !== 'android' || !ready || !signedIn) return;
		let cancelled = false;
		deviceToken().then((t) => !cancelled && setToken(t));
		const sub = Notifications.addPushTokenListener((t) => {
			if (typeof t.data === 'string') setToken(t.data);
		});
		return () => {
			cancelled = true;
			sub.remove();
		};
	}, [ready, signedIn]);

	// every account signed in here, including the ones added later
	useEffect(() => {
		if (!token) return;
		for (const account of accounts) {
			const key = `${server} ${account.token} ${token}`;
			if (registered.current.has(key)) continue;
			registered.current.add(key);
			api('push/devices', {
				method: 'POST',
				server,
				token: account.token,
				body: { platform: 'android', token }
			}).catch(() => registered.current.delete(key));
		}
	}, [token, server, accounts]);

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
			// pages the app doesn't have yet (invites) open on the website
			if (path) router.push(path);
			else WebBrowser.openBrowserAsync(server + data.url).catch(() => {});
		})();
	}, [response, ready, signedIn, me, accounts, current, actAs, server]);

	return null;
}
