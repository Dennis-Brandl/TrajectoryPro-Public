# Trajectory — Runtime ↔ Action Container REST Protocol

**Audience.** Implementers of new Trajectory Runtimes and new Action Containers. Anything that needs to drive or host environment actions over the wire.

**Scope.** This document defines the **public** REST surface served by a Trajectory Action Container at `/trajectory/v1/*` and consumed by a Trajectory Runtime when its workflows execute `ACTION PROXY` / `WAIT ACTION PROXY` steps. It also defines the Server-Sent Events (SSE) streams that carry state and property updates back to the Runtime.

It does **not** cover:

- The Action Container's `/management/v1/*` routes (console UI: upload, export, snapshot, code editing, settings) — these are private to the container's own console and the conformance test harness.
- The Editor's internal `/api/v2/*` routes for library import/export — those are Editor-internal.
- Authoring-time formats (use [JSON_SCHEMA.md](./JSON_SCHEMA.md)).

**Protocol version.** `v1`. The version appears in the URL path (`/trajectory/v1/...`). Future revisions move to `/v2/`, `/v3/`, etc.

---

## 1. Protocol basics

### 1.1 Base URL

Every action server exposes the protocol under a single fixed prefix:

```
<action_server_base_uri>/trajectory/v1/
```

Where `<action_server_base_uri>` is the value of an `action_server_specifications[*].uri` from an `EnvironmentSpecification` ([JSON_SCHEMA §1.8](./JSON_SCHEMA.md#18-environmentspecification)).

Example: `https://factory-floor.example.com/trajectory/v1/`.

### 1.2 Content types

| Direction | Header | Value |
|-----------|--------|-------|
| Request body | `Content-Type` | `application/json` |
| Response body (non-SSE) | `Content-Type` | `application/json` |
| Response body (SSE) | `Content-Type` | `text/event-stream` |
| Request (SSE) | `Accept` | `text/event-stream` |
| Request (SSE replay) | `Last-Event-ID` | integer string (event id of the last event received) |

All payloads are UTF-8.

### 1.3 Authentication

API key authentication via a single header:

```
X-API-Key: <secret>
```

Servers MAY operate in two modes:

| Mode | Behaviour |
|------|-----------|
| **Open access** | No `api_key` configured in the server's settings. All `/trajectory/v1/*` requests are accepted regardless of headers. |
| **Required** | An `api_key` value is configured. Requests without a matching `X-API-Key` header are rejected with `401 UNAUTHORIZED`. |

The mode is server-configured and is not negotiable per request. New runtimes SHOULD always send `X-API-Key` when configured by the operator; new containers SHOULD support both modes.

The `Authorization` header is reserved for future bearer/OAuth flows.

### 1.4 CORS

Servers SHOULD expose:

```
Access-Control-Allow-Origin:  *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-API-Key, Last-Event-ID
Access-Control-Expose-Headers: Content-Type
```

Browser-based runtimes need `Last-Event-ID` in `Allow-Headers` to support SSE reconnection.

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

### 1.6 Standard error codes

| HTTP | `code` | When |
|------|--------|------|
| 400 | `VALIDATION_ERROR` | Request body fails schema validation (missing/invalid field). |
| 401 | `UNAUTHORIZED` | `X-API-Key` missing or wrong (when auth is configured). |
| 404 | `INSTANCE_NOT_FOUND` | The `instance_id` is unknown to this server. |
| 404 | `PROPERTY_NOT_FOUND` | No env on this server exposes the named property. |
| 404 | `NOT_FOUND` | Generic resource miss (e.g., unknown action OID at invoke time, surfaced via `INSTANCE_NOT_FOUND` semantics by the engine; some legacy paths use `NOT_FOUND`). |
| 409 | `AMBIGUOUS_PROPERTY` | Property name resolves to more than one environment and no `environment_oid` filter was provided. |
| 422 | `INVALID_COMMAND` | Command name not in the canonical set (`PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP`, `CLEAR`). |
| 500 | *(implementation-specific)* | Unhandled internal error. Container MAY include a sanitized traceback in `details` if `expose_traceback` is enabled in its settings. |

Clients MUST treat any non-2xx body as an error and parse `error.code` before falling back to status code text.

### 1.7 Wire conventions

- All IDs are opaque strings. Runtimes generate `workflow_instance_id` and `step_instance_id`; containers generate `instance_id` (the runtime action instance ID).
- All timestamps are ISO 8601 UTC with millisecond precision.
- Parameter values on the wire are **stringified**, even when their semantic type is numeric or boolean. Both the Runtime and the Action Container coerce on the way in and out. This matches the storage shape of `default_value` in [JSON_SCHEMA §1.7.1](./JSON_SCHEMA.md#171-inputparameter-workflow-inputs-step-inputs-action-inputs).

---

## 2. Endpoint reference

| # | Method | Path | Purpose |
|---|--------|------|---------|
| REST-01 | `GET` | `/health` | Liveness probe. |
| REST-02 | `GET` | `/capabilities` | Discover environments, actions, action-properties, supported commands. |
| REST-03 | `POST` | `/actions/{action_oid}/invoke` | Start a new Runtime Action Instance. |
| REST-04 | `GET` | `/instances/{instance_id}` | Fetch current instance state (polling). |
| REST-05 | `POST` | `/instances/{instance_id}/command` | Send a state-machine command (PAUSE/HOLD/ABORT/…). |
| REST-06/07 | `GET` | `/instances/{instance_id}/events` | SSE stream of instance state changes, outputs, logs, heartbeats. |
| REST-08 | `GET` | `/instances` | List instances (with filters). |
| REST-09 | `DELETE` | `/instances/{instance_id}` | Force-cancel an instance. |
| REST-10 | `GET` | `/properties` | List action-properties across all envs on this server. |
| REST-11 | `GET` | `/properties/{name}` | Fetch one action-property by name. |
| REST-12 | `GET` | `/properties/{name}/events` | SSE stream of property-value changes. |

---

### REST-01. Health check

```http
GET /trajectory/v1/health
```

No request body. No `X-API-Key` required (servers MAY apply auth here, but the canonical implementation leaves it open under the auth-required mode as well, since the path is mounted under `/trajectory/v1` after the auth middleware in the reference container — implementers MAY make health unauthenticated by mounting it outside the auth scope; the reference container does not).

**200 OK**

```json
{
  "data": {
    "status":    "ok",
    "timestamp": "2026-02-24T10:30:00.000Z",
    "pool": { /* implementation-specific worker pool snapshot */ }
  },
  "meta": {}
}
```

`status` is always `"ok"` on a healthy server. `pool` is opaque telemetry and may be empty `{}`. The reference container exposes Python-sidecar worker stats here.

Runtimes SHOULD probe `/health` on first connect to detect protocol-incompatible endpoints. There is no required schema on `data.pool` and runtimes MUST NOT depend on its shape.

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

Notes for implementers:

- `environments[]` is the discovery unit. A container hosts one or more envs; each env owns zero or more actions.
- `input_parameters[*]` and `output_parameters[*]` are **normalized**: only `name`, `description?`, `default_value?`, `json_schema?` are guaranteed. The container collapses heterogeneous stored shapes (`{id, default_value, value_type, ...}` vs `{name, data_type, default_value}` vs the property-typed `{id, oid, default_value, entries}`) onto this single wire contract. Consumers MUST NOT assume `id` is present on the wire.
- `visibility ∈ {"opaque", "observable"}` is the *declared* visibility of the action. The Runtime decides per-invocation what visibility to actually request; some actions support both.
- `supported_commands` is `["PAUSE","RESUME","HOLD","UNHOLD","ABORT","STOP","CLEAR"]` for observable actions; `["ABORT"]` for opaque actions.

---

### REST-03. Invoke action

Start a new Runtime Action Instance.

```http
POST /trajectory/v1/actions/{action_oid}/invoke
Content-Type: application/json
```

**Path parameters**

| Name | Type | Notes |
|------|------|-------|
| `action_oid` | string | The Master Action Specification OID (the `oid` of the action inside its environment's `included_actions[]`). |

**Request body**

```json
{
  "environment_oid":      "env-001",
  "workflow_instance_id": "wf-runtime-abc",
  "step_instance_id":     "step-runtime-xyz",
  "step_oid":             "step-master-002",
  "input_parameters": [
    { "name": "target_temperature", "value": "200" },
    { "name": "recipe_name",        "value": "Bolognese Sauce" }
  ],
  "timeout_ms":               300000,
  "action_property_overrides": {
    "OvenSettings": { "TargetC": "200" }
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `environment_oid` | string | Yes | Which env on this server this action is invoked under. Required because some action OIDs can be reused across envs. |
| `workflow_instance_id` | string | Yes | Runtime's workflow-level instance id. Opaque to the container. |
| `step_instance_id` | string | Yes | Runtime's step-level instance id. Opaque to the container. |
| `step_oid` | string | Yes | Master OID of the `ACTION PROXY` step in the workflow spec. |
| `input_parameters` | array of `{name, value}` | Yes | All values are strings. Use `"true"`/`"false"` for booleans, decimal/integer strings for numbers. |
| `timeout_ms` | number | No | Override the action's default timeout (`timeout_seconds * 1000`). |
| `action_property_overrides` | object | No | Per-invocation override of action-property entries. Map of `propertyName → entryName → entryValue`. Test/dev affordance — production runtimes typically omit. |

Auto-derived per the action's declared `visibility`:

- For `"opaque"` actions, the container returns immediately and the initial state is `POSTED`. No SSE stream is opened.
- For `"observable"` actions, the container creates the instance and reports the initial state via the SSE endpoint. The first state is typically `STARTING`.

**201 Created**

```json
{
  "data": {
    "instance_id": "rai-server-generated-uuid"
  },
  "meta": {}
}
```

The Runtime then uses `instance_id` for all subsequent operations on this invocation.

**400 VALIDATION_ERROR** — a required field is missing or has the wrong type.

```json
{
  "error": {
    "code":    "VALIDATION_ERROR",
    "message": "Field 'environment_oid' is required",
    "details": {}
  }
}
```

---

### REST-04. Get instance status

```http
GET /trajectory/v1/instances/{instance_id}
```

**Path parameters**

| Name | Type | Notes |
|------|------|-------|
| `instance_id` | string | Server-generated id from the invoke response. |

**200 OK**

```json
{
  "data": {
    "instance_id":          "rai-server-uuid",
    "action_oid":           "act-001",
    "environment_oid":      "env-001",
    "workflow_instance_id": "wf-runtime-abc",
    "step_instance_id":     "step-runtime-xyz",
    "step_oid":             "step-master-002",
    "visibility":           "observable",
    "state": {
      "current":    "EXECUTING",
      "previous":   "STARTING",
      "entered_at": "2026-02-24T10:31:02.418Z"
    },
    "inputs":       [{ "name": "target_temperature", "value": "200" }],
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
| `state.current` | The current state of the action instance (see §3 for the canonical state set). |
| `state.previous` | Last distinct state before `current`. `null` if the instance is in its initial state. |
| `state.entered_at` | Timestamp of the transition into `state.current`. Falls back to `created_at` if no transitions have occurred. |
| `outputs` | Array of `{name, value}` produced by the action so far. Final on terminal states (`COMPLETED`, `ABORTED`, `STOPPED`). May be partially populated during execution. |
| `error` | `null` while healthy; object `{ message, code? }` on failure. The container's internal storage may carry richer structure — clients SHOULD only depend on `message`. |
| `completed_at` | Set on transition into a terminal state; `null` otherwise. |

**404 INSTANCE_NOT_FOUND** — unknown id.

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

`command` MUST be one of `PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP`, `CLEAR`. Any other value yields **422 INVALID_COMMAND**.

Command validity by current state (the container is the authority — clients SHOULD treat the engine's response as definitive):

| Current state | Valid commands |
|---------------|---------------|
| `STARTING` | `ABORT`, `STOP` |
| `EXECUTING` | `PAUSE`, `HOLD`, `ABORT`, `STOP` |
| `COMPLETING` | `ABORT`, `STOP` |
| `PAUSED` | `RESUME`, `ABORT`, `STOP` |
| `HELD` | `UNHOLD`, `ABORT`, `STOP` |
| `ABORTED` | `CLEAR` |
| `POSTED` (opaque) | `ABORT` |

**200 OK**

```json
{
  "data": {
    "instance_id": "rai-server-uuid",
    "command":     "PAUSE",
    "accepted":    true
  },
  "meta": {}
}
```

A 200 with `accepted: true` only means the command was queued onto the engine. The actual state transition follows asynchronously and is observable via REST-04 polling or REST-06 SSE.

**404 INSTANCE_NOT_FOUND** — unknown id.
**422 INVALID_COMMAND** — command not in the canonical set.

The engine may also reject a command that is invalid for the current state. The wire shape of that rejection is implementation-defined; the reference container surfaces it as a 5xx with `code: INSTANCE_ERROR` (or similar). Clients SHOULD reissue / give up based on a subsequent REST-04 lookup, not on the command response alone.

---

### REST-06 / REST-07. Server-Sent Events: instance stream

Subscribe to real-time updates for a single instance.

```http
GET /trajectory/v1/instances/{instance_id}/events
Accept: text/event-stream
Last-Event-ID: <integer>     (optional — see §4)
```

**Response 200 OK**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection:    keep-alive
X-Accel-Buffering: no
```

The body is an open SSE stream until the client disconnects or the instance reaches its terminal-linger window expiry. Each event uses the standard SSE framing:

```
id: 17
event: state_change
data: {"instance_id":"rai-uuid","state":"EXECUTING","previous_state":"STARTING","timestamp":"2026-02-24T10:31:02.418Z"}

```

The `id` is a per-bus monotonic integer starting at 0 (used by `Last-Event-ID` reconnection — see §4). The `event` field selects the variant; `data` is a single JSON object on one line.

#### Event types

| `event` | `data` shape |
|---------|--------------|
| `state_change` | `{ instance_id, state, previous_state, timestamp }` — emitted on every state transition. `previous_state` is `null` for the first event. |
| `output` | `{ instance_id, outputs: [{name, value}], timestamp }` — emitted whenever `outputs` becomes non-empty or grows. May be emitted multiple times during a long-running action. The final terminal `state_change` is always preceded by the last `output` (if any outputs were produced). |
| `log` | `{ instance_id, stream: "stderr", message, timestamp }` — implementation-defined diagnostic log. The reference container uses this to surface action-execution errors. |
| `property` | Reserved on this stream (the canonical property-events stream is REST-12). The reference container does NOT emit `property` events on the instance stream. |
| `heartbeat` | `{ timestamp }` — keep-alive sent every 30 seconds when no other events have been emitted. Carries no instance state; presence proves the channel is alive. |

#### Terminal handling

When the instance reaches a terminal state (`COMPLETED`, `ABORTED`, `STOPPED`):

1. The container emits the final `state_change` (and a preceding `output` if outputs were produced).
2. The heartbeat timer stops.
3. The bus lingers for **7 seconds** (default `TERMINAL_LINGER_MS`) so any in-flight subscribers can pick up the final events.
4. The bus is then GC'd. A subsequent reconnect for that `instance_id` will get the instance's current state via REST-04 but no further SSE events.

#### Instance not found

If the `instance_id` is unknown, the container returns **404** with the standard error envelope before opening the SSE stream:

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

**Query parameters**

| Name | Type | Effect |
|------|------|--------|
| `workflow_instance_id` | string | Return only instances belonging to that workflow. If combined with `action_oid`, both filters apply (AND). |
| `action_oid` | string | When alone, return all instances of that action across all workflows. |
| `status` | string | `"active"` returns non-terminal instances. Any other value (e.g. `"EXECUTING"`, `"HELD"`) is treated as an exact state match. |

If no filters are provided, the container returns the most recent 100 instances.

**200 OK**

```json
{
  "data": [
    {
      "instance_id":          "rai-1",
      "action_oid":           "act-001",
      "environment_oid":      "env-001",
      "workflow_instance_id": "wf-001",
      "step_instance_id":     "step-001",
      "step_oid":             "smaster-001",
      "visibility":           "observable",
      "state": { "current": "EXECUTING", "previous": "STARTING", "entered_at": "2026-02-24T10:31:02.000Z" },
      "inputs":  [{ "name": "...", "value": "..." }],
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

Each entry uses the same shape as REST-04's `data` object.

---

### REST-09. Cancel instance (force)

```http
DELETE /trajectory/v1/instances/{instance_id}
```

Forcefully cancel an instance. Equivalent in effect to sending `ABORT` and then reaping immediately. The reference container also tears down the per-instance SSE bus, ending any open streams for that id.

**200 OK**

```json
{
  "data": {
    "instance_id": "rai-uuid",
    "cancelled":   true
  },
  "meta": {}
}
```

**404 INSTANCE_NOT_FOUND** — unknown id.

Runtimes SHOULD prefer REST-05 with `ABORT` for graceful shutdown and reserve REST-09 for catastrophic cleanup (workflow being purged, container shutdown, etc.).

---

### REST-10. List action-properties

```http
GET /trajectory/v1/properties
```

Returns the action-property definitions across every environment on this server. Action-properties are environment-scoped Value Properties whose entries are visible to and updated by action code (`property` SSE events; see REST-12).

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

`properties[*].entries[]` is the same `{name, value}` ValueProperty entries shape used everywhere else (see [JSON_SCHEMA §1.7.3](./JSON_SCHEMA.md#173-valueproperty-workflow--or-step--or-env-scoped-values)).

---

### REST-11. Get a single property by name

```http
GET /trajectory/v1/properties/{name}
GET /trajectory/v1/properties/{name}?environment_oid=env-001
```

Resolve a single action-property by its `name`. If the name is unique across all environments on this server, no filter is needed. If it appears in more than one env, the request returns **409 AMBIGUOUS_PROPERTY** and the client MUST retry with an explicit `environment_oid` query parameter.

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

Same envelope as REST-06: an open SSE stream. Two event types:

| `event` | `data` shape |
|---------|--------------|
| `property` | `{ environment_oid, property_name, entries: [{name, value}], changed_entries: [name, ...], source: "action_code", source_action_oid?, source_instance_id?, timestamp }` |
| `heartbeat` | `{ timestamp }` — every 30 s when idle. |

`changed_entries` is the list of entry names whose `value` differs from the previous emission for this `(env, property)` pair. `entries` is the full current state — clients do NOT need to track diffs themselves.

`source` is always `"action_code"` in v1.0 (no other source emits property updates today). `source_action_oid` and `source_instance_id` identify the originating action invocation when known.

Resolution rules:

- If the property name is unique across envs, no query filter is needed.
- If the name is ambiguous, the server returns **409 AMBIGUOUS_PROPERTY** before opening the stream; the client retries with `?environment_oid=`.
- If the (name, env) does not exist, the server returns **404 PROPERTY_NOT_FOUND**.

Property buses are global per `(env_oid, property_name)` — multiple subscribers share one bus and one ring buffer.

---

## 3. State machine

The Action Container is the authoritative state machine for every runtime action instance. Runtimes observe states; they do not assign them.

### 3.1 Canonical states

The reference container uses ISA-88-derived names. The set is:

| State | Meaning | Terminal? |
|-------|---------|-----------|
| `POSTED` | Opaque-only: invoke accepted, not yet processed. | No |
| `RECEIVED` | Opaque-only: queued for execution. | No |
| `IN_PROGRESS` | Opaque-only: executing. | No |
| `STARTING` | Observable: initialising. | No |
| `EXECUTING` | Observable: doing work. | No |
| `COMPLETING` | Observable: finalising before `COMPLETED`. | No |
| `PAUSING` / `PAUSED` / `RESUMING` | Pause cycle. | No |
| `HOLDING` / `HELD` / `UNHOLDING` | Hold cycle. | No |
| `STOPPING` / `STOPPED` | Stop cycle. `STOPPED` is terminal. | `STOPPED` only |
| `ABORTING` / `ABORTED` | Abort cycle. `ABORTED` is terminal. | `ABORTED` only |
| `COMPLETED` | Successful terminal state. | Yes |

A new container MAY emit any subset of these states as long as the terminal contract holds: every instance reaches exactly one of `{COMPLETED, ABORTED, STOPPED}`, and no further events are emitted after the terminal `state_change`.

### 3.2 Command → expected transitions

| Command | From states | To states (final) |
|---------|-------------|-------------------|
| `PAUSE` | `EXECUTING` | `PAUSING` → `PAUSED` |
| `RESUME` | `PAUSED` | `RESUMING` → `EXECUTING` |
| `HOLD` | `EXECUTING` | `HOLDING` → `HELD` |
| `UNHOLD` | `HELD` | `UNHOLDING` → `EXECUTING` |
| `STOP` | most non-terminal | `STOPPING` → `STOPPED` |
| `ABORT` | most non-terminal | `ABORTING` → `ABORTED` |
| `CLEAR` | `ABORTED` | (engine-defined — typically removes the instance) |

The `CLEAR` command is the only command accepted in a terminal state. Its effect (e.g. delete the instance, archive it) is engine-defined.

### 3.3 Opaque vs observable

| | Opaque | Observable |
|---|--------|------------|
| Initial state | `POSTED` → `RECEIVED` → `IN_PROGRESS` | `STARTING` → `EXECUTING` |
| SSE stream | Not opened by the container. Runtime polls REST-04. | Open from invoke until terminal-linger expires. |
| Commands accepted | `ABORT` only | Full set (§3.2) |
| Output delivery | Single final `outputs` on terminal state, retrieved via REST-04. | `output` SSE events during execution + final on terminal. |

Runtimes that poll opaque actions SHOULD use exponential backoff starting at 1 s and capping at 30 s.

---

## 4. SSE reconnection protocol

Both SSE streams (REST-06, REST-12) implement a uniform reconnection protocol.

### 4.1 Ring buffer

Every per-bus stream keeps the last **256** events in memory. When the buffer fills, the oldest event is dropped.

### 4.2 Last-Event-ID replay

On reconnect, the client SHOULD send the integer id of the last event it received:

```
Last-Event-ID: 42
```

The server replays every buffered event with `id > 42` before transitioning to live mode. Replayed events keep their original `id` values, allowing the client to fast-forward without re-running side effects.

If the requested `Last-Event-ID` is older than the oldest buffered event (e.g. the client was offline for an hour), the server replays whatever is in the buffer — there's no error signal for "you've missed events". Clients SHOULD reconcile by calling REST-04 (for instance streams) or REST-11 (for property streams) on reconnect.

If `Last-Event-ID` is absent on first connect, the server starts the stream from the next live event.

### 4.3 Heartbeats

When no other events have been emitted for **30 seconds**, the server emits a `heartbeat` event:

```
id: 17
event: heartbeat
data: {"timestamp":"2026-02-24T10:32:00.000Z"}

```

Heartbeats count against the ring-buffer capacity. Clients MUST treat them as keep-alive only and not as state transitions.

### 4.4 Reconnect cadence

Recommended client behaviour:

1. On disconnect, wait 1 s.
2. Reconnect with `Last-Event-ID` set to the last received id.
3. On failure, exponential backoff up to 30 s.
4. After 5 minutes of consecutive failures, fall back to REST-04 polling.
5. On a successful reconnect later, resume SSE mode.

Browsers' native `EventSource` implements steps 1–3 automatically with `EventSource.onerror`.

---

## 5. Implementation guide

### 5.1 Minimum viable Action Container

To be compatible with stock Runtimes, a new Action Container MUST implement:

| Endpoint | Why |
|----------|-----|
| `GET /trajectory/v1/health` | Runtime first-connect probe. |
| `POST /trajectory/v1/actions/{action_oid}/invoke` | Without this nothing runs. |
| `GET /trajectory/v1/instances/{instance_id}` | Opaque polling and observable-fallback polling. |

Strongly recommended (required if the container hosts any observable action):

| Endpoint | Why |
|----------|-----|
| `GET /trajectory/v1/instances/{instance_id}/events` | The only real-time signal for observable actions. |
| `POST /trajectory/v1/instances/{instance_id}/command` | Required for any flow that uses `PAUSE` / `HOLD` / `ABORT` mid-flight. |

Optional but high-value:

| Endpoint | Why |
|----------|-----|
| `GET /trajectory/v1/capabilities` | Lets Runtimes discover what's hosted without out-of-band config. |
| `GET /trajectory/v1/instances` | Operational visibility (admin UIs, conformance tests). |
| `DELETE /trajectory/v1/instances/{instance_id}` | Force-cleanup during workflow purge. |
| `GET /trajectory/v1/properties` and `/properties/{name}` | Required if any action uses action-properties to share state with the Runtime. |
| `GET /trajectory/v1/properties/{name}/events` | SSE for property changes; required for reactive property-bound steps in the workflow. |

### 5.2 Minimum viable Runtime

To drive a stock Action Container, a new Runtime MUST:

1. Resolve `environment_specifications[*].action_server_specifications[*].uri` from the workflow's embedded env libraries.
2. On `ACTION PROXY` step entry, build the REST-03 request body, including `environment_oid` (taken from the matched env spec), the workflow/step instance ids it generated, the step's master `oid`, and the resolved input parameters.
3. Open REST-06 SSE if the action's declared visibility is `"observable"`; poll REST-04 otherwise.
4. On step `ABORT`/`STOP` user actions, send REST-05 with the matching command. On step purge, send REST-09.
5. Propagate any `output` SSE event to the step's `output_parameter_specifications[*].target` Value Property bindings.

A Runtime that does only the above can execute any workflow whose actions are well-behaved.

### 5.3 Concurrency

The Action Container MUST handle multiple concurrent instances. Each instance is independent — its own state machine, its own SSE bus, its own input/output. The `instance_id` is the unique key for everything else (commands, polling, SSE, cancellation).

The reference container does not impose a global maximum, but a future version of `/health` MAY report `pool.max_concurrent` for capacity-aware Runtimes.

### 5.4 Protocol versioning

The path prefix `/trajectory/v1/` is the version. Future incompatible changes move to `/v2/`. A `v1` server MUST reject requests on `/v2/` with `404`.

There is no protocol-version negotiation header in v1. Runtimes that need to detect v2 servers SHOULD probe `GET /trajectory/v2/health` and fall back to v1 on 404.

---

## Appendix A — Quick reference cards

### A.1 Opaque action flow

```
Runtime                                Action Container
  │                                          │
  ├── POST /actions/{oid}/invoke ──────────► │
  │   { environment_oid, wf/step ids,        │
  │     input_parameters }                   ├── Creates instance, state = POSTED
  │ ◄── 201 { instance_id } ─────────────────┤
  │                                          │
  │── GET /instances/{id} ──────────────────► │
  │ ◄── 200 { state: { current: "RECEIVED" }}─┤
  │                                          │
  │── GET /instances/{id} ──────────────────► │  (exponential backoff polling)
  │ ◄── 200 { state: { current:              │
  │              "IN_PROGRESS" } } ──────────┤
  │                                          │
  │── GET /instances/{id} ──────────────────► │
  │ ◄── 200 { state: { current: "COMPLETED" }│
  │         outputs: [...] } ────────────────┤
```

### A.2 Observable action flow

```
Runtime                                Action Container
  │                                          │
  ├── POST /actions/{oid}/invoke ──────────► │
  │ ◄── 201 { instance_id } ─────────────────┤
  │                                          │
  ├── GET /instances/{id}/events ──────────► │  (SSE open)
  │                                          │
  │ ◄── event: state_change                ──┤  null → STARTING
  │ ◄── event: state_change                ──┤  STARTING → EXECUTING
  │ ◄── event: output                      ──┤  partial outputs (optional)
  │ ◄── event: state_change                ──┤  EXECUTING → HOLDING → HELD
  │                                          │
  │── POST /instances/{id}/command ────────► │  { command: "UNHOLD" }
  │ ◄── 200 { accepted: true } ──────────────┤
  │                                          │
  │ ◄── event: state_change                ──┤  HELD → UNHOLDING → EXECUTING
  │ ◄── event: state_change                ──┤  EXECUTING → COMPLETING
  │ ◄── event: output                      ──┤  final outputs
  │ ◄── event: state_change                ──┤  COMPLETING → COMPLETED  (terminal)
  │                                          │  (heartbeat stops; bus lingers 7s)
```

### A.3 Property flow

```
Runtime                                Action Container
  │                                          │
  ├── GET /properties ───────────────────────►│  (discover names)
  │ ◄── 200 [{env, properties:[...]}] ───────┤
  │                                          │
  ├── GET /properties/OvenSettings/events ──►│  (SSE open)
  │ ◄── event: property                    ──┤  { changed_entries:["TargetC"],
  │                                          │    entries:[{TargetC:"200"}],
  │                                          │    source:"action_code", ... }
  │ ◄── event: heartbeat                   ──┤  (every 30s while idle)
```

### A.4 Endpoint summary

| Method | Path | Auth | SSE |
|--------|------|:----:|:---:|
| GET | `/trajectory/v1/health` | optional | — |
| GET | `/trajectory/v1/capabilities` | yes | — |
| POST | `/trajectory/v1/actions/{action_oid}/invoke` | yes | — |
| GET | `/trajectory/v1/instances/{instance_id}` | yes | — |
| POST | `/trajectory/v1/instances/{instance_id}/command` | yes | — |
| GET | `/trajectory/v1/instances/{instance_id}/events` | yes | ✓ |
| GET | `/trajectory/v1/instances` | yes | — |
| DELETE | `/trajectory/v1/instances/{instance_id}` | yes | — |
| GET | `/trajectory/v1/properties` | yes | — |
| GET | `/trajectory/v1/properties/{name}` | yes | — |
| GET | `/trajectory/v1/properties/{name}/events` | yes | ✓ |

---

## Appendix B — References

- Reference Action Container public router: `TrajectoryActions/packages/server/src/routes/protocol.ts`
- Reference Action Container command router: `TrajectoryActions/packages/server/src/routes/commands.ts`
- Reference SSE manager (ring buffers, heartbeats, property buses): `TrajectoryActions/packages/server/src/sse-manager.ts`
- API-key middleware: `TrajectoryActions/packages/server/src/middleware/auth.ts`
- Companion spec for the JSON shapes carried over this wire: [JSON_SCHEMA.md](./JSON_SCHEMA.md)
- Original protocol spec (predates this consolidated document): `TrajectoryRuntime/spec/docs/RESTProtocolSpec.md`
