<script lang="ts">
	import { onMount } from 'svelte';
	import { attach } from '#lib/audioPlayer.svelte.js';

	// the one <audio> element every voice note plays through (audioPlayer.svelte.ts). nothing
	// downloads until a note is played
	let el: HTMLAudioElement;
	onMount(() => attach(el));
</script>

<!-- prettier-ignore -->
<audio bind:this={el} preload="none" class="hidden"></audio>
