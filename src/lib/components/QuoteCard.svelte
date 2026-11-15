<script lang="ts">
	import type { QuotedPost } from '#lib/types.js';
	import { reservedStyle, sizeOf } from '#lib/imageSizes.js';
	import Avatar from './Avatar.svelte';
	import LocalTime from './LocalTime.svelte';
	import { DATE } from '#lib/time.svelte.js';
	import { unwrapMarkdownImages } from '#lib/utils.js';
	import VoiceNotePlayer from './VoiceNotePlayer.svelte';

	// the post a quote regiorg quotes, embedded in the quote (or in the composer, as a preview).
	// Post.svelte leaves clicks on links inside it alone, so this one opens the quoted post.
	let { quote, link = true }: { quote: QuotedPost | { deleted: true }; link?: boolean } = $props();

	const href = $derived('deleted' in quote ? null : `/@${quote.user.username}/${quote.id}`);
	// markdown-linked images show as their URL, like in a post (unwrapMarkdownImages)
	const text = $derived('deleted' in quote ? '' : unwrapMarkdownImages(quote.content).trim());
	const playable = $derived(!('deleted' in quote) && !!quote.audio);
</script>

{#if 'deleted' in quote}
	<div class="rounded-[5px] border border-line p-2.5 text-[0.9em] text-muted">
		This post was deleted.
	</div>
{:else}
	<!-- a voice note's player can't sit inside a link: then the link covers the card from behind
		the player instead -->
	<svelte:element
		this={link && !playable ? 'a' : 'div'}
		href={link && !playable ? href : undefined}
		class="relative flex flex-col gap-[5px] rounded-[5px] border border-line p-2.5 text-foreground {link
			? 'hover:bg-white/5 hover:no-underline'
			: ''}"
	>
		{#if link && playable}
			<!-- prettier-ignore -->
			<a class="absolute inset-0 rounded-[5px] hover:no-underline" {href} aria-label="Post by {quote.user.name}"></a>
		{/if}
		<div class="flex min-w-0 items-center gap-[5px] text-[0.9em]">
			<Avatar user={quote.user} size={20} clickable={false} />
			<span class="truncate font-bold"
				>{quote.user.name} <span class="font-medium opacity-80">@{quote.user.username}</span></span
			>
			<LocalTime
				class="ml-auto shrink-0 text-[0.8em] opacity-70"
				date={quote.created_at}
				options={DATE}
			/>
		</div>
		{#if text}
			<p class="line-clamp-6 text-[0.95em] wrap-anywhere whitespace-pre-line">{text}</p>
		{/if}
		{#if quote.is_quote}
			<p class="text-[0.85em] text-muted">Quoting another post</p>
		{/if}
		{#if quote.audio}
			<!-- above the link that covers the card, so it plays instead of opening the post -->
			<div class="relative z-1">
				<VoiceNotePlayer
					compact
					track={{
						note: quote.audio,
						sender: quote.user,
						href: href ?? undefined,
						caption: quote.content
					}}
				/>
			</div>
		{/if}
		{#if quote.gif}
			<!-- a still frame: a quote is small, and a click opens the quoted post -->
			<div class="relative self-start">
				<img
					class="max-h-50 max-w-full rounded-[5px] object-contain"
					src={quote.gif.poster}
					alt={quote.gif.title}
					loading="lazy"
					referrerpolicy="no-referrer"
				/>
				<span
					class="absolute bottom-[5px] left-[5px] rounded-full bg-black/70 px-[5px] text-[0.75em] font-bold"
					>GIF</span
				>
			</div>
		{/if}
		{#if quote.images.length > 0}
			<div class="grid gap-1 {quote.images.length > 1 ? 'grid-cols-4' : ''}">
				{#each quote.images.slice(0, 4) as image, i}
					<img
						class={quote.images.length > 1
							? 'aspect-square w-full rounded-[5px] object-cover'
							: 'max-h-50 max-w-full self-start rounded-[5px] object-contain'}
						style={quote.images.length > 1
							? undefined
							: reservedStyle(sizeOf(quote.image_sizes, i), '100%', 200)}
						src={image}
						alt=""
						loading="lazy"
					/>
				{/each}
			</div>
		{/if}
	</svelte:element>
{/if}
