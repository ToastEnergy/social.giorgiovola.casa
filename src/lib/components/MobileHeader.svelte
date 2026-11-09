<script lang="ts">
	import AccountSwitcher from './AccountSwitcher.svelte';
	import Settings from '@lucide/svelte/icons/settings';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { user } from '#lib/store.js';
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';

	// away from home the profile gives way to a back arrow. a page opened directly (a shared
	// link) has nothing of ours to go back to, so the arrow leads home instead
	const home = $derived(page.route.id === '/');
	let inApp = $state(false);
	afterNavigate(({ from }) => {
		if (from) inApp = true;
	});
	const back = () => (inApp ? history.back() : goto('/'));
</script>

<!-- touch devices: the profile, the logo and settings in a row above every page but messages
	(mouse devices have them in the sidebar and the rail) -->
<!-- 12px padding plus 5px margin keeps the page where it was when a line ran under the row. above
	the page, so the profile menu opens over it -->
<div class="relative z-10 mb-[5px] hidden grid-cols-3 items-center py-3 pointer-coarse:grid">
	<div class="flex justify-start">
		{#if home}
			<AccountSwitcher size={38} start />
		{:else}
			<!-- as tall as the avatar, so the row keeps its height -->
			<button
				type="button"
				class="flex size-9.5 items-center justify-start text-foreground"
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
		{#if $user}
			<a
				href="/settings"
				class="flex size-8 items-center justify-center text-foreground hover:no-underline"
				title="Settings"
				aria-label="Settings"><Settings size={24} strokeWidth={2} /></a
			>
		{/if}
	</div>
</div>
