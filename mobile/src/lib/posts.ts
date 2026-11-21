import type { Dispatch, SetStateAction } from 'react';
import { api, auth, errorMessage } from './api';
import { emit, useBus } from './bus';
import type { Post } from './types';
import { pickProfile, toast } from '@/components/overlays';
import type { PickerProfile } from '@/components/ProfileSheet';

export const postUrl = (post: { id: number; user: { username: string } }) =>
	`${auth.server}/@${post.user.username}/${post.id}`;

/** a change made here, shown at once by every list holding the post */
const patch = (id: number, fields: Partial<Post>) => emit('post_patch', { id, ...fields });

// `as` below is the screen's context profile (null: the profile in use): the post's liked,
// regiorged and voted are its, and so are the actions

export const toggleLike = (post: Post, as?: string | null) =>
	setReaction(post, 'like', !post.liked, as);

/** the double tap on a post: it only ever likes */
export const like = (post: Post, as?: string | null) =>
	post.liked ? undefined : setReaction(post, 'like', true, as);

export const toggleRegiorg = (post: Post, as?: string | null) =>
	setReaction(post, 'regiorg', !post.regiorged, as);

type Reaction = 'like' | 'regiorg';

/**
 * Likes or regiorgs (or undoes it) as `as` (null: the profile in use). The post on screen shows
 * `showing`'s state: only then is its button changed at once and by the answer; the counts follow
 * either way.
 */
async function setReaction(
	post: Post,
	kind: Reaction,
	on: boolean,
	as: string | null | undefined,
	showing = true
) {
	const state = kind === 'like' ? 'liked' : 'regiorged';
	const total = kind === 'like' ? 'likes' : 'regiorgs';
	if (showing) patch(post.id, { [state]: on, [total]: Math.max(0, post[total] + (on ? 1 : -1)) });
	try {
		const res = await api<Record<string, boolean | number>>(`posts/${post.id}/${kind}`, {
			method: on ? 'PUT' : 'DELETE',
			as
		});
		patch(post.id, showing ? res : { [total]: res[total] as number });
	} catch (e) {
		if (showing) patch(post.id, { [state]: post[state], [total]: post[total] });
		toast(errorMessage(e));
	}
}

type Viewer = { username: string; liked: boolean; regiorged: boolean; following: boolean };

/** What each of the account's profiles did with a post (GET /posts/:id/viewers, as the account). */
export const postViewers = (id: number) =>
	api<{ items: Viewer[] }>(`posts/${id}/viewers`).then((res) => res.items);

/**
 * "Like as…" / "Regiorg as…": picks one of the account's profiles (each with what it did already)
 * and toggles for it. `shown` is the profile the screen shows the post as, `inUse` the profile in
 * use.
 */
export async function reactAs(
	post: Post,
	kind: Reaction,
	profiles: PickerProfile[],
	shown: string,
	inUse: string
) {
	const field = kind === 'like' ? 'liked' : 'regiorged';
	const viewers = postViewers(post.id);
	const picked = await pickProfile({
		title: kind === 'like' ? 'Like as…' : 'Regiorg as…',
		profiles,
		current: shown,
		notes: viewers.then((items) =>
			Object.fromEntries(
				items
					.filter((v) => v[field])
					.map((v) => [v.username, kind === 'like' ? 'Liked' : 'Regiorged'])
			)
		)
	});
	if (!picked) return;
	let did: boolean;
	try {
		did = (await viewers).find((v) => v.username === picked)?.[field] ?? false;
	} catch (e) {
		return toast(errorMessage(e));
	}
	await setReaction(post, kind, !did, picked === inUse ? null : picked, picked === shown);
}

export async function vote(post: Post, option: number, as?: string | null) {
	if (!post.poll) return;
	try {
		const res = await api<{ voted: number; votes: number[] }>(`posts/${post.id}/vote`, {
			method: 'PUT',
			body: { option },
			as
		});
		patch(post.id, { poll: { ...post.poll, ...res } });
	} catch (e) {
		toast(errorMessage(e));
	}
}

export async function deletePost(post: Post, as?: string | null) {
	try {
		await api(`posts/${post.id}`, { method: 'DELETE', as });
		emit('post_deleted', { id: post.id });
	} catch (e) {
		toast(errorMessage(e));
	}
}

/** pin to the author's profile (`pin`) or, for staff, above the timeline (`timeline-pin`) */
export async function setPin(
	post: Post,
	kind: 'pin' | 'timeline-pin',
	pinned: boolean,
	as?: string | null
) {
	try {
		await api(`posts/${post.id}/${kind}`, { method: pinned ? 'PUT' : 'DELETE', as });
		patch(post.id, kind === 'pin' ? { pinned } : { timeline_pinned: pinned });
		emit('pins_changed');
		toast(pinned ? 'Pinned' : 'Unpinned');
	} catch (e) {
		toast(errorMessage(e));
	}
}

/**
 * Keeps a list of posts current: changes made in the app and the stream's events (counts,
 * edits, deletions, poll votes). The stream's posts are an anonymous view, so what the viewer
 * did (liked, regiorged, voted) is kept from the copy already shown.
 */
export function usePostSync(setPosts: Dispatch<SetStateAction<Post[]>>) {
	const update = (id: number, change: (post: Post) => Post) =>
		setPosts((posts) =>
			posts.some((p) => p.id === id) ? posts.map((p) => (p.id === id ? change(p) : p)) : posts
		);
	useBus('post_patch', ({ id, ...fields }: Partial<Post> & { id: number }) =>
		update(id, (p) => ({ ...p, ...fields }))
	);
	useBus('counts', ({ id, ...counts }: Partial<Post> & { id: number }) =>
		update(id, (p) => ({ ...p, ...counts }))
	);
	useBus('post_edited', (post: Post) =>
		update(post.id, (p) => ({
			...p,
			content: post.content,
			edited_at: post.edited_at,
			linked_post: post.linked_post,
			link_preview: post.link_preview
		}))
	);
	useBus('poll', ({ id, votes }: { id: number; votes: number[] }) =>
		update(id, (p) => (p.poll ? { ...p, poll: { ...p.poll, votes } } : p))
	);
	useBus('post_deleted', ({ id }: { id: number }) =>
		setPosts((posts) => (posts.some((p) => p.id === id) ? posts.filter((p) => p.id !== id) : posts))
	);
}
