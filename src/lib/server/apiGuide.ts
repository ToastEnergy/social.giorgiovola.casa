import { MAX_BOTS } from './bots.js';
import { MAX_IDENTITIES, MAX_MEMBERS } from './accounts.js';
import { MAX_PASSKEYS } from './passkeys.js';
import { MAX_PERSONAL_TOKENS, SESSION_DAYS, TOKEN_DAYS } from './session.js';
import { LIMITS } from './validation.js';

/**
 * Part 1 of /api.txt: the whole /api/v1 API, written for an LLM (or a person) building a client
 * from scratch. Every v1 endpoint belongs here, in the same change that adds or changes it.
 */
export const v1Guide = (origin: string) => `# API guide (v1)

This is the HTTP API of the social network at ${origin}. Everything the website can do is
available here, so you can build any client on it: a mobile app, a CLI, another web UI, a
script or an AI agent. The official website is itself a client of this API.

This file has two parts:
  Part 1 (this one): the v1 API, under ${origin}/api/v1, for people's accounts, apps and bots.
  Part 2: the older bot API, under ${origin}/api/bot, kept unchanged for existing bots.

Read all of Part 1 before making requests.

## Basics

- Base URL: ${origin}/api/v1
- Bodies are JSON (\`Content-Type: application/json\`), except image uploads, which send the
  raw image bytes with an image Content-Type (see "Uploads").
- IMPORTANT: send a Content-Type header on EVERY POST, PUT, PATCH and DELETE, even when there
  is no body (use \`Content-Type: application/json\`; an empty body counts as \`{}\`). The server
  refuses writes without a Content-Type, and form-encoded or multipart writes from non-browser
  clients, with a plain-text 403 "Cross-site … form submissions are forbidden". This is its
  protection against cross-site requests and can't be turned off.
- Responses are JSON. Dates are ISO 8601 strings in UTC. Ids are positive integers.
  Usernames are 1-${LIMITS.username} characters: a-z, 0-9 and _ (paths accept a leading @ and
  any case).
- 204 No Content means success with no body.
- The API is versioned: within v1 changes are only additive (new endpoints, new fields).
  Ignore fields you don't know. A breaking change would come as /api/v2.

### Errors

Every error is JSON with a 4xx or 5xx status:

  { "error": "A human readable message" }

  400 bad input (the message says what)      401 not signed in, or a bad or expired token
  403 not allowed (muted, banned, not yours, staff only, bots can't do this)
  404 not found (also for things you may not see) 405 wrong method   409 conflict
  410 an uploaded image expired: upload it again   413 too big   429 rate limited
  500 server error

Some errors add fields; they are listed with their endpoint. The only non-JSON errors are
the plain-text 403 described in Basics, which comes before the API is reached.

### Pagination

Every list answers the same shape:

  { "items": [ ... ], "next_cursor": "40" | null }

Pass \`?limit=\` (default 20 unless stated, maximum 100 unless stated) and, for the next
page, \`?cursor=<next_cursor>\` with the same other parameters. \`next_cursor\` is null on the
last page. Cursors are opaque strings: don't build or change them. Lists of posts, people
and notifications are newest first; chat threads are oldest first and their cursor moves
to OLDER messages (see "Direct messages").

### CORS

Every /api/v1 response has \`Access-Control-Allow-Origin: *\`, and preflight (OPTIONS)
requests are answered, so a web app on any origin can call the API with a bearer token.
Cookies are never accepted from other origins.

## Authentication

Send a token in every request:

  Authorization: Bearer <token>

Three kinds of token exist:
  sgu_…  a person's token: from POST /auth/login (or /auth/register, or the passkey login)
         or a personal access token made in the website's settings or with POST /auth/tokens.
  sgc_…  a bot token (see Part 2 for what bots are). Bots can use v1 too: they act as their
         own profile. Account endpoints (sessions, tokens, passkeys, password, identities,
         bots, admin, push) answer 403 for bots. Bots keep the bot API's limits in v1: they
         can't create, rename or add people to groups, remove others from one, upload
         images or attach them to posts and messages (403), post at most 20 a minute and
         send at most 70 messages a minute (these limits are shared with the bot API, not
         added to it), and get 10 profile edits an hour (name, username, bio, website,
         picture); 429 beyond that.
Without a token you are anonymous: public reads work (posts, profiles, timelines), the rest
answers 401. On a members-only instance (GET /instance says "members_only": true) even the
public reads answer 401: only /instance and signing in work anonymously. The website uses a session cookie instead; cookies only work on the website's
own origin and never from other sites.

Only a hash of each token is stored. Tokens are shown once: keep them secret, like a
password. A login token expires after ${TOKEN_DAYS} days without use: each request made with
it pushes "expires_at" back to ${TOKEN_DAYS} days from then (updated every few minutes at
most), so a client in regular use stays signed in. Once it expires, requests answer 401 and
you sign in again. Personal access tokens expire on the date chosen when they were created
(or never) however much they are used. Bot tokens (sgc_) never expire. Any token stops
working when it is revoked (POST /auth/logout, DELETE /auth/sessions/:id), when the
account's password changes (every session but the one that changed it), when an admin
resets the password, or when the account is banned. An event stream (GET /stream) opened
with it is closed at the same moment.

### Profiles and identities

A token belongs to an ACCOUNT (a person with an email and a password). An account can own
identities: extra profiles with their own name, posts, follows, messages and notifications,
but no email or password (at most ${MAX_IDENTITIES} per account). An identity can be shared
with up to ${MAX_MEMBERS} other accounts, which can then act as it too. A token acts as ONE
profile at a time: the account, or one of its identities. Everything you do (post, like,
message, read notifications) is done as that profile. Switch with POST /auth/switch;
GET /me says which profile is in use (\`user\`) and the account behind it (\`account\`).
Moderation (bans, mutes, roles) belongs to the account, whatever profile is in use.

### Muted and banned accounts

A muted account can still read everything, but can't post, reply, quote, regiorgio (repost),
edit posts, upload images or send messages: those answer 403 with the reason. GET /me has
\`muted\` and \`mute_reason\`. A banned account is signed out everywhere and can't sign in.
Bans and mutes are either for good or temporary: a temporary one is lifted by itself within a
minute of its end (signing in works as soon as the ban has ended).

## Objects

User (in lists, posts and messages): { "username", "name", "avatar" }
  "avatar" is a path on ${origin} (prefix it with ${origin}) or null; null means "show the
  generated avatar", which is ${origin}/avatar/<username>.svg (or .png).

Post:
  {
    "id": 123,
    "user": { "id", "username", "name", "avatar", "bot": false, "created_at" },
    "content": "text, may contain @mentions, #hashtags, links and line breaks (\\n)",
    "images": ["/uploads/….webp"],      // paths on ${origin}, at most ${LIMITS.postImages}
    "gif": <Gif> | null,                  // a GIF instead of images, see GIFs
    "created_at": "…", "edited_at": "…" | null,
    "likes": 3, "liked": true,           // liked, regiorged: by you (only when signed in)
    "regiorgs": 1, "regiorged": false,   // a regiorg ("regiorgio") is a repost
    "quotes": 0,                          // posts quoting this one
    "quote": <QuotedPost> | { "deleted": true } | null,   // this post quotes another one
    "linked_post": <QuotedPost> | null,   // first post of ${origin} linked in the text
    "link_preview": <LinkPreview> | null, // first link to another site in the text
    "poll": <Poll> | null,
    "replies_count": 2,
    "reply_to": { "id": 120, "username": "…", "likes": 4 } | null,
    "pinned": false,                      // pinned to its author's profile
    "timeline_pinned": false,             // pinned by staff above the home timeline
    "regiorged_by": { "username", "name", "others": 2 } | null
                                          // only in timelines: who regiorged it (see
                                          // GET /timeline and GET /users/:username/posts)
  }
  A reply "ratios" its parent when it has more likes than the parent (and at least 3).

QuotedPost: { "id", "user": User, "content", "images", "gif": <Gif> | null, "created_at", "is_quote" }
Gif: { "provider": "klipy", "slug", "title", "video": "https://static.klipy.com/….mp4",
       "poster": "https://static.klipy.com/….jpg", "width", "height" }
  A GIF from KLIPY: "video" is a short looping MP4 (play it muted, looped, inline),
  "poster" a still frame, width and height its size in px. Load both straight from KLIPY,
  as they are (see GIFs).
LinkPreview: { "url", "title", "description": "…" | null, "image": "https://…" | null, "site_name" }
  The Open Graph card of a link, fetched by the server. null while it is still being
  fetched (it shows up on later reads), and for pages without a title. "image" is the
  server's own copy of the page's og:image (a small WebP, ${origin}/previews/<hash>.webp,
  public and cacheable forever), never the site's URL, so loading it doesn't contact the
  linked site. null when the page has none or it couldn't be used (cards fetched before
  images were stored also have none until they're refreshed, within 7 days).

Poll:
  { "options": ["Tea", "Coffee"], "votes": [3, 5], "ends_at": "…", "closed": false,
    "voted": 1 | null }                   // voted: index of your choice, null if none

Profile (GET /users/:username):
  { "username", "name", "avatar", "bot", "bio", "website", "created_at",
    "followers": 10, "following": 4,
    "followed": true,       // you follow them
    "followsYou": false,    // they follow you
    "self": false,          // it is the profile you are using
    "followedBy": { "users": [User, … up to 3], "total": 7 },
                            // profiles you follow that follow them ("followers you know")
    "pinned_post_id": 99 | null,
    "blocked": false,       // you blocked them (no direct messages either way)
    "blocks_you": false,    // they blocked you
    "moderation": null | { "banned", "muted", "ban_reason", "mute_reason", "banned_until",
                           "muted_until", "identity" }   // *_until: null when for good
                            // only for staff allowed to act on this account
  }
  Relationship fields are false/empty when anonymous.

FollowEntry (followers / following lists):
  { "username", "name", "avatar", "bio", "followed", "followsYou", "self" }

Notification:
  { "id", "type", "sender": { "id", "username", "name", "avatar" },
    "post": { "id", "content" } | null, "created_at", "read_at": "…" | null }
  Types: "like", "reply", "mention", "quote", "regiorg", "follow" (post is null),
  "ratio" (the sender's reply to your post ratioed it), "ratioed_by_you" (your reply
  ratioed the sender's post). For like, regiorg and ratioed_by_you the post is YOURS;
  for the others it is the sender's.

NotificationGroup (GET /notifications/grouped):
  { "key": "like-123-20261109", "type", "senders": [ { "id", "username", "name",
    "avatar" } ], "count": 5, "unread": 2, "post": { "id", "content" } | null,
    "created_at", "read_at": "…" | null }
  Likes and regiorgs of the same post, and follows, that arrived on the same UTC day are
  one group; every other notification is a group of one ("count": 1). "senders" are the
  latest, at most 3; "count" is how many notifications (people) the group has, "unread"
  how many of them are unread. "created_at" is the newest one's; "read_at" is null while
  any is unread. "key" is opaque and stays the same while the group grows.

Me (GET /me):
  { "user": { "id", "username", "name", "avatar", "bio", "website", "email" (null for
              identities and bots), "bot", "identity", "created_at" },
    "account": { "id", "username" } | null,   // null for bots
    "role": "user" | "mod" | "admin", "muted", "mute_reason",
    "unread": { "notifications": 2, "messages": 5, "reactions": 1 },
    "auth": "token" | "bot" | "cookie",
    "open_reports": 3 | null }   // staff only: reports waiting (null for everyone else)

Message (direct message):
  { "id", "sender": "alice", "recipient": "bob",   // usernames
    "content", "images": ["/dm-uploads/….webp"], "created_at",   // private, see Message images
    "gif": <Gif> | null,                          // a GIF instead of images, see GIFs
    "edited_at": null | when the sender last changed the text,
    "reply_to": { "id", "sender": { "username", "name" }, "content" (cut to 200),
                  "images": 2, "gif": false } | null,   // gif: it is a GIF
    "reactions": [ { "emoji", "username", "name", "avatar" } ],
    "linked_post": <QuotedPost> | null }

GroupMessage (message or event of a group chat):
  { "id", "group_id", "kind": "message" | "created" | "added" | "removed" | "left" |
    "renamed" | "owner", "sender": User, "target": User | null, "content", "images", "gif" (like
    Message), "created_at", "edited_at", "reply_to", "reactions", "linked_post" }
  Anything but "message" is an event line ("Alice added Bob"): never unread, can't be
  replied or reacted to. "target" is who was added or removed; for "created" and
  "renamed" the content is the group's name.

Group: { "id", "name", "owner": "alice" | null, "members": [User], "muted": false,
  "first_unread_id": 123 | null } (the oldest message from someone else you haven't read,
  events aside; null when all is read)
  Members longest standing first. Any member can rename it and add people; only the owner
  removes others. When the owner leaves the longest standing member takes over; the last
  member to leave deletes the group.

Conversation (in GET /conversations):
  direct: { "peer": User, "preview", "mine" (you sent the last message), "created_at",
            "unread": 2, "unread_reactions": 1, "reaction": "❤️" | null, "muted": false }
  group:  { "group": { "id", "name", "members": [first 3 others], "size" }, "preview",
            "event", "sender" (display name) | null, "mine", "created_at", "unread",
            "unread_reactions", "reaction", "muted" }
  Sorted by "created_at", newest first. A reaction counts as activity: when the latest one is
  newer than the last message, "reaction" is its emoji, "created_at" its time, "mine" whether
  you made it and "preview" its whole line ("Alice reacted ❤️ to “hi”"; groups also get
  "event": true and "sender": who reacted). In groups only reactions you made or that are to
  your messages count, not others reacting among themselves. Otherwise "reaction" is null.
  "unread_reactions": reactions others made to your messages since you last read the chat.
  They mark the chat unread but never move first_unread_id: open the chat as usual.

## Endpoints

Signed in means any token (or the website's cookie). "Account" means a person's token (not
a bot). Rate limits are per profile per minute unless stated.

### Instance

GET /instance                                                  public
  { "api_version": 1, "version": "<build>", "motd": "message of the day",
    "registration_open": true, "members_only": false, "limits": { "postContent": ${LIMITS.postContent},
    "messageContent": ${LIMITS.messageContent}, "name": ${LIMITS.name}, "bio": ${LIMITS.bio},
    "username": ${LIMITS.username}, "postImages": ${LIMITS.postImages}, "messageImages": ${LIMITS.messageImages}, "imageBytes": ${LIMITS.imageBytes},
    "pollOptionsMin": ${LIMITS.pollOptionsMin}, "pollOptionsMax": ${LIMITS.pollOptionsMax},
    "pollOption": ${LIMITS.pollOption}, "pollMinutesMin": ${LIMITS.pollMinutesMin},
    "pollMinutesMax": ${LIMITS.pollMinutesMax}, "pollMinutesDefault": ${LIMITS.pollMinutesDefault},
    "groupName": ${LIMITS.groupName}, "groupMembers": ${LIMITS.groupMembers}, … },
    "gifs": { "provider": "klipy", "app_key": "…", "content_filter": "medium" } | null }
  "gifs" is null when GIFs are off on this instance; otherwise what you need to search KLIPY
  yourself (see GIFs).
  "members_only": true when the instance is closed to signed-out readers. Then every
  endpoint except GET /instance and the sign-in ones below (/auth/login, /auth/register,
  /auth/passkeys/options, /auth/passkeys/login, /auth/logout) answers 401 { "error": "This
  instance is members only: sign in first" } without a token or the session cookie, and so
  do images, avatars and social cards outside the API. "motd" is "" for signed-out callers
  there. Bot tokens count as signed in.

### Signing in

POST /auth/login                                               public
  Body: { "username": "alice" (or the email), "password": "…",
          "client_name": "My app" (optional, shown in the session list, max 64) }
  200: { "session": "token", "token": "sgu_…", "token_type": "Bearer",
         "expires_at": "…", "me": <Me> }
  Errors: 400 missing fields, 401 "Wrong username or password." (the same for unknown
  users), 403 banned (with the reason), 429 after 10 failures for one account or 30 for
  one IP in 15 minutes, or after 30 successful sign-ins (login, passkey or register) of
  one account in an hour: reuse your token instead of signing in again.
  (The website sends "session": "cookie" to get a cookie instead of a token.)

POST /auth/register                                            public
  Body: { "signup_password": "the instance's invite password", "email", "name",
          "username", "password" (${LIMITS.passwordMin}-${LIMITS.passwordMax} characters), "client_name"? }
  201: like /auth/login. 403 "Registration is closed." when GET /instance says
  registration_open is false, or a wrong signup password (rate limited per IP); 400 with
  every validation problem in one message ("Email already in use. Username already in use.").

POST /auth/passkeys/options                                    public
  Starts a passkey (WebAuthn) sign-in. 200: the WebAuthn PublicKeyCredentialRequestOptions
  JSON plus "challenge_id". Pass the options to the platform's WebAuthn API (in a browser:
  @simplewebauthn/browser startAuthentication). Passkeys are bound to the hostname of
  ${origin}, so only clients allowed to use passkeys for that domain can do this.
POST /auth/passkeys/login                                      public
  Body: { "challenge_id": "…", "response": <the assertion JSON>, "client_name"? }
  200: like /auth/login. 400 when it can't be verified or the challenge expired (5
  minutes, single use); 400 with "unknown": true when the passkey was deleted here.

POST /auth/logout                                              signed in
  Revokes the token used. 204. (Website: { "all": true } signs out every account.)

GET /auth/sessions                                             account
  Every place the account is signed in: { "items": [ { "id", "kind": "cookie" (browser) |
  "token" (an app's login) | "personal" (personal access token), "name", "user_agent",
  "created_at", "expires_at" | null, "last_used_at" | null, "current": true } ] }
DELETE /auth/sessions/:id                                      account
  Revokes one: it is signed out right away. 204, 404 when it isn't yours.
POST /auth/tokens                                              account
  Creates a personal access token: { "name": "my script" (1-64), "current_password"
  (required: the account's password, asked again so a stolen token can't mint lasting
  access), "expires_in_days": 1-3650 | null (never; default 90) }. At most
  ${MAX_PERSONAL_TOKENS} per account, 10 a minute. 201: { "id", "name", "token": "sgu_…",
  "token_type": "Bearer", "expires_at" }. The token is never shown again. 400 when
  current_password is missing, 403 when it is wrong (10 tries per 15 minutes).

GET /auth/accounts                                             account
  The account (website: every account signed in on the browser; a token: its own account)
  with its identities:
  { "items": [ { "id", "username", "name", "avatar", "unread", "unreadMessages", "unreadReactions",
  "active", "sharedBy": null, "identities": [ same fields, "sharedBy": "owner" | null ] } ] }
POST /auth/switch                                              account
  { "username": "the account, or one of its identities, or one shared with it" }
  Every later request with this token acts as that profile, and its open /stream is closed
  (reconnect). 200: <Me>. 403 when you can't
  use that profile, 404 unknown username. 30 switches a minute.

### You

GET /me                                                        signed in
  <Me>.
PATCH /me                                                      signed in
  Edits the profile in use. Any of: "name" (1-${LIMITS.name}), "username" (must be free;
  the profile URL changes), "bio" (up to ${LIMITS.bio}, "" clears), "website" (http(s);
  https:// is added; "" clears), "email" (accounts only; a different email also needs
  "current_password", sending the current one unchanged doesn't). Fields left out are
  kept. 200: <Me>. 400 when current_password is missing for a new email, 403 when it is
  wrong (10 tries per 15 minutes). 30 edits an hour per profile (bots: 10).
PUT /me/avatar                                                 signed in
  The raw image as the body (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO or SVG, at most 10 MB)
  with its Content-Type, e.g. image/png. Cropped square, re-encoded. 200: { "id", "name",
  "username", "avatar", "bio", "website" }. 10 changes an hour.
DELETE /me/avatar                                              signed in
  Back to the generated avatar. 200: same as PUT.
PUT /me/password                                               account
  { "current_password", "password" }. Signs out every other session and token. 204.
  403 when the current password is wrong (10 tries per 15 minutes).
GET /me/following                                              signed in
  { "items": ["alice", "bob"] }: usernames of everyone the profile follows.

GET /me/passkeys                                               account
  { "items": [ { "id", "name", "backed_up", "created_at", "last_used_at" } ],
    "max": ${MAX_PASSKEYS}, "rp_id", "user_handle" }
POST /me/passkeys/options                                      account
  { "current_password" }. Starts registering a passkey: WebAuthn creation options plus
  "challenge_id". 400 when current_password is missing, 403 when it is wrong (10 tries per
  15 minutes).
POST /me/passkeys                                              account
  { "challenge_id", "name": "My phone" (optional, max 64), "response": <attestation JSON> }
  201: { "id", "name" }.
PATCH /me/passkeys/:id   { "name" } → { "id", "name" }         account
DELETE /me/passkeys/:id  → 204 (the password always keeps working)   account

GET /me/identities                                             account
  { "max_identities", "max_members",
    "owned": [ { "username", "name", "avatar", "created_at", "members": [User] } ],
    "shared_with_me": [ { "username", "name", "avatar", "created_at", "owner" } ] }
POST /me/identities   { "name", "username" } → 201 { "id", "name", "username", "avatar" }
  Then POST /auth/switch to use it.
DELETE /me/identities/:username                                account (owner)
  Deletes it with its posts. 204. Can't be undone.
POST /me/identities/:username/members   { "username": "an account" }   account (owner)
  Shares it. 201: User. 20 attempts a minute.
DELETE /me/identities/:username/members/:member                account (owner) → 204
POST /me/identities/:username/leave                            account → 204
  Gives back an identity someone shared with you.

GET /me/bots                                                   account
  { "items": [ { "id", "name", "username", "avatar", "bio", "website", "created_at",
    "last_used_at" } ], "max": ${MAX_BOTS} }
POST /me/bots   { "name", "username" } → 201 { "username", "token": "sgc_…" } (shown once)
PATCH /me/bots/:username   any of name, username, bio, website → the bot's profile
PUT /me/bots/:username/avatar  (raw image body) / DELETE /me/bots/:username/avatar
POST /me/bots/:username/token  → { "username", "token" }: a new token, the old one stops
DELETE /me/bots/:username      → 204, deletes the bot and its posts
  All bot management: 10 actions a minute.

### Push notifications (web push)

GET /push → { "publicKey": "VAPID key" }                       account
POST /push   { "endpoint", "keys": { "p256dh", "auth" } }  (PushSubscription.toJSON())
  The subscription belongs to the token (or browser session) used: revoking it stops the
  pushes. Only endpoints of the real push services are accepted. 204; 400 invalid.
DELETE /push   { "endpoint" } → 204
  (Also available at /api/push for older website versions.)

### Timeline and posts

GET /timeline?feed=all|following                               public / signed in
  "all" (default): every top-level post, newest first, with "regiorged_by" set to its
  latest regiorger ("others": how many more regiorged it) when anyone regiorged it.
  "following" (signed in): posts and regiorgs by the profiles you follow and your own, each
  post once with "regiorged_by" when a regiorg put it there. Paginated. Posts pinned to the timeline are left out:
GET /timeline/pinned                                           public
  The posts staff pinned above the timeline (at most 3), as a page with next_cursor null.

POST /posts                                                    signed in, not muted
  { "content": "text (max ${LIMITS.postContent})",
    "uploads": ["id from POST /uploads", …]   (optional, at most ${LIMITS.postImages}),
    "gif": <Gif> | null,                        (optional, instead of uploads, see GIFs)
    "reply_to": 120 | null,                     (a reply)
    "quote_of": 118 | null,                     (a quote regiorg; can't also reply)
    "poll": { "options": ["a", "b"] (${LIMITS.pollOptionsMin}-${LIMITS.pollOptionsMax}, distinct, max ${LIMITS.pollOption} chars),
              "duration_minutes": ${LIMITS.pollMinutesMin}-${LIMITS.pollMinutesMax} (default ${LIMITS.pollMinutesDefault}) } | null }
  Content may be empty when there are images or a GIF; a poll needs text. Line breaks (\\n; \\r\\n is
  turned into \\n) are kept and shown; the ends are trimmed and more than one blank line in a
  row becomes one. 201: <Post>.
  410 when an upload expired: upload it again. 30 posts a minute.
GET /posts/:id                                                 public
PATCH /posts/:id   { "content" }                                author, not muted
  Edits the text (images and poll stay), with the same line break rules as POST /posts.
  Sets "edited_at", re-reads hashtags. 200: <Post>.
  400 when the text would be empty on a post without images or GIF, or on a poll (its question).
DELETE /posts/:id                                              author (or staff)
  Deletes it with its replies. 204. When staff delete someone else's post, its open reports
  are resolved and the deletion (with a copy of the text) goes in the moderation log.
GET /posts/:id/replies          replies, ratioing ones first then oldest first; limit up to 200 (default 50)
GET /posts/:id/ancestors        public. The thread above a reply: the post it replies to, the one
  that one replies to, and so on, as <Post>s ordered ROOT FIRST (the direct parent is the last
  item). { "items": [<Post>…], "next_cursor": null }: always one page, there is no cursor.
  ?limit= how many of the nearest ancestors, 1-50 (default 20). The chain is cut from the top when
  longer: if the FIRST item still has a non-null "reply_to", there are more posts above it (ask
  again for that item's id to keep going up). A post that is not a reply gives "items": [].
  Deleting a post deletes its replies, so the chain has no gaps. "liked"/"regiorged" are filled
  for the caller like everywhere else. 404 when the post doesn't exist; 400 for a bad limit.
GET /posts/:id/likes            Users who liked, latest first; limit up to 200 (default 50)
GET /posts/:id/regiorgs         Users who regiorged, latest first; same limits
GET /posts/:id/quotes           { "id", "content", "username", "name", "avatar" } quotes; same limits
PUT /posts/:id/like / DELETE    signed in → { "liked", "likes" }   60 a minute, idempotent
PUT /posts/:id/regiorg / DELETE signed in (PUT not muted) → { "regiorged", "regiorgs" }  30 a minute
PUT /posts/:id/vote   { "option": index }  → { "voted", "votes": [..] }  30 a minute;
  changeable until the poll ends; 400 when it ended.
PUT /posts/:id/pin / DELETE     your own top-level post on your profile → { "pinned" }
PUT /posts/:id/timeline-pin / DELETE   staff only → { "pinned" }; 409 when 3 are pinned
POST /posts/:id/seen            marks your mention notification for it read → 204
  The counts in responses are absolute: set them, don't add to them.

### Users

GET /users/:username                  <Profile>                        public
GET /users/:username/card             the hover card: Profile without created_at,
                                      pinned_post_id, blocks and moderation
GET /users/:username/posts?tab=posts|replies|regiorgs   public, paginated Posts. "posts"
  (default): its own top-level posts, newest first, the pinned post left out. "replies": its
  replies. "regiorgs": the posts it regiorged, latest regiorg first, each with "regiorged_by"
  set to the profile. 400 for another tab, 404 unknown user.
GET /users/:username/pinned           { "post": <Post> | null }
GET /users/:username/followers        paginated FollowEntry, newest follow first
GET /users/:username/following        paginated FollowEntry
GET /users/:username/followers/known  signed in: its followers that you follow too
PUT /users/:username/follow / DELETE  signed in → { "followers", "following", "followed" }
  30 a minute, idempotent.
PUT /users/:username/block / DELETE   signed in → { "blocked", "blocks_you" }
  Blocking stops direct messages both ways. 30 a minute.

### Search and hashtags

GET /search?q=&limit=                 signed in
  { "query", "users": [User], "hashtags": [ { "tag", "posts": 12 } ] }. limit per kind,
  default 5, at most 20. "#tea" searches only hashtags, "@al" only users; an empty q lists
  the trending hashtags of the last 7 days.
GET /search/users?q=&limit=           signed in
  Profiles whose username or name starts with q (for @mention pickers), the newest when q
  is empty. Default 6, at most 20. A page with next_cursor null.
GET /hashtags/:tag                    public → { "tag": "tea", "posts": 12 } (normalized)
GET /hashtags/:tag/posts              public, paginated Posts (replies included)

### Notifications

GET /notifications                    signed in, paginated (default 50, at most 200)
  Every notification on its own (Notification objects).
GET /notifications/grouped            signed in, paginated (default 50, at most 200)
  NotificationGroups, newest first: what the website shows. A group that gets a new
  notification moves back to the top, so a later page can repeat a group already seen:
  keep the first copy (match by "key").
POST /notifications/groups/:key/read  marks every notification of the group read → 204;
  404 when you have no such group.
GET /notifications/unread             signed in → { "notifications": 2, "messages": 5,
  "reactions": 1 }
  (messages: unread direct and group messages; reactions: unread reactions others made to
  your messages; muted chats left out of both. The website's messages badge shows the sum.)
POST /notifications/read              marks all read → 204
POST /notifications/:id/read          marks one read → 204

### Direct messages

GET /conversations                    signed in → { "direct": [..], "groups": [..] }
GET /share-targets                    signed in → { "recent": [ { "kind": "user", "peer":
  User } | { "kind": "group", "group": {...} } ], "groups": [...] } (to share a post)
GET /conversations/:username          signed in → { "peer": User, "block": { "me": you
  blocked them, "peer": they blocked you }, "muted": false, "first_unread_id": 123 | null }
  first_unread_id is the oldest message they sent you that you haven't read (null when all is
  read): open the conversation there. Page back with ?cursor until it is loaded.
GET /conversations/:username/messages signed in
  30 messages, OLDEST FIRST: the latest ones. For older history pass
  ?cursor=<next_cursor>; next_cursor is null when there is nothing older. Nothing is
  marked read by reading.
POST /conversations/:username/messages   signed in, not muted
  { "content" (max ${LIMITS.messageContent}), "uploads": [ids] (max ${LIMITS.messageImages}), "gif": <Gif> | null,
    "reply_to": message id | null }
  Content may be empty when there are images or a GIF; a GIF can't come with images (400).
  201: <Message>. 403 when either side blocked the other. 70 messages a minute in all
  (direct and group), 5 a minute with images.
PATCH /conversations/:username/messages/:id   your own message, not muted
  { "content" (max ${LIMITS.messageContent}) } → <Message> with the new text and "edited_at" set.
  Only the text changes (images, gif and reply_to stay); "" is accepted only when the message
  has images or a GIF. Allowed for 60 minutes after sending: later → 403. 404 when it isn't yours or isn't in
  the conversation with :username; 403 when either side blocked the other. Sending the same
  text changes nothing. 30 edits a minute (direct and group). Both sides get message_edited.
DELETE /conversations/:username/messages/:id   your own message → 204 (for both sides); 404 when it
  isn't yours or isn't in the conversation with :username
PUT /conversations/:username/messages/:id/reaction   { "emoji": "👍" } → { "reactions" }
DELETE /conversations/:username/messages/:id/reaction → { "reactions" }
  One reaction per profile per message; a new one replaces it (choosing the same emoji again
  changes nothing). 60 a minute. A reaction to their message is unread for them until they
  read the conversation (see Conversation); reacting to your own message never is. No push
  notification is sent for reactions.
POST /conversations/:username/read    marks what they sent you, and their reactions to your
  messages, read → 204
PUT /conversations/:username/mute / DELETE   → { "muted" }: no push, not in the badge
POST /conversations/:username/typing  → 204: shows "typing…" to them for a few seconds;
  send every 3-4 seconds while the user types. 40 a minute.

### Group chats

GET /groups                           signed in → page of group conversations
POST /groups   { "name" (1-${LIMITS.groupName}), "members": ["alice", "bob"] }   not muted
  201: <Group>. Up to ${LIMITS.groupMembers} members with you. You can't add people who blocked
  you or whom you blocked.
GET /groups/:id                       member → <Group>; 404 when you aren't a member
PATCH /groups/:id   { "name" }        member, not muted → <Group>
GET /groups/:id/messages              member: like a direct conversation, GroupMessages
POST /groups/:id/messages             member, not muted: same body as direct → 201 <GroupMessage>
PATCH /groups/:id/messages/:messageId            your own message, not muted: like direct
  messages, { "content" } → <GroupMessage>, 60 minutes after sending at most. Events (kind
  other than "message") can't be edited (404). Members get group_message_edited.
DELETE /groups/:id/messages/:messageId           your own message → 204
PUT /groups/:id/messages/:messageId/reaction / DELETE   like direct messages
POST /groups/:id/read                 → 204 (messages, and reactions to your messages)
PUT /groups/:id/mute / DELETE         → { "muted" }
POST /groups/:id/members   { "usernames": ["carla"] }   member → <Group>
DELETE /groups/:id/members/:username  the owner removes someone, or anyone removes
  themself (leaves) → 204
POST /groups/:id/leave                → 204
POST /groups/:id/typing               → 204
  Managing groups (create, rename, add, remove): limited per minute.

### Message images

Images of direct and group messages are private to their conversation. "images" is still a
list of paths on ${origin}; new message images are /dm-uploads/<uuid>.webp, messages sent
before images became private keep /uploads/<uuid>.webp paths (the same files, protected the
same way). Post images (/uploads/ paths in a Post) stay public.

GET /dm-uploads/<uuid>.webp            (not under /api/v1: prefix the path with ${origin})
  Needs the same sign-in as reading the conversation: the website's cookie, or
  \`Authorization: Bearer sgu_…\` / \`Bearer sgc_…\` (a bot token). Answers the image when a
  profile you are signed in as (the account or any identity it can act as, or the bot) is the
  sender or recipient of the direct message, or a current member of the group of the group
  message. Leaving or being removed from a group ends access to its images.
  200: the image (Content-Type image/webp), \`Cache-Control: private, max-age=3600\`: don't
  share a cache of these between users.
  404: missing, deleted, OR not yours / not signed in: the same answer, so a path doesn't
  tell whether it exists.
  401 (\`{ "error": … }\`, \`Cache-Control: private, no-store\`) when the file is a message
  image and the bearer token is invalid, revoked or expired, as the API answers (a banned or
  rate limited bot gets the API's 403 / 429). Sign in again.
GET /uploads/<uuid>.webp               the same rules for a message image sent before; a post
  image is public: 200 with \`Cache-Control: public, max-age=31536000, immutable\`, whatever
  the Authorization header says (an invalid token is ignored there, never a 401).
  Limitation: anyone who could see an image can keep a copy. Privacy keeps out people who
  were never in the conversation, or no longer are.

### Uploads

POST /uploads                         signed in, not muted
  One image, as the raw request body with its Content-Type (image/png, image/jpeg, …),
  at most 10 MB. It is compressed right away and kept for you for a day: pass its id in
  "uploads" when posting or messaging. 201: { "id": "uuid" }. 30 a minute per account (its
  identities share them). Images above 100 million pixels (all the frames of an animation
  together) are refused with a 400.
  (Browsers on the website send multipart with an "image" field instead.)
DELETE /uploads/:id                   an upload you no longer need → 204

### GIFs

GIFs come from KLIPY (https://docs.klipy.com). KLIPY's terms require searches and GIF loads to
come from the user's own device, so this server has no search endpoint and never downloads
GIFs: your client searches KLIPY directly and sends the chosen GIF's URLs in "gif" when
posting or messaging.

1. GET /instance. When "gifs" is null, GIFs are off: hide your GIF button (a "gif" is then
   refused with 403). Otherwise use its "app_key" and "content_filter".
2. Search from the user's device (not from a server of yours):
     GET https://api.klipy.com/api/v1/<app_key>/gifs/search?q=cats&page=1&per_page=24
         &content_filter=<content_filter>&format_filter=webp,jpg,mp4
   or, with no query, …/gifs/trending?page=1&per_page=24&… (the same parameters).
   Answer: { "result": true, "data": { "data": [Item, …], "current_page", "per_page",
   "has_next" } }. Item: { "id", "slug", "title", "type": "gif", "file": { "hd" | "md" |
   "sm" | "xs": { "mp4" | "webp" | "jpg": { "url", "width", "height", "size" } } } }.
   KLIPY's rules for the picker: the search field's placeholder must be "Search KLIPY", and
   results are shown in the order received, in a section of their own. Small previews:
   file.sm.webp.
3. Attach the chosen item as:
     "gif": { "provider": "klipy", "slug": item.slug, "title": item.title,
              "video": item.file.md.mp4.url, "poster": item.file.md.jpg.url,
              "width": item.file.md.mp4.width, "height": item.file.md.mp4.height }
   Copy the URLs exactly as KLIPY gave them (don't rewrite their query strings).
4. Optionally tell KLIPY it was sent (it ranks results by it), from the device:
     POST https://api.klipy.com/api/v1/<app_key>/gifs/share/<slug>   { "q": "the search" }

The server checks "gif" and refuses it with 400 unless: it is an object; "slug" is 1-100 of
A-Z a-z 0-9 _ -; "video" and "poster" are https URLs (at most 500 characters) on
static.klipy.com, static1.klipy.com or static2.klipy.com; "width" and "height" are whole
numbers from 1 to 4096; "title", if given, is a string (cut to 200). "provider" may be
left out. A post or message has either a GIF or images: both → 400 "A post can have a GIF or
images, not both" / "A message can have a GIF or images, not both". Bots may attach GIFs
(JSON). Multipart bodies (browsers) send "gif" as a JSON string field. A GIF can't be added,
changed or removed by an edit. No extra rate limit: GIF posts and messages count like
text ones.

Showing GIFs: play "video" muted and looped (\`<video autoplay muted loop playsinline
poster=…>\`), sized width × height. KLIPY may remove a GIF: then its URLs stop working, so
show a placeholder when the video fails to load.

### Reports

POST /reports                                                  signed in, not bots
  Reports a post or a profile to the staff. Only staff see reports; the reported person isn't
  told who reported.
  Body: { "post_id": 123 } OR { "username": "bob" } (exactly one), plus
        "category": "spam" | "harassment" | "hate" | "violence" | "sexual" | "self_harm" |
                    "impersonation" | "other",
        "details": "what is wrong" (optional, max 1000)
  201: { "id", "message" }. Reporting the same post (or profile) again while your first
  report is still open answers that report's id instead of a new one.
  Errors: 400 bad category, both or neither of post_id/username, details too long, or your
  own post or profile (any of your account's profiles); 403 bots; 404 unknown post or user;
  429 after 10 reports an hour per account.

### Moderation (staff)

Mods handle reports, ban, mute and delete posts of regular users; admins can also manage
mods, reset passwords and set the message of the day. Actions target the ACCOUNT behind a
username (an identity or bot leads to its owner). You can only act on accounts ranked below
you (and never yourself). 60 actions a minute per staff member (429 above that). Every action
is written to the moderation log. All of these answer 403 for anyone who isn't staff, and
for bots.

GET /admin/overview   staff
  { "open_reports", "accounts", "new_accounts" (last 7 days), "banned", "muted", "staff",
    "posts_today" (last 24 hours), "actions_week" (staff actions, last 7 days) }

GET /admin/reports?status=open|resolved|dismissed|all&username=   staff, paginated (default 25)
  Newest first; status defaults to open. ?username= keeps the reports against that account
  and its identities. Items:
  { "id", "kind": "post" | "profile", "category", "details", "status",
    "created_at", "resolved_at", "resolved_by": "username" | null, "resolution_note",
    "reporter": User, "target": User,          // target: the reported profile
    "post": null | { "id": 123 | null, "content", "images": ["/uploads/…"],
                     "deleted": false,          // true: content is the copy taken when reported
                     "edited": false },         // changed since it was reported
    "account": { "username", "role", "banned", "muted" },   // the account behind target
    "related_open": 2,      // other open reports of the same post (or profile)
    "can_moderate": true }  // you may act on that account
PATCH /admin/reports/:id   staff
  Body: { "status": "resolved" | "dismissed" | "open", "note"? (max 500, for the staff),
          "related"?: true }   // also close the other open reports of the same post/profile
  200: { "updated": 2, "message" }. 400 bad status, 404 unknown report.

GET /admin/users?q=&filter=all|reported|banned|muted|staff   staff, paginated (default 25)
  Accounts, newest first ("reported": accounts with open reports, most reported first). ?q=
  searches usernames and names, also of identities (which find their owner). Items:
  { "username", "name", "avatar", "role", "banned_at", "ban_reason", "banned_until",
    "muted_at", "mute_reason", "muted_until", "created_at",
    "open_reports",         // open reports against the account and its identities
    "identities": [ { "username", "name", "avatar", "bot", "members": ["usernames"] } ],
    "shared_with": [ { "username", "name", "avatar", "owner_username" } ],
    "self", "can_moderate", "can_manage" }   // can_manage: admin actions allowed
  *_until is null when the ban or mute is for good (or there is none).
GET /admin/users/:username   staff
  The account behind :username: the fields above (without open_reports), plus
  "email" (admins only, null for mods), "via" (the identity you asked for, or null),
  "stats": { "posts", "followers", "open_reports", "reports" (all reports against it),
             "reports_made", "log_entries" }. 404 unknown user.
PUT /admin/users/:username/ban   staff
  Body: { "reason"? (max 200, shown to them), "duration"? }. duration: seconds, a whole
  number from 60 to 31536000 (a year); null or missing bans for good. Signs the account out
  everywhere and ends its bots' streams. On an account that is already banned it replaces the
  reason and the end (counted from now). 200: { "message", "expires_at": "…" | null }.
DELETE /admin/users/:username/ban → { "message" }                            staff
PUT /admin/users/:username/mute   { "reason"?, "duration"? } like ban → { "message", "expires_at" }   staff
DELETE /admin/users/:username/mute → { "message" }                           staff
PUT /admin/users/:username/role   { "role": "mod" | "user" } → { "message" }   admin
PUT /admin/users/:username/password   { "password" } → { "message" }  admin; signs them out
POST /admin/users/:username/notes   { "note" (max 1000) } → 201 { "message" }   staff
  A note for the other staff, kept in the moderation log of the account. Works on any
  account, also ones you can't act on.

GET /admin/log?username=&actor=&action=   staff, paginated (default 30), newest first
  ?username= one account's entries (an identity finds its owner), ?actor= one staff
  member's, ?action= one of: ban, unban, mute, unmute, role, password, delete_post,
  delete_group, note, report_resolved, report_dismissed, report_reopened (400 for another).
  Items:
  { "id", "action", "actor": "username" | null, "target": "username" | null,
    "target_profile": User | null,   // null once the account is gone
    "reason",                         // ban/mute reason, the note, the report note
    "expires_at",                     // end of a temporary ban or mute
    "details": null | {…},            // delete_post: { "post_id", "author", "content",
                                      //   "images", "reply", "reports" }; role: { "from",
                                      //   "to" }; report_*: { "reports": [ids], "kind",
                                      //   "post_id" }; delete_group: { "group_id", "name",
                                      //   "owner", "members": [usernames], "messages" }
                                      //   (target null); expired unban/unmute: { "expired": true }
    "created_at", "system": false }   // system: no staff member (a ban that ran out)

GET /admin/motd → { "motd", "custom", "default", "max" }                     admin
PUT /admin/motd   { "motd": "one line" ("" resets) } → { "motd", "message" }   admin

GET /admin/groups/:id   admin
  Any group chat by its id (the number in /messages/groups/:id), whether you are in it or
  not: { "id", "name", "owner": "username" | null, "members": [{ "username", "name",
  "avatar" }] (oldest member first), "messages" (count of written messages, not events),
  "created_at" }. 404 { "error" } for an unknown group, 403 for non-admins.
DELETE /admin/groups/:id   admin
  Body (optional): { "reason"? (max 200, kept in the moderation log) }. Deletes the group for
  everyone: its members, messages, reactions and uploaded images. Members get a
  "group_updated" { "id" } event; loading the group then answers 404, so drop it from view.
  Logged as action "delete_group". 200 { "message" }. 404 unknown group, 403 non-admins,
  429 too many moderation actions (slow down).

### Realtime (server-sent events)

GET /stream                           public or signed in
  An event stream (text/event-stream). Send the token in the Authorization header (use an
  SSE client that supports headers; the browser's EventSource can't, which is why the
  website uses its cookie). The stream ends when the token or session it was opened with is
  revoked; reconnecting then answers only public events, or 401 for the revoked bearer token.
  Open streams are capped: 30 at once per account (all its tokens and browser tabs
  together), 10 per bot (with its /api/bot/stream and /stream/bot streams), 30 per IP
  address for anonymous ones. One more answers 429 { "error" } with Retry-After: 60; close
  streams you no longer read instead of opening new ones.
  Staying connected:
    - The server sends a "ping" event every 8 seconds to every /stream connection. If
      nothing at all (no event, ping included) arrives for 20 seconds, the connection is
      dead even if your client still thinks it's open (a network change, a phone that slept,
      a NAT that dropped it): close it and open a new one.
    - When it drops, reconnect. The server sends "retry: 3000" (wait 3 s); if the reconnect
      itself fails (an HTTP error while the server restarts), back off: 1 s, 2 s, 4 s, ... up
      to 30 s, and start over from 1 s after a success.
    - Events sent while you were disconnected are not replayed: there are no event ids and
      Last-Event-ID is ignored. After every reconnect, reload what you show from the normal
      endpoints (the first page of the feed, the open post and its replies, the open
      conversation, the notifications). The unread counts ("notifications" and
      "messages_unread") are sent again on connect by themselves.
  Everyone gets:
    ping            {}   the heartbeat above, every 8 seconds: ignore it apart from noting
                         that the stream is alive
    post            <Post> (as an anonymous viewer: no liked/regiorged)
    post_edited     <Post>
    post_deleted    { "id" }
    counts          { "id", "likes"? , "replies_count"?, "regiorgs"?, "quotes"? } absolute
    regiorg         <Post> with "regiorged_by": { "username", "name" }
    poll            { "id": post id, "votes": [..] }
  Signed in, also (for the profile in use):
    notifications   { "count" }   unread notifications, sent on connect and on change
    messages_unread { "count", "reactions" }   unread messages, and unread reactions to your
                    messages, sent on connect and on change
    message         <Message> sent or received
    message_deleted { "id" }
    message_edited  <Message> with its new text
    message_reactions        { "id", "reactions" }
    group_message            <GroupMessage> (events included)
    group_message_deleted    { "group_id", "id" }
    group_message_edited     <GroupMessage> with its new text
    group_message_reactions  { "group_id", "id", "reactions" }
    group_updated   { "id" }   renamed or members changed: GET /groups/:id again (404 =
                               you were removed)
    typing          { "group_id": id | null, "user": { "username", "name" } }
  The stream follows the profile in use when it opened: reconnect after POST /auth/switch.
  It is closed by the server when that happens, when the session is revoked, and when an
  identity it acts as stops being shared with the account.

GET /stream/bot                       bot tokens only
  The bot stream, same as /api/bot/stream (see Part 2): ready, mention, post, message,
  group_message. At most 10 streams per bot at once (this, /api/bot/stream and /stream
  together), 429 beyond that.

## Example session (curl)

ORIGIN=${origin}
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \\
  -d '{"username":"alice","password":"…","client_name":"curl"}' \\
  $ORIGIN/api/v1/auth/login | jq -r .token)
A="Authorization: Bearer $TOKEN"

curl -H "$A" $ORIGIN/api/v1/me
curl -H "$A" "$ORIGIN/api/v1/timeline?feed=following&limit=10"
NEXT=$(curl -s -H "$A" "$ORIGIN/api/v1/timeline?limit=10" | jq -r .next_cursor)
curl -H "$A" "$ORIGIN/api/v1/timeline?limit=10&cursor=$NEXT"

# post with an image: upload it first, then attach its id
ID=$(curl -s -X POST -H "$A" -H 'Content-Type: image/png' --data-binary @photo.png \\
  $ORIGIN/api/v1/uploads | jq -r .id)
curl -X POST -H "$A" -H 'Content-Type: application/json' \\
  -d "{\\"content\\":\\"hello #tea\\",\\"uploads\\":[\\"$ID\\"]}" $ORIGIN/api/v1/posts

curl -X POST -H "$A" -H 'Content-Type: application/json' \\
  -d '{"content":"agreed","reply_to":123}' $ORIGIN/api/v1/posts
curl -X PUT -H "$A" -H 'Content-Type: application/json' $ORIGIN/api/v1/posts/123/like
curl -X PUT -H "$A" -H 'Content-Type: application/json' $ORIGIN/api/v1/users/bob/follow
curl -H "$A" "$ORIGIN/api/v1/notifications?limit=20"
curl -X POST -H "$A" -H 'Content-Type: application/json' \\
  -d '{"content":"hi bob"}' $ORIGIN/api/v1/conversations/bob/messages
curl -H "$A" "$ORIGIN/api/v1/search?q=tea"
curl -N -H "$A" $ORIGIN/api/v1/stream
curl -X POST -H "$A" -H 'Content-Type: application/json' $ORIGIN/api/v1/auth/logout

Browser sessions last until ${SESSION_DAYS} days without use; tokens as described in Authentication.
`;
