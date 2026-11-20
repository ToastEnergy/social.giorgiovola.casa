import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { loadAccountProfiles, useKnownProfiles } from './profilesStore';
import { useSession } from './session';

/**
 * The profiles of the account in use (its own, the identities it owns and the ones shared with
 * it), reloaded each time the screen is focused. Empty until loaded.
 */
export function useAccountProfiles() {
	const { profileKey } = useSession();
	const known = useKnownProfiles();
	useFocusEffect(
		useCallback(() => {
			if (!profileKey) return;
			loadAccountProfiles().catch(() => {});
		}, [profileKey])
	);
	return known;
}
