import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { api } from './api';
import { useSession } from './session';
import type { SwitcherProfile } from './types';

/**
 * The profiles of the account in use (its own, the identities it owns and the ones shared with
 * it), from the switcher's data, reloaded each time the screen is focused. Empty until loaded.
 */
export function useAccountProfiles() {
	const { profileKey } = useSession();
	const [profiles, setProfiles] = useState<SwitcherProfile[]>([]);
	useFocusEffect(
		useCallback(() => {
			if (!profileKey) return;
			let stale = false;
			api<{ items: (SwitcherProfile & { identities: SwitcherProfile[] })[] }>('auth/accounts')
				.then((res) => {
					const account = res.items[0];
					if (!stale && account) setProfiles([account, ...account.identities]);
				})
				.catch(() => {});
			return () => {
				stale = true;
			};
		}, [profileKey])
	);
	return profiles;
}
