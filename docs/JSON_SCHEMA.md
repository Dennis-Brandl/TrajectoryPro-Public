# Trajectory — JSON Schema & Package Format Reference

> **⚠️ The tool names in this document are a MIX of current and retired
> applications.** The 2026-09-09 rebrand renamed the Action Tester to **Mission
> Autopilot Tester** throughout, but this document's owner and support tables also
> name **Trajectory Editor**, **Trajectory Runtime** and **Trajectory Action
> Container** — applications that no longer exist in this form, and whose source
> paths in §18 point at repositories removed in `81965a0`. The FORMAT definitions
> below (schemas, `.WF*` layouts, `schemaVersion`) remain authoritative and are
> deliberately unchanged; only the producer/consumer attributions are stale. The current
> application list is in the [README](../README.md). This document needs a rewrite of its tool attributions; it has not had one.

**Audience.** Implementers of new Trajectory tools: alternative editors, alternative runtimes, alternative action containers, third-party importers/exporters, conformance test harnesses.

**Scope.** This document defines (a) the complete JSON object schemas the Trajectory product family exchanges and (b) the ZIP bundle layouts that carry them between tools. It is the single source of truth for *what to write to disk* and *what to read from disk*. The runtime protocol used at execution time is in [REST_Protocol.md](./REST_Protocol.md).

**Status.** Schema version: **4.0** (current; v7.0 package format). Backward-compatible with 3.0. 2.0 and earlier are rejected.

**Owners.**

| Tool | Role |
|------|------|
| **Trajectory Editor** | Authoring. Source of truth for `.WFmaster*`, `.WFlibX`, `.WFslibX`, and the canonical `.WFenvir` / `.WFaction` JSON shapes. |
| **Trajectory Runtime** | Execution. Consumer of `.WFmaster` and `.WFmasterX` only. Never writes packages. |
| **Trajectory Action Container** (TrajectoryActions) | Action hosting. Consumer of `.WFenvir*` and `.WFaction*` family. Producer of `.WFenvirX`, `.WFenvirBundleX`, `.WFactionCode(X)`, `.WFsnapshot`. |
| **Mission Autopilot Tester** | Conformance test harness. Uploads existing `.WFenvir*` / `.WFaction*` packages to a target Action Container, then drives them through the REST protocol. Does not write packages. |

A full per-tool support matrix is in §3.

---

## Conventions

These apply to every JSON object in this document.

| Item | Rule |
|------|------|
| JSON Schema dialect | Draft-07 for the published `$ref`'d schemas. The runtime validator uses Draft 2020-12 internally; the two are interoperable for these shapes. |
| Encoding | UTF-8, no BOM. |
| String IDs (`oid`) | Snowflake-style 64-bit numeric strings. Treated as opaque by every tool except the issuer — never parse, never reformat. Dashes are tolerated; UUID-with-dashes forms are accepted by the Runtime loader. |
| Timestamps | ISO 8601 UTC with millisecond precision (`2026-04-24T12:34:56.789Z`). |
| Semver (`version`) | Standard `MAJOR.MINOR.PATCH`. Defaults to `"1.0.0"` when absent at the root. |
| Permanent enum keys | `step_type`, form-element `type`, `command_type`, `resource_type` — never rename after deployment. Whitespace/case is literal. |
| Unknown fields | Forward-compatible. Implementations MUST ignore unknown top-level fields rather than fail. |
| Empty arrays | Always permitted unless a field is marked **required**. Prefer empty arrays over omission for round-trip stability. |

---

# Part 1 — Complete JSON Definitions

## 1.1 ManagedElement (base type)

Every entity that can appear on disk (libraries, specifications, steps, child workflows) inherits from this base.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://saturnis.io/schemas/managed-element.json",
  "title": "Managed Workflow Element",
  "type": "object",
  "required": ["local_id", "oid", "version", "last_modified_date"],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": ["3.0", "4.0"],
      "description": "Trajectory workflow schema version. '4.0' is the current format (v7.0 packages); '3.0' is accepted for backward compatibility. Required on root exports."
    },
    "local_id":           { "type": "string", "description": "Human-readable name (e.g., 'Check Pressure')." },
    "oid":                { "type": "string", "description": "Snowflake ID. Stable across export/import." },
    "description":        { "type": "string" },
    "version":            { "type": "string", "description": "Semantic version string (e.g., '1.0.0')." },
    "last_modified_date": { "type": "string", "format": "date-time" }
  }
}
```

**Implementer notes.**
- On a root document (a workflow spec, env library, action library), `schemaVersion` SHOULD be present and SHOULD equal `"4.0"`. Absent root `schemaVersion` is accepted; values below `"3.0"` are rejected.
- On nested children (steps, included actions), `schemaVersion` is not required.

## 1.2 MasterWorkflowLibrary

A library that wraps one or more root workflows. Editor-native; runtime ingests via the `.WFlibX` import path but does not store libraries — it extracts each root into a `.WFmasterX`.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://saturnis.io/schemas/master-workflow-library.json",
  "title": "Master Workflow Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["workflow_specifications"],
  "properties": {
    "workflow_specifications": {
      "type": "array",
      "items": { "$ref": "#/definitions/workflow_specification" }
    },
    "child_libraries": {
      "type": "array",
      "description": "Nested child libraries (rare; reserved).",
      "items": { "$ref": "#" }
    }
  }
}
```

The full definition of `workflow_specification` (the root workflow shape) is in §1.3. Step / connection / parameter sub-shapes are in §1.5 – §1.7. Form layout is in §1.12.

## 1.3 MasterWorkflowSpecification (root)

The top level of every `.WFmaster` file. Exactly one per `.WFmasterX` package.

```json
{
  "schemaVersion": "4.0",
  "local_id":           "Test Loops and Scripts",
  "oid":                "454cf22190644b5f8bd1c68f825cfd0c",
  "description":        "Demo workflow with loops and SCRIPT steps.",
  "version":            "1.0.0",
  "state":              "Draft",
  "last_modified_date": "2026-04-24T12:34:56.789Z",
  "display_style":      "flowchart",
  "viewport":           { "x": 0, "y": 0, "zoom": 1 },

  "steps":       [ /* §1.5 */ ],
  "connections": [ /* §1.6 */ ],

  "starting_parameter_specifications": [ /* §1.7.1 */ ],
  "output_parameter_specifications":   [ /* §1.7.2 */ ],
  "value_property_specifications":     [ /* §1.7.3 */ ],
  "resource_property_specifications":  [ /* §1.7.4 */ ],
  "resource_command_specifications":   [ /* §1.7.5 */ ],
  "environment_specifications":        [ /* §1.8 */ ],

  "children":        [ /* §1.4  — v7.0 preferred */ ],
  "child_workflows": [ /* §1.4  — deprecated v6.0 fallback */ ]
}
```

### Required (root)

| Field | Type | Notes |
|-------|------|-------|
| `local_id` | string | Non-empty. |
| `oid` | string | Opaque Snowflake/UUID. |
| `version` | string | Semver. Optional at root — defaults to `"1.0.0"` if missing. |
| `last_modified_date` | string | ISO 8601 UTC. |
| `steps` | array | See §1.5. May be empty only for body-less workflows (rare). |
| `connections` | array | See §1.6. |

### Optional (root)

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | `"4.0"` (preferred) or `"3.0"` | Absent ≡ accepted. `"2.0"` and below → rejected. |
| `description` | string | |
| `type_name` | string | Optional ISA 88 type (e.g. `Operation`), at most 50 characters. Informational only; never affects execution. Omitted when unset. Also allowed on each child workflow. |
| `state` | string | Free-form. Convention: `Draft` / `InTest` / `InReview` / `Approved` / `Effective` / `Superseded` / `Obsolete`. Optional on root; defaults to `"Draft"`. |
| `display_style` | `"flowchart"` \| `"bpmn"` \| `"isa88"` | Authoring notation only; runtime ignores. |
| `viewport` | `{ x, y, zoom }` numbers | Editor pan/zoom; runtime stores but ignores. |

### Semantic rules (all enforced by Runtime validator)

1. Exactly one step with `step_type: "START"`.
2. At least one step with `step_type: "END"`.
3. All step `oid` values unique within the spec.
4. Every `connections[*].from_step_id` and `to_step_id` references an existing step `oid`.
5. No self-referencing connections (`from_step_id === to_step_id`).
6. Every step is reachable from the START step via BFS over `connections`.
7. Every `PARALLEL` step has a matching `WAIT ALL` on every downstream path.
8. Cycles ARE allowed (used for retry loops via `WAIT ANY`).

Violations surface as `NO_START_STEP`, `DUPLICATE_STEP_OID`, `DANGLING_CONNECTION`, `ORPHANED_STEP`, `UNMATCHED_PARALLEL`, `MISSING_REQUIRED_FIELD`, `INVALID_STEP_TYPE`, `INVALID_RESOURCE_COMMAND`, `INVALID_RESOURCE_SPEC`, `SELF_REFERENCING_CONNECTION`.

## 1.4 ChildWorkflowExport (v7.0) and `child_workflows` (deprecated)

### v7.0 `children[]` — preferred

Each entry is identical to `MasterWorkflowSpecification` **plus** the three fields below. `version` and `state` are required (not defaulted) on every child.

```json
{
  "local_id":          "Safety Check Sub-Workflow",
  "oid":               "298928815449600000",
  "version":           "1.0.0",
  "state":             "Draft",
  "last_modified_date":"2026-04-24T12:00:00Z",
  "schemaVersion":     "4.0",
  "parentChildSpecId": null,
  "steps":             [ /* ... */ ],
  "connections":       [ /* ... */ ],
  "children":          [ /* nested grandchildren */ ]
}
```

| Field | Type | Rule |
|-------|------|------|
| `parentChildSpecId` | `string \| null` | `null` = direct child of the root workflow. Otherwise, the OID of the parent `ChildWorkflowExport` at the level above in the same `children` tree. |
| `version` | string | **Required** on children. Semver. |
| `state` | string | **Required** on children. Free-form; runtime does not validate the value. |

`WORKFLOW PROXY` steps in the parent's `steps[]` resolve to a child by **exact `local_id` match**. If multiple children share a `local_id`, behavior is undefined — keep names unique.

### v6.0 `child_workflows[]` — deprecated fallback

Pre-v7.0 packages stored children as a flat `MasterWorkflowSpecification[]` with implicit nesting. Tools MAY still emit this alongside `children` for backward compatibility, but when both are present the Runtime **uses `children` and ignores `child_workflows`**.

New exporters SHOULD emit only `children`.

## 1.5 MasterWorkflowStep

Every step inherits `ManagedElement` plus `step_type`. The `step_type` discriminant selects which optional config object applies.

### 1.5.1 Step type enum (case- and whitespace-literal)

| Value | Semantics | Auto-completes |
|-------|-----------|----------------|
| `"START"` | Entry point. Exactly one per workflow. | Yes |
| `"END"` | Terminal. At least one. | Yes |
| `"PARALLEL"` | Fan-out to all successors. | Yes |
| `"WAIT ALL"` | Fan-in; completes when all predecessors done. | Yes |
| `"WAIT ANY"` | Fan-in; completes when any predecessor done. | Yes |
| `"SELECT 1"` | Routed choice; emits one successor by condition. See §1.5.4. | No |
| `"YES_NO"` | Binary user choice. See §1.5.5. | No |
| `"USER_INTERACTION"` | Generic form screen. See §1.5.6 / §1.12. | No |
| `"SCRIPT"` | Runs a script snippet. See §1.5.3. | Yes |
| `"ACTION PROXY"` | Invokes an environment action via the Action Container. | No |
| `"WAIT ACTION PROXY"` | Blocking variant of ACTION PROXY. | No |
| `"WORKFLOW PROXY"` | Invokes a child workflow (matched by `local_id`). | No |

Underscores in `"YES_NO"` and `"USER_INTERACTION"` are literal — do not convert to spaces. Spaces in `"SELECT 1"`, `"WAIT ALL"`, `"WAIT ANY"`, `"ACTION PROXY"`, `"WAIT ACTION PROXY"`, `"WORKFLOW PROXY"` are literal — do not convert to underscores.

The editor's internal representation uses camelCase (`start`, `select1`, `userInteraction`, `actionProxy`, `workflowProxy`, …). Exporters MUST translate to the canonical UPPER-CASE form.

### 1.5.2 Required step fields

```json
{
  "local_id":           "Check Pressure",
  "oid":                "7000000000011",
  "version":            "1.0.0",
  "last_modified_date": "2026-04-24T12:00:00Z",
  "step_type":          "USER_INTERACTION",
  "position":           { "x": 100, "y": 250 }
}
```

`position` is optional but recommended — editors reuse it to restore canvas layout on round-trip.

### 1.5.3 SCRIPT → `script_config`

```json
{
  "step_type": "SCRIPT",
  "script_config": {
    "language": "python",
    "source":   "output.result = input.threshold * 2"
  }
}
```

Languages: the web Runtime supports `"python"` via Pyodide; iOS/Android targets implement a JS-regex fallback for a constrained subset. New runtimes SHOULD support at least `"python"` for portability.

### 1.5.4 SELECT 1 → `select1_config` + routed connections

```json
{
  "step_type": "SELECT 1",
  "select1_config": {
    "input_name":       "Status.Value",
    "input_value_type": "property",
    "options": [
      { "id": "opt-open",    "label": "Open",    "operator": "==", "value": "open",    "value_type": "literal", "is_default": false },
      { "id": "opt-closed",  "label": "Closed",  "operator": "==", "value": "closed",  "value_type": "literal", "is_default": false },
      { "id": "opt-pending", "label": "Pending", "operator": "!=", "value": "open",    "value_type": "literal", "is_default": true  }
    ]
  }
}
```

Each outgoing connection from a `SELECT 1` step MUST set `connection_id` to one of `select1_config.options[*].id`. Operators: `"=="`, `"!="`, `"<"`, `"<="`, `">"`, `">="`, `"contains"`, `"startsWith"`, `"endsWith"`, `"matches"` (regex).

### 1.5.5 YES_NO → `yes_no_config` + two branches

```json
{
  "step_type": "YES_NO",
  "yes_no_config": {
    "yes_label":         "Yes",
    "no_label":          "No",
    "yes_value":         "true",
    "no_value":          "false",
    "default_selection": "none"
  }
}
```

Connections from a `YES_NO` step carry `source_handle_id ∈ {"yes", "no"}` to identify the branch. `default_selection ∈ {"yes", "no", "none"}`.

### 1.5.6 USER_INTERACTION → `ui_parameter_specifications` and/or `form_layout_config`

Two formats coexist:

1. **Legacy vertical stack** — `ui_parameter_specifications[]` rendered top-down.
2. **WYSIWYG form** — `form_layout_config[]` keyed by `deviceType` (`phone` / `tablet` / `desktop`) with absolute-positioned elements.

When both are present, the runtime prefers `form_layout_config` for the active device and falls back to `ui_parameter_specifications`. Full form layout schema is in §1.12.

`ui_parameter_specifications[]` element shape (legacy):

```json
{
  "oid":      "...",
  "type":     "Button|Header|Text|SmallText|Image|Video|TextInput|YesNoButtons|PickList|CheckboxList|FormField|FormFieldMultiline|FormFieldNumeric|FormFieldPhone|FormFieldEmail|Divider",
  "value":    "Continue",
  "value2":   "",
  "font_size":16,
  "color":    "#000000",
  "lines":    1,
  "align":    "left|center|right"
}
```

### 1.5.7 Per-step parameter & resource arrays

Every step type MAY carry any of:

| Field | Schema |
|-------|--------|
| `input_parameter_specifications` | array of §1.7.1 |
| `output_parameter_specifications` | array of §1.7.2 |
| `value_property_specifications` | array of §1.7.3 |
| `resource_command_specifications` | array of §1.7.5 |
| `connection_references` | string[] — outgoing `connection_id`s this step owns (round-trip aid for `SELECT 1` / `YES_NO`) |
| `action_visibility` | `"opaque"` \| `"observable"` (on `ACTION PROXY` / `WAIT ACTION PROXY`) |

### 1.5.8 Form-element image registry

When a `USER_INTERACTION` step's form layout uses image elements, the step MUST also expose a stable filename registry so the runtime can resolve the ZIP entry by `imageOid`:

```json
"form_element_images": [
  { "image_oid": "7000000123456", "filename": "engine-closeup.jpg" }
]
```

The ZIP entry MUST be `images/{image_oid}-{filename}` (e.g. `images/7000000123456-engine-closeup.jpg`). Runtime falls back to bare `images/{filename}` if the OID-prefixed entry is missing.

## 1.6 Connection

```json
{
  "from_step_id":     "7000000000001",
  "to_step_id":       "7000000000011",
  "connection_id":    "7000000000012",
  "source_handle_id": "yes",
  "condition":        "Response.Value == 'approved'",
  "waypoints":        [ { "x": 150, "y": 200 } ]
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `from_step_id` | Yes | Step `oid`. |
| `to_step_id` | Yes | Step `oid`. Must differ from `from_step_id`. |
| `connection_id` | No | Unique ID for this edge. **Required-by-convention** on `SELECT 1` outgoing edges (matches an option `id`). |
| `source_handle_id` | No | `"yes"` / `"no"` on `YES_NO` outgoing edges. Reserved for future named-output handles on proxy steps. |
| `condition` | No | Free-form condition string on `SELECT 1` edges. Authoritative routing is `select1_config`; this field is informational. |
| `waypoints` | No | Editor bend points. `waypoints[0] = { x, y }` is an offset (delta) from the default midpoint that the editor's orthogonal router computes, not an absolute canvas point. Only `waypoints[0]` is read; longer arrays are reserved. |

## 1.7 Parameters and resources

### 1.7.1 InputParameter (workflow inputs, step inputs, action inputs)

```json
{
  "id":            "greeting",
  "oid":           "param-oid-1",
  "description":   "Greeting text shown on first screen",
  "default_value": "Welcome",
  "value_type":    "literal",
  "json_schema":   "{\"type\":\"string\"}",
  "entries":       [ { "name": "subkey", "value": "default" } ]
}
```

Required: `id`, `default_value`. `value_type ∈ {"literal","property"}`; absent ≡ `"literal"`. `json_schema` is a stringified JSON Schema (yes — string, not embedded object) used for input validation.

### 1.7.2 OutputParameter (workflow outputs, step outputs, action outputs)

```json
{
  "id":          "result",
  "oid":         "param-oid-2",
  "description": "Final result value",
  "target":      "Response.Value",
  "entries":     []
}
```

Required: `id`. `target` is a dotted Value Property reference `Property.Entry` where the runtime stores the captured value.

### 1.7.3 ValueProperty (workflow- or step- or env-scoped values)

```json
{
  "name":    "Response",
  "oid":     "vp-oid-1",
  "entries": [
    { "name": "Value",  "value": ""        },
    { "name": "Status", "value": "pending" }
  ]
}
```

Required: `name`. Addressed in expressions and `target` references as `Name.EntryName`.

### 1.7.4 ResourceProperty

```json
{
  "name":          "Printer",
  "resource_type": "binary exclusive use",
  "use_limit":     1,
  "description":   "Shared printer",
  "names":         ["HP-001", "HP-002"]
}
```

Required: `name`, `resource_type`. `resource_type` ∈ exactly one of:

| Value | Purpose | Required extras |
|-------|---------|-----------------|
| `"binary exclusive use"` | Mutex. | — |
| `"binary shared use with pool limits"` | Semaphore up to `use_limit`. | `use_limit` |
| `"countable use with pool limits"` | Quantified pool. | `use_limit` |
| `"named pool"` | Named-slot pool. | `names[]` non-empty |
| `"sync"` | Rendezvous channel (`Send`/`Receive`/`Synchronize`). | — |

### 1.7.5 ResourceCommand

```json
{
  "oid":                  "rc-oid-1",
  "command_type":         "Acquire",
  "resource_name":        "Printer",
  "resource_source_type": "workflow",
  "resource_source_oid":  "7000000000001",
  "amount":               1,
  "target":               "PrinterHandle",
  "source":               "MessagePayload"
}
```

Required: `command_type`, `resource_name`.

| `command_type` | Compatible `resource_type` | Required extras |
|----------------|----------------------------|-----------------|
| `"Acquire"` / `"Release"` | binary exclusive / binary shared / named pool | — |
| `"Acquire Pool Amount"` / `"Release Pool Amount"` | countable | `amount` > 0 |
| `"Send"` / `"Receive"` / `"Synchronize"` | sync | At most one sync command per step. |

`resource_source_type ∈ {"workflow", "environment"}`; `resource_source_oid` = OID of the owning workflow or environment.

## 1.8 EnvironmentSpecification

Embedded under a workflow's `environment_specifications[]` AND packaged as a standalone `.WFenvir` JSON inside `.WFmasterX` (§2.2). Inside a `MasterEnvironmentLibrary` (§1.9) it lives under `environment_specifications[]`.

```json
{
  "local_id":           "Kitchen Library",
  "oid":                "env-oid-1",
  "version":            "1.0.0",
  "last_modified_date": "2026-04-24T00:00:00Z",
  "library_name":       "Kitchen Library",
  "included_actions": [
    {
      "action_name":              "preheatOven",
      "action_library":           "Oven Controls",
      "action_oid":               "act-oid-1",
      "action_version":           "1.0.0",
      "action_last_modified_date":"2026-04-24T00:00:00Z",
      "input_parameter_specifications":  [ /* §1.7.1 */ ],
      "output_parameter_specifications": [ /* §1.7.2 */ ],
      "property_specifications":         [ /* §1.7.3 */ ]
    }
  ],
  "value_property_specifications":    [ /* §1.7.3 */ ],
  "action_property_specifications":   [ /* §1.7.3 */ ],
  "resource_property_specifications": [ /* §1.7.4 */ ],
  "action_server_specifications": [
    { "name": "primary", "uri": "https://api.example.com", "connection_type": "REST" }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `local_id`, `oid`, `version`, `last_modified_date` | Yes | ManagedElement. |
| `library_name` | No | Importer hint — used to weak-match against `environments/<library_name>.WFenvir` siblings inside a `.WFmasterX`. |
| `included_actions[]` | Yes | Each entry binds an action by `action_name` + `action_library`. The triple `(filename of WFenvir, included_actions[].action_library, action library's inner local_id)` MUST agree, or importers silently drop the binding. |
| `action_server_specifications[*].connection_type` | Yes | Always `"REST"` in v1.0. The base URL for the public Runtime↔AC protocol (REST_Protocol.md) is `<uri>/trajectory/v1/`. |

## 1.9 MasterEnvironmentLibrary

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://saturnis.io/schemas/master-environment-library.json",
  "title": "Master Environment Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["environment_specifications"],
  "properties": {
    "environment_specifications": {
      "type": "array",
      "items": { /* EnvironmentSpecification — §1.8 */ }
    },
    "child_libraries": {
      "type": "array",
      "items": { "$ref": "#" }
    }
  }
}
```

The wrapping `local_id` of a `MasterEnvironmentLibrary` is the *library* name. Inside, each `environment_specifications[i].local_id` is the *environment* name.

## 1.10 MasterActionLibrary

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://saturnis.io/schemas/master-action-library.json",
  "title": "Master Action Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["action_specifications"],
  "properties": {
    "action_specifications": {
      "type": "array",
      "items": {
        "type": "object",
        "allOf": [{ "$ref": "managed-element.json" }],
        "properties": {
          "input_parameter_specifications":  { "type": "array", "items": { /* §1.7.1 */ } },
          "output_parameter_specifications": { "type": "array", "items": { /* §1.7.2 */ } },
          "property_specifications":         { "type": "array", "items": { /* §1.7.3 */ } },
          "action_visibility":               { "type": "string", "enum": ["opaque", "observable"] },
          "timeout_seconds":                 { "type": "integer", "description": "Default timeout for the action; the invoker may override." }
        }
      }
    },
    "child_libraries": {
      "type": "array",
      "items": { "$ref": "#" }
    }
  }
}
```

`action_visibility` is the contract the Action Container honours at invoke time:

- `"opaque"` — the AC accepts the invoke and returns its terminal state when reached. The invoker polls or waits; no intermediate state is published. Only the `ABORT` command is accepted.
- `"observable"` — the AC publishes an SSE stream of state transitions and may receive `PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP`, `CLEAR` commands.

## 1.11 MasterWorkflowStepLibrary

Reusable sub-workflows packaged for cross-workflow reuse. Same shape as a `MasterWorkflowLibrary` but distributed in `.WFslibX` ZIPs.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://saturnis.io/schemas/master-workflow-step-library.json",
  "title": "Master Workflow Step Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["workflow_specifications"],
  "properties": {
    "workflow_specifications": {
      "type": "array",
      "items": { /* same shape as MasterWorkflowSpecification — §1.3 */ }
    },
    "child_libraries": {
      "type": "array",
      "items": { "$ref": "#" }
    }
  }
}
```

## 1.12 Form layout (`form_layout_config`)

`USER_INTERACTION` and `YES_NO` steps use a per-device WYSIWYG layout.

```json
"form_layout_config": [
  {
    "deviceType":   "phone",
    "canvasWidth":  390,
    "canvasHeight": 844,
    "elements":     [ /* FormElement[] */ ]
  },
  {
    "deviceType":   "tablet",
    "canvasWidth":  820,
    "canvasHeight": 1180,
    "elements":     [ /* ... */ ]
  },
  {
    "deviceType":   "desktop",
    "canvasWidth":  1280,
    "canvasHeight": 800,
    "elements":     [ /* ... */ ]
  }
]
```

Each `FormElement`:

```json
{
  "type":     "button|text|textInput|image|header|textarea|checkbox|radio|video|divider|timer",
  "x":       20, "y": 80, "width": 350, "height": 200, "zIndex": 0,

  "label":            "How many cloves?",
  "placeholder":      "Enter number",
  "fieldName":        "cloveCount",
  "required":         true,
  "outputParameter":  "GarlicResponse.Value",
  "fontSize":         16,
  "content":          "Mince the garlic cloves finely",
  "fontWeight":       "normal",
  "color":            "#333333",
  "align":            "left",

  "src":              "engine-closeup.jpg",
  "imageOid":         "7000000123456",
  "objectFit":        "contain",
  "posterUrl":        "https://...",

  "outputValue":      "approved",
  "deletable":        false,
  "thickness":        1,
  "rows":             4,

  "options":          [{ "label": "Minced", "value": "minced" }],
  "defaultSource":    { "mode": "static",   "value": "4" },
  "placeholderSource":{ "mode": "property", "value": "DefaultCloves.Value" },

  "durationSeconds":  60,
  "direction":        "countdown",
  "blockDone":        false,

  "inputMode":        "text",
  "listItems":        [{ "label": "A", "value": "a" }],
  "listSource":       { "mode": "static" }
}
```

Universal fields: `type`, `x`, `y`, `width`, `height` (all numbers, required); `zIndex` optional.

Per-type fields:

| `type` | Distinguishing fields |
|--------|----------------------|
| `button` | `label`, `outputValue`, `deletable?` |
| `text` / `header` | `content` (string OR `{content, plainText}` rich-text object), `fontSize`, `fontWeight`, `color`, `align` |
| `textInput` | `fieldName`, `label`, `placeholder`, `required`, `inputMode ∈ {text,number,phone,password,dropdown,combobox}`, `listItems[]`, `listSource`, `outputParameter`, `defaultSource`, `placeholderSource` |
| `textarea` | as `textInput` + `rows` |
| `image` | `src` (filename in `images/` or https URL), `imageOid`, `objectFit ∈ {contain,cover,fill}` |
| `video` | `src`, `posterUrl` |
| `checkbox` / `radio` | `label`, `fieldName`, `options[]`, `outputParameter` |
| `divider` | `thickness`, `color` |
| `timer` | `durationSeconds`, `direction ∈ {countdown,countup}`, `blockDone`, `fieldName` |

`defaultSource.mode` / `placeholderSource.mode` ∈ `{"static", "property", "input"}`. `listSource.mode` ∈ `{"static", "input"}`.

**Validation rule (since 2026-05-29, downgraded 2026-08-10).** Any `textInput` / `textarea` / `checkbox` / `radio` element on a `USER_INTERACTION` step should have a non-empty `outputParameter`. From 2026-05-29 to 2026-08-10 violations were rejected with error code `UNBOUND_FORM_INPUT`; since 2026-08-10 the rule is **non-fatal everywhere** — validators return `valid: true` plus a `warnings` array (one entry per unbound element). The Pro mission engine records a `WARNING` trace row per finding at instance start; the free Runtime prints/logs them (validate-file CLI, web-ui import). Either way the captured value is discarded at submit time (`captureFormOutputs` skips unbound elements).

**Round-trip migration notes for importers.**

- `defaultSource.mode: "parameter"` (older exports) → migrate to `"property"`.
- `content` may arrive as `string` or `{ content, plainText }` rich-text object. Extract the `content` field (HTML) for rendering; use `plainText` only as a no-HTML fallback.
- Image `src` values in legacy exports use the namespacing `{stepOid}-{filename}`. Strip the `{stepOid}-` prefix on import.

---

# Part 2 — ZIP File Formats

## 2.0 Extension matrix

| Extension | Container | Carries | Authoritative producer | Consumers |
|-----------|-----------|---------|------------------------|-----------|
| `.WFmaster` | bare JSON | One `MasterWorkflowSpecification` (§1.3) | Editor | Runtime, Editor |
| `.WFmasterX` | ZIP | One `.WFmaster` + optional sibling env/action libraries + images | Editor | Runtime, Editor |
| `.WFlibX` | ZIP | A `MasterWorkflowLibrary` (multiple roots) + assets | Editor | Editor |
| `.WFslibX` | ZIP | A `MasterWorkflowStepLibrary` | Editor | Editor |
| `.WFenvir` | bare JSON | One `MasterEnvironmentLibrary` (§1.9) OR single-env (§1.8) document | Editor, Action Container | Editor, Action Container, Mission Autopilot Tester |
| `.WFenvirX` | ZIP | One single-env `.WFenvir` + `actions/*.WFaction` | Editor, Action Container | Editor, Action Container, Mission Autopilot Tester |
| `.WFenvirLibX` | ZIP | One library-shape `.WFenvir` + assets | Editor, Action Container | Action Container, Mission Autopilot Tester |
| `.WFenvirBundleX` | ZIP | One env library `.WFenvir` + Python code files + manifest | Action Container | Action Container, Mission Autopilot Tester |
| `.WFaction` | bare JSON | One `MasterActionLibrary` (§1.10) OR standalone action document | Editor, Action Container | Editor, Action Container, Mission Autopilot Tester |
| `.WFactionLibX` | ZIP | A `MasterActionLibrary` bundle | Editor | Editor *only* (explicitly rejected by Action Container) |
| `.WFactionCodeX` (newer) / `.WFactionCode` (legacy filename) | ZIP | One action spec + Python source code per state + manifest | Action Container | Action Container |
| `.WFsnapshot` | ZIP | Full Action Container backup: settings + all envs + all action code + manifest | Action Container | Action Container |
| `.WFstepLibX` | ZIP | Reserved for step library transport (accepted on AC upload; same content shape as `.WFslibX`) | Editor | Action Container (upload), Editor |

Implementer rules:

- Treat the extension as advisory metadata for the user. The authoritative dispatch on import is the *content* shape (presence of `workflow_specifications` vs `environment_specifications` vs `action_specifications`).
- `manifest.json` inside any ZIP is **advisory only** — importers MUST tolerate its absence and MUST NOT rely on its `files[]` array for routing. Walk the ZIP entries directly.
- Filenames inside `environments/`, `actions/`, and `images/` are free-form. The importer resolves them by directory prefix and extension match.

## 2.1 `.WFmaster` — bare workflow JSON

A single JSON file. Content: a `MasterWorkflowSpecification` (§1.3). No images, no embedded libraries — the workflow either has no environment references or the consumer must resolve them out-of-band.

**Use case.** Smallest possible exchange unit. Suitable for diff/version-control, test fixtures, and runtimes that only need the workflow shape.

## 2.2 `.WFmasterX` — runtime package (workflow + dependencies)

The primary runtime distribution format.

```
MyWorkflow.WFmasterX  (ZIP)
├── MyWorkflow.WFmaster            ← JSON: the MasterWorkflowSpecification (§1.3)
├── manifest.json                  ← OPTIONAL: package metadata (§2.2.1)
├── environments/                  ← OPTIONAL: one .WFenvir per embedded env library
│     └── Kitchen Library.WFenvir  ← JSON: a MasterEnvironmentLibrary (§1.9)
├── actions/                       ← OPTIONAL: one .WFaction per action library
│     └── My Actions.WFaction      ← JSON: a MasterActionLibrary (§1.10)
└── images/                        ← OPTIONAL: media referenced by form elements / UI params
      ├── 7000000123456-photo.jpg  ← {imageOid}-{filename} for form-element images
      └── engine-closeup.jpg       ← bare filename for ui_parameter_specifications images
```

Rules:

- Exactly one file at the ZIP root ending in `.WFmaster`. Nested `.WFmaster` files elsewhere in the ZIP are ignored.
- For the env-link contract to work, three names must agree on each environment library:
  1. The ZIP entry filename: `environments/<LibName>.WFenvir`
  2. `environment_specifications[i].library_name` inside the workflow
  3. The library's inner `local_id`
  
  If any one diverges, the Editor importer silently drops the env link (the workflow imports as a bare workflow with no env chip). New generators MUST validate the triple before writing the ZIP.
- The same three-way agreement applies to action libraries: `actions/<LibName>.WFaction` ≡ env's `included_actions[].action_library` ≡ action library's inner `local_id`.

### 2.2.1 `manifest.json` (optional)

```json
{
  "packageVersion": "1.0",
  "workflowName":   "My Workflow",
  "environmentLibraries": ["Kitchen Library"],
  "actionLibraries":      ["My Action Library"],
  "createdAt": "2026-04-24T12:00:00.000Z",
  "files": [
    { "path": "My Workflow.WFmaster",                "type": "workflow" },
    { "path": "environments/Kitchen Library.WFenvir","type": "environment" },
    { "path": "actions/My Action Library.WFaction",  "type": "action" },
    { "path": "images/7000000123456-photo.jpg",      "type": "image" }
  ]
}
```

Include for forward compatibility and human debugging. Importers MUST NOT rely on it for routing.

## 2.3 `.WFlibX` — workflow library bundle

```
MyLibrary.WFlibX  (ZIP)
├── manifest.json
├── workflows/
│     ├── Bolognese.WFmaster
│     ├── ChickenParm.WFmaster
│     └── Risotto.WFmaster
├── environments/
│     └── KitchenEnv.WFenvir
├── actions/
│     └── CookingActions.WFaction
└── images/
      └── ...
```

**Editor-only.** Not consumed by the Runtime. The Editor unpacks it as: one `MasterWorkflowLibrary` (the outer wrapper) containing all the `workflows/*.WFmaster` roots, plus the shared environment / action / image dependencies. To run the contained workflows, the Editor splits each root into its own `.WFmasterX` for export to the Runtime.

## 2.4 `.WFslibX` — step library bundle

```
MyStepLib.WFslibX  (ZIP)
├── manifest.json
├── workflows/
│     └── SafetyCheck.WFmaster
└── images/
```

Same envelope as `.WFlibX` but the outer wrapper is a `MasterWorkflowStepLibrary` (§1.11). Editor-only.

## 2.5 `.WFenvir` — bare environment JSON

Two shapes coexist under the same extension. Importers MUST autodetect.

- **Library shape (preferred for distribution).** Top-level object is a `MasterEnvironmentLibrary` (§1.9) with `environment_specifications: [...]`.
- **Single-env shape (used inside `.WFmasterX` `environments/`).** Top-level object is itself an `EnvironmentSpecification` (§1.8) with `included_actions: [...]`. No outer `environment_specifications` wrapper.

The dispatch test is: presence of `environment_specifications` top-level → library shape; presence of `included_actions` top-level → single-env shape.

## 2.6 `.WFenvirX` — single environment + its actions

```
Kitchen.WFenvirX  (ZIP)
├── Kitchen.WFenvir            ← JSON: single-env shape (§1.8)
└── actions/
      ├── Oven.WFaction        ← JSON: standalone action shape
      └── Mixer.WFaction
```

Action Container exports a `.WFenvirX` of any environment. The inner `.WFaction` files use the standalone shape (the action spec at top level, *without* the `action_specifications` wrapper). They never carry Python source code; that's the role of `.WFenvirBundleX` (§2.8) or `.WFactionCodeX` (§2.10).

The Action Container accepts uploads of `.WFenvirX` to populate or update environments.

## 2.7 `.WFenvirLibX` — env library ZIP (renamed `.WFenvirX` library variant)

```
KitchenLib.WFenvirLibX  (ZIP)
├── KitchenLib.WFenvir         ← JSON: library shape (§1.9) — environment_specifications[] wrapper
└── (no actions/ folder — actions are inlined per env via included_actions[])
```

Functionally equivalent to a library-shaped `.WFenvir` wrapped in a ZIP. The renamed extension exists so the Action Container can disambiguate library uploads from single-env uploads at the OS-extension level.

## 2.8 `.WFenvirBundleX` — env library + Python code

The Action Container's preferred round-trip format for shipping an environment together with its action implementations.

```
Kitchen.WFenvirBundleX  (ZIP)
├── manifest.json             ← {format: "WFenvirBundleX", format_version: 1, exported_at, container_version,
│                                environment_oid, environment_local_id, action_count, code_file_count}
├── Kitchen.WFenvir           ← JSON: library shape (§1.9) carrying one env with included_actions[]
└── code/
      ├── <action_oid_1>/
      │     ├── EXECUTING.py
      │     └── PAUSED.py
      └── <action_oid_2>/
            └── EXECUTING.py
```

Python files are keyed by the action OID and the runtime state they implement. A code file named `<STATE>.py` defines the action's behaviour while the action instance is in that state. Recognised state filenames: `EXECUTING`, `STARTING`, `COMPLETING`, `PAUSING`, `PAUSED`, `RESUMING`, `HOLDING`, `HELD`, `UNHOLDING`, `STOPPING`, `STOPPED`, `ABORTING`, `ABORTED`. At minimum, `EXECUTING.py` SHOULD be present for any action that does work.

A new Action Container implementation that consumes `.WFenvirBundleX` MUST:

1. Parse the inner `.WFenvir` library shape to register envs and actions.
2. For each `code/<oid>/<state>.py`, store the source against the action with that OID and mark it active for that state.

## 2.9 `.WFaction` — bare action JSON

Two shapes coexist (same autodetect pattern as `.WFenvir`):

- **Library shape.** Top-level `MasterActionLibrary` (§1.10) with `action_specifications: [...]`.
- **Standalone shape.** A single action spec at top level (ManagedElement + `input_parameter_specifications`, `output_parameter_specifications`, `property_specifications`, `action_visibility`, `timeout_seconds`).

The Action Container uses the standalone shape inside `.WFenvirX` (`actions/<n>.WFaction`). The Editor uses the library shape inside `.WFmasterX` (`actions/<LibName>.WFaction`).

## 2.10 `.WFactionCodeX` (current) / `.WFactionCode` (legacy filename)

A single action's spec + Python source code per state. The Action Container's per-action download/upload format.

```
HeatOven.WFactionCodeX  (ZIP)
├── manifest.json             ← (§2.10.1 below)
├── EXECUTING.py
├── PAUSED.py
└── STOPPING.py
```

### 2.10.1 manifest.json

```json
{
  "format_version": "1.0",
  "exported_at":    "2026-04-24T12:00:00.000Z",
  "action": {
    "oid":               "act-001-snowflake",
    "local_id":          "Heat Oven",
    "version":           "1.0.0",
    "action_visibility": "observable",
    "description":       "Heats the oven to a target temperature",
    "input_parameter_specifications":  [ /* §1.7.1 */ ],
    "output_parameter_specifications": [ /* §1.7.2 */ ],
    "property_specifications":         [ /* §1.7.3 */ ],
    "timeout_seconds":   600
  },
  "code_files": [
    { "state": "EXECUTING", "filename": "EXECUTING.py", "description": "Main heating loop" },
    { "state": "PAUSED",    "filename": "PAUSED.py" },
    { "state": "STOPPING",  "filename": "STOPPING.py" }
  ]
}
```

On import, the Action Container matches the manifest's `action.oid` against an existing action and rejects the upload if they differ. The action spec is upserted; each `code_files[i].filename` is read from the ZIP and saved+activated for the matching state.

The legacy extension `.WFactionCode` (no trailing `X`) is what the **export** route currently writes; the **import** route accepts both `.WFactionCode` and `.WFactionCodeX`. New tools SHOULD prefer `.WFactionCodeX` for parity with the other ZIP types.

## 2.11 `.WFsnapshot` — Action Container backup

A full backup of a single Action Container's state. Not part of the public format universe in the strict sense — it's container-specific — but documented here for completeness because the Action Container export endpoint produces it.

```
TrajectorySnapshot_2026-05-30.WFsnapshot  (ZIP)
├── manifest.json             ← {format_version, exported_at, container_version, environment_count, action_count, code_file_count}
├── settings.json             ← key/value pairs from the AC settings store
├── environments/
│     └── <env_oid>.json      ← env-library shape JSON (one file per env)
└── code/
      └── <action_oid>/
            └── <STATE>.py
```

Restore is implementation-defined per container. The format is documented here so third-party tools can introspect a snapshot without depending on the Action Container's internal database schema.

## 2.12 `.WFstepLibX` — step library ZIP for AC upload

The Action Container accepts `.WFstepLibX` uploads via `/management/v1/upload`. Content layout matches `.WFslibX` (§2.4): a `MasterWorkflowStepLibrary` wrapper with `workflows/*.WFmaster` entries. It exists so containers can host reusable step libraries alongside environments.

---

# Part 3 — Per-tool import/export matrix

`R` = reads (imports), `W` = writes (exports), `—` = no role.

| Format | Editor | Runtime | Action Container | Mission Autopilot Tester |
|--------|:------:|:-------:|:----------------:|:-------------:|
| `.WFmaster` | R/W | R | — | — |
| `.WFmasterX` | R/W | R | — | — |
| `.WFlibX` | R/W | — | — | — |
| `.WFslibX` | R/W | — | — | — |
| `.WFenvir` (library shape) | R/W | R *(only inside `.WFmasterX`)* | R/W | R (uploads it) |
| `.WFenvir` (single-env shape) | R/W | R *(only inside `.WFmasterX`)* | R/W | R (uploads it) |
| `.WFenvirX` | R/W | — | R/W | R (uploads it) |
| `.WFenvirLibX` | R/W | — | R/W | R (uploads it) |
| `.WFenvirBundleX` | — | — | R/W | R (uploads it) |
| `.WFaction` (library shape) | R/W | R *(only inside `.WFmasterX`)* | R/W *(standalone shape)* | R (uploads it) |
| `.WFactionLibX` | R/W | — | **rejected** | R (uploads it) |
| `.WFactionCodeX` / `.WFactionCode` | — | — | R/W | — |
| `.WFsnapshot` | — | — | R/W | — |
| `.WFstepLibX` | R (treats as `.WFslibX`) | — | R (accepts upload) | R (uploads it) |

Notes:

- The Runtime is exclusively a *consumer*. It never writes any of these formats. New runtimes implementing this spec only need read paths for `.WFmaster` and `.WFmasterX`.
- The Mission Autopilot Tester is a thin client over the Action Container's `/management/v1/upload` endpoint. It does not parse or transform the formats — it forwards the bytes verbatim.
- The Editor is the only authoring tool. New editors implementing this spec should target the v7.0 envelope (`children[]`, `schemaVersion: "4.0"`) as the write format and accept v6.0 (`child_workflows[]`, `schemaVersion: "3.0"`) for backward-compatible reads.

---

# Part 4 — Editor internal envelope → runtime envelope (migration aid)

The Editor's internal storage uses a library wrapper around React Flow `nodes` / `edges`. Tools that want to be drop-in editor replacements need to emit the same runtime envelope. This is the canonical mapping.

### 4.1 Spec-level field map

| Editor (`specifications[i]`) | Runtime (root or `ChildWorkflowExport`) |
|------------------------------|------------------------------------------|
| `id` | `oid` |
| `name` | `local_id` |
| `description` (may be null) | `description` (omit if null) |
| `version` | `version` |
| `state` | `state` |
| `updatedAt` (epoch ms) | `last_modified_date` (ISO 8601) |
| `parentSpecificationId` | `parentChildSpecId` (`null` for direct children of root) |
| `rootSpecificationId` | *(not mapped — used for grouping only)* |
| `dataSchemaVersion` | *(not mapped — derive `schemaVersion: "4.0"`)* |
| `data.nodes[]` | `steps[]` (see §4.2) |
| `data.edges[]` | `connections[]` (see §4.2) |
| `data.viewport` | `viewport` (pass through) |
| `data.workflowInputs[]` | `starting_parameter_specifications[]` |
| `data.workflowOutputs[]` | `output_parameter_specifications[]` |
| `data.workflowValues[]` | `value_property_specifications[]` |
| `data.workflowResources[]` | `resource_property_specifications[]` |
| `data.images[]` | `form_element_images[]` on the appropriate step + ZIP entries under `images/` |

### 4.2 Step-type normalization

| Editor `node.type` / `stepType` | Runtime `step_type` |
|---------------------------------|--------------------|
| `start` | `START` |
| `end` | `END` |
| `parallel` | `PARALLEL` |
| `waitAll` | `WAIT ALL` |
| `waitAny` | `WAIT ANY` |
| `select1` | `SELECT 1` |
| `yesNo` | `YES_NO` |
| `userInteraction` | `USER_INTERACTION` |
| `script` | `SCRIPT` |
| `actionProxy` | `ACTION PROXY` |
| `waitActionProxy` | `WAIT ACTION PROXY` |
| `workflowProxy` | `WORKFLOW PROXY` |

| Editor edge | Runtime connection |
|-------------|--------------------|
| `edge.source` | `from_step_id` |
| `edge.target` | `to_step_id` |
| `edge.id` | `connection_id` |
| `edge.sourceHandle` | `source_handle_id` (for YES_NO) **and** `connection_id` (for SELECT 1 — set both to `edge.sourceHandle`) |
| `edge.data.condition` | `condition` |
| `edge.type`, `markerEnd`, `style`, `animated` | *(discarded — presentation only)* |

### 4.3 Building the `children` tree from a flat editor envelope

Given a library of specifications sharing one `rootSpecificationId`:

```
root = spec where parentSpecificationId === null
rest = all other specs in the library

function buildChildren(parentId):
  entries = rest filter where parentSpecificationId === parentId
  return entries.map(e => ({
    ...childWorkflowExportFrom(e),
    parentChildSpecId: (e.parentSpecificationId === root.id ? null : e.parentSpecificationId),
    children: buildChildren(e.id)
  }))

root_output.children = buildChildren(root.id)
```

The remap of direct children of the root from `parentSpecificationId === root.id` to `parentChildSpecId === null` is the easy-to-miss step. Grandchildren and deeper preserve their parent OID verbatim.

---

# Part 5 — Pre-write self-check (for any new exporter)

Before emitting a `.WFmasterX`, validate:

- [ ] Exactly one step has `step_type === "START"`.
- [ ] At least one step has `step_type === "END"`.
- [ ] All step `oid` values unique within the spec.
- [ ] Every connection references existing step `oid` values on both ends.
- [ ] No connection has `from_step_id === to_step_id`.
- [ ] Every step is reachable from the START step via `connections`.
- [ ] Every `PARALLEL` step has a matching `WAIT ALL` on every downstream path.
- [ ] Every `SELECT 1` step has at least one outgoing connection, and each such connection's `connection_id` matches one of `select1_config.options[].id`.
- [ ] Every `YES_NO` step has at most two outgoing connections with `source_handle_id ∈ {"yes","no"}`.
- [ ] Every `ChildWorkflowExport` in `children[]` has `parentChildSpecId` pointing at its parent's `oid`, or `null` for direct children of the root.
- [ ] Every managed element (root, every child, every step) has all four of `local_id`, `oid`, `version`, `last_modified_date`.
- [ ] Every `USER_INTERACTION` step's `textInput` / `textarea` / `checkbox` / `radio` form elements have a non-empty `outputParameter`.
- [ ] If env-libs are referenced, the triple (`environments/<name>.WFenvir`, workflow's `environment_specifications[i].library_name`, env-lib's inner `local_id`) all agree exactly.
- [ ] If action-libs are referenced, the triple (`actions/<name>.WFaction`, env's `included_actions[].action_library`, action-lib's inner `local_id`) all agree exactly.

A failure on any check produces a corresponding error code at import (`NO_START_STEP`, `DUPLICATE_STEP_OID`, `DANGLING_CONNECTION`, `ORPHANED_STEP`, `UNMATCHED_PARALLEL`, `MISSING_REQUIRED_FIELD`, `INVALID_STEP_TYPE`, `INVALID_RESOURCE_COMMAND`, `INVALID_RESOURCE_SPEC`, `SELF_REFERENCING_CONNECTION`, `UNBOUND_FORM_INPUT`).

---

# Appendix A — Schema relationship diagram

```
managed-element.json (base)
  ├── master-workflow-library.json
  │     └── workflow_specifications[].steps[]                  → step definition
  │     └── workflow_specifications[].connections[]            → connection definition
  │     └── workflow_specifications[].children[]               → ChildWorkflowExport (v7.0+, preferred)
  │     └── workflow_specifications[].child_workflows[]        → DEPRECATED, pre-v7.0 fallback
  │     └── workflow_specifications[].environment_specifications[] → embedded environments
  ├── master-action-library.json
  │     └── action_specifications[]                            → inputs, outputs, properties
  ├── master-environment-library.json
  │     └── environment_specifications[]                       → actions, values, resources, servers
  └── master-workflow-step-library.json
        └── workflow_specifications[]                          → same shape as workflow library
```

# Appendix B — References

- Trajectory Runtime spec docs: `TrajectoryRuntime/spec/docs/`
  - `06-json-schemas.md` — full JSON Schema Draft-07 definitions
  - `editor-export-format.md` — editor → runtime transformation, worked examples
  - `v7.0-package-format-changes.md` — migration from v6.0 to v7.0
  - `PackageFormatSpec.md` — ZIP layout reference
  - `RESTProtocolSpec.md` — original protocol spec (see also [REST_Protocol.md](./REST_Protocol.md))
- Editor canonical exporter: `TrajectoryEditor/src/server/packageFormat/buildWorkflowPackage.ts`
- Editor canonical importer: `TrajectoryEditor/src/server/packageFormat/importLibrariesFromZip.ts`
- Runtime canonical loader: `TrajectoryRuntime/engines/web/src/loader.ts`
- Action Container per-action export/import: `TrajectoryActions/packages/server/src/routes/export-import.ts`
