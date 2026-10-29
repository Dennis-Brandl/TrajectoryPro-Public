# Mission Autopilot — Data Model Specification

## Overview

This specification defines the complete data model for Mission Autopilot. The model is divided into:

- **Imported Master Specifications** — Downloaded from Trajectory MD via package upload, stored read-only with immutable OIDs
- **Action Code** — User-written Python code, versioned per action+state
- **Runtime Action Instances** — Created when workflow clients invoke actions, mutated during execution
- **Execution Log** — Rolling log of completed action instance records

**Critical invariant**: The `oid` fields on Environment Specifications and Action Specifications are immutable identifiers authored in Trajectory MD. They are the primary keys by which workflow clients (Trajectory Mobile) locate and invoke actions. The Action Container MUST preserve these OIDs exactly as received and MUST NOT generate or modify them.

---

## 1. Imported Master Specifications

These are extracted from uploaded `.WFenvir` and `.WFaction` package files and stored in PostgreSQL (see `StorageSpec.md` for the schema). They are never modified by the Action Container runtime.

### 1.1 Master Environment Specification

Stored as received from Trajectory MD:

```typescript
interface StoredEnvironmentSpecification {
  // Immutable identifiers from Trajectory MD
  oid: string // Snowflake OID — globally unique, immutable
  local_id: string // Human-readable identifier
  version: string // Semantic version (e.g., "1.0.0")
  last_modified_date: string // ISO 8601 timestamp from Trajectory MD
  description?: string // Optional description
  schemaVersion: string // Schema version (e.g., "4.0")

  // Environment-level specifications
  action_property_specifications: PropertySpecification[]
  value_property_specifications: PropertySpecification[]
  resource_property_specifications: ResourcePropertySpecification[]

  // Included actions (references resolved to full specs)
  included_actions: IncludedAction[]

  // Import metadata (added by container)
  imported_at: string // ISO 8601 timestamp when uploaded
  source_filename: string // Original upload filename
}
```

### 1.2 Master Action Specification

Each included action from an environment is stored independently for direct lookup by `action_oid`:

```typescript
interface StoredActionSpecification {
  // Immutable identifiers from Trajectory MD
  oid: string // Snowflake OID — globally unique, immutable
  local_id: string // Human-readable action name
  version: string // Semantic version
  last_modified_date: string // ISO 8601 from Trajectory MD
  description?: string

  // Parent environment reference
  environment_oid: string // Which environment this action belongs to

  // Action specifications
  input_parameter_specifications: ParameterSpecification[]
  output_parameter_specifications: OutputParameterSpecification[]
  property_specifications: PropertySpecification[]
  action_visibility: 'opaque' | 'observable'
}
```

### 1.3 Shared Types (from Trajectory ecosystem)

These types are identical to those defined in the Trajectory MD `DataModelSpec.md`:

```typescript
interface ParameterSpecification {
  id: string
  default_value: string
  value_type: 'literal' | 'property'
  json_schema?: string
  description?: string
}

interface OutputParameterSpecification extends ParameterSpecification {
  target_property_name: string
  target_entry_name: string
}

interface PropertySpecification {
  name: string
  entries: PropertyEntrySpecification[]
}

interface PropertyEntrySpecification {
  name: string
  value: string
}

interface ResourcePropertySpecification {
  name: string
  resource_type: ResourceType
  use_limit?: number
  names?: string[]
}

type ResourceType =
  | 'binary exclusive use'
  | 'binary shared use with pool limits'
  | 'countable use with pool limits'
  | 'named pool'
  | 'sync'
```

---

## 2. Action Code Versions

User-written Python code is stored as versioned records. Each record represents a Python function for a specific action+state combination.

### 2.1 Action Code Version

```typescript
interface ActionCodeVersion {
  id: string // Auto-generated UUID
  action_oid: string // Master Action OID (immutable, from Trajectory MD)
  state: string // State name (e.g., "STARTING", "EXECUTING", "COMPLETING")
  version_number: number // Auto-incrementing per action+state (1, 2, 3, ...)
  source_code: string // Python source code
  is_active: boolean // Whether this is the active version for new instances
  created_at: string // ISO 8601 timestamp when saved
  created_by?: string // Optional author identifier (future: authentication)
  description?: string // Optional version note
}
```

### 2.2 Code Version Lifecycle

1. **Create**: When a user saves code in the management console, a new version record is created with `is_active = true`. The previous active version for the same action+state is set to `is_active = false`.
2. **Activate**: A rollback sets `is_active = true` on the selected version and `is_active = false` on the current active version.
3. **Pin at Instance Creation**: When a Runtime Action Instance is created, the engine records which code version (by `id`) is active for each state. The instance uses these pinned versions throughout its lifecycle.
4. **Delete**: Versions can be deleted through the management console. Active versions cannot be deleted — a different version must be activated first. Versions pinned by running instances cannot be deleted until those instances complete.

### 2.3 States Available for Code

Any observable or opaque state can have Python code. The developer chooses which states to write code for via the management console. Common patterns:

| State      | Typical Use                                   |
| ---------- | --------------------------------------------- |
| STARTING   | Initialization, validation, resource setup    |
| EXECUTING  | Main action logic (most common)               |
| COMPLETING | Output preparation, cleanup                   |
| PAUSING    | Save intermediate state before pause          |
| UNPAUSING  | Restore state after resume                    |
| HOLDING    | Save state when held by engine                |
| UNHOLDING  | Restore state after hold released             |
| ABORTING   | Cleanup on abort (release external resources) |
| STOPPING   | Orderly shutdown logic                        |

States without code auto-advance to the next state per the state machine transition table.

---

## 3. Runtime Action Instances

Created when a workflow client invokes an action via `POST /trajectory/v1/actions/{action_oid}/invoke`.

### 3.1 Runtime Action Instance

```typescript
interface RuntimeActionInstance {
  runtime_action_instance_id: string // Server-generated UUID
  action_oid: string // Master Action OID (immutable)
  environment_oid: string // Parent environment OID (immutable)
  workflow_instance_id: string // From invoke request
  step_instance_id: string // From invoke request
  step_oid: string // From invoke request
  visibility: 'opaque' | 'observable'

  // State machine
  state: ActionState // Current state
  state_history: StateTransition[] // Complete transition history

  // Parameters
  input_parameters: ResolvedParameter[] // From invoke request
  output_parameters: ResolvedParameter[] // Populated during execution

  // Pinned code versions
  pinned_code_versions: PinnedCodeVersion[] // Snapshot at instance creation

  // Timing
  created_at: string // ISO 8601
  started_at?: string // When STARTING began
  completed_at?: string // When terminal state reached

  // Execution metadata
  states_with_code_executed: string[] // States that actually ran Python code
  current_subprocess_pid?: number // PID of active Python subprocess (if running)
  error?: string // Error message if failed
}
```

### 3.2 Supporting Types

```typescript
interface StateTransition {
  from_state: ActionState | null
  to_state: ActionState
  timestamp: string
  triggered_by: 'engine' | 'user' | 'action_server'
  reason?: string
}

interface ResolvedParameter {
  name: string
  value: string
}

interface PinnedCodeVersion {
  state: string
  code_version_id: string // References ActionCodeVersion.id
  version_number: number
}

type ActionState =
  // Common states
  | 'IDLE'
  | 'WAITING'
  | 'COMPLETED'
  | 'ABORTED'
  | 'ABORTING'
  | 'STOPPING'
  | 'CLEARING'
  // Observable states
  | 'STARTING'
  | 'EXECUTING'
  | 'COMPLETING'
  | 'PAUSING'
  | 'PAUSED'
  | 'UNPAUSING'
  | 'HOLDING'
  | 'HELD'
  | 'UNHOLDING'
  // Opaque states
  | 'POSTED'
  | 'RECEIVED'
  | 'IN_PROGRESS'
```

### 3.3 Instance Lifecycle

1. **Created**: Invoke request received → instance created with state `STARTING` (observable) or `POSTED` (opaque)
2. **Code versions pinned**: Active code versions for all states are recorded at creation time
3. **State transitions**: Engine walks the state machine, executing pinned Python code for each state that has it
4. **Auto-advance**: States without pinned code auto-advance to the next state per the transition table
5. **Output collection**: Python code writes to the `outputs` dict; engine maps these to `output_parameters`
6. **Terminal**: Instance reaches COMPLETED, ABORTED, or STOPPED
7. **Logged**: A log entry is written to the rolling execution log
8. **Retained**: Instance record kept in active storage briefly for status queries, then eligible for cleanup

---

## 4. Execution Log

The rolling log stores completed action instance records for short-term auditing and debugging.

### 4.1 Log Entry

```typescript
interface ExecutionLogEntry {
  id: number // Auto-increment primary key
  runtime_action_instance_id: string // Instance UUID
  action_oid: string // Master Action OID
  action_name: string // Human-readable action name
  environment_oid: string // Parent environment OID
  environment_name: string // Human-readable environment name
  workflow_instance_id: string // Requesting workflow
  step_oid: string // Requesting step OID

  // Parameter snapshots (JSON strings)
  input_parameters_json: string // JSON array of ResolvedParameter
  output_parameters_json: string // JSON array of ResolvedParameter

  // Execution details
  states_executed_json: string // JSON array of StateExecutionRecord
  code_versions_used_json: string // JSON map of state → version_number

  // Timing
  started_at: string // ISO 8601
  completed_at: string // ISO 8601
  duration_ms: number // Total duration in milliseconds

  // Result
  final_status: 'COMPLETED' | 'ABORTED' | 'STOPPED'
  error?: string // Error message if aborted
}
```

### 4.2 State Execution Record

Stored within `states_executed_json`:

```typescript
interface StateExecutionRecord {
  state: string // State name
  had_code: boolean // Whether Python code was executed
  code_version_number?: number // Which version was used
  entered_at: string // ISO 8601
  exited_at: string // ISO 8601
  duration_ms: number // Time spent in this state
  error?: string // Error if code failed in this state
}
```

### 4.3 Rolling Log Mechanics

- **Max size**: Configurable via management console settings (default: 10,000 entries)
- **Rollover**: After each log insert, if `COUNT(*) > max_log_size`, the oldest entries are deleted to bring the count back to `max_log_size`
- **Purpose**: Short-term auditing and debugging of action code execution — not long-term archival
- **Queryable by**: Action name, environment, date range, final status, workflow instance ID

---

## 5. Settings

Key/value store for container configuration:

```typescript
interface Setting {
  key: string // Setting identifier
  value: string // Setting value (stringified)
  default_value: string // Factory default
  description: string // Human-readable description
  value_type: 'number' | 'string' | 'boolean' // For UI rendering
}
```

### 5.1 Default Settings

| Key                        | Default | Description                                              |
| -------------------------- | ------- | -------------------------------------------------------- |
| `log_max_size`             | `10000` | Maximum execution log entries before rollover            |
| `python_pool_size`         | `4`     | Number of Python subprocess workers                      |
| `execution_timeout_ms`     | `60000` | Default timeout for Python code execution (per state)    |
| `instance_retention_hours` | `24`    | How long completed instances are retained before cleanup |

---

## 6. Environment Action Properties at Runtime

When an action is invoked, its Python code has access to two levels of properties:

### 6.1 Environment Action Properties

Cross-cutting properties defined at the environment level that apply to ALL actions in that environment. These come from `MasterEnvironmentSpecification.action_property_specifications`.

Example:

```json
[
  {
    "name": "RetryPolicy",
    "entries": [
      { "name": "MaxRetries", "value": "3" },
      { "name": "BackoffMs", "value": "1000" }
    ]
  }
]
```

### 6.2 Action-Level Properties

Properties specific to a single action. These come from `StoredActionSpecification.property_specifications`.

Example:

```json
[
  {
    "name": "ConnectionConfig",
    "entries": [
      { "name": "Host", "value": "sensor-gateway.local" },
      { "name": "Port", "value": "8080" }
    ]
  }
]
```

Both property sets are passed to Python code as dictionaries (see `ExecutionEngineSpec.md` for the exact API).

---

## 7. OID Integrity Rules

1. Environment `oid` values come from Trajectory MD and are stored verbatim. They are NEVER generated by the Action Container.
2. Action `oid` values come from Trajectory MD (either from the `action_oid` field in `IncludedAction` or the `oid` field in `MasterActionSpecification`). They are stored verbatim and used as the primary lookup key for `POST /trajectory/v1/actions/{action_oid}/invoke`.
3. If a package is re-uploaded with the same OIDs but newer versions, the existing records are updated (version, last_modified_date, specifications) while the OIDs remain unchanged.
4. Action code versions reference `action_oid` — if an action's OID changes (new action), existing code does not carry over. Code is bound to the OID, not the human-readable name.
5. The `runtime_action_instance_id` IS generated by the Action Container (UUID v4) — this is the only server-generated identifier.
