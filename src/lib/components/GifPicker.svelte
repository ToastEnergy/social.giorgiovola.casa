<script lang="ts">
	import { onMount } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import type { Gif } from '#lib/types.js';
	import {
		fetchGifs,
		KlipyError,
		thumbnailOf,
		toGif,
		type GifConfig,
		type KlipyItem
	} from '#lib/klipy.js';
	import LoadingScreen from './LoadingScreen.svelte';

	type Props = {
		config: GifConfig;
		/** a GIF was chosen, found with `query` (empty from the trending ones) */
		onpick: (gif: Gif, query: string) => void;
		onclose: () => void;
		/** the grid's height (a tailwind class) */
		height?: string;
	};

	let { config, onpick, onclose, height = 'h-72' }: Props = $props();

	const DEBOUNCE_MS = 300;

	let query = $state('');
	/** the query the shown results are for */
	let shownQuery = $state('');
	let items: KlipyItem[] = $state([]);
	let page = 0;
	let hasNext = $state(true);
	let loading = $state(false);
	let error: string | null = $state(null);
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
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			if (query.trim() === shownQuery) return;
			shownQuery = query.trim();
			load(true);
		}, DEBOUNCE_MS);
	}

	function pick(item: KlipyItem) {
		const gif = toGif(item);
		if (gif) onpick(gif, shownQuery);
	}

	onMount(() => {
		// a mouse: type right away. On touch the keyboard would cover the trending GIFs
		if (matchMedia('(pointer: fine)').matches) input?.focus();
		load(true);
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
	<div bind:this={grid} class="{height} overflow-y-auto overscroll-contain">
		{#if error && items.length === 0}
			<p class="p-2.5 text-[0.85em] text-muted">{error}</p>
		{:else if !loading && items.length === 0}
			<p class="p-2.5 text-[0.85em] text-muted">No GIFs found.</p>
		{/if}
		<div class="grid grid-cols-3 gap-[5px]">
			{#each items as item, i (`${item.id}:${i}`)}
				{@const thumb = thumbnailOf(item)}
				{#if thumb && item.type === 'gif'}
					<button
						type="button"
						class="aspect-square cursor-pointer overflow-hidden rounded-[5px] bg-white/5 outline-none focus-visible:outline-2 focus-visible:outline-accent"
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
				{/if}
			{/each}
		</div>
		{#if loading}
			<div class="flex justify-center p-2.5" aria-busy="true"><LoadingScreen size={24} /></div>
		{/if}
		<!-- prettier-ignore -->
		<div bind:this={sentinel} class="h-px"></div>
	</div>
	<p class="text-right text-[0.75em] text-muted">Powered by KLIPY</p>
</div>
