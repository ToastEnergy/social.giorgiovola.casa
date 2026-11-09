self-hosted social network

## running with Docker

```
docker compose up -d
```

That's it: the database is created and migrated automatically on every start. The app listens on port `7777` at http://localhost:7777 (only on localhost by default, see `BIND_ADDRESS`). Set `SIGNUP_PASSWORD` to allow registrations.

To customize settings, copy `.env.example` to `.env` (docker compose picks it up automatically) and edit it:

| variable                             | default                           | description                                                                                                                                                                     |
| ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                               | `7777`                            | port the app listens on                                                                                                                                                         |
| `PUBLIC_URL`                         | `http://localhost:PORT`           | public URL of your instance (links, social cards, CSRF check); baked into the image, so rebuild with `docker compose up -d --build` after changing it                           |
| `PUBLIC_SEARCH_PLACEHOLDER`          | `Giorgiocerca qualcosa`           | placeholder text of the search box                                                                                                                                              |
| `PUBLIC_REPLY_PLACEHOLDER`           | `Giorgia un commento`             | placeholder of the reply bar on an open post (touch devices)                                                                                                                    |
| `PUBLIC_NO_REPLIES_MESSAGE`          | `Nessuno ha ancora giorgiato qui` | shown under an open post that has no replies yet                                                                                                                                |
| `DISCORD_WEBHOOK_URL`                | empty                             | optional, new posts are announced to this webhook                                                                                                                               |
| `SIGNUP_PASSWORD`                    | empty                             | password required to register; registration is closed if empty                                                                                                                  |
| `ADDRESS_HEADER`                     | empty                             | header with the client IP behind a proxy (enables per-IP rate limits)                                                                                                           |
| `S3_BUCKET`                          | empty                             | bucket for avatars and images; empty keeps them on the local disk (see [storing assets in S3 / R2](#storing-assets-in-s3--r2))                                                  |
| `S3_ENDPOINT`                        | empty                             | S3 API endpoint, required with `S3_BUCKET` (R2: `https://<account id>.r2.cloudflarestorage.com`)                                                                                |
| `S3_REGION`                          | `auto`                            | bucket region (`auto` for R2)                                                                                                                                                   |
| `S3_ACCESS_KEY_ID`                   | empty                             | access key of the API token, required with `S3_BUCKET`                                                                                                                          |
| `S3_SECRET_ACCESS_KEY`               | empty                             | secret of the API token, required with `S3_BUCKET`                                                                                                                              |
| `LINK_PREVIEWS`                      | `local`                           | who downloads linked pages for previews: `local` (this server, shows its IP address to the sites), `remote` (a Cloudflare Worker) or `off`; see [link previews](#link-previews) |
| `LINK_PREVIEWS_URL`                  | empty                             | URL of the link preview worker, required with `LINK_PREVIEWS=remote`                                                                                                            |
| `LINK_PREVIEWS_SECRET`               | empty                             | secret shared with the worker, required with `LINK_PREVIEWS=remote`                                                                                                             |
| `CLOUDFLARE_ZONE_ID`                 | empty                             | only for `scripts/migrate-assets.ts --purge`: the Cloudflare zone to purge old URLs from (not read by the app)                                                                  |
| `CLOUDFLARE_API_TOKEN`               | empty                             | only for `scripts/migrate-assets.ts --purge`: an API token with the **Zone > Cache Purge** permission on that zone (not read by the app)                                        |
| `SOCIAL_IMAGE`                       | `social-web`                      | image of the app; set by the deploy script to the one it pulled from the registry (see [deploying](#deploying-staging-and-production)), empty to build it from the checkout     |
| `GREEN_PORT`                         | `7779`                            | host port of `web-green`, the second colour of the blue-green deploy (see [deploying](#deploying-staging-and-production))                                                       |
| `SOCIAL_IMAGE_GREEN`, `SOCIAL_COLOR` | empty                             | set by the deploy script: the image of `web-green` and the colour that is live                                                                                                  |
| `BIND_ADDRESS`                       | `127.0.0.1`                       | interface the port is published on                                                                                                                                              |
| `POSTGRES_PASSWORD`                  | `postgres`                        | database password (URL-safe characters only); only applied when the database volume is first created                                                                            |
| `POSTGRES_PORT`                      | `5432`                            | host port of the database in `docker-compose.dev.yaml` (not published in the main compose file)                                                                                 |

Data lives in the `postgres-data`, `avatars`, `uploads` and `dm-uploads` docker volumes (`uploads` holds the images attached to posts, `dm-uploads` the ones attached to messages, which are only served to the people in the conversation: up to 5 per post or message, 10MB each; PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG, all re-encoded to WebP and scaled down to 2048px; avatars become 512px WebP squares). Avatars and images can be kept in an S3-compatible bucket instead of the volumes, see [storing assets in S3 / R2](#storing-assets-in-s3--r2). You should put the app behind a reverse proxy like [caddy](https://caddyserver.com/docs/quick-starts/caddyfile) or [nginx](https://gist.github.com/journeymanavi/dc7df599dd7618a12528c553ea47b1b1) to add at least https and gzip compression.

## storing assets in S3 / R2

By default avatars and images are files in the `avatars`, `uploads` and `dm-uploads` volumes. Set `S3_BUCKET` to keep them in an S3-compatible bucket instead, such as [Cloudflare R2](https://developers.cloudflare.com/r2/). The bucket stays private: the app still serves every file from its own `/avatars/…`, `/uploads/…` and `/dm-uploads/…` URLs (so stored links don't change), reading them from the bucket, and a cache in front of the app (such as Cloudflare) keeps most requests for public files from reaching it. Message images are answered with `Cache-Control: private`, so such a cache never keeps them. Images that are picked in the composer but not posted yet stay in a temporary directory on the server.

With Cloudflare R2:

1. In the Cloudflare dashboard, go to R2 and create a bucket. Leave public access off (no public `r2.dev` URL and no custom domain).
2. Under **Manage API tokens**, create an API token with the **Object Read & Write** permission, applied to that bucket only. Note its access key ID and secret access key, and your account's S3 endpoint (`https://<account id>.r2.cloudflarestorage.com`).
3. Set the variables in `.env` and restart with `docker compose up -d`:

```
S3_BUCKET=my-social-assets
S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

`S3_BUCKET` needs the endpoint and both keys: the app refuses to start when one of them is missing. Other S3-compatible services (AWS S3, MinIO, Backblaze B2…) work the same way with their endpoint and region; requests use path-style URLs (`<endpoint>/<bucket>/<key>`). Objects are stored under `uploads/`, `avatars/` and `dm/` (message images).

Files still in the volumes keep being served while the bucket is configured (the app looks there when the bucket doesn't have a file, and deletes both copies), so switching doesn't break existing images; copy them into the bucket with the migration script (see [moving existing assets to the bucket](#moving-existing-assets-to-the-bucket)). `scripts/backup.sh` doesn't include the bucket yet.

## moving existing assets to the bucket

`scripts/migrate-assets.ts` copies the files in the volumes into the bucket and makes images of messages sent before images became private (stored as `/uploads/…`) private too. Run it in the container:

```
docker compose exec web bun scripts/migrate-assets.ts --dry-run
```

It reads the same `S3_*` variables as the app, plus `DATABASE_URL` and `PUBLIC_URL`, and runs these steps, printing a summary of each:

1. **message images**: reads every image path of direct and group messages.
2. **upload**: `uploads` volume files go to `dm/<file>` when they belong to a message and to `uploads/<file>` otherwise, the `avatars` volume to `avatars/<file>` and the `dm-uploads` volume to `dm/<file>`. Objects already in the bucket with the same size are skipped, so it can be stopped and run again.
3. **verify**: every image path of posts and messages and every avatar (`users.avatar` without `?hash=`) must be in the bucket, under the key the app reads. If anything is missing, it prints the list and stops with an error before changing anything else.
4. **rewrite**: message rows with `/uploads/x` paths are rewritten to `/dm-uploads/x`, in one transaction. A second run finds nothing left.
5. **orphans**: objects and local files nothing references (such as images of deleted messages, or avatars in an old format). Only reported, unless `--delete-orphans` is passed, which deletes them from the bucket (and the volume) right away. Anything stored less than an hour ago is left alone, as it may belong to a post or message being sent.
6. **Cloudflare purge**: prints the `${PUBLIC_URL}/uploads/…` URLs of message images and orphans, which a cache in front of the app may still hold from when they were public. With `--purge`, they are purged through Cloudflare's purge-by-URL API (100 URLs per request).

| flag               | effect                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`        | report what would happen; nothing is written to the bucket, the database, the volumes or Cloudflare                                                  |
| `--delete-local`   | after a successful verification, delete the local files whose copy in the bucket is confirmed                                                        |
| `--delete-orphans` | delete the orphans (step 5)                                                                                                                          |
| `--purge`          | purge the URLs of step 6 from Cloudflare                                                                                                             |
| `--purge-only`     | only step 6, which works without the `S3_*` variables: prints the URLs, and purges them when `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` are set |

Steps 2–5 refuse to run without the `S3_*` variables. Purging needs `CLOUDFLARE_ZONE_ID` (on the zone's overview page in the dashboard) and `CLOUDFLARE_API_TOKEN`, an API token (My Profile > API Tokens > Create Token, custom) with the **Zone > Cache Purge** permission on that zone. The app doesn't read either of them, so pass them to the script only:

```
docker compose exec -e CLOUDFLARE_ZONE_ID=… -e CLOUDFLARE_API_TOKEN=… web bun scripts/migrate-assets.ts --purge
```

Moving an existing instance to the bucket, in order:

1. Update and deploy without the `S3_*` variables. Nothing changes, except that message images are now only served to their conversation.
2. Purge the old message image URLs from Cloudflare, since it may still have public copies: `--purge-only` (no bucket needed yet).
3. Create the bucket and its token ([storing assets in S3 / R2](#storing-assets-in-s3--r2)), set the `S3_*` variables and restart with `docker compose up -d`. Files are read from the bucket, falling back to the volumes.
4. Run the script with `--dry-run`, then without it, then with `--purge`.
5. Run a backup and check it includes the bucket.
6. Run it with `--delete-orphans`, and with `--delete-local` once you're satisfied. Keep a tarball of the volumes for a while.

If step 3 reports missing files that you can't find anymore (in an old volume or a backup), the posts or messages pointing at them show broken images either way; the script won't go further until the paths are fixed or removed from the database.

## backups

`scripts/backup.sh` backs up a docker deployment with [restic](https://restic.net) (0.17 or newer): a dump of the database (snapshot tagged `db`) and the `avatars` and `uploads` volumes, plus `dm-uploads` when the deployment has it (tagged `files`), then it drops old snapshots (7 daily, 4 weekly, 12 monthly by default) and reads back a small sample of the repository to catch damage early. The repository is created on the first run. Run it as root on the server, from the directory the app runs from:

```
cp scripts/backup.env.example /etc/social-backup.env   # set RESTIC_REPOSITORY and the password file
chmod 600 /etc/social-backup.env
openssl rand -base64 32 > /etc/social-backup.password && chmod 600 /etc/social-backup.password
scripts/backup.sh
```

Keep a copy of the password somewhere other than the server: without it the backups can't be read. To run it every night, add a line to root's crontab (`crontab -e`):

```
30 3 * * * /opt/social/scripts/backup.sh >> /var/log/social-backup.log 2>&1
```

Set `HEALTHCHECK_URL` to get an alert from a service like [healthchecks.io](https://healthchecks.io) when a backup fails or stops running.

`scripts/restore.sh` puts a backup back, replacing the current database, avatars and uploads (it asks first, and stops the app while restoring). By default it takes the latest snapshots; pass the ids from `restic snapshots` to pick older ones: `scripts/restore.sh <db snapshot> <files snapshot>`. On a new server, clone the repository, copy `.env` and `/etc/social-backup.env`, run `docker compose up -d` once to create the volumes, then `scripts/restore.sh`. Pending migrations are applied when the app starts again.

### backing up the bucket

When the assets live in an S3 / R2 bucket, set `S3_BUCKET` in `/etc/social-backup.env` too. The backup then copies the bucket into a local mirror (`MIRROR_DIR`, `/var/lib/social-backup/assets` by default, readable by root only) with [rclone](https://rclone.org), and backs up the mirror instead of the volumes, still tagged `files`. restic keeps the versions, encrypts them and applies the retention, so deleted and overwritten objects can be restored for as long as their snapshots are kept. If the copy fails, the backup stops and reports the failure without taking a snapshot of a half-copied mirror.

1. Install rclone on the server (`apt install rclone`, or see [its install page](https://rclone.org/install/)).
2. In the Cloudflare dashboard, R2 → _Manage API tokens_ → _Create API token_: permission **Object Read only**, applied to that one bucket. Read only means that someone who gets into the backup host can't change or delete the assets.
3. Put the token in `/etc/social-backup.env` as an rclone remote, through environment variables (no `rclone.conf` needed; the commented example in `scripts/backup.env.example` has all of them): `S3_BUCKET`, `RCLONE_CONFIG_R2_TYPE=s3`, `RCLONE_CONFIG_R2_PROVIDER=Cloudflare`, `RCLONE_CONFIG_R2_ENDPOINT`, `RCLONE_CONFIG_R2_ACCESS_KEY_ID` and `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY`.
4. Run `scripts/backup.sh` and check that `restic ls latest --tag files` lists the bucket's `uploads/`, `avatars/` and `dm/` objects.

`scripts/restore.sh` then puts the files snapshot back into the bucket with `rclone sync`, which also deletes the objects that aren't in the snapshot. The read-only token can't do that, so it asks for the key pair of a token with **Object Read & Write** on the bucket (the app's token works), or takes it from `RESTORE_ACCESS_KEY_ID` / `RESTORE_SECRET_ACCESS_KEY`. Don't keep that token in the backup config. Pass a files snapshot taken in bucket mode: older snapshots of the volumes go back into the volumes, with `S3_BUCKET` unset.

**Privacy:** message images that were deleted (with their message, or with a deleted profile) stay in the backups until the retention drops every snapshot that holds them: up to 12 months with the default `KEEP_MONTHLY=12`. Lower `KEEP_MONTHLY` (and `KEEP_WEEKLY` / `KEEP_DAILY`) to keep them for less time. The same goes for the volumes, and for deleted posts in the database dumps.

## deploying (staging and production)

`.github/workflows/deploy.yml` deploys to two instances running on the same server with docker compose, each from its own checkout with its own `.env`, database and volumes:

- **staging**: every push to `main` is checked (`bun run check`, `bun run lint`), built and deployed automatically. An empty staging database is filled with the test accounts of `scripts/seed.ts` (the same data as local development).
- **production**: by hand, from _Actions → deploy → Run workflow_ with environment `production`. Leave _Commit_ empty to deploy the head of `main`, or paste the commit that is on staging. Only commits on `main` can be deployed. Before starting the new version the server dumps the database to `predeploy-dumps/` in the checkout (the last 5 are kept).

`PUBLIC_URL` is compiled into the image, so the workflow builds one image per environment (`ghcr.io/<owner>/<repository>:<environment>-<commit>`) and pushes it to the GitHub container registry. It then joins the server's [Tailscale](https://tailscale.com) network (the server's SSH isn't reachable from the internet) and connects over SSH, where `scripts/deploy.sh` checks out the commit (so the compose file matches) and swaps the running version without downtime (blue-green):

1. The compose file has two copies of the app: `web` (blue, on `PORT`) and `web-green` (green, on `GREEN_PORT`). One of them is live, the other is stopped.
2. The new image starts on the stopped colour, next to the live one. Pending migrations are applied as it starts, while the old version still serves (so a migration has to work with the previous version of the code too).
3. Once the new container answers with the deployed commit, caddy is pointed at it with a graceful reload. Requests in flight finish on the old one.
4. A few seconds later the old colour stops. Open event streams reconnect to the new one.

If the new version doesn't answer, the job fails with its logs and the live version keeps serving. `.env` records the live colour (`SOCIAL_COLOR`) and the image of each colour (`SOCIAL_IMAGE`, `SOCIAL_IMAGE_GREEN`), so the stopped colour keeps the previous version: to roll back, run the workflow again with the previous commit, which switches back without downloading anything. The live service is `web` or `web-green` depending on `SOCIAL_COLOR`: use that name with `docker compose exec` (e.g. for `admin.ts`). Pull requests are checked by `.github/workflows/ci.yml`.

### setting up the server

1. Create a deploy user that can run docker, and give it the production checkout (it has to be a git clone with an `https://` remote, so it can fetch without a key):

   ```
   adduser --disabled-password deploy && usermod -aG docker deploy
   chown -R deploy: /opt/social
   ```

   Being in the `docker` group is as good as root, so the SSH key below is restricted to the deploy script.

2. Clone the staging checkout and give it its own `.env`. `COMPOSE_PROJECT_NAME` keeps its containers and volumes apart from production's. Don't copy production's Discord webhook, bucket or signup password:

   ```
   sudo -u deploy git clone https://github.com/ToastEnergy/social.giorgiovola.casa.git /opt/social-staging
   ```

   ```
   # /opt/social-staging/.env
   COMPOSE_PROJECT_NAME=social-staging
   PORT=7778
   GREEN_PORT=7780
   PUBLIC_URL=https://staging.social.giorgiovola.casa
   POSTGRES_PASSWORD=<another password>
   SIGNUP_PASSWORD=<another password>
   ```

   The staging site in caddy is set up like production's (next step), with `X-Robots-Tag: noindex` so search engines don't index it.

3. Let the deploy switch caddy between the colours. Each site's `reverse_proxy` takes its upstream from a file the deploy user rewrites, and the deploy reloads caddy afterwards. Write each file with the port that serves today (`PORT`) and change the Caddyfile once:

   ```
   mkdir -p /etc/caddy/social
   echo 'to 127.0.0.1:7777' > /etc/caddy/social/production.upstream
   echo 'to 127.0.0.1:7778' > /etc/caddy/social/staging.upstream
   chown -R deploy: /etc/caddy/social
   ```

   ```
   social.giorgiovola.casa {
   	reverse_proxy {
   		import /etc/caddy/social/production.upstream
   		# the options you already had (header_up …) stay here
   	}
   }

   staging.social.giorgiovola.casa {
   	header X-Robots-Tag noindex
   	reverse_proxy {
   		import /etc/caddy/social/staging.upstream
   	}
   }
   ```

   Run `systemctl reload caddy` and check that both sites still work. The deploy runs `caddy reload --config /etc/caddy/Caddyfile` as the deploy user, which talks to caddy's admin endpoint on `localhost:2019` (the default). If caddy runs in docker, set `CADDY_RELOAD` and `UPSTREAM_HOST` in `/etc/social-deploy.env` (see the comments there).

4. Install the deploy script and its config:

   ```
   install -m 755 /opt/social/scripts/deploy.sh /usr/local/bin/social-deploy
   install -m 640 -g deploy /opt/social/scripts/deploy.env.example /etc/social-deploy.env
   ```

   In `/etc/social-deploy.env`, check the paths and set `SEED_PASSWORD`, the password of every staging test account (`dev` is an admin there). Reinstall the script when `scripts/deploy.sh` changes: it runs from `/usr/local/bin` so that a deploy never rewrites it while it is running.

5. Make a key pair for GitHub Actions and allow it only to run the deploy script, in `~deploy/.ssh/authorized_keys`:

   ```
   ssh-keygen -t ed25519 -N '' -C github-deploy -f deploy_key
   ```

   ```
   command="/usr/local/bin/social-deploy",restrict ssh-ed25519 AAAA… github-deploy
   ```

   GitHub reaches this SSH server through Tailscale, so it must be the server's own `sshd`, listening on the Tailscale address. If the server runs Tailscale SSH (`tailscale set --ssh`), Tailscale answers port 22 itself and skips `authorized_keys` and its restrictions: turn it off with `tailscale set --ssh=false`, or let `sshd` listen on another port and set `DEPLOY_SSH_PORT`.

6. In the Tailscale admin console, let the GitHub jobs reach that port and nothing else. In _Access controls_, add the tags and a grant (the server gets `tag:social`: `tailscale up --advertise-tags=tag:social`, or _Machines → … → Edit ACL tags_):

   ```
   "tagOwners": {
   	"tag:ci":     ["autogroup:admin"],
   	"tag:social": ["autogroup:admin"]
   },
   "grants": [
   	{ "src": ["tag:ci"], "dst": ["tag:social"], "ip": ["tcp:22"] }
   ]
   ```

   If the policy still has the default "allow all" rule, `tag:ci` can reach every machine of the tailnet: replace that rule with your own grants first. Then create an OAuth client in _Settings → OAuth clients_ with the **Auth Keys: write** scope and the tag `tag:ci`. The jobs join as ephemeral nodes and disappear when they end.

7. The images are private on the registry the first time they are pushed. Either make the package public (_Packages → social.giorgiovola.casa → Package settings → Change visibility_; the images hold no secrets) or log the deploy user in with a token that has only `read:packages`: `sudo -u deploy docker login ghcr.io -u <user>`.

### setting up GitHub

In _Settings → Environments_ create `staging` and `production`, each with a `PUBLIC_URL` variable (the instance's public URL). For `production`, add yourself under _Required reviewers_ and restrict _Deployment branches_ to `main`. Then add these repository secrets (_Settings → Secrets and variables → Actions_):

| secret                   | value                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `TS_OAUTH_CLIENT_ID`     | the Tailscale OAuth client's id                                                                                    |
| `TS_OAUTH_SECRET`        | the Tailscale OAuth client's secret                                                                                |
| `DEPLOY_SSH_HOST`        | the server's Tailscale address (100.x.y.z or its MagicDNS name)                                                    |
| `DEPLOY_SSH_PORT`        | optional, `22` by default                                                                                          |
| `DEPLOY_SSH_USER`        | optional, `deploy` by default                                                                                      |
| `DEPLOY_SSH_KEY`         | the private key, the contents of `deploy_key`                                                                      |
| `DEPLOY_SSH_KNOWN_HOSTS` | the server's host key: the output of `ssh-keyscan <host>`, run from a machine on the tailnet with the same address |

The first production deploy starts the registry's image on green (port `GREEN_PORT`, 7779 by default) while the container you run today (`web`, which counts as blue) keeps serving, then switches over. The data stays: both colours use the same database and volumes, which belong to the compose project. To build on the server again, set `SOCIAL_COLOR=blue`, remove `SOCIAL_IMAGE` from `.env`, run `docker compose up -d --build web` and point the upstream file back at `PORT`.

## regiorgios

The arrows button under a post opens a menu with two ways to reshare it:

- **Regiorgio** reshares it as is: it shows up on your profile and in your followers' _Following_ feed, marked "… regiorged" (or "… and 2 others regiorged" when more of the profiles in that feed did), as of when it was last regiorged. Open the menu again to undo it.
- **Quote** writes a new post (text and up to 5 images) with the post embedded under it. A quote is a normal post: it shows up wherever your posts do and can be liked, replied to and regiorged itself. If the quoted post is deleted, the quote stays and says so.

The count next to the arrows is regiorgios plus quotes; click it to see who regiorged and who quoted. The author gets a notification for both (a quote that also @mentions them notifies once, as a quote). Muted users can't regiorgio or quote (they can still undo their regiorgios).

## polls

The bars button in the composer adds a poll to a post (or a reply, or a quote): 2 to 4 options of up to 80 characters, open for 1 hour to 7 days. The post's text is the question. Every profile gets one vote, which can be changed until the poll ends; the results show once you have voted or the poll has ended, and update live. Polls can't be edited, only deleted with their post.

## link previews

The first link to another site in a post shows a card with the page's title, description and image (its Open Graph tags). Readers' browsers never visit the page, only load the image from the site; the page itself is downloaded once on the server side and cached for 7 days (1 day when it had no preview). `LINK_PREVIEWS` picks who downloads it:

- `local` (the default): the app does. Simple, but **every linked site sees your server's IP address**, and anyone can post a link to a site of their own to learn it. That's fine if the server's address isn't secret, and defeats the point if it's hidden behind Cloudflare or another proxy.
- `remote`: a [Cloudflare Worker](https://developers.cloudflare.com/workers/) does, so linked sites see a Cloudflare address. The worker is in `workers/link-preview` and runs on the free plan.
- `off`: no previews, and the app never contacts linked sites.

To use the worker (needs a Cloudflare account and [Bun](https://bun.sh)):

```sh
cd workers/link-preview
bun install
bunx wrangler login
bun run deploy                              # prints the worker's URL (https://link-preview.<you>.workers.dev)
openssl rand -hex 32                        # a new secret
bunx wrangler secret put LINK_PREVIEWS_SECRET   # paste it
```

Then set these in `.env` and restart with `docker compose up -d`:

```
LINK_PREVIEWS=remote
LINK_PREVIEWS_URL=https://link-preview.<you>.workers.dev
LINK_PREVIEWS_SECRET=<the same secret>
```

The app refuses to start with `LINK_PREVIEWS=remote` and no URL or secret. The worker answers only requests carrying the secret, so it can't be used as an open proxy. When it can't be reached (or refuses the secret), the app logs it, stops calling it for a minute and shows no previews for new links in the meantime; it never falls back to downloading the pages itself. Some sites refuse requests from Cloudflare's addresses, so a few links that have a preview with `local` may not have one with `remote`.

## group chats

_New group_ on the messages page starts a group chat with a name and the people you pick, up to 32 members. Groups show up in the conversation list next to direct messages, with the same unread badges, live updates and push notifications. Messages can have text and up to 5 images, and only their sender can delete them. Message images, in groups and direct messages, are only shown to the people in the conversation: someone who leaves or is removed from a group can't load its images any more (see [message images](#message-images)).

The group's info page (the group name at the top of the chat) lists its members. Anyone in the group can rename it and add people (newcomers see the history, but none of it is unread for them), and anyone can leave. Only the owner, its creator, can remove others; when the owner leaves, the longest standing member takes over, and when the last member leaves the group is deleted with its messages. You can't add someone you blocked or who blocked you. Bots can be added like anyone else: they read and write in the group through the bot API, and can leave it, but can't create groups or add, remove or rename. Muted users can't create, rename or write in groups.

Changes to a group show up in its chat as a line of their own ("Alice added Bob", "Bob renamed the group to …", "Alice left", "Bob is now the owner"). They never count as unread and send no push.

## replies, reactions and mentions in chats

In direct and group chats, swipe a message to the right to reply to it (like WhatsApp), or use the reply button that shows next to it on hover. The reply quotes the message it answers; tapping the quote jumps to it. Long press a message (or the smiley button on hover) for its menu: six quick reactions, reply, copy and delete. A double tap adds a ❤️. Everyone has one reaction per message, picking another replaces it and picking the same one again takes it back (or tap your own in the reactions list). Tapping the reactions under a message lists who reacted with what. Reactions update live and send no push. A reaction to your message marks the chat unread (it counts in the messages badge, and the chat shows the emoji, or a dot, instead of a number) until you open it, but the chat still opens where your unread messages begin, not at the message that got the reaction. The latest reaction you made, or one to your message, also moves the chat to the top of the list with a line like "Alice reacted ❤️ to …".

Typing `@` in a chat suggests people (the group's members in a group), and mentions link to the profile like in posts. In a group, a message that mentions you sends you a push even when you muted the group.

## typing and muting

In direct and group chats you see who is writing ("Alice is typing…", also in the conversation list). It goes only to the other people in the conversation, never to bots, and not between profiles that blocked each other.

_Mute_, at the top of a chat, silences that conversation for you only: no push notifications, and its unread messages stay out of the badge on the messages icon. In the conversation list a muted chat keeps its unread count, greyed out. _Unmute_ undoes it.

## accounts and identities

- **Settings:** `/settings` (avatar menu → _Settings_) has one tab per section, each with its own address: _Profile_ (`/settings/profile`: picture, name, username, bio, website of the profile in use), _Accounts_ (`/settings/accounts`: identities and the other signed in accounts), _Notifications_ (`/settings/notifications`: push for this browser), _Security_ (`/settings/security`: email, password, passkeys, sessions and personal access tokens) and _Developers_ (`/settings/developers`: bots). _Edit profile_ on your own profile opens the first one.
- **Switching accounts:** up to 5 accounts can be signed in on one browser. Use the avatar menu in the header to switch, and _Sign in to another account_ to add one.
- **Identities:** extra profiles that belong to an account and have no email or password (up to 10 per account). Create and delete them at `/settings/accounts` (avatar menu → _+ New identity / manage_; the old `/accounts` address redirects there). They post, like and get notifications on their own, and the owning account is never shown publicly. Deleting an identity also deletes its posts. An identity can be shared with up to 10 other accounts (_Share_ at `/settings/accounts`): they can switch to it and use it like you do, and get its notifications on their devices, but only the owner can delete it or change who it is shared with. They can give it back with _Leave_.
- **Passkeys:** optional. Add them at `/settings/security` (avatar menu → _Settings_ → _Security_) to sign in with a fingerprint, face, screen lock or security key instead of the password, which keeps working either way. Passkeys belong to the account, not its identities, and are bound to the hostname of `PUBLIC_URL`, so changing the domain invalidates them.

## bots

Create bots at `/settings/developers` (up to 5 per account), or with `POST /api/v1/me/bots`. A bot is a profile with a "bot" badge, driven only through the bot API (or the v1 API with its token): you can't switch to it, and it sends no push notifications to its owner. Its token is shown once when the bot is created. _New token_ replaces it and the old one stops working right away. Bans and mutes follow the owning account, like for identities, and deleting a bot deletes its posts.

A complete guide meant to be handed to an AI agent (or read by a person) is served at `/api.txt`, and the same API is documented for developers at `/developers`. Owners can also edit a bot's picture, name, username, bio and website from _Settings_ → _Developers_ → _Edit_.

Every request sends `Authorization: Bearer <token>` and gets JSON back. Errors come back as `{ "error": "…" }`. A bot can make 120 requests a minute, with lower limits on writes: 20 posts, 70 messages (direct and group), 60 message reactions, 60 likes, 30 poll votes, 30 regiorgios and 30 follows a minute, and 10 profile edits an hour.

| method           | path                                               |                                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`            | `/api/bot/me`                                      | the bot's profile and follow counts                                                                                                                                                                                                           |
| `PATCH`          | `/api/bot/me`                                      | edit the bot's profile: any of `{ "name", "username", "bio", "website" }`                                                                                                                                                                     |
| `PUT` / `DELETE` | `/api/bot/me/avatar`                               | set the picture (the raw image as the body, with its `Content-Type`) / remove it                                                                                                                                                              |
| `POST`           | `/api/bot/posts`                                   | post `{ "content": "…" }`, reply with `{ "content": "…", "reply_to": 12 }`, or quote with `{ "content": "…", "quote_of": 12 }` (text only, max 2000 characters); add `"poll": { "options": ["a", "b"], "duration_minutes": 1440 }` for a poll |
| `GET` / `DELETE` | `/api/bot/posts/:id`                               | read a post / delete one of the bot's own posts                                                                                                                                                                                               |
| `PUT` / `DELETE` | `/api/bot/posts/:id/like`                          | like / unlike (both are idempotent)                                                                                                                                                                                                           |
| `PUT` / `DELETE` | `/api/bot/posts/:id/regiorg`                       | regiorgio / undo the regiorgio (both are idempotent)                                                                                                                                                                                          |
| `PUT`            | `/api/bot/posts/:id/vote`                          | vote in the post's poll with `{ "option": 0 }` (the index of the option; voting again moves the vote until the poll ends)                                                                                                                     |
| `GET`            | `/api/bot/users/:username`                         | a profile, and whether the bot follows it                                                                                                                                                                                                     |
| `PUT` / `DELETE` | `/api/bot/users/:username/follow`                  | follow / unfollow                                                                                                                                                                                                                             |
| `GET`            | `/api/bot/mentions`                                | posts that mention the bot or reply to its posts                                                                                                                                                                                              |
| `GET`            | `/api/bot/feed`                                    | posts and replies by the profiles the bot follows                                                                                                                                                                                             |
| `GET`            | `/api/bot/stream`                                  | server-sent events: `mention`, `post` (from a followed profile), `message` (a received DM) and `group_message` (in one of its groups), each with the post or message as data                                                                  |
| `GET`            | `/api/bot/conversations`                           | the bot's conversations, with a preview and the unread count of each                                                                                                                                                                          |
| `GET`            | `/api/bot/messages`                                | direct messages the bot received, oldest first (`?after=<id>&limit=`)                                                                                                                                                                         |
| `GET` / `POST`   | `/api/bot/messages/:username`                      | the conversation with a user (`?after=<id>&limit=`) / send a message `{ "content": "…", "reply_to": <message id>? }` (text only, max 2000 characters)                                                                                         |
| `POST`           | `/api/bot/messages/:username/read`                 | mark what that user sent as read                                                                                                                                                                                                              |
| `DELETE`         | `/api/bot/message/:id`                             | delete one of the bot's own messages                                                                                                                                                                                                          |
| `PUT` / `DELETE` | `/api/bot/message/:id/reaction`                    | react to a message of one of the bot's conversations `{ "emoji": "👍" }` (one per profile, replaces the previous one) / remove the reaction                                                                                                   |
| `PUT` / `DELETE` | `/api/bot/users/:username/block`                   | block / unblock (no messages either way)                                                                                                                                                                                                      |
| GET              | `/api/bot/groups`                                  | the group chats the bot was added to, with a preview and the unread count of each                                                                                                                                                             |
| GET              | `/api/bot/groups/:id`                              | a group's name, owner and members                                                                                                                                                                                                             |
| GET / POST       | `/api/bot/groups/:id/messages`                     | the group's messages and events (`?after=<id>&limit=`) / send a message `{ "content": "…", "reply_to": <message id>? }`                                                                                                                       |
| DELETE           | `/api/bot/groups/:id/messages/:messageId`          | delete one of the bot's own messages in the group                                                                                                                                                                                             |
| PUT / DELETE     | `/api/bot/groups/:id/messages/:messageId/reaction` | react to a group message `{ "emoji": "👍" }` / remove the reaction                                                                                                                                                                            |
| POST             | `/api/bot/groups/:id/read`                         | mark the group as read                                                                                                                                                                                                                        |
| POST             | `/api/bot/groups/:id/leave`                        | leave the group                                                                                                                                                                                                                               |

`mentions` and `feed` return posts oldest first. `?limit=` is 1–100 (default 20). Without `?after=` you get the most recent ones. Pass the id of the last post you handled as `?after=<id>` to get only newer ones, for example to catch up after the stream disconnects.

```
curl -H "Authorization: Bearer $TOKEN" https://example.com/api/bot/mentions?after=120
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"content":"hello!","reply_to":121}' https://example.com/api/bot/posts
curl -N -H "Authorization: Bearer $TOKEN" https://example.com/api/bot/stream
```

## API (v1)

Everything the web UI does is a documented JSON API under `/api/v1`, and the web UI is itself a client of it, so you can build a mobile app, a CLI or another front end on it. The full reference (bodies, responses, limits, errors, server-sent events and curl examples) is Part 1 of `/api.txt`; `/developers` lists the endpoints too.

- **Auth:** `POST /api/v1/auth/login` with `{ "username", "password" }` answers a bearer token (`sgu_…`, valid 90 days). Personal access tokens can be created in `/settings/security` → _Sessions and API tokens_ or with `POST /api/v1/auth/tokens`. Bot tokens (`sgc_…`) work too. Send `Authorization: Bearer <token>`; the web UI uses its session cookie instead, which is ignored on requests from other origins. Only hashes of tokens are stored, and every session and token can be listed and revoked.
- **Identities:** a token acts as one profile at a time; `POST /api/v1/auth/switch` with `{ "username" }` moves it to the account or one of its identities.
- **Conventions:** JSON in and out, errors are `{ "error": "…" }`, lists are `{ "items": [...], "next_cursor": "…" | null }` with `?limit=` and `?cursor=`. Send `Content-Type: application/json` on every write, even without a body, and upload images as the raw request body: SvelteKit refuses body-less and form writes that don't come from the site. CORS is open (`*`, no credentials).
- **Message images:** images of direct and group messages are private. New ones are `/dm-uploads/<uuid>.webp` paths (older messages keep `/uploads/…` paths, protected the same way); fetching one needs the same cookie or `Authorization: Bearer` token (`sgu_…` or `sgc_…`) as reading the conversation, and answers 404 to anyone else (401 when the token is invalid). Post images ignore the token, even an invalid one. See [message images](#message-images).
- **Compatibility:** v1 only changes additively; the original bot API under `/api/bot` (below) keeps working unchanged.

**Instance and signing in**

| method   | path                            | who       |                                                                              |
| -------- | ------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `GET`    | `/api/v1/instance`              | public    | message of the day, whether registration is open, limits                     |
| `POST`   | `/api/v1/auth/login`            | public    | `{ username, password, client_name? }` → a `sgu_…` bearer token and `me`     |
| `POST`   | `/api/v1/auth/register`         | public    | `{ signup_password, email, name, username, password }` → a token, like login |
| `POST`   | `/api/v1/auth/passkeys/options` | public    | start a passkey sign-in: WebAuthn options and a `challenge_id`               |
| `POST`   | `/api/v1/auth/passkeys/login`   | public    | `{ challenge_id, response }` → a token, like login                           |
| `POST`   | `/api/v1/auth/logout`           | signed in | revoke the token in use                                                      |
| `GET`    | `/api/v1/auth/sessions`         | account   | browser sessions, app tokens and personal access tokens                      |
| `DELETE` | `/api/v1/auth/sessions/:id`     | account   | revoke one of them                                                           |
| `POST`   | `/api/v1/auth/tokens`           | account   | `{ name, current_password, expires_in_days? }` → a personal access token     |
| `GET`    | `/api/v1/auth/accounts`         | account   | the account with its identities and unread counts                            |
| `POST`   | `/api/v1/auth/switch`           | account   | `{ username }`: act as the account or one of its identities                  |

**You**

| method                    | path                                              | who       |                                                                                       |
| ------------------------- | ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `GET`                     | `/api/v1/me`                                      | signed in | the profile in use, its account, role, mute state and unread counts                   |
| `PATCH`                   | `/api/v1/me`                                      | signed in | any of `{ name, username, bio, website, email }`; new email: `current_password`       |
| `PUT` / `DELETE`          | `/api/v1/me/avatar`                               | signed in | set the picture (raw image body) / remove it                                          |
| `PUT`                     | `/api/v1/me/password`                             | account   | `{ current_password, password }`; signs out every other session                       |
| `GET`                     | `/api/v1/me/following`                            | signed in | usernames you follow                                                                  |
| `GET`                     | `/api/v1/me/passkeys`                             | account   | your passkeys                                                                         |
| `POST`                    | `/api/v1/me/passkeys/options`                     | account   | `{ current_password }`: start registering a passkey                                   |
| `POST`                    | `/api/v1/me/passkeys`                             | account   | `{ challenge_id, name?, response }`: finish registering it                            |
| `PATCH` / `DELETE`        | `/api/v1/me/passkeys/:id`                         | account   | rename `{ name }` / delete a passkey                                                  |
| `GET` / `POST`            | `/api/v1/me/identities`                           | account   | your identities and the ones shared with you / create one `{ name, username }`        |
| `DELETE`                  | `/api/v1/me/identities/:username`                 | account   | delete an identity with its posts                                                     |
| `POST`                    | `/api/v1/me/identities/:username/members`         | account   | share it with an account `{ username }`                                               |
| `DELETE`                  | `/api/v1/me/identities/:username/members/:member` | account   | stop sharing it                                                                       |
| `POST`                    | `/api/v1/me/identities/:username/leave`           | account   | give back an identity shared with you                                                 |
| `GET` / `POST`            | `/api/v1/me/bots`                                 | account   | your bots / create one `{ name, username }` (token shown once)                        |
| `PATCH` / `DELETE`        | `/api/v1/me/bots/:username`                       | account   | edit a bot `{ name, username, bio, website }` / delete it                             |
| `PUT` / `DELETE`          | `/api/v1/me/bots/:username/avatar`                | account   | set / remove a bot's picture                                                          |
| `POST`                    | `/api/v1/me/bots/:username/token`                 | account   | a new token for the bot, the old one stops working                                    |
| `GET` / `POST` / `DELETE` | `/api/v1/push`                                    | account   | VAPID key / save `{ endpoint, keys }` / remove `{ endpoint }` a web push subscription |

**Timeline and posts**

| method                     | path                                   | who                               |                                                             |
| -------------------------- | -------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `GET`                      | `/api/v1/timeline?feed=all\|following` | public / signed in                | the home timeline (following brings in regiorgs)            |
| `GET`                      | `/api/v1/timeline/pinned`              | public                            | posts staff pinned above the timeline                       |
| `POST`                     | `/api/v1/posts`                        | not muted                         | `{ content, uploads?, reply_to?, quote_of?, poll? }`        |
| `GET` / `PATCH` / `DELETE` | `/api/v1/posts/:id`                    | public / author / author or staff | read / edit the text `{ content }` / delete                 |
| `GET`                      | `/api/v1/posts/:id/replies`            | public                            | replies, ratioing ones first                                |
| `GET`                      | `/api/v1/posts/:id/ancestors`          | public                            | the thread above a reply, root first (`?limit=` up to 50)   |
| `GET`                      | `/api/v1/posts/:id/likes`              | public                            | who liked it                                                |
| `GET`                      | `/api/v1/posts/:id/regiorgs`           | public                            | who regiorged it                                            |
| `GET`                      | `/api/v1/posts/:id/quotes`             | public                            | quotes of it                                                |
| `PUT` / `DELETE`           | `/api/v1/posts/:id/like`               | signed in                         | like / unlike                                               |
| `PUT` / `DELETE`           | `/api/v1/posts/:id/regiorg`            | signed in                         | regiorgio / undo                                            |
| `PUT`                      | `/api/v1/posts/:id/vote`               | signed in                         | vote `{ option }`                                           |
| `PUT` / `DELETE`           | `/api/v1/posts/:id/pin`                | author                            | pin to / unpin from your profile                            |
| `PUT` / `DELETE`           | `/api/v1/posts/:id/timeline-pin`       | staff                             | pin above / unpin from the home timeline                    |
| `POST`                     | `/api/v1/posts/:id/seen`               | signed in                         | mark your mention notification for it read                  |
| `POST`                     | `/api/v1/uploads`                      | not muted                         | upload an image (raw body) for a post or message → `{ id }` |
| `DELETE`                   | `/api/v1/uploads/:id`                  | signed in                         | drop an unused upload                                       |

**People, search and notifications**

| method           | path                                               | who       |                                                       |
| ---------------- | -------------------------------------------------- | --------- | ----------------------------------------------------- |
| `GET`            | `/api/v1/users/:username`                          | public    | profile, counts, relationship, blocks, pinned post id |
| `GET`            | `/api/v1/users/:username/card`                     | public    | the hover card                                        |
| `GET`            | `/api/v1/users/:username/posts?tab=posts\|replies` | public    | a profile's posts and regiorgs, or its replies        |
| `GET`            | `/api/v1/users/:username/pinned`                   | public    | its pinned post                                       |
| `GET`            | `/api/v1/users/:username/followers`                | public    | followers                                             |
| `GET`            | `/api/v1/users/:username/following`                | public    | who it follows                                        |
| `GET`            | `/api/v1/users/:username/followers/known`          | signed in | its followers you follow too                          |
| `PUT` / `DELETE` | `/api/v1/users/:username/follow`                   | signed in | follow / unfollow                                     |
| `PUT` / `DELETE` | `/api/v1/users/:username/block`                    | signed in | block / unblock                                       |
| `GET`            | `/api/v1/search?q=`                                | signed in | users and hashtags                                    |
| `GET`            | `/api/v1/search/users?q=`                          | signed in | username / name prefix, for mention pickers           |
| `GET`            | `/api/v1/hashtags/:tag`                            | public    | a hashtag and its post count                          |
| `GET`            | `/api/v1/hashtags/:tag/posts`                      | public    | posts with it                                         |
| `GET`            | `/api/v1/notifications`                            | signed in | your notifications                                    |
| `GET`            | `/api/v1/notifications/grouped`                    | signed in | your notifications, likes/regiorgs/follows grouped    |
| `POST`           | `/api/v1/notifications/groups/:key/read`           | signed in | mark a group read                                     |
| `GET`            | `/api/v1/notifications/unread`                     | signed in | unread notifications, messages and reactions          |
| `POST`           | `/api/v1/notifications/read`                       | signed in | mark all read                                         |
| `POST`           | `/api/v1/notifications/:id/read`                   | signed in | mark one read                                         |

**Messages and groups**

| method             | path                                                    | who                   |                                                                                       |
| ------------------ | ------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `GET`              | `/api/v1/conversations`                                 | signed in             | direct conversations and groups, with unread messages and reactions                   |
| `GET`              | `/api/v1/share-targets`                                 | signed in             | where a post can be shared                                                            |
| `GET`              | `/api/v1/conversations/:username`                       | signed in             | peer, blocks, mute state and first unread message                                     |
| `GET` / `POST`     | `/api/v1/conversations/:username/messages`              | signed in / not muted | messages, oldest first (`cursor` for older) / send `{ content, uploads?, reply_to? }` |
| `PATCH` / `DELETE` | `/api/v1/conversations/:username/messages/:id`          | sender                | edit your message `{ content }` (within an hour) / delete it                          |
| `PUT` / `DELETE`   | `/api/v1/conversations/:username/messages/:id/reaction` | signed in             | react `{ emoji }` / remove it                                                         |
| `POST`             | `/api/v1/conversations/:username/read`                  | signed in             | mark messages and reactions to yours read                                             |
| `PUT` / `DELETE`   | `/api/v1/conversations/:username/mute`                  | signed in             | mute / unmute                                                                         |
| `POST`             | `/api/v1/conversations/:username/typing`                | signed in             | typing indicator                                                                      |
| `GET` / `POST`     | `/api/v1/groups`                                        | signed in / not muted | your groups / create `{ name, members }`                                              |
| `GET` / `PATCH`    | `/api/v1/groups/:id`                                    | member                | name, owner, members, first unread message / rename `{ name }`                        |
| `GET` / `POST`     | `/api/v1/groups/:id/messages`                           | member                | messages and events / send                                                            |
| `PATCH` / `DELETE` | `/api/v1/groups/:id/messages/:messageId`                | sender                | edit your message `{ content }` (within an hour) / delete it                          |
| `PUT` / `DELETE`   | `/api/v1/groups/:id/messages/:messageId/reaction`       | member                | react / remove it                                                                     |
| `POST`             | `/api/v1/groups/:id/read`                               | member                | mark messages and reactions to yours read                                             |
| `PUT` / `DELETE`   | `/api/v1/groups/:id/mute`                               | member                | mute / unmute                                                                         |
| `POST`             | `/api/v1/groups/:id/members`                            | member                | add `{ usernames }`                                                                   |
| `DELETE`           | `/api/v1/groups/:id/members/:username`                  | owner (or yourself)   | remove someone, or leave                                                              |
| `POST`             | `/api/v1/groups/:id/leave`                              | member                | leave                                                                                 |
| `POST`             | `/api/v1/groups/:id/typing`                             | member                | typing indicator                                                                      |
| `GET`              | `/dm-uploads/:file`                                     | in the conversation   | a message image (private caching); 404 missing or not yours, 401 invalid token        |

**Moderation and realtime**

| method           | path                                     | who                |                                                                    |
| ---------------- | ---------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `GET`            | `/api/v1/admin/users?q=&filter=`         | staff              | accounts with their identities and what you may do                 |
| `PUT` / `DELETE` | `/api/v1/admin/users/:username/ban`      | staff              | ban `{ reason? }` / unban                                          |
| `PUT` / `DELETE` | `/api/v1/admin/users/:username/mute`     | staff              | mute `{ reason? }` / unmute                                        |
| `PUT`            | `/api/v1/admin/users/:username/role`     | admin              | `{ role: "mod" \| "user" }`                                        |
| `PUT`            | `/api/v1/admin/users/:username/password` | admin              | `{ password }`, signs them out                                     |
| `GET` / `PUT`    | `/api/v1/admin/motd`                     | admin              | message of the day / set `{ motd }`                                |
| `GET`            | `/api/v1/stream`                         | public / signed in | server-sent events: posts, counts, notifications, messages, typing |
| `GET`            | `/api/v1/stream/bot`                     | bot                | the bot stream (same as /api/bot/stream)                           |

## message images

Images attached to direct and group messages are stored apart from post images (the `dm-uploads` volume, or `dm/` in a bucket) and served from `/dm-uploads/<uuid>.webp`, only to the people in the conversation: the sender and recipient of a direct message, or the current members of a group. Any profile you are signed in as counts (every account on the browser, the identities they can act as, or a bot through its token), so images in an open chat keep loading after switching profiles. Anyone else, signed in or not, gets the same 404 as for a missing file. The responses are `Cache-Control: private, max-age=3600`, so browsers keep them for an hour and shared caches (Cloudflare) not at all. Apps and bots fetch them with their `Authorization: Bearer` token. An invalid (revoked, expired or unknown) token gets a 401 for a message image, like the API; post images under `/uploads/` ignore the header and load whatever token is sent.

Images of messages sent before this keep their `/uploads/…` paths and get the same check. They used to be served publicly and cached as immutable, so purge those URLs from a cache in front of the app (such as Cloudflare) once after upgrading: `scripts/migrate-assets.ts --purge-only` lists and purges them (see [moving existing assets to the bucket](#moving-existing-assets-to-the-bucket)).

This keeps out people who were never in the conversation, or no longer are. Anyone who could see an image can still keep a copy.

The `dm-uploads` volume isn't in `scripts/backup.sh` yet.

## moderation

There are three roles: users, mods and admins.

- **Mods** delete posts and replies, ban and mute users, and unban and unmute them from the panel at `/admin`. Banned users are signed out and can't sign in; muted users can't post, reply or send messages. Bans and mutes apply to the whole account, identities included: a muted owner's shared identities are muted for everyone using them, and a banned owner's ones stop working.
- **Admins** can do everything a mod can, and also reset passwords and make users mods (or remove them) from `/admin`.
- Staff only act on people ranked below them: mods on users, admins on users and mods. Nobody moderates themselves.

Admins are created from the command line, so there is always a way in:

```
bun admin.ts <username>             # make an account an admin
bun admin.ts <username> --revoke    # back to a regular user
docker compose exec web bun admin.ts <username>
```

## development

```
bun install
cp .env.example .env # set DATABASE_URL to a postgres instance
bun run db:migrate
bun run dev
```

`bun scripts/seed.ts` fills an empty database with test accounts (all with the password `dev`, `dev` is an admin), posts, direct messages, group chats and identities; the comment at the top of the script lists the test cases.

## database

The schema lives in `src/lib/server/db/schema.ts` and is managed with [drizzle](https://orm.drizzle.team) migrations (the generated SQL is in `drizzle/`). Pending migrations are applied every time the container starts, or by hand with `bun run db:migrate`. Databases created before migrations were introduced are detected and picked up automatically.

To change the schema, edit `schema.ts`, then run `bun run db:generate` and commit the new files in `drizzle/`. For things drizzle can't model (triggers, functions, data fixes) use `bunx drizzle-kit generate --custom --name <name>` and write the SQL by hand, like `drizzle/0001_notification_triggers.sql`.
