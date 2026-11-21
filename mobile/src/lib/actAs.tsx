import { useLocalSearchParams } from 'expo-router';
import { createContext, useCallback, useContext } from 'react';
import { useSession } from './session';

// The context profile of a screen: it is shown as another profile of the account than the one in
// use (an `as` route param, like the web's ?as=). Its loads send X-Act-As, its links carry the
// param on and its actions are that profile's.

const Context = createContext<string | null>(null);

/** Wrap a screen's content in it so the cards and links inside know the context profile. */
export const ActingAsProvider = Context.Provider;

/** The username the screen is shown as (null: the profile in use). */
export const useActingAs = () => useContext(Context);

const clean = (as: string | string[] | undefined) =>
	(Array.isArray(as) ? as[0] : as)?.replace(/^@/, '').toLowerCase() || null;

/**
 * The `as` param of the screen, null when it is the profile in use (then the screen is just
 * shown as it). Whether it is a profile of the account is the bar's business (ViewingAsBar).
 */
export function useAsParam(): string | null {
	const { as } = useLocalSearchParams<{ as?: string }>();
	const { me } = useSession();
	const name = clean(as);
	return name && name !== me?.user.username ? name : null;
}

/** `href` (an app path) in the context of the profile `as`; unchanged without one. */
export function withAs(href: string, as: string | null | undefined) {
	if (!as || !href.startsWith('/')) return href;
	const hash = href.indexOf('#');
	const [path, fragment] = hash < 0 ? [href, ''] : [href.slice(0, hash), href.slice(hash)];
	if (/[?&]as=/.test(path)) return href;
	return `${path}${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(as)}${fragment}`;
}

/** A function adding the screen's context profile to the links it opens. */
export function useAsHref() {
	const as = useActingAs();
	return useCallback((href: string) => withAs(href, as), [as]);
}
