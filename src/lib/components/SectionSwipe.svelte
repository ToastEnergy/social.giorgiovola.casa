<script lang="ts">
	import { flushSync, type Snippet } from 'svelte';
	import { afterNavigate, goto, preloadData } from '$app/navigation';
	import { page } from '$app/state';
	import { homeItem, navItems } from '#lib/nav.js';
	import { user } from '#lib/store.js';

	// touch devices: swipe left on the feed for the messages, right on the messages for the feed.
	// the page follows the finger a bit with the target's icon coming in from the edge, and letting
	// go past the threshold slides over to the other section
	// optional: the legacy layout passes its <slot /> in
	let { children }: { children?: Snippet } = $props();

	// the same pick as the bottom bar (BottomNav)
	const [, messagesItem] = navItems;
	/** how far to pull before letting go switches section */
	const THRESHOLD = 80;
	/** a quick flick switches from this far */
	const FLICK_DISTANCE = 40;
	const FLICK_SPEED = 0.5; // px/ms
	/** where the page stops following the finger */
	const MAX = 130;
	/** the strip along each side left to the browser's own back/forward swipe */
	const EDGE = 24;
	const SLIDE_MS = 150;

	// -1: the content goes left (feed → messages), 1: right (messages → feed)
	const direction = $derived(
		!$user ? 0 : page.route.id === '/' ? -1 : page.route.id === '/messages' ? 1 : 0
	);
	const target = $derived(direction === -1 ? messagesItem : homeItem);

	// whether the entry before the messages is the feed: then going back restores its scroll
	let backToFeed = false;

	let el = $state<HTMLElement>();
	/** the pull, signed like the direction */
	let dx = $state(0);
	let opacity = $state(1);
	let animate = $state(false);
	/** a switch is under way: set before navigating, cleared once the new page has slid in */
	let switching = $state<-1 | 1 | 0>(0);

	let gesture: {
		pointerId: number;
		x: number;
		y: number;
		time: number;
		locked: boolean;
		/** recent positions for the release speed */
		lastX: number;
		lastTime: number;
		speed: number;
	} | null = null;
	let suppressClick = false;

	const armed = $derived(Math.abs(dx) >= THRESHOLD);
	const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

	// a field, a horizontally scrolling strip or a slider keeps its own sideways gestures
	function ownsGesture(node: Element | null) {
		for (let n = node; n && n !== el; n = n.parentElement) {
			if (n.matches('input, textarea, select, [contenteditable], [data-no-swipe]')) return true;
			if (n.scrollWidth > n.clientWidth + 1) {
				const overflow = getComputedStyle(n).overflowX;
				if (overflow === 'auto' || overflow === 'scroll') return true;
			}
		}
		return false;
	}

	function onpointerdown(e: PointerEvent) {
		suppressClick = false;
		if (!direction || switching || e.pointerType !== 'touch' || !e.isPrimary) return;
		if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
		if (ownsGesture(e.target as Element)) return;
		const now = performance.now();
		gesture = {
			pointerId: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			time: now,
			locked: false,
			lastX: e.clientX,
			lastTime: now,
			speed: 0
		};
	}

	function onpointermove(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.pointerId) return;
		const moveX = e.clientX - gesture.x;
		const moveY = e.clientY - gesture.y;
		if (!gesture.locked) {
			if (Math.hypot(moveX, moveY) < 10) return;
			// mostly sideways and towards the other section; anything else is the page scrolling
			if (Math.sign(moveX) !== direction || Math.abs(moveX) < Math.abs(moveY) * 1.5) {
				gesture = null;
				return;
			}
			gesture.locked = true;
			el?.setPointerCapture(e.pointerId);
			// the data is usually there by the time the finger lets go
			preloadData(target.href).catch(() => {});
		}
		const now = performance.now();
		if (now > gesture.lastTime) {
			gesture.speed = (e.clientX - gesture.lastX) / (now - gesture.lastTime);
			gesture.lastX = e.clientX;
			gesture.lastTime = now;
		}
		const pulled = Math.max(0, moveX * direction);
		// past the threshold it resists, so it's clear that letting go now switches
		const next = Math.min(
			MAX,
			pulled < THRESHOLD ? pulled : THRESHOLD + (pulled - THRESHOLD) * 0.3
		);
		if (Math.abs(dx) < THRESHOLD && next >= THRESHOLD) navigator.vibrate?.(10);
		animate = false;
		dx = next * direction;
	}

	function onpointerend(e: PointerEvent) {
		if (!gesture || e.pointerId !== gesture.pointerId) return;
		const g = gesture;
		gesture = null;
		if (!g.locked) return;
		// the lifted finger mustn't also open the post or link it started on
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 500);
		const pulled = Math.abs(dx);
		const flick = g.speed * direction > FLICK_SPEED && pulled >= FLICK_DISTANCE;
		if (e.type === 'pointerup' && (pulled >= THRESHOLD || flick)) switchSection();
		else settle();
	}

	function settle() {
		animate = true;
		dx = 0;
		opacity = 1;
	}

	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	async function switchSection() {
		const dir = direction as -1 | 1;
		switching = dir;
		if (!reduceMotion()) {
			// slide out the way the finger went, then swap the page
			animate = true;
			dx = dir * window.innerWidth * 0.25;
			opacity = 0;
			await wait(SLIDE_MS);
		}
		try {
			if (dir === 1 && backToFeed) history.back();
			else await goto(target.href);
		} catch {
			switching = 0;
			settle();
		}
	}

	afterNavigate(({ from, to, type }) => {
		// a popstate keeps the entry before as it was (back from a chat to the list)
		if (to?.route.id === '/messages' && type !== 'popstate')
			backToFeed = from?.route.id === '/';
		const dir = switching;
		if (!dir) {
			// another navigation (a tap on the bar) during the slide
			animate = false;
			dx = 0;
			opacity = 1;
			return;
		}
		switching = 0;
		if (reduceMotion()) {
			animate = false;
			dx = 0;
			opacity = 1;
			return;
		}
		// the new page comes in from the side the finger pulled from
		animate = false;
		dx = -dir * window.innerWidth * 0.25;
		opacity = 0;
		// paint the start position before sliding from it
		flushSync();
		void el?.offsetWidth;
		animate = true;
		dx = 0;
		opacity = 1;
	});
</script>

<!-- the transform only while moving: at rest it would become the frame of the page's fixed parts.
	the gesture is a shortcut to the bar's links, so it needs no role of its own -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={el}
	class="not-pointer-coarse:contents"
	style:touch-action={direction ? 'pan-y pinch-zoom' : undefined}
	style:transform={dx ? `translateX(${dx}px)` : undefined}
	style:opacity={opacity < 1 ? opacity : undefined}
	style:transition={animate
		? `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-out`
		: undefined}
	{onpointerdown}
	{onpointermove}
	onpointerup={onpointerend}
	onpointercancel={onpointerend}
	onclickcapture={(e) => {
		if (!suppressClick) return;
		e.preventDefault();
		e.stopPropagation();
	}}
>
	{@render children?.()}
</div>

<!-- the other section's icon, coming in from the edge the page leaves -->
{#if direction && dx && !switching}
	{@const Icon = target.icon}
	<div
		aria-hidden="true"
		class="pointer-events-none fixed top-1/2 z-998 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-accent {armed
			? 'bg-accent text-background'
			: 'bg-background text-foreground'} {direction === -1 ? 'right-2.5' : 'left-2.5'}"
		style:opacity={Math.min(1, Math.abs(dx) / THRESHOLD)}
		style:transform={`translateX(${(1 - Math.min(1, Math.abs(dx) / THRESHOLD)) * -direction * 40}px)`}
	>
		<Icon size={22} strokeWidth={armed ? 2.5 : 2} />
	</div>
{/if}
