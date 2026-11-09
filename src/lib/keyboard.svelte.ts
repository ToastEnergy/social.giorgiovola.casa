// the on-screen keyboard (touch devices) and the fields written in at the bottom of the screen
// (the reply bar, the chat input), which make the bottom bar step aside while the keyboard is up

// smaller changes are the browser's own bars (address bar, iOS shortcut row)
const THRESHOLD = 120;

class Keyboard {
	/** how much of the layout viewport the keyboard covers, for things fixed to the bottom. iOS
	 * only shrinks the visual viewport; Android resizes the page (interactive-widget in app.html),
	 * so there it stays 0 and fixed elements ride up with the keyboard by themselves */
	inset = $state(0);
	/** the keyboard is up, however the browser makes room for it */
	open = $state(false);
	/** a field at the bottom of the screen has the focus */
	writing = $state(false);
	/** the keyboard came up since that field got the focus */
	#seen = false;
	#closedWhileWriting = $state(false);

	/** the bottom bar steps aside: while writing, until the keyboard is closed without leaving
	 * the field (Android's back button). shown again once the field is left */
	hideBar = $derived(this.writing && !this.#closedWhileWriting);

	/** from the field's focusin / focusout (see `writingHandlers`) */
	setWriting(on: boolean) {
		if (on === this.writing) return;
		this.writing = on;
		this.#seen = on && this.open;
		this.#closedWhileWriting = false;
	}

	/** from the viewport listeners in the root layout */
	update(inset: number, open: boolean) {
		this.inset = inset;
		if (open === this.open) return;
		this.open = open;
		if (!this.writing) return;
		// a tap on the field brings the keyboard (and the hidden bar) back
		if (open) {
			this.#seen = true;
			this.#closedWhileWriting = false;
		} else if (this.#seen) this.#closedWhileWriting = true;
	}
}

export const keyboard = new Keyboard();

/** what the fixed bottom bar covers (BottomNav), 0 while it's hidden or not there */
export const bottomBar = $state({ height: 0 });

/**
 * focusin / focusout for the element holding a field written in at the bottom of the screen.
 * Writing starts in one of its fields, not on its buttons: a tap on a button focuses it on
 * Android, and hiding the bar then would shift the button away before the tap's click lands
 * (the chat's GIF button took two taps). Moving to its own fields or buttons isn't leaving.
 */
export const writingHandlers = {
	onfocusin: (e: FocusEvent) => {
		if (isField(e.target)) keyboard.setWriting(true);
	},
	onfocusout: (e: FocusEvent) => {
		const to = e.relatedTarget;
		if (to instanceof Node && (e.currentTarget as Element).contains(to)) return;
		keyboard.setWriting(false);
	}
};

/** starts following the viewport; from the root layout, once */
export function watchKeyboard() {
	const vv = window.visualViewport;
	// the page's full height at the current width (the keyboard never changes the width), to tell
	// a page shrunk by the keyboard (Android) from a rotation
	let width = window.innerWidth;
	let full = window.innerHeight;
	const fit = () => {
		if (window.innerWidth !== width) {
			width = window.innerWidth;
			full = window.innerHeight;
		}
		full = Math.max(full, window.innerHeight);
		// pinch zoom shrinks the visual viewport too
		if (vv && vv.scale > 1.01) return;
		const covered = vv ? window.innerHeight - vv.height - vv.offsetTop : 0;
		const inset = covered > THRESHOLD ? covered : 0;
		keyboard.update(inset, inset > 0 || full - window.innerHeight > THRESHOLD);
		// for things sized to what's visible (the full screen composer)
		const root = document.documentElement.style;
		if (vv) {
			root.setProperty('--vv-height', `${vv.height}px`);
			root.setProperty('--vv-top', `${vv.offsetTop}px`);
		}
	};
	fit();
	window.addEventListener('resize', fit);
	vv?.addEventListener('resize', fit);
	vv?.addEventListener('scroll', fit);

	// iOS (WebKit bug 297779 and the like, installed app above all): once the keyboard is gone
	// the viewport can stay as short as it was above it, so what's fixed to the bottom (the
	// bottom bar) floats halfway up the screen until the app is restarted. hiding and showing
	// an element as tall as the viewport, with a reflow in between, makes WebKit measure it
	// again. it's invisible and out of the flow, so where it's not needed nothing changes
	const probe = document.createElement('div');
	probe.setAttribute('aria-hidden', 'true');
	Object.assign(probe.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		width: '1px',
		height: '100dvh',
		visibility: 'hidden',
		pointerEvents: 'none'
	});
	document.body.append(probe);
	const remeasure = () => {
		if (editing()) return;
		probe.style.display = 'none';
		void probe.offsetHeight;
		probe.style.display = '';
		void probe.offsetHeight;
		window.scrollTo(window.scrollX, window.scrollY);
		fit();
	};
	// after the keyboard's closing animation, and again in case it was slow
	let timers: ReturnType<typeof setTimeout>[] = [];
	const onFocusOut = (e: FocusEvent) => {
		if (!isField(e.target)) return;
		timers.forEach(clearTimeout);
		timers = [setTimeout(remeasure, 150), setTimeout(remeasure, 600)];
	};
	document.addEventListener('focusout', onFocusOut);
	// coming back to the app (it may have been left with the keyboard up)
	const onVisible = () => {
		if (document.visibilityState === 'visible') setTimeout(remeasure, 150);
	};
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		window.removeEventListener('resize', fit);
		vv?.removeEventListener('resize', fit);
		vv?.removeEventListener('scroll', fit);
		document.removeEventListener('focusout', onFocusOut);
		document.removeEventListener('visibilitychange', onVisible);
		timers.forEach(clearTimeout);
		probe.remove();
	};
}

const isField = (el: EventTarget | null) =>
	el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'));
const editing = () => isField(document.activeElement);

/**
 * where the visible page ends for a menu opening downwards: above the bars fixed to the bottom
 * (the bottom bar, the reply bar: `data-bottom-cover`) and the iOS keyboard
 */
export function visibleBottom() {
	const vv = window.visualViewport;
	let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
	for (const el of document.querySelectorAll('[data-bottom-cover]')) {
		const rect = el.getBoundingClientRect();
		if (rect.height > 0) bottom = Math.min(bottom, rect.top);
	}
	return bottom;
}
