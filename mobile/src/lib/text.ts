// parsing post text the way the web app does (src/lib/hashtags.ts, mentions.ts, utils.ts)

const TAG_CHARS = /^[\p{L}\p{M}\p{N}_]+/u;
const HAS_LETTER = /\p{L}/u;
const MAX_HASHTAG_LENGTH = 64;

export const normalizeTag = (tag: string) => tag.normalize('NFC').toLowerCase();

/** "#svelte," → { tag: "svelte", rest: "," }; null when the word isn't a hashtag. */
export function parseHashtag(word: string): { tag: string; rest: string } | null {
	if (!word.startsWith('#')) return null;
	const match = TAG_CHARS.exec(word.slice(1));
	if (!match) return null;
	const tag = match[0];
	if (tag.length > MAX_HASHTAG_LENGTH || !HAS_LETTER.test(tag)) return null;
	return { tag, rest: word.slice(1 + tag.length) };
}

// "@username", also next to punctuation, but not inside emails or post links
const MENTION_RE = /(?<![a-zA-Z0-9_@/])@([a-zA-Z0-9_]+)/g;

export function splitMentions(text: string): (string | { username: string })[] {
	const parts: (string | { username: string })[] = [];
	let last = 0;
	for (const match of text.matchAll(MENTION_RE)) {
		if (match.index > last) parts.push(text.slice(last, match.index));
		parts.push({ username: match[1] });
		last = match.index + match[0].length;
	}
	if (last < text.length) parts.push(text.slice(last));
	return parts;
}

export const isHttpLink = (word: string) => /^https?:\/\/\S+$/.test(word);

/** markdown images aren't loaded: shown as their bare URL */
export const unwrapMarkdownImages = (content: string) =>
	content.replace(/!\[[^\]]*\]\(\s*(\S*?)(?:\s+"[^"]*")?\s*\)/g, ' $1 ');

/** Where a link to this instance goes inside the app, null for anything else. */
export function internalRoute(url: string, server: string): string | null {
	if (!url.startsWith(server)) return null;
	const path = url.slice(server.length).split(/[?#]/)[0];
	let match = /^\/@([a-zA-Z0-9_]+)\/(\d+)\/?$/.exec(path);
	if (match) return `/post/${match[2]}`;
	match = /^\/@([a-zA-Z0-9_]+)\/?$/.exec(path);
	if (match) return `/user/${match[1]}`;
	match = /^\/hashtag\/([^/]+)\/?$/.exec(path);
	if (match) return `/hashtag/${match[1]}`;
	return null;
}
