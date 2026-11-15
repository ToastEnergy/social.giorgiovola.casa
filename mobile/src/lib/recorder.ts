import {
	getRecordingPermissionsAsync,
	requestRecordingPermissionsAsync,
	RecordingPresets,
	useAudioRecorder,
	type RecordingOptions
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { Easing, useSharedValue, withTiming } from 'react-native-reanimated';
import { endRecordingMode, recordingMode } from './audioSession';
import { duration } from './format';
import { pause as pausePlayback } from './voicePlayer';
import { discardVoice, type LocalVoice } from './voiceUpload';

/**
 * Recording a voice note (docs/voice-notes-plan.md, section 5), the native side of the web's
 * recorder: idle → requesting (the microphone permission) → recording (hold or locked) ⇄ paused →
 * review, or straight back to idle with the recording when a hold is released. Uploading and
 * sending is the caller's (src/lib/voiceUpload.ts).
 *
 * Never sends by itself and never loses audio: an interruption (a call, Siri, another app taking
 * the microphone, the media services resetting, a headset coming or going, a hold while the app
 * goes to the background) stops into review. A locked recording goes on in the background.
 */

export type Phase = 'idle' | 'requesting' | 'recording' | 'paused' | 'review';
export type Mode = 'hold' | 'locked';
export type Permission = 'granted' | 'undetermined' | 'denied';

/** bars of the live waveform */
export const LIVE_BARS = 40;
/** how often the level is read: one bar each time */
export const SAMPLE_MS = 100;
/** a press shorter than this is a tap: nothing is sent */
export const MIN_MS = 600;
export const MAX_MS_DEFAULT = 60 * 60 * 1000;
const KEEP_AWAKE = 'voice-recording';
/** how often others are told "recording…" (the server shows it a few seconds) */
const PING_MS = 3500;

export const TAP_HINT = 'Hold to record, release to send. Slide up to lock.';
export const PERMISSION_HINT = 'Now hold to record';

// AAC in M4A, mono: what the server transcodes from anyway (to 48 kbps mono)
const OPTIONS: RecordingOptions = {
	...RecordingPresets.HIGH_QUALITY,
	numberOfChannels: 1,
	sampleRate: 44100,
	bitRate: 64000,
	isMeteringEnabled: true,
	// kept safe from the system's cache cleanups: an unsent note is a draft
	directory: 'document'
};

export type RecorderState = {
	phase: Phase;
	mode: Mode;
	/** the first audio arrived: the timer runs from there (no clipped first word) */
	started: boolean;
	/** recorded so far, in whole seconds */
	seconds: number;
	/** in review: the recording */
	voice: LocalVoice | null;
	/** a tooltip: the tap hint, "Now hold to record" */
	hint: string | null;
	permission: Permission;
	/** why it stopped by itself (an interruption, the limit) or couldn't start */
	notice: string | null;
};

const haptic = {
	start: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
	lock: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
	light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
	tick: () => Haptics.selectionAsync().catch(() => {}),
	warn: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
	done: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
};
export const recorderHaptic = haptic;

const announce = (text: string) => AccessibilityInfo.announceForAccessibility(text);

/** decibels (-160 to 0) to a bar height, 0 to 1: speech sits around -35 to -10 dB */
function level(db: number | undefined) {
	if (db === undefined || !Number.isFinite(db)) return 0;
	const share = Math.max(0, Math.min(1, (db + 50) / 45));
	return Math.pow(share, 1.4);
}

async function permissionNow(): Promise<Permission> {
	try {
		const p = await getRecordingPermissionsAsync();
		return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
	} catch {
		return 'undetermined';
	}
}

type Options = {
	/** the server's limit (instance.voice_notes.max_duration_ms) */
	maxMs?: number;
	/** every few seconds while recording: tell the others ("recording…") */
	onPing?: () => void;
	/** a recording landed in review by itself or by stop: keep it as a draft */
	onReview?: (voice: LocalVoice) => void;
};

/** The recorder of a screen (a chat's input, a composer). */
export function useVoiceRecorder(options: Options = {}) {
	const recorder = useAudioRecorder(OPTIONS);
	const opts = useRef(options);
	opts.current = options;
	const maxMs = options.maxMs ?? MAX_MS_DEFAULT;

	const [state, setState] = useState<RecorderState>({
		phase: 'idle',
		mode: 'hold',
		started: false,
		seconds: 0,
		voice: null,
		hint: null,
		permission: 'undetermined',
		notice: null
	});
	const stateRef = useRef(state);
	stateRef.current = state;
	const update = useCallback((next: Partial<RecorderState>) => {
		stateRef.current = { ...stateRef.current, ...next };
		setState(stateRef.current);
	}, []);

	/** the live waveform, read on the UI thread: the last LIVE_BARS levels and the scroll offset */
	const levels = useSharedValue<number[]>(new Array(LIVE_BARS).fill(0));
	const scroll = useSharedValue(0);

	const run = useRef({
		pressedAt: 0,
		starting: null as Promise<boolean> | null,
		timer: null as ReturnType<typeof setInterval> | null,
		/** the recorder said it's recording at least once (a false after that is an interruption) */
		seen: false,
		stopping: false,
		peaks: [] as number[],
		durationMs: 0,
		input: null as string | null,
		ticks: 0,
		lastPing: 0,
		warned: 0
	});

	// the permission, without asking: refreshed when coming back (from Settings, say)
	useEffect(() => {
		let live = true;
		const check = () =>
			permissionNow().then((permission) => {
				if (live && stateRef.current.permission !== permission) update({ permission });
			});
		check();
		const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
		return () => {
			live = false;
			sub.remove();
		};
	}, [update]);

	const stopPolling = () => {
		const r = run.current;
		if (r.timer) clearInterval(r.timer);
		r.timer = null;
	};

	/** stops the recorder and answers the recording (null when there's nothing usable) */
	const stopRecorder = useCallback(async (): Promise<LocalVoice | null> => {
		const r = run.current;
		if (r.starting && !(await r.starting)) return null;
		r.starting = null;
		stopPolling();
		r.stopping = true;
		let durationMs = r.durationMs;
		try {
			durationMs = Math.max(durationMs, recorder.getStatus().durationMillis);
		} catch {
			// the recorder is gone (media services reset): what was measured stays
		}
		try {
			await recorder.stop();
		} catch {
			// already stopped by the system: the file is what was written
		}
		deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
		await endRecordingMode();
		r.stopping = false;
		const uri = recorder.uri;
		if (!uri) return null;
		return { uri, duration_ms: Math.round(durationMs), peaks: r.peaks };
	}, [recorder]);

	/** stops into review (stop, an interruption, the limit, the app leaving with a hold) */
	const toReview = useCallback(
		async (notice: string | null = null) => {
			const voice = await stopRecorder();
			if (!voice || voice.duration_ms < 300) {
				if (voice) discardVoice(voice);
				update({ phase: 'idle', voice: null, notice: notice && 'The recording was interrupted.' });
				return null;
			}
			update({ phase: 'review', voice, notice });
			announce(notice ?? `Recording stopped, ${duration(voice.duration_ms / 1000)}. Review it`);
			opts.current.onReview?.(voice);
			return voice;
		},
		[stopRecorder, update]
	);

	const sample = useCallback(() => {
		const r = run.current;
		if (r.stopping || stateRef.current.phase !== 'recording') return;
		let status;
		try {
			status = recorder.getStatus();
		} catch {
			toReview('The recording was interrupted.');
			return;
		}
		if (status.mediaServicesDidReset) {
			toReview('The recording was interrupted.');
			return;
		}
		if (!status.isRecording) {
			// stopped or paused by someone else: a call, Siri, the notification's stop button
			if (r.seen) toReview('The recording was interrupted.');
			return;
		}
		r.seen = true;
		r.durationMs = status.durationMillis;
		const height = level(status.metering);
		r.peaks.push(Math.round(height * 255));
		levels.value = [...levels.value.slice(1), height];
		// the bars glide one step left until the next sample: smooth on the UI thread
		scroll.value = 1;
		scroll.value = withTiming(0, { duration: SAMPLE_MS, easing: Easing.linear });

		const s = stateRef.current;
		const seconds = Math.floor(status.durationMillis / 1000);
		if (!s.started && status.durationMillis > 0) update({ started: true, seconds });
		else if (seconds !== s.seconds) update({ seconds });

		const left = maxMs - status.durationMillis;
		if (left <= 60_000 && r.warned < 1) {
			r.warned = 1;
			haptic.warn();
			announce('One minute left');
		} else if (left <= 10_000 && r.warned < 2) {
			r.warned = 2;
			haptic.warn();
			announce('Ten seconds left');
		}
		if (left <= 0) {
			haptic.done();
			toReview('That’s the longest a voice note can be.');
			return;
		}
		const now = Date.now();
		if (now - r.lastPing > PING_MS) {
			r.lastPing = now;
			opts.current.onPing?.();
		}
		// a headset plugged in or out (iOS records on with the new input): stop into review
		if (Platform.OS === 'ios' && ++r.ticks % 10 === 0)
			recorder
				.getCurrentInput()
				.then((input) => {
					if (!r.input) r.input = input.uid;
					else if (input.uid !== r.input && stateRef.current.phase === 'recording')
						toReview('The microphone changed.');
				})
				.catch(() => {});
	}, [recorder, levels, scroll, maxMs, update, toReview]);

	const startPolling = useCallback(() => {
		stopPolling();
		run.current.timer = setInterval(sample, SAMPLE_MS);
	}, [sample]);

	const begin = useCallback(
		(mode: Mode) => {
			const r = run.current;
			pausePlayback();
			r.pressedAt = Date.now();
			r.seen = false;
			r.stopping = false;
			r.peaks = [];
			r.durationMs = 0;
			r.input = null;
			r.ticks = 0;
			r.lastPing = 0;
			r.warned = 0;
			levels.value = new Array(LIVE_BARS).fill(0);
			update({
				phase: 'recording',
				mode,
				started: false,
				seconds: 0,
				voice: null,
				hint: null,
				notice: null
			});
			haptic.start();
			announce(mode === 'locked' ? 'Recording' : 'Recording. Release to send');
			r.starting = (async () => {
				try {
					await recordingMode();
					await recorder.prepareToRecordAsync({
						...OPTIONS,
						fileName: `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
					});
					recorder.record({ forDuration: maxMs / 1000 });
					activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
					r.lastPing = 0;
					startPolling();
					return true;
				} catch {
					await endRecordingMode();
					update({ phase: 'idle', notice: 'Couldn’t start recording.' });
					return false;
				}
			})();
		},
		[recorder, levels, update, startPolling, maxMs]
	);

	const askPermission = useCallback(async () => {
		update({ phase: 'requesting', hint: null, notice: null });
		let permission: Permission;
		try {
			const p = await requestRecordingPermissionsAsync();
			permission = p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
		} catch {
			permission = 'denied';
		}
		update({ phase: 'idle', permission });
		return permission === 'granted';
	}, [update]);

	/** a finger on the mic (hold to record): the first time, only the permission is asked */
	const press = useCallback(() => {
		const s = stateRef.current;
		if (s.phase !== 'idle') return false;
		if (s.permission !== 'granted') {
			askPermission().then((granted) => {
				if (granted) {
					update({ hint: PERMISSION_HINT });
					announce(PERMISSION_HINT);
				}
			});
			return false;
		}
		begin('hold');
		return true;
	}, [askPermission, begin, update]);

	/** a tap on the mic of a composer: records at once, locked (asking the permission first) */
	const startLocked = useCallback(async () => {
		const s = stateRef.current;
		if (s.phase !== 'idle') return;
		if (s.permission !== 'granted' && !(await askPermission())) return;
		begin('locked');
	}, [askPermission, begin]);

	/** the hold is over: answers the recording to send, or null (a tap, nothing recorded) */
	const release = useCallback(async () => {
		const s = stateRef.current;
		if (s.phase !== 'recording' || s.mode !== 'hold') return null;
		const held = Date.now() - run.current.pressedAt;
		const voice = await stopRecorder();
		if (held < MIN_MS || !voice || voice.duration_ms < 300) {
			if (voice) discardVoice(voice);
			update({ phase: 'idle', hint: TAP_HINT });
			haptic.light();
			announce(TAP_HINT);
			return null;
		}
		update({ phase: 'idle' });
		haptic.light();
		return voice;
	}, [stopRecorder, update]);

	/** slid to cancel, or the trash: thrown away */
	const cancel = useCallback(async () => {
		const s = stateRef.current;
		if (s.phase === 'idle' || s.phase === 'requesting') return;
		const voice = s.phase === 'review' ? s.voice : await stopRecorder();
		if (voice) discardVoice(voice);
		update({ phase: 'idle', voice: null, notice: null });
		haptic.warn();
		announce('Voice note deleted');
	}, [stopRecorder, update]);

	const lock = useCallback(() => {
		const s = stateRef.current;
		if (s.phase !== 'recording' || s.mode === 'locked') return;
		update({ mode: 'locked' });
		haptic.lock();
		announce('Recording locked. Pause, stop to review, delete or send');
	}, [update]);

	const pause = useCallback(() => {
		if (stateRef.current.phase !== 'recording') return;
		stopPolling();
		try {
			recorder.pause();
		} catch {
			// gone: the next stop keeps what was written
		}
		update({ phase: 'paused' });
		haptic.tick();
		announce('Paused');
	}, [recorder, update]);

	const resume = useCallback(() => {
		if (stateRef.current.phase !== 'paused') return;
		try {
			recorder.record();
		} catch {
			toReview('Couldn’t resume: review what was recorded.');
			return;
		}
		run.current.seen = false;
		update({ phase: 'recording' });
		startPolling();
		haptic.tick();
		announce('Recording');
	}, [recorder, update, startPolling, toReview]);

	/** locked: stop into review */
	const stop = useCallback(() => {
		const phase = stateRef.current.phase;
		if (phase !== 'recording' && phase !== 'paused') return Promise.resolve(null);
		haptic.tick();
		return toReview();
	}, [toReview]);

	/** sending from locked or review: answers the recording and goes back to idle */
	const take = useCallback(async () => {
		const s = stateRef.current;
		let voice: LocalVoice | null = null;
		if (s.phase === 'review') voice = s.voice;
		else if (s.phase === 'recording' || s.phase === 'paused') voice = await stopRecorder();
		update({ phase: 'idle', voice: null, notice: null });
		if (voice && voice.duration_ms < 300) {
			discardVoice(voice);
			return null;
		}
		if (voice) haptic.light();
		return voice;
	}, [stopRecorder, update]);

	/** a draft back in review */
	const restore = useCallback(
		(voice: LocalVoice) => {
			if (stateRef.current.phase !== 'idle') return;
			update({ phase: 'review', mode: 'locked', voice, notice: null });
		},
		[update]
	);

	/** forgets the one in review without deleting it (it's a draft elsewhere) */
	const reset = useCallback(() => update({ phase: 'idle', voice: null, notice: null }), [update]);

	const clearHint = useCallback(() => update({ hint: null, notice: null }), [update]);

	// the app leaves: a hold can't go on (the finger is gone), a paused one is finished so it's
	// kept whole if the system ends the app. a locked recording goes on in the background
	useEffect(() => {
		const sub = AppState.addEventListener('change', (next) => {
			if (next !== 'background') return;
			const s = stateRef.current;
			if ((s.phase === 'recording' && s.mode === 'hold') || s.phase === 'paused') toReview();
		});
		return () => sub.remove();
	}, [toReview]);

	// the screen goes away while recording: keep it as a draft
	useEffect(
		() => () => {
			const phase = stateRef.current.phase;
			if (phase === 'recording' || phase === 'paused') {
				stopPolling();
				const r = run.current;
				const uri = recorder.uri;
				recorder
					.stop()
					.catch(() => {})
					.finally(() => {
						deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
						endRecordingMode();
					});
				if (uri) opts.current.onReview?.({ uri, duration_ms: r.durationMs, peaks: r.peaks });
			}
		},
		[recorder]
	);

	return {
		state,
		levels,
		scroll,
		maxMs,
		press,
		release,
		startLocked,
		cancel,
		lock,
		pause,
		resume,
		stop,
		take,
		restore,
		reset,
		clearHint
	};
}

export type VoiceRecorder = ReturnType<typeof useVoiceRecorder>;
