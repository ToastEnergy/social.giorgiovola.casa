import { isCurrent, stop as stopPlayback, type Track } from './audioPlayer.svelte.js';
import type { ChatPeer } from './types.js';
import { loadVoiceDrafts } from './voiceDraft.js';
import { sendingDrafts, VoiceNote } from './voiceNote.svelte.js';
import {
	haptic,
	micPermission,
	micStatus,
	voiceCapture,
	VoiceRecorder,
	type MicError,
	type MicPermission
} from './voiceRecorder.svelte.js';

/**
 * A recorder and the note it makes, with what goes around them: the mic permission and its
 * errors, the hints (an interruption, the time running out), what a screen reader hears, and
 * the drafts left from before. Shared by the chat input (VoiceRecorder.svelte) and the post
 * composers (ComposerVoice.svelte), which only differ in how a recording starts and is sent.
 *
 * Make it during a component's init: it runs effects (what's announced, `voiceCapture`).
 */

// deleting more than this asks first (Escape, the back button)
const CONFIRM_MS = 5000;

/** Where the "turn the mic back on" instructions point to. */
export const platform: 'ios' | 'android' | 'desktop' = (() => {
	if (typeof navigator === 'undefined') return 'desktop';
	const ua = navigator.userAgent;
	if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
		return 'ios';
	return /Android/.test(ua) ? 'android' : 'desktop';
})();

/** What the shared player plays for a note that isn't sent yet. */
export const trackOf = (note: VoiceNote, sender: ChatPeer): Track => ({
	note: {
		url: note.url ?? '',
		duration_ms: note.durationMs,
		waveform: note.waveform,
		size: note.size
	},
	sender
});

/** Stops the shared player if it plays this note (it's sent, deleted or put away). */
function stopIfPlaying(note: VoiceNote) {
	if (note.url && isCurrent(trackOf(note, { username: '', name: '', avatar: null }).note))
		stopPlayback();
}

type RestoreOptions = {
	/** the component went away (or moved on to another conversation) meanwhile */
	gone: () => boolean;
	/** this draft first (the one the composer's draft names) */
	prefer?: string | null;
	/** whether a note may be put back for review now (nothing else attached) */
	accept?: () => boolean;
	/**
	 * a note whose send didn't finish (a reload mid-send): the chat shows it as an unsent message.
	 * Without it, it comes back for review like any other draft
	 */
	onunsent?: (note: VoiceNote) => void;
	/** said when a note comes back for review */
	message?: string;
};

export class VoiceSession {
	readonly recorder: VoiceRecorder;
	/** the note being recorded or reviewed */
	note: VoiceNote | null = $state(null);
	/** the tooltip: why it stopped by itself, "Now hold to record", too short */
	hint: string | null = $state(null);
	/** what a screen reader hears (the timer itself isn't read out every second) */
	spoken = $state('');
	permission: MicPermission = $state('prompt');
	micError: MicError | null = $state(null);
	/** the trash animation after a delete */
	binning = $state(false);

	#draftPrefix: () => string | null;
	#hintTimer: ReturnType<typeof setTimeout> | undefined;
	#binTimer: ReturnType<typeof setTimeout> | undefined;

	/** `draftPrefix`: where its drafts are saved (voiceDraftPrefix), null while not saved */
	constructor(draftPrefix: () => string | null) {
		this.#draftPrefix = draftPrefix;
		const recorder: VoiceRecorder = new VoiceRecorder({
			onpart: (part) => {
				// the first part makes the note (a tap that's too short never gets one)
				if (!this.note) {
					const prefix = this.#draftPrefix();
					this.note = new VoiceNote(
						recorder.mimeType,
						prefix === null ? null : `${prefix}${Date.now()}`
					);
				}
				this.note.addPart(part);
				// what the draft says of its length and look, for a crash
				this.note.durationMs = recorder.elapsed;
				this.note.save();
			},
			oninterrupt: (why, stopped) => {
				haptic([30, 60, 30]);
				this.say(
					`${why}: ${
						stopped
							? 'the recording stopped. Listen to it, then send it or delete it'
							: 'the recording is paused'
					}.`,
					5000
				);
			},
			onwarn: (left) => {
				haptic([30, 60, 30]);
				this.announce(left === 60 ? 'One minute left' : '10 seconds left');
			},
			// in review now: the note is whole, its upload finishes (or starts, for a short one)
			onstop: (recording) => {
				if (this.note) this.note.finish(recording.durationMs, recording.waveform);
				// nothing came out of the mic
				else queueMicrotask(() => recorder.reset());
			}
		});
		this.recorder = recorder;

		$effect(() => {
			const phase = recorder.phase;
			if (phase === 'recording')
				this.announce(recorder.mode === 'locked' ? 'Recording, hands free' : 'Recording');
			else if (phase === 'paused') this.announce('Recording paused');
			else if (phase === 'review')
				this.announce('Recording stopped. Play it back, delete it or send it.');
		});
		// the bottom bar, pull to refresh and the chat's gestures stand still meanwhile
		$effect(() => {
			voiceCapture.active = this.capturing;
			return () => (voiceCapture.active = false);
		});
	}

	get phase() {
		return this.recorder.phase;
	}
	/** the mic is in use (or being asked for) */
	get capturing() {
		return this.recorder.capturing;
	}
	get holding() {
		return this.capturing && this.recorder.mode === 'hold';
	}
	get locked() {
		return this.capturing && this.recorder.mode === 'locked';
	}
	get reviewing() {
		return this.recorder.phase === 'review';
	}
	/** something to show: recording, reviewing, or the bin of one just deleted */
	get shown() {
		return this.recorder.active || this.binning;
	}

	say(text: string, ms = 2500) {
		this.hint = text;
		clearTimeout(this.#hintTimer);
		this.#hintTimer = setTimeout(() => (this.hint = null), ms);
		this.announce(text);
	}

	announce(text: string) {
		this.spoken = text;
	}

	/** Records hands free, asking for the mic first if needed. Call it right from the click. */
	async startLocked() {
		this.hint = null;
		const ok = await this.recorder.start('locked');
		if (ok) {
			haptic(12);
			this.micError = null;
			this.permission = 'granted';
		} else this.failed();
		return ok;
	}

	/** The mic couldn't be had: the error panel says why. */
	failed() {
		const error = this.recorder.error;
		if (error) this.micError = error;
		if (error === 'denied') this.permission = 'denied';
	}

	/** Stops into review; the upload starts now, so sending is instant. */
	async stopToReview() {
		const recording = await this.recorder.stop();
		if (!recording || !this.note) this.cancelQuietly();
	}

	togglePause() {
		if (this.phase === 'recording') this.recorder.pause();
		else if (this.phase === 'paused') this.recorder.resume();
	}

	/** Throws the recording away: `animated` with the bin and a buzz. */
	discard(animated = false) {
		const gone = this.note;
		this.note = null;
		if (gone) {
			stopIfPlaying(gone);
			gone.discard();
		}
		this.recorder.reset();
		if (animated) {
			haptic([20, 40, 20]);
			this.binning = true;
			clearTimeout(this.#binTimer);
			this.#binTimer = setTimeout(() => (this.binning = false), 450);
		}
		this.announce('Voice note deleted');
	}

	/** Throws away a recording nobody meant to make (a tap, a mic that didn't start). */
	cancelQuietly() {
		this.note?.discard();
		this.note = null;
		this.recorder.reset();
	}

	/** Escape, the back button: deleting more than a few seconds asks first. */
	confirmDiscard() {
		const long = (this.reviewing ? this.note?.durationMs ?? 0 : this.recorder.elapsed) > CONFIRM_MS;
		if (long && !confirm('Discard voice note?')) return false;
		this.discard();
		return true;
	}

	/**
	 * Takes the note out to send it (stopping the recording first): the recorder is free again
	 * at once. Null when there's nothing to send.
	 */
	async take(): Promise<VoiceNote | null> {
		if (this.capturing) {
			const recording = await this.recorder.stop();
			if (!recording || !this.note) {
				this.cancelQuietly();
				return null;
			}
		}
		const note = this.note;
		if (!note) return null;
		this.note = null;
		this.hint = null;
		stopIfPlaying(note);
		this.recorder.reset();
		return note;
	}

	/** Puts a note back for review (a send that didn't go through). */
	put(note: VoiceNote) {
		if (this.recorder.active) return false;
		this.note = note;
		this.recorder.reset('review');
		return true;
	}

	/**
	 * Lets go of the note without deleting it (it stays a draft where it was saved): the composer
	 * moved on to another post. A recording stops into review first.
	 */
	async putAway() {
		if (this.capturing) await this.recorder.stop();
		const note = this.note;
		this.note = null;
		if (note) stopIfPlaying(note);
		this.recorder.reset();
	}

	/** Follows the mic's permission, also when it changes in the browser's settings. */
	watchPermission() {
		let gone = false;
		let status: PermissionStatus | null = null;
		const onchange = () => {
			if (status) this.permission = status.state;
			if (this.permission !== 'denied' && this.micError === 'denied') this.micError = null;
		};
		micPermission().then((state) => {
			if (gone) return;
			this.permission = state;
			micStatus()
				.then((s) => {
					if (gone) return;
					status = s;
					s.addEventListener('change', onchange);
				})
				.catch(() => {});
		});
		return () => {
			gone = true;
			status?.removeEventListener('change', onchange);
		};
	}

	/**
	 * Recordings left here before (left the page, a reload, a crash): the preferred or newest
	 * comes back for review, uploaded again so sending is instant.
	 */
	async restoreDrafts(prefix: string, options: RestoreOptions) {
		const drafts = await loadVoiceDrafts(prefix);
		if (options.prefer) {
			const at = drafts.findIndex((d) => d.meta.key === options.prefer);
			if (at > 0) drafts.unshift(...drafts.splice(at, 1));
		}
		for (const saved of drafts) {
			if (options.gone() || sendingDrafts.has(saved.meta.key)) continue;
			const restored = VoiceNote.restore(saved, saved.meta.key);
			if (await restored.alreadySent()) {
				restored.sent();
				continue;
			}
			if (options.gone()) return;
			const unsent = saved.meta.sending && !!options.onunsent;
			if (!unsent && !this.note && !this.recorder.active && (options.accept?.() ?? true)) {
				// a send cut off by a reload is a draft again
				if (restored.sending) restored.sending = false;
				this.note = restored;
				this.recorder.reset('review');
				this.say(options.message ?? 'Your voice note was kept: send it or delete it.', 4000);
				restored.upload();
			} else if (unsent) options.onunsent?.(restored);
		}
	}

	/** The component goes: a recording stops and stays a draft (onstop finishes the note). */
	dispose() {
		clearTimeout(this.#hintTimer);
		clearTimeout(this.#binTimer);
		if (this.recorder.capturing) void this.recorder.stop();
	}
}
