# =============================================================================
# Mission Designer — Production Docker Image
#
# Full-stack workflow authoring application (React + Hono + PostgreSQL).
# Multi-stage build: compile TypeScript + bundle frontend, then copy artifacts
# into a minimal Alpine image with only the Node.js runtime.
#
# IMPORTANT — BUILD CONTEXT must be the WORKSPACE ROOT that holds
# MissionDesigner + MissionFormKit as siblings. Designer consumes the
# @mission/form-* packages via file: deps on the sibling MissionFormKit
# checkout (as TypeScript source), so the builder reproduces that dev layout.
# See docs/superpowers/specs/2026-07-22-docker-formkit-packaging-design.md.
#
# Quick Start (from MissionDesigner/, whose compose sets context: .. for you):
#   docker compose up --build -d
#   Open http://localhost:3000
#
# Manual Build (run from the workspace root that holds both repos as siblings):
#   docker build -f MissionDesigner/Dockerfile -t mission-designer .
#
# Environment Variables:
#   PORT                 Server port (default: 3000)
#   DATABASE_URL         PostgreSQL connection string (provided by compose mission-designer-postgres service)
#   BETTER_AUTH_SECRET   Session signing secret (auto-generated if not set)
#   ALLOWED_ORIGINS      Comma-separated CORS origins for remote access
#
# Data Persistence:
#   The database is a separate Postgres service (via DATABASE_URL). The /data
#   volume persists only the auto-generated auth secret across restarts.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
ENV HUSKY=0
WORKDIR /app

# ---- FormKit: reproduce its install so its packages' third-party deps (ajv,
#      ajv-formats, dompurify) resolve from FormKit's OWN node_modules. Vite
#      follows the file: symlinks to FormKit's real path when bundling its TS
#      source, so those deps must live in FormKit's tree — exactly as in the dev
#      checkout (react/react-dom collapse to Designer's single copy via
#      resolve.dedupe). tsconfig.base.json is required because each package
#      tsconfig `extends` it. This builder stage is discarded, so FormKit's
#      devDeps never reach the final image.
COPY MissionFormKit/package.json MissionFormKit/package-lock.json MissionFormKit/tsconfig.base.json ./MissionFormKit/
COPY MissionFormKit/packages ./MissionFormKit/packages
COPY MissionFormKit/apps ./MissionFormKit/apps
RUN cd MissionFormKit && npm ci

# ---- Designer: dependency manifests + workspace members (cached unless these
#      change). The @mission/form-* file: link targets already exist above.
COPY MissionDesigner/package.json MissionDesigner/package-lock.json MissionDesigner/.npmrc ./MissionDesigner/
COPY MissionDesigner/packages ./MissionDesigner/packages
RUN cd MissionDesigner && npm ci

# ---- Designer source.
COPY MissionDesigner ./MissionDesigner

# Build design tokens, then the frontend. FormKit's form-tokens CSS
# (dist/form-tokens.{light,dark}.css) is imported by the v2 designer and MUST be
# generated first; then Designer's own @mission/tokens; then the in-app Help
# guide (HELP.md -> public/help.html); then Vite. Vite copies public/ into dist/,
# so help.html ships in the image.
RUN cd MissionDesigner \
  && node ../MissionFormKit/packages/form-tokens/scripts/build.mjs \
  && npm -w @mission/tokens run build \
  && npm run build:help \
  && npx vite build

# Bundle server into a single ESM file
RUN cd MissionDesigner && npx esbuild src/server/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=server.mjs \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ---------------------------------------------------------------------------
# Stage 2: Production
# ---------------------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app

# Copy bundled server and built frontend
COPY --from=builder /app/MissionDesigner/server.mjs ./server.mjs
COPY --from=builder /app/MissionDesigner/dist ./public

# Copy and prepare entrypoint script
COPY MissionDesigner/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN mkdir -p /data && chown -R appuser:appgroup /app /data
USER appuser

ENV NODE_ENV=production
EXPOSE 3000

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
