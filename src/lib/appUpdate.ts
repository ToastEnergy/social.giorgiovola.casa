import { version } from '$app/env';
import { page, updated } from '$app/state';
import { onRealtime } from './realtime.js';

// After a deploy, open pages still run the old build. SvelteKit notices a new one by itself (a
// poll, the tab coming back, server responses) and sets `updated.current`, and NavHistory.svelte
// then turns the next navigation into a full page load. This adds the realtime stream as a faster
// signal (the server sends its version whenever a stream connects, and every deploy reconnects
// them), and reloads a page that's out of sight when nothing would be lost, so an installed app
// resumed after a deploy doesn't go on running old code.

// hidden this long, coming back may reload: the page is about to refresh what it shows anyway
const AWAY_MS = 60_000;

let hiddenAt: number | null = null;

/** Nothing would be lost by reloading: no overlay open, nothing typed. */
function idle() {
	if (page.state.overlays?.length) return false;
	const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
		'textarea, input:not([type]), input[type="text"], input[type="search"]'
	);
	for (const field of fields) if (field.value.trim()) return false;
	return !document.querySelector('[contenteditable="true"]:not(:empty)');
}

async function reloadIfOutdated() {
	if ((await updated.check()) && idle()) location.reload();
}

function onVisibility() {
	if (document.visibilityState === 'hidden') {
		hiddenAt = Date.now();
		return;
	}
	const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
	hiddenAt = null;
	if (away >= AWAY_MS) void reloadIfOutdated();
}

/** Starts watching for new builds; returns the function that stops it. */
export function watchAppUpdates() {
	const offVersion = onRealtime('version', (data) => {
		if (data.version === version) return;
		// confirmed against /_app/version.json, which also sets `updated.current`
		if (document.visibilityState === 'hidden') void reloadIfOutdated();
		else void updated.check();
	});
	document.addEventListener('visibilitychange', onVisibility);
	return () => {
		offVersion();
		document.removeEventListener('visibilitychange', onVisibility);
	};
}
