# Mission Autopilot — REST Protocol Specification (Server-Side)

## Overview

This document specifies the Action Container's implementation of the Trajectory REST protocol. The protocol is defined in the Trajectory Mobile `RESTProtocolSpec.md` from the client perspective. This document covers the server-side implementation details — how the Action Container handles each endpoint, maps requests to the engine, and manages SSE connections.

The Action Container implements the **full** Trajectory v1 protocol: all required AND optional endpoints.

---

## 1. Base URL

```
http://{container-host}:{port}/trajectory/v1/
```

Default port: 3000 (configurable via `PORT` environment variable).

---

## 2. Endpoint Implementation

### 2.1 Health Check

```
GET /trajectory/v1/health
```

**Implementation**:

- Returns container status including Python pool health
- No database query required (in-memory state)

**Response 200:**

```json
{
  "status": "healthy",
  "server_name": "Mission Autopilot",
  "server_version": "1.0.0",
  "protocol_version": "1.0",
  "timestamp": "2026-02-24T10:30:00Z",
  "python_pool": {
    "total_workers": 4,
    "idle_workers": 3,
    "busy_workers": 1,
    "queued_requests": 0
  }
}
```

The `python_pool` field is an extension to the standard protocol (clients should ignore unknown fields).

---

### 2.2 Discover Capabilities

```
GET /trajectory/v1/capabilities
```

**Implementation**:

- Queries all stored actions across all environments
- For each action: includes parameter specs and supported commands
- Observable actions support all commands; opaque actions support ABORT/STOP only

**Response 200:**

```json
{
  "actions": [
    {
      "action_oid": "act-001-snowflake",
      "action_name": "Heat Oven",
      "action_version": "1.0.0",
      "environment_oid": "env-001-snowflake",
      "environment_name": "Kitchen Environment",
      "visibility_support": ["observable"],
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
      "supported_commands": ["PAUSE", "RESUME", "HOLD", "UNHOLD", "ABORT", "STOP", "CLEAR"],
      "states_with_code": ["STARTING", "EXECUTING"]
    }
  ],
  "max_concurrent_instances": 50,
  "sse_supported": true
}
```

The `environment_oid`, `environment_name`, and `states_with_code` fields are extensions.

---

### 2.3 Invoke Action

```
POST /trajectory/v1/actions/{action_oid}/invoke
```

**Implementation**:

1. Validate `action_oid` exists in storage → 404 `ACTION_NOT_FOUND` if not
2. Validate required fields in request body → 400 `INVALID_REQUEST` if missing
3. Validate input parameters against action spec (names must match) → 422 `PARAMETER_VALIDATION_FAILED`
4. Create `RuntimeActionInstance` via Instance Manager
5. Pin active code versions for all states
6. Return 201 response immediately
7. Begin async state execution (STARTING → EXECUTING → COMPLETING → COMPLETED)

**Request Body**: Per Trajectory Mobile `RESTProtocolSpec.md` Section 2.3.

**Response 201:**

```json
{
  "runtime_action_instance_id": "rai-uuid-v4",
  "action_oid": "act-001-snowflake",
  "status": "STARTING",
  "created_at": "2026-02-24T10:31:00Z",
  "sse_endpoint": "/trajectory/v1/instances/rai-uuid-v4/events"
}
```

For opaque actions, `status` is `"POSTED"` and `sse_endpoint` is omitted.

---

### 2.4 Get Instance Status

```
GET /trajectory/v1/instances/{runtime_action_instance_id}
```

**Implementation**:

- Queries Instance Manager for the instance
- Returns current state, state history, and output parameters (if completed)
- 404 `INSTANCE_NOT_FOUND` if the instance doesn't exist or has been cleaned up

**Response 200**: Per Trajectory Mobile `RESTProtocolSpec.md` Section 2.4.

---

### 2.5 Send State Command

```
POST /trajectory/v1/instances/{runtime_action_instance_id}/command
```

**Implementation**:

1. Look up instance → 404 if not found
2. Validate command is valid for current state → 409 `INVALID_STATE_TRANSITION`
3. Forward command to the instance's state machine
4. State machine processes the transition (may trigger code execution)
5. Return the new state

**Request/Response**: Per Trajectory Mobile `RESTProtocolSpec.md` Section 2.5.

---

### 2.6 SSE Event Stream

```
GET /trajectory/v1/instances/{runtime_action_instance_id}/events
```

**Implementation**:

- Express route sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Registers an event listener on the Instance Manager for this instance
- Forwards state changes, output events, progress updates, and errors as SSE events
- Sends heartbeat every 30 seconds if no other events
- Supports `Last-Event-ID` header for reconnection (replays missed events from in-memory buffer)
- Closes connection when instance reaches terminal state
- Event ID format: sequential integer per instance (e.g., `1`, `2`, `3`)

**Event Buffer**:

- Each instance maintains an in-memory ring buffer of the last 100 events
- On SSE reconnection, events after the `Last-Event-ID` are replayed
- Buffer is discarded when instance reaches terminal state and all SSE connections close

**Event Types**: Per Trajectory Mobile `RESTProtocolSpec.md` Section 2.6.

---

### 2.7 List Active Instances

```
GET /trajectory/v1/instances?workflow_instance_id={id}&status={status}&action_oid={oid}
```

**Implementation**:

- Queries Instance Manager with optional filters
- Returns all active (non-completed) instances by default
- Includes completed instances that haven't been cleaned up yet

**Response 200**: Per Trajectory Mobile `RESTProtocolSpec.md` Section 2.7.

---

### 2.8 Cancel Instance

```
DELETE /trajectory/v1/instances/{runtime_action_instance_id}
```

**Implementation**:

1. Look up instance → 404 if not found
2. If instance is in a terminal state, return current status
3. Send ABORT command to the state machine
4. If Python code is running, terminate the subprocess
5. Wait for ABORTED state, return result

**Response 200**: Per Trajectory Mobile `RESTProtocolSpec.md` Section 2.8.

---

## 3. Error Handling

### 3.1 Standard Error Response

All errors follow the Trajectory protocol error format:

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

| HTTP Status | Code                          | Trigger                                              |
| ----------- | ----------------------------- | ---------------------------------------------------- |
| 400         | `INVALID_REQUEST`             | Malformed request body, missing required fields      |
| 404         | `ACTION_NOT_FOUND`            | `action_oid` not found in any loaded environment     |
| 404         | `INSTANCE_NOT_FOUND`          | `runtime_action_instance_id` not found or cleaned up |
| 409         | `INVALID_STATE_TRANSITION`    | Command not valid for current state                  |
| 422         | `PARAMETER_VALIDATION_FAILED` | Input parameter names don't match action spec        |
| 500         | `INTERNAL_ERROR`              | Unexpected server error                              |
| 503         | `SERVER_UNAVAILABLE`          | Python pool exhausted, database unavailable          |

### 3.3 Python Execution Errors

When Python code raises an exception:

- The instance transitions to ABORTING → ABORTED
- SSE `error` event is emitted with the exception message
- The error is recorded in the instance and the execution log
- The HTTP status of any in-flight request is NOT affected (errors are conveyed via state changes)

---

## 4. CORS Configuration

The Action Container enables CORS for all origins by default (v1.0, no authentication):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept, Last-Event-ID
```

Future versions with authentication will restrict CORS to configured origins.

---

## 5. Request Logging

All Trajectory protocol requests are logged at INFO level:

```
[2026-02-24T10:31:00Z] POST /trajectory/v1/actions/act-001/invoke → 201 (15ms)
[2026-02-24T10:31:02Z] GET /trajectory/v1/instances/rai-uuid/events → SSE connected
[2026-02-24T10:35:00Z] SSE closed for rai-uuid (COMPLETED)
```

This is separate from the execution log — request logs go to stdout (Docker container logs).
