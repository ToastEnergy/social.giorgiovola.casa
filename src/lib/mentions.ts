// an "@username" anywhere, also next to punctuation ("(@user)", "@user,"), but not right after a
// username character, "@" or "/": emails (a@b.com) and post links (/@user/57) aren't mentions.
// usernames are lowercase, so "@Alice" mentions alice. keep in sync with the bot mention
// matching (mentionsOf in src/lib/server/bots.ts, openBotStream in src/lib/server/realtime.ts)
export const MENTION_RE = /(?<![a-zA-Z0-9_@/])@([a-zA-Z0-9_]+)/g;

/** The usernames a text mentions, lowercase and without repeats, in order. */
export const mentionedUsernames = (text: string) => [
	...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))
];

/** Splits text into plain strings and mentioned usernames, in order. */
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

/** Whether the text mentions `username` (lowercase, like every username). */
export const mentions = (text: string, username: string) =>
	[...text.matchAll(MENTION_RE)].some((m) => m[1].toLowerCase() === username);
