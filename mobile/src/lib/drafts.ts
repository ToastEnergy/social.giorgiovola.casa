import { File, Paths } from 'expo-file-system';
import type { Picked } from '@/components/attachments';
import type { Gif } from './types';

/**
 * Keeps what's in the post composer, so that leaving it (closing the screen, the app being
 * killed) doesn't lose it, like the web's composerDraft.ts. Drafts live in a JSON file in the
 * app's documents; images are kept as their local URIs and uploaded again when the post is sent.
 *
 * A draft belongs to a profile on an instance and to a composer (`post`, `reply:<id>`,
 * `quote:<id>`), and only comes back to that same profile and composer.
 */

export type ComposerDraft = {
	content: string;
	images: Picked[];
	gif: Gif | null;
	poll: { options: string[]; minutes: number } | null;
	/** why the post this draft was sent as didn't go out */
	error?: string | null;
};

/** whose drafts: a profile on an instance */
export type DraftOwner = { server: string; id: number };

type Stored = ComposerDraft & { savedAt: number };

/** a draft untouched this long is dropped */
const MAX_AGE_MS = 3 * 24 * 60 * 60_000;

const keyOf = (owner: DraftOwner, composer: string) => `${owner.server}|${owner.id}|${composer}`;
const file = () => new File(Paths.document, 'composer-drafts.json');

let drafts: Record<string, Stored> | null = null;
let loading: Promise<Record<string, Stored>> | null = null;
// writes go out one at a time, so an older one never lands after a newer one
let writing = Promise.resolve();

function read() {
	if (drafts) return Promise.resolve(drafts);
	loading ??= (async () => {
		let all: Record<string, Stored> = {};
		try {
			const f = file();
			if (f.exists) all = JSON.parse(await f.text()) ?? {};
		} catch {
			// unreadable: start over rather than never saving again
		}
		for (const [key, draft] of Object.entries(all))
			if (typeof draft?.savedAt !== 'number' || Date.now() - draft.savedAt > MAX_AGE_MS)
				delete all[key];
		drafts = all;
		return all;
	})();
	return loading;
}

function write() {
	const json = JSON.stringify(drafts ?? {});
	writing = writing
		.then(async () => {
			const f = file();
			if (!f.exists) f.create();
			await f.write(json);
		})
		.catch(() => {});
}

export const isEmptyDraft = (d: ComposerDraft) =>
	!d.content.trim() && d.images.length === 0 && !d.gif && !d.poll;

const stillThere = (image: Picked) => {
	try {
		return new File(image.uri).exists;
	} catch {
		// not a file URI (a content:// one): let the upload find out
		return true;
	}
};

/** The saved draft of this composer, without images whose file the system has since removed. */
export async function loadDraft(owner: DraftOwner, composer: string) {
	const draft = (await read())[keyOf(owner, composer)];
	if (!draft) return null;
	return { ...draft, images: draft.images.filter(stillThere) } as Stored;
}

/** Saves a composer's draft (or drops it once emptied). Answers when it was saved. */
export async function saveDraft(owner: DraftOwner, composer: string, draft: ComposerDraft) {
	const all = await read();
	const key = keyOf(owner, composer);
	const savedAt = Date.now();
	if (isEmptyDraft(draft)) delete all[key];
	else
		all[key] = {
			content: draft.content,
			images: draft.images.map((i) => ({ uri: i.uri, mimeType: i.mimeType ?? null })),
			gif: draft.gif,
			poll: draft.poll && { options: [...draft.poll.options], minutes: draft.poll.minutes },
			error: draft.error ?? null,
			savedAt
		};
	write();
	return savedAt;
}

/**
 * Puts back a post that didn't go out as the composer's draft, with why, unless something new
 * was written there since it was sent. Answers whether it was put back.
 */
export async function returnDraft(
	owner: DraftOwner,
	composer: string,
	draft: ComposerDraft,
	savedBefore: number
) {
	const now = (await read())[keyOf(owner, composer)];
	if (now && now.savedAt > savedBefore) return false;
	await saveDraft(owner, composer, draft);
	return true;
}

/**
 * Drops a composer's draft: posted. With `savedBefore`, only if it wasn't saved again since
 * (something new was written while the post was on its way). Answers whether it was dropped.
 */
export async function clearDraft(owner: DraftOwner, composer: string, savedBefore?: number) {
	const all = await read();
	const key = keyOf(owner, composer);
	const draft = all[key];
	if (!draft) return true;
	if (savedBefore !== undefined && draft.savedAt > savedBefore) return false;
	delete all[key];
	write();
	return true;
}
