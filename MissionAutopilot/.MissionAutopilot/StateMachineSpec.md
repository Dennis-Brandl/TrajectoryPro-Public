# Mission Autopilot — State Machine Specification

## Overview

The Action Container implements the same ISA-88 inspired state machine defined in the Trajectory ecosystem (`Trajectory Mobile — StateMachineSpec.md`). This document covers the server-side perspective: how the Action Container engine drives state transitions for Runtime Action Instances, when Python code is invoked, and how commands from workflow clients are processed.

---

## 1. State Diagram (Action Server Perspective)

The Action Container manages the **right side** of the Trajectory state model — the action instance states. It does NOT manage workflow step states (those are managed by the workflow client).

### 1.1 Observable Action Instances

```
  invoke ──► STARTING ──SC──► EXECUTING ──SC──► COMPLETING ──SC──► COMPLETED
                                  │    ▲                              ▲
                                  │    │                              │
                               PAUSE  RESUME                      CLEARING
                                  │    │                              ▲
                                  ▼    │                              │
                        PAUSING──►PAUSED                          ABORTED
                                                                     ▲
                    HOLDING──►HELD──UNHOLDING──►EXECUTING          ABORTING
                       ▲                                             ▲
                     HOLD                                          ABORT
                  (from EXECUTING)                          (from any active)

                                                  STOP ──► STOPPING ──► COMPLETED
                                                        (from any active)
```

### 1.2 Opaque Action Instances

```
  invoke ──► POSTED ──SC──► RECEIVED ──SC──► IN_PROGRESS ──SC──► COMPLETED
```

---

## 2. State Transition Table (Server-Side)

| From State  | Event          | To State    | Trigger                                   | Python Code?      |
| ----------- | -------------- | ----------- | ----------------------------------------- | ----------------- |
| —           | INVOKE         | STARTING    | Client invoke request                     | —                 |
| STARTING    | SC             | EXECUTING   | Engine: STARTING code done (or no code)   | Check STARTING    |
| EXECUTING   | SC             | COMPLETING  | Engine: EXECUTING code done (or no code)  | Check EXECUTING   |
| COMPLETING  | SC             | COMPLETED   | Engine: COMPLETING code done (or no code) | Check COMPLETING  |
| EXECUTING   | PAUSE          | PAUSING     | Client command                            | —                 |
| PAUSING     | SC             | PAUSED      | Engine: PAUSING code done (or no code)    | Check PAUSING     |
| PAUSED      | RESUME         | UNPAUSING   | Client command                            | —                 |
| UNPAUSING   | SC             | EXECUTING   | Engine: UNPAUSING code done (or no code)  | Check UNPAUSING   |
| EXECUTING   | HOLD           | HOLDING     | Engine (self-hold) or code return False   | —                 |
| HOLDING     | SC             | HELD        | Engine: HOLDING code done (or no code)    | Check HOLDING     |
| HELD        | UNHOLD         | UNHOLDING   | Engine or client command                  | —                 |
| UNHOLDING   | SC             | EXECUTING   | Engine: UNHOLDING code done (or no code)  | Check UNHOLDING   |
| Any active  | ABORT          | ABORTING    | Client command or code exception          | —                 |
| ABORTING    | SC             | ABORTED     | Engine: ABORTING code done (or no code)   | Check ABORTING    |
| ABORTED     | CLEAR          | CLEARING    | Client command                            | —                 |
| CLEARING    | SC             | COMPLETED   | Engine: CLEARING code done (or no code)   | Check CLEARING    |
| Any active  | STOP           | STOPPING    | Client command                            | —                 |
| STOPPING    | SC             | COMPLETED   | Engine: STOPPING code done (or no code)   | Check STOPPING    |
| —           | INVOKE(opaque) | POSTED      | Client invoke request                     | —                 |
| POSTED      | SC             | RECEIVED    | Engine: immediate                         | No                |
| RECEIVED    | SC             | IN_PROGRESS | Engine: begin execution                   | Check IN_PROGRESS |
| IN_PROGRESS | SC             | COMPLETED   | Engine: code done (or no code)            | Check IN_PROGRESS |

**"Check STATE"** means: look up pinned code version for this state → if code exists, execute it → use return value; if no code, auto-advance.

**"Any active"** = STARTING, EXECUTING, COMPLETING, PAUSING, PAUSED, UNPAUSING, HOLDING, HELD, UNHOLDING, POSTED, RECEIVED, IN_PROGRESS.

---

## 3. State Entry Processing

When the state machine enters a new state, the engine performs these steps:

```
Enter state S
    │
    ├── 1. Update instance.state = S
    ├── 2. Append to instance.state_history
    ├── 3. Persist to SQLite
    ├── 4. Emit SSE state_change event (if observable)
    │
    ├── 5. Look up pinned code version for state S
    │      │
    │      ├── No code found:
    │      │   └── Trigger auto-advance (SC event → next state)
    │      │
    │      └── Code found:
    │          ├── Acquire Python worker from pool
    │          ├── Send execution request (inputs, outputs, props)
    │          ├── Wait for response (with timeout)
    │          │
    │          ├── Success (return True):
    │          │   └── Trigger auto-advance (SC event → next state)
    │          │
    │          ├── Success (return False):
    │          │   └── Stay in current state (no auto-advance)
    │          │       Engine will re-execute code when state is
    │          │       re-entered (e.g., after HOLD → UNHOLD cycle)
    │          │
    │          └── Exception raised:
    │              ├── Record error on instance
    │              └── Trigger ABORT (→ ABORTING → ABORTED)
    │
    └── 6. If state is terminal (COMPLETED, ABORTED):
           ├── Write execution log entry
           ├── Close SSE connections
           └── Release Python worker
```

---

## 4. Command Processing

When a state command arrives (from `POST /trajectory/v1/instances/:id/command` or management console):

```
Receive command C for instance I
    │
    ├── 1. Validate: Is C valid for current state?
    │      (Use transition table above)
    │      │
    │      ├── Invalid: Return 409 INVALID_STATE_TRANSITION
    │      │
    │      └── Valid: Continue
    │
    ├── 2. If Python code is currently executing:
    │      │
    │      ├── PAUSE: Set flag, let current code finish,
    │      │          then transition EXECUTING → PAUSING → PAUSED
    │      │
    │      ├── ABORT: Kill Python subprocess immediately,
    │      │          transition to ABORTING
    │      │
    │      └── STOP: Kill Python subprocess immediately,
    │                transition to STOPPING
    │
    ├── 3. If no code is running:
    │      └── Transition immediately to the target state
    │
    └── 4. Return command accepted response
```

---

## 5. Hold Semantics (Server-Side)

In the Action Container, HOLD has two triggers:

### 5.1 Code-Initiated Hold

When action code returns `False` from the EXECUTING state handler:

```python
def execute(inputs, outputs, props, action_props):
    # Check external condition
    if not sensor_ready():
        return False  # Stay in EXECUTING → engine triggers HOLD
    # ... do work ...
    return True
```

The engine interprets `return False` in EXECUTING as: "I can't proceed yet." This triggers EXECUTING → HOLDING → HELD. The engine will periodically re-check (or the management console can send UNHOLD).

### 5.2 API-Initiated Hold

A workflow client or the management console sends `HOLD` command:

```json
POST /instances/{id}/command
{ "command": "HOLD", "issued_by": "engine", "reason": "Resource contention" }
```

### 5.3 Unhold and Re-execution

When UNHOLD is received (from client or management console):

1. HELD → UNHOLDING
2. If UNHOLDING has code, execute it (restore state)
3. UNHOLDING → EXECUTING
4. Re-execute EXECUTING code (the code should check the condition again)

---

## 6. Opaque Action Processing

Opaque actions have a simplified flow:

```
INVOKE
  ├── Create instance (state: POSTED)
  ├── Return 201 to client
  │
  ├── Auto-advance: POSTED → RECEIVED
  ├── Auto-advance: RECEIVED → IN_PROGRESS
  │
  ├── Check code for IN_PROGRESS
  │   ├── Code exists: execute it
  │   └── No code: auto-advance
  │
  └── IN_PROGRESS → COMPLETED
```

Opaque actions do not support PAUSE/RESUME or HOLD/UNHOLD. They support ABORT and STOP only.

---

## 7. Concurrent Instance State Machines

Each Runtime Action Instance has its own independent state machine. The engine manages them concurrently:

- State transitions are atomic (SQLite transaction per transition)
- No cross-instance dependencies (one instance's HOLD doesn't affect others)
- Python pool provides concurrency (one worker per active code execution)
- SSE connections are per-instance (one EventSource per observable instance)

---

## 8. Terminal State Handling

When an instance reaches a terminal state:

| Terminal State | Trigger                                                     | Action                                                    |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| COMPLETED      | Successful completion of COMPLETING (or STOPPING, CLEARING) | Write log entry, emit final SSE events, close SSE         |
| ABORTED        | ABORT command or code exception → ABORTING → ABORTED        | Write log entry, emit error + state_change SSE, close SSE |

After reaching a terminal state:

- The instance remains queryable via `GET /instances/{id}` for `instance_retention_hours`
- A log entry is written to the rolling execution log
- SSE connections are closed with a final state_change event
- The Python worker is released back to the pool
