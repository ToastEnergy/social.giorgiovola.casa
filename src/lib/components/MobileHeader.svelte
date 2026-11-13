<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { page } from '$app/state';
	import { goBack } from '#lib/history.svelte.js';
	import Search from './Search.svelte';

	// away from home a back arrow comes before the logo. a page opened directly (a shared link, a
	// push notification) has nothing of ours to go back to, so the arrow goes up instead (a post to
	// its author, a profile home)
	const home = $derived(page.route.id === '/');
	const back = () => goBack();
</script>

<!-- touch devices: the logo and a full width search bar above every page but messages (mouse
	devices have them in the sidebar and the rail). the profile and settings are in the bottom bar -->
<!-- 12px padding plus 5px margin keeps the page where it was when a line ran under the row -->
<div class="relative z-10 mb-[5px] hidden items-center gap-2.5 py-3 pointer-coarse:flex">
	{#if !home}
		<button
			type="button"
			class="flex size-8 shrink-0 items-center justify-start text-foreground [-webkit-tap-highlight-color:transparent]"
			onclick={back}
			title="Back"
			aria-label="Back"><ArrowLeft size={24} strokeWidth={2} /></button
		>
	{/if}
	<a href="/" class="flex shrink-0 hover:no-underline" aria-label="Home">
		<img class="size-8 max-w-none" src="/Logo.png" alt="" width="32" height="32" />
	</a>
	<div class="min-w-0 flex-1">
		<Search bar />
	</div>
</div>
