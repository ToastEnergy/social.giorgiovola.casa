/** What stands for a message without text in previews: its GIF or images. */
export const mediaPreview = (m: { images: number; gif: boolean }) =>
	m.gif ? '🎞️ GIF' : m.images > 0 ? '📷 Photo' : '';

/** A length as m:ss (an hour is 60:00). */
export function formatDuration(ms: number) {
	const seconds = Math.max(0, Math.round(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A voice note in previews: its caption after the mic, or `🎤 Voice message (0:42)`. */
export const audioPreview = (durationMs: number, caption = '') =>
	caption ? `🎤 ${caption}` : `🎤 Voice message (${formatDuration(durationMs)})`;

/** The preview of a message: its voice note, text, GIF or images. */
export const messagePreview = (m: {
	content: string;
	images: number;
	gif: boolean;
	audio_ms?: number | null;
}) => (m.audio_ms != null ? audioPreview(m.audio_ms, m.content) : m.content || mediaPreview(m));
