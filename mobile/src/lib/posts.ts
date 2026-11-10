import type { Dispatch, SetStateAction } from 'react';
import { api, auth, errorMessage } from './api';
import { emit, useBus } from './bus';
import type { Post } from './types';
import { toast } from '@/components/overlays';

export const postUrl = (post: { id: number; user: { username: string } }) =>
	`${auth.server}/@${post.user.username}/${post.id}`;

/** a change made here, shown at once by every list holding the post */
const patch = (id: number, fields: Partial<Post>) => emit('post_patch', { id, ...fields });

export async function toggleLike(post: Post) {
	const liked = !post.liked;
	patch(post.id, { liked, likes: Math.max(0, post.likes + (liked ? 1 : -1)) });
	try {
		const res = await api<{ liked: boolean; likes: number }>(`posts/${post.id}/like`, {
			method: liked ? 'PUT' : 'DELETE'
		});
		patch(post.id, res);
	} catch (e) {
		patch(post.id, { liked: post.liked, likes: post.likes });
		toast(errorMessage(e));
	}
}

export async function toggleRegiorg(post: Post) {
	const regiorged = !post.regiorged;
	patch(post.id, { regiorged, regiorgs: Math.max(0, post.regiorgs + (regiorged ? 1 : -1)) });
	try {
		const res = await api<{ regiorged: boolean; regiorgs: number }>(`posts/${post.id}/regiorg`, {
			method: regiorged ? 'PUT' : 'DELETE'
		});
		patch(post.id, res);
	} catch (e) {
		patch(post.id, { regiorged: post.regiorged, regiorgs: post.regiorgs });
		toast(errorMessage(e));
	}
}

export async function vote(post: Post, option: number) {
	if (!post.poll) return;
	try {
		const res = await api<{ voted: number; votes: number[] }>(`posts/${post.id}/vote`, {
			method: 'PUT',
			body: { option }
		});
		patch(post.id, { poll: { ...post.poll, ...res } });
	} catch (e) {
		toast(errorMessage(e));
	}
}

export async function deletePost(post: Post) {
	try {
		await api(`posts/${post.id}`, { method: 'DELETE' });
		emit('post_deleted', { id: post.id });
	} catch (e) {
		toast(errorMessage(e));
	}
}

/** pin to the author's profile (`pin`) or, for staff, above the timeline (`timeline-pin`) */
export async function setPin(post: Post, kind: 'pin' | 'timeline-pin', pinned: boolean) {
	try {
		await api(`posts/${post.id}/${kind}`, { method: pinned ? 'PUT' : 'DELETE' });
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
