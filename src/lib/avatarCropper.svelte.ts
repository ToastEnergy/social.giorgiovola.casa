// the avatar cropper is a single full screen overlay mounted in the root layout
export const avatarCropper = $state<{ file: File | null }>({ file: null });

let settle: ((file: File | null) => void) | null = null;

/**
 * Formats the cropper can open: GIFs would lose their animation (the server crops them square
 * itself) and SVGs don't decode to pixels.
 */
export const canCrop = (file: File) =>
	file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml';

/** Opens the cropper on `file`; resolves to the square crop, or null when cancelled. */
export function cropAvatar(file: File): Promise<File | null> {
	settle?.(null);
	avatarCropper.file = file;
	return new Promise((resolve) => (settle = resolve));
}

/** Closes the cropper, handing back the cropped file (or null when cancelled). */
export function closeCropper(result: File | null) {
	avatarCropper.file = null;
	const done = settle;
	settle = null;
	done?.(result);
}
