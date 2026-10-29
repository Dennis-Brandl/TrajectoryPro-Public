# Trajectory Pro — Mission Engine ↔ Action Server REST Protocol

**Audience.** Implementers of new action servers (anything that hosts environment actions) and of new runtimes (anything that drives them over the wire, the way Mission Engine does).

**Scope.** This document defines the **public** REST surface an action server serves at `/trajectory/v1/*`, consumed by Mission Engine when a runtime workflow executes an `ACTION PROXY` / `WAIT ACTION PROXY` step, and the Server-Sent Events (SSE) streams that carry instance state and property changes back.

Two action servers ship with the suite:

| Action server | What it hosts | Notes |
|---------------|---------------|-------|
| **Mission Autopilot** | Environments and actions imported from Mission Designer packages, with per-state Python handlers. | The **reference implementation**: every endpoint in this document. |
| **Mission Broker** | The fixed set of Distributed Workflow actions (create, start, control and wait for other runtime workflows). | A deliberately small subset, shaped to what Mission Engine reads. Its actions, inputs and outputs are documented in [DISTRIBUTED_WORKFLOW_LIBRARY.md](./DISTRIBUTED_WORKFLOW_LIBRARY.md); its wire differences are summarised in [§5.6](#56-mission-broker-differences). |

Where the two servers, or the server and Mission Engine's client, differ, this document says so explicitly. Mission Autopilot's own server-side notes are in `MissionAutopilot/.MissionAutopilot/RESTProtocolSpec.md`.

It does **not** cover:

- Mission Autopilot's `/management/v1/*` routes (its console: upload, export, snapshot, code editing, settings) — see `MissionAutopilot/.MissionAutopilot/ManagementAPISpec.md`.
- Mission Designer's internal routes for library import/export.
- Authoring-time formats (use [JSON_SCHEMA.md](./JSON_SCHEMA.md)).

**Protocol version.** `v1`. The version appears in the URL path (`/trajectory/v1/...`). Future revisions move to `/v2/`, `/v3/`, etc.

---

## 1. Protocol basics

### 1.1 Base URL

Every action server exposes the protocol under a single fixed prefix:

```
<action_server_origin>/trajectory/v1/
```

Mission Engine does **not** dial the `action_server_specifications[*].uri` carried in a package's `EnvironmentSpecification` ([JSON_SCHEMA §1.8](./JSON_SCHEMA.md#18-environmentspecification)). The server for each environment is chosen per work center: an administrator binds the environment to an action-server origin in Mission Commander (the work center's environment bindings). The binding is an origin only (`scheme://host[:port]`, no path); the client appends `/trajectory/v1/...` itself. An `ACTION PROXY` step whose environment has no binding in its work center fails at dispatch.

Example: binding `https://factory-floor.example.com` → requests to `https://factory-floor.example.com/trajectory/v1/...`.

### 1.2 Content types

| Direction | Header | Value |
|-----------|--------|-------|
| Request body | `Content-Type` | `application/json` |
| Response body (non-SSE) | `Content-Type` | `application/json` |
| Response body (SSE) | `Content-Type` | `text/event-stream` |
| Request (SSE) | `Accept` | `text/event-stream` |
| Request (SSE replay) | `Last-Event-ID` | integer string (event id of the last event received) — Mission Autopilot only, see §4 |

All payloads are UTF-8.

### 1.3 Authentication

Both shipped action servers **always** require a credential on `/trajectory/v1/*`; there is no open-access mode. Each refuses to start without one (at least 32 characters).

| Server | Credential (env var) | Accepted as | Rejection |
|--------|----------------------|-------------|-----------|
| Mission Autopilot | `ACTIONS_API_KEY` | `X-API-Key: <key>` **or** `Authorization: Bearer <key>`; on the two SSE routes (`/instances/{id}/events`, `/properties/{name}/events`) also `?token=<key>` | `401` `{"error":{"code":"UNAUTHORIZED","message":"Invalid or missing API key","details":{}}}` |
| Mission Broker | `MISSION_BROKER_TOKEN` | `Authorization: Bearer <token>` only; on `GET /trajectory/v1/instances/{id}/events` also `?token=<token>` | `401` `{"error":"missing or wrong broker token"}` (note: `error` is a plain string here, not the §1.5 envelope) |

The `?token=` form exists because a browser `EventSource` cannot send headers (Mission Autopilot Tester uses it). Mission Autopilot redacts it from its request log. Keys are compared in constant time.

**What Mission Engine sends.** The engine holds two credentials and sends each only to its own origin, never to any other action server:

| Engine env vars | Sent to | Header |
|-----------------|---------|--------|
| `MISSION_ACTIONS_URL` + `ACTIONS_API_KEY` | requests whose origin equals `MISSION_ACTIONS_URL`'s origin | `X-API-Key: <key>` |
| `MISSION_BROKER_URL` + `MISSION_BROKER_TOKEN` | requests whose origin equals `MISSION_BROKER_URL`'s origin | `Authorization: Bearer <token>` |

Any other bound origin receives **no** credential headers. A third-party action server that requires authentication therefore cannot currently be authenticated by Mission Engine unless it is configured as the `MISSION_ACTIONS_URL` origin. A `401` from either configured origin is reported as a key/token mismatch: on an invoke it fails the step; on a poll it is logged and the poll keeps running (see §5.5).

#### 1.3.1 Host and Origin checks (Mission Autopilot)

Before authentication, Mission Autopilot refuses requests whose `Host` header is not one of `localhost`, `127.0.0.1`, `::1`, `mission-autopilot-server`, the host of `FLEET_BASE_URL`, or a name listed in `ACTIONS_ALLOWED_HOSTS` → `403 FORBIDDEN_HOST`. A request carrying an `Origin` header that is neither loopback (any port) nor listed in `ACTIONS_ALLOWED_ORIGINS` → `403 FORBIDDEN_ORIGIN`. Requests without `Origin` (server-to-server, such as Mission Engine) are not affected by the origin check. An action server reached under a new host name must have that name added to `ACTIONS_ALLOWED_HOSTS`.

#### 1.3.2 Action-server trust (client side)

Mission Engine decides, before any request (including SSE), whether it may contact an origin at all. The policy is set in Mission Commander → Settings → Action server trust and read live (cached about 5 seconds):

| Mode | Behaviour |
|------|-----------|
| **Strict** | Only origins on the allowlist (exact `scheme://host:port` match, no wildcards) are contacted. Any other origin fails the step's dispatch before a request is sent; an empty allowlist allows nothing. |
| **Loose** | Any `http:`/`https:` origin is contacted; the engine logs a warning once per origin. |

Nothing about trust is visible on the wire; it only decides whether a request is sent.

### 1.4 CORS

CORS matters only for browser clients (e.g. Mission Autopilot Tester). Neither shipped server answers `*`.

| | Mission Autopilot | Mission Broker |
|---|---|---|
| Allowed origins | loopback origins (any port) plus `ACTIONS_ALLOWED_ORIGINS` (comma-separated) | `BROKER_CORS_ORIGINS` (comma-separated); default `http://localhost:3004`, `http://127.0.0.1:3004` |
| `Access-Control-Allow-Methods` | `GET, POST, PUT, DELETE, OPTIONS` | `GET, POST, DELETE, OPTIONS` |
| `Access-Control-Allow-Headers` | `Content-Type, X-API-Key, Authorization, Last-Event-ID` | `Authorization, Content-Type` |
| `Access-Control-Expose-Headers` | `Content-Type` | — |

Browser-based clients that reconnect SSE with `Last-Event-ID` need it in `Allow-Headers`.

### 1.5 Response envelope

Every successful response is wrapped:

```json
{
  "data": { /* payload — shape depends on endpoint */ },
  "meta": { /* optional pagination/total counters */ }
}
```

Every error response is wrapped:

```json
{
  "error": {
    "code":    "ERROR_CODE",
    "message": "Human-readable description.",
    "details": { /* optional context */ }
  }
}
```

`code` is a stable identifier intended for programmatic handling. `message` is for logs and operators. `details` is free-form contextual data — clients MUST tolerate unknown fields inside it.

Mission Autopilot always sends `meta` (often `{}`) and `details` (often `{}`). Mission Broker omits `meta`, omits `details`, sends `error.code` without `message` on `INSTANCE_NOT_FOUND`, and uses a bare string for its 401 (§1.3). Clients SHOULD treat `meta`, `message` and `details` as optional.

### 1.6 Standard error codes

| HTTP | `code` | When |
|------|--------|------|
| 400 | `VALIDATION_ERROR` | Request body is not a JSON object, has a missing/mistyped field, or (Mission Autopilot) **contains a field not listed for the endpoint** — `message` is e.g. `Unknown field: foo`, `Missing required field: step_oid`, `Field 'input_parameters' must be an array`. |
| 400 | `PARAMETER_VALIDATION_FAILED` | Invoke omitted an input parameter that the action declares without a default (`Missing required parameter: <name>`). |
| 401 | `UNAUTHORIZED` | Credential missing or wrong (Mission Autopilot; see §1.3 for Mission Broker's shape). |
| 403 | `FORBIDDEN_HOST` / `FORBIDDEN_ORIGIN` | Mission Autopilot Host/Origin check (§1.3.1). |
| 403 | `FORBIDDEN` | Mission Broker: the invoke's ids do not name a step that is waiting on this action (§5.6). |
| 404 | `ACTION_NOT_FOUND` | Invoke with an `action_oid` the server does not host. |
| 404 | `INSTANCE_NOT_FOUND` | The `instance_id` is unknown to this server (never existed, deleted, or removed by retention). |
| 404 | `PROPERTY_NOT_FOUND` | No environment on this server exposes the named property. |
| 404 | `NOT_FOUND` | Generic storage miss (Mission Autopilot). |
| 409 | `AMBIGUOUS_PROPERTY` | Property name resolves to more than one environment and no `environment_oid` filter was provided. |
| 409 | `INVALID_STATE_TRANSITION` | Command not valid in the instance's current state. Mission Autopilot adds `details: { current_state, command }`. |
| 422 | `INVALID_COMMAND` | Command name not in the canonical set (`PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP`, `CLEAR`). |
| 500 | `EXECUTION_ERROR` / `PROPERTY_WRITE_ERROR` | Mission Autopilot engine errors surfaced synchronously (rare — action-code failures are reported through the instance state, §3.4). |
| 500 | `INTERNAL_ERROR` | Unhandled error. Message is always `Internal server error`; no traceback is exposed on the wire. |

Clients MUST treat any non-2xx body as an error and parse `error.code` (when `error` is an object) before falling back to status code text.

### 1.7 Wire conventions

- All IDs are opaque strings. The runtime supplies `workflow_instance_id` and `step_instance_id` (Mission Engine sends UUIDs; Mission Broker requires UUIDs); the action server generates `instance_id` (both shipped servers generate UUIDs).
- All timestamps are ISO 8601 UTC with millisecond precision.
- Parameter values on the wire are **strings**, even when their semantic type is numeric or boolean. Both sides coerce on the way in and out. This matches the storage shape of `default_value` in [JSON_SCHEMA §1.7.1](./JSON_SCHEMA.md#171-inputparameter-workflow-inputs-step-inputs-action-inputs).
- **Value Property list form.** When a step input is bound to a whole Value Property (rather than one entry or a literal), Mission Engine sends its entries as a JSON-encoded list string: `"[{\"name\":\"ID\",\"value\":\"42\"},{\"name\":\"Label\",\"value\":\"Batch 7\"}]"` (the `Description` entry is excluded). Conversely, an output whose value is such a list and whose step binding targets a whole Value Property is written into that property entry by entry. See [DISTRIBUTED_WORKFLOW_LIBRARY.md §4.1](./DISTRIBUTED_WORKFLOW_LIBRARY.md#41-the-value-property-list-form).
- **Pair field name.** Instance input/output pairs are `{ name, value }`. Mission Autopilot also sends the same name as `key` (`{ name, key, value }`), for older readers. New action servers SHOULD send `name`; clients SHOULD read `name` and fall back to `key`, as Mission Engine does.

---

## 2. Endpoint reference

| # | Method | Path | Purpose | Used by Mission Engine |
|---|--------|------|---------|:---:|
| REST-01 | `GET` | `/health` | Liveness probe. | — |
| REST-02 | `GET` | `/capabilities` | Discover environments, actions, action-properties, supported commands. | ✓ |
| REST-03 | `POST` | `/actions/{action_oid}/invoke` | Start a new runtime action instance. | ✓ |
| REST-04 | `GET` | `/instances/{instance_id}` | Fetch current instance state (polling). | ✓ |
| REST-05 | `POST` | `/instances/{instance_id}/command` | Send a state-machine command (PAUSE/RESUME/STOP/ABORT/…). | ✓ |
| REST-06/07 | `GET` | `/instances/{instance_id}/events` | SSE stream of instance state changes, outputs, logs, heartbeats. | ✓ |
| REST-08 | `GET` | `/instances` | List instances (with filters). | — |
| REST-09 | `DELETE` | `/instances/{instance_id}` | Cancel / clean up an instance. | ✓ |
| REST-10 | `GET` | `/properties` | List action-properties across all envs on this server. | — |
| REST-11 | `GET` | `/properties/{name}` | Fetch one action-property by name. | ✓ |
| REST-12 | `GET` | `/properties/{name}/events` | SSE stream of property-value changes. | ✓ |

Mission Broker implements REST-02, 03, 04, 05, 06, 09 only (§5.6).

---

### REST-01. Health check

```http
GET /trajectory/v1/health
```

No request body. On Mission Autopilot this route sits behind the API-key check like every other `/trajectory/v1` route. Mission Autopilot also serves an **unauthenticated** `GET /health` at the server root (outside `/trajectory/v1`) for container health checks: `200 {"status":"ok"}` when the database is reachable and its schema complete, otherwise `503 {"status":"error","message":"..."}`. Mission Broker serves only the root `GET /health` (unauthenticated, `200 {"ok":true}`) and has no `/trajectory/v1/health`.

**200 OK** (Mission Autopilot)

```json
{
  "data": {
    "status":    "ok",
    "timestamp": "2026-02-24T10:30:00.000Z",
    "pool": { "size": 4, "idle": 3, "busy": 1, "queued": 0 }
  },
  "meta": {}
}
```

`status` is always `"ok"`. `pool` is opaque telemetry (Mission Autopilot reports its Python worker pool); clients MUST NOT depend on its shape. Mission Engine does not call this endpoint.

---

### REST-02. Discover capabilities

```http
GET /trajectory/v1/capabilities
```

No request body.

**200 OK**

```json
{
  "data": {
    "environments": [
      {
        "environment_oid":   "env-001",
        "environment_name":  "Kitchen Library",
        "environment_state": "Effective",
        "action_properties": [
          {
            "name":        "OvenSettings",
            "oid":         "ap-001",
            "description": "Current oven controller settings",
            "entries":     [{ "name": "TargetC", "value": "180" }]
          }
        ],
        "actions": [
          {
            "action_oid":      "act-001",
            "action_name":     "Heat Oven",
            "action_state":    "Effective",
            "local_id":        "Heat Oven",
            "version":         "1.0.0",
            "description":     "Heats the oven to a target temperature.",
            "visibility":      "observable",
            "input_parameters":  [
              { "name": "target_temperature", "description": "Target °C", "default_value": "200" }
            ],
            "output_parameters": [
              { "name": "actual_temperature", "description": "Measured °C" }
            ],
            "supported_commands": ["PAUSE", "RESUME", "HOLD", "UNHOLD", "ABORT", "STOP", "CLEAR"]
          }
        ]
      }
    ]
  },
  "meta": {
    "total_environments": 1,
    "total_actions":      1
  }
}
```

The response is **grouped**: `data.environments[].actions[]`. There is no flat `data.actions` list.

Notes for implementers:

- `environments[]` is the discovery unit. A server hosts one or more environments; each owns zero or more actions.
- **Fields Mission Engine reads** (the minimum a new server must send): `environments[].environment_oid`, `environments[].environment_name`, `environments[].actions[].action_oid`, `action_name`, `visibility`, `input_parameters[].name`, `supported_commands`. Everything else is informational. Mission Broker sends only these.
- `environment_name` and `action_name` are what **loose matching** compares (§5.5.1): on Mission Autopilot both are the environment's / action's `local_id` from the imported package.
- `input_parameters[*]` and `output_parameters[*]` are **normalized** on Mission Autopilot: only `name`, `description?`, `default_value?`, `json_schema?` appear. Consumers MUST NOT assume `id` is present on the wire.
- `visibility ∈ {"opaque", "observable"}` is the action's declared visibility; it is fixed per action (the invoke request does not choose it).
- `supported_commands` is `["PAUSE","RESUME","HOLD","UNHOLD","ABORT","STOP","CLEAR"]` for observable actions and `["ABORT"]` for opaque actions. (Mission Autopilot's opaque state machine also accepts `STOP`, §3.2, but does not advertise it.)
- `environment_state` / `action_state` default to `"Draft"` when the package carries no state.
- Mission Engine caches this response per origin for **5 minutes** and treats a command as supported only when the action is listed, is **not** opaque, and lists the command (§5.5.3).

---

### REST-03. Invoke action

Start a new runtime action instance.

```http
POST /trajectory/v1/actions/{action_oid}/invoke
Content-Type: application/json
```

**Path parameters**

| Name | Type | Notes |
|------|------|-------|
| `action_oid` | string | The server's oid for the action. Under strict matching Mission Engine sends the package's action oid; under loose matching, the oid this server reported in REST-02 for the name-matched action (§5.5.1). |

**Request body**

```json
{
  "environment_oid":      "env-001",
  "workflow_instance_id": "6f1c2e0a-3b7d-4c55-9a51-0d6c7f3e8b21",
  "step_instance_id":     "0b9e6a44-71f2-4d0e-8c3a-5e2b9d17a6c0",
  "step_oid":             "step-master-002",
  "input_parameters": [
    { "name": "target_temperature", "value": "200" },
    { "name": "recipe_name",        "value": "Bolognese Sauce" }
  ],
  "timeout_ms": 300000
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `environment_oid` | string | Yes | The environment this action is invoked under (strict: the package's environment oid; loose: the server's, from REST-02). Mission Autopilot requires the field but resolves the action by `action_oid` alone and records the action's own environment on the instance. |
| `workflow_instance_id` | string | Yes | The runtime workflow's id. |
| `step_instance_id` | string | Yes | The step instance's id. |
| `step_oid` | string | Yes | Master oid of the `ACTION PROXY` step in the workflow spec. |
| `input_parameters` | array of `{name, value}` | Yes | All values are strings (§1.7). Mission Engine sends the step's declared inputs **plus** every workflow starting parameter; a server SHOULD ignore names it does not declare. |
| `timeout_ms` | number | No | The step's `action_proxy_config.timeout_ms`, when set (omitted otherwise). Mission Autopilot accepts it but does **not** apply it — its per-state code timeout comes from the action's `timeout_seconds` or the `execution_timeout_ms` setting. Mission Engine enforces the step timeout itself (§5.5.4). |
| `action_property_overrides` | object | No | Mission Autopilot only: per-invocation override of action-property entries, `propertyName → entryName → value`, for that instance's code only. Test/dev affordance; Mission Engine never sends it. |

Mission Autopilot rejects any other top-level field with `400 VALIDATION_ERROR` (`Unknown field: …`).

**Input resolution (Mission Autopilot).** For each input the action declares: the sent value if present, else the declared `default_value`, else `400 PARAMETER_VALIDATION_FAILED`. Undeclared names that were sent are kept and passed through to the action code.

**Initial state.** Fixed by the action's declared visibility: `STARTING` for observable actions, `POSTED` for opaque ones. Execution starts asynchronously after the response.

**Idempotency.** Mission Autopilot creates a **new** instance for every invoke; it does not de-duplicate. Mission Broker runs an action at most once per step **activation** (keyed by `step_instance_id` plus the step's start time in the shared database): a repeated invoke for the same activation returns `201` with the first `instance_id` and does not run the action again. See §5.5.2 for when Mission Engine re-sends an invoke.

**201 Created**

```json
{
  "data": {
    "instance_id": "8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4"
  },
  "meta": {}
}
```

The runtime then uses `instance_id` for all subsequent operations on this invocation. Mission Engine treats **any status other than 201** as a failed dispatch.

**400 VALIDATION_ERROR** — a required field is missing, has the wrong type, or an unknown field was sent.

```json
{
  "error": {
    "code":    "VALIDATION_ERROR",
    "message": "Missing required field: environment_oid",
    "details": {}
  }
}
```

**400 PARAMETER_VALIDATION_FAILED** — a declared input without a default was not sent.
**404 ACTION_NOT_FOUND** — no action with that oid on this server.

---

### REST-04. Get instance status

```http
GET /trajectory/v1/instances/{instance_id}
```

**Path parameters**

| Name | Type | Notes |
|------|------|-------|
| `instance_id` | string | Server-generated id from the invoke response. |

**200 OK** (Mission Autopilot)

```json
{
  "data": {
    "instance_id":          "8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4",
    "action_oid":           "act-001",
    "environment_oid":      "env-001",
    "workflow_instance_id": "6f1c2e0a-3b7d-4c55-9a51-0d6c7f3e8b21",
    "step_instance_id":     "0b9e6a44-71f2-4d0e-8c3a-5e2b9d17a6c0",
    "step_oid":             "step-master-002",
    "visibility":           "observable",
    "state": {
      "current":    "EXECUTING",
      "previous":   "STARTING",
      "entered_at": "2026-02-24T10:31:02.418Z"
    },
    "inputs":       [{ "name": "target_temperature", "key": "target_temperature", "value": "200" }],
    "outputs":      [],
    "created_at":   "2026-02-24T10:31:00.000Z",
    "started_at":   "2026-02-24T10:31:01.882Z",
    "completed_at": null,
    "error":        null
  },
  "meta": {}
}
```

Field semantics:

| Field | Meaning |
|-------|---------|
| `state.current` | The current state of the action instance (see §3 for the state sets). |
| `state.previous` | The state before `current`. `null` if the instance is in its initial state. |
| `state.entered_at` | Timestamp of the transition into `state.current`. Falls back to `created_at` if no transitions have occurred. |
| `inputs` | The resolved inputs (`{name, value}` pairs, defaults applied, §REST-03; Mission Autopilot adds `key`, §1.7). |
| `outputs` | `{name, value}` pairs produced by the action so far (Mission Autopilot adds `key`). May be partially populated during execution. Outputs written by code before it failed are kept (§3.4). |
| `error` | `null` while healthy; on an action-code failure a **string** summary, `"<ERROR_TYPE>: <message>"` (e.g. `"RUNTIME_ERROR: division by zero"`). The Python traceback is stored server-side but not sent. |
| `started_at` | Set on the first transition out of `STARTING` / `POSTED`. |
| `completed_at` | Set on entry into a terminal state (`COMPLETED`, `ABORTED`); `null` otherwise. |

**What a client needs.** Mission Engine reads only `data.state` and `data.outputs`. It accepts `data.state` either as the object above (it reads `state.current`) or as a bare state name string (Mission Broker's shape below).

**200 OK** (Mission Broker)

```json
{ "data": { "state": "COMPLETED", "outputs": [{ "name": "Completion", "value": "[{\"name\":\"Code\",\"value\":\"0\"}]" }] } }
```

**404 INSTANCE_NOT_FOUND** — unknown id. Mission Autopilot deletes terminal instances `instance_retention_hours` (default 24) after completion, once they are in its execution log; Mission Broker deletes on REST-09 and after `BROKER_RETENTION_DAYS` (default 14). Mission Engine treats a 404 while it is still waiting as **"Instance lost on server"** and fails the step.

---

### REST-05. Send state command

```http
POST /trajectory/v1/instances/{instance_id}/command
Content-Type: application/json
```

**Request body**

```json
{ "command": "PAUSE" }
```

`command` MUST be one of `PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP`, `CLEAR`. Any other value yields **422 INVALID_COMMAND**. `command` is the only field accepted (Mission Autopilot rejects others with `400`).

Command validity by current state — Mission Autopilot (the server is the authority; see §3.2 for target states):

| Current state | Valid commands |
|---------------|---------------|
| `STARTING`, `COMPLETING`, `PAUSING`, `UNPAUSING`, `HOLDING`, `UNHOLDING` | `HOLD`, `ABORT`, `STOP` |
| `EXECUTING` | `PAUSE`, `HOLD`, `ABORT`, `STOP` |
| `PAUSED` | `RESUME`, `HOLD`, `ABORT`, `STOP` |
| `HELD` | `UNHOLD`, `HOLD`, `ABORT`, `STOP` |
| `ABORTED` | `CLEAR` |
| `POSTED`, `RECEIVED`, `IN_PROGRESS` (opaque) | `ABORT`, `STOP` |
| `ABORTING`, `STOPPING`, `CLEARING`, `COMPLETED` | none |

**200 OK** (Mission Autopilot)

```json
{
  "data": {
    "instance_id": "8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4",
    "command":     "PAUSE",
    "accepted":    true
  },
  "meta": {}
}
```

`accepted: true` means the command was valid for the state the instance was in. The resulting transition and any state code run asynchronously and are observable via REST-04 or REST-06. While action code is executing, Mission Autopilot **defers** `HOLD`, `STOP`, `ABORT` and `CLEAR`: the response is still `200`, and the command is applied when the running code returns.

**404 INSTANCE_NOT_FOUND** — unknown id.
**409 INVALID_STATE_TRANSITION** — the command is not valid in the current state, including when a concurrent transition moved the instance first (`details.current_state` is the state it moved to).
**422 INVALID_COMMAND** — command not in the canonical set.

Mission Broker accepts only `ABORT` from `RUNNING` (`200 {"data":{"accepted":true,"new_state":"ABORTED"}}`); every other command or state is `409 INVALID_STATE_TRANSITION`.

Mission Engine counts `200` **and** `409` as delivered, `404` as "instance gone"; other statuses are classified in §5.5.3.

---

### REST-06 / REST-07. Server-Sent Events: instance stream

Subscribe to real-time updates for a single instance.

```http
GET /trajectory/v1/instances/{instance_id}/events
Accept: text/event-stream
Last-Event-ID: <integer>     (optional — see §4)
```

**Response 200 OK** (Mission Autopilot)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection:    keep-alive
X-Accel-Buffering: no
```

The body is an open SSE stream until the client disconnects or the server tears the instance's bus down. Each event uses standard SSE framing (field order may vary; parse by field name):

```
event: state_change
id: 17
data: {"instance_id":"8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4","state":"EXECUTING","previous_state":"STARTING","timestamp":"2026-02-24T10:31:02.418Z"}

```

The `id` is a per-instance monotonic integer starting at 0 on Mission Autopilot (used by `Last-Event-ID` — §4). The `event` field selects the variant; `data` is a single JSON object on one line.

The stream is served for **every** instance, opaque or observable. Mission Engine opens it right after every successful invoke.

#### Event types

| `event` | `data` shape |
|---------|--------------|
| `state_change` | `{ instance_id, state, previous_state, timestamp }` — emitted on every state transition. `previous_state` is `null` for the first event. |
| `output` | `{ instance_id, outputs: [{name, key, value}], timestamp }` — Mission Autopilot emits it immediately **after** each `state_change` whenever the instance's outputs are non-empty, carrying the full current output list. |
| `log` | `{ instance_id, stream: "stderr", message, timestamp }` — Mission Autopilot emits it when its state machine itself fails for the instance. |
| `heartbeat` | `{ timestamp }` — Mission Autopilot emits it every **30 seconds** while the instance's bus exists (not only when idle). Carries no instance state. |

Mission Engine acts only on `state_change` events whose `state` it recognises as terminal (§5.5.4); it ignores the rest and fetches outputs from REST-04 once the action has completed.

#### Terminal handling (Mission Autopilot)

When the instance enters a terminal state (`COMPLETED`, `ABORTED`):

1. The server emits the terminal `state_change` (followed by an `output` event if outputs exist).
2. The heartbeat timer stops.
3. The bus lingers for **7 seconds** so subscribers can pick up the final events and late subscribers can replay them.
4. The bus is then discarded. Open streams are **not** closed by the server at that point; clients SHOULD close the stream themselves after the terminal `state_change`. A later subscription for that `instance_id` gets no replay; use REST-04.

Streams are ended by the server on shutdown.

#### Instance not found

If the `instance_id` is unknown, the server returns **404** with the standard error envelope before opening the SSE stream:

```json
{
  "error": {
    "code":    "INSTANCE_NOT_FOUND",
    "message": "Instance not found",
    "details": {}
  }
}
```

---

### REST-08. List instances

```http
GET /trajectory/v1/instances
GET /trajectory/v1/instances?workflow_instance_id=wf-001
GET /trajectory/v1/instances?action_oid=act-001
GET /trajectory/v1/instances?workflow_instance_id=wf-001&action_oid=act-001
GET /trajectory/v1/instances?status=active
GET /trajectory/v1/instances?status=EXECUTING
```

**Query parameters** (Mission Autopilot), applied in this order of precedence:

| Name | Type | Effect |
|------|------|--------|
| `workflow_instance_id` | string | Return only instances belonging to that workflow. If combined with `action_oid`, both filters apply (AND). `status` is ignored. |
| `action_oid` | string | When given without `workflow_instance_id`, return all instances of that action. `status` is ignored. |
| `status` | string | Used only without the two filters above. `"active"` returns instances with no `completed_at`. Any other value is an exact state match (e.g. `"EXECUTING"`, `"HELD"`). |

With no filters the server returns the most recent 100 instances. Results are newest first.

**200 OK**

```json
{
  "data": [
    {
      "instance_id":          "8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4",
      "action_oid":           "act-001",
      "environment_oid":      "env-001",
      "workflow_instance_id": "wf-001",
      "step_instance_id":     "step-001",
      "step_oid":             "smaster-001",
      "visibility":           "observable",
      "state": { "current": "EXECUTING", "previous": "STARTING", "entered_at": "2026-02-24T10:31:02.000Z" },
      "inputs":  [{ "name": "...", "key": "...", "value": "..." }],
      "outputs": [],
      "created_at":   "2026-02-24T10:31:00.000Z",
      "started_at":   "2026-02-24T10:31:01.000Z",
      "completed_at": null,
      "error":        null
    }
  ],
  "meta": { "total": 1 }
}
```

Each entry uses the same shape as REST-04's `data` object. Not implemented by Mission Broker; not used by Mission Engine.

---

### REST-09. Cancel instance (force)

```http
DELETE /trajectory/v1/instances/{instance_id}
```

Mission Engine sends this as best-effort **cleanup after every action terminal** (completed or failed), after an operator abort or a timeout (following `ABORT`), and when it must discard an instance it could not record. It ignores the response.

**Mission Autopilot** sends `ABORT` through the state machine (ignored if the instance is already terminal or in a state where ABORT is invalid) and kills any Python worker running the instance's code. The instance record is **kept** (it ages out by retention) and the SSE bus is not torn down; for an instance that has already completed this is effectively a no-op.

**200 OK** (Mission Autopilot)

```json
{
  "data": {
    "instance_id": "8d4f0c1e-2a6b-4e39-b7d5-93a1f0c6e2d4",
    "cancelled":   true
  },
  "meta": {}
}
```

**404 INSTANCE_NOT_FOUND** — unknown id.

**Mission Broker** deletes the instance record: `200 {"data":{"deleted":true}}`, or `404 {"data":{"deleted":false}}` when there was none.

Runtimes SHOULD prefer REST-05 with `ABORT` for a graceful stop of a running action and use REST-09 for cleanup.

---

### REST-10. List action-properties

```http
GET /trajectory/v1/properties
```

Returns the action-property definitions across every environment on this server. Action-properties are environment-scoped Value Properties whose entries are visible to and updated by action code (`property` SSE events; see REST-12) and can be edited in Mission Autopilot's console.

**200 OK**

```json
{
  "data": {
    "environments": [
      {
        "environment_oid":  "env-001",
        "environment_name": "Kitchen Library",
        "properties": [
          {
            "name":        "OvenSettings",
            "oid":         "ap-001",
            "description": "Current oven controller settings",
            "entries":     [{ "name": "TargetC", "value": "180" }]
          }
        ]
      }
    ]
  },
  "meta": {
    "total_environments": 1,
    "total_properties":   1
  }
}
```

`properties[*].entries[]` is the same `{name, value}` ValueProperty entries shape used everywhere else (see [JSON_SCHEMA §1.7.3](./JSON_SCHEMA.md#173-valueproperty-workflow--or-step--or-env-scoped-values)). Not used by Mission Engine.

---

### REST-11. Get a single property by name

```http
GET /trajectory/v1/properties/{name}
GET /trajectory/v1/properties/{name}?environment_oid=env-001
```

Resolve a single action-property by its `name`. If the name is unique across all environments on this server, no filter is needed. If it appears in more than one env, the request returns **409 AMBIGUOUS_PROPERTY** and the client MUST retry with an explicit `environment_oid` query parameter.

Mission Engine always sends `environment_oid`. It reads current values here for `GATE` steps bound to action-properties and for step inputs bound to action-properties (fetched when the step activates). It reads `data.environment_oid`, `data.name` and `data.entries`.

**200 OK**

```json
{
  "data": {
    "environment_oid":  "env-001",
    "environment_name": "Kitchen Library",
    "name":             "OvenSettings",
    "oid":              "ap-001",
    "description":      "Current oven controller settings",
    "entries":          [{ "name": "TargetC", "value": "180" }]
  },
  "meta": {}
}
```

**404 PROPERTY_NOT_FOUND** — no env has a property with that name (or none of the envs matching `environment_oid` do).
**409 AMBIGUOUS_PROPERTY** — multiple envs have a property with that name and no filter was provided.

```json
{
  "error": {
    "code":    "AMBIGUOUS_PROPERTY",
    "message": "Property 'OvenSettings' found in 2 environments",
    "details": { "environment_oids": ["env-001", "env-007"] }
  }
}
```

---

### REST-12. Server-Sent Events: property stream

Subscribe to changes of a single action-property's entries.

```http
GET /trajectory/v1/properties/{name}/events
GET /trajectory/v1/properties/{name}/events?environment_oid=env-001
Accept: text/event-stream
Last-Event-ID: <integer>     (optional — see §4)
```

Same headers and framing as REST-06: an open SSE stream. Two event types:

| `event` | `data` shape |
|---------|--------------|
| `property` | `{ environment_oid, property_name, entries: [{name, value}], changed_entries: [name, ...], source, source_action_oid?, source_instance_id?, timestamp }` |
| `heartbeat` | `{ timestamp }` — every 30 s for as long as the property's bus exists. |

`entries` is the full current state of the property — clients do NOT need to track diffs themselves. `changed_entries` names the entries the write touched.

`source` is `"action_code"` when the change came from action code (then `source_action_oid` and `source_instance_id` identify the invocation) or `"console"` when an operator edited the value in Mission Autopilot's console.

Resolution rules:

- If the property name is unique across envs, no query filter is needed.
- If the name is ambiguous, the server returns **409 AMBIGUOUS_PROPERTY** before opening the stream; the client retries with `?environment_oid=`.
- If the (name, env) does not exist, the server returns **404 PROPERTY_NOT_FOUND**.

Property buses are global per `(environment_oid, property_name)` — multiple subscribers share one bus and one ring buffer. Deleting or replacing an environment in Mission Autopilot ends the open streams for its properties; clients reconnect.

Mission Engine opens one stream per `(server, environment, property)` watched by an open `GATE`. It uses events only as a **trigger** (debounced about 500 ms) to re-read the values via REST-11; it never reads `entries` from the event. It reconnects with exponential backoff (5 s doubling to 60 s), without `Last-Event-ID`. Not implemented by Mission Broker.

---

## 3. State machine

The action server is the authoritative state machine for every runtime action instance. Runtimes observe states; they do not assign them.

### 3.1 Canonical states

Mission Autopilot uses ISA-88-derived names:

| State | Meaning | Terminal? |
|-------|---------|-----------|
| `POSTED` | Opaque: invoke accepted, not yet processed. | No |
| `RECEIVED` | Opaque: queued for execution. | No |
| `IN_PROGRESS` | Opaque: executing. | No |
| `STARTING` | Observable: initialising. | No |
| `EXECUTING` | Observable: doing work. | No |
| `COMPLETING` | Observable: finalising before `COMPLETED`. | No |
| `PAUSING` / `PAUSED` / `UNPAUSING` | Pause cycle (`UNPAUSING` follows `RESUME`). | No |
| `HOLDING` / `HELD` / `UNHOLDING` | Hold cycle. | No |
| `STOPPING` | Stop in progress; ends in `COMPLETED`. | No |
| `ABORTING` / `ABORTED` | Abort cycle. `ABORTED` is terminal. | `ABORTED` only |
| `CLEARING` | Follows `CLEAR` from `ABORTED`; ends in `COMPLETED`. | No |
| `COMPLETED` | Successful end, and also the end of a `STOP` or `CLEAR`. | Yes |

Mission Autopilot has **no** `STOPPED` state: a stopped instance finishes `COMPLETED`, with whatever outputs its code set. Mission Broker uses only `RUNNING`, `COMPLETED` and `ABORTED`.

**Terminal states a client must recognise.** Mission Engine treats these `state` values as terminal; any other value means "still running":

| Server state | Engine outcome |
|--------------|----------------|
| `COMPLETED` | Step completes; outputs are fetched from REST-04 and mapped to the step's output bindings. |
| `ABORTED` | Step fails with failure mode `ABORT`. |
| `STOPPED` | Step fails with failure mode `ABORT` — except when a `GATE` opened and stopped the action, which completes it. |
| `ERRORED` | Step fails with failure mode `ERROR`. |

A new action server MAY emit any subset of these states as long as the terminal contract holds: every instance reaches exactly one terminal state, and no further `state_change` events follow it. Report a failure as `ABORTED` or `ERRORED`, never as `COMPLETED`.

### 3.2 Command → expected transitions (Mission Autopilot)

| Command | From states | To states (final) |
|---------|-------------|-------------------|
| `PAUSE` | `EXECUTING` | `PAUSING` → `PAUSED` |
| `RESUME` | `PAUSED` | `UNPAUSING` → `EXECUTING` |
| `HOLD` | any active observable state (`STARTING` … `UNHOLDING`, incl. `PAUSED`, `HELD`) | `HOLDING` → `HELD` |
| `UNHOLD` | `HELD` | `UNHOLDING` → `EXECUTING` |
| `STOP` | any active state (observable or opaque) | `STOPPING` → `COMPLETED` |
| `ABORT` | any active state (observable or opaque) | `ABORTING` → `ABORTED` |
| `CLEAR` | `ABORTED` | `CLEARING` → `COMPLETED` |

`CLEAR` is the only command accepted in a terminal state. Action code may also request a command itself, or return `false` from `EXECUTING` to enter `HOLDING`; such transitions appear on the wire like any other.

### 3.3 Opaque vs observable

| | Opaque | Observable |
|---|--------|------------|
| Initial state | `POSTED` → `RECEIVED` → `IN_PROGRESS` → `COMPLETED` | `STARTING` → `EXECUTING` → `COMPLETING` → `COMPLETED` |
| SSE stream | Served (state changes and outputs) | Served |
| Commands advertised | `ABORT` | Full set |
| Commands accepted (Mission Autopilot) | `ABORT`, `STOP` | Full set (§3.2) |
| Commands Mission Engine sends | `ABORT` only (never PAUSE/STOP to an opaque action) | `PAUSE`/`STOP` when advertised; `RESUME`, `ABORT` |

### 3.4 Action-code failures (Mission Autopilot)

When a state's Python code fails (exception, `sys.exit`, timeout, worker crash):

- The failure is **not** returned on any HTTP response; it is reported through the instance: `error` becomes `"<ERROR_TYPE>: <message>"` (REST-04) and the instance moves to `ABORTING` → `ABORTED`. A failure inside `ABORTING`, `STOPPING` or `CLEARING` code goes straight to that state's end (`ABORTED`, `COMPLETED`, `COMPLETED`) instead of looping.
- Outputs the code set before it failed are **kept** on the instance.
- The code is **never re-run automatically** — not on a crash, not on a runtime error. Each state's code runs at most once per instance.
- A failure that arrives after the instance already moved on (for example, the instance was aborted and its worker killed) changes nothing.

---

## 4. SSE reconnection protocol

This section describes Mission Autopilot's streams (REST-06, REST-12). Mission Broker's stream has no replay (§5.6), and Mission Engine does not use `Last-Event-ID` at all (§5.5.4).

### 4.1 Ring buffer

Every per-bus stream keeps the last **256** events in memory (heartbeats included). When the buffer fills, the oldest event is dropped. Buffers do not survive a server restart; event ids then restart at 0.

### 4.2 Last-Event-ID replay

On reconnect, the client SHOULD send the integer id of the last event it received:

```
Last-Event-ID: 42
```

The server replays every buffered event with `id > 42` before transitioning to live mode. Replayed events keep their original `id` values, allowing the client to fast-forward without re-running side effects.

If the requested `Last-Event-ID` is older than the oldest buffered event, the server replays whatever is in the buffer — there is no error signal for "you've missed events". Clients SHOULD reconcile by calling REST-04 (for instance streams) or REST-11 (for property streams) on reconnect.

Without `Last-Event-ID` the two streams differ:

- **Instance stream (REST-06):** the server replays the **whole** buffer first, so a client that subscribes just after the invoke still sees the first `state_change`.
- **Property stream (REST-12):** the stream starts from the next live event.

### 4.3 Heartbeats

Every **30 seconds** for as long as a bus exists, the server emits a `heartbeat` event, whether or not other events were sent:

```
event: heartbeat
id: 17
data: {"timestamp":"2026-02-24T10:32:00.000Z"}

```

Heartbeats take an id and count against the ring-buffer capacity. Clients MUST treat them as keep-alive only and not as state transitions. An instance bus stops heartbeating when the instance reaches a terminal state.

### 4.4 Reconnect cadence

Recommended client behaviour:

1. On disconnect, wait 1 s.
2. Reconnect with `Last-Event-ID` set to the last received id.
3. On failure, exponential backoff up to 30 s.
4. After 5 minutes of consecutive failures, fall back to REST-04 polling.
5. On a successful reconnect later, resume SSE mode.

Browsers' native `EventSource` implements steps 1–3 automatically with `EventSource.onerror` (pass the key as `?token=`, §1.3).

---

## 5. Implementation guide

### 5.1 Minimum viable action server

To be driven by Mission Engine, a new action server MUST implement:

| Endpoint | Why |
|----------|-----|
| `GET /trajectory/v1/capabilities` | Required for loose matching and for any `PAUSE`/`STOP`; without it every command except `ABORT`/`RESUME` is treated as unsupported. |
| `POST /trajectory/v1/actions/{action_oid}/invoke` | Without this nothing runs. Must answer `201`. |
| `GET /trajectory/v1/instances/{instance_id}` | The engine's durable poll (every 20 s by default). |
| `POST /trajectory/v1/instances/{instance_id}/command` | `ABORT` on operator abort and on step timeout; `PAUSE`/`RESUME`/`STOP` for observable actions. |

Strongly recommended:

| Endpoint | Why |
|----------|-----|
| `GET /trajectory/v1/instances/{instance_id}/events` | The low-latency path: a terminal `state_change` is acted on at once instead of at the next poll. |
| `DELETE /trajectory/v1/instances/{instance_id}` | The engine's best-effort cleanup after each terminal; a 404 is fine. |

Needed only for specific step features:

| Endpoint | Why |
|----------|-----|
| `GET /trajectory/v1/properties/{name}` | `GATE` steps and step inputs bound to action-properties. |
| `GET /trajectory/v1/properties/{name}/events` | Lets a property-bound `GATE` react to changes instead of waiting for its next check. |

Optional (operational visibility, test tools): `GET /trajectory/v1/health`, `GET /trajectory/v1/instances`, `GET /trajectory/v1/properties`.

### 5.2 Minimum viable runtime

To drive a stock action server, a new runtime MUST:

1. Resolve the action server's origin for the step's environment (Mission Engine: the work center's environment binding, §1.1) and send that server's credential (§1.3).
2. On `ACTION PROXY` step entry, build the REST-03 request body: `environment_oid`, the workflow/step instance ids, the step's master `oid`, and the resolved input parameters — and nothing else (Mission Autopilot rejects unknown fields).
3. Open REST-06 SSE and/or poll REST-04 until a terminal state (§3.1).
4. On operator abort or step timeout, send REST-05 `ABORT`. Use REST-09 for cleanup once the instance is terminal.
5. On `COMPLETED`, read the outputs from REST-04 and write them to the step's `output_parameter_specifications[*].target` Value Property bindings, matching each pair's name to the output spec's `id`.

### 5.3 Concurrency

The action server MUST handle multiple concurrent instances. Each instance is independent — its own state machine, its own SSE bus, its own inputs and outputs. The `instance_id` is the unique key for everything else (commands, polling, SSE, cancellation). Mission Autopilot serializes commands per instance with a compare-and-set on the state, so of two racing commands the second gets `409`.

Mission Autopilot runs action code in a pool of Python worker processes (`python_pool_size`, default 4); further code executions queue until a worker is free. `pool` in REST-01 shows the current counts.

### 5.4 Protocol versioning

The path prefix `/trajectory/v1/` is the version. Future incompatible changes move to `/v2/`. A `v1` server MUST reject requests on `/v2/` with `404`.

There is no protocol-version negotiation header in v1. Runtimes that need to detect v2 servers SHOULD probe `GET /trajectory/v2/health` and fall back to v1 on 404.

### 5.5 Mission Engine client behaviour

What the reference runtime actually puts on the wire, so a new action server can be built against it.

#### 5.5.1 Strict vs loose action matching

The mode is a system setting in Mission Commander, read on every dispatch.

| Mode | Path `action_oid` and body `environment_oid` | Requires |
|------|-----------------------------------------------|----------|
| **Strict** | The package's oids, exactly as authored in Mission Designer. | The action server hosts the action under that same oid (true when the package was imported into Mission Autopilot). |
| **Loose** | The oids **this server** reports in REST-02 for the environment whose `environment_name` equals the package's environment name, and the action in it whose `action_name` equals the package's action name (exact, case-sensitive). | Exactly one environment and one action match, and the matched action lists every input the step itself declares in its `input_parameters`. Starting parameters the step does not declare are still sent but not required. |

Under loose matching, a miss (no match, ambiguous match, missing input) discards the cached capabilities and retries once with a fresh REST-02 before failing the step. Either way the invoke body's `input_parameters` names are the step's input ids.

#### 5.5.2 Dispatch, retries and idempotency

- Every request except the two SSE streams has a **10-second** timeout (`ACTION_FETCH_TIMEOUT_MS`).
- A failed invoke (network error, timeout, any non-`201`) is **not retried**: the step fails with failure mode `ERROR`, which a `TRY`/`CATCH` can handle. A `404` is reported as "no action … for environment …".
- The engine re-sends an invoke for the same `step_instance_id` only when a previous attempt's result was never recorded (for example, the engine stopped mid-call); it waits `INVOKE_GRACE_SECS` (default 60 s) before doing so. Mission Broker de-duplicates such a repeat (REST-03); Mission Autopilot starts a second instance. A loop that re-enters the same step is a new activation and invokes again.
- If the engine invoked successfully but the step had meanwhile been stopped or aborted, it sends REST-09 for the new instance.

#### 5.5.3 Commands

| Engine event | Command sent | Condition |
|--------------|--------------|-----------|
| Operator **Pause** | `PAUSE` | The action is observable and REST-02 lists `PAUSE`; otherwise the action keeps running. |
| Operator **Resume** | `RESUME` | Every step that was paused (no capability check). |
| Operator **Stop** | `STOP` | Once per step, when the action is observable and lists `STOP`; otherwise the engine waits for the action to finish on its own. |
| `GATE` opens | `STOP` | To the gate's predecessor action, when supported. |
| Operator **Abort** | `ABORT`, then `DELETE` | Always. |
| Step timeout (`timeout_ms` elapsed; paused time does not count) | `ABORT` | Always; the step then fails with failure mode `TIMEOUT` regardless of what the server reports. |

Responses: `200` and `409` mean delivered; `404` means the instance is gone. For `PAUSE` and `STOP`, a `401`, other `4xx` or an origin the trust policy refuses is a refusal shown to the operator; a `5xx` or network failure marks the server unreachable, undoes the engine's record of the command and sends it again once the server answers. A failed `RESUME` is only logged. The `HOLD`, `UNHOLD` and `CLEAR` commands are never sent.

#### 5.5.4 Observation

- **SSE.** Right after recording a successful invoke, the engine opens REST-06 with `Accept: text/event-stream` and its credential header. It sends no `Last-Event-ID` and never reconnects this stream; if the stream ends, polling carries on. On a `state_change` with a terminal state (§3.1) it settles the step at once.
- **Polling.** Independently, it polls REST-04 every `ACTION_POLL_SECS` (default 20 s), sooner when the step timeout is closer. It reads `data.state.current` (or `data.state` when it is a string) and each output's `name` (or `key`). A `404` fails the step ("Instance lost on server"); any other failure is logged, retried on the next poll, and after 2 minutes of failures shown once to the operator as a warning — it never fails the step by itself (only `timeout_ms` does).
- **Completion.** On `COMPLETED` the engine fetches REST-04 once more and maps `outputs` by name to the step's output specs. On a failure terminal it does not read outputs. It then sends REST-09.

### 5.6 Mission Broker differences

Mission Broker serves the Distributed Workflow actions over the same protocol. It reads and writes the same database as Mission Engine and Mission Commander, so it is not a general-purpose action server. Its actions, inputs, outputs and result codes are documented in [DISTRIBUTED_WORKFLOW_LIBRARY.md](./DISTRIBUTED_WORKFLOW_LIBRARY.md#3-the-actions). On the wire:

- **Auth:** `Authorization: Bearer <MISSION_BROKER_TOKEN>` (§1.3); `/health` at the root is open.
- **Endpoints:** REST-02, 03, 04, 05, 06 and 09 only.
- **REST-02:** one environment, `environment_oid` `broker-env`, `environment_name` `Distributed Workflow Management` (the name loose matching needs). Every action is `opaque` with `supported_commands: ["ABORT"]`; `input_parameters` carry only `name`. No `action_properties`, no `meta`.
- **REST-03:** body fields `workflow_instance_id`, `step_instance_id` (both UUIDs), `step_oid`, `input_parameters`; other fields are ignored. The ids must name an `ACTION PROXY` step of that runtime that is currently waiting on **this** action, otherwise `403 FORBIDDEN`. The action is found by `action_oid` (Mission Broker's own oids, as under loose matching) or, under strict matching, by the calling step's action name. One run per step activation (REST-03 idempotency).
- **Results:** an action's own refusal (unknown work center, wrong state, …) is **not** an HTTP error: the instance completes with `Completion.Code` / `Error.Text` outputs, so the workflow can branch on them. Outputs are `{name, value}` pairs whose values use the Value Property list form (§1.7).
- **States:** `RUNNING`, `COMPLETED`, `ABORTED`. Every action except *Wait for Runtime Workflow* is already `COMPLETED` when the invoke returns. A wait stays `RUNNING` until its target runtime finishes; it ends `ABORTED` if the calling step stops waiting or its runtime is aborting or finished, and `COMPLETED` with a "calling runtime is stopping" code if the caller is stopping.
- **REST-04:** `{ "data": { "state", "outputs" } }` only.
- **REST-05:** `ABORT` from `RUNNING` only; everything else `409`.
- **REST-06:** only `state_change` events. On connect, an already-terminal instance's terminal `state_change` is sent immediately. Event ids come from one server-wide counter starting at 1; there is no ring buffer and no `Last-Event-ID` replay. Instead of `heartbeat` events the stream carries an SSE comment line (`: ping`) every 30 s.
- **REST-09:** deletes the record (`{ "data": { "deleted": true } }`, or `404` with `deleted: false`).

---

## Appendix A — Quick reference cards

### A.1 Opaque action flow (polling)

```
Runtime                                Action server
  │                                          │
  ├── POST /actions/{oid}/invoke ──────────► │
  │   { environment_oid, wf/step ids,        │
  │     step_oid, input_parameters }         ├── Creates instance, state = POSTED
  │ ◄── 201 { instance_id } ─────────────────┤
  │                                          │
  │── GET /instances/{id} ──────────────────► │
  │ ◄── 200 { state: "RECEIVED" } ───────────┤
  │                                          │
  │── GET /instances/{id} ──────────────────► │  (polling)
  │ ◄── 200 { state: "IN_PROGRESS" } ────────┤
  │                                          │
  │── GET /instances/{id} ──────────────────► │
  │ ◄── 200 { state: "COMPLETED",            │
  │           outputs: [...] } ──────────────┤
  │                                          │
  │── DELETE /instances/{id} ───────────────► │  (best-effort cleanup)
```

(`state` is shown as a string, as Mission Broker sends it; Mission Autopilot sends `state: { current, previous, entered_at }`. Mission Engine accepts both.)

### A.2 Observable action flow

```
Runtime                                Action server
  │                                          │
  ├── POST /actions/{oid}/invoke ──────────► │
  │ ◄── 201 { instance_id } ─────────────────┤
  │                                          │
  ├── GET /instances/{id}/events ──────────► │  (SSE open)
  │                                          │
  │ ◄── event: state_change                ──┤  null → STARTING
  │ ◄── event: state_change                ──┤  STARTING → EXECUTING
  │ ◄── event: output                      ──┤  (after each state_change, if outputs exist)
  │                                          │
  │── POST /instances/{id}/command ────────► │  { command: "PAUSE" }
  │ ◄── 200 { accepted: true } ──────────────┤
  │ ◄── event: state_change                ──┤  EXECUTING → PAUSING → PAUSED
  │                                          │
  │── POST /instances/{id}/command ────────► │  { command: "RESUME" }
  │ ◄── event: state_change                ──┤  PAUSED → UNPAUSING → EXECUTING
  │ ◄── event: state_change                ──┤  EXECUTING → COMPLETING
  │ ◄── event: state_change                ──┤  COMPLETING → COMPLETED  (terminal)
  │ ◄── event: output                      ──┤  final outputs
  │                                          │  (heartbeat stops; bus lingers 7 s)
  │── GET /instances/{id} ──────────────────► │  (authoritative outputs)
  │── DELETE /instances/{id} ───────────────► │  (best-effort cleanup)
```

### A.3 Property flow

```
Runtime                                Action server
  │                                          │
  ├── GET /properties/OvenSettings/events ──►│  (SSE open)
  │     ?environment_oid=env-001             │
  │ ◄── event: property                    ──┤  { changed_entries:["TargetC"],
  │                                          │    entries:[{name:"TargetC",value:"200"}],
  │                                          │    source:"action_code", ... }
  ├── GET /properties/OvenSettings ─────────►│  (re-read current values)
  │     ?environment_oid=env-001             │
  │ ◄── event: heartbeat                   ──┤  (every 30 s)
```

### A.4 Endpoint summary

| Method | Path | Auth | SSE | Mission Broker |
|--------|------|:----:|:---:|:---:|
| GET | `/trajectory/v1/health` | yes | — | — |
| GET | `/trajectory/v1/capabilities` | yes | — | ✓ |
| POST | `/trajectory/v1/actions/{action_oid}/invoke` | yes | — | ✓ |
| GET | `/trajectory/v1/instances/{instance_id}` | yes | — | ✓ |
| POST | `/trajectory/v1/instances/{instance_id}/command` | yes | — | ✓ |
| GET | `/trajectory/v1/instances/{instance_id}/events` | yes (`?token=` allowed) | ✓ | ✓ |
| GET | `/trajectory/v1/instances` | yes | — | — |
| DELETE | `/trajectory/v1/instances/{instance_id}` | yes | — | ✓ |
| GET | `/trajectory/v1/properties` | yes | — | — |
| GET | `/trajectory/v1/properties/{name}` | yes | — | — |
| GET | `/trajectory/v1/properties/{name}/events` | yes (`?token=` allowed) | ✓ | — |

The root `GET /health` of both servers is unauthenticated.

---

## Appendix B — References

- Mission Autopilot public router: `MissionAutopilot/packages/server/src/routes/protocol.ts`
- Mission Autopilot command and instance-stream router: `MissionAutopilot/packages/server/src/routes/commands.ts`
- Mission Autopilot SSE manager (ring buffers, heartbeats, property buses): `MissionAutopilot/packages/server/src/sse-manager.ts`
- Mission Autopilot API-key, Host and Origin checks: `MissionAutopilot/packages/server/src/middleware/auth.ts`, `middleware/host-check.ts`, `config.ts`
- Mission Autopilot state machine: `MissionAutopilot/packages/engine/src/state-machine/`
- Mission Broker: `MissionBroker/src/app.ts` (routes), `auth.ts`, `events.ts`, `catalog.ts`
- Mission Engine client: `MissionEngine/src/actions/client.ts` (requests, credentials, trust), `invoker.ts` (matching, invoke), `sse.ts` (stream parser), `monitor.ts` (terminals); polling and timeouts in `MissionEngine/src/loop.ts`; commands in `MissionEngine/src/core/control.ts`
- Browser test client for any action server: `MissionAutopilotTester/`
- Distributed Workflow actions: [DISTRIBUTED_WORKFLOW_LIBRARY.md](./DISTRIBUTED_WORKFLOW_LIBRARY.md)
- Companion spec for the JSON shapes carried over this wire: [JSON_SCHEMA.md](./JSON_SCHEMA.md)
