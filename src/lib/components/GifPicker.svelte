<script lang="ts">
	import { onMount } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import type { Gif } from '#lib/types.js';
	import { messageOf } from '#lib/api.js';
	import { gifFavorites } from '#lib/gifFavorites.svelte.js';
	import {
		fetchGifs,
		KlipyError,
		thumbnailOf,
		toGif,
		type GifConfig,
		type KlipyItem
	} from '#lib/klipy.js';
	import GifFavoriteButton from './GifFavoriteButton.svelte';
	import LoadingScreen from './LoadingScreen.svelte';

	type Props = {
		config: GifConfig;
		/** a GIF was chosen, found with `query` (empty from the trending ones or the favorites) */
		onpick: (gif: Gif, query: string) => void;
		onclose: () => void;
		/** the grid's height (a tailwind class) */
		height?: string;
	};

	let { config, onpick, onclose, height = 'h-72' }: Props = $props();

	const DEBOUNCE_MS = 300;

	/** KLIPY's results (trending or a search), or the saved GIFs: never mixed (KLIPY's terms) */
	let tab: 'klipy' | 'favorites' = $state('klipy');
	let query = $state('');
	/** the query the shown results are for */
	let shownQuery = $state('');
	let items: KlipyItem[] = $state([]);
	let page = 0;
	let hasNext = $state(true);
	let loading = $state(false);
	let error: string | null = $state(null);
	/** a star that couldn't be saved */
	let favoriteError: string | null = $state(null);
	/** favorites whose poster no longer loads (KLIPY removed the GIF) */
	let gone: Set<string> = $state(new Set());
	let input: HTMLInputElement | undefined = $state();
	let grid: HTMLDivElement | undefined = $state();
	let sentinel: HTMLDivElement | undefined = $state();
	let controller: AbortController | null = null;
	let debounce: ReturnType<typeof setTimeout> | undefined;

	/** Loads the next page of `shownQuery`, or the first one of a new query. */
	async function load(fresh: boolean) {
		if (fresh) {
			controller?.abort();
			items = [];
			page = 0;
			hasNext = true;
			error = null;
			grid?.scrollTo({ top: 0 });
		} else if (loading || !hasNext) return;
		const ctrl = new AbortController();
		controller = ctrl;
		loading = true;
		try {
			const result = await fetchGifs(config, shownQuery, page + 1, ctrl.signal);
			if (ctrl.signal.aborted) return;
			page++;
			// shown as KLIPY sent them, in its order (its terms)
			items = [...items, ...result.items];
			hasNext = result.hasNext && result.items.length > 0;
		} catch (e) {
			if (ctrl.signal.aborted) return;
			error = e instanceof KlipyError ? e.message : 'Could not load GIFs.';
			hasNext = false;
		} finally {
			if (controller === ctrl) loading = false;
		}
	}

	function onInput() {
		// a search is always KLIPY's
		showTab('klipy');
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			if (query.trim() === shownQuery) return;
			shownQuery = query.trim();
			load(true);
		}, DEBOUNCE_MS);
	}

	function showTab(next: typeof tab) {
		if (tab === next) return;
		tab = next;
		grid?.scrollTo({ top: 0 });
		if (next === 'favorites') gifFavorites.load();
	}

	function pick(item: KlipyItem) {
		const gif = toGif(item);
		if (gif) onpick(gif, shownQuery);
	}

	function pickFavorite({ provider, slug, title, video, poster, width, height }: Gif) {
		// without the list's own fields (favorited_at)
		onpick({ provider, slug, title, video, poster, width, height }, '');
	}

	async function toggleFavorite(gif: Gif) {
		favoriteError = null;
		try {
			await gifFavorites.toggle(gif);
		} catch (e) {
			favoriteError = messageOf(e, 'Could not save the GIF.');
		}
	}

	onMount(() => {
		// a mouse: type right away. On touch the keyboard would cover the trending GIFs
		if (matchMedia('(pointer: fine)').matches) input?.focus();
		load(true);
		// for the stars on KLIPY's results
		gifFavorites.load();
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.stopPropagation();
			onclose();
		};
		window.addEventListener('keydown', onKey, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			clearTimeout(debounce);
			controller?.abort();
		};
	});

	// the next page once the end of the grid scrolls into view
	$effect(() => {
		if (!sentinel || !grid) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) load(false);
			},
			{ root: grid, rootMargin: '200px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	const tileClass =
		'block size-full cursor-pointer overflow-hidden rounded-[5px] bg-white/5 outline-none focus-visible:outline-2 focus-visible:outline-accent';
</script>

<div
	class="flex flex-col gap-[5px] rounded-[5px] border border-accent bg-background p-2.5"
	role="dialog"
	aria-label="Choose a GIF"
>
	<div class="flex items-center gap-[5px]">
		<!-- KLIPY's terms ask for this placeholder -->
		<input
			bind:this={input}
			bind:value={query}
			oninput={onInput}
			onkeydown={(e) => {
				// the form around it would send the post
				if (e.key === 'Enter') e.preventDefault();
			}}
			class="min-w-0 flex-1 border-b bg-transparent p-[5px] outline-none focus:border-accent"
			type="search"
			placeholder="Search KLIPY"
			aria-label="Search KLIPY"
			enterkeyhint="search"
		/>
		<button
			type="button"
			title="Close"
			aria-label="Close GIFs"
			onclick={onclose}
			class="flex cursor-pointer items-center rounded-[5px] p-[5px] outline-none hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent"
			><X size={18} /></button
		>
	</div>
	<nav class="flex gap-5 text-[0.9em]">
		{#each [['klipy', shownQuery ? 'Results' : 'Trending'], ['favorites', 'Favorites']] as const as [kind, label]}
			<button
				type="button"
				class="cursor-pointer border-b-2 pb-[5px] font-bold outline-none focus-visible:text-accent {tab ===
				kind
					? 'border-accent'
					: 'border-transparent opacity-60 hover:opacity-100'}"
				aria-current={tab === kind ? 'true' : undefined}
				onclick={() => showTab(kind)}
				>{label}{#if kind === 'favorites' && gifFavorites.loaded}
					<span class="font-medium text-muted"> {gifFavorites.items.length}</span>{/if}</button
			>
		{/each}
	</nav>
	{#if favoriteError}
		<p class="rounded-[5px] bg-danger p-[5px] text-[0.85em]" role="alert">{favoriteError}</p>
	{/if}
	<div bind:this={grid} class="{height} overflow-y-auto overscroll-contain">
		{#if tab === 'favorites'}
			{#if gifFavorites.error && !gifFavorites.loaded}
				<p class="p-2.5 text-[0.85em] text-muted">{gifFavorites.error}</p>
			{:else if gifFavorites.loaded && gifFavorites.items.length === 0}
				<p class="p-2.5 text-[0.85em] text-muted">
					No favorites yet. Tap the star on a GIF to save it here.
				</p>
			{:else if !gifFavorites.loaded}
				<div class="flex justify-center p-2.5" aria-busy="true"><LoadingScreen size={24} /></div>
			{/if}
			<div class="grid grid-cols-3 gap-[5px]">
				{#each gifFavorites.items as gif (gif.slug)}
					<div class="relative aspect-square">
						{#if gone.has(gif.slug)}
							<div
								class="flex size-full items-center justify-center rounded-[5px] bg-white/5 p-[5px] text-center text-[0.75em] text-muted"
							>
								No longer available
							</div>
						{:else}
							<button
								type="button"
								class={tileClass}
								title={gif.title || 'GIF'}
								aria-label={gif.title || 'GIF'}
								onclick={() => pickFavorite(gif)}
							>
								<img
									class="size-full object-cover"
									src={gif.poster}
									alt=""
									loading="lazy"
									referrerpolicy="no-referrer"
									onerror={() => (gone = new Set(gone).add(gif.slug))}
								/>
							</button>
						{/if}
						<GifFavoriteButton {gif} ontoggle={toggleFavorite} />
					</div>
				{/each}
			</div>
		{:else}
			{#if error && items.length === 0}
				<p class="p-2.5 text-[0.85em] text-muted">{error}</p>
			{:else if !loading && items.length === 0}
				<p class="p-2.5 text-[0.85em] text-muted">No GIFs found.</p>
			{/if}
			<div class="grid grid-cols-3 gap-[5px]">
				{#each items as item, i (`${item.id}:${i}`)}
					{@const thumb = thumbnailOf(item)}
					{@const gif = toGif(item)}
					{#if thumb && gif}
						<div class="relative aspect-square">
							<button
								type="button"
								class={tileClass}
								title={item.title || 'GIF'}
								aria-label={item.title || 'GIF'}
								onclick={() => pick(item)}
							>
								<img
									class="size-full object-cover"
									src={thumb.url}
									alt=""
									loading="lazy"
									referrerpolicy="no-referrer"
								/>
							</button>
							{#if gifFavorites.loaded}<GifFavoriteButton {gif} ontoggle={toggleFavorite} />{/if}
						</div>
					{/if}
				{/each}
			</div>
			{#if loading}
				<div class="flex justify-center p-2.5" aria-busy="true"><LoadingScreen size={24} /></div>
			{/if}
			<!-- prettier-ignore -->
			<div bind:this={sentinel} class="h-px"></div>
		{/if}
	</div>
	<p class="text-right text-[0.75em] text-muted">Powered by KLIPY</p>
</div>
