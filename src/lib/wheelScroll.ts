import type { Action } from 'svelte/action';

// a row that scrolls sideways with its scrollbar hidden (tab rows): a mouse wheel only scrolls
// vertically, so it turns that into sideways scrolling. At either end the page scrolls as usual
export const wheelScroll: Action<HTMLElement> = (node) => {
	const onwheel = (e: WheelEvent) => {
		// trackpads scroll sideways on their own; ctrl+wheel zooms
		if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
		const max = node.scrollWidth - node.clientWidth;
		if (max <= 0) return;
		if ((e.deltaY < 0 && node.scrollLeft <= 0) || (e.deltaY > 0 && node.scrollLeft >= max - 1))
			return;
		// line and page modes come from some mice and browsers: roughly a line of text, a row
		const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientWidth : 1;
		node.scrollLeft += e.deltaY * scale;
		e.preventDefault();
	};
	// passive listeners can't stop the page scrolling
	node.addEventListener('wheel', onwheel, { passive: false });
	return { destroy: () => node.removeEventListener('wheel', onwheel) };
};
