import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { ChatPeer, VoiceNote } from './types';
import { getAvatar } from './utils.js';

/**
 * The one voice note player of the app: a single <audio> element (AudioHost.svelte, mounted in
 * the root layout) that every VoiceNotePlayer drives, so starting a note pauses the other one and
 * playback goes on across pages, with the now-playing pill and the lock screen controls.
 */

export type Track = {
	note: VoiceNote;
	/** who recorded it: the pill and the lock screen show them */
	sender: ChatPeer;
	/** where it was played from: the pill's link back */
	href?: string;
	/** the caption, for the lock screen */
	caption?: string;
	/** playback started (by a tap or by the previous note ending): chats mark it played */
	onstart?: () => void;
	/** it played to the end: chats go on with the next one */
	onend?: () => void;
};

export const RATES = [1, 1.5, 2] as const;
const RATE_KEY = 'voice-note-rate';

export const player = $state({
	track: null as Track | null,
	playing: false,
	/** waiting for data after play was asked for: the play button spins */
	loading: false,
	/** where the current track is, in seconds */
	time: 0,
	rate: 1 as number
});

/** Where each note was left, by url, for this visit: a long note picks up where it stopped. */
const positions = new SvelteMap<string, number>();
/** Notes played on this device during this visit: chats don't auto-play them again. */
const played = new SvelteSet<string>();
/** How many players of each note are on screen: the pill hides while its note is in view. */
const onScreen = new SvelteMap<string, number>();

let audio: HTMLAudioElement | null = null;
let frame = 0;

export const keyOf = (note: VoiceNote) => note.url;
export const durationOf = (note: VoiceNote) => note.duration_ms / 1000;

/** The position of a note in seconds: live for the one playing, else where it was left. */
export const positionOf = (note: VoiceNote) =>
	player.track && keyOf(player.track.note) === keyOf(note)
		? player.time
		: positions.get(keyOf(note)) ?? 0;

export const isCurrent = (note: VoiceNote) =>
	!!player.track && keyOf(player.track.note) === keyOf(note);

export const wasPlayed = (note: VoiceNote) => played.has(keyOf(note));

export function markOnScreen(note: VoiceNote) {
	const key = keyOf(note);
	onScreen.set(key, (onScreen.get(key) ?? 0) + 1);
	return () => {
		const left = (onScreen.get(key) ?? 1) - 1;
		if (left > 0) onScreen.set(key, left);
		else onScreen.delete(key);
	};
}

/** The pill shows while a note is loaded and none of its players is in view. */
export const pillVisible = () =>
	!!player.track && (onScreen.get(keyOf(player.track.note)) ?? 0) === 0;

/** Called once by AudioHost with its element. */
export function attach(el: HTMLAudioElement) {
	audio = el;
	try {
		const saved = Number(localStorage.getItem(RATE_KEY));
		if ((RATES as readonly number[]).includes(saved)) player.rate = saved;
	} catch {
		// storage blocked: 1×
	}
	el.playbackRate = player.rate;
	const events: [string, () => void][] = [
		['playing', () => ((player.playing = true), (player.loading = false), tickFrames())],
		['pause', () => ((player.playing = false), (player.loading = false), syncTime())],
		['waiting', () => (player.loading = true)],
		['canplay', () => (player.loading = false)],
		['seeked', syncTime],
		// animation frames don't run in a hidden tab: keeps the time (and lock screen) going
		['timeupdate', syncTime],
		['ended', ended],
		['error', () => ((player.playing = false), (player.loading = false))]
	];
	for (const [name, fn] of events) el.addEventListener(name, fn);
	setupMediaSession();
	return () => {
		for (const [name, fn] of events) el.removeEventListener(name, fn);
		cancelAnimationFrame(frame);
		audio = null;
	};
}

function syncTime() {
	if (!audio || !player.track) return;
	player.time = audio.currentTime;
	positions.set(keyOf(player.track.note), audio.currentTime);
	updatePositionState();
}

// smoother than timeupdate (4 a second) for the waveform's progress
function tickFrames() {
	cancelAnimationFrame(frame);
	const step = () => {
		if (!audio || !player.playing) return;
		player.time = audio.currentTime;
		frame = requestAnimationFrame(step);
	};
	frame = requestAnimationFrame(step);
}

function ended() {
	const track = player.track;
	player.playing = false;
	player.loading = false;
	if (!track) return;
	// played to the end: next time it starts over
	positions.delete(keyOf(track.note));
	player.track = null;
	player.time = 0;
	track.onend?.();
}

/** Plays a note from where it was left (or `from`), pausing whichever was playing. */
export function play(track: Track, from?: number) {
	if (!audio) return;
	const key = keyOf(track.note);
	const same = player.track && keyOf(player.track.note) === key;
	if (!same) {
		if (player.track) positions.set(keyOf(player.track.note), audio.currentTime);
		player.track = track;
		const start = from ?? positions.get(key) ?? 0;
		player.time = start;
		audio.src = track.note.url;
		audio.playbackRate = player.rate;
		// before the metadata is in, the position only sticks once it has loaded
		audio.currentTime = start;
		if (start > 0)
			audio.addEventListener(
				'loadedmetadata',
				() => {
					if (audio && player.track?.note.url === key) audio.currentTime = start;
				},
				{ once: true }
			);
		setMetadata(track);
	} else {
		// the same note from another player of it (a quote of it, say): keep its callbacks fresh
		player.track = track;
		if (from !== undefined) audio.currentTime = from;
	}
	player.loading = audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
	if (!played.has(key)) {
		played.add(key);
	}
	track.onstart?.();
	audio.play().catch(() => {
		// refused (autoplay rules, a note that can't load): show it as paused
		player.playing = false;
		player.loading = false;
	});
}

export function pause() {
	audio?.pause();
}

export function toggle(track: Track) {
	if (isCurrent(track.note) && player.playing) pause();
	else play(track);
}

/** Moves a note to `seconds`: the playing one jumps, another one starts there when played. */
export function seek(note: VoiceNote, seconds: number) {
	const t = Math.max(0, Math.min(durationOf(note), seconds));
	if (isCurrent(note) && audio) {
		audio.currentTime = t;
		player.time = t;
	}
	positions.set(keyOf(note), t);
}

// from the element's own position: animation frames stop in a hidden tab (a locked phone's
// lock screen controls), so `player.time` can be behind
export const skip = (note: VoiceNote, by: number) =>
	seek(note, (isCurrent(note) && audio ? audio.currentTime : positionOf(note)) + by);

/** Closes the pill: stops the note and unloads it (its position is kept). */
export function stop() {
	if (!audio) return;
	if (player.track) positions.set(keyOf(player.track.note), audio.currentTime);
	audio.pause();
	audio.removeAttribute('src');
	audio.load();
	player.track = null;
	player.playing = false;
	player.loading = false;
	player.time = 0;
	if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

export function cycleRate() {
	const next = RATES[(RATES.indexOf(player.rate as (typeof RATES)[number]) + 1) % RATES.length];
	player.rate = next;
	if (audio) audio.playbackRate = next;
	try {
		localStorage.setItem(RATE_KEY, String(next));
	} catch {
		// remembered for this visit only
	}
	updatePositionState();
}

/** A position as m:ss (an hour is 60:00), rounded down like a running clock. */
export function clock(seconds: number) {
	const s = Math.max(0, Math.floor(seconds));
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// lock screen, notification and headphone controls
function setMetadata(track: Track) {
	if (!('mediaSession' in navigator)) return;
	const artwork = new URL(getAvatar(track.sender, 512, true), location.origin).href;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: track.caption?.trim().slice(0, 100) || 'Voice note',
		artist: track.sender.name,
		artwork: [{ src: artwork, sizes: '512x512' }]
	});
}

function updatePositionState() {
	if (!('mediaSession' in navigator) || !player.track || !audio) return;
	try {
		navigator.mediaSession.setPositionState({
			duration: durationOf(player.track.note),
			position: Math.min(audio.currentTime, durationOf(player.track.note)),
			playbackRate: player.rate
		});
	} catch {
		// a position past the duration while the metadata loads
	}
}

function setupMediaSession() {
	if (!('mediaSession' in navigator)) return;
	const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
		['play', () => player.track && play(player.track)],
		['pause', pause],
		['stop', stop],
		['seekbackward', (d) => player.track && skip(player.track.note, -(d.seekOffset ?? 10))],
		['seekforward', (d) => player.track && skip(player.track.note, d.seekOffset ?? 10)],
		['seekto', (d) => player.track && d.seekTime != null && seek(player.track.note, d.seekTime)]
	];
	for (const [action, fn] of handlers) {
		try {
			navigator.mediaSession.setActionHandler(action, fn);
		} catch {
			// an action this browser doesn't know
		}
	}
}
