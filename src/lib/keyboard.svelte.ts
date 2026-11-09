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
 * Moving between its own fields, or a tap on its buttons (which keep the focus), isn't leaving.
 */
export const writingHandlers = {
	onfocusin: () => keyboard.setWriting(true),
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
	return () => {
		window.removeEventListener('resize', fit);
		vv?.removeEventListener('resize', fit);
		vv?.removeEventListener('scroll', fit);
	};
}
