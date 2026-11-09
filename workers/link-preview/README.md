# link-preview worker

A Cloudflare Worker that downloads the pages linked in posts and returns their Open Graph tags, for instances with `LINK_PREVIEWS=remote`. Linked sites then see a Cloudflare address instead of the instance's. Setup is in the main README, under "link previews".

The fetching and parsing code is `src/lib/linkPreviewMeta.ts` in the app, shared with `LINK_PREVIEWS=local`, so both modes give the same previews. That file must only use web APIs (no `node:*`, `$app/*` or `#lib` imports), since it's bundled into the worker too.

## API

```
GET /?url=<link>
Authorization: Bearer <LINK_PREVIEWS_SECRET>
```

- `200 { "meta": { "title", "description", "image", "site_name" } }`: the page's tags (`description`, `image` and `site_name` may be `null`, `image` is always https).
- `200 { "meta": null }`: the page has no preview, isn't HTML, failed or took longer than 5 seconds.
- `400`: `url` isn't an http(s) link on the default port.
- `401`: wrong or missing secret, or no `LINK_PREVIEWS_SECRET` set on the worker.
- `405`: not a `GET`.

Nothing is cached here; the app keeps the results in its `link_previews` table.

## Commands

| command                                         | purpose                                          |
| ----------------------------------------------- | ------------------------------------------------ |
| `bun run dev`                                   | run it locally (put the secret in `.dev.vars`)   |
| `bun run deploy`                                | deploy it                                        |
| `bun run check`                                 | typecheck (the app's `bun run check` skips this) |
| `bunx wrangler secret put LINK_PREVIEWS_SECRET` | set the secret                                   |

`SITE_URL` in `wrangler.toml` is optional: when set, the worker names the instance in its user agent, as the app does in `local` mode.
