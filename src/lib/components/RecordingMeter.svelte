<script lang="ts">
	import { barClass } from './Waveform.svelte';
	import { clock } from '#lib/audioPlayer.svelte.js';
	import { MAX_MS, type VoiceRecorder } from '#lib/voiceRecorder.svelte.js';

	// the red dot, the timer and the live waveform of a recording under way
	let {
		recorder,
		fill = true,
		class: className = ''
	}: {
		recorder: VoiceRecorder;
		/** the waveform takes the room left; otherwise it's a narrow strip */
		fill?: boolean;
		/** for the dot and timer */
		class?: string;
	} = $props();

	// the left over time in the last minute, the time so far otherwise
	const left = $derived(MAX_MS - recorder.elapsed);
	const timer = $derived(
		left <= 60_000 ? `${clock(Math.ceil(left / 1000))} left` : clock(recorder.elapsed / 1000)
	);
</script>

<span class="flex shrink-0 items-center gap-2 {className}">
	<!-- prettier-ignore -->
	<span
		class="size-2.5 rounded-full {recorder.phase === 'recording' && recorder.started ? 'rec-dot bg-danger' : 'bg-muted'}"
		aria-hidden="true"
	></span>
	<span
		role="timer"
		class="text-[0.9em] tabular-nums {left <= 60_000 ? 'text-danger' : ''}"
		aria-label="Recorded {clock(recorder.elapsed / 1000)}">{timer}</span
	>
</span>
<!-- the newest bars on the right, older ones scroll off to the left -->
<div
	class="flex h-6 min-w-0 items-center justify-end gap-px overflow-hidden {fill
		? 'flex-1'
		: 'w-14 shrink-0'}"
	aria-hidden="true"
>
	{#each recorder.levels as level, i (recorder.levels.length - i)}
		<!-- prettier-ignore -->
		<span
			class="{barClass} shrink-0 {recorder.phase === 'paused' ? 'bg-muted' : 'bg-accent'}"
			style:height="{Math.max(8, (level / 255) * 100)}%"
		></span>
	{/each}
</div>

<style>
	/* the red dot pulses with its opacity only */
	.rec-dot {
		animation: rec-dot 1s ease-in-out infinite alternate;
	}
	@keyframes rec-dot {
		to {
			opacity: 0.25;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rec-dot {
			animation: none;
		}
	}
</style>
