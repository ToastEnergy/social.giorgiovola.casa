import type { NativeIntent } from 'expo-router';

/**
 * Invite links (https://<instance>/register?invite=…) open the app as universal / app links
 * (ios.associatedDomains and android.intentFilters in app.json). The register screen also needs to
 * know which instance the invite is for, so the link's origin becomes its `server` param.
 */
export const redirectSystemPath: NativeIntent['redirectSystemPath'] = ({ path }) => {
	try {
		const url = new URL(path);
		if (url.protocol !== 'https:' || url.pathname.replace(/\/+$/, '') !== '/register') return path;
		const params = new URLSearchParams({ server: url.origin });
		const invite = url.searchParams.get('invite');
		if (invite) params.set('invite', invite);
		return `/register?${params}`;
	} catch {
		// not a full URL (an in-app path or a social:// link): routed as it is
		return path;
	}
};
