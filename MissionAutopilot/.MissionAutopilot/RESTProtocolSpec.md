# Mission Autopilot — REST Protocol Specification (Server-Side)

## Overview

This document specifies Mission Autopilot's implementation of the Trajectory action-server protocol (`/trajectory/v1/*`). The protocol itself — request and response shapes, error codes, state sets, SSE events, and what Mission Engine sends and reads — is defined in the Trajectory Pro suite's [`docs/REST_Protocol.md`](../../docs/REST_Protocol.md), for which Mission Autopilot is the reference implementation. This document covers the server-side implementation details: how Mission Autopilot handles each endpoint, maps requests to its engine, and manages SSE connections. Section numbers like REST-03 refer to that document.

Mission Autopilot implements **every** v1 endpoint (REST-01 … REST-12).

Code: `packages/server/src/index.ts` (middleware order), `routes/protocol.ts` (REST-01–04, 08–12), `routes/commands.ts` (REST-05–07), `sse-manager.ts`, `middleware/`.

---

## 1. Base URL

```
http://{server-host}:{port}/trajectory/v1/
```

Port: `PORT` environment variable; default 3001 when run directly, 3002 in the Docker image. Bind address: `HOST`, default `127.0.0.1` (the Docker image sets `0.0.0.0`; compose publishes on `MISSION_AUTOPILOT_BIND`, default `127.0.0.1`).

### 1.1 Request pipeline

Middleware runs in this order for every request:

1. **Host / Origin check** — `Host` must be `localhost`, `127.0.0.1`, `::1`, `mission-autopilot-server`, the host of `FLEET_BASE_URL`, or listed in `ACTIONS_ALLOWED_HOSTS`, else `403 FORBIDDEN_HOST`. A present `Origin` must be loopback (any port) or listed in `ACTIONS_ALLOWED_ORIGINS`, else `403 FORBIDDEN_ORIGIN`.
2. **CORS** (§4).
3. **Request log** (§5), then JSON body parsing.
4. `GET /health` (root, unauthenticated, §2.1).
5. **API-key check** on `/trajectory/v1` and `/management/v1` (§1.2).
6. Protocol and command routers, then the management router.
7. Error handler (§3).

### 1.2 Authentication

The key comes only from `ACTIONS_API_KEY`; the server refuses to start when it is missing or shorter than 32 characters (run `scripts/setup-secrets.sh`). Every `/trajectory/v1` route, including `/trajectory/v1/health`, requires it as:

- `X-API-Key: <key>`, or
- `Authorization: Bearer <key>`, or
- `?token=<key>` — accepted on `GET /trajectory/v1/instances/{id}/events` and `GET /trajectory/v1/properties/{name}/events` only, because a browser `EventSource` cannot send headers. The token is redacted from the request log.

Comparison is constant-time. A missing or wrong key gets `401 {"error":{"code":"UNAUTHORIZED","message":"Invalid or missing API key","details":{}}}`. Mission Engine sends the key as `X-API-Key` to the origin configured as its `MISSION_ACTIONS_URL`.

---

## 2. Endpoint Implementation

### 2.1 Health Check

```
GET /trajectory/v1/health
GET /health
```

**`/trajectory/v1/health`** (REST-01, authenticated) returns in-memory state only, no database query:

```json
{
  "data": {
    "status": "ok",
    "timestamp": "2026-02-24T10:30:00.000Z",
    "pool": { "size": 4, "idle": 3, "busy": 1, "queued": 0 }
  },
  "meta": {}
}
```

`pool` is the Python worker pool (clients should ignore its shape).

**`/health`** (root, unauthenticated) is the container health check: it runs `SELECT 1` and checks that every table of the schema exists. `200 {"status":"ok"}`, or `503 {"status":"error","message":"database connection failed"}` / `503 {"status":"error","message":"database schema incomplete","missingTables":[...]}`.

---

### 2.2 Discover Capabilities

```
GET /trajectory/v1/capabilities
```

**Implementation**:

- Reads all stored environments and all stored actions, and groups each action under its `environment_oid`.
- `environment_name` and `action_name` are the stored `local_id`s (what Mission Engine's loose matching compares). `environment_state` / `action_state` default to `"Draft"`.
- Each environment's `action_properties` come from its `action_property_specifications` (`name`, `oid`, `description`, `entries`).
- `input_parameters` / `output_parameters` are normalized from the stored specs to `{ name, description?, default_value?, json_schema? }`: `name` is the spec's `id`, else its `name`, else `"<unnamed>"`.
- `supported_commands`: all seven commands for observable actions, `["ABORT"]` for opaque actions (the opaque state machine also accepts `STOP`, §2.5, but it is not advertised).

**Response 200:**

```json
{
  "data": {
    "environments": [
      {
        "environment_oid": "env-001",
        "environment_name": "Kitchen Environment",
        "environment_state": "Effective",
        "action_properties": [
          {
            "name": "OvenSettings",
            "oid": "ap-001",
            "description": "Oven controller",
            "entries": [{ "name": "TargetC", "value": "180" }]
          }
        ],
        "actions": [
          {
            "action_oid": "act-001",
            "action_name": "Heat Oven",
            "action_state": "Effective",
            "local_id": "Heat Oven",
            "version": "1.0.0",
            "description": "Heats the oven to a target temperature",
            "visibility": "observable",
            "input_parameters": [
              {
                "name": "target_temperature",
                "description": "Target temperature in Celsius",
                "default_value": "200",
                "json_schema": null
              }
            ],
            "output_parameters": [
              {
                "name": "actual_temperature",
                "description": "Measured temperature after action completes"
              }
            ],
            "supported_commands": ["PAUSE", "RESUME", "HOLD", "UNHOLD", "ABORT", "STOP", "CLEAR"]
          }
        ]
      }
    ]
  },
  "meta": { "total_environments": 1, "total_actions": 1 }
}
```

---

### 2.3 Invoke Action

```
POST /trajectory/v1/actions/{action_oid}/invoke
```

**Implementation**:

1. Validate the body strictly → `400 VALIDATION_ERROR` if it is not an object, a required field (`environment_oid`, `workflow_instance_id`, `step_instance_id`, `step_oid`, `input_parameters`) is missing or mistyped, or it contains any other field than those plus `timeout_ms` and `action_property_overrides`.
2. Look up the action by `action_oid` → `404 ACTION_NOT_FOUND` if not stored. `environment_oid` is validated but not used for the lookup; the instance records the action's own environment.
3. Resolve inputs: for each declared input, the sent value, else its `default_value`, else `400 PARAMETER_VALIDATION_FAILED` (`Missing required parameter: <id>`). Undeclared sent names are passed through. Stored as `{ key, value }` pairs.
4. Pin the active code version of every state, so a later code edit does not affect this instance.
5. Create the instance (UUID id) in `STARTING` (observable) or `POSTED` (opaque). Stash `action_property_overrides`, if any, for this instance's code until it terminates.
6. Return `201` immediately; the state machine starts asynchronously.

`timeout_ms` is accepted but not applied: each state's code runs under the action's `timeout_seconds` (`0` = no limit) or the `execution_timeout_ms` setting (default 60000). Every invoke creates a new instance — there is no de-duplication.

**Request Body**: per REST-03.

**Response 201:**

```json
{
  "data": { "instance_id": "8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4" },
  "meta": {}
}
```

---

### 2.4 Get Instance Status

```
GET /trajectory/v1/instances/{instance_id}
```

**Implementation**:

- Reads the instance row → `404 INSTANCE_NOT_FOUND` if it does not exist (never created, force-deleted from the console, or removed by retention, §2.8).
- `state.current` is the stored state; `state.previous` and `state.entered_at` come from the last two entries of the stored state history.
- `inputs` / `outputs` are the stored pairs sent as `{ name, key, value }`: `name` is the protocol field, `key` (the stored field) is kept for older readers (`protocolPairs` in `sse-manager.ts`). `error` is the stored summary string (`"<ERROR_TYPE>: <message>"`) or `null`; the traceback is not sent.

**Response 200**: per REST-04 (`instance_id`, `action_oid`, `environment_oid`, `workflow_instance_id`, `step_instance_id`, `step_oid`, `visibility`, `state{current,previous,entered_at}`, `inputs`, `outputs`, `created_at`, `started_at`, `completed_at`, `error`).

---

### 2.5 Send State Command

```
POST /trajectory/v1/instances/{instance_id}/command
```

**Implementation**:

1. Validate the body: exactly one string field `command` → `400 VALIDATION_ERROR`.
2. `command` must be `PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP` or `CLEAR` → `422 INVALID_COMMAND` (`details: { command }`).
3. Look up the instance → `404 INSTANCE_NOT_FOUND`.
4. Validate the command against the instance's transition table (observable or opaque) → `409 INVALID_STATE_TRANSITION`, `details: { current_state, command }`.
5. If Python code is executing for the instance and the command is `HOLD`, `STOP`, `ABORT` or `CLEAR`, record it as deferred (applied when the code returns) and answer at once.
6. Otherwise persist the transition with a compare-and-set on the validated state — if a concurrent transition won, `409` with the instance's new state — and run the new state's code (or auto-advance).
7. Return `200 { data: { instance_id, command, accepted: true }, meta: {} }`. The resulting state is reported through REST-04 / REST-06, not in this response.

**Transitions** (`packages/engine/src/state-machine/transitions.ts`):

| Command  | Valid from                                                      | Enters      | Then (on state complete) |
| -------- | --------------------------------------------------------------- | ----------- | ------------------------ |
| `PAUSE`  | `EXECUTING`                                                     | `PAUSING`   | `PAUSED`                 |
| `RESUME` | `PAUSED`                                                        | `UNPAUSING` | `EXECUTING`              |
| `HOLD`   | any active observable state¹                                    | `HOLDING`   | `HELD`                   |
| `UNHOLD` | `HELD`                                                          | `UNHOLDING` | `EXECUTING`              |
| `STOP`   | any active state¹ (opaque: `POSTED`, `RECEIVED`, `IN_PROGRESS`) | `STOPPING`  | `COMPLETED`              |
| `ABORT`  | any active state¹ (opaque: `POSTED`, `RECEIVED`, `IN_PROGRESS`) | `ABORTING`  | `ABORTED`                |
| `CLEAR`  | `ABORTED`                                                       | `CLEARING`  | `COMPLETED`              |

¹ `STARTING`, `EXECUTING`, `COMPLETING`, `PAUSING`, `PAUSED`, `UNPAUSING`, `HOLDING`, `HELD`, `UNHOLDING`.

There is no `STOPPED` state. Terminal states are `COMPLETED` and `ABORTED`.

---

### 2.6 SSE Event Stream

```
GET /trajectory/v1/instances/{instance_id}/events
```

**Implementation** (`routes/commands.ts`, `sse-manager.ts`):

- Look up the instance → `404 INSTANCE_NOT_FOUND` (JSON) before any stream headers.
- Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` and flush.
- Replay from the instance's in-memory bus: events with `id >` the `Last-Event-ID` header, or — with no header — the whole buffer, so a subscriber that connects just after the invoke still sees the first `state_change`.
- Subscribe to the bus. Events are published for every instance, opaque or observable, by the instance manager's callbacks:
  - `state_change` `{ instance_id, state, previous_state, timestamp }` on every transition; if the instance has outputs, an `output` event `{ instance_id, outputs: [{name, key, value}], timestamp }` follows immediately.
  - `log` `{ instance_id, stream: "stderr", message, timestamp }` when the state machine itself fails for the instance.
  - `heartbeat` `{ timestamp }` every 30 seconds while the bus exists.
- Frame format: `event: <type>\nid: <n>\ndata: <json>\n\n`.

**Event Buffer**:

- One bus per instance, created on first publish or subscribe. Ids are sequential integers per instance starting at 0.
- Ring buffer of the last **256** events (heartbeats included).
- On a terminal state the heartbeat stops and the bus is discarded **7 seconds** later. Open responses are not ended at that point; the client closes them. Later reconnects get no replay.
- Streams are ended by the server when the bus is torn down by a console force-delete of the instance, or on shutdown.
- Buffers are in memory only; a restart loses them.

---

### 2.7 List Instances

```
GET /trajectory/v1/instances?workflow_instance_id={id}&status={status}&action_oid={oid}
```

**Implementation** (first matching rule wins):

1. `workflow_instance_id` given → that workflow's instances, further filtered by `action_oid` if also given.
2. `action_oid` given → all instances of that action.
3. `status=active` → instances with no `completed_at`.
4. other `status` → exact state match.
5. no filter → the 100 most recent instances.

Newest first, including terminal instances not yet removed by retention.

**Response 200**: `{ data: [ <REST-04 data object>, ... ], meta: { total } }`.

---

### 2.8 Cancel Instance

```
DELETE /trajectory/v1/instances/{instance_id}
```

**Implementation**:

1. Look up instance → `404 INSTANCE_NOT_FOUND` if not found.
2. Send `ABORT` through the state machine; an error (already terminal, or a state where ABORT is invalid) is ignored.
3. Kill the Python worker running this instance's code, if any.
4. Return `200 { data: { instance_id, cancelled: true }, meta: {} }` without waiting for `ABORTED`.

The instance row is kept and the SSE bus is left to its normal lifecycle. Mission Engine calls this after every terminal as best-effort cleanup; for a completed instance it changes nothing. (Removing a row immediately is the console's `DELETE /management/v1/instances/{id}`, which also tears down the bus.)

**Retention.** A background sweep deletes instances that have `completed_at`, have been written to the execution log, and completed more than `instance_retention_hours` ago (default 24; `0` disables). REST-04 then answers `404`.

---

### 2.9 Action Properties

```
GET /trajectory/v1/properties
GET /trajectory/v1/properties/{name}[?environment_oid=]
GET /trajectory/v1/properties/{name}/events[?environment_oid=]
```

**Implementation**:

- **REST-10** lists every environment's `action_property_specifications` as `{ name, oid, description, entries }`, grouped by environment, with `meta { total_environments, total_properties }`.
- **REST-11 / REST-12** search every environment (only the one named by `environment_oid`, if given) for a spec whose `name` matches. None → `404 PROPERTY_NOT_FOUND`; more than one → `409 AMBIGUOUS_PROPERTY` with `details.environment_oids`.
- **REST-12** then opens an SSE stream on the property bus keyed `(environment_oid, name)`: `Last-Event-ID` replay from its 256-event ring buffer (no header → live events only), a `heartbeat` every 30 s, and a `property` event `{ environment_oid, property_name, entries, changed_entries, source, source_action_oid?, source_instance_id?, timestamp }` after each write.
- Writes come from action code (`set_property()`, `source: "action_code"`, applied after the code returns — also when it failed) and from the console's property editor (`source: "console"`). `entries` is the full current entry list.
- Deleting or re-importing an environment ends the open streams of its property buses.

---

## 3. Error Handling

### 3.1 Standard Error Response

All errors follow the protocol error format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

### 3.2 Error Codes

| HTTP Status | Code                          | Trigger                                                                              |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| 400         | `VALIDATION_ERROR`            | Body not an object, missing/mistyped field, or an unknown field                      |
| 400         | `PARAMETER_VALIDATION_FAILED` | A declared input without a default was not sent                                      |
| 401         | `UNAUTHORIZED`                | API key missing or wrong                                                             |
| 403         | `FORBIDDEN_HOST`              | `Host` not allowed                                                                   |
| 403         | `FORBIDDEN_ORIGIN`            | `Origin` present and not allowed                                                     |
| 404         | `ACTION_NOT_FOUND`            | `action_oid` not stored                                                              |
| 404         | `INSTANCE_NOT_FOUND`          | Instance id unknown (or removed by retention / force-delete)                         |
| 404         | `PROPERTY_NOT_FOUND`          | No environment has a property of that name                                           |
| 404         | `NOT_FOUND`                   | Other storage miss                                                                   |
| 409         | `AMBIGUOUS_PROPERTY`          | Property name in several environments and no `environment_oid`                       |
| 409         | `INVALID_STATE_TRANSITION`    | Command not valid for the current state (`details.current_state`, `details.command`) |
| 422         | `INVALID_COMMAND`             | Command not one of the seven                                                         |
| 500         | `EXECUTION_ERROR`             | Engine execution error surfaced synchronously                                        |
| 500         | `PROPERTY_WRITE_ERROR`        | Property write failed                                                                |
| 500         | `INTERNAL_ERROR`              | Unexpected server error (message is always `Internal server error`)                  |

The mapping lives in `middleware/error-handler.ts`. No traceback is ever included in an error response.

### 3.3 Python Execution Errors

When a state's Python code fails (error types `SYNTAX_ERROR`, `RUNTIME_ERROR`, `TIMEOUT`, `WORKER_CRASH`; `sys.exit` and unprintable exceptions also fail cleanly):

- The instance's `error` is set to `"<ERROR_TYPE>: <message>"` and the traceback is stored separately (visible in the console, not on the protocol).
- Outputs the code set before failing are kept, and property writes it made are applied.
- The instance transitions to `ABORTING` → `ABORTED`. A failure in `ABORTING`, `STOPPING` or `CLEARING` code goes directly to that state's end (`ABORTED`, `COMPLETED`, `COMPLETED`) instead of re-entering it.
- The code is **not** retried: each state's code runs at most once per instance.
- A failure that arrives after the instance moved on (e.g. it was cancelled and its worker killed) is ignored and writes nothing.
- No HTTP response is affected; the failure is conveyed by the `state_change` events, REST-04, and the execution log.

---

## 4. CORS Configuration

CORS is restricted (`index.ts`, `config.ts`):

```
Access-Control-Allow-Origin:   <the request origin, when allowed>
Access-Control-Allow-Methods:  GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers:  Content-Type, X-API-Key, Authorization, Last-Event-ID
Access-Control-Expose-Headers: Content-Type
```

Allowed origins: loopback origins (`localhost`, `127.0.0.1`, `::1`, any port) always, plus the comma-separated `ACTIONS_ALLOWED_ORIGINS`. Requests without an `Origin` header are not subject to CORS. A disallowed `Origin` is refused with `403 FORBIDDEN_ORIGIN` by the Host/Origin check (§1.1).

---

## 5. Request Logging

Every HTTP request is logged to stdout (Docker container logs) by `morgan` in its `dev` format, with any `?token=` value redacted:

```
POST /trajectory/v1/actions/act-001/invoke 201 15.204 ms - 63
GET /trajectory/v1/instances/8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4/events?token=[REDACTED] 200 - ms - -
```

This is separate from the execution log — the execution log is written to the database when an instance terminates and is browsed in the console.
