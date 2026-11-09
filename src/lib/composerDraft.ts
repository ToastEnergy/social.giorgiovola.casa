/**
 * Keeps what's in the post composers, so that leaving one (a tap on the bottom bar, closing the
 * full screen composer, a reload) doesn't lose it. Drafts live in IndexedDB, images as files:
 * their uploads are temporary and per profile, so they're uploaded again when the draft comes
 * back.
 *
 * A draft belongs to a profile and a composer (`u:<user id>:<composer>`) and only comes back to
 * that same profile. The one exception is a profile switch, which explicitly carries the open
 * drafts to the profile switched to (`switch:<composer>`, naming it).
 */

import type { Gif } from '#lib/types.js';

export type ComposerDraft = {
	/** which composer it's from: `post`, `reply:<id>` or `quote:<id>` */
	key: string;
	content: string;
	pollOptions: string[] | null;
	pollMinutes: number;
	files: File[];
	/** a chosen KLIPY GIF (only its URLs) */
	gif?: Gif | null;
};

type Stored = {
	/** `u:<user id>:<composer>` or `switch:<composer>` */
	key: string;
	composer: string;
	content: string;
	pollOptions: string[] | null;
	pollMinutes: number;
	files: File[];
	gif?: Gif | null;
	savedAt: number;
	/** switch drafts: the username switched to, the only one that may take it */
	to?: string;
	/** switch drafts: the old profile's own draft, dropped once this one is taken */
	from?: string;
};

/** a draft untouched this long is dropped */
const MAX_AGE_MS = 3 * 24 * 60 * 60_000;
/** a switch draft not taken back by then (the composer isn't on the new page) is dropped */
const SWITCH_MAX_AGE_MS = 10 * 60_000;
/** how long a switch waits for the composers, which may wait for posts on their way */
const SAVE_TIMEOUT_MS = 15_000;

const DB_NAME = 'composer-drafts';
const STORE = 'drafts';

const userKey = (user: number, composer: string) => `u:${user}:${composer}`;
const switchKey = (composer: string) => `switch:${composer}`;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function withStore<T>(
	mode: IDBTransactionMode,
	/** returns the request whose result is wanted, or a function reading the results */
	run: (store: IDBObjectStore) => IDBRequest<T> | (() => T) | void
): Promise<T | undefined> {
	const db = await openDb();
	try {
		return await new Promise<T | undefined>((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const req = run(tx.objectStore(STORE));
			tx.oncomplete = () =>
				resolve(typeof req === 'function' ? req() : req ? req.result : undefined);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

const expired = (s: Stored) =>
	Date.now() - s.savedAt > (s.key.startsWith('switch:') ? SWITCH_MAX_AGE_MS : MAX_AGE_MS);

let pruned = false;

/** Drops stale drafts (and ones from before drafts were per profile), once per page load. */
function prune() {
	if (pruned) return;
	pruned = true;
	withStore('readwrite', (store) => {
		const req = store.openCursor();
		req.onsuccess = () => {
			const cursor = req.result;
			if (!cursor) return;
			const s = cursor.value as Partial<Stored>;
			if (typeof s.composer !== 'string' || typeof s.savedAt !== 'number' || expired(s as Stored))
				cursor.delete();
			cursor.continue();
		};
	}).catch(() => {});
}

function toDraft(s: Stored): ComposerDraft {
	// some browsers give a File back as a plain Blob
	const files = (s.files ?? []).map((f) =>
		f instanceof File ? f : new File([f], 'image', { type: (f as Blob).type })
	);
	return {
		key: s.composer,
		content: s.content,
		pollOptions: s.pollOptions,
		pollMinutes: s.pollMinutes,
		files,
		gif: s.gif ?? null
	};
}

/**
 * The draft for this composer of this profile: one carried over by a profile switch to it (taken
 * once), else the profile's own saved draft.
 */
export async function loadDraft(
	user: { id: number; username: string },
	composer: string
): Promise<ComposerDraft | null> {
	try {
		prune();
		const [carried, own] =
			(await withStore<[Stored | undefined, Stored | undefined]>('readonly', (s) => {
				const a = s.get(switchKey(composer));
				const b = s.get(userKey(user.id, composer));
				return () => [a.result, b.result];
			})) ?? [];
		const mine = own && !expired(own) ? own : null;
		if (carried && !expired(carried) && carried.to?.toLowerCase() === user.username.toLowerCase()) {
			await withStore('readwrite', (s) => {
				s.delete(carried.key);
				// moved to this profile, so the old one doesn't keep a copy; unless this profile has
				// a draft of its own here, which wins: the carried one then stays where it was
				if (carried.from && !mine) s.delete(carried.from);
			});
			if (!mine) return toDraft(carried);
		}
		return mine && toDraft(mine);
	} catch {
		// private mode or blocked storage: nothing was saved either
		return null;
	}
}

/** Saves a composer's draft for this profile, replacing the previous one. */
export async function saveDraft(user: number, draft: ComposerDraft) {
	const stored: Stored = {
		key: userKey(user, draft.key),
		composer: draft.key,
		content: draft.content,
		pollOptions: draft.pollOptions && [...draft.pollOptions],
		pollMinutes: draft.pollMinutes,
		files: [...draft.files],
		gif: draft.gif ? { ...draft.gif } : null,
		savedAt: Date.now()
	};
	await withStore('readwrite', (s) => s.put(stored)).catch(() => {});
}

/**
 * Drops a composer's draft for this profile: emptied or posted. With `savedBefore`, only if it
 * wasn't saved again since (something new was written while a post was on its way).
 */
export async function clearDraft(user: number, composer: string, savedBefore?: number) {
	const key = userKey(user, composer);
	await withStore('readwrite', (store) => {
		if (savedBefore === undefined) return void store.delete(key);
		const req = store.get(key);
		req.onsuccess = () => {
			const s = req.result as Stored | undefined;
			if (s && s.savedAt <= savedBefore) store.delete(key);
		};
	}).catch(() => {});
}

/**
 * Called before a switch. Returns the composer's draft (null when empty) after dropping its
 * uploads, which the next profile can't use and couldn't delete, and the profile it's from.
 */
type Saver = () => Promise<(ComposerDraft & { user: number }) | null>;

const savers = new Set<Saver>();

/** Registers an open composer; returns the function that unregisters it. */
export function onProfileSwitch(saver: Saver): () => void {
	savers.add(saver);
	return () => savers.delete(saver);
}

/**
 * Carries every open composer's draft to the profile `to` is switching to. Returns the saved
 * keys, to drop them if the switch fails.
 */
export async function saveDrafts(to: string): Promise<string[]> {
	const timeout = new Promise<null>((r) => setTimeout(() => r(null), SAVE_TIMEOUT_MS));
	const drafts = await Promise.all(
		[...savers].map((save) => Promise.race([save().catch(() => null), timeout]))
	);
	const keys: string[] = [];
	for (const draft of drafts) {
		if (!draft) continue;
		const stored: Stored = {
			key: switchKey(draft.key),
			composer: draft.key,
			content: draft.content,
			pollOptions: draft.pollOptions,
			pollMinutes: draft.pollMinutes,
			files: draft.files,
			gif: draft.gif ? { ...draft.gif } : null,
			savedAt: Date.now(),
			to,
			from: userKey(draft.user, draft.key)
		};
		try {
			await withStore('readwrite', (s) => s.put(stored));
			keys.push(stored.key);
		} catch {
			// storage unavailable: switching still works, the draft is lost as before
		}
	}
	return keys;
}

/** Drops drafts saved for a switch that then failed, so they don't go to that profile later. */
export async function dropDrafts(keys: string[]) {
	await Promise.all(
		keys.map((key) => withStore('readwrite', (s) => s.delete(key)).catch(() => {}))
	);
}
