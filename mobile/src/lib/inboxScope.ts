import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

// whether the notifications tab and its badge cover all the profiles of the account (the default)
// or only the profile in use. a preference of this phone, like the website's cookie

const KEY = 'inbox_scope';
let all = true;
const listeners = new Set<() => void>();

SecureStore.getItemAsync(KEY)
	.then((saved) => {
		if (saved === 'own') set(false);
	})
	.catch(() => {});

function set(value: boolean) {
	all = value;
	for (const listener of listeners) listener();
}

export function setInboxAll(value: boolean) {
	set(value);
	SecureStore.setItemAsync(KEY, value ? 'all' : 'own').catch(() => {});
}

/** true: the inbox of every profile of the account; false: the profile in use only */
export const useInboxAll = () =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => all
	);
