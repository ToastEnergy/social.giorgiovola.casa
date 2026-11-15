import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { VoiceNote } from '#lib/types.js';
import { ApiError, fail } from './api.js';
import {
	AudioError,
	MAX_AUDIO_INPUT_BYTES,
	MAX_AUDIO_MS,
	audioAvailable,
	processAudio,
	type ProcessedAudio
} from './audio.js';
import { removeUploads, storeAudioUpload, type UploadKind } from './images.js';
import { ID_RE, STAGING_DIR, stagingReady } from './stagedUploads.js';

/**
 * Voice notes uploaded before they're sent, like staged images (stagedUploads.ts): in one request
 * (stageAudio) or in chunks while recording (sessions), then transcoded in the background. The
 * id is what a post or message sends as `audio`. Kept in memory and in the local staging
 * directory (the app runs as a single process); unclaimed ones are deleted after a day.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
/** The most one chunk of a session may weigh. */
export const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
// a chunk every few seconds for an hour, with room to spare
export const MAX_CHUNKS = 2000;
// how long uploading and sending wait for processing before answering "processing"
const UPLOAD_WAIT_MS = 3000;
const SEND_WAIT_MS = 10_000;
// per profile, so one can't fill the disk or the processing queue
const MAX_OPEN_SESSIONS = 3;
const MAX_PROCESSING = 3;

export type AudioUploadStatus = 'receiving' | 'processing' | 'ready' | 'failed' | 'sent';

/** Where a sent voice note ended up. */
export type SentRef = { type: 'post' | 'message' | 'group_message'; id: number };

type Entry = {
	userId: number;
	expires: number;
	status: AudioUploadStatus;
	/** receiving: the size of each chunk received, by index */
	chunks: Map<number, number>;
	result: ProcessedAudio | null;
	error: string | null;
	/** settles when processing ends, whatever the outcome */
	processed: Promise<void> | null;
	/** a post or message is being sent with it */
	claimed: boolean;
	sent: SentRef | null;
};

const entries = new Map<string, Entry>();

const inputOf = (id: string) => path.join(STAGING_DIR, `${id}.audio-in`);
const chunkOf = (id: string, n: number) => path.join(STAGING_DIR, `${id}.chunk-${n}`);
const outputOf = (id: string) => path.join(STAGING_DIR, `${id}.m4a`);

async function removeFiles(id: string, entry?: Entry) {
	const files = [
		inputOf(id),
		outputOf(id),
		...[...(entry?.chunks.keys() ?? [])].map((n) => chunkOf(id, n))
	];
	await Promise.all(files.map((f) => fs.promises.rm(f, { force: true }).catch(() => {})));
}

function drop(id: string) {
	const entry = entries.get(id);
	entries.delete(id);
	void removeFiles(id, entry);
}

setInterval(() => {
	const now = Date.now();
	for (const [id, entry] of entries) {
		// one waiting to be sent goes once it is
		if (entry.expires <= now && !(entry.claimed && entry.status === 'processing')) drop(id);
	}
}, 10 * 60_000).unref?.();

/** What clients see of a staged voice note (GET /api/v1/uploads/audio/{id}). */
export function statusOf(id: string, entry: Entry) {
	return {
		id,
		status: entry.status,
		duration_ms: entry.result?.duration_ms ?? null,
		waveform: entry.result?.waveform ?? null,
		size: entry.result?.size ?? null,
		error: entry.error,
		// receiving: the chunks the server has, so an interrupted upload can resume
		...(entry.status === 'receiving'
			? { chunks: [...entry.chunks.keys()].sort((a, b) => a - b) }
			: {}),
		...(entry.sent ? { sent: entry.sent } : {})
	};
}

export type AudioUpload = ReturnType<typeof statusOf>;

async function requireAvailable() {
	if (!(await audioAvailable())) fail(503, "Voice notes aren't available on this server");
}

const count = (userId: number, status: AudioUploadStatus) =>
	[...entries.values()].filter((e) => e.userId === userId && e.status === status).length;

const newEntry = (userId: number, status: AudioUploadStatus): Entry => ({
	userId,
	expires: Date.now() + TTL_MS,
	status,
	chunks: new Map(),
	result: null,
	error: null,
	processed: null,
	claimed: false,
	sent: null
});

/** Starts transcoding the input of `id` in the background; settles `processed` when it ends. */
function startProcessing(id: string, entry: Entry) {
	entry.status = 'processing';
	entry.processed = processAudio(inputOf(id), outputOf(id))
		.then(
			(result) => {
				entry.result = result;
				entry.status = 'ready';
			},
			(e) => {
				entry.status = 'failed';
				entry.error = e instanceof AudioError ? e.message : "The recording couldn't be processed";
				if (!(e instanceof AudioError)) console.error('audio: processing failed', e);
				void fs.promises.rm(outputOf(id), { force: true }).catch(() => {});
			}
		)
		.finally(() => {
			void fs.promises.rm(inputOf(id), { force: true }).catch(() => {});
			// discarded meanwhile: nothing will claim the result
			if (entries.get(id) !== entry) void removeFiles(id);
		});
}

const settle = (entry: Entry, ms: number) =>
	Promise.race([entry.processed, new Promise((resolve) => setTimeout(resolve, ms))]);

/**
 * Waits a moment for processing, then answers the upload's status. One that failed by then is a
 * 400 (and forgotten): nothing can be done with it.
 */
async function answer(id: string, entry: Entry): Promise<AudioUpload> {
	await settle(entry, UPLOAD_WAIT_MS);
	if (entry.status === 'failed') {
		drop(id);
		fail(400, entry.error ?? "The recording couldn't be processed");
	}
	return statusOf(id, entry);
}

function checkProcessingSlots(userId: number) {
	if (count(userId, 'processing') >= MAX_PROCESSING)
		fail(429, 'Too many voice notes are being processed, wait for them to finish');
}

/**
 * Stages a whole recording sent in one request. Answers its status: `ready` with the duration
 * and waveform when processing finished within a few seconds, `processing` otherwise.
 */
export async function stageAudio(userId: number, data: Uint8Array): Promise<AudioUpload> {
	await requireAvailable();
	if (data.byteLength > MAX_AUDIO_INPUT_BYTES) fail(413, 'Recording too big');
	checkProcessingSlots(userId);
	await stagingReady;
	const id = crypto.randomUUID();
	const entry = newEntry(userId, 'processing');
	await fs.promises.writeFile(inputOf(id), data);
	entries.set(id, entry);
	startProcessing(id, entry);
	return answer(id, entry);
}

/** Opens a chunked upload: chunks are PUT while recording, then completeAudioSession. */
export async function openAudioSession(userId: number): Promise<AudioUpload> {
	await requireAvailable();
	if (count(userId, 'receiving') >= MAX_OPEN_SESSIONS)
		fail(429, 'Too many voice note uploads are open, finish or delete one first');
	await stagingReady;
	const id = crypto.randomUUID();
	const entry = newEntry(userId, 'receiving');
	entries.set(id, entry);
	return statusOf(id, entry);
}

/** One of `userId`'s staged voice notes, or a 404. */
function ownEntry(userId: number, id: string) {
	const entry = ID_RE.test(id) ? entries.get(id) : undefined;
	if (!entry || entry.userId !== userId) fail(404, 'Upload not found');
	return entry;
}

function ownSession(userId: number, id: string) {
	const entry = ownEntry(userId, id);
	if (entry.status !== 'receiving') fail(409, 'This upload is already complete');
	return entry;
}

/** Stores chunk `n` of a session; sending the same chunk again replaces it. */
export async function putAudioChunk(userId: number, id: string, n: number, data: Uint8Array) {
	const entry = ownSession(userId, id);
	if (!Number.isInteger(n) || n < 0 || n >= MAX_CHUNKS)
		fail(400, `The chunk number must be between 0 and ${MAX_CHUNKS - 1}`);
	if (data.byteLength === 0) fail(400, 'Missing chunk: send its bytes as the body');
	if (data.byteLength > MAX_CHUNK_BYTES)
		fail(413, `Chunk too big, max size is ${MAX_CHUNK_BYTES / 1024 / 1024}mb`);
	let total = data.byteLength;
	for (const [i, size] of entry.chunks) if (i !== n) total += size;
	if (total > MAX_AUDIO_INPUT_BYTES)
		fail(413, `Recording too big, max size is ${MAX_AUDIO_INPUT_BYTES / 1024 / 1024}mb`);
	// written aside and renamed, so a retry racing the first attempt never leaves half a chunk
	const tmp = `${chunkOf(id, n)}.${crypto.randomUUID()}`;
	await fs.promises.writeFile(tmp, data);
	// completed or discarded while it was written
	if (entries.get(id) !== entry || entry.status !== 'receiving') {
		await fs.promises.rm(tmp, { force: true });
		fail(409, 'This upload is already complete');
	}
	await fs.promises.rename(tmp, chunkOf(id, n));
	entry.chunks.set(n, data.byteLength);
	return { id, chunk: n, received: entry.chunks.size };
}

/** Joins chunks 0 to `chunks` - 1 of a session and starts processing them, like stageAudio. */
export async function completeAudioSession(
	userId: number,
	id: string,
	chunks: number
): Promise<AudioUpload> {
	const entry = ownSession(userId, id);
	if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS)
		fail(400, `chunks must be the number of chunks sent, 1 to ${MAX_CHUNKS}`);
	for (let n = 0; n < chunks; n++) if (!entry.chunks.has(n)) fail(400, `Chunk ${n} is missing`);
	checkProcessingSlots(userId);
	// from here on no chunk can be added
	entry.status = 'processing';
	const parts = [...entry.chunks.keys()];
	try {
		const out = fs.createWriteStream(inputOf(id));
		for (let n = 0; n < chunks; n++) {
			await pipeline(fs.createReadStream(chunkOf(id, n)), out, { end: false });
		}
		await new Promise<void>((resolve, reject) =>
			out.end((e?: Error | null) => (e ? reject(e) : resolve()))
		);
	} catch (e) {
		drop(id);
		throw e;
	} finally {
		// extra chunks past `chunks` are dropped too
		await Promise.all(parts.map((n) => fs.promises.rm(chunkOf(id, n), { force: true })));
	}
	entry.chunks.clear();
	if (entries.get(id) !== entry) fail(404, 'Upload not found');
	startProcessing(id, entry);
	return answer(id, entry);
}

/** The status of one of `userId`'s staged voice notes, or a 404. */
export function audioUploadStatus(userId: number, id: string): AudioUpload {
	return statusOf(id, ownEntry(userId, id));
}

/** Deletes a staged voice note or open session (DELETE /api/v1/uploads/{id}). False when not found. */
export function discardStagedAudio(userId: number, id: string): boolean {
	const entry = entries.get(id);
	if (!entry || entry.userId !== userId) return false;
	drop(id);
	return true;
}

/** The staged id sent as `audio` with a post or message: null when there's none, or a 400. */
export function parseAudioId(raw: unknown): string | null {
	if (raw === undefined || raw === null || raw === '') return null;
	if (typeof raw !== 'string' || !ID_RE.test(raw))
		fail(400, 'audio must be the id of a voice note from POST /api/v1/uploads/audio');
	return raw;
}

/**
 * Checks that `id` is one of `userId`'s voice notes that can still be sent, before anything is
 * written. 410 tells the client to upload it again.
 */
export function checkStagedAudio(userId: number, id: string) {
	const entry = entries.get(id);
	if (!entry || entry.userId !== userId) fail(410, 'The voice note expired, upload it again');
	if (entry.status === 'receiving') fail(409, 'Complete the voice note upload first');
	if (entry.status === 'failed') fail(400, entry.error ?? "The voice note couldn't be processed");
	if (entry.claimed || entry.status === 'sent') fail(409, 'This voice note was already sent');
	return entry;
}

/** What sendWithAudio answers: the result of `send`, or the upload still being processed. */
export type AudioSend<T> = { sent: T } | { pending: AudioUpload };

/**
 * Sends a post or message with the staged voice note `id`: stores the file as an upload of
 * `kind` and calls `send` with it. When processing hasn't finished after a few seconds it answers
 * `pending` at once and sends when processing ends (`send` is then called with `deferred`), then
 * tells the sender's streams (`audio_sent` / `audio_failed`, through `notify`).
 */
export async function sendWithAudio<T>(
	userId: number,
	id: string,
	kind: UploadKind,
	send: (audio: VoiceNote, deferred: boolean) => Promise<T>,
	refOf: (sent: T) => SentRef,
	notify: (event: 'audio_sent' | 'audio_failed', data: unknown) => void
): Promise<AudioSend<T>> {
	const entry = checkStagedAudio(userId, id);
	entry.claimed = true;
	if (entry.status === 'processing') await settle(entry, SEND_WAIT_MS);

	const finish = async (deferred: boolean): Promise<T> => {
		if (entries.get(id) !== entry) throw new AudioError('The voice note was deleted');
		if (entry.status !== 'ready' || !entry.result)
			throw new AudioError(entry.error ?? "The voice note couldn't be processed");
		const url = await storeAudioUpload(kind, await fs.promises.readFile(outputOf(id)));
		const { duration_ms, waveform, size } = entry.result;
		let sent: T;
		try {
			sent = await send({ url, duration_ms, waveform, size }, deferred);
		} catch (e) {
			await removeUploads([url]);
			throw e;
		}
		entry.status = 'sent';
		entry.sent = refOf(sent);
		void fs.promises.rm(outputOf(id), { force: true }).catch(() => {});
		return sent;
	};

	if (entry.status !== 'processing') {
		try {
			return { sent: await finish(false) };
		} catch (e) {
			// it can be tried again (unless it failed to process, which checkStagedAudio says)
			entry.claimed = false;
			if (e instanceof AudioError) fail(400, e.message);
			throw e;
		}
	}

	void entry.processed?.then(async () => {
		try {
			await finish(true);
			if (entry.sent) notify('audio_sent', { upload: id, ...entry.sent });
		} catch (e) {
			// a ready note stays ready: sending it can be tried again
			entry.claimed = false;
			const known = e instanceof AudioError || e instanceof ApiError;
			if (!known) console.error('audio: deferred send failed', e);
			const error = known ? e.message : "The voice note couldn't be sent";
			notify('audio_failed', { upload: id, error });
		}
	});
	return { pending: statusOf(id, entry) };
}

/**
 * The answer to sending a post or message whose voice note is still being processed: 202 with
 * the upload. It is sent when processing ends; the sender's streams then get `audio_sent` (or
 * `audio_failed`), and GET /api/v1/uploads/audio/{id} says where it went.
 */
export const audioPending = (upload: AudioUpload) =>
	Response.json({ status: 'processing', upload }, { status: 202 });

/** What /api/v1/instance says of voice notes: their limits, null when they're off. */
export async function voiceNotesConfig() {
	if (!(await audioAvailable())) return null;
	return {
		max_duration_ms: MAX_AUDIO_MS,
		max_upload_bytes: MAX_AUDIO_INPUT_BYTES,
		max_chunk_bytes: MAX_CHUNK_BYTES,
		max_chunks: MAX_CHUNKS
	};
}
