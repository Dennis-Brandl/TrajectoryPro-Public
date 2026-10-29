# Mission Autopilot — Docker Specification

## Overview

Mission Autopilot is deployed as **three containers**, not one: a dedicated PostgreSQL database, the REST API server (Node.js + Python sidecar), and the management console (a static React SPA served by nginx, reverse-proxying API calls to the server). One multi-stage `Dockerfile` at the repo root builds two of the three images (`server` and `console` targets); Postgres uses the stock `postgres:17-alpine` image unmodified. `docker-compose.yml`, also at the repo root, wires all three together.

**Build prerequisite**: the console image depends on shared UI packages (`@mission/ui`, `@mission/tokens`) that live in the sibling `MissionDesigner` repository, resolved via `file:` links. The Docker build context is therefore the **parent directory** holding both `MissionAutopilot/` and `MissionDesigner/` as siblings — `docker-compose.yml` sets `context: ..` automatically when run from inside `MissionAutopilot/`. A lone `MissionAutopilot` checkout with no `MissionDesigner` sibling cannot build the console image. See `DOCKER-README.md` for the full walkthrough (build layout, config table, backup/restore, and how to migrate an old SQLite-era volume forward).

---

## 1. Dockerfile

Two build targets from one file (`MissionAutopilot/Dockerfile`), plus a shared builder stage:

```dockerfile
# Stage 1: builder — installs BOTH workspaces (MissionDesigner for
# @mission/ui + @mission/tokens, then MissionAutopilot), builds design
# tokens, compiles the server's TS project graph (storage+engine+server) with
# tsc --build, builds the console SPA with Vite, and bundles the server to a
# single ESM file with esbuild (pg-native kept external — it's pg's optional
# native binding and is never installed; pure-JS pg is used against Postgres).
FROM node:22-alpine AS builder
# ... npm ci (both workspaces) → tsc --build → vite build → esbuild bundle

# Stage 2a: server — Node REST API + Python sidecar, Postgres via DATABASE_URL
FROM node:22-alpine AS server
RUN apk add --no-cache python3 && ln -sf "$(which python3)" /usr/local/bin/python
COPY --from=builder /app/MissionAutopilot/server.mjs ./server.mjs
COPY --from=builder /app/MissionAutopilot/packages/python-sidecar ./packages/python-sidecar
# non-root user; /data mount kept for convention but currently unused (§4.3)
ENV NODE_ENV=production PORT=3002 SIDECAR_SCRIPT=/app/packages/python-sidecar/sandbox_runner.py
EXPOSE 3002
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/health', ...)"
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Stage 2b: console — static management UI via nginx
FROM nginx:alpine AS console
COPY apps/console/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/MissionAutopilot/apps/console/dist /usr/share/nginx/html
ENV ACTIONS_API_UPSTREAM=http://mission-autopilot-server:3002
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
```

Key differences from the pre-Postgres image: no `better-sqlite3` native module ships in the `server` image (`pg` is pure JS — no `python3 make g++` toolchain needed at runtime, only in the builder stage, and only because the _root_ package's `better-sqlite3` devDependency, used solely by the one-shot import CLI and its tests, still triggers an install-time native build there). The server's `HEALTHCHECK` probes `/health` directly (not `/trajectory/v1/health` — the health route is unauthenticated and un-prefixed, see `ArchitectureSpec.md` §3.1). There is no baked-in `DATABASE_URL` default in the image; it must be supplied by the environment (compose does this — see §2).

The console's nginx config (`apps/console/docker/default.conf.template`) reverse-proxies `/trajectory/` and `/management/` to `${ACTIONS_API_UPSTREAM}` (resolved at request time via Docker's embedded DNS, `proxy_buffering off` + a 3600s read timeout to keep SSE streams alive) and forwards `${ACTIONS_API_KEY}` as an `X-API-Key` header — the key never reaches client-side JS. `/` falls through to `try_files ... /index.html` for SPA client-side routing.

Manual build (from the workspace root holding both repos as siblings):

```bash
docker build -f MissionAutopilot/Dockerfile --target server  -t mission-autopilot-server  .
docker build -f MissionAutopilot/Dockerfile --target console -t mission-autopilot-console .
```

---

## 2. Docker Compose

`docker-compose.yml` (repo root) defines three services:

```yaml
services:
  mission-autopilot-postgres:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=mission
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Run scripts/setup-secrets.sh}
      - POSTGRES_DB=mission_autopilot
    ports:
      - '127.0.0.1:5434:5432' # loopback-only; used by dev, the real-PG smoke suite, and the import CLI
    volumes:
      - missionautopilot-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U mission -d mission_autopilot']
    restart: unless-stopped

  mission-autopilot-server:
    build:
      context: ..
      dockerfile: MissionAutopilot/Dockerfile
      target: server
    depends_on:
      mission-autopilot-postgres:
        condition: service_healthy
    ports:
      - '127.0.0.1:3002:3002' # loopback by default
    environment:
      - DATABASE_URL=postgres://mission:${POSTGRES_PASSWORD:?Run scripts/setup-secrets.sh}@mission-autopilot-postgres:5432/mission_autopilot
      - ACTIONS_API_KEY=${ACTIONS_API_KEY:-}
    volumes:
      - missionautopilot-data:/data # vestigial — see §4.3
    restart: unless-stopped

  mission-autopilot-console:
    build:
      context: ..
      dockerfile: MissionAutopilot/Dockerfile
      target: console
    ports:
      - '127.0.0.1:3003:80'
    environment:
      - ACTIONS_API_UPSTREAM=http://mission-autopilot-server:3002
      - ACTIONS_API_KEY=${ACTIONS_API_KEY:-}
    depends_on:
      - mission-autopilot-server
    restart: unless-stopped

volumes:
  missionautopilot-data:
  missionautopilot-pgdata:
```

Usage (run from inside `MissionAutopilot/` — the build `context: ..` picks up the `MissionDesigner` sibling automatically):

```bash
docker compose up --build -d
docker compose down          # stop, keep volumes
docker compose down -v       # ALSO wipes the Postgres volume + /data
```

The server only starts once Postgres reports healthy (`condition: service_healthy`, backed by `pg_isready`); the console only waits for the server container to exist (`depends_on` without a health condition — the nginx upstream is resolved lazily at request time via Docker DNS, so the console does not need the server to already be listening at build/start time).

---

## 3. Environment Variables

| Variable                  | Default (where set)                                                                                                                                                                                                                                                                                                                                 | Service           | Description                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | none baked into the image; compose sets `postgres://mission:${POSTGRES_PASSWORD:?Run scripts/setup-secrets.sh}@mission-autopilot-postgres:5432/mission_autopilot`. Host-side `npm run dev` (no compose): `postgres://mission:<POSTGRES_PASSWORD>@127.0.0.1:5434/mission_autopilot`, password from the `.env` that `scripts/setup-secrets.sh` writes | server            | Postgres connection string. **Required** in the image — no default.                                                                                                                                                 |
| `POSTGRES_PASSWORD`       | none: required. `scripts/setup-secrets.sh` writes a random one to `.env` (compose fails with "Run scripts/setup-secrets.sh" if it is missing)                                                                                                                                                                                                       | postgres + server | Shared between the `postgres` service and the server's `DATABASE_URL`.                                                                                                                                              |
| `PORT`                    | `3002`                                                                                                                                                                                                                                                                                                                                              | server            | HTTP server port                                                                                                                                                                                                    |
| `HOST`                    | `0.0.0.0`                                                                                                                                                                                                                                                                                                                                           | server            | Bind address                                                                                                                                                                                                        |
| `SIDECAR_SCRIPT`          | `/app/packages/python-sidecar/sandbox_runner.py`                                                                                                                                                                                                                                                                                                    | server            | Path to the Python sandbox entrypoint                                                                                                                                                                               |
| `ACTIONS_API_KEY`         | unset (empty)                                                                                                                                                                                                                                                                                                                                       | server + console  | If non-empty, persisted as the `api_key` setting at boot (server) and forwarded as `X-API-Key` on proxied requests (console). Empty = the management/REST APIs are unauthenticated (server logs a startup warning). |
| `ACTIONS_ALLOWED_ORIGINS` | unset — falls back to loopback-only (`localhost` / `127.0.0.1` / `::1`)                                                                                                                                                                                                                                                                             | server            | Comma-separated CORS allowlist; overrides the loopback-only default.                                                                                                                                                |
| `ACTIONS_API_UPSTREAM`    | `http://mission-autopilot-server:3002` (image `ENV`, and compose sets the same value)                                                                                                                                                                                                                                                               | console           | Upstream the console's nginx reverse-proxies `/trajectory` + `/management` to                                                                                                                                       |
| `NODE_ENV`                | `production`                                                                                                                                                                                                                                                                                                                                        | server            | Node.js environment mode                                                                                                                                                                                            |

There is no `DB_PATH`, `DATA_DIR`, `LOG_MAX_SIZE`, `PYTHON_POOL_SIZE`, `EXECUTION_TIMEOUT_MS`, or `INSTANCE_RETENTION_HOURS` environment variable — those settings now live exclusively as rows in the `settings` table (seeded by the migration, editable from the management console; see `StorageSpec.md` §1.6). They are not read from the environment at container startup.

---

## 4. Volume Mounts

### 4.1 `missionautopilot-pgdata` (the real data)

```yaml
volumes:
  - missionautopilot-pgdata:/var/lib/postgresql/data
```

Mounted on `mission-autopilot-postgres`. This is Postgres's own data directory and is the volume that must survive a `docker compose down` for data to persist. `docker compose down -v` deletes it.

### 4.2 Bind-mount alternative

Same idea as any Postgres container: swap the named volume for a host path to get an on-disk, directly-inspectable backup location:

```yaml
volumes:
  - ./pgdata:/var/lib/postgresql/data
```

### 4.3 `missionautopilot-data` (vestigial)

```yaml
volumes:
  - missionautopilot-data:/data
```

Mounted on `mission-autopilot-server` at `/data`. **Nothing in `packages/server` currently reads or writes this path.** Uploaded `.WFenvir` / `.WFaction` packages are parsed entirely in memory (`multer.memoryStorage()`) and never archived to disk — see `StorageSpec.md` §4 for the full correction (an earlier draft of this specification described a `/data/uploads/` archive that was never actually built). The mount point, the `Dockerfile`'s `VOLUME ["/data"]` declaration, and this compose volume are kept for consistency with the rest of the Mission Suite image family's convention, not because the server needs them today.

---

## 5. Port Mapping

Three separate ports, one per service (not a single shared port):

| Port                      | Service                      | Notes                                                                                       |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `3002`                    | `mission-autopilot-server`   | REST API — `/trajectory/v1/*` (protocol) + `/management/v1/*` (console backend) + `/health` |
| `3003` → container `80`   | `mission-autopilot-console`  | Management console SPA (nginx); reverse-proxies API calls to the server                     |
| `5434` → container `5432` | `mission-autopilot-postgres` | Postgres, loopback-published for host-side dev / smoke tests / the import CLI               |

All three are published loopback-only (`127.0.0.1:PORT:PORT`) by default. To expose the console (and only the console — the API should stay behind it or behind `ACTIONS_API_KEY`) beyond loopback, change its compose port mapping to `3003:80` (all interfaces) and set `ACTIONS_API_KEY`.

---

## 6. Container Lifecycle

### 6.1 Startup Sequence (server)

1. `docker-entrypoint.sh` execs `node /app/server.mjs` directly — no pre-flight shell logic beyond `set -e` (all state lives in Postgres; there is no local file/directory to prepare).
2. `initializeDatabase(DATABASE_URL)` connects the pool, takes the `728501` advisory lock, runs pending migrations, verifies the resulting schema, and releases the lock (`StorageSpec.md` §6). The process **exits with an unhandled rejection** if this throws (e.g. Postgres unreachable, or schema verification fails) — there is no retry loop inside the server itself; `depends_on: condition: service_healthy` on the compose side is what keeps the server from starting before Postgres is ready in the first place.
3. Repositories, `InstanceManager` (with its Python subprocess pool, sized from the `python_pool_size` setting), and the SSE manager are constructed.
4. If `ACTIONS_API_KEY` is set, it's persisted as the `api_key` setting.
5. Express routes are mounted (`/health` unauthenticated; `/trajectory/v1` and `/management/v1` behind API-key auth when `api_key` is non-empty).
6. `app.listen(PORT, HOST)` — logs the listening address, the (password-redacted) database target, and the sidecar script path.

### 6.2 Graceful Shutdown

On `SIGTERM` or `SIGINT` (`packages/server/src/index.ts`):

1. `sseManager.shutdown()` — closes all open SSE connections.
2. `await manager.shutdown()` — `InstanceManager` tears down its Python subprocess pool.
3. `await pool.end()` — closes the Postgres connection pool.
4. `process.exit(0)`.

There is no fixed 30-second request-drain grace period or explicit "send ABORT to all active instances" step in the current shutdown handler — the sequence above is the entire handler body.

### 6.3 Health Check

`GET /health` on the server (unauthenticated, un-prefixed — **not** under `/trajectory/v1`):

- Runs `SELECT 1` against the pool; on failure, `503 { status: 'error', message: 'database connection failed' }`.
- Otherwise calls `databaseSchemaStatus(pool)`; if any expected table is missing, `503 { status: 'error', message: 'database schema incomplete', missingTables: [...] }`.
- Otherwise `200 { status: 'ok' }`.

There is no separate "degraded" state tied to Python worker pool exhaustion — health reflects database connectivity and schema completeness only. The console's `HEALTHCHECK` is a plain `wget` against `http://127.0.0.1:80/` (does not itself verify the server is reachable through the proxy).

---

## 7. Resource Requirements

Unchanged in kind from a single-container deployment, but now split across three containers — size the Postgres container in addition to the server:

| Resource | Server + console (combined, informal minimum)     | Notes                                                                                      |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| CPU      | 1 core                                            | Postgres and the console are both lightweight at this scale                                |
| Memory   | 512 MB                                            | Scales with the `python_pool_size` setting — each subprocess worker uses roughly 50–100 MB |
| Disk     | image size + the `missionautopilot-pgdata` volume | `missionautopilot-data` no longer needs meaningful space (§4.3)                            |

No formal resource benchmarking has been re-run since the Postgres port; treat the table above as a starting point, not a measured SLA.

---

## 8. Development Mode

For local development without Docker, `MissionDesigner` must still be checked out as a sibling (the console imports its packages via `file:` links), and a reachable Postgres is required — the `mission-autopilot-postgres` compose service, published at `127.0.0.1:5434`, works for this even when the server and console run on the host:

```bash
docker compose up -d mission-autopilot-postgres   # just the database
npm install
npm run dev        # server (tsx watch) + console (Vite, :5176) via concurrently
```

`npm run dev` reads `PORT` and `DATABASE_URL` from a local `.env` file (`tsx watch --env-file=.env`, via `dev:server`). **A bare `npm run dev` listens on port `3001`** — `packages/server/src/index.ts` defaults `PORT` to `3001` when unset, and no `.env`/`.env.example` in the repo pins it to `3002`. The console's Vite dev-server proxy target is `3002`, so a bare `npm run dev` mismatches it; set `PORT=3002` in a local `.env` (consumed by `dev:server`'s `--env-file=.env`) to line the two up. Without `DATABASE_URL` set, the server connects to `postgres://mission:<POSTGRES_PASSWORD>@127.0.0.1:5434/mission_autopilot` — the compose Postgres on its published port — using `POSTGRES_PASSWORD` from the `.env` that `scripts/setup-secrets.sh` writes; with neither set it refuses to start. The Vite dev server proxies `/trajectory/v1/*` and `/management/v1/*` to the local Express server.

For a production build of just the server-side TypeScript packages (no Docker, no console): `npm run build` (`tsc --build`).

---

## 9. Logging

Container logs go to stdout/stderr (Docker captures them); the server uses `morgan('dev')` for HTTP request logging plus its own `console.log`/`console.warn`/`console.error` calls (startup line, the unauthenticated-API warning, shutdown messages). There is no structured/leveled log format (no INFO/WARN/ERROR/DEBUG tagging convention) enforced in code — this document no longer prescribes one, since the old spec's log-format table described aspirational formatting that was never implemented.

Access container logs:

```bash
docker compose logs -f                      # all services
docker compose logs -f mission-autopilot-server
```
