# Trajectory Pro Mission Control — JSON Schema & Package Format Reference

**Audience.** Implementers of new tools that exchange files with the Trajectory Pro Mission Control suite: alternative editors, alternative runtimes, alternative action servers, third-party importers/exporters, conformance test harnesses.

**Scope.** This document defines (a) the JSON object schemas the suite's applications exchange and (b) the ZIP bundle layouts that carry them between applications. It describes *what to write to disk* and *what to read from disk*. The runtime protocol between a runtime and an action server is in [REST_Protocol.md](./REST_Protocol.md).

**Status.** Schema version: **5.0** (current; the "v7.0" recursive envelope with `children[]` and the v2 form document `form_document`). Mission Designer writes `"5.0"` and imports workflow packages whose `schemaVersion` is from `"4.0"` to `"5.0"`; anything older or newer is rejected. Mission Engine's schema accepts `"3.0"`, `"4.0"` and `"5.0"`. See §1.1 for the version rules.

**Owners.**

| Application | Role |
|-------------|------|
| **Mission Designer** | Authoring. Source of truth for every workflow, environment and action shape in this document. Writes `.WFmaster`, `.WFmasterX`, `.WFlibX`, `.WFstepLibX`, `.WFenvirLibX`, `.WFactionLibX` and `.WFenvirX`; reads the same packages back. |
| **Mission FormKit** | Owns the v2 form document schema (`form_document`, §1.12) and the renderer Mission Designer and Mission Pilot share. Writes no files. |
| **Mission Commander** | Loads `.WFmasterX` and `.WFenvirX` packages into work centers and creates runtime workflows from them (the ingest code is in Mission Control DB). Writes and reads `.WFcenterX` work-center packages (§2.13). |
| **Mission Engine** | Executes runtime workflows. Reads the workflow JSON Mission Commander stored, validates it when a runtime workflow starts (§1.3), and never reads or writes a ZIP. |
| **Mission Pilot** | Operator inbox. Renders each step's `form_document`; reads and writes no package files. |
| **Mission Autopilot** | Action server and console. Accepts `.WFenvir*`, `.WFaction` and `.WFactionCodeX` uploads; writes `.WFenvirX`, `.WFenvirBundleX`, `.WFactionCode` and `.WFsnapshot`. |
| **Mission Autopilot Tester** | Browser harness for an action server's REST API. Uploads existing environment and action packages to a target action server; does not write packages. |
| **Mission Broker** | Action server for the Distributed Workflow actions. Takes no package uploads; its actions ship as Mission Designer library packages (`.WFactionLibX`, `.WFenvirLibX`, `.WFenvirX`) in `MissionBroker/designer-library/`. |

A full per-application support matrix is in Part 3.

---

## Conventions

These apply to every JSON object in this document.

| Item | Rule |
|------|------|
| JSON Schema dialect | Draft-07 for Mission Designer's published schemas (`MissionDesigner/src/lib/schemas/*.json`, base URI `https://trajectorypro.io/schemas/`). Mission Engine validates with its own schema (`MissionEngine/src/spec/workflow-schema.json`), written in Draft 2020-12 syntax; the two describe the same shapes. |
| Encoding | UTF-8, no BOM. |
| String IDs (`oid`) | Opaque strings. Mission Designer issues UUIDs for library and specification oids and numeric snowflake strings for steps, parameters, properties and form blocks. Treat every oid as opaque — never parse, never reformat. |
| Timestamps | ISO 8601 UTC with millisecond precision (`2026-04-24T12:34:56.789Z`). |
| Semver (`version`) | Standard `MAJOR.MINOR.PATCH`. Mission Designer writes `"1.0.0"` when a library or specification has no version; every step carries `"1.0.0"`. |
| Permanent enum keys | `step_type`, form block `type`, `command_type`, `resource_type` — never rename after deployment. Whitespace/case is literal. |
| Unknown fields | Forward-compatible. Implementations MUST ignore unknown fields rather than fail. The one exception is the form document (§1.12): its schema forbids unknown properties at every level. |
| Empty arrays | Always permitted unless a field is marked **required**. Mission Designer omits optional arrays that would be empty. |

---

# Part 1 — Complete JSON Definitions

## 1.1 ManagedElement (base type)

Every entity that can appear on disk (libraries, specifications, steps, child workflows) inherits from this base.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/managed-element.json",
  "title": "Managed Workflow Element",
  "type": "object",
  "required": ["local_id", "oid", "version", "last_modified_date"],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "enum": ["3.0", "4.0", "5.0"],
      "description": "Trajectory workflow schema version"
    },
    "local_id":           { "type": "string" },
    "oid":                { "type": "string" },
    "description":        { "type": "string" },
    "version":            { "type": "string" },
    "last_modified_date": { "type": "string", "format": "date-time" }
  }
}
```

**Implementer notes.**
- `local_id` is the human-readable name (e.g. `"Check Pressure"`); `oid` is stable across export and import.
- Mission Designer writes `schemaVersion: "5.0"` on every workflow specification it exports (root and children). Library wrappers and environment and action specifications carry no `schemaVersion`.
- Importing a `.WFmasterX` into Mission Designer requires a root `schemaVersion` from `"4.0"` to `"5.0"`: a missing value is rejected, a value below `"4.0"` or above `"5.0"` fails with `unsupported_schema_version`. Mission Designer's library importers also reject a workflow specification that has `steps` but no `schemaVersion`, or a `schemaVersion` below `"4.0"`.
- Mission Autopilot reads `schemaVersion` on an environment upload: absent means `"4.0"`, a non-string or a value below `"3.0"` is rejected.

## 1.2 MasterWorkflowLibrary

A library that wraps one or more root workflows. Carried by `.WFlibX` (§2.3); Mission Commander never sees it.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/master-workflow-library.json",
  "title": "Master Workflow Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["workflow_specifications"],
  "properties": {
    "parent_library_oid": {
      "type": "string",
      "description": "OID of this library's parent library (provenance only, not consumed on import)."
    },
    "workflow_specifications": {
      "type": "array",
      "items": { "$ref": "#/definitions/workflow_specification" }
    },
    "child_libraries": {
      "type": "array",
      "items": { "$ref": "#" }
    }
  }
}
```

The full definition of `workflow_specification` (the root workflow shape) is in §1.3. Step / connection / parameter sub-shapes are in §1.5 – §1.7. Forms are in §1.12.

In a `.WFlibX`, `workflow_specifications[]` holds every root workflow of the library and of its child libraries (each with its own `library_name` / `library_oid`), and `child_libraries[]` is a one-level list of the direct child libraries' ManagedElement fields only.

## 1.3 MasterWorkflowSpecification (root)

The top level of every `.WFmaster` file. Exactly one per `.WFmasterX` package.

```json
{
  "schemaVersion":      "5.0",
  "display_style":      "flowchart",
  "local_id":           "Test Loops and Scripts",
  "oid":                "0d7f4b4e-6a0f-4a55-9b7e-2f1f3c1a9e10",
  "description":        "Demo workflow with loops and SCRIPT steps.",
  "version":            "1.0.0",
  "last_modified_date": "2026-04-24T12:34:56.789Z",
  "type_name":          "Operation",
  "state":              "Draft",
  "library_name":       "Kitchen Workflows",
  "library_oid":        "6b1e2c3d-0000-4000-8000-000000000001",

  "steps":       [ /* §1.5 */ ],
  "connections": [ /* §1.6 */ ],

  "resource_property_specifications":  [ /* §1.7.4 */ ],
  "starting_parameter_specifications": [ /* §1.7.1 */ ],
  "try_specifications":                [ /* §1.5.11 */ ],
  "output_parameter_specifications":   [ /* §1.7.2 */ ],
  "value_property_specifications":     [ /* §1.7.3 */ ],
  "viewport":                          { "x": 0, "y": 0, "zoom": 1 },
  "environment_specifications":        [ /* §1.8 */ ],

  "children": [ /* §1.4 */ ]
}
```

### Required (root)

| Field | Type | Notes |
|-------|------|-------|
| `local_id` | string | Non-empty. Mission Designer's importer rejects a root without it. |
| `oid` | string | Opaque. Mission Designer's importer rejects a root without it. |
| `version` | string | Semver. Mission Commander and Mission Designer read a missing value as `"1.0.0"`. |
| `last_modified_date` | string | ISO 8601 UTC. |
| `steps` | array | See §1.5. |
| `connections` | array | See §1.6. |

### Optional (root)

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | string | `"5.0"` when written by Mission Designer. See §1.1. |
| `description` | string | |
| `type_name` | string | Optional ISA 88 type (e.g. `Operation`), at most 50 characters. Informational only; never affects execution. Omitted when unset. Also allowed on each child workflow. On import, a non-string, blank or over-long value is dropped. |
| `state` | string | Lifecycle state: `Draft` / `InTest` / `InReview` / `Approved` / `Effective` / `Superseded` / `Obsolete`. Mission Commander and Mission Designer read a missing value as `"Draft"`. Mission Commander keys a loaded workflow on (work center, `oid`, `version`, `state`). |
| `library_name`, `library_oid` | string | Name and oid of the Mission Designer library the workflow lives in. Provenance only; Mission Commander records them. |
| `display_style` | `"flowchart"` \| `"bpmn"` \| `"isa88"` | Authoring notation only; the engine ignores it. Mission Commander uses it to draw the workflow diagram. |
| `viewport` | `{ x, y, zoom }` numbers | Editor pan/zoom. |
| `resource_property_specifications` | array | Workflow-scoped resources, §1.7.4. |
| `resource_command_specifications` | array | Allowed by the schemas; Mission Designer does not emit workflow-level resource commands. |
| `starting_parameter_specifications` | array | Workflow inputs, §1.7.1. |
| `output_parameter_specifications` | array | Workflow outputs, §1.7.2. |
| `value_property_specifications` | array | Workflow Value Properties, §1.7.3. |
| `try_specifications` | array | Workflow-level TRY fallback rows, §1.5.11. |
| `environment_specifications` | array | The environments the workflow is attached to, each embedded in full (§1.8). |
| `children` | array | Embedded child workflows, §1.4. |

### Semantic rules (enforced by Mission Engine when a runtime workflow starts)

Mission Engine's validator (`MissionEngine/src/spec/validator.ts`) applies these to the root workflow before it runs anything. Step types are compared after replacing `_` with a space, so `YES_NO` and `YES NO` are the same type.

1. Every step carries `local_id`, `oid`, `version`, `last_modified_date` and `step_type`; every connection carries `from_step_id` and `to_step_id`.
2. All step `oid` values are unique within the spec.
3. Exactly one step with `step_type: "START"`; at least one with `step_type: "END"`.
4. Every `connections[*].from_step_id` and `to_step_id` references an existing step `oid`.
5. No self-referencing connections (`from_step_id === to_step_id`).
6. Every step is reachable from the START step via BFS over `connections`, except the steps of a catch network (a CATCH step and the steps it leads to, §1.5.11).
7. Every `PARALLEL` step reaches a `WAIT ALL` on its downstream paths.
8. Cycles ARE allowed (used for retry loops via `WAIT ANY`).
9. The TRY/CATCH/RETURN rules of §1.5.11, the GATE rules of §1.5.9, the repeating-SCRIPT rules of §1.5.3, the ACTION PROXY rules of §1.5.10, and the resource rules of §1.7.4 – §1.7.5 (the resource rules also walk `children[]`).
10. Every `action_server_specifications[*].uri` that is not blank must be an `http(s)` URI.
11. The workflow then passes the structural (JSON Schema) check.

Violations surface as one error code: `MISSING_REQUIRED_FIELD`, `DUPLICATE_STEP_OID`, `NO_START_STEP`, `MULTIPLE_START_STEPS`, `NO_END_STEP`, `DANGLING_CONNECTION`, `SELF_REFERENCING_CONNECTION`, `ORPHANED_STEP`, `UNMATCHED_PARALLEL`, `INVALID_STEP_TYPE`, `INVALID_FORM_ELEMENT_TYPE`, `INVALID_RESOURCE_COMMAND`, `INVALID_RESOURCE_SPEC`, `INVALID_VALIDATION` (ACTION PROXY configuration, action-server URI), and the TRY/CATCH/RETURN, GATE and SCRIPT codes listed in their sections.

Non-fatal findings ride along on a successful result as `warnings` (Mission Engine records each as a `WARNING` trace row when the runtime workflow starts): `UNBOUND_FORM_INPUT` (§1.12), `ESIGNATURE_MULTIPLE_BLOCKS` (§1.12), and the binding advisories `GATE_BINDING_UNKNOWN_ENVIRONMENT`, `GATE_BINDING_UNKNOWN_PARAMETER`, `INPUT_BINDING_UNKNOWN_ENVIRONMENT`, `INPUT_BINDING_UNKNOWN_PARAMETER` and `INPUT_BINDING_ON_GATE_IGNORED` (§1.5.12).

## 1.4 ChildWorkflowExport (v7.0) and `child_workflows` (deprecated)

### v7.0 `children[]` — the only child source

Each entry is identical to `MasterWorkflowSpecification` **plus** the fields below. `version` and `state` are required (not defaulted) on every child.

```json
{
  "schemaVersion":     "5.0",
  "local_id":          "Safety Check",
  "oid":               "2f6d1a8e-1b2c-4d3e-8f90-123456789abc",
  "version":           "1.0.0",
  "state":             "Draft",
  "last_modified_date":"2026-04-24T12:00:00.000Z",
  "parentChildSpecId": null,
  "steps":             [ /* ... */ ],
  "connections":       [ /* ... */ ],
  "children":          [ /* nested grandchildren */ ]
}
```

| Field | Type | Rule |
|-------|------|------|
| `parentChildSpecId` | `string \| null` | **Required.** `null` = direct child of the root workflow. Otherwise, the oid of the parent `ChildWorkflowExport` at the level above in the same `children` tree. |
| `version` | string | **Required** on children. Mission Designer writes the root workflow's version on every child. |
| `state` | string | **Required** on children. Mission Designer writes the root workflow's state on every child. |
| `children` | array | Nested grandchildren; omitted when empty. |

In a `.WFmasterX`, Mission Designer writes no `environment_specifications` on a child: the engine resolves a child step's environment references against the root workflow's environments.

A `WORKFLOW PROXY` step resolves to a child by **exact `local_id` match** against the `children[]` of the workflow that contains the step (the step's `local_id` equals the child's `local_id`). If several children share a `local_id`, the first one wins — keep names unique.

When the proxy step runs, the child's `starting_parameter_specifications` are filled from the proxy step's resolved `input_parameter_specifications` with the same `id`. When the child finishes, each child output whose `id` matches one of the proxy step's `output_parameter_specifications` is written to that proxy output's `target`; the value read is the child's property named by the output `id`.

### v6.0 `child_workflows[]` — no longer read

Pre-v7.0 packages stored children as a flat `MasterWorkflowSpecification[]` under `child_workflows`. Mission Designer's importer drops the field (and logs a warning when it is the only child source); Mission Engine reads only `children`. New exporters MUST emit `children`.

## 1.5 MasterWorkflowStep

Every step inherits `ManagedElement` plus `step_type`. The `step_type` discriminant selects which optional config object applies.

### 1.5.1 Step type enum (case- and whitespace-literal)

| Value | Semantics | Operator involved |
|-------|-----------|-------------------|
| `"START"` | Entry point. Exactly one per workflow. | No |
| `"END"` | Terminal. At least one. | No |
| `"PARALLEL"` | Fan-out to all successors. | No |
| `"WAIT ALL"` | Fan-in; completes when all predecessors are done. | No |
| `"WAIT ANY"` | Fan-in; completes when any predecessor is done. | No |
| `"SELECT 1"` | Routed choice; follows one outgoing connection by condition. See §1.5.4. | No |
| `"YES_NO"` | Binary operator choice. See §1.5.5. | Yes |
| `"USER_INTERACTION"` | Operator form screen. See §1.5.6 / §1.12. | Yes |
| `"SCRIPT"` | Runs a script, once or repeatedly. See §1.5.3. | No |
| `"GATE"` | Cyclic boolean transition and/or timer. See §1.5.9. | No |
| `"ACTION PROXY"` | Invokes an environment action on an action server. See §1.5.10. | No |
| `"WORKFLOW PROXY"` | Runs a child workflow (matched by `local_id`, §1.4). | No |
| `"CATCH"` | Entry point of a catch network that handles a TRY. See §1.5.11. | No |
| `"RETURN"` | Exit of a catch network; tells the engine how to continue. See §1.5.11. | No |

Underscores in `"YES_NO"` and `"USER_INTERACTION"` are literal — do not convert to spaces. Spaces in `"SELECT 1"`, `"WAIT ALL"`, `"WAIT ANY"`, `"ACTION PROXY"`, `"WORKFLOW PROXY"` are literal — do not convert to underscores.

Retired values: Mission Designer's importer still maps `"WAIT ACTION PROXY"`, `"NOWAIT ACTION PROXY"` and `"MATH"` from old packages onto an ACTION PROXY step, but never writes them. Mission Engine's schema still lists `"MATH"`; no current tool emits it.

The editor's internal representation uses camelCase node types (`start`, `select1`, `userInteractionStep`, `actionProxyWait`, `workflowProxy`, …). Exporters MUST translate to the canonical form (Part 4).

### 1.5.2 Required step fields

```json
{
  "local_id":           "Check Pressure",
  "oid":                "7000000000011",
  "version":            "1.0.0",
  "last_modified_date": "2026-04-24T12:00:00.000Z",
  "step_type":          "USER_INTERACTION",
  "position":           { "x": 100, "y": 250 }
}
```

`position` is optional but recommended — editors reuse it to restore canvas layout on round-trip. Mission Designer writes `version: "1.0.0"` and the export time as `last_modified_date` on every step.

### 1.5.3 SCRIPT → `script_config`

```json
{
  "step_type": "SCRIPT",
  "script_config": {
    "language": "javascript",
    "source":   "output.result = String(Number(threshold) * 2)",
    "repeat": {
      "cycle_seconds":      5,
      "time_limit_seconds": 600,
      "on_time_limit":      "error"
    }
  }
}
```

Mission Engine runs the source as **JavaScript** in a sandbox (`node:vm`) and does not read `language`; Mission Designer writes `"javascript"`. Each input parameter is a local variable named by its `id`, holding a string. The script writes results to an `output` object; each key is stored through the step's `output_parameter_specifications` (§1.7.2).

`repeat` (optional) turns the step into a repeating script: it runs every `cycle_seconds` until it returns `true`. Mission Designer writes `repeat` only when Repeat until done is on.

| Field | Type | Rule |
|-------|------|------|
| `cycle_seconds` | number | 1 – 31,449,600. Mission Designer always writes it (default 5). |
| `time_limit_seconds` | integer | Whole seconds, 1 – 31,449,600. Absent = no time limit. |
| `on_time_limit` | `"error"` \| `"complete"` | Only with `time_limit_seconds`. `error` fails the step (TRY-routable); `complete` commits the outputs set so far and completes the step. |

Validation codes: `INVALID_SCRIPT_REPEAT`, `INVALID_SCRIPT_CYCLE`, `INVALID_SCRIPT_TIME_LIMIT`, `INVALID_SCRIPT_TIME_LIMIT_ACTION`, `SCRIPT_TIME_LIMIT_ACTION_WITHOUT_LIMIT`.

### 1.5.4 SELECT 1 → `select1_config` + routed connections

```json
{
  "step_type": "SELECT 1",
  "select1_config": {
    "input_name":       "Status.Value",
    "input_value_type": "property",
    "options": [
      { "id": "opt-open",    "label": "Open",    "operator": "==", "value": "open",   "value_type": "literal", "is_default": false },
      { "id": "opt-closed",  "label": "Closed",  "operator": "==", "value": "closed", "value_type": "literal", "is_default": false },
      { "id": "opt-pending", "label": "Pending", "operator": "!=", "value": "open",   "value_type": "literal", "is_default": true  }
    ]
  }
}
```

Each outgoing connection from a `SELECT 1` step MUST set `connection_id` to one of `select1_config.options[*].id`; the engine follows the connection whose `connection_id` equals the chosen option's `id`. Mission Designer also writes the option id as that connection's `source_handle_id`. Operators (Mission Engine schema): `"=="`, `"!="`, `"<"`, `">"`, `"<="`, `">="`, `"Contains"`, `"Not Contains"`.

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

Mission Designer takes the labels from the step's `YesNoButtons` UI parameter (§1.5.6) and always writes `yes_value: "true"` and `no_value: "false"`; it omits `yes_no_config` when the step has neither. Connections from a `YES_NO` step carry `source_handle_id ∈ {"yes", "no"}` to identify the branch; the engine matches the answer `"true"` to `"yes"` and `"false"` to `"no"`. `default_selection ∈ {"yes", "no", "none"}`.

### 1.5.6 USER_INTERACTION / YES_NO → `form_document` and `ui_parameter_specifications`

A schema 5.0 operator step carries its form as a **v2 form document** in `form_document` (§1.12). Mission Designer writes `form_document` only on `USER_INTERACTION` and `YES_NO` steps, and only when the form holds at least one block. The v1 per-device layout `form_layout_config` is no longer written; it is still read from 4.0 packages (§1.12.2).

`ui_parameter_specifications[]` (legacy vertical-stack content) is still written for any step that has UI parameters; a `YES_NO` step's `YesNoButtons` entry supplies the yes/no labels (`value` = Yes label, `value2` = No label). Element shape:

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

Mission Designer omits `lines` unless it is above 1 and `align` unless it is not `left`. An `Image` entry's `value` is a bare filename in `images/` (§2.2).

### 1.5.7 Per-step parameter & resource arrays

Every step type MAY carry any of:

| Field | Schema |
|-------|--------|
| `input_parameter_specifications` | array of §1.7.1 |
| `output_parameter_specifications` | array of §1.7.2 |
| `value_property_specifications` | array of §1.7.3 |
| `resource_command_specifications` | array of §1.7.5 (not on a GATE, §1.5.9) |
| `connection_references` | string[] — allowed by the schemas; Mission Designer does not write it |
| `action_visibility` | `"opaque"` \| `"observable"` (Mission Designer writes it on every `ACTION PROXY`, default `"opaque"`) |
| `action_property_bindings` | array of §1.5.12 (non-GATE steps) |
| `try_specifications` | array of §1.5.11 (TRY-capable steps only) |

A `CATCH` step always exports four canonical outputs describing what was caught, even if the saved step data lacks them.

### 1.5.8 Form image registry

When a step's form uses image blocks, the step also carries a stable filename registry so a consumer can resolve the ZIP entry by `imageOid`:

```json
"form_element_images": [
  { "image_oid": "7000000123456", "filename": "engine-closeup.jpg" }
]
```

Mission Designer builds it from the `form_document` image blocks that have both an `imageOid` and a local `src` (not `http(s)://`, not `data:`, not the `"No image selected"` placeholder), one entry per `imageOid`. The ZIP entry is `images/{image_oid}-{filename}` (e.g. `images/7000000123456-engine-closeup.jpg`); a block without an `imageOid` is packaged as `images/{stepOid}-{filename}`. Mission Commander resolves a filename as: bare `images/{filename}` first, then `images/{imageOid}-{filename}`, then any entry ending in `-{filename}`; Mission Designer's importer accepts the bare name, `{specOid}-{filename}`, or any entry ending in `-{filename}`.

### 1.5.9 GATE → `gate_config`

A GATE holds the flow until its condition is true and/or its timer expires. Every field is optional; an absent `gate_config` means a 5-second cycle, no bindings and an immediately open gate.

```json
{
  "step_type": "GATE",
  "gate_config": {
    "cycle_seconds": 5,
    "language": "javascript",
    "source": "return Number(temperature) >= 180",
    "control_previous_action": true,
    "mode": "condition_or_timer",
    "delay_seconds": 900,
    "action_property_bindings": [
      { "parameter_id": "temperature", "environment_oid": "…", "environment_name": "Kitchen", "property": "Oven.Temperature" }
    ]
  }
}
```

| Field | Type | Rule |
|-------|------|------|
| `cycle_seconds` | number | Re-evaluation interval, 1 – 31,449,600. |
| `language`, `source` | string | Script the engine evaluates each cycle (JavaScript, inputs as in §1.5.3, no `output` object); the gate opens when it returns a truthy value. No source = open at once. |
| `control_previous_action` | boolean | Written only as `true`. When the GATE is the sole successor of an ACTION PROXY, the two run concurrently and an opening gate STOPs the still-running action. Absent = the gate starts after its predecessor completes. |
| `mode` | `"condition"` \| `"timer"` \| `"condition_or_timer"` | Absent = `condition`. `timer` opens after `delay_seconds` and evaluates no script; `condition_or_timer` opens on whichever comes first. Mission Designer writes `mode` only for the two timed modes. |
| `delay_seconds` | integer | Whole seconds, 1 – 31,449,600. Required with a timed mode, forbidden otherwise. |
| `action_property_bindings` | array | §1.5.12; re-read on every evaluation. Never written for a `timer` gate. |

Rules (Mission Engine): exactly one incoming and one outgoing connection (`GATE_WRONG_DEGREE`); no `resource_command_specifications` (`GATE_RESOURCES_UNSUPPORTED`); other codes `INVALID_GATE_CYCLE`, `INVALID_GATE_MODE`, `GATE_DELAY_REQUIRED`, `GATE_DELAY_WITHOUT_TIMER`, `INVALID_GATE_DELAY`.

### 1.5.10 ACTION PROXY → `action_proxy_config`

Every `ACTION PROXY` step MUST carry the runtime identity of the action it invokes:

```json
{
  "step_type": "ACTION PROXY",
  "action_visibility": "observable",
  "action_proxy_config": {
    "action_oid":       "a3c1…",
    "environment_oid":  "e7f2…",
    "action_name":      "Preheat Oven",
    "environment_name": "Kitchen",
    "timeout_ms":       600000
  }
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `action_oid` | Yes | Oid of the action in the environment's `included_actions[]` roster (§1.8). |
| `environment_oid` | Yes | Oid of one of the workflow's `environment_specifications[]`. |
| `action_name` | No (5.0+) | The bound action's name — equal to the roster entry's `action_name`. |
| `environment_name` | No (5.0+) | The environment's name — equal to the embedded environment's `local_id`. |
| `timeout_ms` | No | Authored time limit in milliseconds. Absent = no time limit. |

Mission Designer derives the identity on every export by name, from the same environment roster it embeds, so the oids always agree with the package; it falls back to the step's stored config only when nothing resolves by name.

Mission Engine rejects (`INVALID_VALIDATION`) a step with no `action_proxy_config`, without `action_oid` or `environment_oid`, whose `environment_oid` names no embedded environment **and** that has no `environment_name`, or whose `action_oid` is not in that environment's roster **and** that has no `action_name`. A config carrying the names therefore survives a stale oid: the engine resolves the action inside the package by name, and an action server set to loose matching resolves it by name too.

### 1.5.11 TRY / CATCH / RETURN

TRY rows route a failing step to a catch network:

```json
"try_specifications": [
  { "mode": "ERROR",   "catch_id": "handle-errors", "release_on_catch": true },
  { "mode": "TIMEOUT", "catch_id": "handle-timeout" }
]
```

| Field | Rule |
|-------|------|
| `mode` | `"ERROR"` \| `"ABORT"` \| `"TIMEOUT"`; at most one row per mode. |
| `catch_id` | Must equal the `catch_id` of a CATCH step in the same workflow. |
| `release_on_catch` | Optional boolean. |

`try_specifications` is allowed on `ACTION PROXY`, `SCRIPT`, `GATE`, `USER_INTERACTION`, `YES_NO` and `WORKFLOW PROXY` steps, and at workflow level (consulted when the failing step has no matching row of its own).

- **CATCH** carries a unique `catch_id` and has 0 incoming and 1 outgoing connection.
- **RETURN** has 1 incoming and 0 outgoing connections and carries `return_config`:

```json
"return_config": { "command": "GOTO", "goto_step_oid": "7000000000011" }
```

`command ∈ {"ABANDON", "RESTART", "GOTO", "RETRY", "COMPLETE"}`; `RESTART` requires `restart_mode ∈ {"CLEAN", "KEEP"}`; `GOTO` requires `goto_step_oid`, which must name a step outside every catch network. Mission Designer writes `{ "command": "ABANDON" }` for a RETURN left at its default. No connection may cross between the main flow and a catch network.

Validation codes: `CATCH_WRONG_DEGREE`, `RETURN_WRONG_DEGREE`, `TRY_ON_INVALID_STEP`, `INVALID_TRY_MODE`, `DUPLICATE_TRY_MODE`, `INVALID_RETURN_COMMAND`, `MISSING_RESTART_MODE`, `INVALID_RESTART_MODE`, `MISSING_GOTO_TARGET`, `DUPLICATE_CATCH_ID`, `UNMATCHED_TRY`, `GOTO_TARGET_NOT_FOUND`, `GOTO_TARGET_IN_CATCH`, `CROSS_NETWORK_EDGE`. A CATCH no TRY refers to is accepted.

### 1.5.12 Action Property bindings

An input parameter with `value_type: "property"` whose `default_value` names an environment **Action Property** (`action_property_specifications`, §1.8) is read live from that environment's action server. Mission Designer derives the bindings at export time:

```json
{ "parameter_id": "temperature", "environment_oid": "e7f2…", "environment_name": "Kitchen", "property": "Oven.Temperature" }
```

| Field | Required | Meaning |
|-------|----------|---------|
| `parameter_id` | Yes | An `input_parameter_specifications[].id` on the same step. |
| `environment_oid` | No | Environment that declares the Action Property. |
| `environment_name` | No | That environment's `local_id`; the engine tries the oid first, then the name. |
| `property` | Yes | Dotted `Property.Entry`; the bare property name means the whole property. |

On a GATE the bindings live in `gate_config.action_property_bindings` and are re-read every cycle; on any other step they live in the step's own `action_property_bindings` and are read once when the step starts. A Value Property of the same name anywhere in scope wins (no binding is written). When several environments declare the property, Mission Designer prefers the step's own ACTION PROXY environment, then the preceding ACTION PROXY's, then the first in spec order (with an export warning).

## 1.6 Connection

```json
{
  "from_step_id":     "7000000000001",
  "to_step_id":       "7000000000011",
  "connection_id":    "opt-open",
  "source_handle_id": "opt-open",
  "condition":        "Status.Value == open",
  "waypoints":        [ { "x": 0, "y": -20 } ]
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `from_step_id` | Yes | Step `oid`. |
| `to_step_id` | Yes | Step `oid`. Must differ from `from_step_id`. |
| `connection_id` | No | **Required-by-convention** on `SELECT 1` outgoing edges, where it equals an option `id`. |
| `source_handle_id` | No | `"yes"` / `"no"` on `YES_NO` outgoing edges; the option `id` on `SELECT 1` edges. |
| `condition` | No | Free-form condition text. Authoritative SELECT 1 routing is `select1_config` + `connection_id`; the engine also matches `condition` against a YES_NO answer or a button's value as a fallback. |
| `waypoints` | No | Editor bend points. `waypoints[0] = { x, y }` is an offset (delta) from the default midpoint that the editor's orthogonal router computes, not an absolute canvas point. Only `waypoints[0]` is read; longer arrays are reserved. The routing algorithm is in `MissionDesigner/docs/specs/07-connection-waypoint-routing.md`. |

## 1.7 Parameters and resources

### 1.7.1 InputParameter (workflow inputs, step inputs, action inputs)

```json
{
  "id":            "greeting",
  "oid":           "7000000000101",
  "description":   "Greeting text shown on first screen",
  "default_value": "Welcome",
  "value_type":    "property",
  "json_schema":   "{\"type\":\"string\"}",
  "entries":       [ { "name": "subkey", "value": "default" } ]
}
```

Required: `id`, `default_value`. `value_type ∈ {"literal","property"}`; absent ≡ `"literal"`, and Mission Designer writes the key only for `"property"`. With `"property"`, `default_value` is a property reference (`Property` or `Property.Entry`) resolved when the value is needed. `json_schema` is a stringified JSON Schema (a string, not an embedded object).

For `starting_parameter_specifications`: a value supplied when the runtime workflow is created (always a string) wins; otherwise the engine uses `default_value`, resolved through the property store when `value_type` is `"property"`. Each starting parameter is also stored as a property under its `id`. Mission Commander rejects values for ids the workflow does not declare, unless the caller asks it to drop them (Mission Broker's Create Runtime Workflow does so under loose matching).

### 1.7.2 OutputParameter (workflow outputs, step outputs, action outputs)

```json
{
  "id":          "result",
  "oid":         "7000000000102",
  "description": "Final result value",
  "target":      "Response.Value",
  "entries":     []
}
```

Required: `id`. `target` is the property key (`Property` or `Property.Entry`) where the runtime stores the value. Mission Designer writes `target` on every output, using the output's own name when none is authored. A workflow-level output whose `target` names a whole Value Property returns that property's entries as a JSON array of `{name, value}`.

### 1.7.3 ValueProperty (workflow- or step- or env-scoped values)

```json
{
  "name":    "Response",
  "oid":     "7000000000103",
  "entries": [
    { "name": "Value",  "value": ""        },
    { "name": "Status", "value": "pending" }
  ]
}
```

Required: `name`. Addressed in expressions and `target` references as `Name.EntryName`. Mission Engine's schema requires `entries` (Mission Designer always writes it).

### 1.7.4 ResourceProperty

```json
{
  "name":          "Printer",
  "resource_type": "binary exclusive use",
  "scope":         "workflow",
  "use_limit":     2,
  "description":   "Shared printer",
  "names":         ["HP-001", "HP-002"]
}
```

Required: `name`, `resource_type`. `scope ∈ {"workflow", "environment"}` (Mission Designer writes it). `use_limit` is written only when the count is above 1. `resource_type` ∈ exactly one of:

| Value | Purpose | Required extras |
|-------|---------|-----------------|
| `"binary exclusive use"` | Mutex. | — |
| `"binary shared use with pool limits"` | Semaphore up to `use_limit`. | `use_limit` > 0 |
| `"countable use with pool limits"` | Quantified pool. | `use_limit` > 0 |
| `"named pool"` | Named-slot pool. | `names[]` non-empty |
| `"sync"` | Rendezvous channel (`Send`/`Receive`/`Synchronize`). | — |

A missing extra fails with `INVALID_RESOURCE_SPEC`.

### 1.7.5 ResourceCommand

```json
{
  "oid":                  "7000000000104",
  "command_type":         "Acquire",
  "resource_name":        "Printer",
  "resource_source_type": "workflow",
  "resource_source_oid":  "0d7f4b4e-6a0f-4a55-9b7e-2f1f3c1a9e10",
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

`resource_source_type ∈ {"workflow", "environment"}`; `resource_source_oid` = oid of the workflow (root or child) or embedded environment that declares the resource. Mission Designer resolves both on export from the live tree, and rewrites Acquire/Release on a countable resource to the pool commands (with `amount` 1 when none is authored). A command naming an unknown source or resource, or an incompatible type, fails with `INVALID_RESOURCE_COMMAND`.

## 1.8 EnvironmentSpecification

Embedded under a workflow's `environment_specifications[]` and, inside a `.WFmasterX`, also packaged in its environment library under `environments/` (§2.2). Inside a `MasterEnvironmentLibrary` (§1.9) it lives under `environment_specifications[]`.

```json
{
  "local_id":           "Kitchen",
  "oid":                "e7f2…",
  "description":        "Line 1 kitchen",
  "version":            "1.0.0",
  "last_modified_date": "2026-04-24T00:00:00.000Z",
  "library_name":       "Kitchen Library",
  "library_oid":        "9c0d…",
  "state":              "Approved",
  "included_actions": [
    {
      "action_library":     "Oven Controls",
      "action_name":        "Preheat Oven",
      "local_id":           "Preheat Oven",
      "oid":                "a3c1…",
      "description":        "Heats the oven",
      "version":            "1.0.0",
      "last_modified_date": "2026-04-24T00:00:00.000Z",
      "input_parameter_specifications":  [ /* §1.7.1 */ ],
      "output_parameter_specifications": [ /* §1.7.2 */ ],
      "property_specifications":         [ /* §1.7.3 */ ],
      "action_visibility":  "observable"
    }
  ],
  "value_property_specifications":    [ /* §1.7.3 */ ],
  "action_property_specifications":   [ /* §1.7.3 */ ],
  "resource_property_specifications": [ /* §1.7.4 */ ],
  "action_server_specifications": [
    { "name": "primary", "uri": "https://actions.example.com", "connection_type": "REST" }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `local_id`, `oid`, `version`, `last_modified_date` | Yes | ManagedElement. `local_id` is the environment's name (what `action_proxy_config.environment_name` and binding `environment_name` refer to). |
| `library_name`, `library_oid` | No | The environment library the environment lives in. Mission Designer's importer links a workflow to its environments by `library_name` (§2.2). |
| `state` | No | Lifecycle state. Mission Commander keys a loaded environment on (work center, `oid`, `version`, `state`), reading a missing state as `"Draft"`. |
| `included_actions[]` | Yes | The action roster. Each entry binds an action by `action_name` + `action_library` (the cross-package join keys) and, when Mission Designer could resolve the action at export time, inlines the full action body with the same field names as a `.WFaction` action (`local_id`, `oid`, `description`, `version`, `last_modified_date`, parameter and property arrays, `action_visibility`). An entry without `oid` is unresolved. Mission Engine reads the roster oid as `action_oid ?? oid`: Mission Designer writes `oid`; `action_oid` (with `action_version` / `action_last_modified_date`) is an older spelling the engine schema still accepts. |
| `value_property_specifications` | No | Environment Value Properties. |
| `action_property_specifications` | No | Action Properties — values held on the action server and readable live by bound inputs (§1.5.12). |
| `value_type_specifications` | No | Mission Designer authoring templates; written **only** into Mission Designer library packages (`.WFenvirLibX`, `.WFlibX`, `.WFstepLibX`), never into `.WFmasterX` or `.WFenvirX`. Entry shape: `{ name, oid?, description?, entries: [{ name, value? }] }`, entries in authored order. |
| `resource_property_specifications` | No | Environment resources (`scope: "environment"`). |
| `action_server_specifications[]` | No | `{ name, uri, description?, connection_type, api_key? }`. `connection_type` is always `"REST"`. A blank `uri` is allowed — the server is then bound per work center in Mission Commander; a non-blank `uri` must be `http(s)`. The base URL for the REST protocol (REST_Protocol.md) is `<uri>/trajectory/v1/`. |

## 1.9 MasterEnvironmentLibrary

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/master-environment-library.json",
  "title": "Master Environment Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["environment_specifications"],
  "properties": {
    "parent_library_oid": { "type": "string" },
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
  "$id": "https://trajectorypro.io/schemas/master-action-library.json",
  "title": "Master Action Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["action_specifications"],
  "properties": {
    "parent_library_oid": { "type": "string" },
    "action_specifications": {
      "type": "array",
      "items": {
        "type": "object",
        "allOf": [{ "$ref": "managed-element.json" }],
        "properties": {
          "state":                           { "type": "string", "enum": ["Draft", "InTest", "InReview", "Approved", "Effective", "Superseded", "Obsolete"] },
          "input_parameter_specifications":  { "type": "array", "items": { /* §1.7.1 */ } },
          "output_parameter_specifications": { "type": "array", "items": { /* §1.7.2 */ } },
          "property_specifications":         { "type": "array", "items": { /* §1.7.3 */ } },
          "action_visibility":               { "type": "string", "enum": ["opaque", "observable"] }
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

Mission Designer writes `action_visibility` on every action (default `"opaque"`) and no `state`. Mission Autopilot's exports also carry `timeout_seconds` (the action's default time limit) on each action, and its `.WFenvirX` actions carry `state`.

`action_visibility` is the contract the action server honours at invoke time:

- `"opaque"` — the action runs through the opaque states (`POSTED`, `RECEIVED`, `IN_PROGRESS`, `COMPLETED`); the invoker polls or waits for the terminal state.
- `"observable"` — the action runs through the observable state machine and publishes its state transitions; the invoker may send commands such as `PAUSE`, `RESUME`, `HOLD`, `UNHOLD`, `ABORT`, `STOP` and `CLEAR`.

The commands each visibility accepts in each state are defined in [REST_Protocol.md](./REST_Protocol.md).

## 1.11 MasterWorkflowStepLibrary

Reusable workflows packaged for cross-workflow reuse (a WORKFLOW PROXY can reference one; the reference is resolved into an embedded child on `.WFmasterX` export). Same shape as a `MasterWorkflowLibrary`, distributed in `.WFstepLibX` ZIPs (§2.4).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/master-workflow-step-library.json",
  "title": "Master Workflow Step Library",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["workflow_specifications"],
  "properties": {
    "parent_library_oid": { "type": "string" },
    "workflow_specifications": {
      "type": "array",
      "items": {
        "type": "object",
        "allOf": [{ "$ref": "managed-element.json" }],
        "required": ["steps", "connections"]
      }
    },
    "child_libraries": {
      "type": "array",
      "items": { "$ref": "#" }
    }
  }
}
```

Each `workflow_specifications[]` entry is a full `MasterWorkflowSpecification` (§1.3).

## 1.12 Forms (`form_document`; legacy `form_layout_config`)

`USER_INTERACTION` and `YES_NO` steps carry their operator form as a **Form Document v2** in `form_document`. The schema belongs to Mission FormKit (`MissionFormKit/packages/form-schema/src/schema/form-document.json`, `$id` `https://trajectorypro.io/schemas/form-document.json`); Mission Designer keeps an identical copy in `src/lib/schemas/form-document.json` and validates every imported `form_document` against it (an invalid one fails the import with `invalid_form_document`). The document is exported verbatim: block, row and section ids are kept.

The schema sets `additionalProperties: false` on every object, so a writer MUST NOT add fields. Ids are non-empty strings and must be unique across the whole document (sections, rows and blocks).

```json
"form_document": {
  "version": 2,
  "sections": [
    {
      "id": "7000000200001",
      "role": "content",
      "rows": [
        {
          "id": "7000000200002",
          "gap": "md",
          "blocks": [
            { "id": "7000000200003", "type": "header", "content": "<p>Voltage Check</p>", "size": "2xl", "sizeAt": { "phone": "xl" }, "fontWeight": "bold" },
            { "id": "7000000200004", "type": "textInput", "fieldName": "voltage", "label": "Voltage", "inputMode": "number", "required": true, "outputParameter": "Voltage", "layout": { "span": { "base": 6, "phone": 12 } } }
          ]
        }
      ]
    },
    {
      "id": "7000000200005",
      "role": "footer",
      "rows": [
        { "id": "7000000200006", "blocks": [
          { "id": "7000000200007", "type": "button", "job": "continue", "label": "", "outputValue": "continue", "emphasis": "primary", "layout": { "align": "end" } }
        ] }
      ]
    }
  ]
}
```

### 1.12.1 Document structure

| Object | Fields |
|--------|--------|
| Document | `version` (**required**, the constant `2`), `sections[]` (**required**). |
| Section | `id`, `role` (`"content"` \| `"footer"`), `rows[]` — all required. A `footer` section is the form's **bottom bar**; renderers draw it below the content. Mission Designer lets an author drop only buttons there and drops empty footer sections on save. |
| Row | `id`, `blocks[]` (at least one block) required; `gap` optional (space token). |
| Block | `id`, `type` required; `layout` optional on every block (required on `image`). |

Tokens: space `none | xs | sm | md | lg | xl`; type size `xs | sm | md | lg | xl | 2xl | 3xl`; grid span 1 – 12.

**Per-breakpoint values.** `layout.span`, `layout.order` and `layout.visible` are `{ base, tablet?, phone? }`; `base` is the desktop value and resolution is `phone ?? tablet ?? base`.

**Block `layout`:**

| Field | Type | Meaning |
|-------|------|---------|
| `span` | `{ base, tablet?, phone? }` of 1 – 12 | Grid columns occupied (of 12). Default 12. |
| `order` | `{ base, tablet?, phone? }` of integers 1 – 12 | Reflow order within the row. |
| `visible` | `{ base, tablet?, phone? }` of booleans | Hide the block at a breakpoint. Default `true`. |
| `minHeight` | space token \| `{ rem }` | Minimum height. |
| `maxWidth` | `{ ch }` \| `{ rem }` | Readable-measure / media cap. |
| `aspectRatio` | string `"W/H"` (e.g. `"16/9"`) | Required on image blocks. |
| `align` | `"start"` \| `"center"` \| `"end"` | Alignment inside the grid cell. On a **button** it also sets the horizontal position (start = left, center = middle, end = right). |

**Per-device text size.** Blocks that show text carry `size` (the desktop type token) and `sizeAt` (`{ tablet?, phone? }` overrides); resolution is `phone ?? tablet ?? size`. `sizeAt` is allowed on `text`, `header`, `textInput`, `textarea`, `checkbox`, `radio`, `timer` and `button`.

**Block types** (`type` is a permanent key):

| `type` | Required | Optional |
|--------|----------|----------|
| `text` / `header` | `content` (sanitised HTML string) | `size`, `sizeAt`, `fontWeight` (`normal`\|`bold`), `color`, `align` (`left`\|`center`\|`right`) |
| `textInput` | `fieldName` (non-empty) | `label`, `placeholder`, `required`, `inputMode` (`text`\|`number`\|`phone`\|`password`\|`dropdown`\|`combobox`), `listItems[]` (`{label, value}`), `listSource`, `outputParameter`, `defaultSource`, `placeholderSource`, `size`, `sizeAt` |
| `textarea` | `fieldName` | `label`, `placeholder`, `required`, `rows` (≥ 1), `outputParameter`, `defaultSource`, `placeholderSource`, `size`, `sizeAt` |
| `checkbox` / `radio` | `fieldName`, `options[]` (`{label, value}`) | `label`, `required`, `listSource`, `outputParameter`, `size`, `sizeAt` |
| `image` | `src` (non-empty), `layout.aspectRatio` | `imageOid`, `objectFit` (`contain`\|`cover`\|`fill`), `scalePercent` (integer 10 – 300) |
| `video` | `src` | `posterUrl` |
| `divider` | — | `weight` (`hairline`\|`thick`), `color` |
| `timer` | `label`, `fieldName`, `durationSeconds` (integer ≥ 1), `direction` (`countdown`\|`countup`) | `blockDone`, `outputParameter`, `defaultSource`, `size`, `sizeAt` |
| `button` | `label`, `outputValue` (non-empty) | `job` (`continue`\|`yes`\|`no`), `emphasis` (`primary`\|`secondary`), `color`, `deletable`, `size`, `sizeAt` |
| `esignature` | `fieldName` | `label`, `meaning`, `roleName`, `requireDifferentUser`, `outputParameter` |

`defaultSource` / `placeholderSource` are `{ mode, value }` with `mode ∈ {"static", "property", "input"}`. `listSource` is `{ "mode": "static" }` or `{ "mode": "input", "value": "<input parameter>" }`.

`content` is an HTML string; v2 has no `{ content, plainText }` wrapper.

**Buttons and jobs.** A button with a `job` does the step's own work: `continue` advances a USER_INTERACTION step; `yes` and `no` answer a YES_NO step. Mission Designer writes `outputValue` as `"continue"`, `"true"` or `"false"` for the three jobs. An empty `label` means the host's label for that job, else the default word (`Continue`, `Yes`, `No`). A button without a job is an ordinary action button that emits its `outputValue`. A host hides its own Continue/Yes/No buttons only when the form has job buttons and passes FormKit's never-stuck check: every breakpoint shows the jobs the step needs (`continue` for USER_INTERACTION; `yes` and `no` for YES_NO), and no button carries a job the step cannot use.

**Capture and gating.** On submit, each input block's value is stored under `outputParameter`: when it equals the `id` of one of the step's `output_parameter_specifications`, the value goes to that output's `target`; otherwise `outputParameter` is used as the property key directly. List values (checkbox) are stored as JSON arrays. A step cannot be completed while a `required` input is empty, a `number`-mode text input holds text that is not a number, a `blockDone` timer has not finished, or an e-signature is incomplete.

**Validation (warnings, not errors).** Every `textInput` / `textarea` / `checkbox` / `radio` / `esignature` block should have a non-empty `outputParameter`. Mission Engine reports each unbound block as an `UNBOUND_FORM_INPUT` warning and discards its value at submit; more than one `esignature` block on a step is an `ESIGNATURE_MULTIPLE_BLOCKS` warning (only the first is signed). The `roleName` of an e-signature block names a Mission Commander role; Mission Commander finds or creates the role when it loads the package.

### 1.12.2 Legacy v1 layout (`form_layout_config`, ≤ 4.0, import only)

Packages up to schema 4.0 carried a per-device absolute layout. Mission Designer no longer writes it; on import it converts the layout to a `form_document`. Mission Engine still reads it when present (it takes the first layout entry, in preference to `form_document`).

```json
"form_layout_config": [
  { "deviceType": "phone",   "canvasWidth": 390,  "canvasHeight": 844,  "elements": [ /* FormElement[] */ ] },
  { "deviceType": "tablet",  "canvasWidth": 768,  "canvasHeight": 1024, "elements": [ /* ... */ ] },
  { "deviceType": "desktop", "canvasWidth": 1280, "canvasHeight": 800,  "elements": [ /* ... */ ] }
]
```

Each `FormElement` has `type`, `x`, `y`, `width`, `height` (numbers, required) and optional `zIndex`. `type ∈ {button, text, textInput, image, header, textarea, checkbox, radio, video, divider, timer}`.

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

**Round-trip migration notes for importers.**

- `defaultSource.mode: "parameter"` (older exports) → migrate to `"property"`.
- `content` may arrive as `string` or `{ content, plainText }` rich-text object. Extract the `content` field (HTML) for rendering; use `plainText` only as a no-HTML fallback.
- Image `src` values in legacy exports may carry an `{oid}-` prefix. Strip it on import.

---

# Part 2 — ZIP File Formats

## 2.0 Extension matrix

| Extension | Container | Carries | Producer | Consumers |
|-----------|-----------|---------|----------|-----------|
| `.WFmaster` | bare JSON | One `MasterWorkflowSpecification` (§1.3) | Mission Designer (canvas export) | — (inner file of `.WFmasterX`) |
| `.WFmasterX` | ZIP | One `.WFmaster` + its environment and action libraries + images | Mission Designer | Mission Commander, Mission Designer |
| `.WFlibX` | ZIP | A `MasterWorkflowLibrary` (`.WFlib`) + step, environment and action libraries + images + manifest | Mission Designer | Mission Designer |
| `.WFstepLibX` | ZIP | A `MasterWorkflowStepLibrary` (`.WFslib`) + its environment and action libraries + images | Mission Designer | Mission Designer |
| `.WFslibX` | ZIP | Former name of `.WFstepLibX` | — | Mission Designer (legacy import) |
| `.WFenvir` | bare JSON | One `MasterEnvironmentLibrary` (§1.9) OR single-environment (§1.8) document | (inner file of the packages below) | Mission Autopilot, Mission Autopilot Tester, Mission Designer |
| `.WFenvirX` | ZIP | One single-environment `.WFenvir` + `actions/**.WFaction` + manifest | Mission Designer, Mission Autopilot | Mission Commander, Mission Autopilot, Mission Autopilot Tester, Mission Designer |
| `.WFenvirLibX` | ZIP | One library-shape `.WFenvir` + the action libraries it uses | Mission Designer | Mission Designer, Mission Autopilot, Mission Autopilot Tester |
| `.WFenvirBundleX` | ZIP | One library-shape `.WFenvir` + Python code files + manifest | Mission Autopilot | Mission Autopilot, Mission Autopilot Tester |
| `.WFaction` | bare JSON | One `MasterActionLibrary` (§1.10) OR standalone action document | (inner file of the packages) | Mission Autopilot, Mission Autopilot Tester, Mission Designer |
| `.WFactionLibX` | ZIP | A `MasterActionLibrary` | Mission Designer | Mission Designer (Mission Autopilot rejects it) |
| `.WFactionCode` / `.WFactionCodeX` | ZIP | One action + Python source per state | Mission Autopilot | Mission Autopilot |
| `.WFsnapshot` | ZIP | Full Mission Autopilot backup: settings + all environments + all action code + manifest | Mission Autopilot | Mission Autopilot |
| `.WFcenterX` | ZIP | A Mission Commander work-center tree with its loaded workflows, environments, roles and grants | Mission Commander | Mission Commander |

Implementer rules:

- Mission Designer's library importers pick the parser by the inner file's extension (`.WFaction`, `.WFenvir`, `.WFslib`, `.WFlib`) and, for `.WFenvirX`, by `manifest.packageType`. Mission Commander and Mission Autopilot tell the two `.WFenvir` shapes apart by content (§2.5).
- `manifest.json` is advisory in `.WFmasterX` (both Mission Designer and Mission Commander ignore it) but **not** in every package: a `.WFlibX` import requires it (§2.3), a Mission Designer `.WFenvirX` is recognised by it (§2.6), and a `.WFactionCode` import reads its code list from it (§2.10).
- Filenames inside `environments/`, `actions/` and `images/` matter: Mission Designer links a workflow to an environment library by the `environments/<name>.WFenvir` filename (§2.2).

## 2.1 `.WFmaster` — bare workflow JSON

A single JSON file. Content: a `MasterWorkflowSpecification` (§1.3). No images, no embedded libraries beyond the environments embedded in `environment_specifications[]`.

**Use case.** Smallest possible exchange unit (Mission Designer's canvas export). Suitable for diff/version-control and test fixtures. Mission Commander loads only `.WFmasterX`.

## 2.2 `.WFmasterX` — runtime package (workflow + dependencies)

The primary runtime distribution format, built by Mission Designer (`MissionDesigner/src/server/packageFormat/buildWorkflowPackage.ts`).

```
MyWorkflow.WFmasterX  (ZIP)
├── MyWorkflow.WFmaster            ← JSON: the MasterWorkflowSpecification (§1.3)
├── manifest.json                  ← package metadata (§2.2.1); advisory
├── environments/                  ← one .WFenvir per environment library the workflow uses
│     └── Kitchen Library.WFenvir  ← JSON: a MasterEnvironmentLibrary (§1.9)
├── actions/                       ← one .WFaction per action library those environments use
│     └── Oven Controls.WFaction   ← JSON: a MasterActionLibrary (§1.10)
└── images/                        ← media referenced by forms / UI parameters
      ├── 7000000123456-photo.jpg  ← {imageOid}-{filename} for form image blocks
      └── engine-closeup.jpg       ← bare filename for ui_parameter_specifications images
```

Rules:

- Exactly one file at the ZIP root ending in `.WFmaster`. Mission Commander reads the first root-level `.WFmaster`; Mission Designer reads the first `.WFmaster` entry.
- Mission Designer names the root entry after the workflow with every character outside `A–Z a–z 0–9 . _ -` replaced by `_`; the downloaded file is named `<name>(<version>).WFmasterX`.
- Every WORKFLOW PROXY that references a step library is resolved to an embedded child (`children[]`) with fresh oids before export, so the package is self-contained.
- The environments embedded in the workflow's `environment_specifications[]` carry their action bodies inline, so a consumer can run the workflow from the `.WFmaster` alone.
- Mission Designer's importer accepts only the entries above: any other path fails with `zip_filename_invalid` (`unknown entry type`). It recreates or reuses the environment and action libraries from `environments/` and `actions/` before importing the workflow. For the environment links to survive, three names must agree on each environment library:
  1. The ZIP entry filename: `environments/<LibName>.WFenvir`
  2. `environment_specifications[i].library_name` inside the workflow
  3. The library's inner `local_id` (the name a newly created library gets)

  When no `environments/` file matches a `library_name`, the link is dropped with an import warning. The same agreement applies to action libraries: `actions/<LibName>.WFaction` ≡ the environment's `included_actions[].action_library` ≡ the action library's inner `local_id`. A library of that name that already exists in the importing team (or in GLOBAL) is reused as it is.
- Mission Commander reads environments from the workflow's inline `environment_specifications[]` and from every `environments/*.WFenvir` library, merged by environment `oid` (a library file wins). It ignores `actions/` and `manifest.json`, and stores each image a form or UI parameter references, resolved by bare filename first, then `{imageOid}-{filename}`, then any entry ending in `-{filename}`.
- Missing image bytes are not an error for either importer: the image is left empty.

### 2.2.1 `manifest.json`

```json
{
  "packageVersion": "1.0",
  "workflowName":   "My Workflow",
  "environmentLibraries": ["Kitchen Library"],
  "actionLibraries":      ["Oven Controls"],
  "createdAt": "2026-04-24T12:00:00.000Z",
  "files": [
    { "path": "My_Workflow.WFmaster",                 "type": "workflow" },
    { "path": "environments/Kitchen Library.WFenvir", "type": "environment" },
    { "path": "actions/Oven Controls.WFaction",       "type": "action" },
    { "path": "images/7000000123456-photo.jpg",       "type": "image" }
  ]
}
```

Include for forward compatibility and human debugging. Importers MUST NOT rely on it for routing.

## 2.3 `.WFlibX` — workflow library bundle

Built by Mission Designer (`MissionDesigner/src/lib/packageFormat/workflow-library-package.ts`).

```
MyLibrary.WFlibX  (ZIP)
├── manifest.json                  ← REQUIRED (below)
├── MyLibrary.WFlib                ← JSON: MasterWorkflowLibrary (§1.2)
├── steps/
│     └── Common Steps.WFslib      ← JSON: MasterWorkflowStepLibrary (§1.11), one per step library referenced
├── environments/
│     └── Kitchen Library.WFenvir  ← JSON: MasterEnvironmentLibrary, with value_type_specifications
├── actions/
│     └── Oven Controls.WFaction   ← JSON: MasterActionLibrary
└── images/
      └── ...
```

`manifest.json`:

```json
{
  "packageType":    "workflow-library",
  "packageVersion": "1.1",
  "libraryName":    "MyLibrary",
  "createdAt":      "2026-04-24T12:00:00.000Z",
  "files": [ { "path": "MyLibrary.WFlib", "type": "workflow-library" }, { "path": "steps/Common Steps.WFslib", "type": "step-library" } ],
  "oidIndex": {
    "libraries":      [ { "oid": "…", "name": "MyLibrary", "entityType": "workflow", "version": "1.0.0" } ],
    "specifications": [ { "oid": "…", "libraryOid": "…", "name": "Bolognese", "version": "1.0.0" } ]
  }
}
```

**Mission Designer only.** Mission Designer's import refuses a `.WFlibX` without `manifest.json` (`missing_manifest`), with a `packageType` other than `workflow-library` (`wrong_package_type`), or without `packageVersion: "1.1"` and an `oidIndex` (`unsupported_package_version`). It previews the import by oid against the target, then commits. `oidIndex.libraries[].entityType ∈ {workflow, step, environment, action}`.

## 2.4 `.WFstepLibX` — step library bundle

Built by Mission Designer (`MissionDesigner/src/lib/packageFormat/library-package.ts`). Called `.WFslibX` before the rename; Mission Designer still imports that name.

```
MyStepLib.WFstepLibX  (ZIP)
├── manifest.json
├── MyStepLib.WFslib               ← JSON: MasterWorkflowStepLibrary (§1.11)
├── environments/
│     └── Kitchen Library.WFenvir
├── actions/
│     └── Oven Controls.WFaction
└── images/
```

`manifest.json` carries `packageType: "step-library"`, `packageVersion: "1.0"`, `libraryName`, `environmentLibraries` and `actionLibraries` (when present), `createdAt` and `files[]`. Mission Designer only; Mission Autopilot rejects `.WFstepLibX` uploads.

## 2.5 `.WFenvir` — bare environment JSON

Two shapes coexist under the same extension. Importers MUST autodetect.

- **Library shape.** Top-level object is a `MasterEnvironmentLibrary` (§1.9) with `environment_specifications: [...]`. Used inside `.WFmasterX`, `.WFlibX`, `.WFstepLibX`, `.WFenvirLibX` and `.WFenvirBundleX`.
- **Single-environment shape.** Top-level object is itself an `EnvironmentSpecification` (§1.8). No outer `environment_specifications` wrapper. Used at the root of a `.WFenvirX`.

The dispatch test is: presence of an `environment_specifications` array → library shape; otherwise single-environment shape. (Mission Autopilot's single-environment `.WFenvir` has no `included_actions` — its actions are the `actions/` files of the `.WFenvirX`.)

## 2.6 `.WFenvirX` — single environment + its actions

Mission Designer's layout (`exportEnvironmentPackage`):

```
Kitchen.WFenvirX  (ZIP)
├── Kitchen.WFenvir                      ← JSON: single-environment shape (§1.8), included_actions inline
├── actions/
│     └── Oven Controls/                 ← one folder per action library
│           ├── Preheat Oven.WFaction    ← JSON: standalone action shape
│           └── Mixer.WFaction
└── manifest.json                        ← { packageType: "environment-package", formatVersion: 2, createdAt,
                                              environmentName, actionCount, actionLibraries: [{ name, actions: [...] }] }
```

Mission Autopilot's layout (`GET /management/v1/environments/:oid/export-envir-x`):

```
Kitchen.WFenvirX  (ZIP)
├── Kitchen.WFenvir            ← JSON: single-environment shape, without included_actions
├── actions/
│     └── Preheat Oven.WFaction  ← JSON: standalone action shape, with state and timeout_seconds
└── manifest.json              ← { packageType: "environment-package", formatVersion: 1, createdAt,
                                    environmentName, actionCount }
```

The inner `.WFaction` files use the standalone shape (the action at top level, *without* the `action_specifications` wrapper). They never carry Python source; that is the role of `.WFenvirBundleX` (§2.8) or `.WFactionCode` (§2.10).

Mission Commander loads a `.WFenvirX` into a work center from its first `.WFenvir` entry (either shape). Mission Designer imports it as an environment when `manifest.packageType` is `environment-package`, and as a legacy environment library otherwise. Mission Autopilot accepts `.WFenvirX` uploads.

## 2.7 `.WFenvirLibX` — environment library ZIP

```
KitchenLib.WFenvirLibX  (ZIP)
├── manifest.json              ← { packageType: "environment-library", packageVersion: "1.0", libraryName,
│                                  actionLibraries?, createdAt, files[] }
├── KitchenLib.WFenvir         ← JSON: library shape (§1.9), with value_type_specifications
└── actions/
      └── Oven Controls.WFaction ← JSON: MasterActionLibrary, one per action library the environments use
```

Built by Mission Designer. Bundling the action libraries lets an importer recreate missing action libraries without a separate package. Mission Autopilot accepts `.WFenvirLibX` uploads and reads the inner `.WFenvir`.

## 2.8 `.WFenvirBundleX` — environment + Python code

Mission Autopilot's round-trip format for shipping an environment together with its action implementations (`GET /management/v1/environments/:oid/export-bundle`).

```
Kitchen.WFenvirBundleX  (ZIP)
├── manifest.json             ← {format: "WFenvirBundleX", format_version: 1, exported_at, container_version,
│                                environment_oid, environment_local_id, action_count, code_file_count}
├── Kitchen.WFenvir           ← JSON: library shape (§1.9) carrying one environment with included_actions[]
└── code/
      ├── <action_oid_1>/
      │     ├── EXECUTING.py
      │     └── PAUSED.py
      └── <action_oid_2>/
            └── EXECUTING.py
```

Python files are keyed by the action oid and the state they implement: `<STATE>.py` defines the action's behaviour while an instance is in that state. Valid states are those of the action's state machine — for an observable action `STARTING`, `EXECUTING`, `COMPLETING`, `COMPLETED`, `PAUSING`, `PAUSED`, `UNPAUSING`, `HOLDING`, `HELD`, `UNHOLDING`, `ABORTING`, `ABORTED`, `CLEARING`, `STOPPING`; for an opaque action `POSTED`, `RECEIVED`, `IN_PROGRESS`, `COMPLETED`, plus any state its transition table reaches. Mission Autopilot writes `action_library` = the environment's `local_id` on every roster entry (it has no separate library concept).

An action server that consumes `.WFenvirBundleX` MUST:

1. Parse the inner `.WFenvir` library shape to register environments and actions.
2. For each `code/<oid>/<state>.py`, store the source against the action with that oid and mark it active for that state.

## 2.9 `.WFaction` — bare action JSON

Two shapes coexist (same autodetect pattern as `.WFenvir`):

- **Library shape.** Top-level `MasterActionLibrary` (§1.10) with `action_specifications: [...]`. Used inside `.WFmasterX`, `.WFlibX`, `.WFstepLibX`, `.WFenvirLibX` and `.WFactionLibX`.
- **Standalone shape.** A single action at top level (ManagedElement + `input_parameter_specifications`, `output_parameter_specifications`, `property_specifications`, `action_visibility`, and from Mission Autopilot also `state` and `timeout_seconds`). Used inside `.WFenvirX` (§2.6). Mission Autopilot requires `oid`, `local_id`, `version` and `last_modified_date` on an uploaded action.

## 2.10 `.WFactionCode` (download) / `.WFactionCodeX` (upload)

A single action's spec + Python source per state. Mission Autopilot has two shapes:

**Per-action download and import** (`GET` / `POST /management/v1/actions/:oid/export|import`), written as `<local_id>.WFactionCode`:

```
HeatOven.WFactionCode  (ZIP)
├── manifest.json             ← (§2.10.1 below)
├── EXECUTING.py
├── PAUSED.py
└── STOPPING.py
```

**Upload** through `POST /management/v1/upload`, which accepts the `.WFactionCodeX` extension: a ZIP with one `*.WFaction` entry (the action in standalone shape) and `code/<STATE>.py` files. This path does not read `manifest.json`.

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

On per-action import, Mission Autopilot rejects the upload when the manifest's `action.oid` differs from the target action's oid, then reads each `code_files[i].filename` from the ZIP and saves and activates it for that state (a listed file missing from the ZIP is reported as skipped). The action spec itself is not changed by this route.

## 2.11 `.WFsnapshot` — Mission Autopilot backup

A full backup of one Mission Autopilot's state (`GET /management/v1/snapshot/export`; restore with `POST /management/v1/snapshot/import?confirm=true`). Container-specific, documented so third-party tools can introspect a snapshot without depending on Mission Autopilot's database schema.

```
TrajectorySnapshot_2026-05-30.WFsnapshot  (ZIP)
├── manifest.json             ← {format_version: "1.0", exported_at, container_version, environment_count, action_count, code_file_count}
├── settings.json             ← key/value pairs from the settings store (the API key is never included)
├── environments/
│     └── <env_oid>.json      ← single-environment shape with included_actions[] inline (one file per environment)
└── code/
      └── <action_oid>/
            └── <STATE>.py
```

## 2.12 Upload extensions accepted by Mission Autopilot

`POST /management/v1/upload` accepts `.WFenvir`, `.WFenvirX`, `.WFenvirLibX`, `.WFenvirBundleX`, `.WFaction` and `.WFactionCodeX`. It recognises `.WFactionLibX` and `.WFstepLibX` only to refuse them: upload individual `.WFaction` files instead. Mission Autopilot Tester offers `.WFenvirX`, `.WFenvirLibX`, `.WFenvirBundleX`, `.WFactionLibX`, `.WFenvir` and `.WFaction` and forwards the bytes to this endpoint unchanged.

## 2.13 `.WFcenterX` — Mission Commander work-center package

Mission Commander exports a work center and its descendants, with the workflows and environments loaded into them, and imports the same file into another Mission Commander (`mission-control-db/src/package/`).

```
Line 1.WFcenterX  (ZIP)
├── Line 1.WFcenter                                  ← JSON manifest
├── workflows/<work center path>/<name>-<version>-<state>.WFmaster   ← each loaded workflow, as stored
├── environments/<work center path>/<name>-<version>-<state>.WFenvir ← each loaded environment (single-environment shape)
└── roles/
      ├── roles.json                                 ← { roles: [{ name, description, isSystem }] }
      └── allowed-roles.json                         ← { grants: [{ workCenterPath, workflow: { oid, version, state }, nodePath, role }] }
```

The manifest is `{ format: "WFcenter", formatVersion: "1.0", exportedAt, scope: "all" | "effective", warnings[], workCenters[] }`. Each work center entry lists `path`, `parentPath`, `name`, `description`, `sortOrder`, `dispatchPolicy`, `autoClaim`, `typeName`, and its `workflows[]` and `environments[]` with their `file`, `oid`, `name`, `version`, `state` and load metadata; a workflow entry also lists the environments it is linked to by (`oid`, `version`, `state`). The manifest's `file` field is authoritative: filenames are made unique with `-2`, `-3` suffixes and must not be parsed.

---

# Part 3 — Per-application import/export matrix

`R` = reads (imports), `W` = writes (exports), `—` = no role. Mission Engine, Mission Pilot and Mission Broker read and write none of these files.

| Format | Mission Designer | Mission Commander | Mission Autopilot | Mission Autopilot Tester |
|--------|:----------------:|:-----------------:|:-----------------:|:------------------------:|
| `.WFmaster` | W *(canvas export; read inside `.WFmasterX`)* | R *(inside `.WFmasterX` / `.WFcenterX`)* | — | — |
| `.WFmasterX` | R/W | R | — | — |
| `.WFlibX` | R/W | — | — | — |
| `.WFstepLibX` | R/W *(also reads legacy `.WFslibX`)* | — | **rejected** | — |
| `.WFenvir` (library shape) | R/W *(inside packages)* | R *(inside `.WFmasterX` / `.WFenvirX`)* | R/W | R (uploads it) |
| `.WFenvir` (single-environment shape) | R/W *(inside `.WFenvirX`)* | R *(inside `.WFenvirX` / `.WFcenterX`)* | R/W | R (uploads it) |
| `.WFenvirX` | R/W | R | R/W | R (uploads it) |
| `.WFenvirLibX` | R/W | — | R | R (uploads it) |
| `.WFenvirBundleX` | — | — | R/W | R (uploads it) |
| `.WFaction` | R/W *(library shape in packages; standalone in `.WFenvirX`)* | — | R/W *(standalone shape)* | R (uploads it) |
| `.WFactionLibX` | R/W | — | **rejected** | R (uploads it; refused by Mission Autopilot) |
| `.WFactionCode` / `.WFactionCodeX` | — | — | R/W | — |
| `.WFsnapshot` | — | — | R/W | — |
| `.WFcenterX` | — | R/W | — | — |

Notes:

- Mission Commander is the only path into a runtime: it stores the workflow JSON it loads, and Mission Engine runs that JSON. A new runtime implementing this spec only needs read paths for `.WFmasterX` (and `.WFenvirX` for environment updates).
- Mission Autopilot Tester is a thin client over Mission Autopilot's `/management/v1/upload` endpoint. It does not parse or transform the formats — it forwards the bytes verbatim.
- Mission Designer is the only authoring tool. New editors should target the 5.0 envelope (`children[]`, `form_document`, `schemaVersion: "5.0"`) as the write format.

---

# Part 4 — Editor internal envelope → runtime envelope (migration aid)

Mission Designer stores each specification as a record whose `data` holds React Flow `nodes` / `edges`. Tools that want to be drop-in editor replacements need to emit the same runtime envelope. This is the canonical mapping (`MissionDesigner/src/lib/packageFormat/workflow-exporters.ts`).

### 4.1 Spec-level field map

| Editor specification | Runtime (root or `ChildWorkflowExport`) |
|------------------------------|------------------------------------------|
| `id` | `oid` |
| `name` | `local_id` |
| `description` (may be null) | `description` (omit if null) |
| `typeName` | `type_name` (omit if unset) |
| `version` | `version` (children take the root's) |
| `state` | `state` (children take the root's) |
| `updatedAt` (epoch ms) | `last_modified_date` (ISO 8601) |
| parent child-spec id | `parentChildSpecId` (`null` for direct children of root) |
| *(none)* | `schemaVersion: "5.0"` |
| `data.notation` | `display_style` |
| `data.nodes[]` | `steps[]` (see §4.2) |
| `data.edges[]` | `connections[]` (see §4.2) |
| `data.viewport` | `viewport` (pass through) |
| `data.workflowInputs[]` | `starting_parameter_specifications[]` |
| `data.workflowOutputs[]` | `output_parameter_specifications[]` |
| `data.workflowValues[]` | `value_property_specifications[]` |
| `data.workflowResources[]` | `resource_property_specifications[]` |
| `data.workflowTrySpecifications[]` | `try_specifications[]` |
| `data.environmentSpecIds[]` | `environment_specifications[]` (each environment embedded in full; on the root only in a `.WFmasterX`) |
| `data.images` (filename → data URI) | ZIP entries under `images/` |

### 4.2 Step-type normalization

| Editor `node.type` / `stepType` | Runtime `step_type` |
|---------------------------------|--------------------|
| `start` | `START` |
| `end` | `END` |
| `parallel` | `PARALLEL` |
| `waitAll` | `WAIT ALL` |
| `waitAny` | `WAIT ANY` |
| `select1` | `SELECT 1` |
| `yesNoStep` | `YES_NO` |
| `userInteractionStep` | `USER_INTERACTION` |
| `scriptStep` | `SCRIPT` |
| `gateStep` | `GATE` |
| `actionProxyWait` | `ACTION PROXY` |
| `workflowProxy` | `WORKFLOW PROXY` |
| `catch` | `CATCH` |
| `return` | `RETURN` |

| Editor edge | Runtime connection |
|-------------|--------------------|
| `edge.source` | `from_step_id` |
| `edge.target` | `to_step_id` |
| `edge.data.connectionId` | `connection_id` (the option id on SELECT 1 edges) |
| `edge.sourceHandle` | `source_handle_id` |
| `edge.data.condition` | `condition` |
| `edge.data.waypoints` | `waypoints` |
| `edge.type`, `markerEnd`, `style`, `animated` | *(discarded — presentation only)* |

### 4.3 Building the `children` tree from a flat editor envelope

Given a workflow's child specifications, each with the id of its parent child (or none for a direct child of the root):

```
function buildChildren(parentChildId):            // null for the root's direct children
  entries = children filter where parentChildSpecId === parentChildId
  return entries.map(e => ({
    ...childWorkflowExportFrom(e),                // version and state copied from the root
    parentChildSpecId: e.parentChildSpecId,       // null for direct children of the root
    children: buildChildren(e.id)                 // omitted when empty
  }))

root_output.children = buildChildren(null)
```

Direct children of the root carry `parentChildSpecId: null`; grandchildren and deeper carry their parent child's oid.

---

# Part 5 — Pre-write self-check (for any new exporter)

Before emitting a `.WFmasterX`, validate:

- [ ] Root carries `schemaVersion` from `"4.0"` to `"5.0"` (write `"5.0"`), `local_id` and `oid`.
- [ ] Exactly one step has `step_type === "START"`.
- [ ] At least one step has `step_type === "END"`.
- [ ] All step `oid` values unique within the spec.
- [ ] Every connection references existing step `oid` values on both ends.
- [ ] No connection has `from_step_id === to_step_id`.
- [ ] Every step outside a catch network is reachable from the START step via `connections`.
- [ ] Every `PARALLEL` step reaches a `WAIT ALL` downstream.
- [ ] Every `SELECT 1` step's outgoing connections have a `connection_id` matching one of `select1_config.options[].id`.
- [ ] Every `YES_NO` step has at most two outgoing connections with `source_handle_id ∈ {"yes","no"}`.
- [ ] Every `ACTION PROXY` step has an `action_proxy_config` whose `environment_oid` and `action_oid` match an embedded environment and its roster (or that carries `environment_name` / `action_name`).
- [ ] Every `GATE` has exactly one incoming and one outgoing connection and no resource commands; a timed gate has `delay_seconds`.
- [ ] Every `CATCH` has 0 in / 1 out connections and a unique `catch_id`; every `RETURN` has 1 in / 0 out and a valid `return_config`; every TRY row names an existing `catch_id`.
- [ ] Every `ChildWorkflowExport` in `children[]` has `parentChildSpecId` pointing at its parent's `oid`, or `null` for direct children of the root, and carries `version` and `state`.
- [ ] Every managed element (root, every child, every step) has all four of `local_id`, `oid`, `version`, `last_modified_date`.
- [ ] Every `form_document` validates against the Form Document v2 schema and has unique ids.
- [ ] Every `textInput` / `textarea` / `checkbox` / `radio` / `esignature` block has a non-empty `outputParameter` (warning only).
- [ ] If environment libraries are packaged, the triple (`environments/<name>.WFenvir`, workflow's `environment_specifications[i].library_name`, the library's inner `local_id`) agrees exactly.
- [ ] If action libraries are packaged, the triple (`actions/<name>.WFaction`, the environment's `included_actions[].action_library`, the action library's inner `local_id`) agrees exactly.

A failure produces the corresponding error code when a runtime workflow starts (§1.3).

---

# Appendix A — Schema relationship diagram

```
managed-element.json (base)
  ├── master-workflow-library.json
  │     └── workflow_specifications[].steps[]                  → step definition
  │     │     └── steps[].form_document                        → form-document.json (Mission FormKit)
  │     └── workflow_specifications[].connections[]            → connection definition
  │     └── workflow_specifications[].children[]               → ChildWorkflowExport (recursive)
  │     └── workflow_specifications[].environment_specifications[] → embedded environments
  ├── master-action-library.json
  │     └── action_specifications[]                            → inputs, outputs, properties
  ├── master-environment-library.json
  │     └── environment_specifications[]                       → actions, values, resources, servers
  └── master-workflow-step-library.json
        └── workflow_specifications[]                          → same shape as workflow library
```

# Appendix B — References

- Mission Designer published schemas: `MissionDesigner/src/lib/schemas/` (`managed-element.json`, `master-workflow-library.json`, `master-workflow-step-library.json`, `master-environment-library.json`, `master-action-library.json`, `form-document.json`)
- Mission Designer export types: `MissionDesigner/src/lib/packageFormat/export-types.ts`
- Mission Designer exporters: `MissionDesigner/src/lib/packageFormat/workflow-exporters.ts`, `library-exporters.ts`, `library-package.ts`, `workflow-library-package.ts`
- Mission Designer `.WFmasterX` builder: `MissionDesigner/src/server/packageFormat/buildWorkflowPackage.ts`
- Mission Designer `.WFmasterX` importer: `MissionDesigner/src/server/packageFormat/safeZipReader.ts`, `parseEnvelope.ts`, `importLibrariesFromZip.ts`, `MissionDesigner/src/lib/import/workflow-importers.ts`; package routes `MissionDesigner/src/server/routes/v2/packages.ts`
- Mission Designer `.WFmasterX` import/export reference: `MissionDesigner/docs/package-format.md`
- Form Document v2 schema and host contract: `MissionFormKit/packages/form-schema/src/schema/form-document.json`, `MissionFormKit/packages/form-schema/src/types.ts`, `MissionFormKit/docs/HOST-CONTRACT.md`
- Mission Commander package ingest: `mission-control-db/src/ingest/wfmasterx.ts`, `wfenvirx.ts`, `images.ts`; `.WFcenterX`: `mission-control-db/src/package/`
- Mission Engine validator and spec types: `MissionEngine/src/spec/validator.ts`, `MissionEngine/src/spec/types.ts`, `MissionEngine/src/spec/workflow-schema.json`
- Mission Autopilot export/import: `MissionAutopilot/packages/server/src/routes/export-import.ts`; uploads: `MissionAutopilot/packages/server/src/routes/management.ts`
- Runtime ↔ action server protocol: [REST_Protocol.md](./REST_Protocol.md)
