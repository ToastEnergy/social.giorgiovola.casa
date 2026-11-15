import { setAudioModeAsync } from 'expo-audio';

// the app's audio session, shared by the voice note player (src/lib/voicePlayer.tsx) and the
// recorder (src/lib/recorder.ts). expo-audio has one session for the whole app, so whoever sets
// it last wins: while a recording is on, playback must not switch it back (on iOS that stops
// the recording, on Android it pauses it)

let recording = false;

/** a recording holds the session: playback waits until it's done */
export const isRecordingSession = () => recording;

/**
 * Voice notes play with the ringer off (like WhatsApp), in the background, and take the audio
 * focus: other apps pause and may resume after. expo-audio needs doNotMix for the lock screen
 * controls, so this is it rather than ducking. Recording is off: left on, iOS plays through the
 * earpiece at a low volume.
 */
export function playbackMode() {
	if (recording) return Promise.resolve();
	return setAudioModeAsync({
		playsInSilentMode: true,
		shouldPlayInBackground: true,
		interruptionMode: 'doNotMix',
		allowsRecording: false,
		allowsBackgroundRecording: false
	}).catch(() => {});
}

/**
 * Recording: the microphone on, and kept on in the background (a locked recording goes on with
 * the screen off; iOS `audio` background mode, an Android foreground service with its
 * notification, see app.json). Set before preparing the recorder: Android binds its service then.
 */
export async function recordingMode() {
	recording = true;
	await setAudioModeAsync({
		playsInSilentMode: true,
		shouldPlayInBackground: true,
		interruptionMode: 'doNotMix',
		allowsRecording: true,
		allowsBackgroundRecording: true
	});
}

/** The recording is over: back to playback, so notes play through the speaker again. */
export function endRecordingMode() {
	if (!recording) return Promise.resolve();
	recording = false;
	return playbackMode();
}
