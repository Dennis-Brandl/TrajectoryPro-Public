# =============================================================================
# Mission Broker - Production Docker Image
#
# The action server for the GLOBAL "Distributed Workflow Action Library": lets a running
# workflow create, start, command, watch and read other runtime workflows. Speaks the
# engine's action-server protocol on port 3007; reads and writes the shared Mission Control
# database (the Commander applies the migrations).
#
# BUILD CONTEXT must be the workspace root (MissionBroker + mission-control-db as
# siblings); the root .dockerignore must re-include both.
#
#   docker compose up -d --build --no-deps mission-broker
#
# Environment: DATABASE_URL (required), MISSION_BROKER_TOKEN (required, ≥ 32 chars), BROKER_PORT (3007), BROKER_POLL_MS (5000), BROKER_RETENTION_DAYS (14), BROKER_CORS_ORIGINS (http://localhost:3004,http://127.0.0.1:3004)
# =============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

COPY mission-control-db/package.json mission-control-db/package-lock.json ./mission-control-db/
RUN cd mission-control-db && npm ci
COPY mission-control-db ./mission-control-db

COPY MissionBroker/package.json MissionBroker/package-lock.json ./MissionBroker/
RUN cd MissionBroker && npm ci
COPY MissionBroker ./MissionBroker

WORKDIR /app/MissionBroker
RUN npx esbuild src/index.ts \
      --bundle --platform=node --format=esm --outfile=broker.mjs \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/MissionBroker/broker.mjs ./broker.mjs
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
ENV NODE_ENV=production
ENV BROKER_PORT=3007
EXPOSE 3007
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3007/health || exit 1
ENTRYPOINT ["node", "broker.mjs"]
