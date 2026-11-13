import { untrack } from 'svelte';
import { afterNavigate, goto } from '$app/navigation';
import { page } from '$app/state';

type AfterNavigate = Parameters<Parameters<typeof afterNavigate>[0]>[0];

/*
 * how the app moves through the browser's history, so back behaves like in a native app:
 * - the back arrows go back only to our own pages, and "up" (post → profile, chat → messages)
 *   when this page was opened directly (a shared link, a push notification)
 * - every open overlay (image viewer, composer, dialogs) holds one history entry, so the back
 *   button or gesture closes it instead of leaving the page
 * - the bottom bar returns to a section's entry in the history, so a tab comes back as it was left
 */

// ---- where we are in the history

// SvelteKit numbers its history entries (+1 per push, the same on a replace, kept across reloads).
// it's internal, so everything below falls back to "nothing to go back to" without it
function entryIndex(): number | null {
	try {
		const index = history.state?.['sveltekit:metadata']?.historyIndex;
		return typeof index === 'number' ? index : null;
	} catch {
		return null;
	}
}

// the entries where the app was opened (a typed url, a link from elsewhere, a reload of a fresh
// tab). pages before such an entry belong to whatever was open earlier in the tab
const ROOTS = 'nav:roots';

function readRoots(): number[] {
	try {
		const roots = JSON.parse(sessionStorage.getItem(ROOTS) ?? '[]');
		return Array.isArray(roots) ? roots.filter((r) => typeof r === 'number') : [];
	} catch {
		return [];
	}
}

function rootOf(index: number) {
	let root: number | null = null;
	for (const r of readRoots()) if (r <= index && (root === null || r > root)) root = r;
	return root;
}

function markRoot(index: number) {
	const roots = readRoots();
	if (roots.includes(index)) return;
	try {
		sessionStorage.setItem(ROOTS, JSON.stringify([...roots, index].slice(-20)));
	} catch {
		// private mode: every page counts as opened directly
	}
}

/** How many of our own pages (and open overlays) are behind this one. */
export function depth() {
	const index = entryIndex();
	if (index === null) return 0;
	const root = rootOf(index);
	return root === null ? 0 : index - root;
}

/** The page "up" from `url`: a post's author, a chat's list, a settings section's index. */
export function parentOf(url: { pathname: string }) {
	const parts = url.pathname.split('/').filter(Boolean);
	parts.pop();
	const parent = '/' + parts.join('/');
	// segments that aren't pages of their own
	if (parent === '/messages/groups') return '/messages';
	if (parent === '/hashtag') return '/';
	return parent;
}

/** how the next page change should animate: `up` slides like a back, `tab` doesn't slide */
export const motion = { up: false, tab: false };

/** Back to the previous page if it's ours, else up to `fallback` (the parent by default). */
export async function goBack(fallback?: string) {
	// an overlay closing on the way (a dialog that deleted the post) steps back first
	await overlaysClosed();
	if (depth() > 0) return history.back();
	motion.up = true;
	try {
		await goto(fallback ?? parentOf(page.url), { replace: true });
	} finally {
		motion.up = false;
	}
}

// resolves after the next popstate (once SvelteKit has handled it), or after `ms`
function nextPopstate(ms: number) {
	return new Promise<void>((resolve) => {
		const done = () => {
			removeEventListener('popstate', done);
			clearTimeout(timer);
			setTimeout(resolve);
		};
		const timer = setTimeout(done, ms);
		addEventListener('popstate', done);
	});
}

async function overlaysClosed() {
	if (!overlays().length) return;
	// one that is closing takes its entry away by itself
	await nextPopstate(300);
	const open = overlays().length;
	if (!open) return;
	history.go(-open);
	await nextPopstate(1000);
}

/** `afterNavigate` for real page changes, not an overlay's history entry. */
export function afterPageChange(fn: (nav: AfterNavigate) => void) {
	afterNavigate((nav) => {
		if (!nav.shallow) fn(nav);
	});
}

// ---- overlays

const overlays = () => page.state.overlays ?? [];

/**
 * Gives an overlay its own history entry while it's open: back closes it, and closing it by
 * other means (its close button, Escape) takes the entry away again. Call during component init.
 */
export function overlayEntry(name: string, isOpen: () => boolean, close: () => void) {
	// none: no entry. pushing: asked for, not there yet. in: page.state lists the overlay
	let entry: 'none' | 'pushing' | 'in' = 'none';

	$effect(() => {
		const open = isOpen();
		untrack(() => {
			if (open && entry === 'none') {
				entry = 'pushing';
				const index = entryIndex();
				if (index !== null) forgetAfter(index);
				goto(page.url.href, {
					shallow: true,
					state: { ...page.state, overlays: [...overlays(), name] }
				});
			} else if (!open && entry === 'in') {
				entry = 'none';
				leave(name);
			}
		});
	});

	$effect(() => {
		const listed = overlays().includes(name);
		untrack(() => {
			if (entry === 'pushing' && listed) {
				entry = 'in';
				// closed before its entry was made
				if (!isOpen()) {
					entry = 'none';
					leave(name);
				}
			} else if (entry === 'in' && !listed) {
				// back (or a navigation) took the entry away
				entry = 'none';
				close();
			}
		});
	});
}

// steps back over the overlay's entry and any opened above it
function leave(name: string) {
	const list = overlays();
	const at = list.lastIndexOf(name);
	if (at >= 0) history.go(at - list.length);
}

/**
 * Leaving the page from inside an overlay first steps back over the overlays' entries, so the
 * page behind is one back away from the new one, not one back per overlay.
 */
export function leaveOverlays(nav: {
	shallow: boolean;
	type: string;
	willUnload: boolean;
	to: { url: URL } | null;
	cancel: () => void;
}) {
	const open = overlays().length;
	if (!open || leaving || nav.shallow || nav.willUnload || !nav.to) return;
	if (nav.type !== 'link' && nav.type !== 'goto') return;
	const target = nav.to.url;
	nav.cancel();
	leaving = true;
	// page.state may still list the overlays when the navigation starts: `leaving` lets it through
	nextPopstate(1000)
		.then(() => goto(target))
		.finally(() => (leaving = false));
	history.go(-open);
}

let leaving = false;

// ---- sections of the bottom bar

// the history entry each section was last seen at, to step back (or forward) to it
const sectionEntries = new Map<string, { index: number; url: string }>();

/** Remembers that the current page (a new history entry or not) belongs to `section`. */
export function trackSections(sections: string[], nav: AfterNavigate) {
	const index = entryIndex();
	if (index === null) return;
	// a new entry drops the ones after it from the browser's history: forget them too
	if (nav.type !== 'popstate' && nav.type !== 'enter')
		for (const [key, entry] of sectionEntries) if (entry.index >= index) sectionEntries.delete(key);
	const url = page.url.pathname + page.url.search;
	for (const section of sections) sectionEntries.set(section, { index, url });
}

// an overlay's entry replaces any forward history too
function forgetAfter(index: number) {
	for (const [key, entry] of sectionEntries) if (entry.index > index) sectionEntries.delete(key);
}

/**
 * Returns to where `section` was left: through the history when its entry is still there, so the
 * page comes back with its scroll and loaded posts. Returns false when there is nothing to return to.
 */
export function returnToSection(section: string) {
	const entry = sectionEntries.get(section);
	const index = entryIndex();
	if (!entry || index === null || entry.index === index) return false;
	const root = rootOf(index);
	if (root === null || entry.index < root || rootOf(entry.index) !== root) return false;
	history.go(entry.index - index);
	return true;
}

// ---- roots

/** Call on the app's first navigation: a freshly opened page starts a new stack. */
export function noteEntry() {
	const index = entryIndex();
	if (index === null) return;
	const type = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type;
	// a reload or back/forward into the app keeps the stack it had; a new document is a new root
	if (type === 'navigate' || type === undefined || rootOf(index) === null) markRoot(index);
}
