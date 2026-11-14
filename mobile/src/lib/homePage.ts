import { useSyncExternalStore } from 'react';

/**
 * Home and Messages are two pages of one pager on the home tab (HomePager), like Instagram's
 * feed and messages: this is which one shows, shared with the tab bar (icons, tab presses) and
 * the /messages route, which only opens the second page.
 */
export type HomePage = 0 | 1;

type State = { page: HomePage; animate: boolean; focused: boolean };

let state: State = { page: 0, animate: false, focused: false };
const listeners = new Set<() => void>();

function emit(next: State) {
	state = next;
	listeners.forEach((listener) => listener());
}

export function subscribeHomePage(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** shows a page; `animate` slides over to it, otherwise it's just there (the tab isn't shown) */
export function setHomePage(page: HomePage, animate: boolean) {
	if (page !== state.page) emit({ ...state, page, animate });
}

export function setHomeFocused(focused: boolean) {
	if (focused !== state.focused) emit({ ...state, focused });
}

export function getHomePage() {
	return state;
}

export function useHomePage() {
	return useSyncExternalStore(subscribeHomePage, getHomePage);
}

/** only the page, so a component doesn't re-render when the tab is focused or left */
export function useHomePageNumber() {
	return useSyncExternalStore(subscribeHomePage, () => state.page);
}
