// images from the clipboard, for the composers and the chat input

/** a pasted screenshot has no useful name (or none at all): give it one with the right extension */
function named(file: File) {
	if (file.name && file.name !== 'image.png') return file;
	const ext = file.type.split('/')[1]?.split('+')[0] || 'png';
	return new File([file], `pasted-image.${ext}`, { type: file.type, lastModified: Date.now() });
}

/**
 * The files of a paste event, or none when it is text. Some browsers (Safari, older Firefox) leave
 * `clipboardData.files` empty and only list the image under `items`; those are taken only when no
 * text comes with them, so pasting text keeps working.
 */
export function pastedFiles(e: ClipboardEvent): File[] {
	const data = e.clipboardData;
	if (!data) return [];
	let files = Array.from(data.files);
	if (files.length === 0 && !data.getData('text/plain')) {
		files = Array.from(data.items)
			.filter((item) => item.kind === 'file')
			.map((item) => item.getAsFile())
			.filter((file): file is File => !!file);
	}
	return files.map(named);
}

/** whether the "paste image" button can read the clipboard (touch keyboards can't paste images) */
export const canReadClipboard = () =>
	typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';

/**
 * The images on the clipboard, read through the async Clipboard API: the browser may ask first
 * (Safari shows a "Paste" button). Throws when it's refused.
 */
export async function clipboardImages(): Promise<File[]> {
	const files: File[] = [];
	for (const item of await navigator.clipboard.read()) {
		const type = item.types.find((t) => t.startsWith('image/'));
		if (!type) continue;
		const blob = await item.getType(type);
		files.push(named(new File([blob], '', { type })));
	}
	return files;
}
