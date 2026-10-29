# Mission Designer

Visual editor for authoring distributed-workflow packages in the Trajectory Pro Mission Control suite. Built with React + Vite, backed by a small Hono API server with PostgreSQL (Drizzle) storage.

> **PLEASE NOTE:** Trajectory is a demonstration system, not intended for production environments. The editor and runtime are single-user systems and do not have the security necessary for production use. We recommend loading the applications into a Docker container for your testing.

## Quick start (Docker)

See [`DOCKER-README.md`](./DOCKER-README.md). The recommended way (Mission Designer + Postgres together):

```bash
docker compose up --build
# then open http://localhost:3000
```

> To run the Mission Designer container standalone, you must supply a reachable Postgres:
> `docker run -d -p 127.0.0.1:3000:3000 -e DATABASE_URL=postgres://user:pass@host:5432/db mission-designer`

## Exposing beyond localhost

Compose binds to `127.0.0.1` (loopback) by default — safe for local evaluation. To put Mission Designer on a network, do so deliberately:

1. Run it behind a **TLS-terminating reverse proxy** (e.g. Caddy, nginx, Traefik). Secure session cookies engage automatically when `BASE_URL` is `https://…`.
2. Set `BASE_URL=https://<your-host>` and `ALLOWED_ORIGINS=https://<your-host>`, and set `TRUSTED_PROXIES` to the proxy's IP so sign-in rate limits count each user separately.
3. Change the published port to `0.0.0.0:3000:3000` (or point the proxy at the loopback port).
4. **Self-registration is available only during first-run setup.** Once the setup wizard completes, public sign-up is closed and accounts are created by an administrator.
5. `BETTER_AUTH_SECRET` auto-generates into the `/data` volume on first run; set it explicitly to pin a known value.

> Trajectory is a demonstration system — these steps reduce exposure risk but do not make it production-hardened.

## Development

```bash
npm install
npm run dev      # client + API server
npm test         # vitest
```

Requires Node 22+ and **PostgreSQL**. Set `DATABASE_URL` to a Postgres connection string before starting the dev server (see `.env.example`). Options: run a local Postgres instance, use the bundled `docker compose` `mission-designer-postgres` service, or point at a managed Postgres.

## Documentation

- User guide: [`HELP.md`](./HELP.md)
- Docker: [`DOCKER-README.md`](./DOCKER-README.md)
- Workflow JSON specification: [`JSONSpec.md`](./JSONSpec.md)
- Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md)

## License

Apache-2.0 © 2026 Dennis L. Brandl. See [`LICENSE`](./LICENSE).
