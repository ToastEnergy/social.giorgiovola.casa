// the photo editor is a single full screen overlay mounted in the root layout
export const photoEditor = $state<{ file: File | null }>({ file: null });

let settle: ((file: File | null) => void) | null = null;

/** Formats the editor can open: animations would be flattened and SVGs don't decode to pixels. */
export const canEdit = (file: File) =>
	file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml';

/** Opens the editor on `file`; resolves to the edited copy, or null when nothing was changed. */
export function editImage(file: File): Promise<File | null> {
	settle?.(null);
	photoEditor.file = file;
	return new Promise((resolve) => (settle = resolve));
}

/** Closes the editor, handing back the edited file (or null when cancelled). */
export function closeEditor(result: File | null) {
	photoEditor.file = null;
	const done = settle;
	settle = null;
	done?.(result);
}
