<script lang="ts">
	import Mic from '@lucide/svelte/icons/mic';
	import Trash from '@lucide/svelte/icons/trash';
	import Pause from '@lucide/svelte/icons/pause';
	import Square from '@lucide/svelte/icons/square';
	import CloudCheck from '@lucide/svelte/icons/cloud-check';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import RecordingMeter from './RecordingMeter.svelte';
	import UploadProgress from './UploadProgress.svelte';
	import VoiceMicError from './VoiceMicError.svelte';
	import VoiceNotePlayer from './VoiceNotePlayer.svelte';
	import { trackOf, type VoiceSession } from '#lib/voiceSession.svelte.js';
	import type { ChatPeer } from '#lib/types.js';

	// the recorder of a post composer, under its field: always hands free (started from the mic
	// in the toolbar, no hold), and the field stays usable for the caption
	type Props = {
		session: VoiceSession;
		/** you, for the review's player */
		me: ChatPeer;
		/** keeps the focus on the field (the docked composer's keyboard stays up) */
		keepFocus: (e: MouseEvent) => void;
	};

	let { session, me, keepFocus }: Props = $props();

	const recorder = $derived(session.recorder);
	const phase = $derived(recorder.phase);
	const note = $derived(session.note);
	const track = $derived(note?.url ? trackOf(note, me) : null);

	const iconButton =
		'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-white/10 focus-visible:bg-white/10 disabled:cursor-default disabled:opacity-40';
</script>

<p class="sr-only" aria-live="polite">{session.spoken}</p>

{#if session.shown}
	<div
		class="flex min-h-[46px] items-center gap-[5px] rounded-[10px] border border-line px-[5px] select-none [-webkit-touch-callout:none]"
		role="group"
		aria-label="Voice note"
	>
		{#if session.binning}
			<span class="bin flex items-center px-2.5 text-danger"><Trash size={20} /></span>
		{:else if session.reviewing && note && track}
			<button
				type="button"
				class="{iconButton} text-danger"
				aria-label="Delete voice note"
				title="Delete"
				onmousedown={keepFocus}
				onclick={() => session.discard(true)}><Trash size={20} /></button
			>
			<div class="min-w-0 flex-1 py-[5px]">
				<VoiceNotePlayer {track} compact fill />
			</div>
			{#if note.status === 'failed'}
				<button
					type="button"
					class="{iconButton} text-danger"
					aria-label="Upload the voice note again"
					title={note.error ?? 'Upload again'}
					onmousedown={keepFocus}
					onclick={() => note.upload()}><RotateCw size={18} /></button
				>
			{:else if note.status === 'uploading'}
				<span class="flex shrink-0 px-[5px]"
					><UploadProgress progress={note.progress} size={24} label="voice note" /></span
				>
			{/if}
		{:else}
			<button
				type="button"
				class="{iconButton} text-danger"
				aria-label="Delete recording"
				title="Delete"
				onmousedown={keepFocus}
				onclick={() => session.discard(true)}><Trash size={20} /></button
			>
			<RecordingMeter {recorder} />
			{#if phase === 'paused'}
				<span class="text-[0.85em] text-muted">Paused</span>
			{/if}
			{#if note && note.saved > 0}
				<span
					class="flex shrink-0 text-muted"
					title="Saved as you record: nothing is lost if the app closes"
					role="img"
					aria-label="Saved"><CloudCheck size={16} /></span
				>
			{/if}
			<button
				type="button"
				class={iconButton}
				aria-label={phase === 'paused' ? 'Resume recording' : 'Pause recording'}
				title={phase === 'paused' ? 'Resume' : 'Pause'}
				disabled={phase === 'requesting'}
				onmousedown={keepFocus}
				onclick={() => session.togglePause()}
				>{#if phase === 'paused'}<Mic size={20} class="text-danger" />{:else}<Pause
						size={20}
					/>{/if}</button
			>
			<button
				type="button"
				class={iconButton}
				aria-label="Stop and review"
				title="Stop and review"
				disabled={phase === 'requesting'}
				onmousedown={keepFocus}
				onclick={() => session.stopToReview()}><Square size={16} class="fill-current" /></button
			>
		{/if}
	</div>
{/if}

{#if session.reviewing && note?.status === 'failed' && note.error}
	<p class="text-[0.85em] text-danger" role="alert">{note.error}</p>
{/if}

{#if session.hint}
	<p class="text-[0.85em] text-muted" role="status">{session.hint}</p>
{/if}

{#if session.micError && !recorder.active}
	<VoiceMicError error={session.micError} onclose={() => (session.micError = null)} />
{/if}

<style>
	/* the deleted recording drops into the bin */
	.bin {
		animation: bin 450ms ease-in forwards;
	}
	@keyframes bin {
		30% {
			transform: rotate(-12deg);
		}
		60% {
			transform: rotate(10deg);
		}
		to {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bin {
			animation: none;
		}
	}
</style>
