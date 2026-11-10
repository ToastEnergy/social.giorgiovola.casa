import { useEffect, useRef } from 'react';

// one emitter for the realtime stream's events (src/lib/realtime.ts) and for changes made in
// the app itself, so every screen showing the same post or chat stays in sync

type Handler = (data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

const handlers = new Map<string, Set<Handler>>();

export function on(type: string, handler: Handler) {
	let set = handlers.get(type);
	if (!set) handlers.set(type, (set = new Set()));
	set.add(handler);
	return () => {
		set.delete(handler);
	};
}

export function emit(type: string, data?: unknown) {
	for (const handler of [...(handlers.get(type) ?? [])]) handler(data);
}

/** Subscribes a component to an event; the latest handler is always the one called. */
export function useBus(type: string, handler: Handler) {
	const ref = useRef(handler);
	ref.current = handler;
	useEffect(() => on(type, (data) => ref.current(data)), [type]);
}

// local events (not from the server):
//   post_patch    { id, ...fields }   a post changed here (liked, voted, pinned)
//   post_created  <Post>              a post written here
//   stream_open                       the stream (re)connected: reload what is shown
//   chats_changed                     something that changes the conversation list happened
