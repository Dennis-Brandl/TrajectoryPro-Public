# Mission Autopilot

Hosts and executes Trajectory actions. A TypeScript monorepo — `apps/console` (management UI), `packages/server` (Trajectory REST protocol + management API), `packages/engine` (action state machine), `packages/storage` — with a Python sidecar that runs action code.

> **PLEASE NOTE:** Trajectory is a demonstration system, not intended for production environments. It does not have the security necessary for production use. We recommend running it in a Docker container, bound to localhost, for your testing.

## Quick start (Docker)

See [`DOCKER-README.md`](./DOCKER-README.md). The console depends on shared packages in the sibling `MissionDesigner` repo, so the Docker build uses the **parent directory** (holding both repos) as its build context. From the suite umbrella directory: `docker compose up --build`.

## Development

```bash
npm install
npm run dev      # REST server + management console
npm test         # vitest
```

Requires Node 22+. The console resolves `@mission/ui` / `@mission/tokens` from the sibling `MissionDesigner` checkout via `file:` links.

## License

Apache-2.0 © 2026 Dennis L. Brandl. See [`LICENSE`](./LICENSE).
