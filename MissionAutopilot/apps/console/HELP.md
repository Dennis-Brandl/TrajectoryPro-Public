# Mission Autopilot Help Guide

Mission Autopilot stores and runs the **Actions** that Trajectory workflows call. Actions are written in **Python** and run in a sandbox. This console is the web UI for managing the container — importing environments, writing and testing action code, and monitoring executions.

> **PLEASE NOTE:** Trajectory is a demonstration system, not intended for production environments. The editor and runtime are single-user systems and do not have the security necessary for production use. We recommend loading the applications into a Docker container for your testing.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Environments and Actions](#2-environments-and-actions)
3. [Writing Action Code](#3-writing-action-code)
4. [Testing Code](#4-testing-code)
5. [Instances](#5-instances)
6. [Execution Log](#6-execution-log)
7. [Settings](#7-settings)
8. [Connecting a Workflow to Mission Autopilot](#8-connecting-a-workflow-to-mission-autopilot)

---

## 1. Getting Started

The console has a top navigation bar and a left activity bar:

- **Top bar** — **Dashboard** (system overview), **Log** (execution history), **Settings** (configuration). **Server** shows the browser-reachable REST URL; **Mission Commander address** (fleet installs only) shows the address the Mission Engine and Mission Commander must use — copy that one into the Mission Commander.
- **Activity bar** (left icons) — **Explorer** (browse environments and actions), **Instances** (running executions), **Search**.

**Signing in.** The console asks for the API key when it opens. The key is `ACTIONS_API_KEY` in the `.env` file next to `docker-compose.yml`. It is kept only for the current browser tab; use **Sign out** in the top bar to forget it. The key can no longer be changed from the Settings page.

Start on the **Dashboard** for an at-a-glance view, then use the Explorer to drill into your environments and actions.

---

## 2. Environments and Actions

The container is organized into **Environments**, each bundling a set of **Actions**. These are the same environments a workflow links to in Mission Designer.

- **Import:** on the **Environments** page click **Upload Package** and choose a `.WFenvirX` (zipped), `.WFenvirBundleX` (the file **Export Envir Package** produces), `.WFenvir`, or `.WFaction` file. The import report lists what was created or updated.
- **Re-import:** uploading an environment again never wipes state code. The environment itself is matched by OID, then by name (Mission Designer assigns a new OID to the environment after **Create New Version** on it; when the name is unique the stored environment is re-keyed and everything follows; workflow packages exported against the previous environment version still pin its old OID, so re-export them from Mission Designer afterwards). Actions are matched by OID first, then by name inside the environment (same rule for an action's own new version), and the existing code, versions and timeout follow the action. The import report lists what was re-keyed, kept, flagged or removed. Two things can be flagged on the **Environment** page's action list and on the **Action** page:
  - **Signature changed** — the imported inputs or outputs differ from the signature the code was written against. The note lists each change (added, removed, or retyped parameter). Fix the code, then click **Mark resolved**.
  - **Not in last import** — the action was removed from the environment in Mission Designer but still has code (or a running instance), so it was kept. Use **Delete** on the note when it is no longer needed; an action without code is removed automatically.
  - Note that Action Property **values** edited in the console are still replaced by the package's values on re-import; re-apply them afterwards.
- **Browse:** the **Explorer** panel shows a tree of environments and their actions.
- **Environment detail** lists each action with its visibility (**observable** or **opaque**) and input/output counts, plus a code-status badge for each state.
- **Action Properties** appear on both pages: the **Environment** page holds properties shared by every action in the environment; each **Action** page holds that action's own. Both are available to state code — see [The `execute` function: inputs, outputs, and properties](#the-execute-function-inputs-outputs-and-properties).

---

## 3. Writing Action Code

Open the **Code Editor** and choose an **Environment → Action → State**, then write Python in the editor.

An action's behavior is defined **per state** of its lifecycle: _observable_ actions expose many states (STARTING, EXECUTING, COMPLETING, …); _opaque_ actions expose a few (POSTED, RECEIVED, IN_PROGRESS, …). Code-status badges show which states already have code.

- **Save Version** stores a snapshot of the code, with an optional description.
- **Version History** lets you view earlier versions (read-only) and restore one to keep editing.
- On an action's detail page you can **Export Code** / **Import Code** (`.WFactionCode`) and **Clear Code** for a state (irreversible).

### The `execute` function: inputs, outputs, and properties

Every state's code must define one function:

```python
def execute(inputs, outputs, props, action_props):
    ...
    return True
```

- **`inputs`** — a `dict` of the action's input parameters for this invocation (parameter name → string value).
- **`outputs`** — a `dict` the code fills in; its keys become the action's output parameters. It arrives pre-loaded with whatever earlier states of the same instance already wrote.
- **`props`** — the environment's **Action Properties** (the Action Properties card on the Environment page), shared by every action in the environment.
- **`action_props`** — this action's own **Action Properties** (the card on the Action page) — read-only configuration for this one action.

Both cards have an **Edit** button: change any values, then **Save** — only the values you changed are written. Names, entries and properties themselves come from Mission Designer and cannot be added or removed here, and re-uploading the environment package restores Mission Designer's values.

Both property dicts have the same two-level shape — **property name → entry name → value** — and every value is a string:

```python
def execute(inputs, outputs, props, action_props):
    host = props["Config"]["Host"]                            # environment-level property
    mode = action_props.get("Setting", {}).get("Value", "")  # this action's property
    outputs["endpoint"] = f"http://{host}"
    return True
```

(`props` and `action_props` are also available as the globals `properties` and `action_properties`.) When you create a state, the code editor's template lists the action's own properties as `action_props['…']['…']` comments.

**Properties are shared across invocations — they are not per-invoke.** Both sets are read from the database at the start of **every** state execution, so code always sees the current stored values, not a snapshot taken when the action was invoked.

- **Environment-level properties can be changed from code** with the global `set_property(property_name, entry_name, value)` (all three arguments must be strings). The change takes effect immediately inside the current `execute` call and is persisted when the state returns — on success or failure — so the next state of the same instance, later invocations of the action, and every other action in the same environment all see it, and the Environment page shows the new value. An unknown property name is an execution error (`PROPERTY_WRITE_ERROR`, the action aborts); an unknown entry name is created. Use this for state that must survive across invocations — counters, flags, last-seen values. A value edited on the Environment page reaches running code the same way: at its next state execution.
- **Per-action properties are read-only from code.** Assigning into `action_props` only changes the local dict for that call; use **Edit** on the Action page's Action Properties card to change them.

> A caller can pass per-invoke **action property overrides** (a testing aid). They are merged into `props` for that one instance only and are never persisted.

### Coordinating state transitions from code

The Python code in each state can do more than process inputs and write outputs — it can also signal the next state transition. Three signals are available without any imports:

- **Return `True`** (or any non-`False` value, or no return at all) — the state's work is done; the container advances to the next state in the lifecycle (the **SC** transition).
- **Return `False` from EXECUTING** — code-initiated **HOLD**: the container moves through HOLDING into HELD, and waits there until an **Unhold** signal arrives.
- **Raise any exception** — code-initiated **ABORT**: the error summary and traceback are recorded on the instance and the container moves through ABORTING into ABORTED. A state whose code fails is not run again: the instance goes to Aborted with the error. Running it again is up to you.

In addition, code in any active state can call `trajectory.request_command("...")` to request one of these commands after the current execution returns:

| Command  | Effect                                                      | Valid from        |
| -------- | ----------------------------------------------------------- | ----------------- |
| `HOLD`   | Hold the action (same destination as returning `False`).    | Any active state. |
| `UNHOLD` | Release a held action — next state EXECUTING.               | HELD only.        |
| `PAUSE`  | Pause the action so an operator can resume it later.        | EXECUTING only.   |
| `STOP`   | Stop the action cleanly — next state COMPLETED.             | Any active state. |
| `ABORT`  | Abort the action without an exception — next state ABORTED. | Any active state. |

A requested command that isn't valid for the current state is reported as an execution error and the action transitions to ABORTING.

#### Example: holding for a downstream queue

A common reason to hold an action is throttling against a downstream resource. A packer station, for example, may need to stop feeding a downstream wrapper whose buffer is full, then resume once the wrapper has caught up. The action defines code in four states; the container drives the cycle **EXECUTING → HOLDING → HELD → UNHOLDING → EXECUTING** and repeats it every time EXECUTING returns `False`.

**EXECUTING** — runs the normal operation; if downstream is full, ask to hold:

```python
def execute(inputs, outputs, props, action_props):
    if downstream_queue_full(props):
        return False              # code-initiated HOLD
    feed_one_item(inputs, props)
    return True                    # SC -> COMPLETING when the batch is done
```

**HOLDING** — runs once on the way into HELD; bring the machine to a safe stopped state:

```python
def execute(inputs, outputs, props, action_props):
    stop_feed_motor(props)
    wait_until_machine_idle(props)
    return True                    # SC -> HELD
```

**HELD** — polls for the downstream queue to drain, then asks to unhold:

```python
def execute(inputs, outputs, props, action_props):
    wait_until_downstream_available(props)
    trajectory.request_command("UNHOLD")
    return True                    # container moves HELD -> UNHOLDING
```

**UNHOLDING** — runs once on the way back to EXECUTING; restart the machine:

```python
def execute(inputs, outputs, props, action_props):
    start_feed_motor(props)
    return True                    # SC -> EXECUTING; the EXECUTING code re-checks the queue
```

An operator can still take over from outside: the Instances page exposes **Unhold** (to release the hold manually), **Abort**, and **Stop**, all of which override what the action's own code is doing.

---

## 4. Testing Code

Click **Test Code** to open the test panel, fill in the action's input parameters, and click **Run Test**. The result shows a success/failure badge, execution time, the return value, an outputs table, and the captured **stdout / stderr** — a dry run without needing a workflow. If the code fails, the result shows the error and whatever the code printed before it failed.

---

## 5. Instances

The **Instances** page lists executions in two tabs — **Active** (running) and **History** (finished). Open an instance to see:

- its **current state** with a color indicator,
- a **state timeline** of transitions and how long each took,
- the **input and output parameters**, and
- the **pinned code versions** the run used.

For observable actions, the detail view offers state-appropriate commands: **Pause**, **Resume**, **Abort**, **Stop**, **Unhold**.

---

## 6. Execution Log

The **Log** page records completed executions. Filter by action, environment, status (Completed / Aborted / Stopped), and date range; click a row to expand its inputs, outputs, and the states it executed.

---

## 7. Settings

The **Settings** page configures the container:

- **Max Log Entries** — how many execution records to keep.
- **Python Pool Size** — number of sandbox worker processes.
- **Execution Timeout** — per-state time limit in seconds (0 disables it).
- **Instance Retention** — hours to keep completed instance records.

Use **Save Changes** to apply, or **Reset to Defaults**. The page also shows read-only container info: version, uptime, and the current Python worker pool.

---

## 8. Connecting a Workflow to Mission Autopilot

Workflow steps called **Environment Actions** run here, not in the runtime. To wire a workflow to this container, point it at the container's REST address — for example `http://localhost:3002`:

- In **Mission Designer**, register the address as an action server on the workflow's environment, or
- have an administrator bind the address to the environment for a work center in **Mission Commander**.

When a workflow reaches an Environment Action, the runtime calls this container, which runs the Python code you wrote and returns the outputs.
