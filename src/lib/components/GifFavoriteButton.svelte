<script lang="ts">
	import Star from '@lucide/svelte/icons/star';
	import type { Gif } from '#lib/types.js';
	import { gifFavorites } from '#lib/gifFavorites.svelte.js';

	type Props = { gif: Gif; ontoggle: (gif: Gif) => void };

	let { gif, ontoggle }: Props = $props();

	const saved = $derived(gifFavorites.has(gif.slug));
</script>

<!-- the corner of a picker tile: the hit area is bigger than the star, for fingers -->
<button
	type="button"
	class="group absolute top-0 right-0 flex size-10 cursor-pointer touch-manipulation items-start justify-end p-[5px] outline-none"
	title={saved ? 'Remove from favorites' : 'Add to favorites'}
	aria-label={saved ? 'Remove from favorites' : 'Add to favorites'}
	aria-pressed={saved}
	onclick={() => ontoggle(gif)}
	><span
		class="flex size-7 items-center justify-center rounded-full bg-background/80 group-hover:text-accent group-focus-visible:outline-2 group-focus-visible:outline-accent"
		><Star size={15} strokeWidth={2} class={saved ? 'fill-accent text-accent' : ''} /></span
	></button
>
