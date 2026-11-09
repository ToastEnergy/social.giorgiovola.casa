<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { isActive } from '#lib/nav.js';
	import { tapSearch } from '#lib/searchFocus.js';

	// home has search on the left. away from home a back arrow takes that place and search moves
	// to the right. a page opened directly (a shared link) has nothing of ours to go back to, so
	// the arrow leads home instead
	const home = $derived(page.route.id === '/');
	const searching = $derived(isActive(page.url.pathname, '/search'));
	let inApp = $state(false);
	afterNavigate(({ from }) => {
		if (from) inApp = true;
	});
	const back = () => (inApp ? history.back() : goto('/'));
</script>

<!-- touch devices: search (or back), the logo and search in a row above every page but messages
	(mouse devices have them in the sidebar and the rail). the profile and settings are in the
	bottom bar -->
<!-- 12px padding plus 5px margin keeps the page where it was when a line ran under the row -->
<div class="relative z-10 mb-[5px] hidden grid-cols-3 items-center py-3 pointer-coarse:grid">
	<div class="flex justify-start">
		{#if home}
			{@render search()}
		{:else}
			<!-- as tall as the old avatar, so the row keeps its height -->
			<button
				type="button"
				class="flex size-9.5 items-center justify-start text-foreground [-webkit-tap-highlight-color:transparent]"
				onclick={back}
				title="Back"
				aria-label="Back"><ArrowLeft size={24} strokeWidth={2} /></button
			>
		{/if}
	</div>
	<a href="/" class="flex justify-center hover:no-underline" aria-label="Home">
		<img class="size-8 max-w-none" src="/Logo.png" alt="" width="32" height="32" />
	</a>
	<div class="flex justify-end">
		{#if !home}
			{@render search()}
		{/if}
	</div>
</div>

{#snippet search()}
	<a
		href="/search"
		class="flex size-9.5 items-center hover:no-underline [-webkit-tap-highlight-color:transparent] {home
			? 'justify-start'
			: 'justify-end'} {searching ? 'text-accent' : 'text-foreground'}"
		title="Search"
		aria-label="Search"
		aria-current={searching ? 'page' : undefined}
		onclick={(e) => tapSearch(e, searching)}
		><Search size={24} strokeWidth={searching ? 2.5 : 2} /></a
	>
{/snippet}
