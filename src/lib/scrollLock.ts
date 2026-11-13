/**
 * Keeps the page still behind a full screen overlay on touch devices (the full screen composer).
 *
 * `overflow: hidden` on the body isn't enough on iOS: with the keyboard up the visual viewport is
 * shorter than the layout viewport and a swipe pans it (and scrolls the page behind), carrying an
 * overlay fixed to the layout viewport off the visible screen with the keyboard still up. a
 * swipe is let through only where something inside `root` can still scroll that way (a long
 * text, the GIF grid); everywhere else it's cancelled. returns the function that unlocks.
 */
export function lockScroll(root: HTMLElement) {
	const html = document.documentElement.style;
	const body = document.body.style;
	const previous = [html.overflow, body.overflow, html.overscrollBehavior];
	html.overflow = 'hidden';
	body.overflow = 'hidden';
	html.overscrollBehavior = 'none';

	let lastY = 0;
	const onStart = (e: TouchEvent) => {
		lastY = e.touches[0]?.clientY ?? 0;
	};
	const onMove = (e: TouchEvent) => {
		// two fingers: pinch zoom stays possible
		if (e.touches.length !== 1 || !e.cancelable) return;
		const y = e.touches[0].clientY;
		// positive: the finger moves down, the content would scroll up
		const dy = y - lastY;
		lastY = y;
		if (dy !== 0 && canScroll(e.target, root, dy)) return;
		e.preventDefault();
	};
	document.addEventListener('touchstart', onStart, { passive: true });
	// not passive: preventDefault is what stops iOS from panning the viewport
	document.addEventListener('touchmove', onMove, { passive: false });

	return () => {
		document.removeEventListener('touchstart', onStart);
		document.removeEventListener('touchmove', onMove);
		[html.overflow, body.overflow, html.overscrollBehavior] = previous;
	};
}

/** whether an element between `target` and `root` can still scroll in the swipe's direction */
function canScroll(target: EventTarget | null, root: HTMLElement, dy: number) {
	let el = target instanceof Element ? target : null;
	if (!el || !root.contains(el)) return false;
	while (el && el !== root.parentElement) {
		if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === 'auto' || overflow === 'scroll') {
				// a scroller at its end hands the swipe on to the page, which is what must not move
				if (dy > 0 && el.scrollTop > 0) return true;
				if (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
			}
		}
		el = el.parentElement;
	}
	return false;
}
