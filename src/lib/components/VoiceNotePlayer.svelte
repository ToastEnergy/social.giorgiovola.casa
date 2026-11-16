<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Mic from '@lucide/svelte/icons/mic';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Waveform, { type WaveformTone } from './Waveform.svelte';
	import {
		clock,
		cycleRate,
		durationOf,
		isCurrent,
		markOnScreen,
		player,
		positionOf,
		seek,
		skip,
		toggle,
		type Track
	} from '#lib/audioPlayer.svelte.js';
	import { formatDuration } from '#lib/mediaPreview.js';

	type Props = {
		track: Track;
		/** inverse: on an accent bubble (your own messages) */
		tone?: WaveformTone;
		/** smaller, without the skip buttons: inside a quote */
		compact?: boolean;
		/** the recipient hasn't played it yet: an accent dot */
		unplayed?: boolean;
		/** the sender's view of a direct message: whether the recipient played it (a mic icon) */
		played?: boolean;
		/** as wide as its box, without the cap: a composer's review of a recording */
		fill?: boolean;
	};

	let {
		track,
		tone = 'default',
		compact = false,
		unplayed = false,
		played,
		fill = false
	}: Props = $props();

	const SKIP_S = 15;
	const ARROW_S = 5;

	const note = $derived(track.note);
	const duration = $derived(durationOf(note));
	const total = $derived(formatDuration(note.duration_ms));
	const current = $derived(isCurrent(note));
	const playing = $derived(current && player.playing);
	const loading = $derived(current && player.loading);
	const position = $derived(positionOf(note));
	const started = $derived(current || position > 0);
	// the fraction under the finger while scrubbing, applied when it lets go
	let dragging = $state<number | null>(null);
	const progress = $derived(dragging ?? (duration > 0 ? position / duration : 0));
	const shown = $derived(dragging !== null ? dragging * duration : position);

	let root = $state<HTMLElement>();
	let slider = $state<HTMLElement>();
	let gesture: { id: number; x: number; moved: boolean } | null = null;

	// the pill hides while a player of its note is in view
	$effect(() => {
		if (!root) return;
		let off: (() => void) | null = null;
		const observer = new IntersectionObserver(([entry]) => {
			if (entry.isIntersecting && !off) off = markOnScreen(note);
			else if (!entry.isIntersecting && off) {
				off();
				off = null;
			}
		});
		observer.observe(root);
		return () => {
			observer.disconnect();
			off?.();
		};
	});

	const fractionAt = (e: PointerEvent) => {
		const rect = slider!.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	};

	function onPointerDown(e: PointerEvent) {
		// not the chat's swipe to reply or long press, nor the post's tap
		e.stopPropagation();
		if (e.button !== 0) return;
		gesture = { id: e.pointerId, x: e.clientX, moved: false };
		// the touch-action keeps vertical drags for scrolling: the browser cancels this then
		slider!.setPointerCapture(e.pointerId);
		if (e.pointerType === 'mouse') dragging = fractionAt(e);
	}

	function onPointerMove(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.id) return;
		if (!gesture.moved && Math.abs(e.clientX - gesture.x) < 4) return;
		gesture.moved = true;
		dragging = fractionAt(e);
	}

	function onPointerUp(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.id) return;
		gesture = null;
		seek(note, fractionAt(e) * duration);
		dragging = null;
	}

	function onPointerCancel() {
		gesture = null;
		dragging = null;
	}

	function onKeyDown(e: KeyboardEvent) {
		const by: Record<string, number> = {
			ArrowLeft: -ARROW_S,
			ArrowDown: -ARROW_S,
			ArrowRight: ARROW_S,
			ArrowUp: ARROW_S,
			PageDown: -SKIP_S,
			PageUp: SKIP_S
		};
		if (e.key in by) skip(note, by[e.key]);
		else if (e.key === 'Home') seek(note, 0);
		else if (e.key === 'End') seek(note, duration);
		else return;
		e.preventDefault();
	}

	const chipClass = $derived(
		`flex h-6 cursor-pointer items-center gap-0.5 rounded-full px-1.5 text-[0.95em] font-bold outline-none focus-visible:outline-2 focus-visible:outline-current ${
			tone === 'inverse' ? 'bg-black/15' : 'bg-white/10 hover:bg-white/15'
		}`
	);
</script>

<!-- a click or key inside the player never opens the post or the message around it -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	role="group"
	aria-label="Voice note, {total}"
	class="flex w-full flex-col gap-[5px] {fill ? '' : compact ? 'max-w-70' : 'max-w-100'}"
	onclick={(e) => e.stopPropagation()}
	onkeydown={(e) => e.stopPropagation()}
	onkeypress={(e) => e.stopPropagation()}
>
	<div class="flex items-center gap-2.5">
		<button
			type="button"
			class="relative flex shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-current {compact
				? 'size-7'
				: 'size-9'}"
			aria-label={playing ? 'Pause' : 'Play'}
			title={playing ? 'Pause' : 'Play'}
			onclick={() => toggle(track)}
		>
			{#if loading}
				<LoaderCircle size={compact ? 18 : 22} class="animate-spin" />
			{:else if playing}
				<Pause size={compact ? 18 : 22} class="fill-current" />
			{:else}
				<Play size={compact ? 18 : 22} class="fill-current" />
			{/if}
			{#if unplayed && !started}
				<!-- prettier-ignore -->
				<span class="absolute top-0.5 right-0.5 size-2 rounded-full bg-accent" title="Not played yet"></span>
			{/if}
		</button>
		<div
			bind:this={slider}
			role="slider"
			tabindex="0"
			aria-label="Position"
			aria-valuemin={0}
			aria-valuemax={Math.round(duration)}
			aria-valuenow={Math.round(shown)}
			aria-valuetext="{clock(shown)} of {total}"
			class="flex min-w-0 flex-1 cursor-pointer touch-pan-y items-center rounded-[5px] outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current {compact
				? 'h-6'
				: 'h-8'}"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerCancel}
			onkeydown={onKeyDown}
		>
			<Waveform class="h-full w-full" bars={note.waveform} {progress} {tone} />
		</div>
	</div>
	<div class="flex items-center gap-2.5 text-[0.8em] {compact ? 'pl-9.5' : 'pl-11.5'}">
		<span class="tabular-nums opacity-80">
			{started ? `${clock(shown)} / ${total}` : total}
		</span>
		{#if played !== undefined}
			<!-- accent once played; on an accent bubble the accent can't show, so it lights up -->
			<span
				class="flex {played
					? tone === 'inverse'
						? 'text-foreground'
						: 'text-accent'
					: 'opacity-40'}"
				title={played ? 'Played' : 'Not played yet'}
				aria-label={played ? 'Played' : 'Not played yet'}
				role="img"><Mic size={14} strokeWidth={played ? 2.75 : 2} /></span
			>
		{/if}
		{#if current || (!compact && duration > 120)}
			<div class="ml-auto flex items-center gap-[5px]">
				{#if !compact && duration > 120}
					<button
						type="button"
						class={chipClass}
						aria-label="Back {SKIP_S} seconds"
						title="Back {SKIP_S} seconds"
						onclick={() => skip(note, -SKIP_S)}><RotateCcw size={12} />{SKIP_S}</button
					>
				{/if}
				{#if current}
					<button
						type="button"
						class="{chipClass} tabular-nums"
						aria-label="Playback speed {player.rate}×"
						title="Playback speed"
						onclick={cycleRate}>{player.rate}×</button
					>
				{/if}
				{#if !compact && duration > 120}
					<button
						type="button"
						class={chipClass}
						aria-label="Forward {SKIP_S} seconds"
						title="Forward {SKIP_S} seconds"
						onclick={() => skip(note, SKIP_S)}>{SKIP_S}<RotateCw size={12} /></button
					>
				{/if}
			</div>
		{/if}
	</div>
</div>
