# Moving assets to S3-compatible storage (Cloudflare R2)

The plan for moving avatars, post images and message images from the docker volumes to an
S3-compatible bucket (Cloudflare R2 in production), making message images private, and
backing the bucket up. Each PR section below is self-contained; read "Decisions" and "Target
design" first.

## Decisions

- **Proxy everything.** The app serves every asset from its own routes, reading from the
  bucket. No public bucket, no custom domain, no redirects. Cloudflare sits in front of the
  app (the app is not hosted on Cloudflare), so public assets (`public, immutable`) are cached
  at the edge and the app only sees cache misses.
- **One private bucket** with key prefixes `uploads/`, `avatars/` and `dm/`. Nothing in it is
  publicly reachable; only the app's API token (read/write) and the backup's token (read only)
  can access it.
- **URLs don't change** for posts and avatars: `/uploads/<uuid>.webp`, `/avatars/<id>.webp?hash=…`.
  They are stored in the DB and published by the v1 and bot APIs as "paths on the origin".
- **Message images become private**, under a new path `/dm-uploads/<uuid>.webp`, readable only by
  participants of the conversation. Old `/uploads/<uuid>` paths of message images keep working,
  for participants only.
- **A participant is any profile the request is signed in as**: every account in
  `locals.sessions`, the identities those accounts can act as, or the bot for a bot token. Only
  checking the active profile would break images in an open chat when someone switches account.
- **Push notifications for messages carry no image.** They show the text, or "📷 Photo".
- **The local filesystem stays a supported driver** (the default when no bucket is configured), so
  self-hosters and local development keep working without R2.
- **Orphan deletion in the migration script deletes immediately** (`--delete-orphans`); it is run
  after the first backup that includes the bucket.

## Where things are today

- Post and message images: `saveUpload` / `removeUploads` / `uploadType` in
  `src/lib/server/images.ts` write `static/uploads/<uuid>.webp`. The DB stores the URL path in
  `posts.images`, `messages.images` and `group_messages.images`.
- Staged uploads: `src/lib/server/stagedUploads.ts`, files in `static/uploads/staged/`, claimed by
  `fs.rename` into `static/uploads`. The index is in memory; the directory is wiped on boot.
- Avatars: `saveAvatar` in `src/lib/server/profile.ts` overwrites `static/avatars/<userId>.webp`;
  `removeAvatarFiles` in `src/lib/server/accounts.ts` also removes old `png/jpg/gif/webp` files.
- Served by `src/routes/uploads/[file]/+server.ts` (public, immutable, sandbox CSP for legacy SVGs)
  and `src/routes/avatars/[file]/+server.ts`.
- Docker: volumes `avatars` → `/app/static/avatars`, `uploads` → `/app/static/uploads`; the
  Dockerfile `CMD` chowns them.
- `/avatar/<username>.png|svg` (generated avatars) and social cards read nothing from disk.
- Backups: `scripts/backup.sh` / `scripts/restore.sh` (restic) back up a `pg_dump` (tag `db`) and
  the `avatars` and `uploads` volumes (tag `files`).

Problems with message images today:

1. They are served to anyone holding the URL, forever, with no session check.
2. Access doesn't end when someone leaves or is removed from a group.
3. `Cache-Control: public, max-age=31536000, immutable` lets Cloudflare and browsers keep serving
   them after the message is deleted.
4. `deleteIdentity` (`src/lib/server/identities.ts`) and `deleteBot` (`src/lib/server/bots.ts`) only
   collect post images. `messages.sender_id` / `recipient_id` and `group_messages.sender_id` are
   `ON DELETE CASCADE`, so the message rows go away but their files stay, still public. This
   includes images other people sent to the deleted profile.
5. `src/lib/server/push.ts` puts `images[0]` in message push payloads.

## Target design

### Storage module: `src/lib/server/storage.ts`

```ts
export type StoredObject = { body: ReadableStream<Uint8Array> | Uint8Array; size: number };

put(key: string, data: Uint8Array, contentType: string): Promise<void>
get(key: string): Promise<StoredObject | null>      // null when missing
head(key: string): Promise<{ size: number } | null>
remove(keys: string[]): Promise<void>               // missing keys are fine
```

Keys are `uploads/<uuid>.webp`, `avatars/<id>.<ext>`, `dm/<uuid>.webp`. Callers never build file
paths themselves.

- **fs driver** (default): `uploads/` and `avatars/` keys map to `static/uploads/…` and
  `static/avatars/…` (the existing volumes). `dm/` keys map to `data/dm/…`, **outside `static/`**:
  the vite dev server serves `static/` as-is, which would make private files public in
  development.
- **s3 driver**: used when `S3_BUCKET` is set. Built on [`aws4fetch`](https://github.com/mhart/aws4fetch)
  (small, fetch-based, works under both Node, which runs `vite dev`, and Bun, which runs the
  production build). Path-style URLs: `${S3_ENDPOINT}/${S3_BUCKET}/${key}`. `get` streams the
  response body. `remove` uses one `DeleteObject` per key (or `DeleteObjects` batches).
- **Temporary read fallback** (s3 driver only, removed after the migration): when `get` / `head`
  misses in the bucket, try the fs driver for the same key. This lets the new code be deployed
  with the bucket configured before the old files are uploaded.

### Environment

| variable               | example                                         | notes                     |
| ---------------------- | ----------------------------------------------- | ------------------------- |
| `S3_BUCKET`            | `giorgiovola-assets`                            | enables the s3 driver     |
| `S3_ENDPOINT`          | `https://<account id>.r2.cloudflarestorage.com` | required with `S3_BUCKET` |
| `S3_REGION`            | `auto`                                          | defaults to `auto` (R2)   |
| `S3_ACCESS_KEY_ID`     |                                                 | required with `S3_BUCKET` |
| `S3_SECRET_ACCESS_KEY` |                                                 | required with `S3_BUCKET` |

Validated in `src/env.ts` (all or nothing: setting `S3_BUCKET` without the others fails at
startup), documented in `.env.example` and the README table, passed through in
`docker-compose.yaml` (empty by default).

### Serving

- `/uploads/[file]` and `/avatars/[file]`: same file-name validation and response headers as now,
  body streamed from `storage.get`.
- `/dm-uploads/[file]` (new, see PR 4): `Cache-Control: private, max-age=3600`, 404 for anyone who
  isn't a participant (the same response as a missing file).

## PRs

Every PR branches from `main`, follows `AGENTS.md` (Bun, runes, API-first, docs in `/api.txt`,
`botDocs.ts` and README, `bun run check` and `bun run format` before finishing) and leaves the app
working with the fs driver.

### PR 1: storage module

- Add `src/lib/server/storage.ts` with both drivers and the read fallback, and the env vars.
- Move every file access onto it:
  - `images.ts`: `saveUpload` → `storage.put('uploads/…')`; `removeUploads` → `storage.remove`
    (still ignoring paths that aren't ours). Export a helper that maps a URL path to its key so
    later PRs can add `/dm-uploads/` paths.
  - `stagedUploads.ts`: staged files stay on **local disk**, moved to a directory under
    `os.tmpdir()` (no longer inside `UPLOAD_DIR`). `claimStaged` reads the staged file,
    `storage.put`s it, then deletes the local file; on failure it removes what was already put
    (as it does now). Give the claim a parameter for the target kind so PR 4 can claim into `dm/`.
  - `profile.ts` `saveAvatar` and `accounts.ts` `removeAvatarFiles` → `avatars/` keys.
  - Both serving routes → `storage.get`, streamed.
- `bun add aws4fetch`.
- Docs: README (data section, env table, a short "storing assets in S3 / R2" section with R2 setup:
  create a private bucket, create an API token with Object Read & Write on that bucket only, set the
  env vars). No API contract changes.

### PR 2: delete message images with their profile; no images in message pushes

Independent of the storage module.

- Add `imagesOfMessagesOf(userId)` next to `imagesOfPostTrees` in `images.ts`: the `images` of
  `messages` where the profile is the sender **or** the recipient, and of `group_messages` where it
  is the sender. Collect them in `deleteIdentity` and `deleteBot` before the delete and pass them to
  `removeUploads` after it, like post images.
- `push.ts`: stop sending `image` in the direct and group message pushes.
- Check whether any other path deletes rows of `messages` / `group_messages` by cascade without
  collecting their images, and fix those too.

### PR 3: back up the bucket

Extends `scripts/backup.sh` / `scripts/restore.sh` (restic) instead of adding a second system.

- When `S3_BUCKET` is set in the backup config: `rclone sync` the bucket to a local mirror directory
  (`MIRROR_DIR`, e.g. `/var/lib/social-backup/assets`) with a **read-only** R2 token, configured
  through rclone env vars (`RCLONE_CONFIG_<NAME>_*`) in `/etc/social-backup.env`, no rclone config
  file. Then `restic backup --tag files` the mirror. restic provides the versions, encryption and
  retention, so deleted and overwritten objects are kept for the retention period.
- Without `S3_BUCKET`, back up the volumes as now, plus the `dm` volume added in PR 4 when it exists.
- `restore.sh` in bucket mode: restore the mirror from restic, then `rclone sync` it into the
  bucket with a token that can write (`RESTORE_*` variables, asked for only when restoring).
- Document in README: setup, the read-only token, and that deleted message images stay in backups
  until retention drops them (12 monthly snapshots by default).

### PR 4: private message images

Builds on PR 1.

- **Writes**: message images (`saveMessageImages` and claiming staged images for a message) go to
  `dm/<uuid>.webp` and are stored as `/dm-uploads/<uuid>.webp`. Post images are unchanged.
  `removeUploads` (or its replacement) handles both path shapes. fs driver: `dm/` under `data/dm`;
  add a `dm-uploads` volume at `/app/data/dm` to `docker-compose.yaml`, and `mkdir` / `chown` it in
  the Dockerfile like the others.
- **GIN indexes** on `messages.images` and `group_messages.images` (drizzle migration, next number
  after the latest in `drizzle/`), so the owner of a file can be looked up.
- **Ownership lookup**: given a file name `x`, find the message rows whose `images` overlap
  `ARRAY['/uploads/x', '/dm-uploads/x']` in both tables. Matching either shape means the route
  works before and after PR 5 rewrites the rows.
- **Access check**, shared by both routes, through `locals` (cookies, `sgu_` and `sgc_` tokens):
  the viewer's profiles (see "Decisions") must include the sender or recipient of a direct message,
  or a current member of the group of a group message. Reuse the rule the endpoints that list a
  conversation's messages use, so images follow whatever the conversation itself allows.
- **`/dm-uploads/[file]`**: no matching message → 404; no access → 404; otherwise serve `dm/x`,
  falling back to `uploads/x` (files not moved yet), with `Cache-Control: private, max-age=3600`
  and no `immutable`.
- **Tokens on uploads**: an invalid Bearer/Bot token doesn't fail `/uploads/` or `/dm-uploads/` in
  `authenticate()` (it does under `/api/`): the request goes on anonymous with
  `locals.invalidToken`, a post image is served as before, a message image answers the API's 401.
- **`/uploads/[file]`**: if `x` belongs to a message, apply the same check and private caching
  (reading `dm/x`, then `uploads/x`); otherwise serve it publicly as now. Only cache misses reach
  this lookup for post images, because Cloudflare caches their responses.
- **Docs** (contract: `images` stays an array of paths on the origin, only the shape of new paths
  changes): `/api.txt` Part 1 and Part 2, `botDocs.ts` and README. New message images are
  `/dm-uploads/…`; fetching one needs the same auth as reading the conversation (cookie or Bearer
  token); a 404 means missing or no access; old `/uploads/…` message paths still resolve for
  participants. State the limitation: anyone who could see an image can keep a copy; this keeps out
  people who were never in the conversation or no longer are.

### PR 5: migration script

Builds on PR 4. `scripts/migrate-assets.ts`, self-contained like `migrate.ts` (the Docker image
doesn't include `src/`), using `Bun.S3Client` and the `postgres` driver, and added to the
Dockerfile `COPY` line. Run in the container: `docker compose exec web bun scripts/migrate-assets.ts`.

1. Read every `images` path of `messages` and `group_messages`: those files are message images.
2. Upload `static/uploads/*` (skipping `staged/` and names that fail the upload name check):
   message images to `dm/<file>`, the rest to `uploads/<file>`. Upload `static/avatars/*` to
   `avatars/<file>`. Skip objects that already exist with the same size, so the script can be
   resumed and re-run. About 8 uploads at a time.
3. Verify every path referenced by `posts.images`, both message `images` columns and `users.avatar`
   (without `?hash`) exists in the bucket. Print what is missing and stop if anything is.
4. Rewrite message rows from `/uploads/x` to `/dm-uploads/x`, per table, in a transaction. Re-runs
   find nothing left to rewrite.
5. Orphans: objects and local files referenced by nothing (including message images left behind by
   past identity and bot deletions). Report them; `--delete-orphans` deletes them from the bucket.
6. Cloudflare purge: print the full `${PUBLIC_URL}/uploads/…` URLs of message images and orphans,
   which may still be cached at the edge. With `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` set,
   purge them through the purge-by-URL API in batches.

Flags: `--dry-run` (report only), `--delete-local` (remove the local files after a successful
verification), `--delete-orphans`, `--purge`, `--purge-only` (step 6 alone, usable before the
bucket is configured).

### PR 6: cleanup

After production runs from the bucket and the migration is verified: remove the read fallback from
the s3 driver. The volumes stay in `docker-compose.yaml` (the fs driver still needs them); the
README says they can be removed in bucket mode.

## Cutover

1. Merge PRs 1–5 and deploy. Without the S3 env vars, nothing changes except private message images.
2. Purge the old message image URLs from Cloudflare (`--purge-only`: only step 6 of the script,
   no uploads), since PR 4 makes them private but the edge may still hold copies.
3. Create the R2 bucket and tokens, set the env vars, redeploy. Reads hit the bucket and fall back to
   the volumes.
4. Run `bun scripts/migrate-assets.ts --dry-run`, then without `--dry-run`, then with `--purge`.
5. Run a backup (PR 3) and check it includes the bucket.
6. Run `--delete-orphans`, and `--delete-local` once you're satisfied. Keep a tarball of the volumes
   for a while.
7. Merge PR 6.
