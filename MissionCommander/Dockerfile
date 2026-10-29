# =============================================================================
# Mission Commander — Production Docker Image
#
# Mission Control Suite app: the repository of workflow/environment packages
# exported from Designer, plus work-center dispatch (React + Hono + PostgreSQL).
#
# IMPORTANT — BUILD CONTEXT must be the WORKSPACE ROOT that holds
# MissionCommander + mission-control-db as siblings. The app consumes
# mission-control-db via a `file:` dep as TypeScript SOURCE (not a published
# package), so the builder has to reproduce that dev layout. The root
# .dockerignore keeps the context small.
#
# Quick start (from the workspace root):
#   docker compose up --build -d mission-commander
#   Open http://localhost:3005
#
# Manual build (from the workspace root):
#   docker build -f MissionCommander/Dockerfile -t mission-commander .
#
# Environment variables:
#   PORT                 Server port (default: 3005 here; code default is 3002)
#   DATABASE_URL         PostgreSQL connection string (required)
#   BASE_URL             Public origin; better-auth signs cookies against it
#   BETTER_AUTH_SECRET   Session signing secret (auto-generated into /data if unset)
#   ALLOWED_ORIGINS      Comma-separated extra CORS origins (localhost is always allowed)
#   SEED_DEMO            "true" creates the three demo logins on boot. OFF by
#                        default: seeding creates an administrator, which closes the
#                        first-run sign-up gate and replaces the "create the first
#                        administrator" screen with a sign-in form.
#
# First run:
#   With SEED_DEMO unset, the app has no administrator, so it opens on /setup and
#   asks you to create one — the same first-run flow as Designer. Once that account
#   exists, public sign-up closes and further logins are minted by an administrator
#   from the Users screen (which can grant the administrator level too).
#
# Data persistence:
#   All application state lives in Postgres. The /data volume persists only the
#   auto-generated auth secret, so sessions survive a container restart.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# ---- mission-control-db first: it is a `file:` dependency resolved as TS source,
#      so it must exist at its sibling path before the app's `npm ci` runs.
COPY mission-control-db/package.json mission-control-db/package-lock.json ./mission-control-db/
RUN cd mission-control-db && npm ci
COPY mission-control-db ./mission-control-db

# ---- App dependency manifests (layer-cached unless they change).
COPY MissionCommander/package.json MissionCommander/package-lock.json ./MissionCommander/
RUN cd MissionCommander && npm ci

# ---- App source.
COPY MissionCommander ./MissionCommander

WORKDIR /app/MissionCommander

# Help guide first (HELP.md -> public/help.html; generated, not tracked), then the
# frontend -> dist/. Vite copies public/ into dist/, so help.html ships in the image.
# TanStack Router's Vite plugin regenerates routeTree.gen.ts during this build, so a
# stale checked-in copy cannot poison the image.
# The Pilot's curated fonts (spec 2026-10-09 §10) are copied into public/fonts/ for the theme preview.
RUN node scripts/build-help.mjs && node scripts/copy-fonts.mjs && npx vite build

# Bundle the server, the migrator, and the seeder into standalone ESM files. The
# createRequire banner is what lets bundled CJS-only transitive deps (pg and friends)
# resolve at runtime inside an ESM bundle.
RUN npx esbuild src/server/index.ts \
      --bundle --platform=node --format=esm --outfile=server.mjs \
      --external:jsdom \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
 && npx esbuild docker/migrate.mjs \
      --bundle --platform=node --format=esm --outfile=migrate.mjs \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
 && npx esbuild src/server/seed.ts \
      --bundle --platform=node --format=esm --outfile=seed.mjs \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# jsdom (the SVG logo cleaner, spec 2026-10-09 §12) cannot be bundled — it resolves files next
# to itself at runtime — so server.mjs imports it and the image carries it, at exactly the
# version the tests ran against.
RUN mkdir /app/server-deps && cd /app/server-deps \
 && echo '{"private":true}' > package.json \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock \
      "jsdom@$(node -p "require('/app/MissionCommander/node_modules/jsdom/package.json').version")"

# ---------------------------------------------------------------------------
# Stage 2: Production
# ---------------------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app

# Bundled entry points + built frontend. index.ts serves ./public when it finds
# an index.html there, so the API and the UI share one origin and one port.
COPY --from=builder /app/MissionCommander/server.mjs ./server.mjs
COPY --from=builder /app/MissionCommander/migrate.mjs ./migrate.mjs
COPY --from=builder /app/MissionCommander/seed.mjs ./seed.mjs
COPY --from=builder /app/MissionCommander/dist ./public

# Runtime dependencies esbuild leaves external (jsdom, above).
COPY --from=builder /app/server-deps/node_modules ./node_modules

# Generated migration SQL — read at runtime by migrate.mjs, not bundled into it.
COPY --from=builder /app/mission-control-db/drizzle ./drizzle

COPY MissionCommander/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Non-root runtime user.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
 && mkdir -p /data && chown -R appuser:appgroup /app /data
USER appuser

ENV NODE_ENV=production
ENV PORT=3005
EXPOSE 3005

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3005/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
