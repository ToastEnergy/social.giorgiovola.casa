import { File, FileMode, Paths, UploadType } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { api, ApiError, auth } from './api';
import type { AudioUpload } from './types';

/**
 * Uploads of recorded voice notes, started as soon as a recording stops so that sending is
 * instant (like the web's voice note uploads). The recording stays on the device until the note is
 * sent: staged uploads live in the server's memory, so a deploy loses them (404 / 410) and the
 * file is uploaded again from scratch.
 *
 * expo-audio writes an M4A whose header is only finished when the recording stops, so the file
 * can't be sent while it grows: it goes in one request (POST /uploads/audio), or, past what one
 * request may carry, in a chunked session that picks up where it stopped.
 */

/** a recording on this device */
export type LocalVoice = {
	/** file:// URI of the M4A */
	uri: string;
	duration_ms: number;
	/** levels sampled while recording, 0–255, for the waveform before it's uploaded */
	peaks: number[];
	/** the staged upload, once there is one (sending it again after a restart: 409 = sent) */
	upload?: string | null;
};

/** who uploads: the profile at the time (switching profile meanwhile mustn't change it) */
export type Uploader = { server: string; token: string | null; as?: string | null };

/** one request carries at most about 52 MB (the server's body limit): larger notes go in chunks */
const ONE_SHOT_MAX = 45 * 1024 * 1024;
const CHUNK_BYTES = 5 * 1024 * 1024;
/** waits between tries while the server can't be reached */
const BACKOFF_MS = [2000, 4000, 8000, 15_000, 30_000];

export type UploadState = {
	status: 'uploading' | 'waiting' | 'done' | 'failed';
	/** share sent, 0 to 1 (1: the server is processing it) */
	progress: number;
	error: string | null;
	id: string | null;
};

type Job = UploadState & {
	uri: string;
	who: Uploader;
	promise: Promise<string> | null;
	controller: AbortController;
	/** the open chunked session, to resume */
	session: string | null;
	/** what useVoiceUpload answers: a new object on every change */
	snap: UploadState;
};

const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
function changed() {
	for (const listener of listeners) listener();
}
function patch(job: Job, next: Partial<UploadState>) {
	Object.assign(job, next);
	job.snap = { status: job.status, progress: job.progress, error: job.error, id: job.id };
	changed();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** the upload of a recording, for its bubble: progress, waiting for the network, failed */
export function useVoiceUpload(uri: string | null | undefined): UploadState | null {
	return useSyncExternalStore(subscribe, () => (uri ? jobs.get(uri)?.snap ?? null : null));
}

const headers = (who: Uploader): Record<string, string> => ({
	Accept: 'application/json',
	...(who.token ? { Authorization: `Bearer ${who.token}` } : {}),
	// a staged upload belongs to the profile that sent it, which posts it
	...(who.as ? { 'X-Act-As': who.as } : {})
});

function parse(body: string): Record<string, unknown> {
	try {
		const data = JSON.parse(body);
		return data && typeof data === 'object' ? data : {};
	} catch {
		// a proxy's error page
		return {};
	}
}

/** Sends a file as the raw body of a request, with its progress (from the file, not memory). */
async function sendFile(
	file: File,
	url: string,
	method: 'POST' | 'PUT',
	type: string,
	who: Uploader,
	onProgress: (sent: number) => void,
	signal: AbortSignal
) {
	let res;
	try {
		res = await file.upload(url, {
			httpMethod: method,
			uploadType: UploadType.BINARY_CONTENT,
			mimeType: type,
			headers: { ...headers(who), 'Content-Type': type },
			onProgress: (p) => onProgress(p.bytesSent),
			signal
		});
	} catch (e) {
		if (signal.aborted) throw e;
		throw new ApiError(0, 'Could not reach the server.');
	}
	const body = parse(res.body);
	if (res.status < 200 || res.status >= 300) {
		const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status}).`;
		throw new ApiError(res.status, message, body);
	}
	return body;
}

/** The whole file in one request. */
async function uploadWhole(job: Job, file: File, size: number) {
	const body = await sendFile(
		file,
		`${job.who.server}/api/v1/uploads/audio`,
		'POST',
		'audio/mp4',
		job.who,
		(sent) => patch(job, { progress: size ? Math.min(1, sent / size) : 0 }),
		job.controller.signal
	);
	if (typeof body.id !== 'string') throw new ApiError(500, 'Unexpected answer from the server.');
	return body.id;
}

/** In chunks, skipping those the session already has (after an interruption). */
async function uploadChunked(job: Job, file: File, size: number) {
	const { server, token, as } = job.who;
	const count = Math.ceil(size / CHUNK_BYTES);
	let have = new Set<number>();
	if (job.session) {
		try {
			const status = await api<AudioUpload>(`uploads/audio/${job.session}`, { server, token, as });
			if (status.status === 'receiving') have = new Set(status.chunks ?? []);
			else if (status.status === 'failed') job.session = null;
			// already completed (the answer got lost): it's ready or being processed
			else return job.session;
		} catch (e) {
			// gone (a deploy, a day old): start over
			if (!(e instanceof ApiError && (e.status === 404 || e.status === 410))) throw e;
			job.session = null;
		}
	}
	if (!job.session) {
		const created = await api<AudioUpload>('uploads/audio/sessions', {
			method: 'POST',
			server,
			token,
			as
		});
		job.session = created.id;
		have = new Set();
	}
	const id = job.session;
	let done = [...have].reduce((sum, n) => sum + Math.min(CHUNK_BYTES, size - n * CHUNK_BYTES), 0);
	patch(job, { progress: done / size });
	const handle = file.open(FileMode.ReadOnly);
	try {
		for (let n = 0; n < count; n++) {
			if (have.has(n)) continue;
			job.controller.signal.throwIfAborted();
			handle.offset = n * CHUNK_BYTES;
			const bytes = await handle.readBytes(CHUNK_BYTES);
			// a chunk goes out from a file of its own, so it uploads from disk with its progress
			const part = new File(Paths.cache, `voice-chunk-${id}-${n}.bin`);
			if (part.exists) part.delete();
			part.create();
			part.write(bytes);
			try {
				await sendFile(
					part,
					`${server}/api/v1/uploads/audio/sessions/${id}/chunks/${n}`,
					'PUT',
					'application/octet-stream',
					job.who,
					(sent) => patch(job, { progress: Math.min(1, (done + sent) / size) }),
					job.controller.signal
				);
			} finally {
				try {
					part.delete();
				} catch {
					// the cache is cleaned up by the system anyway
				}
			}
			done += bytes.length;
		}
	} finally {
		handle.close();
	}
	await api<AudioUpload>(`uploads/audio/sessions/${id}/complete`, {
		method: 'POST',
		server,
		token,
		as,
		body: { chunks: count }
	});
	return id;
}

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(done, ms);
		// back in the app: try again now rather than at the end of the wait
		const sub = AppState.addEventListener('change', (s) => s === 'active' && done());
		signal.addEventListener('abort', done);
		function done() {
			clearTimeout(timer);
			sub.remove();
			resolve();
		}
	});

async function run(job: Job): Promise<string> {
	const file = new File(job.uri);
	if (!file.exists) {
		patch(job, { status: 'failed', error: 'The recording is no longer on this device.' });
		throw new ApiError(0, 'The recording is no longer on this device.');
	}
	const size = file.size ?? 0;
	for (let attempt = 0; ; attempt++) {
		patch(job, { status: 'uploading', error: null });
		try {
			const id =
				size > ONE_SHOT_MAX
					? await uploadChunked(job, file, size)
					: await uploadWhole(job, file, size);
			patch(job, { status: 'done', progress: 1, id });
			return id;
		} catch (e) {
			if (job.controller.signal.aborted) throw e;
			const offline =
				e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429);
			if (offline && attempt < BACKOFF_MS.length) {
				patch(job, { status: 'waiting', error: 'Waiting for the connection…' });
				await sleep(BACKOFF_MS[attempt], job.controller.signal);
				continue;
			}
			const error =
				e instanceof ApiError
					? e.status === 413
						? 'The voice note is too big.'
						: e.message
					: 'The upload failed.';
			patch(job, { status: 'failed', error });
			throw e instanceof ApiError ? e : new ApiError(0, error);
		}
	}
}

/**
 * Starts uploading a recording (or answers the upload already going on, or done). Settles with the
 * staged upload's id.
 */
export function startVoiceUpload(uri: string, who: Uploader = { ...auth }): Promise<string> {
	let job = jobs.get(uri);
	if (job && (job.who.token !== who.token || (job.who.as ?? null) !== (who.as ?? null))) {
		// another profile: its upload isn't this one's
		job.controller.abort();
		job = undefined;
	}
	if (!job) {
		job = {
			uri,
			who,
			status: 'uploading',
			progress: 0,
			error: null,
			id: null,
			promise: null,
			controller: new AbortController(),
			session: null,
			snap: { status: 'uploading', progress: 0, error: null, id: null }
		};
		jobs.set(uri, job);
		changed();
	}
	if (job.status === 'done' && job.id) return Promise.resolve(job.id);
	if (job.promise) return job.promise;
	const current = job;
	const promise = run(current).finally(() => {
		if (current.promise === promise) current.promise = null;
	});
	current.promise = promise;
	// whoever waits on it handles the error; nobody waiting is fine too
	promise.catch(() => {});
	return promise;
}

/** The server lost the staged upload (404 / 410): the next startVoiceUpload sends it again. */
export function forgetUpload(uri: string) {
	const job = jobs.get(uri);
	if (!job) return;
	job.controller.abort();
	jobs.delete(uri);
	changed();
}

/** recordings being sent right now (uploaded, then posted), by this app session */
const sending = new Set<string>();
/** Marks a recording as on its way (true) or not anymore (false). */
export function markSending(uri: string, on: boolean) {
	if (on) sending.add(uri);
	else sending.delete(uri);
}

/** whether a recording is uploading or being sent right now (a restored draft mustn't be too) */
export const isUploading = (uri: string) => sending.has(uri) || !!jobs.get(uri)?.promise;

/**
 * Throws a recording away: stops its upload, drops the staged one on the server and deletes the
 * file.
 */
export function discardVoice(voice: { uri: string; upload?: string | null }) {
	const job = jobs.get(voice.uri);
	const id = job?.id ?? voice.upload ?? job?.session ?? null;
	const who = job?.who ?? { ...auth };
	forgetUpload(voice.uri);
	if (id)
		api(`uploads/${id}`, {
			method: 'DELETE',
			server: who.server,
			token: who.token,
			as: who.as
		}).catch(() => {});
	deleteRecording(voice.uri);
}

/** Deletes a recording's file (sent, or thrown away), and forgets its upload. */
export function deleteRecording(uri: string) {
	jobs.get(uri)?.controller.abort();
	jobs.delete(uri);
	changed();
	try {
		const file = new File(uri);
		if (file.exists) file.delete();
	} catch {
		// already gone
	}
}
