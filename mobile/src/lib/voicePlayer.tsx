import { setAudioModeAsync, useAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';
import { avatarUrl, instanceImage } from './api';
import { useSession } from './session';
import type { User, VoiceNote } from './types';

// the one voice note player of the app (like the web's audioPlayer.svelte.ts): one expo-audio
// player, mounted once in the root layout (VoicePlayerHost). starting a note stops the other, it
// keeps playing across screens and in the background, with lock screen controls

/** a voice note to play, with what the lock screen and the now playing bar say about it */
export type Track = {
	note: VoiceNote;
	/** the sender's name */
	title: string;
	/** where it is ("Voice note", a group's name) */
	subtitle?: string;
	/** the sender, for its picture (lock screen, now playing bar) */
	user?: Pick<User, 'username' | 'avatar'>;
	/** what tapping the now playing bar opens: the post or the chat */
	href?: string;
	/** the first time it starts playing (DM listened receipts) */
	onStart?: () => void;
	/** when it played to the end (chats: the next unplayed note) */
	onEnd?: () => void;
};

export const RATES = [1, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];

type State = {
	track: Track | null;
	playing: boolean;
	/** asked to play, not playing yet (loading, buffering) */
	loading: boolean;
	/** of the current track, in seconds */
	position: number;
	rate: Rate;
	/** what the session remembers: url → seconds; changes make a new map */
	positions: Map<string, number>;
	error: string | null;
};

let state: State = {
	track: null,
	playing: false,
	loading: false,
	position: 0,
	rate: 1,
	positions: new Map(),
	error: null
};
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** a value of the state; return a primitive, so only what changed re-renders */
export function useVoice<T>(select: (s: State) => T): T {
	return useSyncExternalStore(subscribe, () => select(state));
}

export const getVoiceState = () => state;

let player: AudioPlayer | null = null;
/**
 * after a new source: seek to the remembered position once loaded, then play. `replaced` once
 * the source is in: until then the updates are still the note before's
 */
let pending: { seek: number; replaced: boolean; seeking?: boolean } | null = null;
/** onStart already ran for the current track */
let started = false;
/** the notes that started playing this session (groups have no listened receipts) */
const heard = new Set<string>();
export const wasHeard = (url: string) => heard.has(url);
/** counts play() calls, so a slow audio mode switch doesn't load a note asked for before */
let generation = 0;

const RATE_KEY = 'voice_note_rate';
SecureStore.getItemAsync(RATE_KEY)
	.then((saved) => {
		const rate = Number(saved);
		if ((RATES as readonly number[]).includes(rate)) set({ rate: rate as Rate });
	})
	.catch(() => {});

/**
 * Voice notes play with the ringer off (like WhatsApp), in the background, and take the audio
 * focus: other apps pause and may resume after. expo-audio needs doNotMix for the lock screen
 * controls, so this is it rather than ducking. Set again before every play: other media (the
 * GIFs' muted videos) may have changed the session since.
 */
const audioMode = () =>
	setAudioModeAsync({
		playsInSilentMode: true,
		shouldPlayInBackground: true,
		interruptionMode: 'doNotMix',
		// recording (a later PR) turns this on only while it records: left on, iOS plays through
		// the earpiece
		allowsRecording: false
	}).catch(() => {});

function remember(url: string, seconds: number | null) {
	const positions = new Map(state.positions);
	if (seconds === null || seconds < 1) positions.delete(url);
	else positions.set(url, seconds);
	return positions;
}

const durationOf = (note: VoiceNote) => note.duration_ms / 1000;

/** Plays a note from where it was left, or pauses it when it's the one playing. */
export function toggle(track: Track) {
	if (state.track?.note.url === track.note.url) {
		// the same note: keep the newer callbacks (the screen showing it re-rendered)
		set({ track });
		if (state.playing || state.loading) pause();
		else resume();
		return;
	}
	play(track);
}

/** Starts a note (stopping the one before), at its remembered position. */
export function play(track: Track, from?: number) {
	if (!player) return;
	const before = state.track;
	const positions = before ? remember(before.note.url, state.position) : state.positions;
	const seek = from ?? positions.get(track.note.url) ?? 0;
	started = false;
	pending = { seek, replaced: false };
	const gen = ++generation;
	player.pause();
	set({ track, playing: false, loading: true, position: seek, positions, error: null });
	audioMode().then(() => {
		if (!player || gen !== generation) return;
		player.replace(instanceImage(track.note.url));
		if (pending) pending.replaced = true;
		player.setPlaybackRate(state.rate);
		player.setActiveForLockScreen(
			true,
			{
				title: track.title,
				artist: track.subtitle ?? 'Voice note',
				artworkUrl: track.user ? avatarUrl(track.user, 300) : undefined
			},
			{ showSeekBackward: true, showSeekForward: true }
		);
		// replace() may have it loaded already (a source played before)
		if (player.isLoaded) onLoaded();
	});
}

function onLoaded() {
	const asked = pending;
	if (!player || !asked || asked.seeking) return;
	asked.seeking = true;
	const go = () => {
		// another note was asked for meanwhile
		if (pending !== asked) return;
		pending = null;
		player?.setPlaybackRate(state.rate);
		player?.play();
	};
	if (asked.seek > 0) player.seekTo(asked.seek).then(go, go);
	else go();
}

export function resume() {
	const track = state.track;
	if (!player || !track) return;
	const gen = generation;
	set({ loading: true, error: null });
	audioMode().then(() => {
		if (!player || gen !== generation) return;
		// played to the end: from the start again
		if (state.position >= durationOf(track.note) - 0.3) player.seekTo(0).catch(() => {});
		player.setPlaybackRate(state.rate);
		player.play();
	});
}

export function pause() {
	player?.pause();
	set({ loading: false, playing: false });
}

/** Stops and forgets the current note (the now playing bar's close). */
export function stop() {
	const track = state.track;
	if (!track) return;
	player?.pause();
	player?.clearLockScreenControls();
	pending = null;
	set({
		track: null,
		playing: false,
		loading: false,
		position: 0,
		positions: remember(track.note.url, state.position)
	});
}

/** Moves a note to `seconds`: the playing one now, another one for when it plays. */
export function seek(note: VoiceNote, seconds: number) {
	const to = Math.max(0, Math.min(durationOf(note), seconds));
	if (state.track?.note.url === note.url) {
		if (pending && !pending.seeking) pending.seek = to;
		else player?.seekTo(to).catch(() => {});
		set({ position: to });
	} else set({ positions: remember(note.url, to) });
}

/** Where a note is: the playing one's position, else what the session remembers. */
export const positionOf = (s: State, url: string) =>
	s.track?.note.url === url ? s.position : s.positions.get(url) ?? 0;

export function skip(note: VoiceNote, seconds: number) {
	seek(note, positionOf(state, note.url) + seconds);
}

export function setRate(rate: Rate) {
	set({ rate });
	player?.setPlaybackRate(rate);
	SecureStore.setItemAsync(RATE_KEY, String(rate)).catch(() => {});
}

export const nextRate = (rate: Rate): Rate => RATES[(RATES.indexOf(rate) + 1) % RATES.length];

function onStatus(status: AudioStatus) {
	const track = state.track;
	if (!track) return;
	if (pending) {
		// the new source loaded: seek, then play. before that, nothing it says is about it
		if (pending.replaced && status.isLoaded) onLoaded();
		if (pending) return;
	}
	if (status.didJustFinish) {
		set({
			playing: false,
			loading: false,
			position: 0,
			positions: remember(track.note.url, null)
		});
		track.onEnd?.();
		// nothing else started: the bar goes away
		if (state.track === track) stop();
		return;
	}
	if (status.error) {
		set({ playing: false, loading: false, error: status.error });
		return;
	}
	if (status.playing && !started) {
		started = true;
		heard.add(track.note.url);
		track.onStart?.();
	}
	set({
		playing: status.playing,
		// asked to play and not playing yet, or stalled
		loading: status.playing ? status.isBuffering : state.loading,
		position: status.currentTime
	});
}

/**
 * The player itself, mounted once in the root layout. Stops when the profile changes (direct
 * message notes are fetched with its token).
 */
export function VoicePlayerHost() {
	const audio = useAudioPlayer(null, { updateInterval: 250 });
	const { profileKey } = useSession();
	useEffect(() => {
		player = audio;
		const subscription = audio.addListener('playbackStatusUpdate', onStatus);
		return () => {
			subscription.remove();
			if (player === audio) player = null;
		};
	}, [audio]);
	useEffect(() => () => stop(), [profileKey]);
	return null;
}
