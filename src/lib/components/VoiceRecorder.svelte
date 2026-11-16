<script lang="ts">
	import Mic from '@lucide/svelte/icons/mic';
	import Lock from '@lucide/svelte/icons/lock';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Trash from '@lucide/svelte/icons/trash';
	import Pause from '@lucide/svelte/icons/pause';
	import Square from '@lucide/svelte/icons/square';
	import CloudCheck from '@lucide/svelte/icons/cloud-check';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import RecordingMeter from './RecordingMeter.svelte';
	import VoiceMicError from './VoiceMicError.svelte';
	import VoiceNotePlayer from './VoiceNotePlayer.svelte';
	import { leavingPage, overlayEntry } from '#lib/history.svelte.js';
	import { sendTyping } from '#lib/typing.svelte.js';
	import type { VoiceNote } from '#lib/voiceNote.svelte.js';
	import { haptic, requestMic } from '#lib/voiceRecorder.svelte.js';
	import { trackOf, VoiceSession } from '#lib/voiceSession.svelte.js';
	import type { ChatPeer } from '#lib/types.js';

	type Props = {
		/** where this conversation's drafts are saved (voiceDraftPrefix); null: not saved */
		draftPrefix: string | null;
		/** who sees "recording…" */
		typingTarget: { to: string } | { group: number };
		/** the field is empty and nothing is attached: the mic takes the send button's place */
		showMic: boolean;
		/** the recorder covers the input (bindable) */
		active?: boolean;
		/** you, for the review's player */
		me: ChatPeer;
		/** a note to send: the chat shows it at once and sends it as its upload finishes */
		onsend: (note: VoiceNote) => void;
		/** a note whose send didn't finish last time (a reload): the chat offers to retry it */
		onunsent?: (note: VoiceNote) => void;
	};

	let {
		draftPrefix,
		typingTarget,
		showMic,
		active = $bindable(false),
		me,
		onsend,
		onunsent
	}: Props = $props();

	// held this little, it was a tap: nothing is sent
	const MIN_HOLD_MS = 600;
	// a mouse press this short is a click: it records hands free
	const CLICK_MS = 350;
	// share of the row to slide left to cancel, and how far up locks
	const CANCEL_SHARE = 0.4;
	const LOCK_PX = 80;
	// how often others are told you're recording (the server's typing indicator lasts ~6 s)
	const PING_MS = 3000;

	const session = new VoiceSession(() => draftPrefix);
	const recorder = session.recorder;

	const phase = $derived(recorder.phase);
	const capturing = $derived(session.capturing);
	const holding = $derived(session.holding);
	const locked = $derived(session.locked);
	const reviewing = $derived(session.reviewing);
	const shown = $derived(capturing || reviewing || session.binning);

	$effect(() => {
		active = session.shown;
	});

	const say = (text: string, ms?: number) => session.say(text, ms);

	// ---- the hold gesture
	let gesture = $state<{
		id: number;
		x: number;
		y: number;
		at: number;
		mouse: boolean;
		/** how far left cancels, px */
		cancelAt: number;
	} | null>(null);
	let dx = $state(0);
	let dy = $state(0);
	// the click that follows a press handled here must not also send
	let suppressClick = false;
	let button = $state<HTMLButtonElement>();

	async function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 || !e.isPrimary) return;
		suppressClick = false;
		if (session.shown) return;
		// keeps the focus (and the on-screen keyboard) on the text field, and no text selection
		e.preventDefault();
		suppressClick = true;
		session.hint = null;
		if (session.permission === 'denied' && session.micError === 'denied') {
			session.micError = 'denied';
			return;
		}
		if (session.permission !== 'granted') {
			// the first press only asks: the browser's prompt would break a hold anyway
			const answer = await requestMic();
			if (answer === 'granted') {
				session.permission = 'granted';
				session.micError = null;
				// a click records hands free right away, a finger holds next time
				if (e.pointerType === 'mouse') void session.startLocked();
				else say('Now hold to record');
			} else session.micError = answer === 'prompt' ? null : answer;
			return;
		}
		const form = button?.closest('form');
		gesture = {
			id: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			// when the finger went down, not when this ran: starting the mic can hold up the page
			// for a moment, which mustn't turn a tap into a hold
			at: e.timeStamp,
			mouse: e.pointerType === 'mouse',
			cancelAt: Math.max(80, (form?.clientWidth ?? 300) * CANCEL_SHARE)
		};
		dx = 0;
		dy = 0;
		try {
			button?.setPointerCapture(e.pointerId);
		} catch {
			// the pointer is already gone
		}
		const started = recorder.start('hold');
		haptic(12);
		if (!(await started)) {
			gesture = null;
			session.failed();
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.id || !holding) return;
		const x = Math.min(0, e.clientX - gesture.x);
		const y = Math.min(0, e.clientY - gesture.y);
		// one direction at a time: sideways cancels, up locks
		if (Math.abs(x) > Math.abs(y)) {
			dx = x;
			dy = 0;
		} else {
			dx = 0;
			dy = y;
		}
		if (-dx >= gesture.cancelAt) {
			release(e);
			session.discard(true);
		} else if (-dy >= LOCK_PX) {
			release(e);
			recorder.lock();
			haptic([8, 40, 8]);
		}
	}

	/** The finger is no longer followed (it slid to cancel or lock). */
	function release(e: PointerEvent) {
		gesture = null;
		dx = 0;
		dy = 0;
		try {
			button?.releasePointerCapture(e.pointerId);
		} catch {
			// not captured
		}
	}

	async function onPointerUp(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.id) return;
		const held = e.timeStamp - gesture.at;
		const mouse = gesture.mouse;
		release(e);
		if (!holding) return;
		if (mouse && held < CLICK_MS) {
			// a click: hands free (holding a mouse button for minutes is no fun)
			recorder.lock();
			return;
		}
		if (held < MIN_HOLD_MS) {
			session.cancelQuietly();
			haptic(6);
			say('Hold to record, release to send. Slide up to lock.');
			return;
		}
		if (phase === 'requesting') {
			// let go while the mic was starting: the browser asked again, most likely
			session.cancelQuietly();
			say('Now hold to record');
			return;
		}
		await send();
	}

	/** The browser took the pointer (a system gesture): stop into review, never lose it. */
	async function onPointerCancel(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.id) return;
		const held = e.timeStamp - gesture.at;
		release(e);
		if (!holding) return;
		if (held < MIN_HOLD_MS || phase === 'requesting') session.cancelQuietly();
		else await session.stopToReview();
	}

	function onClick(e: MouseEvent) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		e.preventDefault();
		// keyboard (Enter / Space) or a screen reader: hands free
		if (!recorder.active) {
			if (session.permission === 'denied' && session.micError === 'denied') return;
			void session.startLocked();
		} else if (!holding) void send();
	}

	// ---- the recording's end

	/** Sends what's recorded (stopping first) or reviewed. */
	async function send() {
		const sent = await session.take();
		if (!sent) return;
		haptic(12);
		onsend(sent);
	}

	// ---- keys while hands free or reviewing
	function onKeydown(e: KeyboardEvent) {
		if (!recorder.active || holding || e.isComposing) return;
		const target = e.target as HTMLElement | null;
		const onControl = !!target?.closest('button, a, [role="slider"]');
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			session.confirmDiscard();
		} else if (e.key === 'Enter' && !e.shiftKey && !onControl) {
			e.preventDefault();
			e.stopPropagation();
			void send();
		} else if (e.key === ' ' && !onControl && capturing) {
			e.preventDefault();
			e.stopPropagation();
			session.togglePause();
		} else if (target?.matches('textarea, input') && (e.key.length === 1 || e.key === 'Enter')) {
			// the text field is under the recorder: typing there would go unseen
			e.preventDefault();
		}
	}

	// ---- the back button: the hands free recorder and the review hold a history entry
	// (asked again instead of leaving when "Discard voice note?" is answered no)
	let reopening = $state(false);
	overlayEntry(
		'voice-note',
		() => !reopening && (locked || reviewing),
		() => {
			// leaving the page: it stays a draft (stopped as the recorder goes)
			if (leavingPage() || session.confirmDiscard()) return;
			reopening = true;
			setTimeout(() => (reopening = false));
		}
	);

	// a held recording doesn't leave the page (the bottom bar is off too)
	beforeNavigate((nav) => {
		if (holding && !nav.willUnload) nav.cancel();
	});

	// ---- "recording…" for the others
	$effect(() => {
		if (phase !== 'recording') return;
		const target = typingTarget;
		sendTyping(target, 'recording');
		const timer = setInterval(() => sendTyping(target, 'recording'), PING_MS);
		return () => clearInterval(timer);
	});

	const note = $derived(session.note);
	const reviewTrack = $derived(note?.url ? trackOf(note, me) : null);

	onMount(() => {
		let gone = false;
		const unwatch = session.watchPermission();
		// recordings left here before (left the chat, a reload, a crash): the newest comes back
		// for review, those whose send didn't go through as unsent messages
		if (draftPrefix)
			void session.restoreDrafts(draftPrefix, {
				gone: () => gone,
				onunsent: onunsent ?? (() => {})
			});
		return () => {
			gone = true;
			unwatch();
			// left mid-recording: it stops and stays as a draft for when the chat is opened again
			session.dispose();
		};
	});

	const iconButton =
		'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-white/10 focus-visible:bg-white/10';
	const keepFocus = (e: MouseEvent) => e.preventDefault();
</script>

<svelte:window onkeydowncapture={onKeydown} />

<p class="sr-only" aria-live="polite">{session.spoken}</p>

{#if shown}
	<!-- over the image button and the field, which stay (and keep the focus) underneath. The
		mousedown handler only keeps the focus there -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="absolute bottom-0 left-0 right-[56px] z-10 flex min-h-[46px] items-center gap-[5px] rounded-[10px] border border-line bg-background px-[5px] select-none [-webkit-touch-callout:none]"
		role="group"
		aria-label="Voice note recorder"
		onmousedown={keepFocus}
	>
		{#if session.binning}
			<span class="bin flex items-center px-2.5 text-danger"><Trash size={20} /></span>
		{:else if reviewing && reviewTrack}
			<button
				type="button"
				class="{iconButton} text-danger"
				aria-label="Delete voice message"
				title="Delete"
				onclick={() => session.discard(true)}><Trash size={20} /></button
			>
			<div class="min-w-0 flex-1 py-[5px] pr-[5px]">
				<VoiceNotePlayer track={reviewTrack} compact fill />
			</div>
		{:else}
			{#if locked}
				<button
					type="button"
					class="{iconButton} text-danger"
					aria-label="Delete recording"
					title="Delete"
					onclick={() => session.discard(true)}><Trash size={20} /></button
				>
			{/if}
			<RecordingMeter {recorder} fill={locked} class={locked ? '' : 'pl-2'} />
			{#if holding}
				<!-- follows the finger and fades as it nears the point where letting go cancels -->
				<span
					class="flex min-w-0 flex-1 items-center justify-center gap-0.5 text-[0.85em] whitespace-nowrap text-muted"
					style:transform="translateX({dx}px)"
					style:opacity={gesture ? Math.max(0, 1 + dx / gesture.cancelAt) : 1}
					><ChevronLeft size={16} class="slide-hint" />Slide to cancel</span
				>
			{:else}
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
					title={phase === 'paused' ? 'Resume (Space)' : 'Pause (Space)'}
					disabled={phase === 'requesting'}
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
					onclick={() => session.stopToReview()}><Square size={16} class="fill-current" /></button
				>
			{/if}
		{/if}
	</div>
{/if}

{#if holding}
	<!-- slide up onto it to keep recording hands free -->
	<div
		class="pointer-events-none absolute right-0 bottom-full z-10 mb-2.5 flex w-[46px] flex-col items-center gap-1 rounded-full border border-line bg-background py-2.5 text-muted"
		style:transform="translateY({Math.max(-LOCK_PX / 2, dy / 2)}px)"
		style:opacity={1 - Math.min(0.5, -dy / LOCK_PX / 2)}
		aria-hidden="true"
	>
		<Lock size={18} class={-dy > LOCK_PX * 0.75 ? 'text-accent' : ''} />
		<ChevronUp size={16} class="lock-hint" />
	</div>
{/if}

{#if session.hint && !holding}
	<p
		class="absolute right-0 bottom-full z-20 mb-2.5 max-w-[min(20rem,calc(100vw-40px))] rounded-[5px] border border-accent bg-background p-2.5 text-[0.9em]"
		role="status"
	>
		{session.hint}
	</p>
{/if}

{#if session.micError && !recorder.active}
	<VoiceMicError
		error={session.micError}
		class="absolute right-0 bottom-full left-0 z-20 mb-2.5"
		onclose={() => (session.micError = null)}
	/>
{/if}

{#if showMic || session.shown}
	<!-- the mic while idle and held, send while hands free or reviewing. The same element all
		along: it keeps the pointer from the press to the release -->
	<button
		bind:this={button}
		type="button"
		class="mic relative z-10 flex size-[46px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] bg-accent text-background outline-none hover:brightness-110 focus-visible:brightness-110 {holding
			? 'scale-125'
			: ''} {holding ? '' : 'transition-transform duration-150'}"
		style:translate={holding ? `${dx}px ${dy}px` : undefined}
		aria-label={recorder.active && !holding ? 'Send voice message' : 'Record a voice message'}
		title={recorder.active && !holding
			? 'Send (Enter)'
			: 'Hold to record, release to send. Click to record hands free.'}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
		onlostpointercapture={onPointerCancel}
		onclick={onClick}
		onmousedown={keepFocus}
		ontouchend={(e) => {
			// the click a touch makes would move the focus (closing the keyboard) and send
			if (suppressClick && e.cancelable) e.preventDefault();
		}}
		oncontextmenu={(e) => e.preventDefault()}
		>{#if recorder.active && !holding}<SendHorizontal size={18} />{:else}<Mic
				size={20}
			/>{/if}</button
	>
{/if}

<style>
	/* the long press menu, the magnifier and scrolling stay out of a held mic */
	.mic {
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
	}
	:global(.slide-hint) {
		animation: nudge-left 1.2s ease-in-out infinite;
	}
	@keyframes nudge-left {
		50% {
			transform: translateX(-3px);
		}
	}
	:global(.lock-hint) {
		animation: nudge-up 1.2s ease-in-out infinite;
	}
	@keyframes nudge-up {
		50% {
			transform: translateY(-3px);
		}
	}
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
		.bin,
		:global(.slide-hint),
		:global(.lock-hint) {
			animation: none;
		}
	}
</style>
