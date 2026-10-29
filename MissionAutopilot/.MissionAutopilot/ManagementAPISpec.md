# Mission Autopilot — Management API Specification

## Overview

The Management API is the backend for the Mission Autopilot browser console. It covers package upload, environment and action management, Action Property value editing, state-code editing and testing, instance monitoring, the execution log, settings, and export/import (action code, environment bundles, full snapshots). All endpoints are prefixed with `/management/v1/`.

The public action-server protocol that Mission Engine uses (`/trajectory/v1/`) is documented separately in [REST_Protocol.md](../../docs/REST_Protocol.md).

---

## 1. Base URL

```
http://{server-host}:{port}/management/v1/
```

The port comes from the `PORT` environment variable (default `3001`; the Docker setup uses `3002`). The bare server binds `127.0.0.1` unless `HOST` is set.

### 1.1 Authentication

Every `/management/v1/` route requires the API key. The key is set only by the `ACTIONS_API_KEY` environment variable (at least 32 characters; the server refuses to start without it). It cannot be read or changed through this API.

Send it in either header:

```
X-API-Key: <ACTIONS_API_KEY>
Authorization: Bearer <ACTIONS_API_KEY>
```

A missing or wrong key returns:

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid or missing API key", "details": {} } }
```

The `?token=` query parameter is accepted only on the two `/trajectory/v1/` event streams, never on management routes.

### 1.2 Host and Origin checks

Before CORS and authentication, every request (including `/health` and CORS preflights) is checked:

- **Host header**: the hostname (port ignored) must be `localhost`, `127.0.0.1`, `::1`, `mission-autopilot-server`, the host of `FLEET_BASE_URL`, or one listed in `ACTIONS_ALLOWED_HOSTS` (comma-separated). Otherwise `403 FORBIDDEN_HOST`.
- **Origin header** (when present): loopback origins on any port are always allowed, plus the exact origins in `ACTIONS_ALLOWED_ORIGINS` (comma-separated). Otherwise `403 FORBIDDEN_ORIGIN`.

`GET /health` (outside `/management/v1/`) needs no API key; it returns `{"status":"ok"}`, or 503 when the database is unreachable or its schema is incomplete.

### 1.3 Response envelope

Successful JSON responses wrap their payload as `{ "data": ..., "meta": {...} }`. List endpoints put counts and pagination in `meta`; single-object endpoints return `"meta": {}`. Exception: `PUT /actions/{oid}/timeout` returns `{ "data": ... }` with no `meta`. Export endpoints return a ZIP file, not JSON.

### 1.4 Request bodies

JSON bodies are parsed with Express's default JSON parser (100 KB limit). Routes marked **strict** below reject unknown fields with `400 VALIDATION_ERROR` (`"Unknown field: <name>"`). Uploads use `multipart/form-data`.

---

## 2. Endpoints

### 2.1 Dashboard and Server Info

#### Get Server Info

```
GET /management/v1/server-info
```

Reports the address workflow authors copy into an environment's action-server specification.

**Response 200:**

```json
{
  "data": {
    "rest_base_url": "http://localhost:3002",
    "protocol_path": "/trajectory/v1/",
    "port": 3002,
    "fleet_base_url": "http://mission-autopilot-server:3002"
  },
  "meta": {}
}
```

- `rest_base_url`: `PUBLIC_BASE_URL` (trailing slashes removed) when set, otherwise `http://localhost:{PORT}`.
- `fleet_base_url`: `FLEET_BASE_URL` (the address Mission Engine and Mission Commander use inside the Docker network), or `null` when not set.

#### Get Dashboard Summary

```
GET /management/v1/dashboard?count={n}
```

| Parameter | Type   | Default | Description                                       |
| --------- | ------ | ------- | ------------------------------------------------- |
| `count`   | number | 10      | Number of `recent_log_entries` (clamped to 1–100) |

**Response 200:**

```json
{
  "data": {
    "container": {
      "uptime_seconds": 86400,
      "started_at": "2026-02-23T10:30:00.000Z",
      "node_version": "v22.11.0",
      "python_version": "Python 3.12.7",
      "db_name": "mission_autopilot",
      "db_size_bytes": 9437184,
      "memory_rss_bytes": 104857600
    },
    "python_pool": { "size": 4, "idle": 3, "busy": 1, "queued": 0 },
    "environments": { "total_count": 3, "total_actions": 12 },
    "instances": { "active_count": 2, "completed_today": 47, "aborted_today": 1 },
    "log": {
      "total_entries": 4823,
      "max_entries": 10000,
      "oldest_entry_at": "2026-02-24T10:35:00.000Z"
    },
    "recent_log_entries": [
      {
        "id": 4823,
        "runtime_action_instance_id": "rai-0001-example",
        "action_name": "HeatOven",
        "environment_name": "KitchenEnvironment",
        "started_at": "2026-02-24T10:31:00.000Z",
        "completed_at": "2026-02-24T10:35:00.000Z",
        "duration_ms": 240000,
        "final_status": "COMPLETED",
        "error": null
      }
    ]
  },
  "meta": {}
}
```

- `python_version` is `null` when `python --version` fails at startup; `db_name` / `db_size_bytes` are `null` when the database cannot report them.
- `completed_today` / `aborted_today` count log entries whose `completed_at` is on or after today's midnight UTC.
- `log.oldest_entry_at` is taken from the first row of a newest-first log query, so it currently reports the **newest** entry's `completed_at`. `GET /log` reports the true oldest entry (see 2.7).
- `recent_log_entries` are newest first.

---

### 2.2 Package Upload

#### Upload Environment/Action Packages

```
POST /management/v1/upload
Content-Type: multipart/form-data
```

**Request**: one or more files in the multipart field `files`; at most 10 MB per file. The extension (case-insensitive) selects the parser:

| Extension         | Contents                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.WFenvir`        | Environment library JSON: `local_id`, `oid`, `version`, `last_modified_date`, `environment_specifications[]` (each with `oid`, `local_id`, `version`, `last_modified_date`, `included_actions[]`), optional `schemaVersion`.                           |
| `.WFenvirX`       | ZIP. If `manifest.json` has `"packageType": "environment-package"`: a root-level `*.WFenvir` holding one environment plus `actions/*.WFaction` files (no code). Otherwise: a library ZIP whose first `*.WFenvir`/`*.WFenvirX` entry is a library JSON. |
| `.WFenvirLibX`    | ZIP whose first `*.WFenvir`/`*.WFenvirX` entry is a library JSON.                                                                                                                                                                                      |
| `.WFenvirBundleX` | ZIP with a `*.WFenvir` library JSON plus `code/<action_oid>/<STATE>.py` files (the format `GET /environments/{oid}/export-bundle` produces).                                                                                                           |
| `.WFaction`       | One action JSON (`oid`, `local_id`, `version`, `last_modified_date`, plus specifications). It must carry the `environment_oid` of a stored environment.                                                                                                |
| `.WFactionCodeX`  | ZIP with one `*.WFaction` entry plus `code/<STATE>.py` files.                                                                                                                                                                                          |

`.WFactionLibX` and `.WFstepLibX` are recognised but rejected with 400 (upload individual `.WFaction` files instead). Any other extension is rejected with 400.

**Processing**:

1. Every file is parsed and validated before anything is written. Required fields are checked at each level. `schemaVersion` is optional (default `"4.0"`); when present it must be a string with a value of at least `3.0`.
2. All writes run in one transaction: the whole upload commits or nothing does.
3. Environments are matched by `oid` and updated in place. If no `oid` matches but exactly one stored environment has the same `local_id` (and the upload lists that name once), the stored environment is re-keyed to the new `oid`; its actions, instances and log history follow. Otherwise a new environment is created.
4. Actions are matched by `oid`, then by unambiguous `local_id` within the environment (re-key). Unmatched incoming actions are created. Stored actions missing from the package are deleted if they have no code and no running instance; otherwise they are kept and marked `orphaned_at`. A re-import never deletes authored code.
5. When a matched action has code and its input/output signature changed, it is flagged with `signature_change` (cleared with `DELETE /actions/{oid}/signature-change`). A package that carries code for the action does not raise the flag.
6. Code in `.WFenvirBundleX` and `.WFactionCodeX` packages is saved as a new active version for each state (`created_by: "import"`). Single-environment `.WFenvirX` packages create no code.
7. Environment and action lifecycle `state` is taken from the package (default `Draft`).

**Response 200:**

```json
{
  "data": {
    "imported": [
      {
        "type": "environment",
        "oid": "env-0001-example",
        "local_id": "KitchenEnvironment",
        "version": "1.0.0",
        "actions_count": 5,
        "status": "created",
        "rekeyed_from": null
      },
      {
        "type": "action",
        "oid": "act-0009-example",
        "local_id": "CheckDoor",
        "version": "1.1.0",
        "status": "updated"
      }
    ],
    "diff": {
      "added": ["HeatOven"],
      "removed": [],
      "modified": ["CoolOven"],
      "rekeyed": [],
      "orphaned": [],
      "signature_changed": []
    }
  },
  "meta": {}
}
```

- `rekeyed_from` (environments only) is the old `oid` when the environment was re-keyed, else `null`.
- The `diff` lists contain action `local_id`s combined across all uploaded files.

**Response 400 (first problem found; nothing is written):**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Failed to parse JSON in file \"broken.WFenvir\"",
    "details": { "filename": "broken.WFenvir" }
  }
}
```

`details` carries `filename`, and also `index` (position in `environment_specifications`) or `schemaVersion` where relevant. `"No files provided"` is returned when `files` is empty.

**ZIP limits**: at most 5,000 entries, 200 MB uncompressed in total, 50 MB per entry. In this route an archive over those limits, or an unreadable archive, returns `400 VALIDATION_ERROR` ("Failed to read ZIP archive ..."). A file over 10 MB, or files sent in a field other than `files`, returns `500 INTERNAL_ERROR`.

---

### 2.3 Environment Management

#### List Environments

```
GET /management/v1/environments
```

**Response 200:**

```json
{
  "data": [
    {
      "oid": "env-0001-example",
      "local_id": "KitchenEnvironment",
      "version": "1.0.0",
      "last_modified_date": "2026-02-20T14:00:00Z",
      "description": "Kitchen automation environment",
      "schema_version": "4.0",
      "action_property_specifications": [],
      "value_property_specifications": [],
      "resource_property_specifications": [],
      "imported_at": "2026-02-21T09:00:00.000Z",
      "source_filename": "KitchenEnvironment.WFenvirBundleX",
      "state": "Draft",
      "action_count": 5
    }
  ],
  "meta": { "total": 1 }
}
```

`state` is the lifecycle state: `Draft`, `InTest`, `InReview`, `Approved`, `Effective`, `Superseded` or `Obsolete`.

#### Get Environment Detail

```
GET /management/v1/environments/{environment_oid}
```

**Response 200:** every environment field above (no `action_count`), plus an `actions` summary list:

```json
{
  "data": {
    "oid": "env-0001-example",
    "local_id": "KitchenEnvironment",
    "version": "1.0.0",
    "last_modified_date": "2026-02-20T14:00:00Z",
    "description": "Kitchen automation environment",
    "schema_version": "4.0",
    "action_property_specifications": [
      {
        "name": "RetryPolicy",
        "entries": [
          { "name": "MaxRetries", "value": "3" },
          { "name": "BackoffMs", "value": "1000" }
        ]
      }
    ],
    "value_property_specifications": [],
    "resource_property_specifications": [],
    "imported_at": "2026-02-21T09:00:00.000Z",
    "source_filename": "KitchenEnvironment.WFenvir",
    "state": "Draft",
    "actions": [
      {
        "oid": "act-0001-example",
        "local_id": "HeatOven",
        "version": "1.0.0",
        "action_visibility": "observable",
        "input_param_count": 2,
        "output_param_count": 1,
        "states_with_code": ["EXECUTING", "STARTING"],
        "signature_change": null,
        "orphaned_at": null
      }
    ]
  },
  "meta": {}
}
```

The property specification arrays are returned as stored from the package. **404** `NOT_FOUND` if the environment does not exist.

#### Delete Environment

```
DELETE /management/v1/environments/{environment_oid}
```

**Validation**: refused with `409 CONFLICT` ("Cannot delete environment with active instances") if any instance of the environment has not completed (`completed_at` is null). The check is repeated inside the delete transaction with the environment and action rows locked, so an instance created at the same moment cannot slip through. Use `DELETE /instances/{id}` (2.6) to remove a stuck instance first.

**Side effects**: the environment's code versions, completed instance records and actions are deleted in one transaction. Execution-log entries are kept (the log has no foreign key to instances). Open property event streams for the environment are closed.

**Response 200:**

```json
{
  "data": {
    "deleted": true,
    "environment_oid": "env-0001-example",
    "actions_removed": 5,
    "code_versions_removed": 12,
    "instances_removed": 3
  },
  "meta": {}
}
```

**404** `NOT_FOUND` if the environment does not exist.

#### Edit Environment Action Property Values

```
PUT /management/v1/environments/{environment_oid}/properties
```

Changes entry values of the environment's `action_property_specifications` (the shared set that action code reads and writes). Values only: properties and entries cannot be added, removed or renamed.

**Request Body** (strict at both levels; at least one edit; every field a string; `property` and `entry` non-empty):

```json
{
  "edits": [{ "property": "RetryPolicy", "entry": "MaxRetries", "value": "5" }]
}
```

**Processing**: the edit goes through the same serialized queue as property writes from running action code, so the two cannot overwrite each other. The batch is all-or-nothing. For each changed property, a property-change event with `source: "console"` is published on that property's event stream (see [REST_Protocol.md](../../docs/REST_Protocol.md)).

**Response 200:**

```json
{
  "data": {
    "oid": "env-0001-example",
    "action_property_specifications": [
      {
        "name": "RetryPolicy",
        "entries": [
          { "name": "MaxRetries", "value": "5" },
          { "name": "BackoffMs", "value": "1000" }
        ]
      }
    ]
  },
  "meta": {}
}
```

**Errors**:

| Status | Code                 | When                                                     |
| ------ | -------------------- | -------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`   | Body malformed                                           |
| 404    | `NOT_FOUND`          | Environment does not exist                               |
| 404    | `PROPERTY_NOT_FOUND` | No property with that name (`details: { property }`)     |
| 400    | `ENTRY_NOT_FOUND`    | No entry with that name (`details: { property, entry }`) |

---

### 2.4 Action Management

#### Get Action Detail

```
GET /management/v1/actions/{action_oid}
```

**Response 200:**

```json
{
  "data": {
    "oid": "act-0001-example",
    "environment_oid": "env-0001-example",
    "local_id": "HeatOven",
    "version": "1.0.0",
    "last_modified_date": "2026-02-20T14:00:00Z",
    "description": "Heats the oven to a target temperature",
    "action_visibility": "observable",
    "input_parameter_specifications": [
      {
        "id": "target_temperature",
        "default_value": "200",
        "value_type": "literal",
        "description": "Target temperature in Celsius"
      }
    ],
    "output_parameter_specifications": [
      {
        "id": "actual_temperature",
        "default_value": "",
        "value_type": "literal",
        "description": "Measured temperature"
      }
    ],
    "property_specifications": [
      {
        "name": "ConnectionConfig",
        "entries": [
          { "name": "Host", "value": "sensor-gateway.example" },
          { "name": "Port", "value": "8080" }
        ]
      }
    ],
    "timeout_seconds": null,
    "state": "Draft",
    "signature_change": null,
    "orphaned_at": null,
    "environment_name": "KitchenEnvironment",
    "code_summary": {
      "states_with_code": ["EXECUTING", "STARTING"],
      "total_versions": 7,
      "last_code_update": "2026-02-24T09:00:00.000Z"
    }
  },
  "meta": {}
}
```

- The specification arrays are returned as stored from the imported package.
- `timeout_seconds`: `null` = use the `execution_timeout_ms` setting, `0` = no timeout, a positive integer = that many seconds per state.
- `signature_change` (set by an import, see 2.2): `{ "flagged_at", "baseline_input_parameter_specifications", "baseline_output_parameter_specifications", "changes": [string] }`, or `null`.
- `orphaned_at`: timestamp set when the latest import of the environment no longer contained this action but it was kept because it has code or a running instance.
- `environment_name` is `"Unknown"` if the environment row is missing.

**404** `NOT_FOUND` if the action does not exist.

#### Delete Action

```
DELETE /management/v1/actions/{action_oid}
```

Removes one action (typically an orphan left by an import) with all its code versions and completed instance records. Refused with `409 CONFLICT` ("Cannot delete action with active instances") while any of its instances has not completed.

**Response 200:**

```json
{
  "data": {
    "deleted": true,
    "action_oid": "act-0001-example",
    "code_versions_removed": 4,
    "instances_removed": 2
  },
  "meta": {}
}
```

**404** `NOT_FOUND` if the action does not exist.

#### Clear Signature-Change Flag

```
DELETE /management/v1/actions/{action_oid}/signature-change
```

Records that the author has updated the code for the imported signature.

**Response 200:** `{ "data": { "oid": "act-0001-example", "signature_change": null }, "meta": {} }`. **404** `NOT_FOUND` if the action does not exist.

The flag is also cleared automatically when the action's last code version is deleted (2.5).

#### Set Action Timeout

```
PUT /management/v1/actions/{action_oid}/timeout
```

**Request Body:**

```json
{ "timeout_seconds": 120 }
```

`timeout_seconds` must be `null` (use the global setting), `0` (no timeout), or a positive integer. A re-import does not overwrite this value.

**Response 200** (no `meta`):

```json
{ "data": { "oid": "act-0001-example", "timeout_seconds": 120 } }
```

**Errors**: `404 NOT_FOUND`; `400 VALIDATION_ERROR` ("timeout_seconds must be null, 0, or a positive integer"). These two error bodies have no `details` field.

#### Edit Action Property Values

```
PUT /management/v1/actions/{action_oid}/properties
```

Changes entry values of the action's own `property_specifications` (the per-action set that code reads as `action_props`). Same request body, validation and error codes as `PUT /environments/{oid}/properties` (2.3), with `NOT_FOUND` meaning the action does not exist. No event is published.

**Response 200:**

```json
{
  "data": {
    "oid": "act-0001-example",
    "property_specifications": [
      {
        "name": "ConnectionConfig",
        "entries": [
          { "name": "Host", "value": "sensor-gateway.example" },
          { "name": "Port", "value": "9090" }
        ]
      }
    ]
  },
  "meta": {}
}
```

---

### 2.5 Code Management

Code is stored per action and per state. Each save creates a new numbered version and makes it the active one. When an instance is created, it pins the active version for each state; later saves and activations apply to new instances only.

A code version object:

```json
{
  "id": "4f1c2b9e-0000-4000-8000-000000000003",
  "action_oid": "act-0001-example",
  "state": "EXECUTING",
  "version_number": 3,
  "source_code": "def execute(inputs, outputs, props, action_props):\n    ...",
  "is_active": true,
  "created_at": "2026-02-24T09:00:00.000Z",
  "created_by": null,
  "description": "Added error handling for sensor timeout"
}
```

`created_by` is whatever the client sent on save, or `"import"` / `"snapshot-import"` for imported code.

#### List Code Versions for Action+State

```
GET /management/v1/code/{action_oid}/{state}
```

**Response 200** (newest version first; no source code):

```json
{
  "data": {
    "action_oid": "act-0001-example",
    "state": "EXECUTING",
    "versions": [
      {
        "id": "4f1c2b9e-0000-4000-8000-000000000003",
        "version_number": 3,
        "is_active": true,
        "created_at": "2026-02-24T09:00:00.000Z",
        "created_by": null,
        "description": "Added error handling for sensor timeout",
        "code_size": 1834
      }
    ]
  },
  "meta": {}
}
```

`code_size` is the source length in characters. **404** `NOT_FOUND` if the action does not exist. `{state}` is not validated here (an unknown state returns an empty list).

#### Get Active Code for Action+State

```
GET /management/v1/code/{action_oid}/{state}/active
```

**Response 200:** `{ "data": <code version object>, "meta": {} }`. **404** `NOT_FOUND` if there is no active version for this action and state.

#### Get Code Version Source

```
GET /management/v1/code/{action_oid}/{state}/{version_id}
```

**Response 200:** `{ "data": <code version object>, "meta": {} }`. **404** `NOT_FOUND` if the version does not exist or belongs to a different action or state.

#### Save New Code Version

```
POST /management/v1/code/{action_oid}/{state}
```

**Request Body:**

```json
{
  "source_code": "def execute(inputs, outputs, props, action_props):\n    ...",
  "description": "Added error handling for sensor timeout",
  "created_by": "operator"
}
```

`source_code` is required (string); `description` and `created_by` are optional strings or `null`. Other fields are ignored.

**Processing**:

1. The action must exist (`404 NOT_FOUND`).
2. `{state}` must be a state the action's state machine can reach, otherwise `400 VALIDATION_ERROR` with `details: { state, action_visibility, valid_states }`:
   - observable: `ABORTED`, `ABORTING`, `CLEARING`, `COMPLETED`, `COMPLETING`, `EXECUTING`, `HELD`, `HOLDING`, `PAUSED`, `PAUSING`, `STARTING`, `STOPPING`, `UNHOLDING`, `UNPAUSING`
   - opaque: `ABORTED`, `ABORTING`, `COMPLETED`, `IN_PROGRESS`, `POSTED`, `RECEIVED`, `STOPPING`
3. A new version is created with the next `version_number` and activated; the previous active version is deactivated.

**Response 201:**

```json
{
  "data": {
    "id": "4f1c2b9e-0000-4000-8000-000000000004",
    "version_number": 4,
    "is_active": true,
    "created_at": "2026-02-24T10:00:00.000Z"
  },
  "meta": {}
}
```

#### Activate a Code Version (Rollback)

```
POST /management/v1/code/{action_oid}/{state}/{version_id}/activate
```

Makes this version the active one for its action and state. No request body.

**Response 200:**

```json
{
  "data": {
    "id": "4f1c2b9e-0000-4000-8000-000000000002",
    "version_number": 2,
    "is_active": true,
    "activated_at": "2026-02-24T10:05:00.000Z"
  },
  "meta": {}
}
```

**404** `NOT_FOUND` if the version does not exist or belongs to a different action or state.

#### Delete a Code Version

```
DELETE /management/v1/code/{action_oid}/{state}/{version_id}
```

**Validation**:

- `409 CONFLICT` "Cannot delete the active version" (activate another one first)
- `409 CONFLICT` "Cannot delete version pinned by running instance"
- `404 NOT_FOUND` if the version does not exist or belongs to a different action or state

If this was the action's last code version (in any state), the action's `signature_change` flag is cleared.

**Response 200:** `{ "data": { "deleted": true, "id": "4f1c2b9e-0000-4000-8000-000000000001" }, "meta": {} }`

#### Clear All Code for Action+State

```
DELETE /management/v1/code/{action_oid}/{state}
```

Deletes every version for the state, including the active one. Calling it when no versions exist succeeds with a count of 0.

**Validation**:

- `404 ACTION_NOT_FOUND` if the action does not exist
- `409 CONFLICT` if any of the versions is pinned by a running instance

If the action has no code left in any state, its `signature_change` flag is cleared.

**Response 200:** `{ "data": { "deleted_version_count": 3 }, "meta": {} }`

#### Test Code Execution (Dry Run)

```
POST /management/v1/code/{action_oid}/{state}/test
```

**Request Body** (all fields optional):

```json
{
  "source_code": "def execute(inputs, outputs, props, action_props):\n    ...",
  "test_inputs": { "target_temperature": "200" },
  "test_props": { "RetryPolicy": { "MaxRetries": "3" } },
  "test_action_props": { "ConnectionConfig": { "Host": "sensor-gateway.example" } },
  "timeout_ms": 5000
}
```

**Processing**:

1. If `source_code` is present it must be a string (`400 VALIDATION_ERROR`) and is run as given. If it is absent, the active version for this action and state is run (`404 NOT_FOUND` if there is none).
2. The code runs on a worker from the Python pool as a synthetic state `TEST`. `props` and `action_props` are exactly `test_props` and `test_action_props` (default `{}`); the action's stored properties are **not** loaded. `timeout_ms` defaults to the `execution_timeout_ms` setting.
3. No instance is created and no stored data changes.

**Response 200** (also returned when the code fails):

```json
{
  "data": {
    "success": true,
    "outputs": { "actual_temperature": "198.5" },
    "return_value": true,
    "stdout": "Debug: processing...\n",
    "stderr": "",
    "execution_time_ms": 245
  },
  "meta": {}
}
```

On failure: `{ "success": false, "error": "...", "error_type": "...", "stdout": "...", "stderr": "...", "execution_time_ms": 12 }`.

---

### 2.6 Instance Monitoring

An instance object (as stored, plus names):

```json
{
  "runtime_action_instance_id": "rai-0001-example",
  "action_oid": "act-0001-example",
  "environment_oid": "env-0001-example",
  "workflow_instance_id": "wf-0001-example",
  "step_instance_id": "si-0001-example",
  "step_oid": "step-0001-example",
  "visibility": "observable",
  "state": "EXECUTING",
  "input_parameters": [{ "key": "target_temperature", "value": "200" }],
  "output_parameters": [],
  "state_history": [
    { "state": "STARTING", "timestamp": "2026-02-24T10:31:00.000Z" },
    { "state": "EXECUTING", "timestamp": "2026-02-24T10:31:02.000Z" }
  ],
  "pinned_code_versions": [
    { "state": "STARTING", "code_version_id": "4f1c2b9e-0000-4000-8000-000000000010" },
    { "state": "EXECUTING", "code_version_id": "4f1c2b9e-0000-4000-8000-000000000003" }
  ],
  "states_with_code_executed": ["STARTING"],
  "created_at": "2026-02-24T10:31:00.000Z",
  "started_at": "2026-02-24T10:31:00.000Z",
  "completed_at": null,
  "error": null,
  "traceback": null,
  "is_logged": false,
  "action_name": "HeatOven",
  "environment_name": "KitchenEnvironment"
}
```

- Observable states: `STARTING`, `EXECUTING`, `COMPLETING`, `COMPLETED`, `PAUSING`, `PAUSED`, `UNPAUSING`, `HOLDING`, `HELD`, `UNHOLDING`, `ABORTING`, `ABORTED`, `CLEARING`, `STOPPING`. Opaque states: `POSTED`, `RECEIVED`, `IN_PROGRESS`, `COMPLETED`, plus `ABORTING`, `ABORTED`, `STOPPING`. Terminal states are `COMPLETED` and `ABORTED`; there is no `STOPPED` state (STOP goes through `STOPPING` to `COMPLETED`).
- `error` is a short error summary and `traceback` the full Python traceback.
- `is_logged` becomes `true` once the instance's execution-log entry is written.
- `action_name` / `environment_name` are `"Unknown"` if the row is missing.
- Completed instances are deleted by the retention sweep (see `instance_retention_hours`, 2.8); their log entries remain.

#### List Active Instances

```
GET /management/v1/instances/active?environment_oid={oid}&action_oid={oid}
```

Instances whose `completed_at` is null, newest first. Both filters are optional.

**Response 200:** `{ "data": [<instance>, ...], "meta": { "total": 1 } }`

#### List Instance History

```
GET /management/v1/instances/history?environment_oid={oid}&action_oid={oid}&page={n}&page_size={n}&sort={field}&order={asc|desc}
```

Instances whose `completed_at` is set.

| Parameter         | Type   | Default        | Description                                                                                   |
| ----------------- | ------ | -------------- | --------------------------------------------------------------------------------------------- |
| `environment_oid` | string | —              | Filter by environment                                                                         |
| `action_oid`      | string | —              | Filter by action                                                                              |
| `page`            | number | 1              | Page number                                                                                   |
| `page_size`       | number | 50             | Instances per page (1–200)                                                                    |
| `sort`            | string | `completed_at` | `created_at`, `completed_at`, `state` or `action_oid` (other values fall back to the default) |
| `order`           | string | `desc`         | `asc` or `desc`                                                                               |

**Response 200:**

```json
{
  "data": [],
  "meta": { "total": 120, "page": 1, "page_size": 50, "total_pages": 3 }
}
```

#### Get Instance Detail

```
GET /management/v1/instances/{runtime_action_instance_id}
```

**Response 200:** `{ "data": <instance>, "meta": {} }`. **404** `NOT_FOUND`.

#### Send Command to Instance

```
POST /management/v1/instances/{runtime_action_instance_id}/command
```

**Request Body** (strict):

```json
{
  "command": "PAUSE",
  "reason": "Administrator paused for inspection"
}
```

`command` is one of `PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP`, `CLEAR`. `reason` is optional; it is accepted but not stored. The command goes to the same state machine as the protocol command endpoint.

**Response 200:**

```json
{
  "data": { "instance_id": "rai-0001-example", "command": "PAUSE", "accepted": true },
  "meta": {}
}
```

**Errors** (checked in this order):

| Status | Code                       | When                                                                           |
| ------ | -------------------------- | ------------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`         | Body malformed or has unknown fields                                           |
| 422    | `INVALID_COMMAND`          | Unknown command (`details: { command }`)                                       |
| 404    | `NOT_FOUND`                | Instance does not exist                                                        |
| 409    | `INVALID_STATE_TRANSITION` | Command not valid in the current state (`details: { current_state, command }`) |

#### Force-Delete Instance

```
DELETE /management/v1/instances/{runtime_action_instance_id}
```

Removes the instance row whatever its state. Use it to clear an instance stuck in a non-terminal state (for example `ABORTING` after a worker crash), which would otherwise block environment and action deletion. Any worker still running the instance's code is killed, and the instance's event stream is closed. No execution-log entry is written for the instance.

This differs from `DELETE /trajectory/v1/instances/{id}` in the protocol, which sends ABORT and keeps the row.

**Response 200:** `{ "data": { "deleted": true, "instance_id": "rai-0001-example" }, "meta": {} }`. **404** `NOT_FOUND`.

---

### 2.7 Execution Log

A log entry is written once when an instance reaches a terminal state. The log holds at most `log_max_size` entries; the oldest are removed first.

#### Query Log Entries

```
GET /management/v1/log?action_name={name}&environment_oid={oid}&status={status}&from={date}&to={date}&page={n}&page_size={n}
```

**Query Parameters:**

| Parameter         | Type   | Default | Description                                                     |
| ----------------- | ------ | ------- | --------------------------------------------------------------- |
| `action_name`     | string | —       | Filter by action name (partial, case-insensitive match)         |
| `environment_oid` | string | —       | Filter by environment OID                                       |
| `status`          | string | —       | Filter by `final_status` (`COMPLETED` or `ABORTED`)             |
| `from`            | string | —       | ISO 8601 timestamp; entries with `completed_at` at or after it  |
| `to`              | string | —       | ISO 8601 timestamp; entries with `completed_at` at or before it |
| `page`            | number | 1       | Page number                                                     |
| `page_size`       | number | 50      | Entries per page (1–200)                                        |

Entries are returned newest first.

**Response 200:**

```json
{
  "data": [
    {
      "id": 4823,
      "runtime_action_instance_id": "rai-0001-example",
      "action_oid": "act-0001-example",
      "action_name": "HeatOven",
      "environment_oid": "env-0001-example",
      "environment_name": "KitchenEnvironment",
      "workflow_instance_id": "wf-0001-example",
      "step_oid": "step-0001-example",
      "input_parameters": [{ "key": "target_temperature", "value": "200" }],
      "output_parameters": [{ "key": "actual_temperature", "value": "198.5" }],
      "states_executed": [
        {
          "state": "STARTING",
          "had_code": true,
          "code_version_number": 2,
          "entered_at": "2026-02-24T10:31:00.000Z",
          "duration_ms": 2000
        },
        {
          "state": "EXECUTING",
          "had_code": true,
          "code_version_number": 3,
          "entered_at": "2026-02-24T10:31:02.000Z",
          "duration_ms": 228000
        },
        {
          "state": "COMPLETED",
          "had_code": false,
          "code_version_number": null,
          "entered_at": "2026-02-24T10:35:00.000Z",
          "duration_ms": 0
        }
      ],
      "code_versions_used": { "STARTING": 2, "EXECUTING": 3 },
      "started_at": "2026-02-24T10:31:00.000Z",
      "completed_at": "2026-02-24T10:35:00.000Z",
      "duration_ms": 240000,
      "final_status": "COMPLETED",
      "error": null
    }
  ],
  "meta": {
    "page": 1,
    "page_size": 50,
    "total_entries": 4823,
    "total_pages": 97,
    "log_config": {
      "max_entries": 10000,
      "current_entries": 4823,
      "oldest_entry_at": "2026-02-20T08:15:00.000Z"
    }
  }
}
```

- `total_entries` counts entries matching the filters; `log_config.current_entries` counts the whole log.
- `final_status` is the instance's terminal state. The database also accepts `STOPPED`, but a stopped instance ends in `COMPLETED`, so entries are `COMPLETED` or `ABORTED`.

#### Get Single Log Entry

```
GET /management/v1/log/{log_entry_id}
```

**Response 200:** `{ "data": <log entry>, "meta": {} }`. **400** `VALIDATION_ERROR` if the id is not a number; **404** `NOT_FOUND` if no such entry.

---

### 2.8 Settings

| Key                        | Default | Validation                         | Effect                                                                                                                                                             |
| -------------------------- | ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `log_max_size`             | `10000` | integer ≥ 1                        | Maximum execution-log entries. Lowering it trims the oldest entries immediately; every new entry also trims to this size.                                          |
| `python_pool_size`         | `4`     | integer ≥ 1                        | Python worker count. A change resizes the pool immediately: growing starts workers, shrinking stops idle workers and lets busy ones finish. Read again at startup. |
| `execution_timeout_ms`     | `60000` | `0` (no timeout) or integer ≥ 1000 | Per-state code timeout for actions whose `timeout_seconds` is `null`; also the default for code tests. Read at each execution.                                     |
| `instance_retention_hours` | `24`    | number ≥ 0 (fractions allowed)     | Completed, logged instance records older than this are deleted by a sweep that runs at startup and then hourly. `0` disables the sweep. Read on each sweep.        |

The settings table also holds a legacy `api_key` row. It is not used: the key comes only from `ACTIONS_API_KEY`.

#### Get All Settings

```
GET /management/v1/settings
```

**Response 200** (sorted by key):

```json
{
  "data": [
    {
      "key": "api_key",
      "value": "",
      "default_value": "",
      "description": "API key required on protected routes (X-API-Key header). Empty = open access.",
      "value_type": "string",
      "configured": true
    },
    {
      "key": "execution_timeout_ms",
      "value": "60000",
      "default_value": "60000",
      "description": "Default timeout for Python code execution per state (ms)",
      "value_type": "number"
    },
    {
      "key": "instance_retention_hours",
      "value": "24",
      "default_value": "24",
      "description": "Hours to retain completed instance records before cleanup",
      "value_type": "number"
    },
    {
      "key": "log_max_size",
      "value": "10000",
      "default_value": "10000",
      "description": "Maximum execution log entries before rollover",
      "value_type": "number"
    },
    {
      "key": "python_pool_size",
      "value": "4",
      "default_value": "4",
      "description": "Number of Python subprocess workers",
      "value_type": "number"
    }
  ],
  "meta": {}
}
```

The `api_key` row always comes back with empty `value` and `default_value` and `"configured": true`. Its stored description ("Empty = open access") is out of date: the server always requires `ACTIONS_API_KEY`.

#### Update Setting

```
PUT /management/v1/settings/{key}
```

**Request Body** (strict; `value` must be a string):

```json
{ "value": "20000" }
```

**Response 200:**

```json
{
  "data": { "key": "log_max_size", "value": "20000", "previous_value": "10000", "applied": true },
  "meta": {}
}
```

**Errors**:

| Status | Code               | When                                                       |
| ------ | ------------------ | ---------------------------------------------------------- |
| 400    | `VALIDATION_ERROR` | `key` is `api_key` (set it with `ACTIONS_API_KEY` instead) |
| 400    | `VALIDATION_ERROR` | Body malformed, or the value fails the key's validation    |
| 404    | `NOT_FOUND`        | Unknown key                                                |

---

### 2.9 Export and Import

All exports return `Content-Type: application/zip` with `Content-Disposition: attachment; filename="..."`, or a JSON `404 NOT_FOUND` when the environment or action does not exist. The 404 bodies in this section have no `details` field. Uploads use the multipart field `file` (one file, at most 50 MB) and the ZIP limits in 2.2; an archive over those limits returns `400 ARCHIVE_TOO_LARGE`.

#### Export Action Code

```
GET /management/v1/actions/{action_oid}/export
```

Downloads `<local_id>.WFactionCode`, a ZIP containing:

- `manifest.json`: `{ "format_version": "1.0", "exported_at", "action": { oid, local_id, version, action_visibility, description, input_parameter_specifications, output_parameter_specifications, property_specifications, timeout_seconds }, "code_files": [{ "state", "filename", "description" }] }`
- `<STATE>.py` for each state's active version.

#### Import Action Code

```
POST /management/v1/actions/{action_oid}/import
Content-Type: multipart/form-data   (field: file)
```

Imports a `.WFactionCode` ZIP into an existing action. `manifest.action.oid` must equal `{action_oid}`. For each `code_files` entry whose `.py` file is present, a new version is saved and activated (`created_by: "import"`); entries whose file is missing are reported in `skipped_states`. Only code is imported; the manifest's specifications and `timeout_seconds` are ignored. All saves run in one transaction.

**Response 200:**

```json
{
  "data": {
    "action_oid": "act-0001-example",
    "imported_states": ["STARTING", "EXECUTING"],
    "skipped_states": []
  },
  "meta": {}
}
```

**Errors**: `400 VALIDATION_ERROR` (no file; "ZIP missing manifest.json"; manifest OID mismatch); `404 NOT_FOUND` (action); `400 ARCHIVE_TOO_LARGE`. An unreadable ZIP or invalid manifest JSON returns `500 INTERNAL_ERROR`.

#### Export Environment Bundle

```
GET /management/v1/environments/{environment_oid}/export-bundle
```

Downloads `<local_id>.WFenvirBundleX`, which `POST /upload` accepts (2.2). The ZIP contains:

- `<local_id>.WFenvir`: environment library JSON with one entry in `environment_specifications`, including every action in `included_actions` (each with `action_name` and `action_library` set to the action and environment `local_id`, and `timeout_seconds`).
- `code/<action_oid>/<STATE>.py` for each active version.
- `manifest.json`: `{ "format": "WFenvirBundleX", "format_version": 1, "exported_at", "container_version", "environment_oid", "environment_local_id", "action_count", "code_file_count" }`.

`timeout_seconds` is exported but not read back on upload.

#### Export Environment Package (no code)

```
GET /management/v1/environments/{environment_oid}/export-envir-x
```

Downloads `<local_id>.WFenvirX`, a single-environment package without code:

- `<local_id>.WFenvir`: the environment (single-environment shape, with `schemaVersion` and lifecycle `state`).
- `actions/<action local_id>.WFaction`: one file per action.
- `manifest.json`: `{ "packageType": "environment-package", "formatVersion": 1, "createdAt", "environmentName", "actionCount" }`.

#### Export Snapshot

```
GET /management/v1/snapshot/export
```

Downloads `TrajectorySnapshot_<YYYY-MM-DD>.WFsnapshot`, a backup of everything needed to rebuild the server's configuration:

- `manifest.json`: `{ "format_version": "1.0", "exported_at", "container_version", "environment_count", "action_count", "code_file_count" }`
- `settings.json`: all setting rows except `api_key`.
- `environments/<environment_oid>.json`: each environment with its actions in `included_actions`.
- `code/<action_oid>/<STATE>.py`: active versions only.

Not included: the API key, code version history, instances, the execution log, lifecycle `state`, and import flags (`signature_change`, `orphaned_at`).

#### Import Snapshot

```
POST /management/v1/snapshot/import?confirm=true
Content-Type: multipart/form-data   (field: file)
```

**Destructive**: replaces all environments, actions and code. In one transaction it:

1. Deletes every environment, action and code version.
2. Re-creates the environments and actions from `environments/*.json` (`source_filename` is set to `snapshot-import`).
3. Saves each `code/<action_oid>/<STATE>.py` as a new active version (`created_by: "snapshot-import"`, description "Imported from snapshot"). Version numbering starts again at 1.
4. Applies `settings.json` values. `api_key` is skipped, and unknown keys or invalid values are skipped silently. Setting side effects are **not** applied: the pool is not resized and the log is not trimmed until the server restarts or the setting is saved again.

The deletion does not remove instance rows. If any instance record exists (running or completed), the transaction fails with `500 INTERNAL_ERROR` and nothing changes.

**Response 200:**

```json
{
  "data": {
    "environments_imported": 3,
    "actions_imported": 12,
    "code_files_imported": 20,
    "settings_imported": 4
  },
  "meta": {}
}
```

**Errors**: `400 VALIDATION_ERROR` ("Destructive operation requires ?confirm=true query parameter"; "No file provided"; "ZIP missing manifest.json"; "Unsupported format version: ..."; "Invalid or corrupted ZIP file"); `400 ARCHIVE_TOO_LARGE`; `500 INTERNAL_ERROR` for the instance case above, or when a code file names an action that is not in the snapshot.

---

## 3. Error Response Format

Errors use this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

`details` is `{}` unless a route documents more. A few routes leave `details` out (`PUT /actions/{oid}/timeout` and the export/import routes in 2.9).

| HTTP Status | Code                          | Description                                                                                    |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| 400         | `VALIDATION_ERROR`            | Bad request body, parameters, file or setting value                                            |
| 400         | `ARCHIVE_TOO_LARGE`           | ZIP over the entry-count or uncompressed-size limits (not on `/upload`, see 2.2)               |
| 400         | `ENTRY_NOT_FOUND`             | Property edit names an entry that does not exist                                               |
| 400         | `PARAMETER_VALIDATION_FAILED` | Engine parameter validation failed                                                             |
| 401         | `UNAUTHORIZED`                | Missing or wrong API key                                                                       |
| 403         | `FORBIDDEN_HOST`              | Host header not allowed                                                                        |
| 403         | `FORBIDDEN_ORIGIN`            | Origin header not allowed                                                                      |
| 404         | `NOT_FOUND`                   | Resource not found (including an unknown settings key)                                         |
| 404         | `ACTION_NOT_FOUND`            | Action not found (`DELETE /code/{action_oid}/{state}`, and engine errors)                      |
| 404         | `INSTANCE_NOT_FOUND`          | Instance not found (engine errors)                                                             |
| 404         | `PROPERTY_NOT_FOUND`          | Property edit names a property that does not exist                                             |
| 409         | `CONFLICT`                    | Operation blocked: active instances, active or pinned code version                             |
| 409         | `INVALID_STATE_TRANSITION`    | Command not valid in the instance's current state (`details: { current_state, command }`)      |
| 422         | `INVALID_COMMAND`             | Unknown instance command                                                                       |
| 500         | `EXECUTION_ERROR`             | Engine execution error                                                                         |
| 500         | `PROPERTY_WRITE_ERROR`        | Engine property write error                                                                    |
| 500         | `INTERNAL_ERROR`              | Unexpected server error (also: malformed JSON or a body over 100 KB, oversized multipart file) |
