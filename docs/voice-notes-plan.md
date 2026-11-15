# Voice notes: plan

Voice notes in the feed (a post, reply or quote that carries one recording) and in conversations
(direct and group messages), recorded in the web app (desktop, mobile browser, installed PWA)
and in the native Expo app. Recording must feel native on phones: hold to record, slide to
cancel, slide up to lock, haptics, live waveform, no clipped first syllable, nothing lost on an
interruption.

## Status (2026-11-16)

Shipped, phase by phase (section 9): server foundation **#198**, web playback **#201**, web
recording in chats **#204**, native playback **#200**, native recording **#202**, and polish
(social card waveform, `og:audio`, seed data, Android recording notification) in the polish PR.
Web recording in the post composer and replies (phase 4) is its own PR. Listened receipts in DMs
and auto-play of the next note in a chat shipped with #198/#201/#204 (phase 6 only had what was
left). The sections below are the plan as written; where the result differs it's under "Known
limitations".

### Known limitations

- **Native uploads start at stop, not while recording.** The web recorder sends ~5 s chunks to
  an upload session while it records; the native one (expo-audio writes a single M4A that's only
  valid once finished) uploads the whole file, in chunks for large ones, when the recording
  stops. A long native note therefore takes a moment to upload after stop.
- **The app killed during an active native recording loses it.** The file isn't finalised until
  the recorder stops, so a crash or the system ending the app mid-recording leaves nothing usable.
  Stopped, paused and review recordings are drafts on disk and survive.
- **Android: a call can record silence.** Android doesn't always tell the recorder about a phone
  call; the recording then goes on with silence instead of stopping into review.
- **Android: the "Recording audio" notification.** Background recording needs a foreground
  service, and expo-audio only binds it when the recorder is prepared (`allowsBackgroundRecording`
  in the audio mode), so it can't be added once a recording is under way. So that every quick
  hold-to-send doesn't flash the notification, hold recordings on Android run without it; a
  recording started locked (a composer's mic, the accessibility action) has it. A hold that is
  locked later stops into review if the app goes to the background (the screen stays on while
  recording, so that's only when leaving the app). iOS shows no notification and always allows
  background recording.
- **Staged uploads and sessions live in memory** on the server: a deploy or restart loses them, and
  clients re-upload the kept recording when the server answers 404 / 410.
- **Transcripts** are out of scope, tracked in Orbit as SGC-72.

## 1. What exists today (and what it means here)

- **Images are staged:** `POST /api/v1/uploads` processes the file at once into a temp dir
  (`stagedUploads.ts`), the client sends its id as `uploads` with the post/message, `claimStaged`
  stores it. Voice notes reuse that flow: upload as soon as recording stops, send = attach id.
- **Storage** (`storage.ts`): fs or S3/R2, keys `uploads/…` (public) and `dm/…` (private,
  served by `/dm-uploads` after `messageImageAccess` checks the conversation). `KEY_RE` already
  allows any file extension, so `uploads/<uuid>.m4a` / `dm/<uuid>.m4a` fit.
- **Serving has no HTTP Range support.** iOS Safari / AVPlayer refuse to play (or can't seek)
  media served without `206 Partial Content`. Must be added for audio.
- **CSP** `media-src` lists only KLIPY hosts: our own audio and `blob:` previews would be
  blocked. Add `'self'` and `'blob:'`.
- **No ffmpeg** in the image (Debian `oven/bun`); sharp only handles images.
- **Schema:** posts, messages and group_messages each have `images`, `image_sizes`, `gif`; a GIN
  index on `images` drives the DM access check.
- **Native app** renders posts and chats natively (`PostCard.tsx`, `ChatView.tsx`), already
  has gesture-handler, reanimated, haptics, expo-video; no audio module yet.
- Push bodies fall back to `📷 Photo` / `🎞️ GIF` (`push.ts:287,326`); typing indicators exist
  (`typingDirect` / `typingInGroup`).

## 2. Format decision: transcode everything on the server to AAC in M4A

Browsers record different things: Chrome/Firefox/Android give WebM/Opus, Safari gives MP4/AAC
(newer Safari also WebM), expo-audio gives M4A/AAC. Playing WebM/Opus on older iOS is unreliable.
So the server normalises every recording with ffmpeg to **mono AAC-LC, 48 kHz, 48 kbps, `.m4a`
with `+faststart`** (≈0.35 MB/min, ≈21 MB for the 1 hour maximum), which plays everywhere: every
browser, AVPlayer, ExoPlayer. `+faststart` puts the index at the front, so playback and seeking
in a long note start after the first few KB (with Range, section 4).

The same pass:

- strips all metadata (`-map_metadata -1`, `-vn`), so nothing about the device leaks;
- normalises loudness for speech (`loudnorm` single pass, I=-16), so quiet and loud notes play at
  similar levels;
- trims trailing silence (not leading: that risks eating the first word);
- measures the real duration (never trust the client's);
- decodes to 8 kHz mono PCM and computes the **waveform**: 64 peak bars (0–255, sqrt-scaled so
  speech looks lively), stored with the note so players draw it without downloading the file.

Safety: ffmpeg runs on untrusted input, so: probe first (`ffprobe`, audio stream required, only
the demuxers we expect: `matroska,webm,mov,mp4,m4a,ogg,wav,mp3`), `-protocol_whitelist file,pipe`,
work in the staging dir only, timeout scaled to the duration (≈ 10 s + 0.1 × length), concurrency
cap (`concurrency.ts`, e.g. 2 jobs; others queue), input cap 150 MB (Safari records AAC at up to
~128 kbps, ≈60 MB/h), reject over 1 hour + 5 s grace.

**Long notes are processed in the background.** Transcoding an hour takes tens of seconds, so
finishing an upload answers at once with the id and `status: "processing"`; the post/message can
be sent right away and is stored when processing ends (the create call waits on the job, up to
its timeout, or answers 202 and publishes when ready; pick one in phase 1, waiting is simpler and
fine below a few minutes of audio, so: wait if the job finishes within ~10 s, else 202 + realtime).

Docker: `apt-get install ffmpeg` (or a static build to keep the image smaller; compare sizes).
New optional env `FFMPEG_PATH` (default `ffmpeg` on PATH) in `src/env.ts`, `.env.example`, README;
README dev setup notes installing ffmpeg locally (winget/brew/apt). When ffmpeg is missing the
upload endpoint answers 503 "Voice notes aren't available on this server" and `/api/v1/instance`
says so, so clients hide the mic button.

## 3. Data model (one additive migration)

```ts
// src/lib/types.ts
export type VoiceNote = {
	url: string; // /uploads/<uuid>.m4a (posts) or /dm-uploads/<uuid>.m4a (messages)
	duration_ms: number;
	waveform: number[]; // 64 values 0–255
	size: number; // bytes
};
```

- `posts.audio`, `messages.audio`, `group_messages.audio`: `jsonb('audio').$type<VoiceNote>()`,
  nullable. Backward compatible: the old release ignores the column.
- Expression index `((audio->>'url'))` on messages and group_messages for the DM access check.
- A post/message with audio may have text (a caption) but no images, GIF or poll. Validation
  in `postInput.ts` / `messageInput.ts`. Max duration 1 hour for both posts and messages.
- `messages.audio_played_at timestamptz` (nullable) for "listened" receipts in DMs: set the first
  time the recipient plays the note. Groups: none.

Cleanup: everywhere images are removed (post/message delete, account delete, moderation,
`removeUploads`), the audio file goes too. `scripts/seed.ts` gets a few voice notes: it stays
self-contained by synthesising speech-like sound itself and encoding it with ffmpeg at seed time
(skipped when ffmpeg is missing).

## 4. API (v1, additive only)

| Method | Path                                                                        | Notes                                                                                                                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/uploads/audio`                                                     | **one shot:** raw body (`audio/*`) or multipart `audio`, up to the request body limit (~52 MB, enough for most notes). Transcodes, stages. `201 { id, status, duration_ms, waveform }`. Rate limit shared with uploads (per account). 400 bad/too long, 413 too big, 503 unavailable. |
| POST   | `/api/v1/uploads/audio/sessions`                                            | **chunked**, for long notes and recording apps: `201 { id }`.                                                                                                                                                                                                                         |
| PUT    | `/api/v1/uploads/audio/sessions/{id}/chunks/{n}`                            | raw bytes of chunk `n` (≤ 5 MB, in order, idempotent per `n` so a retry is safe). The web and native recorders send chunks _while recording_ (every ~5 s), so when a 1 hour note stops almost nothing is left to upload and nothing is lost if the app dies.                          |
| POST   | `/api/v1/uploads/audio/sessions/{id}/complete`                              | `{ chunks }` → starts processing, answers like the one-shot upload.                                                                                                                                                                                                                   |
| GET    | `/api/v1/uploads/audio/{id}`                                                | `{ status: processing\|ready\|failed, duration_ms, waveform, error? }`                                                                                                                                                                                                                |
| DELETE | `/api/v1/uploads/{id}`                                                      | existing; also discards staged audio and open sessions                                                                                                                                                                                                                                |
| POST   | `/api/v1/posts`, replies, quotes                                            | new optional `audio: "<staged id>"`                                                                                                                                                                                                                                                   |
| POST   | `/api/v1/conversations/{username}/messages`, `/api/v1/groups/{id}/messages` | new optional `audio`                                                                                                                                                                                                                                                                  |
| POST   | `…/typing`                                                                  | new optional body `{ "action": "recording" }`; realtime `typing` event gains `action`                                                                                                                                                                                                 |
| POST   | `/api/v1/conversations/{username}/messages/{id}/played`                     | recipient only, idempotent; realtime `message_played` to the sender                                                                                                                                                                                                                   |

Responses: post and message objects gain `audio: VoiceNote | null` (and DM messages
`audio_played_at`). Realtime message events carry them. `410` on an expired staged id, as for
images (the client re-uploads its kept recording). **Bots may upload and send voice notes**
(unlike images): no `refuseBots` on these endpoints, bot rate limits apply, documented in the bot
part of `/api.txt` with a curl example (one-shot upload, then post). Document everything in
`apiGuide.ts`, README table and `botDocs.ts` in the same PR.

**Serving with Range (the iOS fix).** `/uploads/[file]` and `/dm-uploads/[file]` accept `.m4a`
(`audio/mp4`) and implement HTTP Range per RFC 9110: `Accept-Ranges: bytes` on every response,
`Range: bytes=a-b` / `a-` / `-n` → `206` with `Content-Range`, unsatisfiable → `416`, no header →
`200` with the whole file, an `ETag` (the file name is a uuid, so it never changes) and
`If-Range` honoured. fs driver: `fs.createReadStream(file, { start, end })` instead of reading
the whole file (also stops a 1 hour note from being buffered in memory); S3 driver: forward the
`Range` header to the GET and pass R2's `206` through. A storage `get(key, range?)` change, used
by images too (harmless for them). Immutable cache for public files, `private` for DM ones.
`messageImageAccess` → generalised `messageMediaAccess` that also matches `audio->>'url'`.
Verify on a real iPhone (Safari tab, PWA, native) that a long note starts at once and seeks to
the middle without downloading everything.

Elsewhere: push body `🎤 Voice message (0:42)`; conversation list preview the same; social card
(`@[username]/[post]/image.png`) draws the waveform and duration; search ignores audio; notification
text for mentions/replies unchanged (caption or "voice note").

## 5. Recording UX (shared spec for web and native)

### Entry points

- **Chat input:** the send button is a **mic** while the text field is empty and nothing is
  attached; it turns into send as soon as there's text (WhatsApp/Telegram pattern).
- **Post composer / reply dock / compose sheet:** a mic icon in the toolbar next to image/GIF/poll.
  Starting a recording there opens the locked recorder inline (no hold; composers are a
  deliberate, longer flow), with the caption field still usable.

### Gestures in chats (touch)

1. **Press and hold** the mic: recording starts on `pointerdown` (not after a delay). Haptic tick.
   The input row turns into the recorder: red dot (opacity pulse, no glow), timer `0:00`, live
   scrolling waveform, `‹ Slide to cancel` hint, a lock pill floating above the mic.
2. **Release** → stops and sends at once (optimistic bubble, upload already under way).
3. **Slide left** past ~40% of the row → cancel: haptic, the recording is discarded with a short
   trash animation. The hint follows the finger and fades as it nears the threshold.
4. **Slide up** onto the lock → **locked mode**: haptic, finger can lift. Shows trash, pause/resume,
   stop (→ review) and send.
5. **Review** (after stop in locked mode): play/scrub the recording with its waveform, delete or
   send. Upload starts as soon as recording stops, so send is instant.
6. **Too short** (< 0.6 s, i.e. a tap): don't send; show a tooltip "Hold to record, release to
   send. Slide up to lock." and a light haptic.

Desktop (mouse): **click** the mic to start in locked mode (holding a mouse button is awkward);
`Enter` sends, `Escape` cancels (with confirm if > 5 s), `Space` pauses. Keyboard users get the
same via focus + Enter/Space. Hold-to-record works with the mouse too but isn't required.

### Details that make it feel right

- **No clipped first word:** start the recorder immediately; mic acquisition (~100–500 ms on web)
  is covered by showing the recorder UI at once and only starting the timer when the first audio
  frame arrives (web: first `AnalyserNode` data / `onstart`; native: recorder status).
- **First-time permission:** the first press only asks for the mic (the OS prompt would break the
  hold anyway), then shows "Now hold to record". **Denied:** an inline panel explaining how to
  re-enable it (iOS Safari: Settings › Apps › Safari › Microphone; Android Chrome: site settings;
  native: button to `Linking.openSettings()`).
- **Haptics:** start, lock, cancel, send, 10 s-left warning, max length reached. Native via
  expo-haptics; Android web via `navigator.vibrate`; iOS web has no API (accept it).
- **Live waveform:** 60 fps bars from audio level (web `AnalyserNode` RMS; native recorder
  metering), the same bar style as the player so the review looks like the sent note.
- **Limits:** 1 hour. Countdown appears in the last minute (and a haptic at 1 min and 10 s
  left); at the max the recording stops and goes to review (never auto-sends, never loses audio).
- **Long recordings upload while recording** (chunked sessions, section 4): a small "saved"
  indicator in locked mode; if the tab or app dies, the chunks already on the server plus the
  local draft let the note be recovered. The timer stays `m:ss` up to the `60:00` limit.
- **Long notes keep recording with the screen off / app in the background** in locked mode where
  the platform allows it (native: iOS `UIBackgroundModes: audio` + Android foreground service,
  per the expo-audio docs; web: browsers usually keep a recording tab alive while the mic is in
  use, and if they don't, it lands in review with what was saved). Hold mode still stops on
  background.
- **Screen stays on** while recording (web `navigator.wakeLock`, native `expo-keep-awake`).
- **No accidental gestures** while holding: `touch-action: none`, `user-select: none`,
  `-webkit-touch-callout: none`, `contextmenu` prevented (iOS long-press magnifier / Android
  long-press menu), pointer capture so sliding off the button keeps tracking; pull-to-refresh,
  view-transition swipes and bottom-bar taps are suspended while recording.
- **Keyboard:** pressing the mic doesn't steal focus from the text field (`preventDefault` on
  pointerdown), so the keyboard doesn't collapse and jump the layout mid-gesture.
- **Back gesture / navigation:** the locked recorder and review are an `overlayEntry`, so back
  asks "Discard voice note?" instead of leaving. Leaving the page otherwise keeps the note as a
  draft.
- **Interruptions never lose audio:** phone call, Siri, another app taking the mic, tab hidden,
  app backgrounded, headphones unplugged, mic track `ended` → stop (hold mode) or pause (locked
  mode) and land in **review**, never auto-send and never discard. Web records with a 250 ms
  `timeslice` so chunks survive.
- **Drafts:** an unsent recording (review state, failed upload, interruption) is saved per
  conversation (web: IndexedDB next to `composerDraft.ts`; native: file in the cache dir + drafts
  store) and restored when the chat is reopened.
- **Upload resilience:** progress ring on the optimistic bubble; offline → queued and retried
  when back online (`connection.svelte.ts`); 410 → re-upload from the kept blob; failure → "Tap to
  retry" on the bubble, the blob kept until sent or deleted.
- **"Recording…" indicator** for the other side, sent like typing (throttled), cleared on stop.
- **Audio quality:** `getUserMedia({ audio: { echoCancellation, noiseSuppression,
autoGainControl, channelCount: 1 } })`; recorder picks the first supported of
  `audio/webm;codecs=opus`, `audio/mp4;codecs=mp4a.40.2`, `audio/mp4`, `audio/ogg;codecs=opus`.
  Mic released (track `stop()`) the moment recording ends, so the OS mic indicator goes away.
- **Unsupported:** no `MediaRecorder`/`getUserMedia` or not a secure context → no mic button.

## 6. Playback UX

- **Player:** play/pause, 64-bar waveform (played part `accent`, rest `muted`), elapsed / total
  time, speed chip `1× / 1.5× / 2×` (remembered per device). Avatar of the sender in DMs on the
  left (WhatsApp-like) is optional.
- **Scrub** by tapping or dragging on the waveform (pointer capture; horizontal drag doesn't
  scroll the feed, vertical still does). Role `slider` with arrow keys ±5 s, `aria-valuetext`.
- **Nothing downloads until play:** `preload="none"`, waveform comes from the JSON. First tap
  shows a spinner inside the play button until `canplay`.
- **One at a time:** a shared `audioPlayer.svelte.ts` state module (one `<audio>` element in
  `+layout.svelte`, like the image viewer); starting one pauses the other; also pauses GIFs'
  sound? (they're muted, no conflict).
- **Keeps playing across navigation**, with a small now-playing pill (sender, time, pause,
  close) above the bottom bar / in the rail. Media Session API: lock-screen and headphone
  controls with the sender's name and avatar, seek ±10 s.
- **Chats:** when a note ends, the next consecutive unplayed voice note in the conversation plays
  automatically. Resume position remembered per note for the session.
- **Unplayed state:** the recipient sees an accent dot on unplayed notes; the sender's mic icon
  on the bubble turns accent once played ("Played" in message info). Groups: no receipts.
- **Long notes:** waveform still 64 bars (a seek map, not detail); ±15 s skip buttons appear for
  notes over 2 minutes; the resume position is remembered (so a 40 minute note picks up where
  you left off).
- **Feed:** the card plays inline; tapping it never opens the post (stopPropagation), the rest
  of the post still does. Quote cards and reposts show a compact player.
- **Native extras:** respects the silent switch? No: voice notes play in silent mode (like
  WhatsApp), set via audio mode. Ducks other audio. Lock-screen controls through expo-audio's
  lock-screen support (verify in SDK 58 docs). Proximity sensor → earpiece is a stretch goal.

## 7. Web implementation sketch

- `src/lib/voiceRecorder.svelte.ts`: state machine `idle → requesting → recording(hold|locked)
→ paused → review → uploading → sent | failed`, MediaRecorder + AnalyserNode + wake lock +
  interruption listeners. Pure logic, so Chat and composers share it.
- `src/lib/voiceNote.svelte.ts`: like `Attachment`, but for a recorded `Blob`: XHR upload to
  `/api/v1/uploads/audio` with progress, `done` promise, retry, 410 re-upload.
- `src/lib/audioPlayer.svelte.ts` + `AudioPlayerHost.svelte` in the root layout.
- Components: `VoiceRecorder.svelte` (hold/lock/review UI for chats), `VoiceNoteRecorder` mode in
  `PostComposer.svelte`, `VoiceNotePlayer.svelte`, `Waveform.svelte` (shared bars; canvas for the
  live one, SVG/divs for static).
- Touching `Chat.svelte`, `PostComposer.svelte`, `Post.svelte`: convert to runes where still legacy
  (AGENTS rule), Prettier caveat for snippet markup.
- CSP: `media-src 'self' blob:` plus KLIPY.

## 8. Native (Expo) implementation sketch

Before writing code: read `expo` 58 docs for **expo-audio** (recorder options, metering,
`setAudioModeAsync`, interruption and lock-screen APIs) per `mobile/AGENTS.md`; don't trust memory.

- `bunx expo install expo-audio expo-keep-awake`; config plugin in `app.json` with the
  microphone permission text (iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO`).
  Needs a new dev build.
- Record with an M4A/AAC mono preset, metering on; the server transcodes anyway.
- **Audio session gotcha:** enable `allowsRecording` only while recording and switch it off
  afterwards, otherwise iOS routes playback to the earpiece at low volume.
- Gestures with react-native-gesture-handler `Gesture.LongPress().minDuration(0)` + `Pan`,
  animated on the UI thread with reanimated (slide-to-cancel, lock pill), haptics via expo-haptics.
- Interruption / `AppState` background → pause into review; draft file kept in the cache dir.
- `VoiceNotePlayer` component for `PostCard` and `ChatView`, one global player in a context, with
  lock-screen controls.
- Upload with `expo-file-system` upload task (progress) as raw body to `/api/v1/uploads/audio`.

## 9. Phases (each a PR)

1. ✅ **Server foundation (#198):** ffmpeg in Docker + env, transcode/waveform module, staged audio,
   `POST /api/v1/uploads/audio`, schema + migration, `audio` on posts/messages create + responses,
   Range serving, DM access check, cleanup paths, CSP, push/list previews, docs (api.txt, README,
   botDocs).
2. ✅ **Web playback (#201):** player, waveform, global audio host, Media Session, now-playing pill, feed +
   chat + quote rendering.
3. ✅ **Web recording in chats (#204):** recorder state machine, hold/slide/lock/review, permissions,
   interruptions, drafts, optimistic send, "recording…" indicator.
4. **Web recording in post composer / replies** (its own PR, in progress).
5. ✅ **Native playback + recording** (chat first, then compose): playback #200, recording #202.
6. ✅ **Polish:** listened receipts and auto-play next (shipped with the phases above), social
   card waveform and `og:audio`, seed data, the Android recording notification only when needed.

## 10. Test checklist (no test suite: by hand, on real devices)

iPhone Safari (tab and installed PWA), Android Chrome (tab and PWA), desktop Chrome/Firefox/Safari,
native iOS and Android builds. For each: first-time permission, denied permission, hold-release
send, slide cancel, lock + pause + review, too-short tap, max-length stop, incoming call mid
recording, lock screen mid recording, background mid recording, Bluetooth headset, offline send,
410 re-upload, seek before load (Range), playback in silent mode, two notes one after another,
lock-screen controls, screen reader labels.

## 11. Decisions (2026-11-15)

1. Voice posts can have a text caption; no images, GIF or poll with them.
2. Max length: 1 hour, for posts and messages.
3. "Listened" receipts in DMs: yes (phase 6).
4. Bots may upload and send voice notes through v1.
5. Transcripts: out of scope, tracked in Orbit as SGC-72.
