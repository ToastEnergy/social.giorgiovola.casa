<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate, onNavigate, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import { user } from '#lib/store.js';
	import { isActive } from '#lib/nav.js';
	import { leaveOverlays, motion, trackSections } from '#lib/history.svelte.js';
	import { clearPageCache, endTraversal, startTraversal } from '#lib/pageCache.js';

	// the app's history behaviour (#lib/history.svelte.ts), mounted once in the root layout

	// the sections in the bottom bar's order, left to right (settings is in the profile menu, last)
	const sections = ['/', '/messages', '/notifications', '/settings'];
	const sectionOf = (url: URL) => sections.findIndex((href) => isActive(url.pathname, href));

	// another profile's pages must not come back from the cache
	let userId = $user?.id ?? null;
	$effect(() => {
		const id = $user?.id ?? null;
		if (id !== userId) clearPageCache();
		userId = id;
	});

	beforeNavigate((nav) => {
		if (nav.shallow) return;
		leaveOverlays(nav);
		if (nav.type !== 'popstate') return;
		startTraversal();
		// a page shown from the cache refreshes behind the scenes once it's up
		nav.complete.then(
			() => {
				if (endTraversal()) refreshAll();
			},
			() => endTraversal()
		);
	});

	afterNavigate((nav) => {
		if (nav.shallow) return;
		trackSections(sections.filter((href) => isActive(page.url.pathname, href)));
	});

	// ---- page transitions (touch devices): pages slide in like a native stack

	// the browser already animated a swipe back (Safari): a second slide would play it twice
	let browserAnimated = false;
	onMount(() => {
		const onpopstate = (e: PopStateEvent) => {
			browserAnimated = !!(e as PopStateEvent & { hasUAVisualTransition?: boolean })
				.hasUAVisualTransition;
		};
		addEventListener('popstate', onpopstate);
		return () => removeEventListener('popstate', onpopstate);
	});

	onNavigate((nav) => {
		if (!document.startViewTransition || nav.shallow || nav.willUnload) return;
		if (!nav.from || !nav.to) return;
		if (!matchMedia('(pointer: coarse)').matches) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		if (nav.type === 'popstate' && browserAnimated) return;
		// a tab or filter of the same page swaps in place
		if (nav.from.url.pathname === nav.to.url.pathname) return;

		// between sections (feed → messages) the bar's order decides: a section to the right slides in
		// like an opened page, one to the left like a back, however it was reached
		const from = sectionOf(nav.from.url);
		const to = sectionOf(nav.to.url);
		const back =
			from >= 0 && to >= 0 && from !== to
				? to < from
				: motion.up || (nav.type === 'popstate' && nav.delta < 0);
		const root = document.documentElement;
		root.dataset.nav = back ? 'back' : 'forward';
		return new Promise((resolve) => {
			const transition = document.startViewTransition(async () => {
				resolve();
				await nav.complete;
			});
			transition.finished.finally(() => delete root.dataset.nav);
		});
	});
</script>
