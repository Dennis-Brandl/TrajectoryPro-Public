# Mission Autopilot — Management Console Specification

## Overview

The Management Console is a React SPA served by the Action Container at `/console/`. It provides a browser-based UI for managing environments, editing action code, monitoring instances, viewing execution logs, and configuring container settings.

---

## 1. Technology Stack

| Component   | Technology                                    |
| ----------- | --------------------------------------------- |
| Framework   | React 19.x                                    |
| Build Tool  | Vite 6.x                                      |
| Language    | TypeScript 5.x                                |
| Code Editor | Monaco Editor (@monaco-editor/react)          |
| Routing     | React Router v7                               |
| HTTP Client | fetch (native)                                |
| Styling     | Tailwind CSS or CSS Modules                   |
| State       | React Query (TanStack Query) for server state |

---

## 2. Navigation Structure

Sidebar navigation with the following pages:

```
┌────────────────┐
│  Dashboard      │  ← /console/
├────────────────┤
│  Environments   │  ← /console/environments
├────────────────┤
│  Code Editor    │  ← /console/code
├────────────────┤
│  Instances      │  ← /console/instances
├────────────────┤
│  Execution Log  │  ← /console/log
├────────────────┤
│  Settings       │  ← /console/settings
└────────────────┘
```

---

## 3. Page Specifications

### 3.1 Dashboard Page (`/console/`)

**Purpose**: At-a-glance container health and activity summary.

**Layout**:

```
┌─────────────────────────────────────────────┐
│  Mission Autopilot                          │
├──────────┬──────────┬──────────┬────────────┤
│ Uptime   │ Python   │ Active   │ Log        │
│ 2d 4h    │ Pool 3/4 │ Inst. 2  │ 4823/10000 │
├──────────┴──────────┴──────────┴────────────┤
│  Recent Activity                             │
│  ┌────┬──────────┬───────┬────────┬───────┐ │
│  │ ID │ Action   │ Env   │ Status │ Time  │ │
│  ├────┼──────────┼───────┼────────┼───────┤ │
│  │ .. │ HeatOven │ Kitch.│ ✓ DONE │ 2.4s  │ │
│  │ .. │ MixBowl  │ Kitch.│ ✓ DONE │ 0.8s  │ │
│  └────┴──────────┴───────┴────────┴───────┘ │
└─────────────────────────────────────────────┘
```

**Components**:

- Status cards: Uptime, Python pool (idle/busy), Active instances, Log usage (current/max)
- Recent activity table: Last 10 log entries with action name, environment, status, duration
- Auto-refresh every 5 seconds

---

### 3.2 Environments Page (`/console/environments`)

**Purpose**: View downloaded environments and their actions. Upload new packages.

**Layout — List View**:

```
┌─────────────────────────────────────────────┐
│  Environments              [Upload Package]  │
├─────────────────────────────────────────────┤
│  ┌───────────────────────────────────────┐   │
│  │ KitchenEnvironment  v1.0.0            │   │
│  │ OID: env-001-snowflake                │   │
│  │ 5 actions │ Imported: Feb 21, 2026    │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │ FactoryFloor  v2.1.0                  │   │
│  │ OID: env-002-snowflake                │   │
│  │ 8 actions │ Imported: Feb 22, 2026    │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**Upload Dialog**:

- Drag-and-drop zone or file picker
- Accepts `.WFenvir` and `.WFaction` files
- Shows import results: created/updated environments and actions
- Error display for failed imports

**Layout — Environment Detail** (`/console/environments/:oid`):

```
┌─────────────────────────────────────────────┐
│  ← Back │ KitchenEnvironment  v1.0.0        │
│  OID: env-001-snowflake                      │
│  Imported: Feb 21, 2026 from KitchenEnv.WFenvir│
├─────────────────────────────────────────────┤
│  Action Properties (Environment-wide)        │
│  ┌──────────────┬────────────────────────┐   │
│  │ RetryPolicy  │ MaxRetries: 3          │   │
│  │              │ BackoffMs: 1000        │   │
│  └──────────────┴────────────────────────┘   │
├─────────────────────────────────────────────┤
│  Value Properties                            │
│  ┌──────────────────┬────────────────────┐   │
│  │ CurrentTemperature│ Value: 0          │   │
│  └──────────────────┴────────────────────┘   │
├─────────────────────────────────────────────┤
│  Resource Properties                         │
│  ┌───────────┬──────────────────────────┐    │
│  │ OvenAccess│ binary exclusive use      │    │
│  └───────────┴──────────────────────────┘    │
├─────────────────────────────────────────────┤
│  Actions (5)                                 │
│  ┌───────────┬──────┬─────────┬──────────┐  │
│  │ Name      │ Vis. │ In/Out  │ Code     │  │
│  ├───────────┼──────┼─────────┼──────────┤  │
│  │ HeatOven  │ obs. │ 2 / 1   │ 2 states │  │
│  │ CoolOven  │ obs. │ 1 / 1   │ 1 state  │  │
│  │ CheckTemp │ opq. │ 0 / 1   │ 0 states │  │
│  └───────────┴──────┴─────────┴──────────┘  │
└─────────────────────────────────────────────┘
```

**Layout — Action Detail** (`/console/environments/:oid/actions/:action_oid`):

```
┌─────────────────────────────────────────────┐
│  ← Back │ HeatOven  v1.0.0  (observable)    │
│  OID: act-001-snowflake                      │
│  Environment: KitchenEnvironment             │
├─────────────────────────────────────────────┤
│  Input Parameters                            │
│  ┌─────────────────┬──────────┬────────────┐│
│  │ Name            │ Default  │ Type       ││
│  ├─────────────────┼──────────┼────────────┤│
│  │ target_temp     │ 200      │ literal    ││
│  │ recipe_name     │ ""       │ literal    ││
│  └─────────────────┴──────────┴────────────┘│
├─────────────────────────────────────────────┤
│  Output Parameters                           │
│  ┌─────────────────┬──────────────────────┐  │
│  │ Name            │ Target Property      │  │
│  ├─────────────────┼──────────────────────┤  │
│  │ actual_temp     │ CurrentTemperature   │  │
│  └─────────────────┴──────────────────────┘  │
├─────────────────────────────────────────────┤
│  Action Properties                           │
│  ┌──────────────────┬────────────────────┐   │
│  │ ConnectionConfig │ Host: sensor.local │   │
│  │                  │ Port: 8080         │   │
│  └──────────────────┴────────────────────┘   │
├─────────────────────────────────────────────┤
│  Code Status                                 │
│  STARTING:   v2 (active)  [Edit]             │
│  EXECUTING:  v3 (active)  [Edit]             │
│  COMPLETING: no code      [Add Code]         │
│                           [Open in Editor]   │
└─────────────────────────────────────────────┘
```

---

### 3.3 Code Editor Page (`/console/code`)

**Purpose**: Write and manage Python code for action states.

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  Code Editor                                         │
├──────────────┬──────────────────────────────────────┤
│  Environment │  ┌────────────────────────────────┐  │
│  [dropdown]  │  │                                │  │
│              │  │     Monaco Editor               │  │
│  Action      │  │     (Python syntax)             │  │
│  [dropdown]  │  │                                │  │
│              │  │  def execute(inputs, outputs,   │  │
│  State       │  │      props, action_props):      │  │
│  [dropdown]  │  │      target = float(            │  │
│              │  │          inputs["target_temp"])  │  │
│  Version     │  │      outputs["result"] = "ok"   │  │
│  [v3 active] │  │      return True                │  │
│  [v2]        │  │                                │  │
│  [v1]        │  │                                │  │
│              │  └────────────────────────────────┘  │
│  [Save]      │  ┌────────────────────────────────┐  │
│  [Test]      │  │  Test Results / Output          │  │
│  [Rollback]  │  │  > success: true                │  │
│              │  │  > outputs: { result: "ok" }    │  │
│              │  │  > time: 45ms                    │  │
│              │  └────────────────────────────────┘  │
└──────────────┴──────────────────────────────────────┘
```

**Features**:

- **Left panel**: Environment → Action → State selector dropdowns. Version history list.
- **Editor**: Monaco editor with Python syntax highlighting. Loads the active code version by default.
- **Save**: Creates a new version, makes it active. Version description field in save dialog.
- **Test**: Opens a test panel below the editor. User provides test input values (pre-populated from the action's input parameter defaults). Executes the code via `/management/v1/code/:oid/:state/test` and shows results.
- **Version history**: Click a version to load it in the editor (read-only until "Edit this version" is clicked). Active version shown with a badge.
- **Rollback**: Activates a previous version for new instances.
- **Template**: When no code exists for a state, the editor shows a template:

```python
def execute(inputs, outputs, props, action_props):
    """
    State handler for {action_name} — {state}

    Available inputs: {input_names}
    Available props: {prop_names}
    Available action_props: {action_prop_names}

    Write to outputs dict to set output parameters.
    Return True to advance to next state, False to stay.
    """
    return True
```

---

### 3.4 Instances Page (`/console/instances`)

**Purpose**: Monitor active and recently completed action instances.

**Layout — List View**:

```
┌─────────────────────────────────────────────────────┐
│  Action Instances                [Auto-refresh: ON]  │
├─────────────────────────────────────────────────────┤
│  Filters: [Environment ▾] [Action ▾] [Status ▾]     │
├────┬──────────┬───────┬────────────┬────────┬───────┤
│ ID │ Action   │ Env   │ State      │ Since  │       │
├────┼──────────┼───────┼────────────┼────────┼───────┤
│ .. │ HeatOven │ Kitch │ ●EXECUTING │ 15s    │ [▶]   │
│ .. │ MixBowl  │ Kitch │ ●STARTING  │ 2s     │ [▶]   │
│ .. │ CheckTemp│ Kitch │ ✓COMPLETED │ —      │ [▶]   │
└────┴──────────┴───────┴────────────┴────────┴───────┘
```

State indicators: colored dot (green = running, yellow = paused/held, red = aborting, gray = completed)

**Layout — Instance Detail** (`/console/instances/:id`):

```
┌─────────────────────────────────────────────┐
│  ← Back │ Instance rai-uuid-1               │
│  Action: HeatOven (observable)               │
│  Environment: KitchenEnvironment             │
│  Workflow: wf-uuid │ Step: step-001          │
├─────────────────────────────────────────────┤
│  Current State: EXECUTING                    │
│  Commands: [Pause] [Abort] [Stop]            │
├─────────────────────────────────────────────┤
│  State Timeline                              │
│  ● STARTING  10:31:00  → 10:31:02 (2s)      │
│  ● EXECUTING 10:31:02  → running... (15s)    │
│  ○ COMPLETING                                │
│  ○ COMPLETED                                 │
├─────────────────────────────────────────────┤
│  Input Parameters                            │
│  target_temperature: 200                     │
│  recipe_name: Bolognese Sauce                │
├─────────────────────────────────────────────┤
│  Output Parameters                           │
│  (not yet available)                         │
├─────────────────────────────────────────────┤
│  Pinned Code Versions                        │
│  STARTING:  v2                               │
│  EXECUTING: v3                               │
└─────────────────────────────────────────────┘
```

Auto-refreshes every 2 seconds for active instances.

---

### 3.5 Execution Log Page (`/console/log`)

**Purpose**: Browse the rolling execution log for auditing and debugging.

**Layout**:

```
┌─────────────────────────────────────────────────────┐
│  Execution Log                  4823 / 10000 entries │
├─────────────────────────────────────────────────────┤
│  Filters: [Action ▾] [Env ▾] [Status ▾] [Date ▾]   │
├────┬──────────┬───────┬────────┬────────┬───────────┤
│ #  │ Action   │ Env   │ Status │ Dur.   │ Completed │
├────┼──────────┼───────┼────────┼────────┼───────────┤
│4823│ HeatOven │ Kitch │ ✓ OK   │ 4.0m   │ 10:35 AM  │
│4822│ MixBowl  │ Kitch │ ✓ OK   │ 0.8s   │ 10:34 AM  │
│4821│ HeatOven │ Kitch │ ✗ ABORT│ 1.2s   │ 10:30 AM  │
├────┴──────────┴───────┴────────┴────────┴───────────┤
│  Page 1 of 97  [◄ Prev]  [Next ►]                   │
└─────────────────────────────────────────────────────┘
```

**Log Entry Detail** (click a row to expand or navigate):

```
┌─────────────────────────────────────────────┐
│  Log Entry #4823                             │
│  Instance: rai-uuid-1                        │
│  Action: HeatOven │ Env: KitchenEnvironment  │
├─────────────────────────────────────────────┤
│  Input Parameters                            │
│  target_temperature: 200                     │
│  recipe_name: Bolognese Sauce                │
├─────────────────────────────────────────────┤
│  States Executed (with code)                 │
│  STARTING  v2  10:31:00 → 10:31:02  (2s)    │
│  EXECUTING v3  10:31:02 → 10:34:50  (3m48s) │
├─────────────────────────────────────────────┤
│  Output Parameters                           │
│  actual_temperature: 198.5                   │
│  status_message: Oven heated successfully    │
├─────────────────────────────────────────────┤
│  Started: 10:31:00 │ Completed: 10:35:00     │
│  Duration: 4m 0s │ Status: COMPLETED         │
└─────────────────────────────────────────────┘
```

---

### 3.6 Settings Page (`/console/settings`)

**Purpose**: Configure container behavior.

**Layout**:

```
┌─────────────────────────────────────────────┐
│  Settings                                    │
├─────────────────────────────────────────────┤
│  Execution Log                               │
│  Max entries: [10000    ] (current: 4823)     │
│                                              │
│  Python Execution                            │
│  Pool size:  [4         ] workers             │
│  Timeout:    [60000     ] ms per state        │
│                                              │
│  Instance Retention                          │
│  Retain for: [24        ] hours               │
│                                              │
│  [Save Changes]  [Reset to Defaults]         │
├─────────────────────────────────────────────┤
│  Container Info                              │
│  Version: 1.0.0                              │
│  Uptime: 2 days, 4 hours                     │
│  Database size: 45 MB                        │
│  Python version: 3.12.1                      │
│  Node.js version: 20.11.0                    │
└─────────────────────────────────────────────┘
```

---

## 4. Responsive Design

The console is designed for desktop browser use (the primary use case for server administration). Minimum supported width: 1024px. The sidebar collapses to an icon-only rail at narrow widths.

---

## 5. Real-Time Updates

- **Dashboard**: Polls `/management/v1/dashboard` every 5 seconds
- **Instances list**: Polls `/management/v1/instances` every 2 seconds
- **Instance detail**: Polls `/management/v1/instances/:id` every 2 seconds
- **Log**: Manual refresh (no auto-refresh needed for historical data)

Future enhancement: WebSocket connection for push-based updates.
