# Mission Autopilot — Runtime Action Execution Engine

## Project Overview

Mission Autopilot is a Docker-containerized Action Server that implements the Trajectory REST protocol (`/trajectory/v1/`). It receives action invocation requests from Trajectory Mobile (or any Trajectory-compatible workflow client), executes actions using user-editable Python code organized by ISA-88 state, and returns results via the standard REST/SSE protocol.

The container includes a browser-based management console for uploading environment and action packages, editing Python action code, monitoring active instances, and viewing execution logs.

## Core Capabilities

1. **Trajectory REST Protocol Server** — Implements all `/trajectory/v1/` endpoints (health, capabilities, invoke, status, command, SSE events, list, cancel)
2. **Python Action Code Execution** — Sandboxed CPython subprocesses execute user-written Python functions for each configured state in an action's state model
3. **State Machine Engine** — Full ISA-88 state machine for observable and opaque action instances, matching `StateMachineSpec.md`
4. **Environment & Action Management** — Upload `.WFenvir` and `.WFaction` packages via the management console; OIDs preserved exactly as authored in Trajectory MD
5. **Management Console** — React SPA for environment browsing, code editing with versioning, instance monitoring, log viewing, and configuration
6. **Rolling Execution Log** — Fixed-size, configurable log of action instance lifecycle records for short-term auditing and debugging
7. **Hot-Reload with Versioning** — Code changes take effect immediately for new action instances; running instances continue with the code version they started with; all versions tracked for rollback
8. **Docker Deployment** — Single-port container with volume-mounted persistent storage

## Technology Stack

| Component          | Technology                         | Version     |
| ------------------ | ---------------------------------- | ----------- |
| Server Runtime     | Node.js                            | 22 (Alpine) |
| Server Framework   | Express.js                         | 5.x         |
| Language           | TypeScript                         | 5.x         |
| Python Execution   | CPython (sandboxed subprocess)     | 3.12+       |
| Management Console | React + Vite                       | 19.x / 6.x  |
| Code Editor        | Monaco Editor (React)              | Latest      |
| Database           | PostgreSQL (via `pg`)              | 17          |
| SSE Support        | Native Express SSE                 | —           |
| ZIP Handling       | JSZip                              | 3.x         |
| Testing            | Vitest (server) + Vitest (console) | Latest      |
| Container          | Docker (multi-stage build)         | Latest      |
| Process Management | Node.js child_process              | Built-in    |

## Architecture

Node.js/TypeScript backend with Python sidecar subprocess pool:

- **Express server** hosts the Trajectory REST protocol, Management API, and serves the React SPA
- **Python subprocess pool** executes sandboxed action code — communication via stdin/stdout JSON
- **PostgreSQL database** stores environments, actions, code versions, instance state, and rolling log — identified by a single `DATABASE_URL`, not a mounted file
- **Docker volume** (`missionautopilot-pgdata`) backing Postgres's own data directory for persistence across container restarts; the legacy `/data` mount on the server itself is now vestigial (see `StorageSpec.md` §4)

## Version Scope

### v1.0 (This Release)

- Single container deployment (no clustering)
- No authentication on management console or REST protocol (future)
- PostgreSQL storage (suitable for moderate throughput)
- Manual package upload only (no pull from Trajectory MD server)
- Sandboxed CPython with restricted imports (no pip package installation by users)

### Future Releases

- v2.0: Authentication (API keys, OAuth2), multi-container orchestration
- v3.0: Package pull from Trajectory MD server, pip package management for action code
- v4.0: Clustering, horizontal scaling (shared PostgreSQL storage is already in place as of v3.0)

## Related Specification Files

| File                       | Description                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `ArchitectureSpec.md`      | Project structure, package layout, component architecture                              |
| `DataModelSpec.md`         | Complete data model — stored entities, runtime instances, code versions                |
| `StateMachineSpec.md`      | ISA-88 state machine (inherited from Trajectory ecosystem)                             |
| `RESTProtocolSpec.md`      | Trajectory REST protocol implementation (server-side perspective)                      |
| `ManagementAPISpec.md`     | Management console REST API endpoints                                                  |
| `ManagementConsoleSpec.md` | Management console UI screens and features                                             |
| `ExecutionEngineSpec.md`   | Action code execution model — subprocess sandboxing, parameter passing, state handlers |
| `StorageSpec.md`           | PostgreSQL schema, rolling log mechanics, persistence strategy                         |
| `DockerSpec.md`            | Dockerfile, docker-compose, volume mounts, environment variables                       |
