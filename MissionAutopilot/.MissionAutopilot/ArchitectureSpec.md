# Mission Autopilot — Architecture Specification

## Overview

Mission Autopilot uses a Node.js/TypeScript backend with a Python sidecar subprocess pool. The Express server hosts both the Trajectory REST protocol (for workflow clients) and the Management API (for the console UI). A React SPA provides the browser-based management console. A dedicated PostgreSQL database (accessed via `pg`, no ORM) handles all persistent storage — see `StorageSpec.md`.

---

## 1. Project Structure

```
MissionAutopilot/
├── apps/
│   └── console/                     # React SPA (Management Console)
│       ├── src/
│       │   ├── pages/               # Console page components
│       │   │   ├── DashboardPage.tsx
│       │   │   ├── EnvironmentsPage.tsx
│       │   │   ├── EnvironmentDetailPage.tsx
│       │   │   ├── ActionDetailPage.tsx
│       │   │   ├── CodeEditorPage.tsx
│       │   │   ├── InstancesPage.tsx
│       │   │   ├── InstanceDetailPage.tsx
│       │   │   ├── LogPage.tsx
│       │   │   └── SettingsPage.tsx
│       │   ├── components/          # Shared UI components
│       │   │   ├── Layout.tsx
│       │   │   ├── Sidebar.tsx
│       │   │   ├── CodeEditor.tsx   # Monaco editor wrapper
│       │   │   ├── ParameterTable.tsx
│       │   │   ├── StateTimeline.tsx
│       │   │   ├── LogTable.tsx
│       │   │   └── UploadDropzone.tsx
│       │   ├── hooks/               # React hooks for API calls
│       │   ├── api/                 # Management API client
│       │   ├── types/               # Console-specific types
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── server/                      # Express server (main process)
│   │   ├── src/
│   │   │   ├── index.ts             # Server entrypoint
│   │   │   ├── Trajectory-api/        # Trajectory REST protocol routes
│   │   │   │   ├── health.ts
│   │   │   │   ├── capabilities.ts
│   │   │   │   ├── invoke.ts
│   │   │   │   ├── instance-status.ts
│   │   │   │   ├── instance-command.ts
│   │   │   │   ├── instance-events.ts  # SSE endpoint
│   │   │   │   ├── instance-list.ts
│   │   │   │   └── instance-cancel.ts
│   │   │   ├── management-api/      # Management console API routes
│   │   │   │   ├── environments.ts
│   │   │   │   ├── actions.ts
│   │   │   │   ├── code.ts
│   │   │   │   ├── instances.ts
│   │   │   │   ├── log.ts
│   │   │   │   ├── upload.ts
│   │   │   │   └── settings.ts
│   │   │   ├── middleware/          # Express middleware
│   │   │   │   ├── error-handler.ts
│   │   │   │   ├── request-logger.ts
│   │   │   │   └── cors.ts
│   │   │   └── types/              # Server-specific types
│   │   ├── __tests__/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── engine/                      # Action execution engine (pure TS)
│   │   ├── src/
│   │   │   ├── state-machine/       # ISA-88 state machine implementation
│   │   │   │   ├── state-machine.ts
│   │   │   │   ├── state-table.ts   # Transition table from StateMachineSpec
│   │   │   │   └── types.ts
│   │   │   ├── instance-manager/    # Runtime action instance lifecycle
│   │   │   │   ├── instance-manager.ts
│   │   │   │   ├── instance-factory.ts
│   │   │   │   └── types.ts
│   │   │   ├── code-registry/       # Action code version management
│   │   │   │   ├── code-registry.ts
│   │   │   │   └── types.ts
│   │   │   ├── parameter-resolver/  # Input/output parameter resolution
│   │   │   │   ├── parameter-resolver.ts
│   │   │   │   └── types.ts
│   │   │   ├── python-executor/     # Python subprocess bridge
│   │   │   │   ├── python-pool.ts   # Subprocess pool manager
│   │   │   │   ├── python-bridge.ts # stdin/stdout JSON protocol
│   │   │   │   └── types.ts
│   │   │   └── types/               # Shared engine types
│   │   │       ├── action.ts
│   │   │       ├── environment.ts
│   │   │       ├── instance.ts
│   │   │       └── index.ts
│   │   ├── __tests__/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── storage/                     # PostgreSQL data access layer
│       ├── src/
│       │   ├── database.ts          # pg.Pool, Queryable, withAtomic
│       │   ├── migrations/          # Schema migration files
│       │   │   └── 001-initial-schema.ts
│       │   ├── repositories/        # Data access objects
│       │   │   ├── environment.repo.ts
│       │   │   ├── action.repo.ts
│       │   │   ├── code-version.repo.ts
│       │   │   ├── instance.repo.ts
│       │   │   ├── log.repo.ts
│       │   │   └── settings.repo.ts
│       │   └── types/
│       ├── __tests__/
│       ├── tsconfig.json
│       └── package.json
│
├── python/                          # Python sidecar
│   ├── sandbox_runner.py            # Subprocess entry point
│   ├── sandbox_policy.py            # Import/filesystem restrictions
│   └── requirements.txt             # Minimal Python dependencies
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── package.json                     # Root workspace config
├── tsconfig.base.json               # Shared TypeScript config
└── vitest.workspace.ts              # Vitest workspace config
```

---

## 2. Package Dependencies

```
┌───────────────┐
│    console    │  (React SPA — built separately, served as static files)
└───────────────┘

┌───────────────┐     ┌───────────┐     ┌───────────┐
│    server     │────►│  engine   │────►│  storage  │
│  (Express)    │     │  (core)   │     │(Postgres) │
└───────────────┘     └───────────┘     └───────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ python sidecar│  (child_process)
                    └───────────────┘
```

Dependency rules:

- `engine` depends on `storage` for data access and on `child_process` for Python execution
- `server` depends on `engine` for action lifecycle and on `storage` for management queries
- `console` is built independently and served as static files — no runtime dependency on other packages
- `python/` is not a Node.js package — it's a Python script loaded by the engine's subprocess pool

---

## 3. Core Architecture Layers

### 3.1 API Layer (packages/server/)

**Responsibility**: HTTP request handling, routing, SSE connection management, static file serving.

Two route groups mounted on a single Express app:

#### Trajectory REST Protocol (`/trajectory/v1/`)

Implements the full protocol as defined in `RESTProtocolSpec.md`:

- `GET /health` — Health check
- `GET /capabilities` — Discover supported actions
- `POST /actions/:action_oid/invoke` — Invoke a new action instance
- `GET /instances/:id` — Get instance status
- `POST /instances/:id/command` — Send state command
- `GET /instances/:id/events` — SSE event stream
- `GET /instances` — List active instances
- `DELETE /instances/:id` — Cancel instance

#### Management API (`/management/v1/`)

Implements the management console backend as defined in `ManagementAPISpec.md`:

- Environment CRUD, action browsing, code editing, instance monitoring, log queries, settings

#### Static Files

- `/console/` — React SPA static files (index.html, JS, CSS)
- `/` — Redirects to `/console/`

### 3.2 Engine Layer (packages/engine/)

**Responsibility**: Action instance lifecycle, state machine transitions, Python code execution, parameter resolution.

Key components:

#### State Machine (`state-machine/`)

- Generic ISA-88 state machine implementation
- Configured with the transition table from `StateMachineSpec.md`
- Each Runtime Action Instance gets its own state machine instance
- Validates transitions, rejects invalid commands, emits state change events

#### Instance Manager (`instance-manager/`)

- Creates Runtime Action Instances from invoke requests
- Walks instances through their state machine
- For each state entry: checks Code Registry for a handler → executes via Python Executor or auto-advances
- Manages the active instance set (in-memory + persisted)
- Handles concurrent instances (multiple actions running simultaneously)

#### Code Registry (`code-registry/`)

- Manages versioned Python code records per action+state
- Stores code in the database via Storage layer
- Resolves which code version to use for a given instance (version pinned at instance creation)
- Supports hot-reload: new instances get latest version, running instances keep their pinned version

#### Parameter Resolver (`parameter-resolver/`)

- Resolves input parameters from the invoke request
- Makes inputs available to Python code as a dictionary
- Collects output values from Python code execution
- Maps outputs to the response format expected by the protocol

#### Python Executor (`python-executor/`)

- Manages a pool of Python subprocess workers
- Sends execution requests as JSON via stdin, receives results via stdout
- Enforces timeout (kills subprocess if exceeded)
- Isolates each execution: no shared state between subprocess calls

### 3.3 Storage Layer (packages/storage/)

**Responsibility**: PostgreSQL database management (via the `pg` driver), data access, migrations. See `StorageSpec.md` for the full schema, transaction model, and migration system.

Repository pattern (DAO) with one repository per entity type:

- `EnvironmentRepository` — Master Environment Specifications
- `ActionRepository` — Master Action Specifications (linked to environments)
- `CodeVersionRepository` — Versioned Python code per action+state
- `InstanceRepository` — Runtime Action Instances (active + recent)
- `LogRepository` — Rolling execution log with configurable max size
- `SettingsRepository` — Key/value configuration store

### 3.4 Python Sidecar (python/)

**Responsibility**: Sandboxed execution of user-written Python action code.

- `sandbox_runner.py` — Entry point for subprocess; reads JSON from stdin, executes user code, writes JSON to stdout
- `sandbox_policy.py` — Restricts imports (allowlist), filesystem access (read-only /tmp), no network access
- Runs as a child process spawned by the Node.js engine layer

---

## 4. Communication Patterns

### 4.1 Mobile Client → Action Container (Trajectory Protocol)

```
Mobile App                          Action Container
    │                                    │
    ├── POST /trajectory/v1/actions/{oid}/invoke ──►
    │                                    ├── Create instance
    │                                    ├── Pin code versions
    │ ◄── 201 { instance_id, status } ──┤
    │                                    ├── Execute STARTING code (if any)
    │                                    ├── Execute EXECUTING code (if any)
    │ ◄── SSE: state_change events ─────┤
    │ ◄── SSE: output event ────────────┤
    │ ◄── SSE: state_change COMPLETED ──┤
```

### 4.2 Node.js Engine → Python Subprocess

```
Engine (TypeScript)                  Python Subprocess
    │                                    │
    ├── spawn python sandbox_runner.py ──►
    │                                    │
    ├── stdin: JSON request ────────────►│
    │   { action_oid, state,             │
    │     code, inputs, props }          │
    │                                    ├── Execute user code
    │ ◄── stdout: JSON response ────────┤
    │   { success, outputs, error }      │
    │                                    │
    ├── (next state, or kill on timeout) │
```

### 4.3 Management Console → Action Container (Management API)

```
Browser (React SPA)                  Action Container
    │                                    │
    ├── GET /management/v1/environments ►│
    │ ◄── 200 [ environments... ] ──────┤
    │                                    │
    ├── POST /management/v1/upload ─────►│  (multipart file upload)
    │ ◄── 200 { imported: [...] } ──────┤
    │                                    │
    ├── PUT /management/v1/code ────────►│  (save code version)
    │ ◄── 200 { version_id } ──────────┤
```

---

## 5. Port Allocation

Single port (default 3000, configurable via `PORT` env var):

| Path Prefix        | Handler               | Description                        |
| ------------------ | --------------------- | ---------------------------------- |
| `/trajectory/v1/*` | Trajectory API routes | REST protocol for workflow clients |
| `/management/v1/*` | Management API routes | Console backend                    |
| `/console/*`       | Static file server    | React SPA assets                   |
| `/`                | Redirect              | → `/console/`                      |

---

## 6. Technology Decisions

### Why Node.js + TypeScript?

- Matches the Trajectory MD codebase (shared type definitions possible)
- Excellent async I/O for handling many concurrent SSE connections
- Native `child_process` module for Python subprocess management
- Express is well-suited for the dual REST API + static file serving pattern

### Why Python Sidecar (not embedded)?

- Action code is Python — needs a real CPython interpreter for full compatibility
- Subprocess isolation provides natural sandboxing (separate process, restricted environment)
- Pool of workers allows concurrent action execution without GIL concerns
- Crash isolation: a bad action script crashes its subprocess, not the server

### Why PostgreSQL?

- Real foreign-key and `CHECK` constraints enforced by the database itself, not just application code (`StorageSpec.md` §1, §10)
- A standard client/server database that multiple processes (the server, the real-Postgres smoke suite, the one-shot import CLI, `psql`/`pg_dump` tooling) can connect to concurrently without file-level lock contention
- The `pg` driver is pure JavaScript — no native addon toolchain needed in the runtime image (unlike `better-sqlite3`, which still ships as a devDependency solely for the one-shot SQLite→Postgres import CLI, see `DockerSpec.md` §1)
- Ecosystem-standard backup/restore tooling (`pg_dump`/`psql`) instead of file copies
- Handles the moderate throughput expected from an action server

### Why Monaco Editor?

- Same editor as VS Code — developers are already familiar
- Excellent Python syntax highlighting and IntelliSense
- Lightweight enough to embed in a management console
