// Usage: bun scripts/seed.ts   (needs DATABASE_URL, run it after the migrations)
// With docker: docker compose exec -u bun web bun scripts/seed.ts
//
// test data for local development and the staging server (the deploy runs it on staging, see
// "deploying" in README.md). Only seeds an empty database (no users), so it never brings back
// data you deleted and never touches an instance that has accounts.
// every account has the password SEED_PASSWORD ("dev" by default); "dev" is an admin. When
// PUBLIC_URL isn't localhost SEED_PASSWORD must be set, so a public server never gets dev/dev,
// and dev_bot gets a random token unless SEED_BOT_TOKEN is set.
//
// Self-contained (the Docker image has no src/): the password hashing is copied from
// src/lib/server/password.ts.
//
// chat test cases, all from dev's point of view (log in as dev):
//   DMs
//     alice  short thread, last message unread
//     bob    80 messages over ~2 days, last 12 unread (divider inside the first page, crosses a
//            day boundary), an unread reply quoting a message far above the first page
//     carol  75 messages, last 45 unread: the first unread is beyond the first page of 30
//     dave   never answered: all 8 messages unread, the first one taller than the screen
//     erin   50 messages, all read: opens at the bottom, no divider
//     frank  dev wrote last and frank hasn't read it: nothing unread for dev
//     grace  images (wide, tall, square, tiny), replies, reactions and an edit around the divider
//     heidi  muted, 6 unread (out of the badge)
//     ivan   blocked by dev, read history
//     judy   first contact: one unread message, nothing before it
//   groups
//     weekend plans       40 read, 10 unread with a reply and reactions
//     book club backlog   120 messages, 80 unread (several pages)
//     muted noise         muted, 25 unread
//     all caught up       everything read
//     fresh group         dev just added, never opened: every message unread, events before them
//     renamed since       read up to #20, then rename and leave events, then 3 unread messages
//
// identities (log in as dev, open the account switcher or /settings/accounts):
//   owned by dev, exactly MAX_IDENTITIES (10), so creating another one must fail:
//     dev_alt          plain, shared with nobody, posts + followers, follows dev
//     dev_identity_with_a_long_name_32
//                      longest username (32) and longest name (64)
//     volpe            emoji / accented / CJK name
//     dev_team         shared with 10 accounts, alice..judy (MAX_MEMBERS: sharing is full)
//     dev_pair         shared with alice only
//     dev_with_banned  shared with mallory, a banned account
//     dev_inbox        its own inbox: unread DMs from bob, a read thread with carol, a group
//     dev_pinned       30 posts, one pinned
//     dev_oldest       created two years ago
//     dev_newest       created a minute ago
//   + dev_bot, a bot owned by dev: bots don't count towards the identity limit
//     (usable token: SEED_BOT_TOKEN)
//   shared with dev by others:
//     alice_art        alice's, shared with dev and bob, unread DMs from grace
//     carol_desk       carol's (a mod), shared with dev only, one unread DM
//     bob_full         bob's, shared with 10 accounts (dev, alice, carol..judy)
//     not_alice        erin's, display name "Alice" like the real alice
//     mallory_hidden   owned by banned mallory, shared with dev: must NOT show up
//   mallory: a banned account (can't log in), member of dev_with_banned
//
// invites (Settings → Invites, Moderation → Invites):
//   every account holds 2, dev 5. alice has one code out ("for my cousin") and brought in judy;
//   bob has a revoked and an expired code (both given back). dev has an admin code that never
//   expires, printed at the end: sign up a new account with it (fixed locally, random on a
//   public server)
//
// generated messages start with "#n" (their position in the thread) so you can see where the
// chat opened.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, scrypt } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const publicUrl = process.env.PUBLIC_URL;
const local =
	!publicUrl || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(publicUrl).hostname);
if (!local && !process.env.SEED_PASSWORD) {
	console.error(
		`set SEED_PASSWORD: ${publicUrl} is public, the seed accounts need a real password`
	);
	process.exit(1);
}

const SEED_PASSWORD = process.env.SEED_PASSWORD || 'dev';
// a working bot token for dev_bot (sgc_ + 43 characters): fixed locally, random on a public server
const SEED_BOT_TOKEN =
	process.env.SEED_BOT_TOKEN ||
	(local ? 'sgc_' + 'devseedbot'.padEnd(43, '0') : 'sgc_' + randomBytes(32).toString('base64url'));

// same as hashPassword in src/lib/server/password.ts
async function hashPassword(password: string) {
	const salt = randomBytes(16).toString('hex');
	const key = await new Promise<Buffer>((resolve, reject) =>
		scrypt(password, salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, k) =>
			err ? reject(err) : resolve(k)
		)
	);
	return { salt, hash: 'scrypt$' + key.toString('hex') };
}

// invite codes: 12 of a-z and 2-9 (see src/lib/server/invites.ts)
const inviteCode = (fixed: string) =>
	local
		? fixed
		: Array.from(randomBytes(12), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const SEED_INVITE = inviteCode('devinvite234');

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const uid = (username: string) => `(SELECT id FROM users WHERE username = ${q(username)})`;
const pid = (content: string) => `(SELECT id FROM posts WHERE content = ${q(content)})`;
const ago = (minutes: number) => `now() - interval '${minutes} minutes'`;
const gid = (name: string) => `(SELECT id FROM group_chats WHERE name = ${q(name)})`;

const LINES = [
	'ok',
	'lol',
	'sounds good to me',
	'wait, really?',
	'did you see the new build? the header finally stopped jumping around',
	'brb, coffee',
	'can you send me the link again',
	'https://example.com/some/very/long/path/that/should/wrap/somewhere/sensible',
	'@dev what do you think?',
	'haha yes',
	'I tried it on my phone and the keyboard covered half of the input, not sure if that is us or the browser',
	'tomorrow works',
	'👍',
	'🎉🎉🎉',
	'no idea, ask carol',
	'one sec',
	'that is a long story, remind me later and I will tell you everything',
	'fixed it',
	'nope, still broken on firefox',
	'agreed',
	'what time?',
	'see you there',
	'line one\nline two\nline three',
	'sorry, missed this'
];
const lines = `ARRAY[${LINES.map(q).join(', ')}]`;
const line = (i: string) => `'#' || ${i} || ' ' || (${lines})[1 + (${i} * 7) % ${LINES.length}]`;

const LONG =
	'ok so this is going to be a long one, sorry in advance.\n\n' +
	'I have been thinking about the plan for the weekend and I am not sure it works for everybody: ' +
	'the train leaves at 7, which means getting up at 6, and last time half of us missed it. ' +
	'what if we take the 9:30 instead and skip the first stop? we lose an hour there but nobody has to run.\n\n' +
	'also, about the food: I can bring the big pot, someone else needs to bring plates, and we should ' +
	'decide whether we cook or just order something. I vote cook, it is half the fun.\n\n' +
	'last thing: the weather says rain on sunday afternoon, so maybe we plan the walk for saturday and ' +
	'keep sunday for the museum. let me know what you think, no rush, but before thursday would be great ' +
	'so I can book the tickets.\n\n' +
	'(and yes, I know this should have been a call)';

/** Direct messages #from..#to between a and b. `who` is cycled per message: "a" or "b" sends. */
function dmRun(
	a: string,
	b: string,
	o: { from: number; to: number; who: string; read: boolean; every: number; endAgo: number }
) {
	return `INSERT INTO messages (sender_id, recipient_id, content, created_at, read_at)
SELECT s, CASE WHEN s = ${uid(a)} THEN ${uid(b)} ELSE ${uid(a)} END, ${line('i')}, at,
	${o.read ? `at + interval '1 minute'` : 'NULL'}
FROM (
	SELECT i,
		CASE substr(${q(o.who)}, 1 + (i - 1) % ${o.who.length}, 1) WHEN 'a' THEN ${uid(a)} ELSE ${uid(
		b
	)} END AS s,
		now() - make_interval(mins => ${o.endAgo} + (${o.to} - i) * ${o.every}) AS at
	FROM generate_series(${o.from}, ${o.to}) i
) g ORDER BY i;`;
}

/** The generated message #n of the a/b conversation. */
const dmN = (a: string, b: string, n: number) =>
	`(SELECT id FROM messages WHERE content LIKE ${q(`#${n} %`)} AND sender_id IN (${uid(a)}, ${uid(
		b
	)}) AND recipient_id IN (${uid(a)}, ${uid(b)}))`;

function dm(
	from: string,
	to: string,
	content: string,
	mins: number,
	o: { read?: boolean; images?: string[]; replyTo?: string; edited?: boolean } = {}
) {
	const images = o.images?.length ? `ARRAY[${o.images.map(q).join(', ')}]` : `'{}'::text[]`;
	return `INSERT INTO messages (sender_id, recipient_id, content, created_at, read_at, images, image_sizes, reply_to_id, edited_at) VALUES (${uid(
		from
	)}, ${uid(to)}, ${q(content)}, ${ago(mins)}, ${
		o.read ? ago(mins - 1) : 'NULL'
	}, ${images}, ${sizesOf(o.images)}, ${o.replyTo ?? 'NULL'}, ${
		o.edited ? ago(mins - 2) : 'NULL'
	});`;
}
const dmId = (content: string) => `(SELECT id FROM messages WHERE content = ${q(content)})`;
const dmReact = (user: string, content: string, emoji: string) =>
	`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (${dmId(content)}, ${uid(
		user
	)}, ${q(emoji)});`;

/** A group with its created / added events; the owner is a member too. */
function group(name: string, owner: string, members: string[], mins: number, createdAs = name) {
	return [
		`INSERT INTO group_chats (name, owner_id, created_at) VALUES (${q(name)}, ${uid(owner)}, ${ago(
			mins
		)});`,
		...[owner, ...members].map(
			(m) =>
				`INSERT INTO group_members (group_id, user_id, joined_at) VALUES (${gid(name)}, ${uid(
					m
				)}, ${ago(mins)});`
		),
		`INSERT INTO group_messages (group_id, sender_id, kind, content, created_at) VALUES (${gid(
			name
		)}, ${uid(owner)}, 'created', ${q(createdAs)}, ${ago(mins)});`,
		...members.map(
			(m) =>
				`INSERT INTO group_messages (group_id, sender_id, kind, target_id, content, created_at) VALUES (${gid(
					name
				)}, ${uid(owner)}, 'added', ${uid(m)}, '', ${ago(mins)});`
		)
	];
}

/** Group messages #from..#to, senders cycled. */
function groupRun(
	name: string,
	senders: string[],
	o: { from: number; to: number; every: number; endAgo: number }
) {
	return `INSERT INTO group_messages (group_id, sender_id, content, created_at)
SELECT ${gid(name)}, (ARRAY[${senders.map(uid).join(', ')}])[1 + (i - 1) % ${
		senders.length
	}], ${line('i')},
	now() - make_interval(mins => ${o.endAgo} + (${o.to} - i) * ${o.every})
FROM generate_series(${o.from}, ${o.to}) i ORDER BY i;`;
}

const groupN = (name: string, n: number) =>
	`(SELECT id FROM group_messages WHERE group_id = ${gid(name)} AND content LIKE ${q(`#${n} %`)})`;

/** Marks name's messages up to #n (and the events before them) as read by user. */
const groupRead = (name: string, user: string, n: number | 'all') =>
	`UPDATE group_members SET last_read_id = ${
		n === 'all'
			? `(SELECT max(id) FROM group_messages WHERE group_id = ${gid(name)})`
			: groupN(name, n)
	} WHERE group_id = ${gid(name)} AND user_id = ${uid(user)};`;

function groupMsg(
	name: string,
	from: string,
	content: string,
	mins: number,
	o: { replyTo?: string; images?: string[] } = {}
) {
	const images = o.images?.length ? `ARRAY[${o.images.map(q).join(', ')}]` : `'{}'::text[]`;
	return `INSERT INTO group_messages (group_id, sender_id, content, created_at, reply_to_id, images, image_sizes) VALUES (${gid(
		name
	)}, ${uid(from)}, ${q(content)}, ${ago(mins)}, ${o.replyTo ?? 'NULL'}, ${images}, ${sizesOf(
		o.images
	)});`;
}
const groupReact = (name: string, msg: string, user: string, emoji: string) =>
	`INSERT INTO group_message_reactions (message_id, user_id, emoji) VALUES (${msg}, ${uid(
		user
	)}, ${q(emoji)});`;
const groupMsgId = (name: string, content: string) =>
	`(SELECT id FROM group_messages WHERE group_id = ${gid(name)} AND content = ${q(content)})`;

// test images, written as uploads (the file names must look like the app's uuids). `legacy`:
// stored without its size, like uploads from before sizes were saved (clients measure it)
const IMAGES: Record<
	'wide' | 'tall' | 'square' | 'tiny',
	{ file: string; w: number; h: number; color: string; legacy?: boolean }
> = {
	wide: { file: '5eed0000-0000-4000-8000-000000000001.webp', w: 1600, h: 600, color: '#3b5f7a' },
	tall: { file: '5eed0000-0000-4000-8000-000000000002.webp', w: 600, h: 1400, color: '#7a5a3b' },
	square: { file: '5eed0000-0000-4000-8000-000000000003.webp', w: 900, h: 900, color: '#4f7a3b' },
	tiny: {
		file: '5eed0000-0000-4000-8000-000000000004.webp',
		w: 40,
		h: 40,
		color: '#7a3b6a',
		legacy: true
	}
};
const img = (k: keyof typeof IMAGES) => `/uploads/${IMAGES[k].file}`;

/** The image_sizes of a message's images (see src/lib/server/db/schema.ts), NULL when unknown. */
function sizesOf(paths: string[] | undefined) {
	const found = (paths ?? []).map((p) => Object.values(IMAGES).find((i) => p.endsWith(i.file)));
	if (found.length === 0 || found.some((i) => !i || i.legacy)) return 'NULL';
	return `${q(JSON.stringify(found.map((i) => ({ width: i!.w, height: i!.h }))))}::jsonb`;
}

// into static/uploads (the uploads volume in docker); not into the bucket when S3_BUCKET is set
async function writeImages() {
	const { default: sharp } = await import('sharp');
	const dir = 'static/uploads';
	mkdirSync(dir, { recursive: true });
	for (const [label, { file, w, h, color }] of Object.entries(IMAGES)) {
		const size = Math.max(8, Math.round(Math.min(w, h) / 8));
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/>${
			w >= 200
				? `<text x="50%" y="50%" fill="#d9d9d9" font-family="sans-serif" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${label} ${w}×${h}</text>`
				: ''
		}</svg>`;
		writeFileSync(`${dir}/${file}`, await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer());
	}
}

async function seed(db: postgres.Sql) {
	const [{ count }] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM users`;
	if (count !== 0) return false;

	const { salt, hash } = await hashPassword(SEED_PASSWORD);

	if (process.env.S3_BUCKET)
		console.warn('> seed: S3_BUCKET is set, the test images will be missing');
	try {
		await writeImages();
	} catch (e) {
		// the chats still work, the images just show as broken
		console.warn('> seed: could not write test images:', e);
	}

	const users = [
		['dev', 'Dev', 'admin', 'the default dev account'],
		['alice', 'Alice', 'user', 'photos, plants and #svelte'],
		['bob', 'Bob', 'user', 'mostly here for the replies'],
		['carol', 'Carol', 'mod', 'moderator on duty'],
		['dave', 'Dave', 'user', 'writes long messages'],
		['erin', 'Erin', 'user', 'always caught up'],
		['frank', 'Frank', 'user', 'reads messages eventually'],
		['grace', 'Grace', 'user', 'sends a lot of pictures'],
		['heidi', 'Heidi', 'user', 'muted by dev'],
		['ivan', 'Ivan', 'user', 'blocked by dev'],
		['judy', 'Judy', 'user', 'new here'],
		['mallory', 'Mallory', 'user', 'banned']
	];

	// [owner, username, name, created minutes ago, shared with]
	const LONG_USERNAME = 'dev_identity_with_a_long_name_32';
	const LONG_NAME = 'A display name that is exactly sixty-four characters long, ok!!!';
	const OTHERS = [
		'alice',
		'bob',
		'carol',
		'dave',
		'erin',
		'frank',
		'grace',
		'heidi',
		'ivan',
		'judy'
	];
	const identities: [string, string, string, number, string[]][] = [
		['dev', 'dev_alt', 'Dev (alt)', 5000, []],
		['dev', LONG_USERNAME, LONG_NAME, 4900, []],
		['dev', 'volpe', '🦊 Vólpe Nötturna ✨ 日本', 4800, []],
		['dev', 'dev_team', 'Dev Team', 4700, OTHERS],
		['dev', 'dev_pair', 'Dev & Alice', 4600, ['alice']],
		['dev', 'dev_with_banned', 'Shared with a banned account', 4500, ['mallory']],
		['dev', 'dev_inbox', 'Dev Inbox', 4400, []],
		['dev', 'dev_pinned', 'Dev Pinned', 4300, []],
		['dev', 'dev_oldest', 'Dev Oldest', 2 * 365 * 24 * 60, []],
		['dev', 'dev_newest', 'Dev Newest', 1, []],
		['alice', 'alice_art', 'Alice Art', 3000, ['dev', 'bob']],
		['carol', 'carol_desk', 'Carol Mod Desk', 2900, ['dev']],
		['bob', 'bob_full', 'Bob Full House', 2800, OTHERS.map((u) => (u === 'bob' ? 'dev' : u))],
		['erin', 'not_alice', 'Alice', 2700, ['dev']],
		['mallory', 'mallory_hidden', 'Mallory Hidden', 2600, ['dev']]
	];

	const post = (user: string, content: string, mins: number, replyTo?: string) =>
		`INSERT INTO posts (user_id, content, created_at, reply_to) VALUES (${uid(user)}, ${q(
			content
		)}, ${ago(mins)}, ${replyTo ? pid(replyTo) : 'NULL'});`;
	const tag = (content: string, t: string) =>
		`INSERT INTO post_hashtags (post_id, tag) VALUES (${pid(content)}, ${q(t)});`;
	const like = (user: string, content: string) =>
		`INSERT INTO likes (user_id, post_id) VALUES (${uid(user)}, ${pid(content)});`;
	const follow = (a: string, b: string) =>
		`INSERT INTO follows (follower_id, followed_id) VALUES (${uid(a)}, ${uid(b)});`;

	const p1 = 'hello from the dev seed, this is the first post';
	const p2 = 'trying out #svelte 5 runes, so far so good';
	const p3 =
		'a longer post to see how wrapping looks in the timeline: the quick brown fox jumps over the lazy dog, again and again, until the line has to break somewhere sensible.';
	const p4 = 'who wants to see the poll?';
	const r1 = 'welcome @dev!';
	const r2 = 'runes are great, $state everywhere';
	const r3 = 'nested reply to the reply';

	// grace: media, replies, reactions and an edit on both sides of the divider
	const g1 = 'look at this view';
	const g2 = 'and the other side';
	const g3 = 'wow, where is that?';
	const g4 = 'up the hill behind the station, I will take you next time';
	const g5 = 'more pictures, sorry not sorry';
	const g6 = 'this one is tiny, does it still show?';
	const g7 = 'replying to your question from before: yes, totally worth the climb';
	const g8 = 'edited: fixed a typo in this one';

	// weekend plans
	const W = 'weekend plans';
	const w1 = 'so, who is in for saturday?';
	const w2 = 'me! replying so you see it';
	const w3 = 'the tickets are booked 🎉';

	const B = 'book club backlog';
	const R = 'renamed since';
	const F = 'fresh group';

	const sql = [
		'BEGIN;',
		...users.map(
			([username, name, role, bio]) =>
				`INSERT INTO users (username, name, email, password, salt, role, bio) VALUES (${q(
					username
				)}, ${q(name)}, ${q(`${username}@example.com`)}, ${q(hash)}, ${q(salt)}, ${q(role)}, ${q(
					bio
				)});`
		),
		`UPDATE users SET banned_at = now(), ban_reason = 'seed: banned account' WHERE username = 'mallory';`,

		// --- identities ---
		...identities.flatMap(([owner, username, name, mins, members]) => [
			`INSERT INTO users (username, name, owner_id, bio, created_at) VALUES (${q(username)}, ${q(
				name
			)}, ${uid(owner)}, ${q(`identity of @${owner}`)}, ${ago(mins)});`,
			...members.map(
				(m, i) =>
					`INSERT INTO identity_members (identity_id, account_id, created_at) VALUES (${uid(
						username
					)}, ${uid(m)}, ${ago(mins - 1 - i)});`
			)
		]),
		// a bot owned by dev: not an identity, doesn't count towards the limit
		`INSERT INTO users (username, name, owner_id, bot, bio) VALUES ('dev_bot', 'Dev Bot', ${uid(
			'dev'
		)}, true, 'beep');`,
		`INSERT INTO bots (user_id, token_hash) VALUES (${uid('dev_bot')}, encode(sha256(convert_to(${q(
			SEED_BOT_TOKEN
		)}, 'UTF8')), 'hex'));`,
		// dev_alt: posts, followers, follows its owner
		post('dev_alt', 'posting from my alt, nobody knows it is me', 400),
		post('dev_alt', 'second post from the alt', 200),
		follow('alice', 'dev_alt'),
		follow('bob', 'dev_alt'),
		follow('dev_alt', 'dev'),
		like('dev', 'posting from my alt, nobody knows it is me'),
		post('volpe', 'ciao da una volpe con un nome pieno di emoji 🦊', 350),
		post(LONG_USERNAME, 'the longest username and name, does the header still fit?', 330),
		post('dev_team', 'announcement from the team identity, shared with ten people', 310),
		post('alice_art', 'new drawing coming soon', 290),
		post('not_alice', 'I am not the alice you are looking for', 270),
		post('mallory_hidden', 'you should never see this identity in the switcher', 250),
		// dev_pinned: many posts, one pinned
		...Array.from({ length: 30 }, (_, i) =>
			post('dev_pinned', `dev_pinned post #${i + 1}`, 3000 - i * 60)
		),
		`UPDATE users SET pinned_post_id = ${pid('dev_pinned post #3')} WHERE username = 'dev_pinned';`,
		// dev_inbox: its own conversations
		dmRun('dev_inbox', 'bob', { from: 1, to: 15, who: 'ab', read: true, every: 30, endAgo: 120 }),
		dmRun('dev_inbox', 'bob', { from: 16, to: 20, who: 'b', read: false, every: 5, endAgo: 10 }),
		dmRun('dev_inbox', 'carol', { from: 1, to: 10, who: 'ba', read: true, every: 20, endAgo: 300 }),
		...group('identity group', 'alice', ['dev_inbox', 'bob'], 600),
		groupRun('identity group', ['alice', 'bob', 'dev_inbox'], {
			from: 1,
			to: 12,
			every: 15,
			endAgo: 20
		}),
		groupRead('identity group', 'dev_inbox', 6),
		// alice_art: unread DMs, seen by both dev and bob
		dmRun('alice_art', 'grace', { from: 1, to: 4, who: 'b', read: false, every: 10, endAgo: 25 }),
		dm('carol', 'carol_desk', 'reminder: check the report queue', 45),

		follow('dev', 'alice'),
		follow('dev', 'bob'),
		follow('alice', 'dev'),
		follow('bob', 'dev'),
		follow('carol', 'dev'),
		follow('alice', 'bob'),
		post('dev', p1, 180),
		post('alice', p2, 150),
		tag(p2, 'svelte'),
		post('bob', p3, 120),
		post('carol', p4, 90),
		post('alice', r1, 170, p1),
		post('bob', r2, 140, p2),
		post('dev', r3, 130, r2),
		like('alice', p1),
		like('bob', p1),
		like('carol', p1),
		like('dev', p2),
		like('bob', p2),
		like('dev', p3),
		like('dev', r1),
		// a poll with a few votes
		`INSERT INTO polls (post_id, options, ends_at) VALUES (${pid(
			p4
		)}, ARRAY['yes', 'no', 'maybe'], now() + interval '1 day');`,
		`INSERT INTO poll_votes (post_id, user_id, option) VALUES (${pid(p4)}, ${uid(
			'alice'
		)}, 0), (${pid(p4)}, ${uid('bob')}, 2), (${pid(p4)}, ${uid('dev')}, 0);`,

		// --- direct messages ---

		// alice: a short thread, the last one unread by dev
		dm('dev', 'alice', 'hey alice', 60, { read: true }),
		dm('alice', 'dev', 'hey! the seed worked', 58, { read: true }),
		dm('alice', 'dev', 'one more, still unread', 5),

		// bob: long, 12 unread inside the first page, across a day boundary
		dmRun('dev', 'bob', { from: 1, to: 68, who: 'abbab', read: true, every: 40, endAgo: 500 }),
		dmRun('dev', 'bob', { from: 69, to: 80, who: 'b', read: false, every: 40, endAgo: 20 }),
		dm('bob', 'dev', 'going back to this one from way up, still true', 15, {
			replyTo: dmN('dev', 'bob', 5)
		}),

		// carol: 45 unread, the first one beyond the first page
		dmRun('dev', 'carol', { from: 1, to: 30, who: 'ab', read: true, every: 20, endAgo: 920 }),
		dmRun('dev', 'carol', { from: 31, to: 75, who: 'b', read: false, every: 20, endAgo: 30 }),

		// dave: never answered, everything unread, starting with a very long message
		dm('dave', 'dev', LONG, 300),
		dmRun('dev', 'dave', { from: 2, to: 8, who: 'b', read: false, every: 30, endAgo: 40 }),

		// erin: everything read
		dmRun('dev', 'erin', { from: 1, to: 50, who: 'ab', read: true, every: 15, endAgo: 45 }),

		// frank: dev wrote last, frank hasn't read it
		dmRun('dev', 'frank', { from: 1, to: 20, who: 'ba', read: true, every: 10, endAgo: 80 }),
		dmRun('dev', 'frank', { from: 21, to: 23, who: 'a', read: false, every: 3, endAgo: 50 }),

		// grace: images, replies, reactions, an edit
		dmRun('dev', 'grace', { from: 1, to: 10, who: 'ab', read: true, every: 10, endAgo: 160 }),
		dm('grace', 'dev', g1, 150, { read: true, images: [img('wide')] }),
		dm('grace', 'dev', g2, 149, { read: true, images: [img('tall')] }),
		dm('dev', 'grace', g3, 140, { read: true, replyTo: dmId(g1) }),
		dmReact('dev', g1, '😍'),
		dmReact('grace', g3, '👍'),
		// unread from here
		dm('grace', 'dev', g4, 60, { replyTo: dmId(g3) }),
		dm('grace', 'dev', g5, 59, { images: [img('square'), img('wide'), img('tall')] }),
		dm('grace', 'dev', '', 58, { images: [img('square')] }),
		dm('grace', 'dev', g6, 57, { images: [img('tiny')] }),
		dm('grace', 'dev', g7, 30, { replyTo: dmId(g3) }),
		dm('grace', 'dev', g8, 20, { edited: true }),
		dmReact('grace', g5, '🔥'),

		// heidi: muted, with unread
		dmRun('dev', 'heidi', { from: 1, to: 6, who: 'ab', read: true, every: 10, endAgo: 200 }),
		dmRun('dev', 'heidi', { from: 7, to: 12, who: 'b', read: false, every: 5, endAgo: 100 }),
		`INSERT INTO dm_mutes (user_id, peer_id) VALUES (${uid('dev')}, ${uid('heidi')});`,

		// ivan: blocked, read history
		dmRun('dev', 'ivan', { from: 1, to: 10, who: 'ab', read: true, every: 60, endAgo: 1500 }),
		`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${uid('dev')}, ${uid('ivan')});`,

		// judy: first contact, a single unread message
		dm('judy', 'dev', 'hi! we met at the meetup, hope it is ok to write here', 2),

		// --- groups ---

		// weekend plans: 40 read, 10 unread with a reply and reactions
		...group(W, 'dev', ['alice', 'bob', 'carol'], 3000),
		groupRun(W, ['dev', 'alice', 'bob', 'carol'], { from: 1, to: 40, every: 60, endAgo: 700 }),
		groupMsg(W, 'dev', w1, 690),
		`UPDATE group_members SET last_read_id = ${groupMsgId(W, w1)} WHERE group_id = ${gid(
			W
		)} AND user_id = ${uid('dev')};`,
		groupRun(W, ['alice', 'bob', 'carol'], { from: 41, to: 48, every: 30, endAgo: 120 }),
		groupMsg(W, 'alice', w2, 100, { replyTo: groupMsgId(W, w1) }),
		groupMsg(W, 'carol', w3, 90, { images: [img('wide')] }),
		groupReact(W, groupMsgId(W, w1), 'alice', '🙋'),
		groupReact(W, groupMsgId(W, w1), 'bob', '🙋'),
		groupReact(W, groupMsgId(W, w3), 'bob', '🎉'),
		groupReact(W, groupMsgId(W, w3), 'dev', '🎉'),
		// everyone else is caught up
		...['alice', 'bob', 'carol'].map((u) => groupRead(W, u, 'all')),

		// book club backlog: 120 messages, dev read 40
		...group(B, 'carol', ['dev', 'alice', 'bob', 'dave', 'erin'], 5000),
		groupRun(B, ['carol', 'alice', 'dev', 'bob', 'dave', 'erin'], {
			from: 1,
			to: 40,
			every: 30,
			endAgo: 2500
		}),
		groupRun(B, ['carol', 'alice', 'bob', 'dave', 'erin'], {
			from: 41,
			to: 120,
			every: 25,
			endAgo: 10
		}),
		groupRead(B, 'dev', 40),

		// muted noise: muted, 25 unread
		...group('muted noise', 'bob', ['dev', 'frank', 'grace'], 900),
		groupRun('muted noise', ['bob', 'frank', 'grace'], { from: 1, to: 25, every: 4, endAgo: 300 }),
		`UPDATE group_members SET muted = true WHERE group_id = ${gid(
			'muted noise'
		)} AND user_id = ${uid('dev')};`,

		// all caught up
		...group('all caught up', 'alice', ['dev', 'erin'], 2000),
		groupRun('all caught up', ['alice', 'dev', 'erin'], {
			from: 1,
			to: 15,
			every: 50,
			endAgo: 400
		}),
		...['dev', 'alice', 'erin'].map((u) => groupRead('all caught up', u, 'all')),

		// fresh group: dev was just added and never opened it
		...group(F, 'grace', ['dev', 'heidi'], 25),
		groupRun(F, ['grace', 'heidi'], { from: 1, to: 4, every: 5, endAgo: 3 }),

		// renamed since: read up to #20, then events (never unread), then 3 unread messages
		...group(R, 'erin', ['dev', 'alice'], 4000, 'old name'),
		groupRun(R, ['erin', 'alice', 'dev'], { from: 1, to: 20, every: 90, endAgo: 600 }),
		groupRead(R, 'dev', 20),
		`INSERT INTO group_messages (group_id, sender_id, kind, content, created_at) VALUES (${gid(
			R
		)}, ${uid('erin')}, 'renamed', ${q(R)}, ${ago(500)});`,
		`INSERT INTO group_messages (group_id, sender_id, kind, content, created_at) VALUES (${gid(
			R
		)}, ${uid('alice')}, 'left', '', ${ago(450)});`,
		`DELETE FROM group_members WHERE group_id = ${gid(R)} AND user_id = ${uid('alice')};`,
		groupRun(R, ['erin'], { from: 21, to: 23, every: 20, endAgo: 60 }),

		// --- invites ---
		`UPDATE users SET invites = 2 WHERE owner_id IS NULL AND banned_at IS NULL;`,
		`UPDATE users SET invites = 5 WHERE username = 'dev';`,
		`INSERT INTO invites (code, inviter_id, note, created_at, expires_at) VALUES (${q(
			inviteCode('alicecousin2')
		)}, ${uid('alice')}, 'for my cousin', ${ago(60)}, now() + interval '13 days');`,
		// judy came in with one of alice's invites, which is used up
		`INSERT INTO invites (code, inviter_id, note, created_at, expires_at, used_at, used_by) VALUES (${q(
			inviteCode('alicejudy234')
		)}, ${uid('alice')}, 'judy', ${ago(3000)}, ${ago(3000 - 14 * 24 * 60)}, ${ago(2900)}, ${uid(
			'judy'
		)});`,
		`UPDATE users SET invites = 3 WHERE username = 'alice';`,
		`INSERT INTO invites (code, inviter_id, created_at, expires_at, revoked_at) VALUES (${q(
			inviteCode('bobrevoked23')
		)}, ${uid('bob')}, ${ago(500)}, now() + interval '13 days', ${ago(400)});`,
		`INSERT INTO invites (code, inviter_id, created_at, expires_at) VALUES (${q(
			inviteCode('bobexpired23')
		)}, ${uid('bob')}, ${ago(30 * 24 * 60)}, ${ago(16 * 24 * 60)});`,
		`INSERT INTO invites (code, inviter_id, by_staff, note) VALUES (${q(SEED_INVITE)}, ${uid(
			'dev'
		)}, true, 'seed: sign up with this');`,

		'COMMIT;'
	].join('\n');

	// one multi-statement script: unsafe() without parameters uses the simple query protocol
	await db.unsafe(sql);
	return true;
}

const db = postgres(url, { max: 1, onnotice: () => undefined });
try {
	if (await seed(db)) {
		console.log('> seeded: dev + alice..judy, chat and identity test cases (see scripts/seed.ts)');
		if (local) console.log(`> login: dev / ${SEED_PASSWORD}, dev_bot token: ${SEED_BOT_TOKEN}`);
		console.log(`> invite: ${publicUrl ?? 'http://localhost:5173'}/register?invite=${SEED_INVITE}`);
	} else {
		console.log('> seed: the database already has accounts, nothing to do');
	}
} catch (e) {
	console.error(e);
	process.exitCode = 1;
} finally {
	await db.end();
}
