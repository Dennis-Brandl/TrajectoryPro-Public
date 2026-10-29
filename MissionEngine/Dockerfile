# =============================================================================
# Mission Engine — Production Docker Image
#
# Mission Control Suite app: the worker process that executes runtime-workflow
# instances the Command Module queues (ISA-88 control recipes) against the
# shared Mission Control Postgres database. Also hosts the operator-facing
# HTTP API (phase 4a) and now serves the built Mission Pilot PWA at / on top
# of it (phase 4b) — this is no longer just a liveness probe; see the health
# endpoint below for the worker-only check.
#
# IMPORTANT — BUILD CONTEXT must be the WORKSPACE ROOT that holds
# MissionEngine + mission-control-db + MissionFormKit +
# MissionPilot as siblings. The engine consumes mission-control-db
# via a `file:` dep as TypeScript SOURCE (not a published package), same layout
# requirement as MissionCommander's own Dockerfile (read that one first
# — this mirrors it). The Pilot build stage below similarly consumes
# MissionFormKit's form-renderer/form-schema/form-tokens via `file:` deps.
# The root .dockerignore keeps the context small and MUST re-include all four
# directories (`!MissionEngine`, `!mission-control-db`,
# `!MissionFormKit`, `!MissionPilot`) or the COPY steps below
# fail with "not found".
#
# Quick start (from the workspace root):
#   docker compose build mission-engine
#   docker compose up -d mission-engine
#
# Manual build (from the workspace root):
#   docker build -f MissionEngine/Dockerfile -t mission-engine .
#
# Environment variables:
#   ENGINE_PORT                  Health-check port (default: 3006)
#   DATABASE_URL                 PostgreSQL connection string (required) — the SAME
#                                 database the Command Module migrates; this image runs
#                                 NO migrations of its own and depends on the Command
#                                 Module having already applied them.
#   ACTION_SERVER_ALLOWLIST      Comma-separated action-server origins the engine is
#                                 permitted to dispatch ACTION PROXY steps to.
#   ENGINE_WORKER_CONCURRENCY, SCRIPT_TIMEOUT_MS, ACTION_POLL_SECS, INVOKE_GRACE_SECS
#                                 Tuning knobs — see src/config.ts for defaults.
#
# No migrations, no seed, no local disk state: the engine only ever talks to
# Postgres (and, for ACTION PROXY steps, allow-listed action servers) — nothing here
# needs a volume.
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
COPY MissionEngine/package.json MissionEngine/package-lock.json ./MissionEngine/
RUN cd MissionEngine && npm ci

# ---- App source.
COPY MissionEngine ./MissionEngine

WORKDIR /app/MissionEngine

# Bundle the worker into one standalone ESM file. The createRequire banner is what
# lets bundled CJS-only transitive deps (pg and friends) resolve at runtime inside
# an ESM bundle — same trick MissionCommander's Dockerfile uses.
RUN npx esbuild src/index.ts \
      --bundle --platform=node --format=esm --outfile=engine.mjs \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ---- Pilot PWA (phase 4b): built here, served by the engine at / (spec F4).
#      FormKit ships TS-source packages consumed via file: links; tokens must be
#      compiled first (its build script is dependency-free node). form-renderer
#      and form-schema's own third-party deps (react, ajv, ajv-formats,
#      dompurify) are NOT installed by the Pilot's own `npm ci` — a `file:`
#      dep only symlinks the package, it never installs that package's deps.
#      Module resolution walks up from the symlink target to FormKit's OWN
#      node_modules, so a full FormKit workspace `npm ci` here is required —
#      same fix MissionDesigner/Dockerfile already applies for the identical
#      problem (see its Stage 1 comment).
WORKDIR /app
COPY MissionFormKit ./MissionFormKit
RUN cd MissionFormKit && npm ci
RUN cd MissionFormKit/packages/form-tokens && npm run build
COPY MissionPilot/package.json MissionPilot/package-lock.json ./MissionPilot/
RUN cd MissionPilot && npm ci
COPY MissionPilot ./MissionPilot
# vite.config's outDir already targets ../MissionEngine/public — inside this
# build stage that resolves to /app/MissionEngine/public.
RUN cd MissionPilot && npm run build

# ---------------------------------------------------------------------------
# Stage 2: Production
# ---------------------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/MissionEngine/engine.mjs ./engine.mjs
COPY --from=builder /app/MissionEngine/public ./public

# Non-root runtime user.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
 && chown -R appuser:appgroup /app
USER appuser

ENV NODE_ENV=production
ENV ENGINE_PORT=3006
EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3006/health || exit 1

ENTRYPOINT ["node", "engine.mjs"]
