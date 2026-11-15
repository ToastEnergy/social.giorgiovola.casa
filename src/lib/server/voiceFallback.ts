import { PUBLIC_URL } from '$app/env/public';
import { formatDuration } from '#lib/mediaPreview.js';

/**
 * Text for clients that don't know voice notes. A voice note without a caption has empty
 * `content`, so a client that predates `audio` (an old build of the app, a bot, a third-party
 * client) would show an empty post or message. Unless the request declares the `voice-notes`
 * feature (`X-Client-Features` header, or `?features=` where headers can't be set, such as
 * EventSource), every post and message with a voice note goes out with a line saying what it is
 * after its caption. Nothing is stored: the database keeps the caption only, and `audio` is still
 * in the response.
 */

export const VOICE_NOTES = 'voice-notes';

const HEADER = 'x-client-features';

/** The features a client declared: the header and the `features` query parameter, lowercased. */
export function clientFeatures(request: Request, url: URL): ReadonlySet<string> {
	const raw = [request.headers.get(HEADER), ...url.searchParams.getAll('features')];
	const features = new Set<string>();
	for (const list of raw)
		for (const name of list?.split(',') ?? []) {
			const feature = name.trim().toLowerCase();
			if (feature) features.add(feature);
		}
	return features;
}

const base = (PUBLIC_URL ?? '').replace(/\/+$/, '');

/** The line a post with a voice note gets: where to listen to it. */
export const postFallback = (durationMs: number, username: string, id: number) =>
	`🎤 Voice message (${formatDuration(
		durationMs
	)}). Update the app to listen: ${base}/@${username}/${id}`;

/** The line a message with a voice note gets. */
export const messageFallback = (durationMs: number) =>
	`🎤 Voice message (${formatDuration(durationMs)}). Update the app to listen.`;

const withLine = (caption: string, line: string) => (caption ? `${caption}\n\n${line}` : line);

/**
 * An edit from a client that showed the fallback sends it back with the caption: what it
 * really edited is the caption, so the line (and the blank line before it) comes off.
 */
export function stripFallback(content: string, line: string): string {
	if (content.trim() === line) return '';
	const end = content.trimEnd();
	return end.endsWith(line) ? end.slice(0, -line.length).trimEnd() : content;
}

type Json = Record<string, unknown>;

const isPlain = (value: unknown): value is Json => {
	if (!value || typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

const isVoiceNote = (value: unknown): value is { duration_ms: number; url: string } =>
	isPlain(value) && typeof value.duration_ms === 'number' && typeof value.url === 'string';

/** The fallback line of a serialized post, message or reply preview, or null. */
function lineOf(object: Json): string | null {
	if (typeof object.content !== 'string') return null;
	if (isVoiceNote(object.audio)) {
		// posts (quoted and linked ones too) have their author as `user`, messages a `sender`
		const user = object.user;
		if (isPlain(user) && typeof user.username === 'string' && typeof object.id === 'number')
			return postFallback(object.audio.duration_ms, user.username, object.id);
		return messageFallback(object.audio.duration_ms);
	}
	// the message a message replies to (MessageReplyTo) only has the length
	if (typeof object.audio_ms === 'number' && 'sender' in object)
		return messageFallback(object.audio_ms);
	return null;
}

/**
 * `value` with the fallback in every post and message it holds, however deep (feeds, quotes,
 * linked posts, replied messages, realtime payloads). Copies what it changes and returns
 * `value` itself when there was nothing to change, so callers can tell.
 */
export function withVoiceFallback<T>(value: T): T {
	return walk(value) as T;
}

function walk(value: unknown): unknown {
	if (Array.isArray(value)) {
		let copy: unknown[] | null = null;
		for (let i = 0; i < value.length; i++) {
			const item = walk(value[i]);
			if (item !== value[i]) (copy ??= value.slice())[i] = item;
		}
		return copy ?? value;
	}
	if (!isPlain(value)) return value;
	let copy: Json | null = null;
	for (const key of Object.keys(value)) {
		const item = walk(value[key]);
		if (item !== value[key]) (copy ??= { ...value })[key] = item;
	}
	const line = lineOf(value);
	if (line !== null) (copy ??= { ...value }).content = withLine(value.content as string, line);
	return copy ?? value;
}

/**
 * A JSON API response with the fallback, for a client without the feature. Anything else
 * (errors, streams, other types, JSON without a voice note) passes as it is.
 */
export async function voiceFallbackResponse(response: Response): Promise<Response> {
	if (!response.ok || response.status === 204 || response.bodyUsed) return response;
	if (!response.headers.get('content-type')?.includes('application/json')) return response;
	const text = await response.text();
	const init = { status: response.status, statusText: response.statusText };
	// every voice note has a duration: most responses don't need parsing at all
	if (!text.includes('"duration_ms"') && !text.includes('"audio_ms"'))
		return new Response(text, { ...init, headers: response.headers });
	const body: unknown = JSON.parse(text);
	const changed = withVoiceFallback(body);
	if (changed === body) return new Response(text, { ...init, headers: response.headers });
	const headers = new Headers(response.headers);
	headers.delete('content-length');
	return new Response(JSON.stringify(changed), { ...init, headers });
}
