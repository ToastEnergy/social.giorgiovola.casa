import type { ImageSize } from './types.js';

/** The size of image `i`, when the API sent one that makes sense (older uploads have none). */
export function sizeOf(sizes: ImageSize[] | null | undefined, i: number): ImageSize | null {
	const size = sizes?.[i];
	return size && size.width > 0 && size.height > 0 ? size : null;
}

/**
 * The inline style that reserves a single image's box before it loads, like GifMedia: as wide as
 * it fits in `maxWidth` (a CSS length) and `maxHeight` px without upscaling, its height following
 * from the aspect ratio. Empty when the size is unknown, so the image sizes itself once loaded.
 */
export function reservedStyle(size: ImageSize | null, maxWidth: string, maxHeight: number) {
	if (!size) return '';
	const { width, height } = size;
	return `width: min(${maxWidth}, ${width}px, ${
		(maxHeight * width) / height
	}px); aspect-ratio: ${width} / ${height}`;
}
