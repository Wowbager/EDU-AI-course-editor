# The editor image carries the player with it.
#
# One origin serves both (see nginx.conf): the editor from the Node server, the
# Flutter web build under /player/. Building them together means the preview can
# never drift from the player a student actually runs — which is the one thing that
# would make the preview a liar.
#
# The build context is this directory, so a clone of the editor alone is enough:
#
#     docker build -t edu-editor .

# ── Stage 1: the player ────────────────────────────────────────────────────
FROM ghcr.io/cirruslabs/flutter:stable AS player

WORKDIR /app
# The player is cloned, at a pinned commit, rather than copied from a sibling
# directory in the build context.
#
# It used to be `COPY EDU-AI-asistent-APP/ ./`, which meant the image could only be
# built on a machine that happened to have the app checked out next to the editor —
# and, worse, with the *right* checkout: `lib/preview/` (the preview channel, page,
# expanded card view and lesson player — everything this editor's preview column
# talks to) exists in no published branch of `edu-ai-00/EDU-AI-asistent-APP`. A clean
# clone of the editor could not build an image at all, and nothing said so.
#
# PLAYER_REF is a commit, not a branch, on purpose: the preview is this editor's
# claim about what a student will see, so which player it was built against has to be
# a fact recorded in this file rather than whatever the fork's default branch held
# that morning. Bump it deliberately when the player changes.
ARG PLAYER_REPO=https://github.com/Wowbager/EDU-AI-asistent-APP.git
ARG PLAYER_REF=10ca89c099d41cbba262af821a227a1281a82237
RUN git clone --no-checkout --filter=blob:none "${PLAYER_REPO}" . \
    && git checkout --detach "${PLAYER_REF}"

ARG API_URL=https://app-api.edu-ai.eu
RUN flutter pub get
# The player is built from the editor's own entry point, `player/preview_main.dart`:
# the app's preview page and nothing else, rather than the whole app (router,
# sign-in, sync) reaching it by a route. The rest of the app is then left out of
# `main.dart.js`. The file says what it does not do and why.
COPY player/preview_main.dart lib/preview_main.dart
# --no-web-resources-cdn: CanvasKit is served from the build, not from gstatic. One
# aborted or blocked CDN request left the player dead and the preview empty.
RUN flutter build web --release --base-href /player/ --no-web-resources-cdn \
    -t lib/preview_main.dart --dart-define=API_URL=${API_URL}

# ── Stage 2: the editor ────────────────────────────────────────────────────
FROM node:22-alpine AS editor

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build && npm prune --omit=dev

# ── Stage 3: what actually runs ────────────────────────────────────────────
FROM node:22-alpine

# nginx-mod-http-brotli: `brotli_static`, which serves the player's precompressed
# `.br` files (below, and nginx.conf).
RUN apk add --no-cache nginx nginx-mod-http-brotli gettext

WORKDIR /app
COPY --from=editor /app/build ./build
COPY --from=editor /app/node_modules ./node_modules
COPY --from=editor /app/package.json ./
COPY --from=player /app/build/web /usr/share/nginx/player

# The player's compiled JS builds the Laravel image-proxy URL itself, at request
# time, so the fix for that proxy's unreliability (see routes/preview-image) can only
# be applied by intercepting the request inside the player's own page — hence
# splicing a shim into its index.html here, the same way `vite-plugin-player.ts` does
# for `npm run dev`, via the one script both share. `nginx.conf` then just serves the
# resulting file; no `sub_filter` or other on-the-fly rewriting involved.
COPY scripts/inject-player-shim.mjs /tmp/inject-player-shim.mjs
COPY src/lib/preview/player-shim.js /tmp/player-shim.js
RUN node /tmp/inject-player-shim.mjs /usr/share/nginx/player/index.html /tmp/player-shim.js \
    && rm /tmp/inject-player-shim.mjs /tmp/player-shim.js

# Every file but index.html moves under /player/<hash>/, named by the build's contents,
# so nginx can let browsers keep them for good (scripts/version-player.mjs). Then each
# is compressed once, at the highest levels, so nginx serves `.br` and `.gz` copies as
# they are instead of gzipping megabytes of JS and wasm per request. Both after the
# shim, which rewrites index.html.
COPY scripts/version-player.mjs scripts/precompress.mjs /tmp/
RUN node /tmp/version-player.mjs /usr/share/nginx/player \
    && node /tmp/precompress.mjs /usr/share/nginx/player \
    && rm /tmp/version-player.mjs /tmp/precompress.mjs

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Course version histories (lib/server/versions/). A volume, so they outlive the
# container; a version is a whole course, so the node server's 512K body limit is
# raised to match the check in lib/server/versions/files.ts (nginx allows the same).
ENV DATA_DIR=/data
ENV BODY_SIZE_LIMIT=8M
RUN mkdir -p /data
VOLUME /data

ENV PORT=8080
ENV API_URL=https://app-api.edu-ai.eu
EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
