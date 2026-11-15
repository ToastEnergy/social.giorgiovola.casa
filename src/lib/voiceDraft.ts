/**
 * Keeps unsent voice notes of the chats, so that leaving a chat, a reload or a crash doesn't lose
 * a recording. IndexedDB, next to the composer drafts (composerDraft.ts) but in a database of its
 * own: a recording is saved in parts (about 5 seconds each) as it's made, so an hour long note
 * never has to be written again as a whole, and what was recorded before a crash is still there.
 *
 * A draft belongs to a profile and a conversation and only comes back there: its key is
 * `u:<user id>:dm:<username>:<started at>` or `u:<user id>:group:<id>:<started at>`, one per
 * recording, so a new one never mixes with one still being sent.
 */

export type VoiceDraftMeta = {
	/** `u:<user id>:<conversation>:<started at>` */
	key: string;
	mimeType: string;
	/** how much was recorded, as measured while recording */
	durationMs: number;
	/** 64 bars 0–255, for the review until the server measures its own */
	waveform: number[];
	/** how many parts were saved (0 to parts - 1) */
	parts: number;
	/** the upload session the parts went to, to resume it or see whether it was sent */
	upload: string | null;
	/** the message it answers */
	replyTo: number | null;
	/** send was pressed: on a reload it comes back as a failed send rather than for review */
	sending: boolean;
	savedAt: number;
};

/** a draft untouched this long is dropped */
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const DB_NAME = 'voice-drafts';
const DRAFTS = 'drafts';
const PARTS = 'parts';

/** Where a conversation's drafts are, for loadVoiceDrafts. */
export const voiceDraftPrefix = (user: number, conversation: string) =>
	`u:${user}:${conversation}:`;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(DRAFTS, { keyPath: 'key' });
			req.result.createObjectStore(PARTS, { keyPath: ['key', 'n'] });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

// one connection for the page: parts are written every few seconds while recording
let db: Promise<IDBDatabase> | null = null;
const database = () => (db ??= openDb().catch((e) => ((db = null), Promise.reject(e))));

async function run<T>(
	stores: string[],
	mode: IDBTransactionMode,
	fn: (tx: IDBTransaction) => (() => T) | void
): Promise<T | undefined> {
	const tx = (await database()).transaction(stores, mode);
	const result = fn(tx);
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve(typeof result === 'function' ? result() : undefined);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/** Saves part `n` of a recording (its bytes, in order). */
export async function saveVoicePart(key: string, n: number, blob: Blob) {
	await run([PARTS], 'readwrite', (tx) => void tx.objectStore(PARTS).put({ key, n, blob })).catch(
		() => {}
	);
}

/** Saves what's known of a recording, replacing what was saved before. */
export async function saveVoiceMeta(meta: Omit<VoiceDraftMeta, 'savedAt'>) {
	const stored: VoiceDraftMeta = { ...meta, waveform: [...meta.waveform], savedAt: Date.now() };
	await run([DRAFTS], 'readwrite', (tx) => void tx.objectStore(DRAFTS).put(stored)).catch(() => {});
}

const partsRange = (key: string) => IDBKeyRange.bound([key, 0], [key, Infinity]);

/** The saved recordings of a conversation (`prefix` from voiceDraftPrefix), newest first. */
export async function loadVoiceDrafts(
	prefix: string
): Promise<{ meta: VoiceDraftMeta; parts: Blob[] }[]> {
	try {
		prune();
		// every key starting with the prefix
		const range = IDBKeyRange.bound(prefix, `${prefix}${String.fromCharCode(0xffff)}`);
		const metas =
			(await run<VoiceDraftMeta[]>([DRAFTS], 'readonly', (tx) => {
				const req = tx.objectStore(DRAFTS).getAll(range);
				return () => req.result;
			})) ?? [];
		const drafts: { meta: VoiceDraftMeta; parts: Blob[] }[] = [];
		for (const meta of metas) {
			if (Date.now() - meta.savedAt > MAX_AGE_MS) continue;
			const rows =
				(await run<{ n: number; blob: Blob }[]>([PARTS], 'readonly', (tx) => {
					const req = tx.objectStore(PARTS).getAll(partsRange(meta.key));
					return () => req.result;
				})) ?? [];
			// parts saved after the meta (the last seconds before a crash) count too
			const parts = rows.sort((a, b) => a.n - b.n).map((r) => r.blob);
			if (parts.every((p) => p.size === 0)) {
				void clearVoiceDraft(meta.key);
				continue;
			}
			drafts.push({ meta: { ...meta, parts: parts.length }, parts });
		}
		return drafts.sort((a, b) => b.meta.key.localeCompare(a.meta.key, 'en', { numeric: true }));
	} catch {
		// private mode or blocked storage: nothing was saved either
		return [];
	}
}

/** Drops a saved recording: sent or deleted. */
export async function clearVoiceDraft(key: string) {
	await run([DRAFTS, PARTS], 'readwrite', (tx) => {
		tx.objectStore(DRAFTS).delete(key);
		tx.objectStore(PARTS).delete(partsRange(key));
	}).catch(() => {});
}

let pruned = false;

/** Drops drafts nobody came back to, once per page load. */
function prune() {
	if (pruned) return;
	pruned = true;
	const stale: string[] = [];
	run([DRAFTS], 'readonly', (tx) => {
		const req = tx.objectStore(DRAFTS).openCursor();
		req.onsuccess = () => {
			const cursor = req.result;
			if (!cursor) return;
			const meta = cursor.value as Partial<VoiceDraftMeta>;
			if (typeof meta.savedAt !== 'number' || Date.now() - meta.savedAt > MAX_AGE_MS)
				stale.push(String(meta.key));
			cursor.continue();
		};
	})
		.then(() => Promise.all(stale.map(clearVoiceDraft)))
		.catch(() => {});
}
