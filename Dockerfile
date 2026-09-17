# The editor image carries the player with it.
#
# One origin serves both (see nginx.conf): the editor from the Node server, the
# Flutter web build under /player/. Building them together means the preview can
# never drift from the player a student actually runs — which is the one thing that
# would make the preview a liar.
#
# The build context is the workspace root, which holds both repositories:
#
#     docker build -f editor/Dockerfile -t edu-editor .

# ── Stage 1: the player ────────────────────────────────────────────────────
FROM ghcr.io/cirruslabs/flutter:stable AS player

WORKDIR /app
# The app repository, checked out alongside the editor in the build context.
COPY EDU-AI-asistent-APP/ ./

ARG API_URL=https://app-api.edu-ai.eu
RUN flutter pub get
RUN flutter build web --release --base-href /player/ \
    --dart-define=API_URL=${API_URL}

# ── Stage 2: the editor ────────────────────────────────────────────────────
FROM node:22-alpine AS editor

WORKDIR /app
COPY editor/package*.json ./
RUN npm ci
COPY editor/ ./
RUN npm run build && npm prune --omit=dev

# ── Stage 3: what actually runs ────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache nginx gettext

WORKDIR /app
COPY --from=editor /app/build ./build
COPY --from=editor /app/node_modules ./node_modules
COPY --from=editor /app/package.json ./
COPY --from=player /app/build/web /usr/share/nginx/player

COPY editor/nginx.conf /etc/nginx/templates/default.conf.template
COPY editor/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=8080
ENV API_URL=https://app-api.edu-ai.eu
EXPOSE 8080

ENTRYPOINT ["docker-entrypoint.sh"]
