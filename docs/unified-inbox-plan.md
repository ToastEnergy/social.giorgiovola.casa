# Notifications rework: read what you've seen, one inbox, act as any profile

Status: plan with decisions taken, nothing built yet (2026-11-20). Follows the notifications overhaul (#180–#196),
which moved notifications into `src/lib/server/notify.ts`, grouped them (`inbox.group_key`) and
added the push outbox.

## The problems

1. **Notifications about things you've already seen.** Only `mention` rows are marked read
   when their post is on screen (`Post.svelte` → `POST /posts/:id/seen` → `markPostSeen`).
   A reply you read in the thread, a quote you scrolled past in the feed, the likes you looked
   at on your post's page or in its people list, the followers you looked through: all stay
   unread, and their pushes stay in the phone's tray.
2. **One inbox per profile.** Notifications, the unread count and realtime belong to the
   profile in use (`inbox.user_id`, `pushUnread` sends to streams of that profile only). To check
   an identity you switch to it, which reloads the app; the switcher only shows a dot and counts.
3. **Switching is global and heavy.** `POST /auth/switch` changes `sessions.acting_id` and
   `switchTo` reloads the page (the stream, push and every page belong to the profile). To reply
   to a notification of an identity you switch, reply, then switch back. The mobile app does the
   same on a push tap (`actAs` in `mobile/src/lib/push.tsx`).

## Goals

- A notification is read once you've seen what it is about, wherever you saw it.
- One inbox for every profile you can use, with a filter per profile.
- You can see, reply, like, regiorg or follow as any of your profiles from any screen, without
  switching the whole app; switching the whole app no longer reloads it.

## Part A: seen means read

### Rules

What counts as having seen a notification, per type:

| type                                 | read when                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `mention`, `reply`, `quote`, `ratio` | the post (`inbox.post_id`) was on screen: feed, thread, profile, search                     |
| `like`, `regiorg`, `ratioed_by_you`  | you opened that post's page (the counts are on it) or its people list                       |
| `follow`                             | you opened your followers list, or that follower's profile                                  |
| `invites`                            | you opened `/settings/invites`                                                              |
| any                                  | you acted on it: replied to / liked / regiorged / quoted the post, followed the sender back |

The last row is server side and needs no client: `posts.ts` / `follows.ts` mark the actor's rows
read in the same transaction (a reply to post P marks the actor's `reply`/`mention`/`quote` rows
for P read; following X marks the actor's `follow` row from X read).

**Across profiles** (decided): the inbox belongs to the account, not the profile. When a post
is seen by any profile, the rows about it for every profile the account can use are read too.
Shared identities keep sharing their read state between members, as today.

### API

- `POST /api/v1/notifications/seen` (new), batched so scrolling a feed is one request every few
  seconds, not one per post:
  ```json
  { "posts": [12, 15], "engagement": [12], "followers": ["alice"], "invites": false }
  ```
  `posts`: posts that were on screen (max 100). `engagement`: posts whose page or people list was
  opened. Answers `{ "read": n }`, sends the new unread counts over realtime. Rate limited like
  the other reads-with-a-write. Accepts `X-Act-As` (Part C) and bot tokens.
- `POST /posts/:id/seen` stays (contract), now covers the same types as `posts` above. Documented
  as such.
- `markPostSeen` becomes `markSeen(profileIds, { posts, engagement, followers, invites })` in
  `notifications.ts`; one `UPDATE … WHERE read_at IS NULL` per kind, using `inbox_post_id` and
  `inbox_unread`. No migration.

### Clients

- Web: `Post.svelte` reports every post it shows (not only mentions) to a small queue in
  `src/lib/seen.ts` that flushes every 3 s, on `visibilitychange` (with `fetch keepalive`) and on
  page change. Skips posts already reported and, cheaply, posts by the viewer that can't have a
  notification. The post page, `Likes.svelte`/people list, followers list and invites page report
  their `engagement`/`followers`/`invites`.
- Mobile: the same queue in `mobile/src/lib/seen.ts`, fed by `PostList`'s `onViewableItemsChanged`
  and the matching screens.

### Clearing the device's tray

Notifications read anywhere (this phone, the website, another phone) leave the tray, and so do
pushes of DMs and group messages once they're read. Every push already carries a `tag`
(`like:<post>`, `reply:<post>`, `follow:<username>`, `invites:<id>`, `message:<sender>:<recipient>`,
`group:<id>:<username>`) and the app's pushes are FCM data messages that expo-notifications
shows itself, so the app can see them (`getPresentedNotificationsAsync`, with their data) and
remove them (`dismissNotificationAsync`).

- **Server:** `POST /api/v1/notifications/stale` `{ "tags": ["like:12", "message:bob:alice"] }`
  (max 100) answers the tags that have nothing unread left for the account's profiles:
  `{ "stale": ["like:12"] }`. A tag maps back to its rows (type + post, follow + recipient,
  conversation + recipient), so no new column. Account tokens only.
- **App open (reliable, PR 5):** on start, on returning to the foreground, and whenever a
  realtime `notifications` / `messages_unread` frame lowers a count, the app lists its presented
  notifications, asks `/notifications/stale` and dismisses those. Reading in the app clears its
  own tags straight away, without asking. "Mark all as read" clears every notification
  (`dismissAllNotificationsAsync`).
- **App closed (PR 6, needs testing on phones):** when pushed rows become read, the outbox
  sends a data message `{ dismiss: "<tags>" }` to the account's phones (coalesced: one per phone
  every few seconds). The app handles it in a background notification task (expo-notifications
  `registerTaskAsync` + expo-task-manager) and dismisses the tags without showing anything. To
  check against the Expo SDK docs before building: that a data message without a title is
  never shown, and that the task runs when the app was swiped away. If it doesn't, the
  app-open path still clears the tray on the next open.
- **Web:** a page that marks rows read closes the browser's notifications of those tags
  (`registration.getNotifications({ tag })`). Web push has to show something for every push,
  so there is no closed-tab equivalent.
- iOS has no push yet (`push_devices.platform` is Android only); when it comes, the same
  app-open path works there.

## Part B: one inbox

### API

Scope (decided): one account, with all its profiles: its own, the identities it owns and the
identities shared with it (included by default), not its bots. Other accounts signed in on the
same browser or phone keep their own inbox, reached through the switcher as today. Why not
merge them too:

- Web could do it on the server (the cookie holds every signed-in session, `locals.sessions`),
  but `X-Act-As` would then have to pick between sessions, and every account-wide query (unread,
  realtime, stale tags) would take a list of accounts.
- The app keeps one token per account and the server only ever sees one, so the app would
  merge N paginated lists (each with its own cursor), keep N realtime streams and route every
  action to the right token. That is most of a second notifications client.
- And the two clients would behave differently. Worth revisiting only if people use several
  accounts on one device a lot; the switcher badges already show their unread counts.

- `GET /api/v1/notifications/grouped?profiles=all` (and `?profiles=alice,alice_art`): groups for
  every profile the account can use. Every group gets a new `recipients` field (the profiles it
  is for, `{ id, username, name, avatar }`); without `profiles` the answer is unchanged
  (current profile only). Bot tokens: only their own profile.
- **Merged on the server** (decided): with several profiles, a post that notifies more than one
  of them is one group. In this mode the walk keys `mention`, `reply`, `quote` and `ratio` rows
  by post (`p-<post_id>`) instead of `n-<id>`, its `type` is the strongest one (reply > quote >
  ratio > mention) and `recipients` lists every profile it reached ("@bob replied to @alice and
  mentioned @alice_art"). Likes, regiorgs and follows stay per profile: they are about one
  profile's post or one profile's followers, and their keys get the recipient prefixed
  (`<user_id>/like-12-20261120`). Lookups use `inbox_post_id` (post + `user_id = ANY`) and
  `inbox_user_group_key`. Reading a merged group reads all its rows. Keys of this mode are only
  valid with `?profiles=all` on `groups/:key/read`, so the single-profile keys don't change.
  Fallback if the SQL gets out of hand: return per-profile groups and merge them in the clients
  by post id (both have the post id), with the same look.
- `POST /notifications/groups/:key/read`, `POST /notifications/read`, `/notifications/unread`
  take `?profile=username` / `?profiles=all`. `/notifications/unread?profiles=all` answers
  `{ total, profiles: [{ username, notifications, messages, reactions }] }`, replacing the
  switcher's subqueries in `getSwitcher`.
- **Realtime per account**: a stream belongs to the account (it already knows the session), and
  `pushUnread(profileId)` reaches the streams of every account that can use the profile (the same
  `owner_id ∪ identity_members` query `deliver` in `push.ts` uses). The `notifications` frame
  gets `profile` and `total` fields (added, so old clients keep working). Posts, likes and other
  frames keep coming for the profile in use.
- Performance: `inbox_user_created (user_id, created_at, id)` with `user_id = ANY(11 ids)` and
  `ORDER BY created_at DESC` relies on Postgres 17's ordered scalar-array index scans; check with
  `EXPLAIN` on the staging seed and, if it sorts, run the walk's "next row" as a `UNION ALL` of
  one `LIMIT 1` scan per profile.

### UI (web and app)

- The notifications page shows everything by default, with a filter row: `All` and one
  avatar-pill per profile with its unread count (underline tab row, `data-sveltekit-replacestate`).
  Each group has its recipients' 20px avatars on its own avatar's corner and a muted
  `to @alice, @alice_art` line (left out when it is only the profile in use).
- The bell/bottom bar count is the total across profiles; the switcher keeps its per-profile
  counts. A setting "Notifications from: all my profiles / only the profile in use" (UI cookie on
  web, stored on the phone in the app) for people who want them apart.
- Clicking a group of another profile opens its target **as that profile** (Part C), without
  switching.
- Push: unchanged payloads (they already name the profile), but a tap opens the screen with that
  profile as its context instead of switching the app.

## Part C: act as any profile, from anywhere

### Per-request profile

- `authenticate()` honours an `X-Act-As: <username>` header on cookie and human-token requests:
  the request acts as that profile if the account may use it (the rules already applied to
  `sessions.acting_id`: owned or shared, owner not banned, mute inherited). The session isn't
  touched. A profile the account can't use answers 403 `Can't act as @x`. Bot tokens refuse it.
  Allowed in the CORS headers; documented in `/api.txt`, README, `/developers`.
- That is the only server change Part C needs: every endpoint already reads `locals.user`.

### The context profile

A screen can be in the context of a profile other than the one in use:

- Web: a `?as=username` search param on post, profile, hashtag and search pages. Their universal
  loads forward it as `X-Act-As` (so `liked`, `regiorged`, `following` are that profile's), and
  `cachedPage` keys by URL so back/forward stays right. Links inside the page carry it on
  (a `withAs(href)` helper used by `Post.svelte` and profile links), and `api()` adds the header
  while the page has it (a `.svelte.ts` context module, `actingAs`).
- Mobile: an `as` route param, passed the same way to `api()` and on by links.
- A thin bar under the header says **Viewing as @alice_art** with its avatar and a `Change`
  button (the profile picker) and `×` (back to the profile in use). Not shown when `as` is the
  profile in use.

### Picking a profile for one action

- Composer and `ReplyDock`: the avatar becomes a button opening the profile picker ("Posting as");
  default is the context profile. Drafts are kept per profile as today (`saveDrafts`).
- Like / regiorg: long press on touch, right-click or a small chevron on mouse opens "Like as…"
  with every profile and whether each already liked it (`GET /posts/:id/viewers` → for each of
  the account's profiles: liked, regiorged. New, small, account-only).
- Follow button on profiles: the same picker, "Follow as…".

### Switching the whole app

- `switchTo` stops reloading: `POST /auth/switch`, then `invalidateAll()`, reset the stores
  (`user`, unread counts), and keep the stream (it is per account now, Part B). Push
  subscriptions belong to the session, so they're unaffected. The composer drafts stay put.
- The switcher stays where it is (rail, sidebar bottom, bottom bar avatar with double tap) and is
  added to the "Viewing as" bar and the composer, so it's reachable from every screen.
- Mobile: the same without remounting the navigation tree (`session.tsx` `apply` keeps the
  token and only swaps `me`), so the current screen and its scroll stay.

## Rollout (PRs)

Each PR documents its endpoints (`apiGuide.ts`, README, `botDocs.ts`) and is backwards
compatible; there is no migration unless a decision below adds one.

1. **Server: seen means read.** `POST /notifications/seen`, wider `/posts/:id/seen`, read on own
   action, across the account's profiles, `POST /notifications/stale`.
2. **Web: report what's seen.** Seen queue, engagement/followers/invites, closing browser
   notifications by tag.
3. **Server: unified inbox and `X-Act-As`.** `?profiles=all` on the notification endpoints,
   merged groups with `recipients`, unread breakdown, per-account realtime, `X-Act-As`,
   `/posts/:id/viewers`.
4. **Web: unified inbox and context profile.** Filter row, recipient avatars, total badge,
   `?as=` pages and the "Viewing as" bar, profile pickers in composer, reply dock, like, follow;
   switching without reload.
5. **Mobile.** Seen queue, clearing read notifications from the tray on open/resume/realtime,
   unified inbox, `as` param, pickers, push tap opens in context, switching without remount.
   Tag `mobile-v*` once tested on a phone.
6. **Tray while the app is closed.** FCM `dismiss` data messages and the background task;
   clean-ups in `getSwitcher`.

PRs 1–2 fix the duplicates on the web on their own and can ship before the rest; the tray
clearing in PR 5 can be split out and shipped early on top of PR 1.

## Decisions (2026-11-20)

1. Seen across profiles: yes, the inbox is per account.
2. Scope: one account and all its identities (see "Scope" for why not several accounts).
3. Shared identities are in the inbox by default; no opt-in column.
4. A post that reaches several profiles is one merged group naming them, on the server
   (client-side merge as the fallback).
5. No push delay: the idea was to skip pushing a like/follow you'd read within a minute anyway,
   but pushes of the same tag already replace each other, and read ones now leave the tray.
   Revisit only if pushes still feel noisy.
