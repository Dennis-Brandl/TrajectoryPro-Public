# Mission Designer — Docker Deployment Guide

Mission Designer (the visual workflow specification editor — React + Hono + PostgreSQL) can run two ways: in a Docker container, or rebuilt locally from source.

## Run with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (Engine or Desktop)

### Quick Start

1. Clone the repository and go to this app:
   ```bash
   git clone https://github.com/Dennis-Brandl/TrajectoryPro-Public.git
   cd TrajectoryPro-Public/MissionDesigner
   ```
2. Create the secrets once: run `sh scripts/setup-secrets.sh` from the suite root (it writes this folder's `.env`; `docker compose` fails with `Run scripts/setup-secrets.sh` without it).
3. Build and start:
   ```bash
   docker compose up --build -d
   ```
4. Open http://localhost:3000 — the in-app **Help** guide is served at http://localhost:3000/help.html.

### Remote / Network Access

To allow access from other machines on your network:

1. Set `ALLOWED_ORIGINS` to your server's IP address:
   ```bash
   ALLOWED_ORIGINS=http://192.168.1.51:3000 docker compose up --build -d
   ```
   Or edit `docker-compose.yml` and set it directly.
2. Open the firewall port (Windows — run as Administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "MissionDesigner (TCP 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
3. Access from other machines at `http://<server-ip>:3000`.

### Configuration

| Variable             | Default        | Description                                                                                          |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`               | `3000`         | Server port                                                                                          |
| `DATABASE_URL`       | (required)     | PostgreSQL connection string; injected automatically by compose; set manually for a managed Postgres |
| `BETTER_AUTH_SECRET` | Auto-generated | Secret for signing auth sessions                                                                     |
| `ALLOWED_ORIGINS`    | localhost only | Comma-separated CORS origins for remote access                                                       |
| `TRUSTED_PROXIES`    | (none)         | Reverse-proxy IPs or CIDR ranges, comma-separated; rate limits then key on each user's forwarded IP  |

### Data Management

- The database is a **PostgreSQL** service whose data lives in the `missiondesigner-pgdata` volume (persists across restarts and rebuilds). The `missiondesigner-data` volume holds the auto-generated auth secret.
- Back up: `docker compose exec mission-designer-postgres pg_dump -U mission mission_designer > backup.sql` (restore with `psql`/`pg_restore`).
- Reset: `docker compose down -v` (wipes the Postgres volume).
- To use a managed Postgres instead, set `DATABASE_URL` in your environment and omit the bundled `mission-designer-postgres` service from `docker-compose.yml`.

### Common Commands

```bash
docker compose up --build -d    # Build and start
docker compose up -d            # Start (already built)
docker compose down             # Stop
docker compose down -v          # Stop and delete database
docker compose logs -f          # View live logs
docker compose ps               # Check status
```

## Rebuild locally (without Docker)

### Prerequisites

- Node.js 22+

### Steps

```bash
npm install
npm run build:help     # generate the in-app Help guide (public/help.html)
npm run dev:all        # API server on :3001 + Vite dev server on :5174
```

Then open http://localhost:5174.

- `npm run dev:all` runs the API (port 3001) and the frontend (port 5174) together.
- `npm run build:help` regenerates `public/help.html` from `HELP.md`. (The production `npm run build` does this automatically; the dev `dev:all` does not, so run it once for the Help button to work in dev.)
- Production-style build: `npm run build` (tokens + Help + type-check + Vite) → output in `dist/`.
