<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { connection } from '#lib/connection.svelte.js';

	type Shown = 'reconnecting' | 'offline' | 'refreshing' | 'done';

	const LOST_AFTER_MS = 2000;
	const REFRESHING_AFTER_MS = 500;
	const DONE_FOR_MS = 2000;

	let shown = $state<Shown | null>(null);

	// a blip (or the quick reconnect when coming back to the page) shows nothing: the pill only
	// appears once the stream has been down for a moment, and then follows it until it's back
	// and the page is up to date again
	$effect(() => {
		const state = connection.state;
		const visible = untrack(() => shown) !== null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const show = (next: Shown, after: number) => {
			if (visible) shown = next;
			else timer = setTimeout(() => (shown = next), after);
		};
		if (state === 'reconnecting' || state === 'offline') show(state, LOST_AFTER_MS);
		else if (state === 'refreshing') show('refreshing', REFRESHING_AFTER_MS);
		else if (state === 'open' && visible) {
			shown = 'done';
			timer = setTimeout(() => (shown = null), DONE_FOR_MS);
		} else shown = null;
		return () => clearTimeout(timer);
	});

	const text: Record<Shown, string> = {
		reconnecting: 'Connection lost. Reconnecting…',
		offline: "You're offline. New posts and messages will show up when you're back.",
		refreshing: 'Back online. Updating…',
		done: 'Up to date'
	};
</script>

<!-- the live region stays mounted so screen readers announce each change -->
<div
	class="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+10px)] left-1/2 z-1001 flex w-max max-w-[calc(100vw-20px)] -translate-x-1/2 justify-center"
	role="status"
	aria-live="polite"
>
	{#if shown}
		<div
			class="flex items-center gap-2.5 rounded-full border border-accent bg-background px-2.5 py-[5px] text-[0.85em]"
			transition:fade={{ duration: 150 }}
		>
			<!-- an svg dot, not an empty span: Prettier 2 self-closes those, which Svelte 5 rejects -->
			<svg
				viewBox="0 0 8 8"
				class={`size-2 shrink-0 ${
					shown === 'reconnecting' || shown === 'offline' ? 'fill-danger' : 'fill-accent'
				} ${shown === 'reconnecting' || shown === 'refreshing' ? 'animate-pulse' : ''}`}
				aria-hidden="true"><circle cx="4" cy="4" r="4" /></svg
			>
			{text[shown]}
		</div>
	{/if}
</div>
