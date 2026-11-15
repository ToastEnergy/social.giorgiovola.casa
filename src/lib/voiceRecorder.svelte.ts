import { pause as pausePlayback } from './audioPlayer.svelte.js';

/**
 * Recording a voice note in the browser: the microphone, MediaRecorder, the live levels for the
 * waveform, the screen wake lock and everything that can interrupt a recording. Pure logic, so
 * the chat input and (later) the post composers share it.
 *
 *   idle → requesting → recording (hold | locked) ⇄ paused → review → idle
 *
 * Uploading (and so `uploading → sent | failed`) belongs to the note (voiceNote.svelte.ts): a
 * sent note leaves the recorder, which is free again at once.
 *
 * Never auto-sends and never loses audio: an interruption (a call, the tab hidden, the mic
 * unplugged or taken by another app) stops a held recording into review and pauses a locked one.
 * The recording comes out in parts of about 5 seconds (`onpart`) while it's made, so it can be
 * uploaded and saved as it goes.
 */

export type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'paused' | 'review';
/** hold: a finger on the mic, letting go sends. locked: hands free, sent from the buttons */
export type RecordMode = 'hold' | 'locked';
export type MicError = 'denied' | 'nomic' | 'failed';

/**
 * Set while a recording uses the mic: the bottom bar, pull to refresh and the chat's message
 * gestures stand still, so a slip of the finger doesn't leave or act mid-recording.
 */
export const voiceCapture = $state({ active: false });

/** the longest a note may be */
export const MAX_MS = 60 * 60 * 1000;
/** about this much audio per part */
const PART_MS = 5000;
/** a MediaRecorder slice: what's lost at most if the page dies between two */
const SLICE_MS = 250;
/** a live bar per this long */
const BAR_MS = 100;

// the first of these the browser records and can also play (for the review): Chrome, Firefox and
// Android give WebM/Opus, Safari MP4/AAC. The server transcodes them all
const TYPES = [
	'audio/webm;codecs=opus',
	'audio/mp4;codecs=mp4a.40.2',
	'audio/mp4',
	'audio/ogg;codecs=opus'
];

/** The recording, once it stopped. */
export type Recording = { durationMs: number; waveform: number[] };

/** Can this browser record at all? (No mic button otherwise.) */
export function canRecord() {
	return (
		typeof window !== 'undefined' &&
		window.isSecureContext &&
		typeof MediaRecorder !== 'undefined' &&
		!!navigator.mediaDevices?.getUserMedia
	);
}

function pickType() {
	const audio = document.createElement('audio');
	const supported = TYPES.filter((t) => MediaRecorder.isTypeSupported?.(t));
	return supported.find((t) => audio.canPlayType(t) !== '') ?? supported[0] ?? '';
}

export type MicPermission = 'granted' | 'denied' | 'prompt';
const GRANTED_KEY = 'voice-mic-granted';

/**
 * Whether the mic may be used without asking: the Permissions API where it knows (Chrome,
 * Safari), else whether it was granted here before (Firefox). The first press of the mic only
 * asks (the browser's prompt would break a hold anyway).
 */
export async function micPermission(): Promise<MicPermission> {
	try {
		return (await micStatus()).state;
	} catch {
		try {
			return localStorage.getItem(GRANTED_KEY) ? 'granted' : 'prompt';
		} catch {
			return 'prompt';
		}
	}
}

/** The browser's permission state for the mic, which says when it changes (where supported). */
export const micStatus = () =>
	navigator.permissions.query({ name: 'microphone' as PermissionName });

function rememberGranted() {
	try {
		localStorage.setItem(GRANTED_KEY, '1');
	} catch {
		// asked again next time
	}
}

const micError = (e: unknown): MicError => {
	const name = e instanceof DOMException ? e.name : '';
	if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'nomic';
	return 'failed';
};

/** Asks for the mic and lets go of it at once: the first press of the mic button. */
export async function requestMic(): Promise<MicPermission | MicError> {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
		rememberGranted();
		return 'granted';
	} catch (e) {
		return micError(e);
	}
}

/** A short buzz (Android; iOS browsers have no vibration API). */
export const haptic = (pattern: number | number[] = 10) => {
	try {
		navigator.vibrate?.(pattern);
	} catch {
		// not allowed without a user gesture
	}
};

/** 64 bars 0–255 from the live levels, for the review (the server measures its own later). */
function waveformOf(levels: number[], count = 64) {
	if (levels.length === 0) return new Array(count).fill(0);
	const bars: number[] = [];
	for (let i = 0; i < count; i++) {
		const from = Math.floor((i * levels.length) / count);
		const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / count));
		let peak = 0;
		for (let j = from; j < to && j < levels.length; j++) peak = Math.max(peak, levels[j]);
		bars.push(peak);
	}
	const max = Math.max(...bars, 1);
	return bars.map((b) => Math.round((b / max) * 255));
}

type Options = {
	/** the next ~5 seconds of the recording, in order: chunk 0 is the start of the file */
	onpart?: (part: Blob) => void;
	/**
	 * stopped (into review) or paused by itself: a call, the tab hidden, the mic gone, the 1 hour
	 * limit. `why` is a short reason without a full stop
	 */
	oninterrupt?: (why: string, stopped: boolean) => void;
	/** a minute (60) and 10 seconds (10) are left */
	onwarn?: (secondsLeft: number) => void;
	/** stopped into review, however (stop, an interruption, the limit): after the last part */
	onstop?: (recording: Recording) => void;
};

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

export class VoiceRecorder {
	phase: RecorderPhase = $state('idle');
	mode: RecordMode = $state('hold');
	/** audio is coming in: the timer runs (it shows 0:00 while the mic starts) */
	started = $state(false);
	/** how much has been recorded, ms */
	elapsed = $state(0);
	/** the latest bars 0–255, newest last, for the live waveform */
	levels: number[] = $state([]);
	/** what went wrong getting the mic */
	error: MicError | null = $state(null);
	/** why it stopped or paused by itself, shown with the review or the paused recorder */
	interrupted: string | null = $state(null);
	mimeType = '';

	#options: Options;
	#stream: MediaStream | null = null;
	#recorder: MediaRecorder | null = null;
	#ctx: AudioContext | null = null;
	#analyser: AnalyserNode | null = null;
	#samples: Float32Array<ArrayBuffer> | null = null;
	#wakeLock: WakeLockSentinel | null = null;
	#slices: Blob[] = [];
	#sliceMs = 0;
	/** every bar since the start, for the review's waveform */
	#history: number[] = [];
	#bucket = 0;
	#bucketStart = 0;
	#frame = 0;
	#timer: ReturnType<typeof setInterval> | undefined;
	/** when the running stretch started (performance.now), and what came before it */
	#since = 0;
	#before = 0;
	#warned = new Set<number>();
	#stopped: Promise<void> | null = null;
	#cleanup: (() => void)[] = [];
	#ending: Promise<Recording> | null = null;
	/** bumped by cancel: a start still waiting for the mic gives up */
	#run = 0;

	constructor(options: Options = {}) {
		this.#options = options;
	}

	get active() {
		return this.phase !== 'idle';
	}

	/** Recording or paused: the mic is in use. */
	get capturing() {
		return this.phase === 'requesting' || this.phase === 'recording' || this.phase === 'paused';
	}

	/**
	 * Starts recording. Call it right from the press (pointerdown or click): the audio context
	 * must be made in the gesture on iOS, and the UI shows at once while the mic starts (100–500
	 * ms), with the timer starting on the first audio, so the first word isn't clipped. Resolves
	 * false when the mic couldn't be had (`error` says why).
	 */
	async start(mode: RecordMode): Promise<boolean> {
		if (this.phase !== 'idle') return false;
		const run = ++this.#run;
		this.mode = mode;
		this.phase = 'requesting';
		this.started = false;
		this.elapsed = 0;
		this.levels = [];
		this.error = null;
		this.interrupted = null;
		this.#history = [];
		this.#slices = [];
		this.#sliceMs = 0;
		this.#before = 0;
		this.#warned.clear();
		// voice notes don't record over one playing
		pausePlayback();
		let ctx: AudioContext | null = null;
		try {
			ctx = new AudioContext();
			void ctx.resume().catch(() => {});
		} catch {
			// no levels then: the waveform stays flat, the recording works
		}
		// iOS: play-and-record while the mic is used (it goes back to auto at the end, otherwise
		// playback stays quiet, through the earpiece)
		const session = (navigator as AudioSessionNavigator).audioSession;
		if (session) session.type = 'play-and-record';

		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
					channelCount: 1
				}
			});
		} catch (e) {
			void ctx?.close().catch(() => {});
			if (session) session.type = 'auto';
			if (run !== this.#run) return false;
			this.phase = 'idle';
			this.error = micError(e);
			return false;
		}
		if (run !== this.#run) {
			// cancelled (let go) while the mic was starting
			for (const track of stream.getTracks()) track.stop();
			void ctx?.close().catch(() => {});
			if (session) session.type = 'auto';
			return false;
		}
		rememberGranted();
		this.#stream = stream;
		this.#ctx = ctx;

		if (ctx) {
			try {
				const source = ctx.createMediaStreamSource(stream);
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 1024;
				source.connect(analyser);
				this.#analyser = analyser;
				this.#samples = new Float32Array(analyser.fftSize);
			} catch {
				this.#analyser = null;
			}
		}

		this.mimeType = pickType();
		let recorder: MediaRecorder;
		try {
			recorder = new MediaRecorder(stream, {
				...(this.mimeType ? { mimeType: this.mimeType } : {}),
				audioBitsPerSecond: 64_000
			});
		} catch {
			recorder = new MediaRecorder(stream);
		}
		this.mimeType = recorder.mimeType || this.mimeType || 'audio/webm';
		this.#recorder = recorder;
		recorder.ondataavailable = (e) => this.#onData(e.data);
		recorder.onstart = () => {
			this.started = true;
			this.#since = performance.now();
			this.#bucketStart = this.#since;
		};
		recorder.onerror = () => this.#interrupt('The recorder failed', true);
		this.#listen(stream);
		this.#holdScreen();
		recorder.start(SLICE_MS);
		this.phase = 'recording';
		this.#timer = setInterval(() => this.#tick(), 100);
		this.#frame = requestAnimationFrame(this.#levels);
		return true;
	}

	/** Hands free: letting go no longer sends. */
	lock() {
		if (this.phase === 'recording' || this.phase === 'requesting') this.mode = 'locked';
	}

	pause() {
		if (this.phase !== 'recording' || this.#recorder?.state !== 'recording') return;
		this.#before += this.started ? performance.now() - this.#since : 0;
		this.elapsed = this.#before;
		// what was recorded so far becomes a part (saved and uploaded) while paused
		this.#recorder.requestData();
		this.#recorder.pause();
		this.phase = 'paused';
	}

	resume() {
		if (this.phase !== 'paused' || this.#recorder?.state !== 'paused') return;
		// the mic may have gone while paused
		if (!this.#stream?.getAudioTracks().some((t) => t.readyState === 'live')) {
			void this.stop();
			return;
		}
		this.interrupted = null;
		void this.#ctx?.resume().catch(() => {});
		this.#since = performance.now();
		this.#bucketStart = this.#since;
		this.#recorder.resume();
		this.phase = 'recording';
		this.#holdScreen();
	}

	/**
	 * Stops into review: the last of the audio comes out as a part and the mic is let go (the
	 * system's mic indicator goes away). Resolves to the recording, null when there was none.
	 */
	async stop(): Promise<Recording | null> {
		if (this.phase === 'requesting') {
			this.cancel();
			return null;
		}
		if (this.phase !== 'recording' && this.phase !== 'paused') return null;
		// already stopping (an interruption while letting go): the same end
		if (this.#ending) return this.#ending;
		this.#ending = this.#end().finally(() => (this.#ending = null));
		return this.#ending;
	}

	async #end(): Promise<Recording> {
		const recorder = this.#recorder;
		if (this.phase === 'recording')
			this.#before += this.started ? performance.now() - this.#since : 0;
		this.elapsed = Math.min(MAX_MS, this.#before);
		if (recorder && recorder.state !== 'inactive') {
			this.#stopped ??= new Promise<void>((resolve) => {
				recorder.addEventListener('stop', () => resolve(), { once: true });
				// a recorder that never says it stopped (a track that died) mustn't hang the UI
				setTimeout(resolve, 1500);
			});
			recorder.stop();
			await this.#stopped;
		}
		this.#stopped = null;
		this.#flush();
		this.#release();
		this.phase = 'review';
		const recording = { durationMs: this.elapsed, waveform: waveformOf(this.#history) };
		this.#options.onstop?.(recording);
		return recording;
	}

	/** Throws the recording away (the note deletes what it uploaded) and lets go of the mic. */
	cancel() {
		this.#run++;
		const recorder = this.#recorder;
		if (recorder && recorder.state !== 'inactive') {
			recorder.ondataavailable = null;
			try {
				recorder.stop();
			} catch {
				// already stopped
			}
		}
		this.#slices = [];
		this.#release();
		this.phase = 'idle';
	}

	/** Back to idle after the note was sent or deleted, or to show a saved one for review. */
	reset(phase: 'idle' | 'review' = 'idle') {
		if (this.capturing) this.cancel();
		this.phase = phase;
		this.interrupted = null;
	}

	#onData(data: Blob) {
		if (data.size === 0) return;
		this.#slices.push(data);
		this.#sliceMs += SLICE_MS;
		// a part every few seconds, and on pause (requestData) so a paused note is all saved
		if (this.#sliceMs >= PART_MS || this.phase === 'paused') this.#flush();
	}

	#flush() {
		if (this.#slices.length === 0) return;
		const part = new Blob(this.#slices, { type: this.mimeType });
		this.#slices = [];
		this.#sliceMs = 0;
		this.#options.onpart?.(part);
	}

	#tick() {
		if (this.phase !== 'recording' || !this.started) return;
		this.elapsed = this.#before + performance.now() - this.#since;
		const left = MAX_MS - this.elapsed;
		for (const s of [60, 10])
			if (left <= s * 1000 && !this.#warned.has(s)) {
				this.#warned.add(s);
				this.#options.onwarn?.(s);
			}
		if (left <= 0) this.#interrupt('A voice note can be at most an hour long', true);
	}

	// the live waveform: the loudness (RMS) of what the mic hears, a bar per BAR_MS
	#levels = (now: number) => {
		this.#frame = requestAnimationFrame(this.#levels);
		if (this.phase !== 'recording' || !this.started || !this.#analyser || !this.#samples) return;
		this.#analyser.getFloatTimeDomainData(this.#samples);
		let sum = 0;
		for (const s of this.#samples) sum += s * s;
		const rms = Math.sqrt(sum / this.#samples.length);
		// speech sits around 0.02–0.2: square root and gain so it looks lively
		this.#bucket = Math.max(this.#bucket, Math.min(255, Math.sqrt(rms * 4) * 255));
		if (now - this.#bucketStart < BAR_MS) return;
		this.#bucketStart = now;
		const bar = Math.round(this.#bucket);
		this.#bucket = 0;
		this.#history.push(bar);
		const levels = this.levels.length >= 120 ? this.levels.slice(1) : this.levels.slice();
		levels.push(bar);
		this.levels = levels;
	};

	/**
	 * Something took the recording away (or is about to). `hard`: it can't go on (the mic ended,
	 * the page is going away, the time is up): it stops into review. Otherwise a held recording
	 * stops into review and a locked one pauses.
	 */
	#interrupt(why: string, hard = false) {
		if (this.phase !== 'recording' && this.phase !== 'paused') return;
		const stops = hard || this.mode === 'hold';
		this.interrupted = why;
		this.#options.oninterrupt?.(why, stops);
		if (stops) void this.stop();
		else this.pause();
	}

	#listen(stream: MediaStream) {
		const on = (target: EventTarget, event: string, fn: () => void) => {
			target.addEventListener(event, fn);
			this.#cleanup.push(() => target.removeEventListener(event, fn));
		};
		// the tab hidden, the app sent to the background, the screen locked, a call
		on(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.#interrupt('You left the app');
		});
		on(window, 'pagehide', () => this.#interrupt('You left the page', true));
		for (const track of stream.getAudioTracks()) {
			on(track, 'ended', () => this.#interrupt('The microphone stopped', true));
			// iOS mutes the track during a call or Siri
			on(track, 'mute', () => this.#interrupt('The microphone was interrupted'));
		}
		// headphones unplugged, a Bluetooth headset gone: is the mic still there?
		on(navigator.mediaDevices, 'devicechange', async () => {
			const track = stream.getAudioTracks()[0];
			const id = track?.getSettings().deviceId;
			if (!track || track.readyState === 'ended')
				return this.#interrupt('The microphone was disconnected', true);
			if (!id) return;
			const devices = await navigator.mediaDevices.enumerateDevices().catch(() => null);
			if (devices && !devices.some((d) => d.kind === 'audioinput' && d.deviceId === id))
				this.#interrupt('The microphone was disconnected');
		});
		if (this.#ctx)
			// Safari's "interrupted" (a call, another app taking audio)
			on(this.#ctx, 'statechange', () => {
				const state = this.#ctx?.state as string | undefined;
				if (state === 'interrupted') this.#interrupt('Another app took the audio');
			});
	}

	/** Keeps the screen on while recording (released when it stops or the tab is hidden). */
	#holdScreen() {
		if (this.#wakeLock || !('wakeLock' in navigator)) return;
		navigator.wakeLock
			.request('screen')
			.then((lock) => {
				if (this.capturing) this.#wakeLock = lock;
				else void lock.release();
				lock.addEventListener('release', () => {
					if (this.#wakeLock === lock) this.#wakeLock = null;
				});
			})
			.catch(() => {
				// refused (battery saver, not visible): the screen may sleep
			});
	}

	#release() {
		clearInterval(this.#timer);
		cancelAnimationFrame(this.#frame);
		for (const off of this.#cleanup) off();
		this.#cleanup = [];
		for (const track of this.#stream?.getTracks() ?? []) track.stop();
		this.#stream = null;
		this.#recorder = null;
		this.#analyser = null;
		void this.#ctx?.close().catch(() => {});
		this.#ctx = null;
		void this.#wakeLock?.release().catch(() => {});
		this.#wakeLock = null;
		const session = (navigator as AudioSessionNavigator).audioSession;
		if (session) session.type = 'auto';
	}
}
