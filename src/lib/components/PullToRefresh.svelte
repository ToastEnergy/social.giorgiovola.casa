<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { page } from '$app/state';

	// the installed app has no browser around it to pull down and reload: the lists that change
	// by themselves (feeds, notifications, the conversation list) reload when pulled from the top.
	// not forms (settings would lose what's typed) or chats (they scroll by themselves)
	const PAGES = new Set([
		'/',
		'/@[username]',
		'/@[username]/[post]',
		'/hashtag/[tag]',
		'/notifications',
		'/messages',
		'/search'
	]);
	// how far to pull, in px, before letting go reloads
	const THRESHOLD = 70;
	const MAX = 110;

	let pull = $state(0);
	let refreshing = $state(false);
	// a finger is on it: follow without easing
	let dragging = $state(false);

	onMount(() => {
		const standalone = matchMedia('(display-mode: standalone)');
		const coarse = matchMedia('(pointer: coarse)');
		let startX = 0;
		let startY = 0;
		// null: not decided yet, false: a scroll or sideways swipe, not a pull
		let pulling: boolean | null = false;

		const blocked = (target: EventTarget | null) =>
			// an overlay is up (it locks the page's scroll), or the finger is in a field
			document.body.style.overflow === 'hidden' ||
			(target instanceof Element && !!target.closest('dialog, input, textarea, [contenteditable]'));

		const onstart = (e: TouchEvent) => {
			pulling = false;
			if (!standalone.matches || !coarse.matches || refreshing || e.touches.length !== 1) return;
			if (!PAGES.has(page.route.id ?? '') || scrollY > 0 || blocked(e.target)) return;
			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
			pulling = null;
		};

		const onmove = (e: TouchEvent) => {
			if (pulling === false) return;
			const dx = e.touches[0].clientX - startX;
			const dy = e.touches[0].clientY - startY;
			if (pulling === null) {
				if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
				// only straight down from the very top
				pulling = dy > 0 && dy > Math.abs(dx) && scrollY <= 0;
				if (!pulling) return;
				dragging = true;
			}
			// resists more the further it goes
			pull = Math.min(MAX, Math.max(0, dy) * 0.5);
		};

		const onend = async () => {
			if (!pulling) return;
			pulling = false;
			dragging = false;
			const go = pull >= THRESHOLD * 0.9;
			if (!go) {
				pull = 0;
				return;
			}
			navigator.vibrate?.(10);
			refreshing = true;
			pull = THRESHOLD * 0.7;
			try {
				await refreshAll();
			} finally {
				refreshing = false;
				pull = 0;
			}
		};

		addEventListener('touchstart', onstart, { passive: true });
		addEventListener('touchmove', onmove, { passive: true });
		addEventListener('touchend', onend);
		addEventListener('touchcancel', onend);
		return () => {
			removeEventListener('touchstart', onstart);
			removeEventListener('touchmove', onmove);
			removeEventListener('touchend', onend);
			removeEventListener('touchcancel', onend);
		};
	});
</script>

{#if pull > 0 || refreshing}
	<div
		class="pointer-events-none fixed top-[env(safe-area-inset-top)] left-1/2 z-1000 flex size-9 items-center justify-center rounded-full border border-accent bg-background text-accent {dragging
			? ''
			: 'transition-transform duration-200'}"
		style:transform="translate(-50%, {pull - 30}px)"
		style:opacity={Math.min(1, pull / THRESHOLD)}
		role="status"
		aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}
	>
		<span
			class="flex {refreshing ? 'animate-spin' : ''}"
			style:transform={refreshing ? undefined : `rotate(${pull * 4}deg)`}
		>
			<RefreshCw size={18} strokeWidth={2.5} />
		</span>
	</div>
{/if}
