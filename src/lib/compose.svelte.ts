import type { Post } from '#lib/types.js';

// the full screen composer on touch devices, opened from the bottom bar, is a single overlay
// mounted in the root layout
export const compose = $state({ open: false });

const listeners = new Set<(post: Post) => void>();

export const openCompose = () => {
	compose.open = true;
};

export const closeCompose = () => {
	compose.open = false;
};

/** lets the page behind (the home feed) show a post written in the overlay */
export const onComposed = (fn: (post: Post) => void) => {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
};

export const composed = (post: Post) => {
	for (const fn of listeners) fn(post);
};
