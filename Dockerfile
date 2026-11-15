FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
# the public origin is compiled in for the CSRF check (SvelteKit 3 removed the runtime ORIGIN)
ARG PUBLIC_URL
# the SvelteKit app version (the commit, set by the deploy workflow); there is no .git in the build
ARG VERSION
RUN bun run build

FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base
# the social cards are drawn in Manrope (from node_modules), with Noto for emoji and Roboto for
# other scripts
RUN apt-get update \
	&& apt-get install -y --no-install-recommends fonts-roboto fonts-noto-color-emoji fontconfig \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p static/avatars static/uploads data/dm data/previews
# ffmpeg and ffprobe transcode voice notes (src/lib/server/audio.ts): static builds, pinned by
# digest. About 270MB, against about 660MB for Debian's ffmpeg package and its X11/GL libraries
COPY --from=mwader/static-ffmpeg:7.1.1@sha256:11a44711684c0b9f754c047dcd64235b8b52deab251bd0e0a86f22faa160749c /ffmpeg /ffprobe /usr/local/bin/
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json migrate.ts admin.ts ./
COPY scripts/migrate-assets.ts scripts/seed.ts scripts/backfill-image-sizes.ts ./scripts/
COPY drizzle ./drizzle

ENV PORT=7777
# adapter-node defaults to 512K, too small for uploads: a post takes up to 5 images of 10MB
ENV BODY_SIZE_LIMIT=54525952
EXPOSE 7777
# pending database migrations are applied on every start (a no-op when up to date).
# Starts as root only to fix ownership of the avatars, uploads, dm-uploads and previews volumes (older volumes
# were written as root), then drops to the unprivileged bun user for everything else.
CMD ["sh", "-c", "chown -R bun:bun static/avatars static/uploads data/dm data/previews && exec setpriv --reuid=bun --regid=bun --init-groups sh -c 'bun migrate.ts && exec bun build/index.js'"]
