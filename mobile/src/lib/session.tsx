import * as SecureStore from 'expo-secure-store';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState
} from 'react';
import { AppState } from 'react-native';
import { api, auth, setUnauthorizedHandler } from './api';
import { emit, useBus } from './bus';
import { startStream, stopStream } from './realtime';
import type { Instance, LoginResult, Me } from './types';

/** the instance the login screen starts with; any other can be typed there */
export const DEFAULT_SERVER = (
	process.env.EXPO_PUBLIC_SERVER_URL || 'https://social.giorgiovola.casa'
).replace(/\/+$/, '');

const KEY = 'session';

/** an account signed in on this device. `username` is the account's, for the switcher */
export type StoredAccount = { token: string; username: string };
type Stored = { server: string; accounts: StoredAccount[]; current: number };

/** a profile in use on this device: `account` is the signed-in account's username */
type ProfileRef = { account: string; profile: string };
const RECENT_KEY = 'recent_profiles';

type SessionValue = {
	/** false until the stored session was read (and /me answered) */
	ready: boolean;
	server: string;
	me: Me | null;
	instance: Instance | null;
	accounts: StoredAccount[];
	current: number;
	/** changes whenever the profile in use does: screens reload on it */
	profileKey: string;
	unread: { notifications: number; messages: number };
	setUnread: (unread: Partial<SessionValue['unread']>) => void;
	signIn: (server: string, result: LoginResult) => Promise<void>;
	/** signs out the account in use (or the one at `index`) */
	signOut: (index?: number) => Promise<void>;
	selectAccount: (index: number) => Promise<void>;
	/** POST /auth/switch: act as the account or one of its identities */
	switchProfile: (username: string) => Promise<void>;
	/** act as `username` (the account itself or one of its identities) with the account at `index` */
	actAs: (index: number, username: string) => Promise<void>;
	/** whether `switchBack` has somewhere to go */
	canSwitchBack: boolean;
	/** back to the profile used before this one (the double tap on the avatar); its username */
	switchBack: () => Promise<string | null>;
	reloadMe: () => Promise<void>;
	setMe: (me: Me) => void;
};

const Context = createContext<SessionValue | null>(null);

export function useSession() {
	const value = useContext(Context);
	if (!value) throw new Error('no session provider');
	return value;
}

const save = (stored: Stored) => SecureStore.setItemAsync(KEY, JSON.stringify(stored));

export function SessionProvider({ children }: { children: React.ReactNode }) {
	const [ready, setReady] = useState(false);
	const [stored, setStored] = useState<Stored>({
		server: DEFAULT_SERVER,
		accounts: [],
		current: 0
	});
	const [me, setMeState] = useState<Me | null>(null);
	const [instance, setInstance] = useState<Instance | null>(null);
	const [unread, setUnreadState] = useState({ notifications: 0, messages: 0 });
	const storedRef = useRef(stored);
	storedRef.current = stored;
	// the profile in use and the one before it, newest first
	const [recent, setRecent] = useState<ProfileRef[]>([]);
	const recentRef = useRef(recent);
	recentRef.current = recent;

	const setMe = useCallback((next: Me | null) => {
		setMeState(next);
		if (next)
			setUnreadState({
				notifications: next.unread.notifications,
				messages: next.unread.messages + next.unread.reactions
			});
	}, []);

	/** makes `next` the session: its current account's token is used from now on */
	const apply = useCallback(
		async (next: Stored, knownMe?: Me) => {
			const account = next.accounts[next.current] ?? null;
			auth.server = next.server;
			auth.token = account?.token ?? null;
			setStored(next);
			await save(next);
			if (!account) {
				setMe(null);
				stopStream();
				return;
			}
			if (knownMe) setMe(knownMe);
			else {
				try {
					setMe(await api<Me>('me'));
				} catch {
					// a 401 already removed the account (below); offline: stay signed in, without a profile
				}
			}
		},
		[setMe]
	);

	const drop = useCallback(
		(token: string) => {
			const now = storedRef.current;
			const accounts = now.accounts.filter((a) => a.token !== token);
			if (accounts.length === now.accounts.length) return;
			apply({ ...now, accounts, current: 0 });
		},
		[apply]
	);

	useEffect(() => {
		setUnauthorizedHandler(drop);
		(async () => {
			let initial: Stored | null = null;
			try {
				initial = JSON.parse((await SecureStore.getItemAsync(KEY)) ?? 'null');
			} catch {
				// unreadable: start signed out
			}
			try {
				const list = JSON.parse((await SecureStore.getItemAsync(RECENT_KEY)) ?? '[]');
				if (Array.isArray(list)) setRecent(list);
			} catch {
				// unreadable: nothing to switch back to yet
			}
			if (initial?.accounts?.length) await apply(initial);
			setReady(true);
		})();
	}, [apply, drop]);

	// the instance's limits, message of the day and GIF settings. with the token: a members-only
	// instance hides its message of the day from signed-out callers
	const token = stored.accounts[stored.current]?.token ?? null;
	useEffect(() => {
		if (!ready) return;
		api<Instance>('instance', { server: stored.server, token })
			.then(setInstance)
			.catch(() => {});
	}, [ready, stored.server, token]);

	// the stream follows the profile in use: reopened when it changes, closed in the background
	const profileKey = me ? `${stored.accounts[stored.current]?.token}:${me.user.username}` : '';
	useEffect(() => {
		if (!profileKey) return;
		startStream();
		const sub = AppState.addEventListener('change', (state) => {
			if (state === 'active') {
				startStream();
				emit('stream_open');
			} else stopStream();
		});
		return () => {
			sub.remove();
			stopStream();
		};
	}, [profileKey]);

	// notes each profile used, whichever way it was switched to (the menu, a login, settings)
	// both from /me, so an account change half applied doesn't count as a profile
	const inUse = me ? me.account?.username ?? me.user.username : undefined;
	const profileName = me?.user.username;
	useEffect(() => {
		if (!ready || !inUse || !profileName) return;
		const now = recentRef.current;
		if (now[0]?.account === inUse && now[0]?.profile === profileName) return;
		const next = [
			{ account: inUse, profile: profileName },
			...now.filter((r) => r.account !== inUse || r.profile !== profileName)
		].slice(0, 2);
		setRecent(next);
		SecureStore.setItemAsync(RECENT_KEY, JSON.stringify(next)).catch(() => {});
	}, [ready, inUse, profileName]);

	/** where switchBack goes: the profile before, else the account's own profile from an identity,
	 * else another signed-in account */
	const backTarget = useMemo(() => {
		if (!me) return null;
		const previous = recent
			.slice(1)
			.find((r) => stored.accounts.some((a) => a.username === r.account));
		if (previous)
			return {
				index: stored.accounts.findIndex((a) => a.username === previous.account),
				profile: previous.profile
			};
		if (me.user.identity && me.account)
			return { index: stored.current, profile: me.account.username };
		const other = stored.accounts.findIndex((_, i) => i !== stored.current);
		return other >= 0 ? { index: other, profile: stored.accounts[other].username } : null;
	}, [me, recent, stored]);

	const actAs = useCallback(
		async (index: number, username: string) => {
			const now = storedRef.current;
			const account = now.accounts[index];
			if (!account) throw new Error('That account is no longer signed in here');
			// a token keeps acting as the profile it last switched to
			const next = await api<Me>('auth/switch', {
				method: 'POST',
				token: account.token,
				body: { username }
			});
			if (index !== now.current) await apply({ ...now, current: index }, next);
			else setMe(next);
		},
		[apply, setMe]
	);

	useBus('notifications', (e: { count: number }) =>
		setUnreadState((u) => ({ ...u, notifications: e.count }))
	);
	useBus('messages_unread', (e: { count: number; reactions?: number }) =>
		setUnreadState((u) => ({ ...u, messages: e.count + (e.reactions ?? 0) }))
	);

	const value = useMemo<SessionValue>(
		() => ({
			ready,
			server: stored.server,
			me,
			instance,
			accounts: stored.accounts,
			current: stored.current,
			profileKey,
			unread,
			setUnread: (next) => setUnreadState((u) => ({ ...u, ...next })),
			signIn: async (server, result) => {
				const now = storedRef.current;
				// another instance replaces the accounts of the one before
				const kept = now.server === server ? now.accounts : [];
				const username = result.me.account?.username ?? result.me.user.username;
				const accounts = [
					...kept.filter((a) => a.username !== username),
					{ token: result.token, username }
				];
				await apply({ server, accounts, current: accounts.length - 1 }, result.me);
			},
			signOut: async (index) => {
				const now = storedRef.current;
				const account = now.accounts[index ?? now.current];
				if (!account) return;
				await api('auth/logout', { method: 'POST', token: account.token }).catch(() => {});
				const active = now.accounts[now.current];
				const accounts = now.accounts.filter((a) => a !== account);
				const current = Math.max(0, account === active ? 0 : accounts.indexOf(active));
				await apply({ ...now, accounts, current });
			},
			selectAccount: async (index) => {
				await apply({ ...storedRef.current, current: index });
			},
			switchProfile: async (username) => {
				setMe(await api<Me>('auth/switch', { method: 'POST', body: { username } }));
			},
			actAs,
			canSwitchBack: !!backTarget,
			switchBack: async () => {
				if (!backTarget) return null;
				await actAs(backTarget.index, backTarget.profile);
				return backTarget.profile;
			},
			reloadMe: async () => {
				if (auth.token) setMe(await api<Me>('me'));
			},
			setMe
		}),
		[ready, stored, me, instance, profileKey, unread, apply, setMe, actAs, backTarget]
	);

	return <Context.Provider value={value}>{children}</Context.Provider>;
}
