import fs from 'node:fs';
import path from 'node:path';
import { GlobalFonts, Path2D, createCanvas, loadImage } from '@napi-rs/canvas';
import type { Canvas, SKRSContext2D as CanvasRenderingContext2D, Image } from '@napi-rs/canvas';
import { PUBLIC_URL } from '$app/env/public';
import type {
	Gif,
	LinkPreview,
	Poll,
	Post,
	ProfileCard,
	QuotedPost,
	VoiceNote
} from '#lib/types.js';
import { formatDuration } from '#lib/mediaPreview.js';
import { richText } from '#lib/richText.js';
import { unwrapMarkdownImages, websiteLabel } from '#lib/utils.js';
import { generateAvatar } from './avatar.js';
import { avatarFileOf, readAvatarFile } from './avatarFile.js';
import { uploadKey } from './images.js';
import { isPreviewPath } from './previewImages.js';
import * as storage from './storage.js';

/**
 * The social cards (og:image) of posts and profiles: the post drawn the way Post.svelte shows it,
 * or the header of the profile page, on the black content panel over the page background, scaled
 * up to fill a 1200×630 image.
 *
 * Nothing is ever fetched from another site, so rendering a card can't reveal the server's address:
 * every image comes from our own storage (avatars, post photos and the link preview images
 * previewImages.ts already downloaded through the worker). A GIF is KLIPY's, so it's drawn as a
 * placeholder rather than fetching its still frame.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

// the design tokens of src/app.css
const BACKGROUND = '#0c0b0b';
const FOREGROUND = '#d9d9d9';
const ACCENT = '#799a74';
const MUTED = '#999999';
const LINE = '#4e4e4e';

// the content panel, and the room for the logo and host under it
const PANEL = { x: 40, y: 40, w: CARD_WIDTH - 80, h: 490, pad: 40, radius: 30 };
const AREA = {
	x: PANEL.x + PANEL.pad,
	y: PANEL.y + PANEL.pad,
	w: PANEL.w - PANEL.pad * 2,
	h: PANEL.h - PANEL.pad * 2
};
const FOOTER_Y = PANEL.y + PANEL.h + (CARD_HEIGHT - PANEL.y - PANEL.h) / 2;

// CSS pixels to card pixels: the largest scale the post fits at, within these
const MAX_SCALE = 2.3;
const MIN_SCALE = 1.4;
// a profile's header alone has more room
const PROFILE_MAX_SCALE = 2.8;

// --- fonts ---------------------------------------------------------------------------------------

// Manrope comes as one variable font per script: each is registered under its own name and the
// stack falls through them, then to the emoji fonts (Apple's locally, Noto's in the Docker image)
const SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'vietnamese'];
let fontStack: string | null = null;

function fonts() {
	if (fontStack) return fontStack;
	const dir = path.resolve('node_modules/@fontsource-variable/manrope/files');
	const families: string[] = [];
	for (const subset of SUBSETS) {
		const name = `Manrope card ${subset}`;
		if (GlobalFonts.registerFromPath(path.join(dir, `manrope-${subset}-wght-normal.woff2`), name))
			families.push(`"${name}"`);
	}
	fontStack = [
		...families,
		'"Apple Color Emoji"',
		'"Noto Color Emoji"',
		'Roboto',
		'sans-serif'
	].join(', ');
	return fontStack;
}

const font = (weight: number, size: number) => `${weight} ${size}px ${fonts()}`;

// --- icons (lucide, 24×24, stroked) --------------------------------------------------------------

const ICONS = {
	reply: [
		'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719'
	],
	regiorg: [
		'm17 2 4 4-4 4',
		'M3 11v-1a4 4 0 0 1 4-4h14',
		'm7 22-4-4 4-4',
		'M21 13v1a4 4 0 0 1-4 4H3'
	],
	like: [
		'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'
	],
	share: ['m15 17 5-5-5-5', 'M4 18v-2a4 4 0 0 1 4-4h12'],
	mic: [
		'M12 19v3',
		'M19 10v2a7 7 0 0 1-14 0v-2',
		'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z'
	],
	// filled, like the player's
	play: ['M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z']
};

function drawIcon(
	ctx: CanvasRenderingContext2D,
	icon: keyof typeof ICONS,
	x: number,
	y: number,
	size: number,
	alpha = 1,
	fill = false
) {
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(size / 24, size / 24);
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = FOREGROUND;
	ctx.fillStyle = FOREGROUND;
	ctx.lineWidth = 2;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (const d of ICONS[icon]) {
		const path = new Path2D(d);
		if (fill) ctx.fill(path);
		ctx.stroke(path);
	}
	ctx.restore();
}

// --- images --------------------------------------------------------------------------------------

async function bytesOf(object: storage.StoredObject | null) {
	if (!object) return null;
	if (object.body instanceof Uint8Array) return Buffer.from(object.body);
	return Buffer.from(await new Response(object.body).arrayBuffer());
}

const decode = (bytes: Buffer | null) => (bytes ? loadImage(bytes).catch(() => null) : null);

/** A post image or link preview image of ours, by the path it's served at. */
async function storedImage(url: string): Promise<Image | null> {
	const key = isPreviewPath(url) ? 'previews/' + url.slice('/previews/'.length) : uploadKey(url);
	// message images (dm/) are private, and never in a post anyway
	if (!key || key.startsWith('dm/')) return null;
	return decode(await bytesOf(await storage.get(key).catch(() => null)));
}

async function avatarImage(user: { username: string; avatar: string | null }) {
	const file = avatarFileOf(user.avatar);
	if (file) {
		const stored = await readAvatarFile(file).catch(() => null);
		const image = await decode(await bytesOf(stored && { body: stored.body, size: 0 }));
		if (image) return image;
	}
	return decode(Buffer.from(generateAvatar(user.username, 256)));
}

let logoImage: Promise<Image | null> | null = null;
function logo() {
	// static/ in development, build/client/ once built
	logoImage ??= (async () => {
		for (const file of ['static/Logo.png', 'build/client/Logo.png']) {
			const bytes = await fs.promises.readFile(path.resolve(file)).catch(() => null);
			if (bytes) return decode(bytes);
		}
		return null;
	})();
	return logoImage;
}

// --- drawing helpers -----------------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number };

/** Draws `image` into `box` like object-fit (cover or contain), clipped to rounded corners. */
function drawImage(
	ctx: CanvasRenderingContext2D,
	image: Image,
	box: Box,
	radius: number,
	fit: 'cover' | 'contain'
) {
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(box.x, box.y, box.w, box.h, radius);
	ctx.clip();
	const scale = (fit === 'cover' ? Math.max : Math.min)(box.w / image.width, box.h / image.height);
	const w = image.width * scale;
	const h = image.height * scale;
	ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
	ctx.restore();
}

function strokeBox(ctx: CanvasRenderingContext2D, box: Box, radius: number, width: number) {
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(box.x + width / 2, box.y + width / 2, box.w - width, box.h - width, radius);
	ctx.strokeStyle = LINE;
	ctx.lineWidth = width;
	ctx.stroke();
	ctx.restore();
}

function text(
	ctx: CanvasRenderingContext2D,
	value: string,
	x: number,
	centerY: number,
	f: string,
	color: string,
	align: CanvasTextAlign = 'left'
) {
	ctx.font = f;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	ctx.textBaseline = 'middle';
	ctx.fillText(value, x, centerY);
	ctx.textAlign = 'left';
}

const graphemes = (value: string) =>
	Array.from(
		new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
		(s) => s.segment
	);

/** `value` cut to `width` with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, value: string, width: number, f: string) {
	ctx.font = f;
	if (ctx.measureText(value).width <= width) return value;
	const chars = graphemes(value);
	while (chars.length && ctx.measureText(chars.join('').trimEnd() + '…').width > width) chars.pop();
	return chars.join('').trimEnd() + '…';
}

// --- rich text layout ----------------------------------------------------------------------------

type Run = { text: string; color: string };
type Line = { x: number; text: string; color: string }[];

/**
 * Wraps colored runs into lines like `white-space: pre-line; overflow-wrap: anywhere`: line breaks
 * kept, runs of spaces collapsed, words too long for a line broken anywhere.
 */
function wrap(ctx: CanvasRenderingContext2D, runs: Run[], f: string, width: number): Line[] {
	ctx.font = f;
	const lines: Line[] = [];
	let line: Line = [];
	let x = 0;
	let space = false;
	const spaceWidth = ctx.measureText(' ').width;
	const breakLine = () => {
		lines.push(line);
		line = [];
		x = 0;
		space = false;
	};
	const place = (word: string, color: string, w: number) => {
		if (space && line.length) x += spaceWidth;
		space = false;
		line.push({ x, text: word, color });
		x += w;
	};
	for (const run of runs) {
		for (const token of run.text.split(/(\n|[^\S\n]+)/)) {
			if (!token) continue;
			if (token === '\n') breakLine();
			else if (/^\s+$/.test(token)) space = line.length > 0;
			else {
				const w = ctx.measureText(token).width;
				if (x + (space ? spaceWidth : 0) + w <= width) place(token, run.color, w);
				else if (w <= width) {
					breakLine();
					place(token, run.color, w);
				} else {
					// a word longer than a line: as many characters as fit, then the rest below
					let chunk = '';
					for (const char of graphemes(token)) {
						const room = width - x - (space && line.length ? spaceWidth : 0);
						if (chunk && ctx.measureText(chunk + char).width > room) {
							place(chunk, run.color, ctx.measureText(chunk).width);
							breakLine();
							chunk = '';
						}
						chunk += char;
					}
					if (chunk) place(chunk, run.color, ctx.measureText(chunk).width);
				}
			}
		}
	}
	if (line.length) lines.push(line);
	// trailing empty lines (the content is trimmed, so only from a lone line break) take no room
	while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
	return lines;
}

/** The first `max` lines, the last one ending in an ellipsis when some were left out. */
function clamp(
	ctx: CanvasRenderingContext2D,
	lines: Line[],
	max: number,
	f: string,
	width: number
) {
	if (lines.length <= max) return lines;
	const kept = lines.slice(0, max);
	const last = [...kept[max - 1]];
	ctx.font = f;
	const end = () => {
		const piece = last[last.length - 1];
		return piece ? piece.x + ctx.measureText(piece.text + '…').width : 0;
	};
	while (last.length && end() > width) {
		const piece = last[last.length - 1];
		const chars = graphemes(piece.text);
		chars.pop();
		if (chars.length) last[last.length - 1] = { ...piece, text: chars.join('') };
		else last.pop();
	}
	if (last.length)
		last[last.length - 1] = { ...last[last.length - 1], text: last[last.length - 1].text + '…' };
	else last.push({ x: 0, text: '…', color: FOREGROUND });
	kept[max - 1] = last;
	return kept;
}

function drawLines(
	ctx: CanvasRenderingContext2D,
	lines: Line[],
	x: number,
	y: number,
	f: string,
	lineHeight: number,
	alpha = 1
) {
	ctx.save();
	ctx.globalAlpha = alpha;
	lines.forEach((line, i) => {
		for (const piece of line)
			text(ctx, piece.text, x + piece.x, y + lineHeight * (i + 0.5), f, piece.color);
	});
	ctx.restore();
}

function postRuns(content: string): Run[] {
	return richText(unwrapMarkdownImages(content).trim(), { hashtags: true }).map((piece) => {
		if (piece.type === 'link') return { text: piece.url, color: ACCENT };
		if (piece.type === 'hashtag') return { text: '#' + piece.tag, color: ACCENT };
		if (piece.type === 'mention') return { text: '@' + piece.username, color: ACCENT };
		return { text: piece.text, color: FOREGROUND };
	});
}

const DATE: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
};
const formatDate = (date: Date | string) => new Date(date).toLocaleDateString('en-GB', DATE);
const compact = new Intl.NumberFormat('en', { notation: 'compact' });

// --- layout --------------------------------------------------------------------------------------

/** A piece of the post below its header: its height, and how to draw it at a given top. */
type Block = {
	height: number;
	/** media can be given less than its natural height (down to `min`), cropping it */
	flex?: { min: number };
	draw: (y: number, height: number) => void;
};

type Media = {
	avatar: Image | null;
	images: (Image | null)[];
	quoteAvatar: Image | null;
	quoteImages: (Image | null)[];
	preview: Image | null;
};

type Layout = { height: number; blocks: Block[]; draw: (top: number, heights: number[]) => void };

function layout(
	ctx: CanvasRenderingContext2D,
	post: Post,
	media: Media,
	s: number,
	maxTextLines = Infinity
): Layout {
	const em = 16 * s;
	const lh = 24 * s;
	const avatar = 45 * s;
	const left = AREA.x;
	const colX = left + avatar + 10 * s;
	const colW = AREA.x + AREA.w - colX;
	const blocks: Block[] = [];

	// the text
	const textFont = font(500, em);
	const lines = clamp(
		ctx,
		wrap(ctx, postRuns(post.content), textFont, colW),
		maxTextLines,
		textFont,
		colW
	);
	if (lines.length)
		blocks.push({
			height: lines.length * lh,
			draw: (y) => drawLines(ctx, lines, colX, y, textFont, lh)
		});

	if (post.poll) blocks.push(pollBlock(ctx, post.poll, colX, colW, s));
	if (post.audio) blocks.push(voiceBlock(ctx, post.audio, colX, colW, s));

	// photos: one at its ratio (up to 500px high), more in a grid of squares
	const photos = post.images
		.map((url, i) => ({ url, image: media.images[i] }))
		.filter((p) => p.image);
	const gif = photos.length ? null : post.gif;
	if (gif) blocks.push(gifBlock(ctx, gif, colX, colW, s));
	else if (photos.length === 1) {
		const image = photos[0].image!;
		const natural = Math.min(500 * s, (colW * image.height) / image.width);
		blocks.push({
			height: natural,
			flex: { min: Math.min(natural, 120 * s) },
			draw: (y, h) => {
				const box = { x: colX, y, w: colW, h };
				// whole and centred like on the site, unless that leaves it a sliver
				const shown = (h * image.width) / image.height;
				drawImage(ctx, image, box, 5 * s, shown < colW * 0.5 ? 'cover' : 'contain');
			}
		});
	} else if (photos.length > 1) {
		const gap = 6 * s;
		const cell = (colW - gap) / 2;
		const rows = Math.ceil(Math.min(photos.length, 4) / 2);
		const natural = rows * cell + (rows - 1) * gap;
		blocks.push({
			height: natural,
			flex: { min: Math.min(natural, 140 * s) },
			draw: (y, h) => {
				const rowH = (h - (rows - 1) * gap) / rows;
				photos.slice(0, 4).forEach((photo, i) => {
					const box = {
						x: colX + (i % 2) * (cell + gap),
						y: y + Math.floor(i / 2) * (rowH + gap),
						w: cell,
						h: rowH
					};
					drawImage(ctx, photo.image!, box, 5 * s, 'cover');
				});
				if (post.images.length > 4 && photos.length === 4) {
					// the fourth cell says how many more there are
					const box = { x: colX + cell + gap, y: y + rowH + gap, w: cell, h: rowH };
					ctx.fillStyle = 'rgba(0,0,0,0.6)';
					ctx.beginPath();
					ctx.roundRect(box.x, box.y, box.w, box.h, 5 * s);
					ctx.fill();
					text(
						ctx,
						`+${post.images.length - 4}`,
						box.x + box.w / 2,
						box.y + box.h / 2,
						font(800, 2 * em),
						FOREGROUND,
						'center'
					);
				}
			}
		});
	}

	const quote = post.quote ?? post.linked_post ?? null;
	if (quote) blocks.push(quoteBlock(ctx, quote, media, colX, colW, s));
	else if (post.link_preview && !post.poll)
		blocks.push(
			previewBlock(
				ctx,
				post.link_preview,
				photos.length || gif ? null : media.preview,
				colX,
				colW,
				s
			)
		);

	const gap = 10 * s;
	const replyH = post.reply_to ? lh + gap : 0;
	const headerH = lh;
	const actionsH = 10 * s + lh;
	const blocksH =
		blocks.reduce((sum, b) => sum + b.height, 0) + Math.max(0, blocks.length - 1) * gap;
	const height = replyH + headerH + (blocks.length ? 3 * s + blocksH : 0) + actionsH;

	return {
		height,
		blocks,
		draw: (top, heights) => {
			let y = top;
			if (post.reply_to) {
				text(
					ctx,
					`Replying to @${post.reply_to.username}`,
					left + 3 * s,
					y + lh / 2,
					font(500, em),
					ACCENT
				);
				y += lh + gap;
			}
			// avatar
			if (media.avatar) {
				ctx.save();
				ctx.beginPath();
				ctx.arc(left + avatar / 2, y + avatar / 2, avatar / 2, 0, Math.PI * 2);
				ctx.clip();
				drawImage(ctx, media.avatar, { x: left, y, w: avatar, h: avatar }, 0, 'cover');
				ctx.restore();
			}
			// thread line under the avatar of a post with replies is left out: there's nothing under it

			// name @username · date
			const date = formatDate(post.created_at);
			const dateFont = font(500, 12.8 * s);
			ctx.font = dateFont;
			const dateW = ctx.measureText(date).width;
			let nameRoom = colW - dateW - 10 * s;
			const badge = post.user.bot ? botBadge(ctx, s) : null;
			if (badge) nameRoom -= badge.width + 4 * s;
			const nameFont = font(800, em);
			const userFont = font(500, em);
			const name = fit(ctx, post.user.name, nameRoom * 0.7, nameFont);
			ctx.font = nameFont;
			const nameW = ctx.measureText(name + ' ').width;
			const handle = fit(ctx, '@' + post.user.username, nameRoom - nameW, userFont);
			text(ctx, name, colX, y + lh / 2, nameFont, FOREGROUND);
			ctx.save();
			ctx.globalAlpha = 0.8;
			text(ctx, handle, colX + nameW, y + lh / 2, userFont, FOREGROUND);
			ctx.restore();
			if (badge) {
				ctx.font = userFont;
				badge.draw(colX + nameW + ctx.measureText(handle).width + 4 * s, y + lh / 2);
			}
			ctx.save();
			ctx.globalAlpha = 0.7;
			text(ctx, date, colX + colW, y + lh / 2, dateFont, FOREGROUND, 'right');
			ctx.restore();
			y += headerH;

			if (blocks.length) y += 3 * s;
			blocks.forEach((block, i) => {
				block.draw(y, heights[i]);
				y += heights[i] + gap;
			});
			if (blocks.length) y -= gap;

			// replies, regiorgs and quotes, likes, share
			y += 10 * s;
			const cy = y + lh / 2;
			let x = colX;
			const count = (n: number) => {
				const label = compact.format(n);
				text(ctx, label, x, cy, font(500, em), FOREGROUND);
				ctx.font = font(500, em);
				x += ctx.measureText(label).width + 10 * s;
			};
			const icon = (name: keyof typeof ICONS, size: number, alpha = 1) => {
				drawIcon(ctx, name, x, cy - (size * s) / 2, size * s, alpha);
				x += size * s + 10 * s;
			};
			icon('reply', 18, 0.5);
			count(post.replies_count);
			icon('regiorg', 19);
			count(post.regiorgs + post.quotes);
			icon('like', 20);
			count(post.likes);
			icon('share', 21);
		}
	};
}

function gifBadge(ctx: CanvasRenderingContext2D, x: number, bottom: number, s: number) {
	const f = font(700, 12 * s);
	ctx.font = f;
	const w = ctx.measureText('GIF').width + 10 * s;
	const h = 18 * s;
	ctx.fillStyle = 'rgba(0,0,0,0.7)';
	ctx.beginPath();
	ctx.roundRect(x, bottom - h, w, h, h / 2);
	ctx.fill();
	text(ctx, 'GIF', x + w / 2, bottom - h / 2, f, FOREGROUND, 'center');
	return x + w;
}

/**
 * A GIF, drawn as a box of its shape with the GIF badge and its title: the GIF itself is on KLIPY,
 * and the server never fetches from other sites.
 */
function gifBlock(ctx: CanvasRenderingContext2D, gif: Gif, x: number, w: number, s: number): Block {
	const ratio = gif.width > 0 && gif.height > 0 ? gif.width / gif.height : 1;
	const natural = Math.min(240 * s, w / ratio);
	return {
		height: natural,
		flex: { min: Math.min(natural, 70 * s) },
		draw: (y, h) => {
			const bw = Math.min(w, Math.max(h * ratio, 260 * s));
			ctx.fillStyle = 'rgba(255,255,255,0.05)';
			ctx.beginPath();
			ctx.roundRect(x, y, bw, h, 5 * s);
			ctx.fill();
			strokeBox(ctx, { x, y, w: bw, h }, 5 * s, s);
			const badge = font(700, 12 * s);
			ctx.font = badge;
			const titleF = font(500, 13.6 * s);
			const title = gif.title ? fit(ctx, gif.title, bw - 20 * s, titleF) : '';
			const cy = y + h / 2 - (title ? 11 * s : 0);
			const bwBadge = ctx.measureText('GIF').width + 10 * s;
			gifBadge(ctx, x + bw / 2 - bwBadge / 2, cy + 9 * s, s);
			if (title) text(ctx, title, x + bw / 2, cy + 24 * s, titleF, MUTED, 'center');
		}
	};
}

/**
 * A voice note, as VoiceNotePlayer.svelte shows it before it's played: the play button, its 64
 * bars and its length under them.
 */
function voiceBlock(
	ctx: CanvasRenderingContext2D,
	note: VoiceNote,
	x: number,
	w: number,
	s: number
): Block {
	const button = 36 * s;
	const barsH = 32 * s;
	const timeF = font(500, 12.8 * s);
	const timeH = 0.8 * 24 * s;
	const gap = 5 * s;
	// as wide as the player's max-w-100
	const width = Math.min(w, 400 * s);
	return {
		height: button + gap + timeH,
		draw: (y) => {
			const cy = y + button / 2;
			const icon = 22 * s;
			drawIcon(ctx, 'play', x + (button - icon) / 2, cy - icon / 2, icon, 1, true);
			waveformBars(ctx, note.waveform, x + button + 10 * s, cy, width - button - 10 * s, barsH, s);
			ctx.save();
			ctx.globalAlpha = 0.8;
			text(
				ctx,
				formatDuration(note.duration_ms),
				x + 46 * s,
				y + button + gap + timeH / 2,
				timeF,
				FOREGROUND
			);
			ctx.restore();
		}
	};
}

/** Waveform.svelte's bars: rounded, up to 2px wide, at least 8% of the height, spread out. */
function waveformBars(
	ctx: CanvasRenderingContext2D,
	bars: number[],
	x: number,
	cy: number,
	w: number,
	h: number,
	s: number
) {
	if (!bars.length) return;
	const barW = Math.min(2 * s, w / (bars.length * 2));
	const step = bars.length > 1 ? (w - barW) / (bars.length - 1) : 0;
	ctx.fillStyle = MUTED;
	bars.forEach((bar, i) => {
		const bh = Math.max(2 * s, h * Math.max(0.08, bar / 255));
		ctx.beginPath();
		ctx.roundRect(x + i * step, cy - bh / 2, barW, bh, barW / 2);
		ctx.fill();
	});
}

function botBadge(ctx: CanvasRenderingContext2D, s: number) {
	const f = font(500, 12 * s);
	ctx.font = f;
	const width = ctx.measureText('bot').width + 16 * s;
	const h = 18 * s;
	return {
		width,
		draw: (x: number, cy: number) => {
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(x, cy - h / 2, width, h, h / 2);
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = s;
			ctx.stroke();
			ctx.restore();
			text(ctx, 'bot', x + width / 2, cy, f, ACCENT, 'center');
		}
	};
}

function pollBlock(
	ctx: CanvasRenderingContext2D,
	poll: Poll,
	x: number,
	w: number,
	s: number
): Block {
	const total = poll.votes.reduce((a, b) => a + b, 0);
	const leader = Math.max(...poll.votes);
	const optionH = 24 * s + 10 * s;
	const gap = 5 * s;
	const options = poll.options.slice(0, 4);
	const summaryH = 0.85 * 24 * s;
	return {
		height: options.length * (optionH + gap) + summaryH,
		draw: (y) => {
			options.forEach((option, i) => {
				const box = { x, y: y + i * (optionH + gap), w, h: optionH };
				const share = total ? poll.votes[i] / total : 0;
				const leading = total > 0 && poll.votes[i] === leader;
				ctx.save();
				ctx.beginPath();
				ctx.roundRect(box.x, box.y, box.w, box.h, 5 * s);
				ctx.clip();
				ctx.fillStyle = leading ? 'rgba(121,154,116,0.35)' : 'rgba(255,255,255,0.1)';
				ctx.fillRect(box.x, box.y, box.w * share, box.h);
				ctx.restore();
				strokeBox(ctx, box, 5 * s, s);
				const percent = `${Math.round(share * 100)}%`;
				const pf = font(500, 14.4 * s);
				ctx.font = pf;
				const pw = ctx.measureText(percent).width;
				const label = fit(ctx, option, w - pw - 30 * s, font(500, 16 * s));
				ctx.save();
				ctx.globalAlpha = leading ? 1 : 0.8;
				text(ctx, label, x + 5 * s + 4 * s, box.y + box.h / 2, font(500, 16 * s), FOREGROUND);
				ctx.restore();
				text(ctx, percent, x + w - 9 * s, box.y + box.h / 2, pf, FOREGROUND, 'right');
			});
			const votes = `${compact.format(total)} ${total === 1 ? 'vote' : 'votes'}${
				poll.closed ? ' · Final results' : ''
			}`;
			text(
				ctx,
				votes,
				x,
				y + options.length * (optionH + gap) + summaryH / 2,
				font(500, 13.6 * s),
				MUTED
			);
		}
	};
}

function quoteBlock(
	ctx: CanvasRenderingContext2D,
	quote: QuotedPost | { deleted: true },
	media: Media,
	x: number,
	w: number,
	s: number
): Block {
	const pad = 10 * s;
	const innerW = w - pad * 2;
	if ('deleted' in quote) {
		const h = pad * 2 + 0.9 * 24 * s;
		return {
			height: h,
			draw: (y) => {
				strokeBox(ctx, { x, y, w, h }, 5 * s, s);
				text(ctx, 'This post was deleted.', x + pad, y + h / 2, font(500, 14.4 * s), MUTED);
			}
		};
	}
	const headH = 0.9 * 24 * s;
	const tf = font(500, 15.2 * s);
	const tlh = 15.2 * 1.5 * s;
	const lines = clamp(
		ctx,
		wrap(
			ctx,
			[{ text: unwrapMarkdownImages(quote.content).trim(), color: FOREGROUND }],
			tf,
			innerW
		),
		4,
		tf,
		innerW
	);
	const thumbs = quote.images
		.map((_, i) => media.quoteImages[i])
		.filter((i): i is Image => !!i)
		.slice(0, 4);
	const single = thumbs.length === 1 ? thumbs[0] : null;
	const quoteGif = !thumbs.length && quote.gif ? quote.gif : null;
	let mediaH = 0;
	if (thumbs.length > 1) mediaH = (innerW - 3 * 4 * s) / 4;
	else if (single) mediaH = Math.min(140 * s, (innerW * single.height) / single.width);
	const parts = [
		headH,
		lines.length ? lines.length * tlh : 0,
		quote.is_quote ? 0.85 * 24 * s : 0,
		quoteGif ? 18 * s : 0,
		quote.audio ? 0.85 * 24 * s : 0,
		mediaH
	].filter(Boolean);
	const natural = pad * 2 + parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * 5 * s;
	return {
		height: natural,
		// its photos shrink (cropped) when the card is short of room
		flex: mediaH ? { min: natural - mediaH + Math.min(mediaH, 50 * s) } : undefined,
		draw: (y, h) => {
			const shownH = mediaH - (natural - h);
			strokeBox(ctx, { x, y, w, h }, 5 * s, s);
			let cy = y + pad;
			const av = 20 * s;
			if (media.quoteAvatar) {
				ctx.save();
				ctx.beginPath();
				ctx.arc(x + pad + av / 2, cy + headH / 2, av / 2, 0, Math.PI * 2);
				ctx.clip();
				drawImage(
					ctx,
					media.quoteAvatar,
					{ x: x + pad, y: cy + headH / 2 - av / 2, w: av, h: av },
					0,
					'cover'
				);
				ctx.restore();
			}
			const date = formatDate(quote.created_at);
			const df = font(500, 11.5 * s);
			ctx.font = df;
			const dw = ctx.measureText(date).width;
			const nf = font(700, 14.4 * s);
			const uf = font(500, 14.4 * s);
			const room = innerW - av - 5 * s - dw - 10 * s;
			const name = fit(ctx, quote.user.name, room * 0.7, nf);
			ctx.font = nf;
			const nw = ctx.measureText(name + ' ').width;
			text(ctx, name, x + pad + av + 5 * s, cy + headH / 2, nf, FOREGROUND);
			ctx.save();
			ctx.globalAlpha = 0.8;
			text(
				ctx,
				fit(ctx, '@' + quote.user.username, room - nw, uf),
				x + pad + av + 5 * s + nw,
				cy + headH / 2,
				uf,
				FOREGROUND
			);
			ctx.globalAlpha = 0.7;
			text(ctx, date, x + w - pad, cy + headH / 2, df, FOREGROUND, 'right');
			ctx.restore();
			cy += headH + 5 * s;
			if (lines.length) {
				drawLines(ctx, lines, x + pad, cy, tf, tlh);
				cy += lines.length * tlh + 5 * s;
			}
			if (quote.is_quote) {
				text(ctx, 'Quoting another post', x + pad, cy + 0.85 * 12 * s, font(500, 13.6 * s), MUTED);
				cy += 0.85 * 24 * s + 5 * s;
			}
			if (quote.audio) {
				// the mic and the length, like the previews of a voice note elsewhere
				const lineH = 0.85 * 24 * s;
				const icon = 15 * s;
				drawIcon(ctx, 'mic', x + pad, cy + lineH / 2 - icon / 2, icon, 0.6);
				text(
					ctx,
					`Voice message · ${formatDuration(quote.audio.duration_ms)}`,
					x + pad + icon + 5 * s,
					cy + lineH / 2,
					font(500, 13.6 * s),
					MUTED
				);
				cy += lineH + 5 * s;
			}
			if (thumbs.length > 1) {
				thumbs.forEach((thumb, i) =>
					drawImage(
						ctx,
						thumb,
						{ x: x + pad + i * (mediaH + 4 * s), y: cy, w: mediaH, h: shownH },
						5 * s,
						'cover'
					)
				);
			} else if (single) {
				const iw = (mediaH * single.width) / single.height;
				drawImage(ctx, single, { x: x + pad, y: cy, w: iw, h: shownH }, 5 * s, 'cover');
			} else if (quoteGif) {
				const end = gifBadge(ctx, x + pad, cy + 18 * s, s);
				if (quoteGif.title)
					text(
						ctx,
						fit(ctx, quoteGif.title, innerW - (end - x - pad) - 5 * s, font(500, 13.6 * s)),
						end + 5 * s,
						cy + 9 * s,
						font(500, 13.6 * s),
						MUTED
					);
			}
		}
	};
}

function previewBlock(
	ctx: CanvasRenderingContext2D,
	preview: LinkPreview,
	image: Image | null,
	x: number,
	w: number,
	s: number
): Block {
	const pad = 10 * s;
	const innerW = w - pad * 2;
	const siteF = font(500, 12.8 * s);
	const titleF = font(700, 16 * s);
	const descF = font(500, 13.6 * s);
	const title = clamp(
		ctx,
		wrap(ctx, [{ text: preview.title, color: FOREGROUND }], titleF, innerW),
		2,
		titleF,
		innerW
	);
	const desc = preview.description
		? clamp(
				ctx,
				wrap(ctx, [{ text: preview.description, color: MUTED }], descF, innerW),
				2,
				descF,
				innerW
		  )
		: [];
	const siteH = 12.8 * 1.5 * s;
	const titleH = title.length * 24 * s;
	const descH = desc.length * 13.6 * 1.5 * s;
	const textH = pad * 2 + siteH + 2 * s + titleH + (desc.length ? 2 * s + descH : 0);
	const imageH = image ? Math.min(300 * s, w / 1.91) : 0;
	return {
		height: textH + imageH,
		flex: image ? { min: textH + Math.min(imageH, 100 * s) } : undefined,
		draw: (y, h) => {
			const ih = h - textH;
			strokeBox(ctx, { x, y, w, h }, 5 * s, s);
			if (image && ih > 0) {
				ctx.save();
				ctx.beginPath();
				ctx.roundRect(x, y, w, h, 5 * s);
				ctx.clip();
				drawImage(ctx, image, { x, y, w, h: ih }, 0, 'cover');
				ctx.fillStyle = LINE;
				ctx.fillRect(x, y + ih - s, w, s);
				ctx.restore();
			}
			let cy = y + Math.max(ih, 0) + pad;
			text(ctx, fit(ctx, preview.site_name, innerW, siteF), x + pad, cy + siteH / 2, siteF, MUTED);
			cy += siteH + 2 * s;
			drawLines(ctx, title, x + pad, cy, titleF, 24 * s);
			cy += titleH + 2 * s;
			if (desc.length) drawLines(ctx, desc, x + pad, cy, descF, 13.6 * 1.5 * s);
		}
	};
}

/** The heights to draw `blocks` at so the post fits `room`: media shrinks first. Null if it can't. */
function heightsFor(l: Layout, room: number): number[] | null {
	const natural = l.blocks.map((b) => b.height);
	let excess = l.height - room;
	if (excess <= 0) return natural;
	const heights = [...natural];
	for (let i = heights.length - 1; i >= 0 && excess > 0; i--) {
		const flex = l.blocks[i].flex;
		if (!flex) continue;
		const cut = Math.min(excess, heights[i] - flex.min);
		heights[i] -= cut;
		excess -= cut;
	}
	return excess <= 0.5 ? heights : null;
}

// --- the card ------------------------------------------------------------------------------------

async function loadMedia(post: Post): Promise<Media> {
	const quote = post.quote ?? post.linked_post ?? null;
	const quoted = quote && !('deleted' in quote) ? quote : null;
	const [avatar, images, quoteAvatar, quoteImages, preview] = await Promise.all([
		avatarImage(post.user),
		Promise.all(post.images.slice(0, 4).map(storedImage)),
		quoted ? avatarImage(quoted.user) : null,
		quoted ? Promise.all(quoted.images.slice(0, 4).map(storedImage)) : [],
		!quote && post.link_preview?.image && isPreviewPath(post.link_preview.image)
			? storedImage(post.link_preview.image)
			: null
	]);
	return { avatar, images, quoteAvatar, quoteImages, preview };
}

/** A blank card: the page background and the empty content panel. */
function blankCard() {
	const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = BACKGROUND;
	ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
	ctx.fillStyle = '#000';
	ctx.beginPath();
	ctx.roundRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.radius);
	ctx.fill();
	return { canvas, ctx };
}

/** Draws `draw` clipped to the panel (its rounded corners included). */
function inPanel(ctx: CanvasRenderingContext2D, draw: () => void) {
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.radius);
	ctx.clip();
	draw();
	ctx.restore();
}

/** Adds the logo and the instance's host under the panel, and encodes the card. */
async function finishCard(canvas: Canvas, ctx: CanvasRenderingContext2D) {
	const host = PUBLIC_URL ? new URL(PUBLIC_URL).host : 'social.giorgiovola.casa';
	const mark = await logo();
	let x = PANEL.x + 4;
	if (mark) {
		drawImage(ctx, mark, { x, y: FOOTER_Y - 18, w: 36, h: 36 }, 6, 'contain');
		x += 36 + 14;
	}
	text(ctx, host, x, FOOTER_Y, font(700, 24), MUTED);
	return new Uint8Array(canvas.toBuffer('image/png'));
}

/** Renders the social card of `post` as a PNG. */
export async function renderPostCard(post: Post): Promise<Uint8Array<ArrayBuffer>> {
	const media = await loadMedia(post);
	const { canvas, ctx } = blankCard();

	// the largest scale the whole post fits at; else the smallest, with the text cut short
	let chosen: { l: Layout; heights: number[] } | null = null;
	for (let s = MAX_SCALE; s >= MIN_SCALE - 0.001 && !chosen; s -= 0.1) {
		const l = layout(ctx, post, media, s);
		const heights = heightsFor(l, AREA.h);
		if (heights) chosen = { l, heights };
	}
	for (let lines = 12; lines >= 1 && !chosen; lines--) {
		const l = layout(ctx, post, media, MIN_SCALE, lines);
		const heights = heightsFor(l, AREA.h);
		if (heights || lines === 1) chosen = { l, heights: heights ?? l.blocks.map((b) => b.height) };
	}
	const { l, heights } = chosen!;
	const used = l.height - l.blocks.reduce((sum, b, i) => sum + b.height - heights[i], 0);
	inPanel(ctx, () => l.draw(AREA.y + Math.max(0, (AREA.h - used) / 2), heights));
	return finishCard(canvas, ctx);
}

export type CardProfile = Pick<
	ProfileCard,
	'username' | 'name' | 'avatar' | 'bot' | 'bio' | 'website' | 'followers' | 'following'
>;

/**
 * The social card of a profile: its header as the profile page shows it (avatar, name, bio,
 * website and counts).
 */
export async function renderProfileCard(profile: CardProfile): Promise<Uint8Array<ArrayBuffer>> {
	const avatar = await avatarImage(profile);
	const { canvas, ctx } = blankCard();

	const header = (s: number) => {
		const av = 60 * s;
		const infoX = AREA.x + av + 10 * s;
		const infoW = AREA.x + AREA.w - infoX;
		const nameF = font(700, 32 * s);
		const nameLh = 32 * 1.3 * s;
		const lh = 24 * s;
		const bioF = font(500, 16 * s);
		const bio = profile.bio.trim()
			? clamp(
					ctx,
					wrap(ctx, [{ text: profile.bio.trim(), color: FOREGROUND }], bioF, infoW),
					3,
					bioF,
					infoW
			  )
			: [];
		const statsLh = 14.4 * 1.5 * s;
		const height =
			nameLh +
			lh +
			(bio.length ? 8 * s + bio.length * lh : 0) +
			(profile.website ? 4 * s + lh : 0) +
			4 * s +
			statsLh;
		const draw = (top: number) => {
			ctx.save();
			ctx.beginPath();
			ctx.arc(AREA.x + av / 2, top + av / 2, av / 2, 0, Math.PI * 2);
			ctx.clip();
			if (avatar) drawImage(ctx, avatar, { x: AREA.x, y: top, w: av, h: av }, 0, 'cover');
			ctx.restore();
			let y = top;
			text(ctx, fit(ctx, profile.name, infoW, nameF), infoX, y + nameLh / 2, nameF, FOREGROUND);
			y += nameLh;
			const userF = font(500, 16 * s);
			const handle = fit(ctx, '@' + profile.username, infoW - 60 * s, userF);
			text(ctx, handle, infoX, y + lh / 2, userF, FOREGROUND);
			if (profile.bot) {
				ctx.font = userF;
				botBadge(ctx, s).draw(infoX + ctx.measureText(handle).width + 4 * s, y + lh / 2);
			}
			y += lh;
			if (bio.length) {
				y += 8 * s;
				drawLines(ctx, bio, infoX, y, bioF, lh);
				y += bio.length * lh;
			}
			if (profile.website) {
				y += 4 * s;
				const label = websiteLabel(profile.website);
				text(ctx, fit(ctx, label, infoW, userF), infoX, y + lh / 2, userF, ACCENT);
				y += lh;
			}
			y += 4 * s;
			const numF = font(700, 14.4 * s);
			const wordF = font(500, 14.4 * s);
			let x = infoX;
			const stat = (n: number, word: string) => {
				const num = compact.format(n);
				text(ctx, num, x, y + statsLh / 2, numF, FOREGROUND);
				ctx.font = numF;
				x += ctx.measureText(num + ' ').width;
				text(ctx, word, x, y + statsLh / 2, wordF, MUTED);
				ctx.font = wordF;
				x += ctx.measureText(word).width + 12 * s;
			};
			stat(profile.following, 'following');
			stat(profile.followers, profile.followers === 1 ? 'follower' : 'followers');
		};
		return { height: Math.max(av, height), draw };
	};

	// the largest scale the header fits at, centred in the panel
	let s = PROFILE_MAX_SCALE;
	while (s > MIN_SCALE && header(s).height > AREA.h) s -= 0.1;
	const h = header(s);
	inPanel(ctx, () => h.draw(AREA.y + Math.max(0, (AREA.h - h.height) / 2)));
	return finishCard(canvas, ctx);
}
