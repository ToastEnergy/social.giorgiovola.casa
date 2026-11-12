<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	// the installed app's launch screen: covers the server rendered page until it is hydrated.
	// it matches the iOS startup images (scripts/splash.ts), which iOS shows before the page loads,
	// so the handover is seamless. only in the installed app (standalone, see app.css)
	let visible = $state(true);
	onMount(() => (visible = false));
</script>

{#if visible}
	<!-- above the loading overlay (z-1000). the css animation hides it anyway if the page never
		hydrates, so it can't trap the app -->
	<div
		class="splash fixed inset-0 z-1100 hidden items-center justify-center bg-background standalone:flex"
		aria-hidden="true"
		out:fade={{ duration: 200 }}
	>
		<img src="/icons/icon-512.png" alt="" class="size-[20vmin] max-w-40 rounded-[22%]" />
	</div>
{/if}
