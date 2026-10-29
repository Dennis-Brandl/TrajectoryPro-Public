# Mission Autopilot — Execution Engine Specification

## Overview

The Execution Engine is the core of the Action Container. It receives action invocation requests from the Trajectory REST protocol layer, creates Runtime Action Instances, walks them through the ISA-88 state machine, executes user-written Python code at each configured state, and returns results to the calling workflow client.

---

## 1. Action Invocation Flow

### 1.1 Observable Actions

```
POST /trajectory/v1/actions/{action_oid}/invoke
    │
    ▼
┌─────────────────────────────────────────────┐
│ 1. Validate action_oid exists in storage     │
│ 2. Validate input parameters                 │
│ 3. Create RuntimeActionInstance              │
│    - Generate runtime_action_instance_id     │
│    - Store input parameters                  │
│    - Pin active code versions for all states │
│    - Initial state: STARTING                 │
│ 4. Return 201 with instance_id & sse_endpoint│
└──────────────────┬──────────────────────────┘
                   │ (async, after response sent)
                   ▼
┌─────────────────────────────────────────────┐
│ 5. State: STARTING                           │
│    - Check pinned code for STARTING          │
│    - If code exists: execute via Python pool  │
│    - If no code: auto-advance                │
│    - Emit SSE state_change event             │
│ 6. State: EXECUTING                          │
│    - Check pinned code for EXECUTING         │
│    - Execute main action logic               │
│    - Emit SSE progress events (if reported)  │
│    - Emit SSE state_change event             │
│ 7. State: COMPLETING                         │
│    - Check pinned code for COMPLETING        │
│    - Collect output parameters               │
│    - Emit SSE output event (is_final: true)  │
│    - Emit SSE state_change → COMPLETED       │
│ 8. Write execution log entry                 │
│ 9. Close SSE connection                      │
└─────────────────────────────────────────────┘
```

### 1.2 Opaque Actions

```
POST /trajectory/v1/actions/{action_oid}/invoke
    │
    ▼
┌─────────────────────────────────────────────┐
│ 1. Validate and create instance              │
│    - Initial state: POSTED                   │
│ 2. Return 201 with instance_id               │
└──────────────────┬──────────────────────────┘
                   │ (async)
                   ▼
┌─────────────────────────────────────────────┐
│ 3. POSTED → RECEIVED (auto)                  │
│ 4. RECEIVED → IN_PROGRESS                    │
│    - Execute action code (if any)            │
│ 5. IN_PROGRESS → COMPLETED                   │
│    - Collect output parameters               │
│ 6. Write execution log entry                 │
└─────────────────────────────────────────────┘
```

For opaque actions, the client polls `GET /instances/{id}` to check status.

---

## 2. Python Code Execution

### 2.1 Subprocess Pool

The engine maintains a pool of Python subprocess workers (default: 4, configurable).

```
┌──────────────────────────────┐
│     Python Subprocess Pool    │
│                               │
│  ┌─────────┐  ┌─────────┐    │
│  │ Worker 1 │  │ Worker 2 │   │
│  │ (idle)   │  │ (busy)   │   │
│  └─────────┘  └─────────┘    │
│  ┌─────────┐  ┌─────────┐    │
│  │ Worker 3 │  │ Worker 4 │   │
│  │ (idle)   │  │ (idle)   │   │
│  └─────────┘  └─────────┘    │
└──────────────────────────────┘
```

Pool behavior:

- Workers are **long-lived** Python processes running `sandbox_runner.py`
- Each worker handles **one execution at a time** (no concurrency within a worker)
- When all workers are busy, new requests queue and wait for a free worker
- Workers are recycled after a configurable number of executions (default: 100) to prevent memory leaks
- If a worker crashes, the pool spawns a replacement

### 2.2 Execution Request Protocol

The Node.js engine communicates with Python workers via stdin/stdout JSON:

**Request (Node.js → Python):**

```json
{
  "request_id": "req-uuid",
  "action_oid": "act-001-snowflake",
  "action_name": "Heat Oven",
  "state": "EXECUTING",
  "source_code": "def execute(inputs, outputs, props, action_props):\n    ...",
  "inputs": {
    "target_temperature": "200",
    "recipe_name": "Bolognese Sauce"
  },
  "environment_action_properties": {
    "RetryPolicy": {
      "MaxRetries": "3",
      "BackoffMs": "1000"
    }
  },
  "action_properties": {
    "ConnectionConfig": {
      "Host": "sensor-gateway.local",
      "Port": "8080"
    }
  },
  "timeout_ms": 60000
}
```

**Response (Python → Node.js):**

```json
{
  "request_id": "req-uuid",
  "success": true,
  "outputs": {
    "actual_temperature": "198.5",
    "status_message": "Oven heated successfully"
  },
  "return_value": true,
  "execution_time_ms": 2450,
  "stdout_capture": "Debug: temperature rising...\n",
  "stderr_capture": ""
}
```

**Error Response (Python → Node.js):**

```json
{
  "request_id": "req-uuid",
  "success": false,
  "outputs": {},
  "return_value": null,
  "error": "ValueError: target_temperature must be positive",
  "traceback": "Traceback (most recent call last):\n  File ...",
  "execution_time_ms": 12,
  "stdout_capture": "",
  "stderr_capture": ""
}
```

### 2.3 Python Code API

Each state handler is a Python function with a fixed signature:

```python
def execute(inputs: dict, outputs: dict, props: dict, action_props: dict) -> bool:
    """
    State handler function for an action state.

    Parameters:
        inputs (dict):       Input parameters as name → value strings.
                             Read-only. Values come from the invoke request.

        outputs (dict):      Output parameters as name → value strings.
                             Read/write. Write values here to set output parameters.
                             Values persist across state transitions within the same instance.

        props (dict):        Environment action properties as name → {entry_name: value}.
                             Read-only. Cross-cutting properties from the environment.

        action_props (dict): Action-level properties as name → {entry_name: value}.
                             Read-only. Properties specific to this action.

    Returns:
        bool: True  = auto-advance to the next state
              False = stay in current state (engine will re-enter this handler
                      when the state is resumed, e.g., after HOLD/UNHOLD)

    Notes:
        - The function name MUST be 'execute'
        - All parameter values are strings (convert as needed)
        - The outputs dict accumulates across states — values set in STARTING
          are visible in EXECUTING and COMPLETING
        - Raising an exception causes the instance to transition to ABORTING
        - print() output is captured in stdout_capture for debugging
    """
    pass
```

### 2.4 Example Action Code

**STARTING state** — Validate inputs:

```python
def execute(inputs, outputs, props, action_props):
    temp = inputs.get("target_temperature", "")
    if not temp or float(temp) <= 0:
        raise ValueError(f"Invalid target_temperature: {temp}")
    print(f"Validated target temperature: {temp}°C")
    return True  # Advance to EXECUTING
```

**EXECUTING state** — Main logic:

```python
def execute(inputs, outputs, props, action_props):
    target = float(inputs["target_temperature"])
    host = action_props.get("ConnectionConfig", {}).get("Host", "localhost")
    port = action_props.get("ConnectionConfig", {}).get("Port", "8080")

    # Simulate work (real implementation would call external system)
    actual = target - 1.5
    outputs["actual_temperature"] = str(actual)
    outputs["status_message"] = f"Oven at {actual}°C (target: {target}°C)"

    print(f"Action complete: {actual}°C")
    return True  # Advance to COMPLETING
```

**COMPLETING state** — Final output preparation:

```python
def execute(inputs, outputs, props, action_props):
    # Add a summary output
    outputs["summary"] = f"Heated to {outputs.get('actual_temperature', 'N/A')}°C"
    return True  # Advance to COMPLETED
```

### 2.5 Output Accumulation

The `outputs` dictionary is shared across all state handlers within a single instance execution:

```
STARTING:    outputs = {}              → code sets outputs["status"] = "starting"
EXECUTING:   outputs = {"status": "starting"} → code sets outputs["result"] = "42"
COMPLETING:  outputs = {"status": "starting", "result": "42"} → code adds final values
```

The final `outputs` dictionary after the last state with code becomes the action's output parameters, delivered to the workflow client.

---

## 3. State Machine Integration

### 3.1 State Entry Hook

When the state machine transitions to a new state, the engine:

1. Records the state transition in the instance's `state_history`
2. Emits an SSE `state_change` event (for observable instances)
3. Checks the Code Registry for a pinned code version for this state
4. **If code exists**: acquires a Python worker from the pool, executes the code
5. **If no code exists**: immediately triggers the auto-advance transition (SC)
6. Updates the instance record in storage

### 3.2 Auto-Advance Logic

For states without code:

| From State  | Auto-Advance To |
| ----------- | --------------- |
| STARTING    | EXECUTING       |
| EXECUTING   | COMPLETING      |
| COMPLETING  | COMPLETED       |
| PAUSING     | PAUSED          |
| UNPAUSING   | EXECUTING       |
| HOLDING     | HELD            |
| UNHOLDING   | EXECUTING       |
| ABORTING    | ABORTED         |
| STOPPING    | COMPLETED       |
| CLEARING    | COMPLETED       |
| POSTED      | RECEIVED        |
| RECEIVED    | IN_PROGRESS     |
| IN_PROGRESS | COMPLETED       |

If a state HAS code, the engine executes the code and uses the return value:

- `True` → trigger the same auto-advance transition
- `False` → stay in the current state (the state machine remains, engine does not advance)

### 3.3 Command Handling

When a state command arrives (PAUSE, RESUME, HOLD, UNHOLD, ABORT, STOP, CLEAR):

1. Validate the command is valid for the current state (per the transition table)
2. If valid: transition to the intermediate state (e.g., EXECUTING → PAUSE → PAUSING)
3. If the intermediate state has code, execute it (e.g., PAUSING code saves state)
4. Auto-advance to the target state (e.g., PAUSING → PAUSED)
5. Emit SSE state_change events for each transition

### 3.4 Error Handling

If Python code raises an exception:

1. The error message and traceback are recorded on the instance
2. The instance transitions to ABORTING (with reason: code execution error)
3. If ABORTING has code, it is executed (for cleanup)
4. The instance transitions to ABORTED
5. An SSE `error` event is emitted, followed by `state_change` → ABORTED
6. The error is included in the execution log entry

### 3.5 Timeout Handling

If Python code exceeds the configured timeout:

1. The subprocess is sent SIGTERM, then SIGKILL after 5 seconds
2. The instance is marked with error: "Execution timeout exceeded"
3. The instance transitions to ABORTING → ABORTED
4. A replacement worker is spawned in the pool

---

## 4. Parameter Resolution

### 4.1 Input Parameters

Input parameters arrive in the invoke request as `ResolvedParameter[]` (name/value pairs). The workflow client (Trajectory Mobile) has already resolved property references to literal values. The Action Container receives and passes them directly to Python code as a dictionary.

### 4.2 Output Parameters

Output parameters are collected from the Python code's `outputs` dictionary after the final state with code executes. They are:

1. Stored on the instance as `output_parameters: ResolvedParameter[]`
2. Included in the SSE `output` event (with `is_final: true`)
3. Available via `GET /instances/{id}` status endpoint
4. Recorded in the execution log entry

### 4.3 Environment Action Properties

The engine resolves environment action properties by:

1. Looking up the action's `environment_oid` in storage
2. Loading the environment's `action_property_specifications`
3. Flattening to `{ property_name: { entry_name: entry_value, ... }, ... }`
4. Passing as the `props` parameter to Python code

### 4.4 Action-Level Properties

The engine resolves action-level properties by:

1. Loading the action's `property_specifications`
2. Flattening to `{ property_name: { entry_name: entry_value, ... }, ... }`
3. Passing as the `action_props` parameter to Python code

---

## 5. Concurrency

### 5.1 Multiple Simultaneous Instances

The Action Container supports multiple action instances running concurrently:

- Each instance has its own state machine, independent of others
- The Python subprocess pool handles parallelism (one worker per active execution)
- Instance state is stored independently in SQLite
- SSE connections are per-instance

### 5.2 Pool Exhaustion

When all Python workers are busy:

- New state executions queue in memory (FIFO)
- Queued instances remain in their current state (e.g., STARTING) until a worker is available
- The queue has no hard limit, but instance timeout still applies (timeout starts at instance creation)
- If pool exhaustion is frequent, the admin should increase `python_pool_size` in settings

### 5.3 Same Action, Different Instances

Multiple instances of the same action can run simultaneously. Each gets its own `outputs` dictionary, its own state machine, and its own Python worker. There is no shared mutable state between instances.

---

## 6. Execution Logging

After an instance reaches a terminal state (COMPLETED, ABORTED, STOPPED):

1. Collect the full execution record:
   - Instance ID, action OID/name, environment OID/name
   - Input parameters snapshot
   - Output parameters snapshot
   - States executed (with timing and code version info)
   - Start/end timestamps, duration
   - Final status and any error message
2. Write to the `action_instance_log` table
3. Check rolling log size; trim oldest entries if over limit
4. Mark the instance as logged in the active instance table
5. After `instance_retention_hours`, the active instance record is cleaned up (the log entry remains until rolled over)
