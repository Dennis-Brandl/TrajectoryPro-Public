# Mission Autopilot — Management API Specification

## Overview

The Management API provides the backend for the browser-based management console. It serves environment and action management, code editing, instance monitoring, log queries, and system settings. All endpoints are prefixed with `/management/v1/`.

---

## 1. Base URL

```
http://{container-host}:{port}/management/v1/
```

---

## 2. Endpoints

### 2.1 Dashboard

#### Get Dashboard Summary

```
GET /management/v1/dashboard
```

**Response 200:**

```json
{
  "container": {
    "version": "1.0.0",
    "uptime_seconds": 86400,
    "started_at": "2026-02-23T10:30:00Z"
  },
  "python_pool": {
    "total_workers": 4,
    "idle_workers": 3,
    "busy_workers": 1,
    "queued_requests": 0
  },
  "environments": {
    "total_count": 3,
    "total_actions": 12
  },
  "instances": {
    "active_count": 2,
    "completed_today": 47,
    "aborted_today": 1
  },
  "log": {
    "total_entries": 4823,
    "max_entries": 10000,
    "oldest_entry_at": "2026-02-20T08:15:00Z"
  },
  "recent_log_entries": [
    {
      "id": 4823,
      "action_name": "Heat Oven",
      "environment_name": "Kitchen",
      "final_status": "COMPLETED",
      "duration_ms": 2450,
      "completed_at": "2026-02-24T10:35:00Z"
    }
  ]
}
```

---

### 2.2 Package Upload

#### Upload Environment/Action Packages

```
POST /management/v1/upload
Content-Type: multipart/form-data
```

**Request**: Multipart form data with one or more files:

- `.WFenvir` — Master Environment Library (JSON)
- `.WFaction` — Master Action Library (JSON)

Multiple files can be uploaded in a single request.

**Processing**:

1. Parse each uploaded file based on extension
2. For `.WFenvir` files:
   - Parse JSON as `MasterEnvironmentLibrary`
   - For each `MasterEnvironmentSpecification`:
     - Store environment with immutable OIDs
     - Extract and store each `IncludedAction` as a `StoredActionSpecification`
   - If environment OID already exists: update version/specs, preserve OID
3. For `.WFaction` files:
   - Parse JSON as `MasterActionLibrary`
   - Store each `MasterActionSpecification`
   - These are standalone actions not yet assigned to an environment
4. Return summary of what was imported

**Response 200:**

```json
{
  "imported": [
    {
      "type": "environment",
      "oid": "env-001-snowflake",
      "local_id": "KitchenEnvironment",
      "version": "1.0.0",
      "actions_count": 5,
      "status": "created"
    },
    {
      "type": "environment",
      "oid": "env-002-snowflake",
      "local_id": "FactoryFloor",
      "version": "2.1.0",
      "actions_count": 8,
      "status": "updated"
    }
  ],
  "errors": []
}
```

**Response 400 (Parse Error):**

```json
{
  "imported": [],
  "errors": [
    {
      "filename": "broken.WFenvir",
      "error": "Invalid JSON: Unexpected token at position 42"
    }
  ]
}
```

---

### 2.3 Environment Management

#### List Environments

```
GET /management/v1/environments
```

**Response 200:**

```json
{
  "environments": [
    {
      "oid": "env-001-snowflake",
      "local_id": "KitchenEnvironment",
      "version": "1.0.0",
      "description": "Kitchen automation environment",
      "last_modified_date": "2026-02-20T14:00:00Z",
      "imported_at": "2026-02-21T09:00:00Z",
      "actions_count": 5,
      "action_property_count": 2,
      "value_property_count": 3,
      "resource_property_count": 1
    }
  ]
}
```

#### Get Environment Detail

```
GET /management/v1/environments/{environment_oid}
```

**Response 200:**

```json
{
  "oid": "env-001-snowflake",
  "local_id": "KitchenEnvironment",
  "version": "1.0.0",
  "description": "Kitchen automation environment",
  "last_modified_date": "2026-02-20T14:00:00Z",
  "schemaVersion": "4.0",
  "imported_at": "2026-02-21T09:00:00Z",
  "source_filename": "KitchenEnv.WFenvir",
  "action_property_specifications": [
    {
      "name": "RetryPolicy",
      "entries": [
        { "name": "MaxRetries", "value": "3" },
        { "name": "BackoffMs", "value": "1000" }
      ]
    }
  ],
  "value_property_specifications": [
    {
      "name": "CurrentTemperature",
      "entries": [{ "name": "Value", "value": "0" }]
    }
  ],
  "resource_property_specifications": [
    {
      "name": "OvenAccess",
      "resource_type": "binary exclusive use",
      "description": "Exclusive oven access"
    }
  ],
  "actions": [
    {
      "oid": "act-001-snowflake",
      "local_id": "HeatOven",
      "version": "1.0.0",
      "action_visibility": "observable",
      "input_parameter_count": 2,
      "output_parameter_count": 1,
      "states_with_code": ["STARTING", "EXECUTING"]
    }
  ]
}
```

#### Delete Environment

```
DELETE /management/v1/environments/{environment_oid}
```

**Validation**: Cannot delete if any action in this environment has active (running) instances.

**Side effects**: Terminal-state instance records (COMPLETE, ABORTED, STOPPED) for this environment are also removed in the same transaction. Execution-log entries are preserved (the `execution_log` table has no FK to `instances`).

**Response 200:**

```json
{
  "deleted": true,
  "environment_oid": "env-001-snowflake",
  "actions_removed": 5,
  "code_versions_removed": 12,
  "instances_removed": 3
}
```

---

### 2.4 Action Management

#### Get Action Detail

```
GET /management/v1/actions/{action_oid}
```

**Response 200:**

```json
{
  "oid": "act-001-snowflake",
  "local_id": "HeatOven",
  "version": "1.0.0",
  "description": "Heats the oven to a target temperature",
  "environment_oid": "env-001-snowflake",
  "environment_name": "KitchenEnvironment",
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
      "target_property_name": "CurrentTemperature",
      "target_entry_name": "Value",
      "description": "Measured temperature"
    }
  ],
  "property_specifications": [
    {
      "name": "ConnectionConfig",
      "entries": [
        { "name": "Host", "value": "sensor-gateway.local" },
        { "name": "Port", "value": "8080" }
      ]
    }
  ],
  "code_summary": {
    "states_with_code": ["STARTING", "EXECUTING"],
    "total_versions": 7,
    "last_code_update": "2026-02-24T09:00:00Z"
  }
}
```

---

### 2.5 Code Management

#### List Code Versions for Action+State

```
GET /management/v1/code/{action_oid}/{state}
```

**Response 200:**

```json
{
  "action_oid": "act-001-snowflake",
  "state": "EXECUTING",
  "versions": [
    {
      "id": "cv-uuid-3",
      "version_number": 3,
      "is_active": true,
      "created_at": "2026-02-24T09:00:00Z",
      "description": "Added error handling for sensor timeout"
    },
    {
      "id": "cv-uuid-2",
      "version_number": 2,
      "is_active": false,
      "created_at": "2026-02-23T14:30:00Z",
      "description": "Initial implementation"
    },
    {
      "id": "cv-uuid-1",
      "version_number": 1,
      "is_active": false,
      "created_at": "2026-02-22T11:00:00Z",
      "description": null
    }
  ]
}
```

#### Get Code Version Source

```
GET /management/v1/code/{action_oid}/{state}/{version_id}
```

**Response 200:**

```json
{
  "id": "cv-uuid-3",
  "action_oid": "act-001-snowflake",
  "state": "EXECUTING",
  "version_number": 3,
  "is_active": true,
  "source_code": "def execute(inputs, outputs, props, action_props):\n    ...",
  "created_at": "2026-02-24T09:00:00Z",
  "description": "Added error handling for sensor timeout"
}
```

#### Get Active Code for Action+State

```
GET /management/v1/code/{action_oid}/{state}/active
```

Returns the currently active version (same response format as above). Returns 404 if no code has been written for this action+state.

#### Save New Code Version

```
POST /management/v1/code/{action_oid}/{state}
```

**Request Body:**

```json
{
  "source_code": "def execute(inputs, outputs, props, action_props):\n    ...",
  "description": "Added error handling for sensor timeout"
}
```

**Processing**:

1. Validate `action_oid` exists
2. Validate `state` is a valid action state name
3. Create new `ActionCodeVersion` with auto-incremented `version_number`
4. Set `is_active = true`, deactivate previous active version
5. New action instances will immediately use this version (hot-reload)

**Response 201:**

```json
{
  "id": "cv-uuid-4",
  "version_number": 4,
  "is_active": true,
  "created_at": "2026-02-24T10:00:00Z"
}
```

#### Activate a Code Version (Rollback)

```
POST /management/v1/code/{action_oid}/{state}/{version_id}/activate
```

**Processing**:

1. Set `is_active = true` on the specified version
2. Set `is_active = false` on the previously active version
3. New instances will use the newly activated version

**Response 200:**

```json
{
  "id": "cv-uuid-2",
  "version_number": 2,
  "is_active": true,
  "activated_at": "2026-02-24T10:05:00Z"
}
```

#### Delete a Code Version

```
DELETE /management/v1/code/{action_oid}/{state}/{version_id}
```

**Validation**:

- Cannot delete the active version (activate another first)
- Cannot delete a version pinned by a running instance

**Response 200:**

```json
{
  "deleted": true,
  "id": "cv-uuid-1"
}
```

#### Test Code Execution (Dry Run)

```
POST /management/v1/code/{action_oid}/{state}/test
```

**Request Body:**

```json
{
  "source_code": "def execute(inputs, outputs, props, action_props):\n    ...",
  "test_inputs": {
    "target_temperature": "200"
  }
}
```

**Processing**:

1. Executes the provided source code in a Python subprocess
2. Uses the action's property specifications as `props` and `action_props`
3. Does NOT create a Runtime Action Instance
4. Does NOT modify any state

**Response 200:**

```json
{
  "success": true,
  "outputs": {
    "actual_temperature": "198.5"
  },
  "return_value": true,
  "execution_time_ms": 245,
  "stdout_capture": "Debug: processing...\n",
  "stderr_capture": ""
}
```

---

### 2.6 Instance Monitoring

#### List Active Instances (Management View)

```
GET /management/v1/instances?environment_oid={oid}&action_oid={oid}&status={status}
```

**Response 200:**

```json
{
  "instances": [
    {
      "runtime_action_instance_id": "rai-uuid-1",
      "action_oid": "act-001-snowflake",
      "action_name": "HeatOven",
      "environment_name": "KitchenEnvironment",
      "state": "EXECUTING",
      "workflow_instance_id": "wf-uuid",
      "created_at": "2026-02-24T10:31:00Z",
      "states_completed": ["STARTING"],
      "current_state_duration_ms": 15000
    }
  ],
  "total_count": 1
}
```

#### Get Instance Detail (Management View)

```
GET /management/v1/instances/{runtime_action_instance_id}
```

**Response 200:**

```json
{
  "runtime_action_instance_id": "rai-uuid-1",
  "action_oid": "act-001-snowflake",
  "action_name": "HeatOven",
  "environment_oid": "env-001-snowflake",
  "environment_name": "KitchenEnvironment",
  "visibility": "observable",
  "state": "EXECUTING",
  "workflow_instance_id": "wf-uuid",
  "step_oid": "step-001",
  "input_parameters": [{ "name": "target_temperature", "value": "200" }],
  "output_parameters": [],
  "pinned_code_versions": [
    { "state": "STARTING", "version_number": 2 },
    { "state": "EXECUTING", "version_number": 3 }
  ],
  "state_history": [
    {
      "from_state": null,
      "to_state": "STARTING",
      "timestamp": "2026-02-24T10:31:00Z",
      "triggered_by": "engine"
    },
    {
      "from_state": "STARTING",
      "to_state": "EXECUTING",
      "timestamp": "2026-02-24T10:31:02Z",
      "triggered_by": "engine"
    }
  ],
  "created_at": "2026-02-24T10:31:00Z",
  "started_at": "2026-02-24T10:31:00Z"
}
```

#### Send Command to Instance (from Console)

```
POST /management/v1/instances/{runtime_action_instance_id}/command
```

**Request Body:**

```json
{
  "command": "PAUSE",
  "reason": "Administrator paused for inspection"
}
```

This delegates to the same state machine command handler as the Trajectory protocol command endpoint.

---

### 2.7 Execution Log

#### Query Log Entries

```
GET /management/v1/log?action_name={name}&environment_oid={oid}&status={status}&from={date}&to={date}&page={n}&page_size={n}
```

**Query Parameters:**

| Parameter         | Type   | Default | Description                                          |
| ----------------- | ------ | ------- | ---------------------------------------------------- |
| `action_name`     | string | —       | Filter by action name (partial match)                |
| `environment_oid` | string | —       | Filter by environment OID                            |
| `status`          | string | —       | Filter by final status (COMPLETED, ABORTED, STOPPED) |
| `from`            | string | —       | ISO 8601 start date                                  |
| `to`              | string | —       | ISO 8601 end date                                    |
| `page`            | number | 1       | Page number                                          |
| `page_size`       | number | 50      | Entries per page (max 200)                           |

**Response 200:**

```json
{
  "entries": [
    {
      "id": 4823,
      "runtime_action_instance_id": "rai-uuid-1",
      "action_oid": "act-001-snowflake",
      "action_name": "HeatOven",
      "environment_oid": "env-001-snowflake",
      "environment_name": "KitchenEnvironment",
      "workflow_instance_id": "wf-uuid",
      "input_parameters": [{ "name": "target_temperature", "value": "200" }],
      "output_parameters": [{ "name": "actual_temperature", "value": "198.5" }],
      "states_executed": [
        {
          "state": "STARTING",
          "had_code": true,
          "code_version_number": 2,
          "entered_at": "2026-02-24T10:31:00Z",
          "exited_at": "2026-02-24T10:31:02Z",
          "duration_ms": 2000
        },
        {
          "state": "EXECUTING",
          "had_code": true,
          "code_version_number": 3,
          "entered_at": "2026-02-24T10:31:02Z",
          "exited_at": "2026-02-24T10:34:50Z",
          "duration_ms": 228000
        }
      ],
      "started_at": "2026-02-24T10:31:00Z",
      "completed_at": "2026-02-24T10:35:00Z",
      "duration_ms": 240000,
      "final_status": "COMPLETED"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 50,
    "total_entries": 4823,
    "total_pages": 97
  },
  "log_config": {
    "max_entries": 10000,
    "current_entries": 4823,
    "oldest_entry_at": "2026-02-20T08:15:00Z"
  }
}
```

#### Get Single Log Entry

```
GET /management/v1/log/{log_entry_id}
```

Returns the full log entry (same fields as above, single object).

---

### 2.8 Settings

#### Get All Settings

```
GET /management/v1/settings
```

**Response 200:**

```json
{
  "settings": [
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
    }
  ]
}
```

#### Update Setting

```
PUT /management/v1/settings/{key}
```

**Request Body:**

```json
{
  "value": "20000"
}
```

**Processing**:

- Validates value against `value_type`
- For `python_pool_size`: takes effect on next worker recycle (gradual)
- For `log_max_size`: if reduced below current count, excess entries are trimmed immediately
- For `execution_timeout_ms`: applies to new executions only
- For `instance_retention_hours`: applies to future cleanup cycles

**Response 200:**

```json
{
  "key": "log_max_size",
  "value": "20000",
  "previous_value": "10000",
  "applied": true
}
```

---

## 3. Error Response Format

All management API errors use a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

| HTTP Status | Code                | Description                                                 |
| ----------- | ------------------- | ----------------------------------------------------------- |
| 400         | `INVALID_REQUEST`   | Bad request body or parameters                              |
| 404         | `NOT_FOUND`         | Resource not found                                          |
| 409         | `CONFLICT`          | Cannot perform operation (e.g., delete active code version) |
| 422         | `VALIDATION_FAILED` | Setting value fails validation                              |
| 500         | `INTERNAL_ERROR`    | Unexpected server error                                     |
