<script lang="ts">
	import type { LinkPreview } from '#lib/types.js';

	// the Open Graph card of an external link in a post. Post.svelte leaves clicks on links
	// inside it alone, so this opens the site. `showImage` is off when the post has images itself
	let { preview, showImage = true }: { preview: LinkPreview; showImage?: boolean } = $props();

	// a broken or blocked image leaves just the text
	let imageFailed = $state(false);
</script>

<a
	href={preview.url}
	target="_blank"
	rel="noopener noreferrer nofollow ugc"
	class="flex flex-col overflow-hidden rounded-[5px] border border-line text-foreground hover:bg-white/5 hover:no-underline"
>
	{#if showImage && preview.image && !imageFailed}
		<img
			class="aspect-[1.91] max-h-75 w-full border-b border-line bg-black/40 object-cover"
			src={preview.image}
			alt=""
			referrerpolicy="no-referrer"
			loading="lazy"
			onerror={() => (imageFailed = true)}
		/>
	{/if}
	<div class="flex min-w-0 flex-col gap-0.5 p-2.5">
		<span class="truncate text-[0.8em] text-muted">{preview.site_name}</span>
		<span class="line-clamp-2 font-bold wrap-anywhere">{preview.title}</span>
		{#if preview.description}
			<span class="line-clamp-2 text-[0.85em] wrap-anywhere text-muted">{preview.description}</span>
		{/if}
	</div>
</a>
