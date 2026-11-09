<script lang="ts">
	import { onMount } from 'svelte';
	import { PUBLIC_REPLY_PLACEHOLDER } from '$app/env/public';
	import type { Post } from '#lib/types.js';
	import PostComposer from './PostComposer.svelte';

	// touch devices, on an open post: the reply field fixed right above the bottom bar
	let { replyTo, oncreated }: { replyTo: number; oncreated?: (post: Post) => void } = $props();

	let height = $state(0);
	// how far the on-screen keyboard reaches up, 0 while it is closed
	let keyboard = $state(0);

	onMount(() => {
		// iOS only shrinks the visual viewport for the keyboard (Android resizes the page, see
		// app.html), so a bar fixed to the bottom would stay under it: lift it onto the keyboard
		const vv = window.visualViewport;
		if (!vv) return;
		const fit = () => {
			// pinch zoom also shrinks it
			if (vv.scale > 1.01) return;
			const covered = window.innerHeight - vv.height - vv.offsetTop;
			keyboard = covered > 120 ? covered : 0;
		};
		fit();
		vv.addEventListener('resize', fit);
		vv.addEventListener('scroll', fit);
		return () => {
			vv.removeEventListener('resize', fit);
			vv.removeEventListener('scroll', fit);
		};
	});
</script>

<!-- keeps the last replies from ending up behind the bar -->
<!-- prettier-ignore -->
<div style:height="{height}px" aria-hidden="true"></div>
<!-- above the bottom bar (56px of links and its 4px top padding): the bar's top border moves up
	here, so the field and the links read as one block. the field is as far from the sides as from
	the links -->
<div
	bind:clientHeight={height}
	class="fixed right-0 left-0 z-998 border-t border-line bg-background p-2.5 {keyboard
		? ''
		: 'bottom-[calc(60px+env(safe-area-inset-bottom))]'}"
	style:bottom={keyboard ? `${keyboard}px` : undefined}
>
	<PostComposer docked {replyTo} placeholder={PUBLIC_REPLY_PLACEHOLDER} {oncreated} />
</div>
