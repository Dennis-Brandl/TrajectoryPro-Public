# Trajectory Pro Mission Control — Docker Deployment Guide

Run the whole suite — **Mission Designer**, **Mission Commander**, **Mission Engine** (which also serves **Mission Pilot**), **Mission Autopilot** (server + console), **Mission Autopilot Tester** and **Mission Broker** — with two commands, or each app on its own. Every app can also be run from source without Docker.

## Layout

This guide lives at the repository root, which holds every app as a subdirectory:

```
./                                <- the repository root
  docker-compose.yml              <- the fleet, except Mission Designer
  .dockerignore
  MissionDesigner/                <- has its own docker-compose.yml
  MissionCommander/
  MissionEngine/                  <- its image also builds and serves Mission Pilot
  MissionPilot/
  MissionAutopilot/               <- server + console
  MissionAutopilotTester/
  MissionBroker/                  <- action server for the Distributed Workflow actions
  MissionFormKit/                 <- shared form library, no service of its own
  mission-control-db/             <- shared database package, no service of its own
```

The Autopilot, Commander, Engine and Broker images build with **this directory** as their context so they can reach sibling packages: the Autopilot console needs Mission Designer's `@mission/ui`, Commander, Engine and Broker need `mission-control-db`, and Engine also needs Mission FormKit and Mission Pilot. The Tester builds from its own subdirectory. Mission Designer is not in the root compose file: it runs from `MissionDesigner/docker-compose.yml` with its own Postgres.

## Run everything with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Engine or Desktop) with Compose

### First run

Generate the secrets the compose files require, once, before the first `docker compose up`. The script writes a `.env` next to each compose file (root, `MissionDesigner/`, `MissionAutopilot/`, `mission-control-db/`), keeps every line already there, adds only what is missing, and prints variable names, never values:

```bash
# from the repository root
sh scripts/setup-secrets.sh
docker compose up --build -d
```

If a database volume from an earlier install already exists, the script keeps that database's old password (`POSTGRES_PASSWORD=mission`) and says so; see **Changing the database password**. If Docker is installed but not running (or this user cannot reach it) it stops and says so. `docker compose` without these secrets fails with `Run scripts/setup-secrets.sh`.

### Quick Start

```bash
docker compose up --build -d                            # the fleet
(cd MissionDesigner && docker compose up --build -d)    # Mission Designer
```

| App                                                    | URL                          |
| ------------------------------------------------------ | ---------------------------- |
| Mission Designer                                       | http://localhost:3000        |
| Mission Autopilot — server (REST)                      | http://localhost:3002        |
| Mission Autopilot — console (UI)                       | http://localhost:3003        |
| Mission Autopilot Tester                               | http://localhost:3004        |
| Mission Commander                                      | http://localhost:3005        |
| Mission Pilot (served by the Mission Engine container) | http://localhost:3006        |
| Mission Engine health check                            | http://localhost:3006/health |
| Mission Broker health check (no UI)                    | http://localhost:3007/health |

Everything is bound to `127.0.0.1` by default. To expose a service, change its port mapping in the compose file from `127.0.0.1:PORT:…` to `0.0.0.0:PORT:…` and set that service's `ALLOWED_ORIGINS` (plus `BASE_URL` behind a TLS-terminating proxy, and the proxy's address in `MISSION_COMMANDER_TRUSTED_PROXIES` / `MISSION_ENGINE_TRUSTED_PROXIES` so sign-in rate limits count each user separately). Mission Commander generates its own sign-in secret on first run; the Engine's comes from `MISSION_ENGINE_AUTH_SECRET` in `.env`.

### Common Commands

```bash
docker compose up --build -d                              # build + start the fleet
docker compose up -d --build --no-deps mission-commander     # rebuild just one service
docker compose down                                       # stop the fleet
docker compose down -v                                    # stop + DELETE the named volumes (Postgres data!)
docker compose logs -f                                    # live logs
docker compose ps                                         # status
```

Compose service names in the root file: `mission-commander`, `mission-engine`, `mission-autopilot-server`, `mission-autopilot-console`, `tester`, `mission-broker`, and the databases `mission-commander-postgres` and `mission-autopilot-postgres`. Mission Designer's service is `mission-designer` in its own file. Docker identifiers — services, volumes, containers, images — still carry pre-rebrand names on purpose, because they name the data volumes; renaming them is a later wave.

After a rebuild, confirm the container moved to the new image: `docker compose up -d --build` sometimes rebuilds the image and leaves the container running the old one. `docker compose up -d --no-deps --force-recreate <service>` fixes that.

### Mission Broker

Mission Broker runs the GLOBAL **Distributed Workflow Action Library**: the actions that let a running workflow create, start, control and wait for other runtime workflows. It shares Mission Commander's Postgres and starts after it. The Mission Engine reaches it over the compose network at `http://mission-broker:3007`. To use it in a work center, add that address to the action-server allowlist in Mission Commander's **Settings**, then bind the work center's *Distributed Workflow Management* environment to it on the **Env Specs** tab. See [`docs/DISTRIBUTED_WORKFLOW_LIBRARY.md`](docs/DISTRIBUTED_WORKFLOW_LIBRARY.md).

Every Mission Broker route except `/health` requires a bearer token (see **Mission Broker token** below); keep its port on `127.0.0.1` (`MISSION_BROKER_BIND`, the default) anyway. Settings: `DATABASE_URL` (required), `BROKER_PORT` (default `3007`) and `BROKER_POLL_MS` (default `5000`, at least `250`): how often a waiting **Wait for Runtime Workflow** action re-checks its target as a backstop.

### Mission Broker token

`scripts/setup-secrets.sh` (see **First run**) writes `MISSION_BROKER_TOKEN` (48 random characters) into the root `.env`.

- The broker refuses to start without a token of at least 32 characters, and the Mission Engine sends the same token to the broker (only to the origin in `MISSION_BROKER_URL`, default `http://mission-broker:3007`).
- After changing it, recreate both: `docker compose up -d --no-deps --force-recreate mission-broker mission-engine`.
- The Action Tester takes the same value in **API key or token**.
- `BROKER_RETENTION_DAYS` defaults to 14: call records are deleted that many days after the calling runtime finished.
- `BROKER_CORS_ORIGINS` is a comma-separated list of extra origins allowed to call the broker from a browser. By default only the Tester at `http://localhost:3004` and `http://127.0.0.1:3004` are allowed.

### Changing the database password

The script keeps the password `mission` for a database that already exists, because Postgres only reads `POSTGRES_PASSWORD` when it first creates the data directory. To move such a database to a real password, change it inside Postgres first, then in `.env`, then recreate the services that use it. For the Commander/Engine/Broker database:

```bash
docker compose exec mission-commander-postgres psql -U mission -d mission_control -c "ALTER USER mission PASSWORD 'NEW-PASSWORD'"
# set POSTGRES_PASSWORD=NEW-PASSWORD in .env, then:
docker compose up -d --force-recreate mission-commander mission-engine mission-broker
```

Use the same pattern for the other databases (`mission-autopilot-postgres`, `mission-designer-postgres` from `MissionDesigner/`, and `mission-control-postgres` from `mission-control-db/`). Keep a `pg_dump` first.

Per-app details (config, data, single-app runs) are in [`MissionDesigner/DOCKER-README.md`](MissionDesigner/DOCKER-README.md), [`MissionAutopilot/DOCKER-README.md`](MissionAutopilot/DOCKER-README.md) and [`MissionAutopilotTester/DOCKER-README.md`](MissionAutopilotTester/DOCKER-README.md).

## Run everything locally (without Docker)

Each app runs from source with Node.js 20+ (Mission Autopilot also needs Python 3 on PATH as `python`). Mission Designer and the Autopilot console build shared packages from their siblings first, so keep the layout above. Mission Commander and Mission Engine need a Postgres reachable through `DATABASE_URL`. Open separate terminals:

```bash
# Mission Designer — API :3001 + UI :5174 (dev:all first builds the FormKit tokens, the design tokens and the in-app Help)
cd MissionDesigner && npm install && npm run dev:all

# Mission Commander — API :3002 (PORT in .env) + UI :5273
cd MissionCommander && npm install && npm run dev:all

# Mission Engine — :3006 (ENGINE_PORT); the API Mission Pilot talks to
cd MissionEngine && npm install && npm start

# Mission Pilot — UI :5275, proxies /api to the engine on :3006
cd MissionPilot && npm install && npm run dev

# Mission Autopilot — server :3002 + console :5176 (needs MissionDesigner as a sibling).
# The server needs ACTIONS_API_KEY (at least 32 characters) in the shell or MissionAutopilot/.env
# (scripts/setup-secrets.sh writes it); the console asks for it when you open it.
cd MissionAutopilot && npm install && npm run dev

# Mission Autopilot Tester — UI on the port Vite prints
cd MissionAutopilotTester && npm install && npm run dev

# Mission Broker — :3007 (BROKER_PORT); needs DATABASE_URL pointing at Mission Commander's Postgres
cd MissionBroker && npm install && npm start
```

Port note: run from source, Mission Commander's API and the Mission Autopilot server both default to `:3002`. Set `PORT` for one of them (Commander reads it from `.env`, and its Vite proxy follows `API_PORT`). In Docker, Commander is published on `:3005` and there is no clash.
