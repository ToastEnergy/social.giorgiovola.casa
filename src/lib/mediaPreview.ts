/** What stands for a message without text in previews: its GIF or images. */
export const mediaPreview = (m: { images: number; gif: boolean }) =>
	m.gif ? '🎞️ GIF' : m.images > 0 ? '📷 Photo' : '';
