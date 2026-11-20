import type { Notification } from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { api, auth } from './api';
import { useBus } from './bus';
import { Notifications } from './push';
import { useSession } from './session';
import type { SwitcherAccount } from './types';

/**
 * Takes notifications that were read (here, on the website, on another phone) out of the tray:
 * lists the ones presented, asks POST /notifications/stale which tags have nothing unread left
 * and dismisses those. Every failure leaves the tray as it is.
 */

/** a run at most this often, unless something was just read */
const EVERY_MS = 15_000;
const AFTER_READ_MS = 2_000;
const OWNERS_MS = 5 * 60_000;

let lastRun = 0;
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let timerAt = 0;

// the tokens of every account signed in here, set by <TrayCleaner />
let tokens: string[] = [];
// which account token can use each profile (username), from the switcher data of each token
let owners = new Map<string, string>();
let ownersFor = '';
let ownersAt = 0;

async function loadOwners() {
	const key = tokens.join();
	if (key === ownersFor && Date.now() - ownersAt < OWNERS_MS) return;
	const next = new Map<string, string>();
	await Promise.all(
		tokens.map(async (token) => {
			try {
				const res = await api<{ items: SwitcherAccount[] }>('auth/accounts', { token });
				for (const account of res.items) {
					// the account itself and its identities
					for (const profile of [account, ...account.identities])
						if (!next.has(profile.username) || token === auth.token)
							next.set(profile.username, token);
				}
			} catch {
				// unknown profiles fall back to the account in use
			}
		})
	);
	owners = next;
	ownersFor = key;
	ownersAt = Date.now();
}

/**
 * the tag the server gave a push (see src/lib/server/fcm.ts): in the content's data (newer
 * servers), else in the FCM message expo keeps
 */
function tagOf(n: Notification): string | null {
	const trigger = n.request.trigger;
	const message = trigger && 'remoteMessage' in trigger ? trigger.remoteMessage : undefined;
	const tag = n.request.content.data?.tag ?? message?.data?.tag ?? message?.notification?.tag;
	return typeof tag === 'string' && tag ? tag : null;
}

const chunks = <T,>(list: T[], size: number) =>
	Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
		list.slice(i * size, (i + 1) * size)
	);

async function run() {
	if (!Notifications || !auth.token) return;
	const permission = await Notifications.getPermissionsAsync();
	if (!permission.granted) return;
	const presented = await Notifications.getPresentedNotificationsAsync();
	const shown = presented
		.map((n) => ({
			id: n.request.identifier,
			tag: tagOf(n),
			profile: (n.request.content.data as { profile?: unknown } | undefined)?.profile
		}))
		.filter((n): n is { id: string; tag: string; profile: string | undefined } => !!n.tag)
		.map((n) => ({ ...n, profile: typeof n.profile === 'string' ? n.profile : undefined }));
	if (!shown.length) return;
	await loadOwners();
	// each account is asked about the tags of its own profiles
	const byToken = new Map<string, typeof shown>();
	for (const n of shown) {
		const token = (n.profile && owners.get(n.profile)) || auth.token;
		byToken.set(token, [...(byToken.get(token) ?? []), n]);
	}
	for (const [token, list] of byToken) {
		for (const part of chunks([...new Set(list.map((n) => n.tag))], 100)) {
			let stale: string[];
			try {
				const res = await api<{ stale?: string[] }>('notifications/stale', {
					method: 'POST',
					token,
					body: { tags: part }
				});
				stale = res.stale ?? [];
			} catch {
				continue;
			}
			const gone = new Set(stale);
			await Promise.all(
				list
					.filter((n) => gone.has(n.tag))
					.map((n) => Notifications!.dismissNotificationAsync(n.id).catch(() => {}))
			);
		}
	}
}

async function runOnce() {
	if (running) {
		again = true;
		return;
	}
	running = true;
	lastRun = Date.now();
	try {
		await run();
	} catch {
		// not supported, no permission or offline: the tray stays as it is
	} finally {
		running = false;
		if (again) {
			again = false;
			request('read');
		}
	}
}

/**
 * Asks for a run: after something was read (`read`, soon) or whenever the app comes back or a
 * count dropped elsewhere (`check`, at most every 15 s). A run that is too early waits its turn
 * instead of being dropped.
 */
export function clearTray(why: 'read' | 'check' = 'check') {
	request(why);
}

function request(why: 'read' | 'check') {
	if (!Notifications) return;
	const at = lastRun + (why === 'read' ? AFTER_READ_MS : EVERY_MS);
	const now = Date.now();
	if (at <= now) {
		clearTimeout(timer);
		timer = undefined;
		void runOnce();
		return;
	}
	if (timer && timerAt <= at) return;
	clearTimeout(timer);
	timerAt = at;
	timer = setTimeout(() => {
		timer = undefined;
		void runOnce();
	}, at - now);
}

/** Clears the tray on start, on coming back to the app and when a count drops. Mounted once. */
export function TrayCleaner() {
	const { ready, me, accounts } = useSession();
	const signedIn = !!me;
	tokens = accounts.map((a) => a.token);

	useEffect(() => {
		if (!Notifications || !ready || !signedIn) return;
		clearTray();
		const sub = AppState.addEventListener('change', (state) => {
			if (state === 'active') clearTray();
		});
		return () => sub.remove();
	}, [ready, signedIn]);

	// a count that goes down was read somewhere: here, on the website or another phone
	useBus('inbox', (e: { profile: string; count: number }) => dropped(`i:${e.profile}`, e.count));
	useBus('notifications', (e: { count: number }) => dropped('n', e.count));
	useBus('messages_unread', (e: { count: number; reactions?: number }) =>
		dropped('m', e.count + (e.reactions ?? 0))
	);
	return null;
}

const counts = new Map<string, number>();
function dropped(key: string, count: number) {
	const before = counts.get(key);
	counts.set(key, count);
	if (before !== undefined && count < before) clearTray('read');
}
