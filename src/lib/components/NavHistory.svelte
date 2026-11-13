<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate, onNavigate, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import { user } from '#lib/store.js';
	import { homeItem, isActive, navItems } from '#lib/nav.js';
	import { leaveOverlays, motion, noteEntry, trackSections } from '#lib/history.svelte.js';
	import {
		clearBackCache,
		endTraversal,
		installBackCache,
		startTraversal
	} from '#lib/backCache.js';

	// the app's history behaviour (#lib/history.svelte.ts), mounted once in the root layout

	const sections = [homeItem, ...navItems].map((item) => item.href);

	onMount(installBackCache);

	// another profile's pages must not come back from the cache
	let userId = $user?.id ?? null;
	$effect(() => {
		const id = $user?.id ?? null;
		if (id !== userId) clearBackCache();
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
		if (nav.type === 'enter') noteEntry();
		trackSections(
			sections.filter((href) => isActive(page.url.pathname, href)),
			nav
		);
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
		const tab = motion.tab;
		motion.tab = false;
		if (!document.startViewTransition || nav.shallow || nav.willUnload) return;
		if (!nav.from || !nav.to || tab) return;
		if (!matchMedia('(pointer: coarse)').matches) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		if (nav.type === 'popstate' && browserAnimated) return;
		// a tab or filter of the same page swaps in place
		if (nav.from.url.pathname === nav.to.url.pathname) return;

		const back = motion.up || (nav.type === 'popstate' && nav.delta < 0);
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
