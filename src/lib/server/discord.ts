import sharp from 'sharp';
import type { Post, QuotedPost } from '#lib/types.js';
import { getAvatar } from '#lib/utils.js';
import { DISCORD_WEBHOOK_URL } from '$app/env/private';
import { PUBLIC_URL } from '$app/env/public';
import { generateAvatar } from './avatar.js';
import { avatarFileOf, readAvatarFile } from './avatarFile.js';
import { uploadKey } from './images.js';
import * as storage from './storage.js';

/**
 * Announces new posts to DISCORD_WEBHOOK_URL. A members-only instance shows Discord nothing behind
 * a link (no preview, no images, no avatars), so the post is written out in an embed, its first
 * image and the author's avatar are uploaded with it, and the link itself is kept from unfurling.
 */

// the accent colour (app.css)
const ACCENT = 0x799a74;

const clip = (text: string, max: number) =>
	text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;

const postUrl = (post: { id: number; user: { username: string } }) =>
	`${PUBLIC_URL}/@${post.user.username}/${post.id}`;

const duration = (ms: number) => {
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Text lines for what a post carries besides its text. */
function extras(post: Pick<QuotedPost, 'images' | 'gif' | 'audio'>, imageShown: boolean) {
	const lines: string[] = [];
	if (post.audio) lines.push(`🎤 Voice note (${duration(post.audio.duration_ms)})`);
	const hidden = post.images.length - (imageShown ? 1 : 0);
	if (hidden > 0)
		lines.push(`🖼️ ${hidden} ${imageShown ? 'more ' : ''}image${hidden > 1 ? 's' : ''}`);
	return lines;
}

function quoteBlock(quote: Post['quote']) {
	if (!quote) return null;
	if ('deleted' in quote) return '> *the quoted post was deleted*';
	const body = [
		`**${quote.user.name}** @${quote.user.username} · [open](${postUrl(quote)})`,
		...(quote.content ? clip(quote.content, 500).split('\n') : []),
		...extras(quote, false),
		...(quote.gif ? ['GIF'] : [])
	];
	return body.map((line) => `> ${line}`).join('\n');
}

function pollBlock(poll: Post['poll']) {
	if (!poll) return null;
	const ends = Math.floor(new Date(poll.ends_at).getTime() / 1000);
	return [...poll.options.map((o) => `▫️ ${o}`), `*poll, ends <t:${ends}:R>*`].join('\n');
}

/** The bytes of a stored file, null when it's gone. */
async function read(key: string) {
	const object = await storage.get(key);
	return object ? new Blob([await new Response(object.body).arrayBuffer()]) : null;
}

async function avatarBlob(user: Post['user']) {
	const file = avatarFileOf(user.avatar);
	if (file) {
		const found = await readAvatarFile(file);
		if (!found) return null;
		const data = await new Response(found.body).arrayBuffer();
		return new Blob([await sharp(data).resize(128, 128).png().toBuffer()]);
	}
	// the generated one is an SVG, which Discord doesn't show
	return new Blob([
		await sharp(Buffer.from(generateAvatar(user.username, 128)))
			.png()
			.toBuffer()
	]);
}

async function send(post: Post) {
	const url = postUrl(post);
	const form = new FormData();
	let files = 0;
	const attach = (blob: Blob | null, name: string) => {
		if (!blob) return null;
		form.append(`files[${files++}]`, blob, name);
		return `attachment://${name}`;
	};

	// a missing file shouldn't stop the announcement
	const firstImage = post.images[0] && uploadKey(post.images[0]);
	const image = firstImage
		? attach(await read(firstImage).catch(() => null), 'image.webp')
		: post.gif
		? post.gif.poster
		: null;
	const icon = attach(await avatarBlob(post.user).catch(() => null), 'avatar.png');

	const description = [
		post.content ? clip(post.content, 3000) : null,
		...extras(post, Boolean(image && firstImage)),
		pollBlock(post.poll),
		quoteBlock(post.quote)
	]
		.filter(Boolean)
		.join('\n\n');

	form.append(
		'payload_json',
		JSON.stringify({
			// <…> keeps Discord from previewing the link, which shows nothing on a private instance
			content: `<${url}>`,
			username: clip(post.user.name, 80),
			avatar_url: getAvatar(post.user, 512, true),
			// nobody can be pinged through a post
			allowed_mentions: { parse: [] },
			embeds: [
				{
					author: {
						name: clip(`${post.user.name} (@${post.user.username})`, 256),
						url,
						...(icon && { icon_url: icon })
					},
					url,
					description: clip(description, 4096) || undefined,
					color: ACCENT,
					timestamp: new Date(post.created_at).toISOString(),
					...(image && { image: { url: image } })
				}
			]
		})
	);

	const res = await fetch(DISCORD_WEBHOOK_URL + '?wait=false', {
		method: 'POST',
		body: form,
		signal: AbortSignal.timeout(10000)
	});
	if (!res.ok) console.error('Discord webhook failed', res.status, await res.text());
	else await res.body?.cancel();
}

/**
 * Announces a new top-level post, when a webhook is set. Never throws: a broken or slow webhook
 * shouldn't make posting fail or wait, so callers don't await it.
 */
export async function announcePost(post: Post) {
	if (!DISCORD_WEBHOOK_URL || post.reply_to) return;
	await send(post).catch((e) => console.error('Discord webhook failed', e));
}
