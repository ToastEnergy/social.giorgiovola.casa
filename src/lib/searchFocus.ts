import { goto } from '$app/navigation';

// tapping search in the top row focuses the search page's field. iOS only opens the keyboard
// for a focus made during the tap, before the page is there: a stand-in field takes the focus in
// the tap and hands it to the real one once the page mounts (moving focus keeps the keyboard up)
let standIn: HTMLInputElement | null = null;

const drop = () => {
	standIn?.remove();
	standIn = null;
};

/** call from the tap's click handler, before navigating to the search page */
export function focusSearch() {
	drop();
	const input = document.createElement('input');
	input.setAttribute('aria-hidden', 'true');
	input.tabIndex = -1;
	// 16px, or iOS zooms in on it
	input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
	document.body.append(input);
	input.focus();
	standIn = input;
	// the navigation failed or went elsewhere: nothing waits for it
	input.addEventListener('blur', drop);
}

/** from the search page as it mounts: takes the focus over, if search was just tapped */
export function takeSearchFocus(field: HTMLInputElement) {
	if (!standIn) return;
	standIn.removeEventListener('blur', drop);
	// navigated without a reset, to keep the focus: the scroll position is still the last page's
	window.scrollTo(0, 0);
	field.focus({ preventScroll: true });
	drop();
}

/** the search tap of the touch top row: the search page with the keyboard already up */
export function tapSearch(e: MouseEvent, active: boolean) {
	e.preventDefault();
	// already there: no navigation (which would drop the query), just the field
	const field = document.querySelector<HTMLInputElement>('[data-search-field]');
	if (active && field) return field.focus();
	focusSearch();
	// reset would blur the stand-in, closing the keyboard (the page scrolls up itself)
	goto('/search', { reset: false });
}
