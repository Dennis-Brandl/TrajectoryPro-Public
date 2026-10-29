# Mission Autopilot Tester

A standalone single-file HTML React app for exercising any action server's REST API — point it at a container, invoke actions, and inspect responses.

> **PLEASE NOTE:** The Mission Autopilot Tester is part of the Trajectory Pro Mission Control suite; a developer tool for exercising an Action Server's REST API.

## Requirements

- Node 22 or later

## Setup

```bash
npm install
```

## Develop

```bash
npm run dev
```

Opens a Vite dev server on a free port; visit the printed URL.

## Build single-file artifact

```bash
npm run build
```

Produces `dist/index.html` — a single HTML file with all JS and CSS inlined. Open it directly in any browser (no server needed).

## Test

```bash
npm test         # vitest run
npm run lint     # eslint
```

## Documentation

- User guide: [`HELP.md`](./HELP.md)
- Docker: [`DOCKER-README.md`](./DOCKER-README.md)

## License

Apache-2.0 © 2026 Dennis L. Brandl. See [`LICENSE`](./LICENSE).
