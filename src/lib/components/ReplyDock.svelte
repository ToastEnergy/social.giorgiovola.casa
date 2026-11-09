<script lang="ts">
	import { PUBLIC_REPLY_PLACEHOLDER } from '$app/env/public';
	import type { Post } from '#lib/types.js';
	import { bottomBar, keyboard, writingHandlers } from '#lib/keyboard.svelte.js';
	import { onMount, untrack } from 'svelte';
	import PostComposer from './PostComposer.svelte';

	// touch devices, on an open post: the reply field fixed right above the bottom bar
	let { replyTo, oncreated }: { replyTo: number; oncreated?: (post: Post) => void } = $props();

	// border included: all of it covers the page
	let height = $state(0);
	// leaving the page doesn't always blur the field first
	$effect(() => () => keyboard.setWriting(false));

	// the bar grows (its buttons, more lines, an error) and the bottom bar steps aside and comes
	// back: the page moves along, so what was right above the bars stays there instead of ending
	// up behind them. not while it sits on the iOS keyboard, over the page
	let scrollY = 0;
	onMount(() => {
		const onScroll = () => (scrollY = window.scrollY);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});
	const covered = $derived(keyboard.inset || !height ? null : height + bottomBar.height);
	let previous: number | null = null;
	$effect(() => {
		const now = covered;
		untrack(() => {
			// from where the page was before: the browser may already have pulled it up, when the
			// page got shorter at its end
			if (now !== null && previous !== null && now !== previous) {
				window.scrollTo(0, scrollY + now - previous);
				// the scroll event comes later, and the other bar may change before it
				scrollY = window.scrollY;
			}
			previous = now;
		});
	});
</script>

<!-- keeps the last replies from ending up behind the bar. the layout reserves the bottom bar's
	own height (--bottom-bar, BottomNav) -->
<!-- prettier-ignore -->
<div style:height="{height}px" aria-hidden="true"></div>
<!-- right above the bottom bar: the bar's top border moves up here, so the field and the links
	read as one block. the field is as far from the sides as from the links. while writing the bar
	steps aside and the field takes its place (at the bottom edge, or on iOS on the keyboard,
	which only shrinks the visual viewport: a bar fixed to the bottom would stay under it). it
	places itself, so the layout doesn't scroll it into view (data-keyboard-fit) -->
<div
	bind:offsetHeight={height}
	data-keyboard-fit
	data-bottom-cover
	{...writingHandlers}
	class="fixed right-0 left-0 z-998 border-t border-line bg-background p-2.5 {keyboard.inset ||
	!keyboard.hideBar
		? ''
		: 'pb-[calc(10px+env(safe-area-inset-bottom))]'}"
	style:bottom={keyboard.inset
		? `${keyboard.inset}px`
		: keyboard.hideBar
		? '0px'
		: 'var(--bottom-bar)'}
>
	<PostComposer docked {replyTo} placeholder={PUBLIC_REPLY_PLACEHOLDER} {oncreated} />
</div>
