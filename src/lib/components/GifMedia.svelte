<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import type { Gif } from '#lib/types.js';

	type Props = {
		gif: Gif;
		/** the tallest it may get, in px */
		maxHeight?: number;
		/** the widest it may get (a CSS length) */
		maxWidth?: string;
		/** layout only */
		class?: string;
		/** a tap plays or pauses it; off, the tap goes to what's under it (a post in a list) */
		toggleable?: boolean;
	};

	let {
		gif,
		maxHeight = 500,
		maxWidth = '100%',
		class: className = '',
		toggleable = true
	}: Props = $props();

	// loaded straight from KLIPY (its terms): it never touches our server. The page's referrer
	// policy only lets KLIPY see this instance's origin, not which page it is on.

	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');

	let video: HTMLVideoElement | undefined = $state();
	let visible = $state(false);
	let failed = $state(false);
	/** the viewer paused it (or started it, with reduced motion) */
	let toggled = $state(false);
	let paused = $state(true);

	const shouldPlay = $derived(visible && reducedMotion.current === toggled);
	const width = $derived(
		`min(${maxWidth}, ${gif.width}px, ${(maxHeight * gif.width) / gif.height}px)`
	);

	// only plays while on screen: a feed of looping videos would keep every one decoding
	$effect(() => {
		if (!video) return;
		const observer = new IntersectionObserver((entries) => {
			visible = entries.some((e) => e.isIntersecting);
		});
		observer.observe(video);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!video || failed) return;
		// refused autoplay (iOS low power mode) leaves the poster, a tap starts it
		if (shouldPlay) video.play().catch(() => {});
		else video.pause();
	});
</script>

{#if failed}
	<div
		class="rounded-[5px] border border-line p-2.5 text-[0.85em] text-muted {className}"
		role="note"
	>
		This GIF is no longer available.
	</div>
{:else}
	<svelte:element
		this={toggleable ? 'button' : 'div'}
		type={toggleable ? 'button' : undefined}
		role={toggleable ? undefined : 'presentation'}
		class="relative block overflow-hidden rounded-[5px] bg-black/40 outline-none focus-visible:outline-2 focus-visible:outline-accent {toggleable
			? 'cursor-pointer'
			: ''} {className}"
		style="width: {width}; aspect-ratio: {gif.width} / {gif.height}"
		aria-label={toggleable
			? paused
				? `Play GIF${gif.title ? `: ${gif.title}` : ''}`
				: 'Pause GIF'
			: undefined}
		onclick={(e: MouseEvent) => {
			if (!toggleable) return;
			// a post or message under it would open
			e.stopPropagation();
			e.preventDefault();
			if (!video) return;
			const play = video.paused;
			// playing is the default unless reduced motion is asked for: toggled overrides it
			toggled = play === reducedMotion.current;
			// right away, within the tap: iOS only lets a tap start a refused autoplay
			if (play) video.play().catch(() => {});
			else video.pause();
		}}
	>
		<!-- prettier-ignore -->
		<video
			bind:this={video}
			class="size-full object-cover"
			src={gif.video}
			poster={gif.poster}
			muted
			loop
			playsinline
			disablepictureinpicture
			preload="none"
			aria-hidden="true"
			onplay={() => (paused = false)}
			onpause={() => (paused = true)}
			onerror={() => (failed = true)}
		></video>
		<span
			class="absolute bottom-[5px] left-[5px] rounded-full bg-black/70 px-[5px] text-[0.75em] font-bold"
			>GIF</span
		>
	</svelte:element>
{/if}
