import { parseHashtag } from './hashtags.js';
import { splitMentions } from './mentions.js';
import { isHttpLink } from './utils.js';

export type TextPiece =
	| { type: 'text'; text: string }
	| { type: 'link'; url: string }
	| { type: 'mention'; username: string }
	| { type: 'hashtag'; tag: string };

// a link starts at "http(s)://" anywhere, also glued to the text or punctuation before it
// ("?????https://…", "(https://…"), and runs to the next whitespace
const LINK_START = /https?:\/\//gi;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Drops the punctuation that ends the sentence rather than the link: "https://x.com/a." →
 * "https://x.com/a". A closing bracket stays when the link opened it (wikipedia's "Foo_(bar)").
 */
function trimLinkEnd(url: string) {
	let end = url.length;
	while (end > 0) {
		const c = url[end - 1];
		if (/[.,;:!?'"*<>]/.test(c)) {
			end--;
			continue;
		}
		const open = CLOSERS[c];
		if (open) {
			const body = url.slice(0, end);
			if (body.split(open).length < body.split(c).length) {
				end--;
				continue;
			}
		}
		break;
	}
	return url.slice(0, end);
}

/** Splits text into plain strings and http(s) links, in order. Whitespace is never in a link. */
export function splitLinks(text: string): (string | { url: string })[] {
	const parts: (string | { url: string })[] = [];
	let last = 0;
	LINK_START.lastIndex = 0;
	for (let match = LINK_START.exec(text); match; match = LINK_START.exec(text)) {
		const start = match.index;
		const run = /^\S+/.exec(text.slice(start))![0];
		const url = trimLinkEnd(run);
		// "https://" alone, or something URL can't parse, stays text
		if (url.length <= match[0].length || !isHttpLink(url)) continue;
		if (start > last) parts.push(text.slice(last, start));
		parts.push({ url });
		last = start + url.length;
		LINK_START.lastIndex = last;
	}
	if (last < text.length) parts.push(text.slice(last));
	return parts;
}

/** The http(s) links of a text, in order. */
export const extractLinks = (text: string) =>
	splitLinks(text).flatMap((part) => (typeof part === 'string' ? [] : [part.url]));

/**
 * Splits a post or message into text, links, mentions and (optionally) hashtags, for rendering.
 * Links are found first, so a "@" or "#" inside a URL stays part of it.
 */
export function richText(text: string, { hashtags = false } = {}): TextPiece[] {
	const pieces: TextPiece[] = [];
	const pushText = (t: string) => {
		const prev = pieces[pieces.length - 1];
		if (prev?.type === 'text') prev.text += t;
		else pieces.push({ type: 'text', text: t });
	};
	const inline = (t: string) => {
		for (const part of splitLinks(t)) {
			if (typeof part !== 'string') {
				pieces.push({ type: 'link', url: part.url });
				continue;
			}
			for (const piece of splitMentions(part)) {
				if (typeof piece === 'string') pushText(piece);
				else pieces.push({ type: 'mention', username: piece.username });
			}
		}
	};
	for (const word of text.split(/(\s+)/)) {
		if (!word) continue;
		const hashtag = hashtags ? parseHashtag(word) : null;
		if (hashtag) {
			pieces.push({ type: 'hashtag', tag: hashtag.tag });
			inline(hashtag.rest);
		} else inline(word);
	}
	return pieces;
}
