import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { SwitcherProfile } from './types';

// the profiles of the account in use, shared by every screen: the pickers on posts and buttons
// read it without each asking the server. The session loads it when the profile in use changes
// and screens that show it reload it when focused (useAccountProfiles).
let profiles: SwitcherProfile[] = [];
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

function set(next: SwitcherProfile[]) {
	profiles = next;
	for (const listener of listeners) listener();
}

/** Fetches the account's profiles (its own, its identities and the ones shared with it). */
export async function loadAccountProfiles(): Promise<SwitcherProfile[]> {
	const res = await api<{ items: (SwitcherProfile & { identities: SwitcherProfile[] })[] }>(
		'auth/accounts'
	);
	const account = res.items[0];
	const next = account ? [account, ...account.identities] : [];
	set(next);
	return next;
}

/** The profiles as last loaded, for code outside components. */
export const knownProfiles = () => profiles;

/** Forgets them (signed out, another account): they belong to one account. */
export const clearAccountProfiles = () => set([]);

/** The profiles as last loaded; empty until then. Never fetches. */
export const useKnownProfiles = () =>
	useSyncExternalStore(
		subscribe,
		() => profiles,
		() => profiles
	);
