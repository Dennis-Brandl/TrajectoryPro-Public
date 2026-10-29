# Mission Autopilot Tester — Docker Deployment Guide

The Mission Autopilot Tester is a standalone single-file web app for exercising any action-server REST implementation. It has **no backend** — you point it at an Action Container URL in the UI. It can run two ways: in a Docker container, or rebuilt locally from source.

## Run with Docker

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) (Engine or Desktop)

### Quick Start
1. Clone the repository and go to this app:
   ```bash
   git clone https://github.com/Dennis-Brandl/TrajectoryPro-Public.git
   cd TrajectoryPro-Public/MissionAutopilotTester
   ```
2. Build and start:
   ```bash
   docker compose up --build -d
   ```
3. Open http://localhost:3004, then enter your Action Container's REST URL
   (e.g. `http://localhost:3002`) in the UI. The Action Container allows
   cross-origin requests, so the browser reaches it directly.

### Common Commands
```bash
docker compose up --build -d    # Build and start
docker compose up -d            # Start (already built)
docker compose down             # Stop
docker compose logs -f          # View live logs
```

## Rebuild locally (without Docker)

### Prerequisites
- Node.js 20+

### Run the dev server
```bash
npm install
npm run dev        # Vite dev server on a printed localhost port
```

### Or build the standalone file
```bash
npm install
npm run build      # produces dist/index.html — a single self-contained file
```
Open `dist/index.html` directly in any browser (no server needed), or serve the `dist/` folder with any static file server.
