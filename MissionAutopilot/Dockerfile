# =============================================================================
# Mission Autopilot — Production Docker Image
#
# Builds TWO images from this one file (multi-stage, two targets):
#   - target "server"  : the REST API (Node) + Python sidecar, backed by Postgres
#   - target "console" : the management UI (static SPA) served by nginx
#
# IMPORTANT — BUILD CONTEXT must be the workspace root that holds both
# `MissionAutopilot` and `MissionDesigner` as siblings. The console depends
# on @mission/ui + @mission/tokens (which live in MissionDesigner) via
# file: links, and the console build resolves @mission/ui's OWN third-party
# deps (react, the @radix-ui/* primitives, class-variance-authority, clsx,
# lucide-react, tailwind-merge) from the Designer's install — so the builder
# reproduces the dev layout: install the Designer workspace, build tokens, then
# install + build Autopilot. (Designer's root package.json ALSO declares file:
# deps on the sibling MissionFormKit repo, for the Designer APP's own use of
# @mission/form-renderer/form-schema/form-tokens — but neither
# packages/tokens nor packages/ui needs them, so MissionFormKit is
# deliberately NOT copied into this build context; `npm ci` just leaves those
# entries as harmless dangling symlinks. Verified directly before writing
# this file.)
#
# Recommended — run from inside MissionAutopilot/ (its compose sets the
# parent as context automatically):
#     docker compose up --build -d
#
# Manual — run from the workspace root that holds both repos as siblings:
#     docker build -f MissionAutopilot/Dockerfile --target server  -t mission-autopilot-server  .
#     docker build -f MissionAutopilot/Dockerfile --target console -t mission-autopilot-console .
#
# Ports: server 3002; console 80 (compose maps it to 3003).
#
# The server reads DATABASE_URL at boot — no default is baked into the image,
# compose provides it. There is no local database file anymore (Postgres).
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder — install both workspaces, build tokens, server and console
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
ENV HUSKY=0
WORKDIR /app

# Toolchain for MissionAutopilot's OWN better-sqlite3 devDependency (root
# package.json — used by the one-shot SQLite→Postgres import CLI + its tests,
# NOT by the runtime server). The `pg` driver Postgres itself uses is pure JS
# and needs no native toolchain; this line exists solely because of
# better-sqlite3's install-time native build, which `npm ci` below still runs.
RUN apk add --no-cache python3 make g++

# --- MissionDesigner: install the workspace so @mission/ui's deps and
#     @mission/tokens' build tooling are present for the console build.
#     (Only package manifests + the shared packages are needed — not the app;
#     MissionFormKit is intentionally not part of this build context, see
#     the header comment above.)
COPY MissionDesigner/package.json MissionDesigner/package-lock.json MissionDesigner/.npmrc MissionDesigner/
COPY MissionDesigner/packages MissionDesigner/packages
RUN cd MissionDesigner && npm ci
# Build design tokens → dist CSS (console imports @mission/tokens/dist/*.css)
RUN cd MissionDesigner && npm -w @mission/tokens run build

# --- MissionAutopilot: install, compile server packages, build console ---
COPY MissionAutopilot MissionAutopilot
RUN cd MissionAutopilot && npm ci
# Compile the server's TS project graph (storage + engine + server) → dist
RUN cd MissionAutopilot && npx tsc --build packages/server
# Build the console SPA (Vite only — typecheck is not needed for the artifact)
RUN cd MissionAutopilot/apps/console && npm run build:help && npx vite build
# Bundle the server to one ESM file. pg-native is pg's OPTIONAL native binding
# (never installed here — we run pure-JS pg against Postgres); it must stay
# external or esbuild fails trying to resolve a require() for a package that
# was never installed.
RUN cd MissionAutopilot && npx esbuild packages/server/src/index.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --outfile=server.mjs \
      --external:pg-native \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ---------------------------------------------------------------------------
# Stage 2a: server — Node REST API + Python sidecar (Postgres via DATABASE_URL)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server
WORKDIR /app

# python3 for the action sandbox sidecar (the engine spawns `python`, so add a
# `python` shim). No make/g++ here — the server no longer bundles any native
# Node addon (better-sqlite3 is gone with SQLite; the `pg` driver is pure JS).
RUN apk add --no-cache python3 \
 && ln -sf "$(which python3)" /usr/local/bin/python

# Bundled server
COPY --from=builder /app/MissionAutopilot/server.mjs ./server.mjs

# Python sidecar (stdlib only — no pip install required)
COPY --from=builder /app/MissionAutopilot/packages/python-sidecar ./packages/python-sidecar

# Entrypoint
COPY MissionAutopilot/docker-entrypoint.sh /app/docker-entrypoint.sh
# Normalize line endings: a stale CRLF checkout would make the shebang
# '#!/bin/sh\r' unrunnable (exec: no such file or directory). Strip CR so the
# image never depends on the host's git line-ending state.
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Non-root runtime user. /data is currently UNUSED by the server — all state
# lives in Postgres via DATABASE_URL, and uploaded package archives are
# handled entirely in memory (multer.memoryStorage()) and never touch disk
# (verified: `grep -rn "uploads" packages/server/src` has no matches). The
# mount point + VOLUME below are kept anyway, matching the rest of the
# Mission Suite image family's convention (see docker-entrypoint.sh).
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
 && mkdir -p /data && chown -R appuser:appgroup /app /data
USER appuser

# HOST=0.0.0.0 is container-internal only — the port mapping and the console's
# proxy need it. Host-side exposure is what compose's MISSION_AUTOPILOT_BIND says;
# the server refuses to start if that is non-loopback with no API key configured.
ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0 \
    SIDECAR_SCRIPT=/app/packages/python-sidecar/sandbox_runner.py

EXPOSE 3002
VOLUME ["/data"]

# Probe the /health route (DB connectivity + schema present), not just the TCP
# port — an empty/incomplete database must report unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/health',r=>{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:1))}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# ---------------------------------------------------------------------------
# Stage 2b: console — static management UI via nginx
# ---------------------------------------------------------------------------
FROM nginx:alpine AS console

# SPA + reverse-proxy config. The official nginx image runs envsubst over
# /etc/nginx/templates/*.template at startup, filling ${ACTIONS_API_UPSTREAM}
# (nginx's own $host/$uri are left untouched — they are not env vars).
COPY MissionAutopilot/apps/console/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/MissionAutopilot/apps/console/dist /usr/share/nginx/html

ENV ACTIONS_API_UPSTREAM=http://mission-autopilot-server:3002
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
