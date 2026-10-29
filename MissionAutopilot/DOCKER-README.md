# Mission Autopilot — Docker Deployment Guide

Mission Autopilot ships as **two images** built from one `Dockerfile`, plus a dedicated **Postgres** service:

- **postgres** — `postgres:17-alpine`, the system of record (port 5434)
- **server** — the REST API (Node) + Python sandbox sidecar (port 3002)
- **console** — the management UI (static SPA) served by nginx (port 3003), which reverse-proxies `/trajectory` and `/management` to the server

It can run with Docker, or be rebuilt locally from source.

## ⚠️ Build prerequisite: MissionDesigner must be a sibling

The console reuses the shared UI library that lives in **MissionDesigner** (`@mission/ui`, `@mission/tokens`, referenced via `file:` links). So the Docker build uses the **parent directory as its build context** and expects this layout:

```
<parent>/
  MissionAutopilot/      <- run docker compose here
  MissionDesigner/    <- must be present (the umbrella clone, or a sibling clone)
```

The `docker-compose.yml` sets `context: ..` automatically. A lone `MissionAutopilot` clone with no `MissionDesigner` sibling **cannot** build the console.

## Run with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Engine or Desktop)
- `MissionDesigner` checked out next to `MissionAutopilot`

### Quick Start

First, from the suite root, run `sh scripts/setup-secrets.sh` once: it writes this folder's `.env` with `POSTGRES_PASSWORD` and `ACTIONS_API_KEY`, which `docker compose` requires (it fails with `Run scripts/setup-secrets.sh` without them). A standalone clone can put any 32+ character values in `.env` instead.

Then, from inside `MissionAutopilot/`:

```bash
docker compose up --build -d
```

- Console (UI): http://localhost:3003
- Server (REST API): http://localhost:3002
- Postgres: `127.0.0.1:5434` (loopback only — also used by `npm run dev`, the real-PG smoke suite, and the import CLI)

### Configuration

| Variable               | Default                                                                                                                                          | Where           | Description                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`                 | `3002`                                                                                                                                           | server          | REST API port                                                                                        |
| `DATABASE_URL`         | `postgres://mission:$POSTGRES_PASSWORD@mission-autopilot-postgres:5432/mission_autopilot` (compose-provided; no default is baked into the image) | server          | Postgres connection string                                                                           |
| `SIDECAR_SCRIPT`       | `/app/packages/python-sidecar/sandbox_runner.py`                                                                                                 | server          | Python sandbox runner                                                                                |
| `ACTIONS_API_UPSTREAM` | `http://mission-autopilot-server:3002`                                                                                                           | console         | Upstream the console proxies API calls to                                                            |
| `ACTIONS_API_KEY`      | required, ≥32 chars, set by `scripts/setup-secrets.sh`                                                                                           | server/engine   | Key every `/management/v1` and REST call must send (`X-API-Key`); the console asks for it at sign-in |
| `POSTGRES_PASSWORD`    | required (`.env`)                                                                                                                                | postgres/server | Shared between the `postgres` service and the server's `DATABASE_URL`                                |

### Data Management

- The database is a **PostgreSQL** service whose data lives in the `missionautopilot-pgdata` volume (persists across restarts and rebuilds). The `missionautopilot-data` volume (mounted at `/data` on the server) is currently unused — uploaded package archives are handled entirely in memory and never touch disk — kept for forward compatibility.
- Reset: `docker compose down -v` — this now ALSO wipes the Postgres volume (`missionautopilot-pgdata`), not just `/data`. Stale-volume trap: if you rebuild the image without also running `down -v`, an old container can keep running against a Postgres volume from a previous schema; when in doubt, `down -v` before `up --build -d` to start clean.
- Completed instance records are reaped after `instance_retention_hours` (default 24; set it to `0` in the console's Settings to disable). Execution history (`execution_log`, the console's History page) is a separate table and is never reaped by this sweep.

### Migrating an old SQLite volume

Containers built before this Postgres port persisted data in `trajectoryactions-data` (SQLite, `/data/trajectory.db`). To bring that data forward:

1. Copy the old database file out of the old container/volume (the pre-Postgres image wrote it to `/data/trajectory.db`):
   ```bash
   docker cp <old-container>:/data/trajectory.db ./database.sqlite
   # or, from the volume directly: docker run --rm -v trajectoryactions-data:/data -v "$PWD":/out alpine cp /data/trajectory.db /out/database.sqlite
   ```
2. Bring up the full stack once so the server boots and applies migrations —
   tables are created by the server on startup, not by the `postgres`
   service itself, so the import CLI needs them to exist first:
   ```bash
   docker compose up --build -d
   ```
3. Run the one-shot import CLI against the now-migrated database:
   ```bash
   npm run import-sqlite -- ./database.sqlite postgres://mission:$POSTGRES_PASSWORD@127.0.0.1:5434/mission_autopilot
   ```
4. Restart the server so it picks up settings the import CLI wrote straight
   into the database — the running server never sees a write made outside
   its own process. (`python_pool_size` IS applied live when changed through
   the console's Settings page — `management.ts` calls `manager.resizePool`
   — it's only a direct database write like this import that needs the
   restart.) The import ignores any `api_key` in the SQLite database; access is
   controlled only by `ACTIONS_API_KEY` from the environment:
   ```bash
   docker compose restart mission-autopilot-server
   ```

### Common Commands

```bash
docker compose up --build -d    # Build and start
docker compose up -d            # Start (already built)
docker compose down             # Stop
docker compose down -v          # Stop and delete the Postgres volume + /data
docker compose logs -f          # View live logs
```

## Rebuild locally (without Docker)

### Prerequisites

- Node.js 20+, Python 3 (on PATH as `python`), `MissionDesigner` as a sibling, and a reachable Postgres (the compose `mission-autopilot-postgres` service, published at `127.0.0.1:5434`, works for this)

### Steps

```bash
npm install
npm run dev        # server (tsx, :3002) + console (Vite, :5176) via concurrently
```

The dev server reads `PORT`, `DATABASE_URL`, `POSTGRES_PASSWORD` and `ACTIONS_API_KEY` from a local `.env` (set `PORT=3002` to match the console's Vite proxy; `scripts/setup-secrets.sh` writes the two secrets). Without `DATABASE_URL` set, the server builds `postgres://mission:<POSTGRES_PASSWORD>@127.0.0.1:5434/mission_autopilot` — the URL `mission-autopilot-postgres` publishes — and refuses to start if `POSTGRES_PASSWORD` is also unset. For a production build of just the server packages: `npm run build` (`tsc --build`).

## Notes / validation

- If `npm ci` fails due to a lockfile mismatch in either repo, switch the relevant `npm ci` to `npm install` in the `Dockerfile`.
- A dedicated unauthenticated `/health` route on the server reports both DB connectivity and schema completeness, and backs the container `HEALTHCHECK` — `curl http://localhost:3002/health` should return `{"status":"ok"}` once Postgres is reachable and migrated.
- **One server per database.** Environment Action-Property writes (`set_property`, console
  edits) are serialized through an in-process chain; two `mission-autopilot-server` replicas
  sharing one Postgres would race each other on those writes. Scale the Python worker pool
  (`python_pool_size`), not the server process.
- **The console's "Action Tester" link points at `127.0.0.1:3004`.** That port is published
  by the superproject fleet's `tester` service; in this standalone stack the link is dead
  unless you run the Action Tester yourself on :3004.
