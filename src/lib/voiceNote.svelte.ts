import { UploadError } from './attachment.svelte.js';
import { clearVoiceDraft, saveVoiceMeta, saveVoicePart, type VoiceDraftMeta } from './voiceDraft.js';

/**
 * A voice note recorded in a chat, on its way to the server (like `Attachment` for images). Its
 * parts (about 5 seconds of audio each, from the recorder) are uploaded to a chunked session
 * WHILE recording, so when a long note stops almost nothing is left to send, and saved as a
 * draft (voiceDraft.ts) so nothing is lost if the page goes away.
 *
 * The server keeps uploads and sessions in memory: a deploy or restart loses them (404 / 410).
 * The parts stay here until the note is sent or deleted, so it is then uploaded again from
 * scratch. Short notes (a single part when they stop) go up in one request instead.
 */

const API = '/api/v1/uploads';
// a whole recording in one request below this (the server takes about 52 MB)
const ONE_SHOT_MAX = 40 * 1024 * 1024;
// network errors are retried this often (waiting for the connection in between) before giving up
const MAX_TRIES = 6;

export type VoiceNoteStatus = 'recording' | 'uploading' | 'processing' | 'ready' | 'failed';

type AudioUpload = {
	id: string;
	status: 'receiving' | 'processing' | 'ready' | 'failed' | 'sent';
	chunks?: number[];
	error?: string | null;
};

class HttpError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

/** Resolves once the browser says it's online (at once when it is). */
export function whenOnline(): Promise<void> {
	if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
	return new Promise((resolve) => addEventListener('online', () => resolve(), { once: true }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(
	method: string,
	path: string,
	body?: BodyInit,
	type = 'application/json'
): Promise<T> {
	const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': type }, body });
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new HttpError(res.status, typeof data?.error === 'string' ? data.error : '');
	}
	return res.status === 204 ? (undefined as T) : res.json();
}

/**
 * Drafts of notes being sent right now, by key: a chat opened again meanwhile doesn't bring them
 * back as drafts (the send goes on after leaving the chat).
 */
export const sendingDrafts = new Set<string>();

/** What's left of a recording to restore it: its parts, and what the draft said of it. */
export type SavedNote = { meta: VoiceDraftMeta; parts: Blob[] };

export class VoiceNote {
	readonly mimeType: string;
	/** the draft it's saved as; null: not saved */
	readonly draftKey: string | null;
	/** the recording's bytes in order, kept until it's sent or deleted */
	readonly parts: Blob[] = [];
	/** how many parts are saved on this device (the recorder shows it's safe) */
	saved = $state(0);
	status: VoiceNoteStatus = $state('recording');
	/** share sent so far, 0 to 1 */
	progress = $state(0);
	/** why it failed, to show */
	error: string | null = $state(null);
	/** the server's id (the session's, or the one-shot upload's) once it holds the whole note */
	id: string | null = $state(null);
	durationMs = $state(0);
	waveform: number[] = $state([]);
	/** the whole recording, for playing it before (and while) it's sent */
	url: string | null = $state(null);
	/** the message it answers, saved with the draft */
	replyTo: number | null = null;
	/** send was pressed: saved so, and not brought back as a draft while it's going */
	get sending() {
		return this.#sending;
	}
	set sending(on: boolean) {
		this.#sending = on;
		if (!this.draftKey) return;
		if (on) sendingDrafts.add(this.draftKey);
		else sendingDrafts.delete(this.draftKey);
		this.save();
	}
	#sending = false;
	/** resolves to the id once the server has it all, rejects with an UploadError */
	done: Promise<string> = new Promise(() => {});

	#session: string | null = null;
	/** parts the session has */
	#sent = new Set<number>();
	/** sessions can't be used (too many open): the whole note goes in one request */
	#noSessions = false;
	#pumping: Promise<void> | null = null;
	#discarded = false;
	#xhr: XMLHttpRequest | null = null;
	#blob: Blob | null = null;

	constructor(mimeType: string, draftKey: string | null) {
		this.mimeType = mimeType;
		this.draftKey = draftKey;
	}

	/** A note saved as a draft, uploaded again (or resumed) when it's sent. */
	static restore(saved: SavedNote, draftKey: string) {
		const note = new VoiceNote(saved.meta.mimeType, draftKey);
		note.parts.push(...saved.parts);
		note.saved = saved.parts.length;
		note.#session = saved.meta.upload;
		note.replyTo = saved.meta.replyTo;
		note.#sending = saved.meta.sending;
		note.durationMs = saved.meta.durationMs;
		note.waveform = saved.meta.waveform;
		note.#makeBlob();
		note.status = 'ready';
		return note;
	}

	get blob() {
		return this.#blob ?? new Blob(this.parts, { type: this.mimeType });
	}

	get size() {
		return this.parts.reduce((sum, p) => sum + p.size, 0);
	}

	/** The next part of a recording under way: saved, and uploaded in the background. */
	addPart(part: Blob) {
		if (this.#discarded || part.size === 0) return;
		const n = this.parts.length;
		this.parts.push(part);
		this.saved = this.parts.length;
		if (this.draftKey) {
			saveVoicePart(this.draftKey, n, part);
			// the first part: the draft exists from now on
			if (n === 0) this.save();
		}
		// a second part: it's not a quick note, open a session and send as it records
		if (!this.#noSessions && this.parts.length >= 2) this.#pump();
	}

	/** Saves what's known of it with the draft. */
	save() {
		if (!this.draftKey || this.#discarded) return;
		saveVoiceMeta({
			key: this.draftKey,
			mimeType: this.mimeType,
			durationMs: this.durationMs,
			waveform: this.waveform,
			parts: this.parts.length,
			upload: this.#session,
			replyTo: this.replyTo,
			sending: this.sending
		});
	}

	/** Recording ended: uploads what's left (or all of it) and completes the upload. */
	finish(durationMs: number, waveform: number[]) {
		this.durationMs = durationMs;
		this.waveform = waveform;
		this.#makeBlob();
		this.save();
		this.upload();
	}

	#makeBlob() {
		if (this.url) URL.revokeObjectURL(this.url);
		this.#blob = new Blob(this.parts, { type: this.mimeType });
		this.url = URL.createObjectURL(this.#blob);
	}

	/**
	 * (Re)starts getting the whole note to the server. `fresh`: the server lost it (a 410 when
	 * sending, a restart): everything goes up again.
	 */
	upload(fresh = false) {
		if (this.#discarded) return;
		if (fresh) {
			this.#session = null;
			this.#sent.clear();
		}
		this.id = null;
		this.error = null;
		this.status = 'uploading';
		this.progress = this.#sentShare();
		const done = this.#upload();
		this.done = done;
		done.then(
			(id) => {
				if (this.done !== done) return;
				this.id = id;
				this.progress = 1;
				if (this.status === 'uploading') this.status = 'processing';
			},
			(e) => {
				if (this.done !== done || this.#discarded) return;
				this.status = 'failed';
				this.error = e instanceof UploadError ? e.message : 'Could not upload the voice note.';
			}
		);
	}

	/** The server finished processing it (or sending will wait for that). */
	markReady() {
		if (this.status === 'processing') this.status = 'ready';
	}

	async #upload(): Promise<string> {
		for (let tries = 0; ; tries++) {
			await whenOnline();
			try {
				if (!this.#session && (this.parts.length <= 1 || this.#noSessions) && this.size <= ONE_SHOT_MAX)
					return await this.#oneShot();
				return await this.#completeSession();
			} catch (e) {
				if (this.#discarded) throw new UploadError('Deleted.');
				if (e instanceof HttpError) {
					// the server lost the session (a restart): everything again, in a new one
					if (e.status === 404 || e.status === 410) {
						this.#session = null;
						this.#sent.clear();
						continue;
					}
					// too many open sessions: one request
					if (e.status === 429 && !this.#session && this.size <= ONE_SHOT_MAX) {
						this.#noSessions = true;
						continue;
					}
					if (e.status >= 400 && e.status < 500)
						throw new UploadError(
							e.status === 413
								? 'The voice note is too big.'
								: e.message || 'Could not upload the voice note.'
						);
				}
				// the network or the server (a deploy): try again in a moment
				if (tries >= MAX_TRIES)
					throw new UploadError('Could not upload the voice note, check your connection.');
				await wait(Math.min(15_000, 1000 * 2 ** tries));
			}
		}
	}

	/** Sends the whole recording in one request, with progress. */
	#oneShot(): Promise<string> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			this.#xhr = xhr;
			xhr.open('POST', `${API}/audio`);
			// the base type: the server recognises the file from its content anyway
			xhr.setRequestHeader('Content-Type', this.mimeType.split(';')[0] || 'audio/webm');
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) this.progress = e.loaded / e.total;
			};
			xhr.onload = () => {
				this.#xhr = null;
				let data: { id?: string; error?: string } = {};
				try {
					data = JSON.parse(xhr.responseText);
				} catch {
					// not JSON: a proxy's error page
				}
				if ((xhr.status === 201 || xhr.status === 200) && data.id) {
					this.#session = data.id;
					this.save();
					return resolve(data.id);
				}
				reject(new HttpError(xhr.status || 502, data.error ?? ''));
			};
			xhr.onerror = () => {
				this.#xhr = null;
				reject(new TypeError('network'));
			};
			xhr.onabort = () => reject(new UploadError('Upload cancelled.'));
			xhr.send(this.blob);
		});
	}

	/** Makes sure the server has every part in a session, then completes it. */
	async #completeSession(): Promise<string> {
		if (this.#session && this.#sent.size === 0) await this.#resume();
		await this.#pump();
		if (!this.#session) throw new TypeError('no session');
		if (this.#sent.size < this.parts.length) throw new TypeError('parts missing');
		const id = this.#session;
		try {
			const upload = await request<AudioUpload>(
				'POST',
				`/audio/sessions/${id}/complete`,
				JSON.stringify({ chunks: this.parts.length })
			);
			if (upload.status === 'failed') throw new UploadError(upload.error || 'Could not process the voice note.');
			return id;
		} catch (e) {
			if (!(e instanceof HttpError)) throw e;
			// completed already (the answer was lost): fine unless it failed
			if (e.status === 409) {
				const upload = await request<AudioUpload>('GET', `/audio/${id}`);
				if (upload.status === 'failed')
					throw new UploadError(upload.error || 'Could not process the voice note.');
				return id;
			}
			// "Chunk n is missing": ask which ones the server has and send the rest
			if (e.status === 400 && /missing/i.test(e.message)) {
				this.#sent.clear();
				throw new TypeError('resume');
			}
			throw e;
		}
	}

	/** After a reload or a lost answer: which parts does the open session already have? */
	async #resume() {
		if (!this.#session) return;
		const upload = await request<AudioUpload>('GET', `/audio/${this.#session}`);
		this.#sent = new Set(upload.status === 'receiving' ? upload.chunks ?? [] : []);
		if (upload.status !== 'receiving') {
			// completed (or worse) in a previous visit: sending decides, with the id as it is
			if (upload.status === 'failed') throw new HttpError(410, 'failed');
			this.#sent = new Set(this.parts.map((_, i) => i));
		}
	}

	/** Sends the parts the session doesn't have yet, one at a time. Shared by every caller. */
	#pump(): Promise<void> {
		this.#pumping ??= this.#runPump().finally(() => (this.#pumping = null));
		return this.#pumping;
	}

	async #runPump() {
		for (;;) {
			if (this.#discarded) return;
			const n = this.parts.findIndex((_, i) => !this.#sent.has(i));
			if (n === -1) return;
			if (!this.#session) {
				try {
					const session = await request<AudioUpload>('POST', '/audio/sessions');
					this.#session = session.id;
					this.save();
				} catch (e) {
					if (e instanceof HttpError && e.status === 429) this.#noSessions = true;
					// while recording: the parts wait (sending decides then); after it, the caller retries
					if (this.status === 'recording') return;
					throw e;
				}
			}
			try {
				await request(
					'PUT',
					`/audio/sessions/${this.#session}/chunks/${n}`,
					this.parts[n],
					'application/octet-stream'
				);
				this.#sent.add(n);
				if (this.status === 'uploading') this.progress = this.#sentShare();
			} catch (e) {
				// the session is gone (a restart): a new one, everything again
				if (e instanceof HttpError && (e.status === 404 || e.status === 410)) {
					this.#session = null;
					this.#sent.clear();
					continue;
				}
				if (this.status === 'recording') return;
				throw e;
			}
		}
	}

	#sentShare() {
		const total = this.size;
		if (!total) return 0;
		let sent = 0;
		for (const n of this.#sent) sent += this.parts[n]?.size ?? 0;
		return sent / total;
	}

	/** Sent: its draft goes, and the recording once nothing plays it. */
	sent(keepUrl = false) {
		this.#discarded = true;
		if (this.draftKey) sendingDrafts.delete(this.draftKey);
		if (this.draftKey) clearVoiceDraft(this.draftKey);
		if (this.url && !keepUrl) URL.revokeObjectURL(this.url);
	}

	/** Deleted: stops uploading, deletes it from the server and its draft. */
	discard() {
		this.#discarded = true;
		if (this.draftKey) sendingDrafts.delete(this.draftKey);
		this.#xhr?.abort();
		const id = this.id ?? this.#session;
		if (id)
			fetch(`${API}/${id}`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				keepalive: true
			}).catch(() => {});
		if (this.draftKey) clearVoiceDraft(this.draftKey);
		if (this.url) URL.revokeObjectURL(this.url);
	}

	/** Whether the server already sent a message with it (a draft from a send that went out). */
	async alreadySent() {
		if (!this.#session) return false;
		try {
			const upload = await request<AudioUpload>('GET', `/audio/${this.#session}`);
			return upload.status === 'sent';
		} catch {
			// gone (404) or offline: not sent as far as we know
			return false;
		}
	}
}
