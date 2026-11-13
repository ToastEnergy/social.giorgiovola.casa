import { useSyncExternalStore } from 'react';
import { api, ApiError, errorMessage, uploadImage } from './api';
import { emit } from './bus';
import { clearDraft, returnDraft, type ComposerDraft, type DraftOwner } from './drafts';
import type { Post } from './types';

/**
 * Posts on their way to the server. The composer closes as soon as Post is tapped, like the web;
 * the images are uploaded and the post sent here, in the background, with the progress shown by
 * PostingStatus. A post that doesn't go out comes back as the composer's draft, with the error.
 */

export type Outgoing = {
	key: number;
	/** the composer it was written in: `post`, `reply:<id>`, `quote:<id>` */
	composer: string;
	owner: DraftOwner;
	draft: ComposerDraft;
	/** share of each image uploaded, 0 to 1; at 1 the server is processing it, 2 once done */
	progress: number[];
	/** set once it failed: why */
	error?: string;
};

let outgoing: Outgoing[] = [];
const listeners = new Set<() => void>();
let nextKey = 0;

function set(next: Outgoing[]) {
	outgoing = next;
	for (const listener of listeners) listener();
}
const update = (key: number, patch: Partial<Outgoing>) =>
	set(outgoing.map((o) => (o.key === key ? { ...o, ...patch } : o)));
const drop = (key: number) => set(outgoing.filter((o) => o.key !== key));

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const useOutgoing = () =>
	useSyncExternalStore(
		subscribe,
		() => outgoing,
		() => outgoing
	);

/** whether a post from this composer is still on its way (its saved draft is what's sent) */
export const isSending = (owner: DraftOwner, composer: string) =>
	outgoing.some(
		(o) =>
			!o.error &&
			o.composer === composer &&
			o.owner.id === owner.id &&
			o.owner.server === owner.server
	);

/** the composer's screen, to open it again on a failed post */
export function composerHref(composer: string) {
	const [kind, id] = composer.split(':');
	return kind === 'reply' || kind === 'quote' ? `/compose?${kind}=${id}` : '/compose';
}

export const dismissOutgoing = drop;

/**
 * Sends a post in the background. `savedAt` is when its draft was saved: the draft is dropped
 * once the post lands, or given back with the error, unless something new was written since.
 */
export function startPost(options: {
	composer: string;
	owner: DraftOwner;
	draft: ComposerDraft;
	savedAt: number;
	/** the profile's token at the time: switching profile meanwhile mustn't change who posts */
	token: string | null;
	onSent?: () => void;
}) {
	const { composer, owner, draft, savedAt, token } = options;
	const key = nextKey++;
	set([...outgoing, { key, composer, owner, draft, progress: draft.images.map(() => 0) }]);
	const [kind, id] = composer.split(':');
	const upload = async () => {
		const ids: string[] = [];
		const setProgress = (i: number, share: number) => {
			const progress = [...(outgoing.find((o) => o.key === key)?.progress ?? [])];
			progress[i] = share;
			update(key, { progress });
		};
		for (const [i, image] of draft.images.entries()) {
			ids.push(
				await uploadImage(image, {
					server: owner.server,
					token,
					onProgress: (share) => setProgress(i, share)
				})
			);
			setProgress(i, 2);
		}
		return ids;
	};
	const send = async () =>
		api<Post>('posts', {
			method: 'POST',
			server: owner.server,
			token,
			body: {
				content: draft.content,
				uploads: await upload(),
				gif: draft.gif,
				reply_to: kind === 'reply' ? Number(id) : null,
				quote_of: kind === 'quote' ? Number(id) : null,
				poll: draft.poll
					? {
							options: draft.poll.options.map((o) => o.trim()).filter(Boolean),
							duration_minutes: draft.poll.minutes
					  }
					: null
			}
		});
	(async () => {
		try {
			let post: Post;
			try {
				post = await send();
			} catch (e) {
				// the server let the images expire (kept for a day, or lost on a restart): upload again
				if (!(e instanceof ApiError && e.status === 410 && draft.images.length)) throw e;
				update(key, { progress: draft.images.map(() => 0) });
				post = await send();
			}
			drop(key);
			options.onSent?.();
			await clearDraft(owner, composer, savedAt);
			emit('post_created', post);
		} catch (e) {
			const error =
				e instanceof ApiError && e.status === 413 ? 'Images are too big.' : errorMessage(e);
			update(key, { error });
			const back = await returnDraft(owner, composer, { ...draft, error }, savedAt);
			// an open composer that is still empty takes it back at once
			if (back) emit('draft_returned', { owner, composer });
		}
	})();
}
