<script lang="ts">
	import { fade } from 'svelte/transition';
	import { onNavigate } from '$app/navigation';
	import { navigating } from '$app/state';
	import LoadingScreen from '#lib/components/LoadingScreen.svelte';

	// only a slow page change shows it: a quick one (or one from the back cache) would just flash it
	const THRESHOLD = 400;

	let slow = $state(false);
	// the new page is about to render
	let arrived = $state(false);

	$effect(() => {
		// not for an overlay's history entry (shallow), which isn't a page change
		const waiting = !!navigating.to && !(navigating as { shallow?: boolean }).shallow;
		slow = false;
		arrived = false;
		if (!waiting) return;
		const timer = setTimeout(() => (slow = true), THRESHOLD);
		return () => clearTimeout(timer);
	});

	// gone before the page transition takes its picture of the old page (NavHistory), so it neither
	// slides with it nor fades out over the new one
	onNavigate(() => {
		arrived = true;
	});
</script>

<!-- above the header (z-999); blocks clicks while it shows. no fade out: it disappears as the new
	page appears -->
{#if slow && !arrived}
	<div
		class="fixed inset-0 z-1000 flex items-center justify-center bg-black/40 backdrop-blur-md"
		in:fade={{ duration: 150 }}
	>
		<LoadingScreen size={200} class="max-w-[60vw]" />
	</div>
{/if}
