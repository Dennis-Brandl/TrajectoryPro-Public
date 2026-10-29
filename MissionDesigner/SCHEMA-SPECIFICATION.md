# Mission Designer — Schema & Package Specification

**Schema Version:** 4.0
**JSON Schema Draft:** Draft-07
**Base URI:** `https://trajectorypro.io/schemas/`
**Last Updated:** 2026-03-12

This document is the complete reference for all JSON schemas and ZIP package formats used by Mission Designer for import, export, and interchange of workflow specifications.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Managed Element (Base Schema)](#2-managed-element-base-schema)
3. [Master Action Library](#3-master-action-library)
4. [Master Environment Library](#4-master-environment-library)
5. [Master Workflow Library](#5-master-workflow-library)
6. [Master Workflow Step Library](#6-master-workflow-step-library)
7. [Workflow Step Schema](#7-workflow-step-schema)
8. [Connections](#8-connections)
9. [Shared Definitions](#9-shared-definitions)
10. [WYSIWYG Form Layout](#10-wysiwyg-form-layout)
11. [Form Element Types](#11-form-element-types)
12. [ZIP Package Formats](#12-zip-package-formats)
13. [Image Handling](#13-image-handling)
14. [Schema Version History](#14-schema-version-history)

---

## 1. Introduction

Trajectory is a distributed workflow system where users author workflows on a web site, then export and execute them on mobile devices or enterprise systems. This specification defines the JSON data models and ZIP packaging formats used for interchange between the authoring environment (Mission Designer) and runtime execution systems (Trajectory Pro).

### Exchangeable Artifacts

| Artifact            | Extension    | Format | Description                                |
| ------------------- | ------------ | ------ | ------------------------------------------ |
| Workflow Package    | `.WFmasterX` | ZIP    | Workflow + images                          |
| Runtime Package     | `.WFmasterX` | ZIP    | Workflow + environments + actions + images |
| Library Package     | `.WFlibX`    | ZIP    | Full library tree + dependencies + images  |
| Workflow Library    | `.WFmaster`  | JSON   | Workflow specification JSON                |
| Step Library        | `.WFslibX`   | JSON   | Step library JSON                          |
| Environment Library | `.WFenvir`   | JSON   | Environment library JSON                   |
| Action Library      | `.WFaction`  | JSON   | Action library JSON                        |

### Identification System

Every entity uses dual identification:

- **`local_id`** — Human-readable name (e.g., "Bake Cookies")
- **`oid`** — Snowflake OID (globally unique, e.g., "6000000000001")

OIDs are strings containing numeric snowflake identifiers. They are generated at creation time and never change. The `local_id` serves as the display name and may be renamed by users.

### Parameters

- Input parameters are untyped strings (e.g., `"350"`, `"[1,2,3]"`, `"abcdef"`)
- Optional JSON Schema validation can constrain parameter values
- Parameters use dot notation for referencing value properties: `PropertyName.EntryName`

---

## 2. Managed Element (Base Schema)

**Schema ID:** `managed-element.json`

All top-level objects and specifications inherit from this base.

| Field                | Type               | Required | Description                         |
| -------------------- | ------------------ | -------- | ----------------------------------- |
| `local_id`           | string             | Yes      | Human-readable name                 |
| `oid`                | string             | Yes      | Snowflake OID (globally unique)     |
| `version`            | string             | Yes      | Version string (e.g., `"1.0"`)      |
| `last_modified_date` | string (date-time) | Yes      | ISO 8601 timestamp                  |
| `description`        | string             | No       | Human-readable description          |
| `schemaVersion`      | string             | No       | Trajectory schema version (`"4.0"`) |

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/managed-element.json",
  "title": "Managed Workflow Element",
  "type": "object",
  "properties": {
    "schemaVersion": { "type": "string", "enum": ["4.0"] },
    "local_id": { "type": "string" },
    "oid": { "type": "string" },
    "description": { "type": "string" },
    "version": { "type": "string" },
    "last_modified_date": { "type": "string", "format": "date-time" }
  },
  "required": ["local_id", "oid", "version", "last_modified_date"]
}
```

---

## 3. Master Action Library

**Schema ID:** `master-action-library.json`

A collection of action specifications that define reusable operations.

### Top Level

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                   | Type  | Required | Description                               |
| ----------------------- | ----- | -------- | ----------------------------------------- |
| `action_specifications` | array | Yes      | List of action specifications             |
| `child_libraries`       | array | No       | Nested child action libraries (recursive) |

### Action Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                             | Type   | Required | Description                  |
| --------------------------------- | ------ | -------- | ---------------------------- |
| `input_parameter_specifications`  | array  | No       | Input parameters             |
| `output_parameter_specifications` | array  | No       | Output parameters            |
| `property_specifications`         | array  | No       | Named value properties       |
| `action_visibility`               | string | No       | `"opaque"` or `"observable"` |

### Example

```json
{
  "local_id": "My Action Library",
  "oid": "1234567890",
  "version": "1.0",
  "last_modified_date": "2026-02-24T12:00:00.000Z",
  "action_specifications": [
    {
      "local_id": "Heat Oven",
      "oid": "1234567891",
      "version": "1.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "action_visibility": "observable",
      "input_parameter_specifications": [{ "id": "Temperature", "default_value": "350", "value_type": "literal" }],
      "output_parameter_specifications": [{ "id": "ActualTemp", "target": "CurrentTemperature" }]
    }
  ]
}
```

---

## 4. Master Environment Library

**Schema ID:** `master-environment-library.json`

A collection of environment specifications that bind actions to execution contexts and define shared resources.

### Top Level

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                        | Type  | Required | Description                                    |
| ---------------------------- | ----- | -------- | ---------------------------------------------- |
| `environment_specifications` | array | Yes      | List of environment specifications             |
| `child_libraries`            | array | No       | Nested child environment libraries (recursive) |

### Environment Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                              | Type  | Required | Description                                                                                        |
| ---------------------------------- | ----- | -------- | -------------------------------------------------------------------------------------------------- |
| `included_actions`                 | array | Yes      | Actions included in this environment                                                               |
| `value_property_specifications`    | array | No       | Named value properties                                                                             |
| `value_type_specifications`        | array | No       | Designer-only Value Type templates (Designer library packages only; omitted from runtime packages) |
| `action_property_specifications`   | array | No       | Action-scoped shared properties                                                                    |
| `resource_property_specifications` | array | No       | Resource definitions                                                                               |

### Included Action

An `IncludedAction` carries `action_name` + `action_library` as the cross-package join keys, plus the **full inlined `MasterActionSpecification` body** (same field names as a `.WFaction` action_specifications entry). Inlining makes the environment self-contained for downstream consumers — workflow runtime and Action Server — that don't have access to the originating action library.

| Field                             | Type               | Required | Description                                                            |
| --------------------------------- | ------------------ | -------- | ---------------------------------------------------------------------- |
| `action_library`                  | string             | Yes      | The `local_id` of the action's parent library. Cross-package join key. |
| `action_name`                     | string             | Yes      | The action's name. Mirrors `local_id` when the body is inlined.        |
| `local_id`                        | string             | No       | The action's `local_id` (same as `action_name` when present).          |
| `oid`                             | string             | No       | OID of the action specification.                                       |
| `description`                     | string             | No       | Description of the action specification.                               |
| `version`                         | string             | No       | Version of the action specification.                                   |
| `last_modified_date`              | string (date-time) | No       | Last modified date of the action specification.                        |
| `action_visibility`               | string             | No       | `"opaque"` or `"observable"`.                                          |
| `input_parameter_specifications`  | array              | No       | Inlined input parameters (same shape as in MasterActionSpecification). |
| `output_parameter_specifications` | array              | No       | Inlined output parameters.                                             |
| `property_specifications`         | array              | No       | Inlined property specifications.                                       |

When the action could be resolved at export time, all inlined fields are populated together. When not (legacy entries, missing library context), only `action_name` + `action_library` are emitted — consumers can detect the unresolved case by absence of `oid`.

### Example

```json
{
  "local_id": "Kitchen Environment Library",
  "oid": "2000000001",
  "version": "1.0",
  "last_modified_date": "2026-02-24T12:00:00.000Z",
  "environment_specifications": [
    {
      "local_id": "Bakery Environment",
      "oid": "2000000002",
      "version": "1.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "included_actions": [
        {
          "action_library": "My Action Library",
          "action_name": "Heat Oven",
          "local_id": "Heat Oven",
          "oid": "1234567891",
          "description": "Brings the oven to a target temperature.",
          "version": "1.0.0",
          "last_modified_date": "2026-02-24T11:55:00.000Z",
          "action_visibility": "observable",
          "input_parameter_specifications": [
            {
              "id": "TargetTemperature",
              "oid": "303590776997150720",
              "default_value": "350",
              "description": "Target temperature in degrees F"
            }
          ],
          "output_parameter_specifications": [
            {
              "id": "ActualTemperature",
              "oid": "303590802443993088",
              "target": "ActualTemperature",
              "description": "Measured temperature when ready"
            }
          ],
          "property_specifications": []
        }
      ],
      "resource_property_specifications": [
        { "name": "Oven", "resource_type": "binary exclusive use" },
        { "name": "Mixing Bowls", "resource_type": "countable use with pool limits", "use_limit": 10 }
      ]
    }
  ]
}
```

---

## 5. Master Workflow Library

**Schema ID:** `master-workflow-library.json`

A collection of workflow specifications. This is the primary export format for workflow libraries.

### Top Level

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                     | Type  | Required | Description                                 |
| ------------------------- | ----- | -------- | ------------------------------------------- |
| `workflow_specifications` | array | Yes      | List of workflow specifications             |
| `child_libraries`         | array | No       | Nested child workflow libraries (recursive) |

### Workflow Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                               | Type   | Required | Description                                                                                                                                                           |
| ----------------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                     | string | No       | `"4.0"`                                                                                                                                                               |
| `type_name`                         | string | No       | Optional ISA 88 type (e.g. `Operation`), at most 50 characters. Informational only; never affects execution. Omitted when unset. Also allowed on each child workflow. |
| `steps`                             | array  | Yes      | Workflow steps                                                                                                                                                        |
| `connections`                       | array  | Yes      | Step connections                                                                                                                                                      |
| `resource_command_specifications`   | array  | No       | Workflow-level resource commands                                                                                                                                      |
| `resource_property_specifications`  | array  | No       | Workflow-level resource definitions                                                                                                                                   |
| `value_property_specifications`     | array  | No       | Workflow-level named values                                                                                                                                           |
| `starting_parameter_specifications` | array  | No       | Workflow input parameters                                                                                                                                             |
| `output_parameter_specifications`   | array  | No       | Workflow output parameters                                                                                                                                            |
| `environment_specifications`        | array  | No       | Embedded environment specifications                                                                                                                                   |
| `child_workflows`                   | array  | No       | Embedded sub-workflow specifications                                                                                                                                  |
| `viewport`                          | object | No       | Canvas viewport state                                                                                                                                                 |

### Viewport

```json
{ "x": 100, "y": 20, "zoom": 0.18 }
```

### Example

```json
{
  "local_id": "My Workflow Library",
  "oid": "3000000001",
  "version": "1.0",
  "last_modified_date": "2026-02-24T12:00:00.000Z",
  "workflow_specifications": [
    {
      "schemaVersion": "4.0",
      "local_id": "Bake Cookies",
      "oid": "3000000002",
      "version": "1.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "steps": [
        {
          "local_id": "Start",
          "oid": "3000000010",
          "version": "1.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "START",
          "position": { "x": 250, "y": 0 }
        },
        {
          "local_id": "End",
          "oid": "3000000012",
          "version": "1.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "END",
          "position": { "x": 250, "y": 150 }
        }
      ],
      "connections": [{ "from_step_id": "Start", "to_step_id": "End", "connection_id": "conn-1" }],
      "viewport": { "x": 0, "y": 0, "zoom": 1 }
    }
  ]
}
```

---

## 6. Master Workflow Step Library

**Schema ID:** `master-workflow-step-library.json`

A collection of reusable workflow steps.

### Top Level

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field             | Type  | Required | Description                                              |
| ----------------- | ----- | -------- | -------------------------------------------------------- |
| `library_steps`   | array | Yes      | List of library steps (same structure as workflow steps) |
| `child_libraries` | array | No       | Nested child step libraries (recursive)                  |

### Example

```json
{
  "local_id": "Common Steps",
  "oid": "4000000001",
  "version": "1.0",
  "last_modified_date": "2026-02-24T12:00:00.000Z",
  "library_steps": [
    {
      "local_id": "User Confirmation",
      "oid": "4000000002",
      "version": "1.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "step_type": "YES_NO",
      "yes_no_config": {
        "yes_label": "Confirm",
        "no_label": "Cancel",
        "yes_value": "confirmed",
        "no_value": "cancelled",
        "default_selection": "none"
      }
    }
  ]
}
```

---

## 7. Workflow Step Schema

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

### Common Fields

| Field                             | Type             | Required | Description                                |
| --------------------------------- | ---------------- | -------- | ------------------------------------------ |
| `step_type`                       | string           | Yes      | Step type enum (see below)                 |
| `position`                        | object           | No       | Canvas position `{ x: number, y: number }` |
| `action_visibility`               | string           | No       | `"opaque"` or `"observable"`               |
| `input_parameter_specifications`  | array            | No       | Step input parameters                      |
| `output_parameter_specifications` | array            | No       | Step output parameters                     |
| `output_parameter_name`           | string           | No       | Output parameter name for UI steps         |
| `value_property_specifications`   | array            | No       | Step-level named values                    |
| `resource_command_specifications` | array            | No       | Step-level resource commands               |
| `connection_references`           | array of strings | No       | References to connections                  |

### Step Types

| Value                 | Description                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `START`               | Workflow entry point                                                                                                        |
| `END`                 | Workflow exit point                                                                                                         |
| `ACTION PROXY`        | Execute an action (default)                                                                                                 |
| `WAIT ACTION PROXY`   | Execute an action and wait for completion                                                                                   |
| `NOWAIT ACTION PROXY` | Execute an action without waiting                                                                                           |
| `WORKFLOW PROXY`      | Invoke a sub-workflow                                                                                                       |
| `SELECT 1`            | Conditional branch (evaluate conditions)                                                                                    |
| `WAIT ANY`            | Wait for any incoming branch to complete                                                                                    |
| `PARALLEL`            | Fork execution into parallel branches                                                                                       |
| `WAIT ALL`            | Wait for all incoming branches to complete                                                                                  |
| `MATH`                | Mathematical computation step                                                                                               |
| `SCRIPT`              | Execute a script (e.g., Python)                                                                                             |
| `GATE`                | Cyclic boolean transition (ISA-88: Transition Step); re-evaluates a script on a cycle until it returns true, then continues |
| `YES_NO`              | Binary user decision with configurable labels                                                                               |
| `USER_INTERACTION`    | General user interaction with WYSIWYG form layout                                                                           |

### Step-Type-Specific Fields

#### USER_INTERACTION / YES_NO Steps

| Field                         | Type  | Description                                   |
| ----------------------------- | ----- | --------------------------------------------- |
| `ui_parameter_specifications` | array | UI elements defining screen content           |
| `form_layout_config`          | array | WYSIWYG form layouts (3 device breakpoints)   |
| `form_element_images`         | array | Image OID-to-filename mapping for form images |

#### YES_NO Steps

| Field           | Type   | Description                 |
| --------------- | ------ | --------------------------- |
| `yes_no_config` | object | Yes/No button configuration |

**yes_no_config:**

| Field               | Type   | Default   | Description                       |
| ------------------- | ------ | --------- | --------------------------------- |
| `yes_label`         | string | `"Yes"`   | Custom label for Yes button       |
| `no_label`          | string | `"No"`    | Custom label for No button        |
| `yes_value`         | string | `"true"`  | Output value when Yes is selected |
| `no_value`          | string | `"false"` | Output value when No is selected  |
| `default_selection` | string | `"none"`  | `"yes"`, `"no"`, or `"none"`      |

#### SCRIPT Steps

| Field           | Type   | Description          |
| --------------- | ------ | -------------------- |
| `script_config` | object | Script configuration |

**script_config:**

| Field      | Type   | Description                        |
| ---------- | ------ | ---------------------------------- |
| `language` | string | Script language (e.g., `"python"`) |
| `source`   | string | Script source code                 |

#### GATE Steps

A GATE step has exactly one incoming and one outgoing connection (validated), no output parameters, and no `resource_command_specifications` (the engine rejects resource commands on a GATE step with error code `GATE_RESOURCES_UNSUPPORTED` -- a GATE never acquires resources during its own activation, armed or not, but the engine's completion pipeline still releases any resource commands a step declares, which would release a pool slot no acquire ever granted).

| Field         | Type   | Description                               |
| ------------- | ------ | ----------------------------------------- |
| `gate_config` | object | Gate configuration -- all fields optional |

**gate_config:**

| Field                      | Type    | Default           | Description                                                                                                                                                                                                                                                          |
| -------------------------- | ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cycle_seconds`            | number  | `5`               | Re-evaluation interval in seconds; must be `>= 1` when present                                                                                                                                                                                                       |
| `language`                 | string  | --                | Script language (mirrors `script_config.language`)                                                                                                                                                                                                                   |
| `source`                   | string  | pass-through TRUE | Script source; must `return` a value, coerced by JS truthiness. No source means the gate opens immediately. Inputs are supplied the same way as SCRIPT steps (positional locals by `input_parameter_specifications[].id`, all strings); there is no `output` object. |
| `control_previous_action`  | boolean | `false`           | Opt into armed behavior (see below). Absent/false = the gate waits for the previous step to complete like any other step. Never emitted as `false` -- absence and `false` are the same "off" state on the wire.                                                      |
| `action_property_bindings` | array   | `[]`              | Bindings of gate script inputs to live Environment Action Properties (see below)                                                                                                                                                                                     |

**Action Property Binding:**

| Field              | Type   | Required | Description                                                                                                                                                                                           |
| ------------------ | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parameter_id`     | string | Yes      | Matches an `input_parameter_specifications[].id` on the same GATE step                                                                                                                                |
| `environment_oid`  | string | No       | OID of the environment declaring the Action Property                                                                                                                                                  |
| `environment_name` | string | No       | Local name of the environment, used as a fallback if `environment_oid` fails to resolve (the engine tries `environment_oid` first, then `environment_name`, so the dual binding survives a stale oid) |
| `property`         | string | Yes      | Dotted `Property.Entry` name on the action server; the outer name alone means the whole group                                                                                                         |

A binding causes that input to be re-read live from the bound environment's action server on every evaluation cycle, instead of from the workflow's own property store. When `control_previous_action` is `true` and the GATE step is the sole successor of an ACTION PROXY step, the two run concurrently: a TRUE result while the action is still running sends the action a STOP command (if supported) and opens the gate; if the action completes first, execution holds at the gate until it independently returns TRUE. When `control_previous_action` is absent or `false` (the default), the gate is an ordinary successor -- it is materialized only once the preceding step completes, the same as a gate anywhere else in the workflow.

#### SELECT 1 Steps

| Field            | Type   | Description                    |
| ---------------- | ------ | ------------------------------ |
| `select1_config` | object | Multi-way branch configuration |

**select1_config:**

| Field              | Type   | Description                   |
| ------------------ | ------ | ----------------------------- |
| `input_name`       | string | Name of the input to evaluate |
| `input_value_type` | string | `"literal"` or `"property"`   |
| `options`          | array  | Branch options (see below)    |

**Select1 Option:**

| Field        | Type    | Required | Description                                                                  |
| ------------ | ------- | -------- | ---------------------------------------------------------------------------- |
| `id`         | string  | Yes      | Unique ID (also Handle ID and connection_id)                                 |
| `label`      | string  | Yes      | Display label                                                                |
| `operator`   | string  | Yes      | `"=="`, `"!="`, `"<"`, `">"`, `"<="`, `">="`, `"Contains"`, `"Not Contains"` |
| `value`      | string  | Yes      | Comparison value                                                             |
| `value_type` | string  | Yes      | `"literal"` or `"property"`                                                  |
| `is_default` | boolean | Yes      | Whether this is the default branch                                           |

### UI Parameter Specification

Used by `USER_INTERACTION` and `YES_NO` steps to define screen content.

| Field       | Type    | Required | Description                                       |
| ----------- | ------- | -------- | ------------------------------------------------- |
| `oid`       | string  | No       | Snowflake OID                                     |
| `type`      | string  | Yes      | UI element type (see below)                       |
| `value`     | string  | Yes      | Content value                                     |
| `font_size` | number  | No       | Font size for text elements                       |
| `color`     | string  | No       | Text color (CSS color string)                     |
| `lines`     | integer | No       | Number of lines for text input                    |
| `align`     | string  | No       | `"left"`, `"center"`, or `"right"`                |
| `value2`    | string  | No       | Secondary value (e.g., No label for YesNoButtons) |

**UI Element Types:**

| Value                | Description                   |
| -------------------- | ----------------------------- |
| `Button`             | Action button                 |
| `Header`             | Large text heading            |
| `Text`               | Body text                     |
| `SmallText`          | Small text                    |
| `Image`              | Image (value is filename key) |
| `Video`              | Video (value is URL)          |
| `TextInput`          | Single-line text input        |
| `YesNoButtons`       | Yes/No button pair            |
| `PickList`           | Single-selection list         |
| `CheckboxList`       | Multi-selection checkboxes    |
| `FormField`          | Single-line form field        |
| `FormFieldMultiline` | Multi-line form field         |
| `FormFieldNumeric`   | Numeric input field           |
| `FormFieldPhone`     | Phone number input field      |
| `FormFieldEmail`     | Email input field             |
| `Divider`            | Horizontal divider line       |

### Legacy Step Configs (Backward Compatibility)

These are retained for import compatibility with pre-v4.0 files:

**text_input_config:** `{ required?, validation_type?, default_value? }`
**pick_one_config:** `{ options?: [{ id, label, value }], default_option_id? }`
**checkbox_config:** `{ options?: [{ id, label, value, default_checked? }], output_format?, min_selections?, max_selections? }`

---

## 8. Connections

Connections define the edges between workflow steps.

| Field              | Type   | Required | Description                           |
| ------------------ | ------ | -------- | ------------------------------------- |
| `from_step_id`     | string | Yes      | Source step `local_id`                |
| `to_step_id`       | string | Yes      | Target step `local_id`                |
| `connection_id`    | string | No       | Unique identifier for this connection |
| `source_handle_id` | string | No       | Source handle ID (for branching)      |
| `condition`        | string | No       | Condition expression (for SELECT 1)   |
| `waypoints`        | array  | No       | Edge routing waypoints                |

### Branching Conventions

**YES_NO branches:**

- Yes path: `{ "source_handle_id": "yes" }`
- No path: `{ "source_handle_id": "no" }`
- Both paths must converge at a `WAIT ANY` step

**SELECT 1 branches:**

- Each option uses `source_handle_id` matching the option's `id`
- The `condition` field contains the display text

**PARALLEL branches:**

- Fork from `PARALLEL` step to multiple branches
- All branches must converge at a `WAIT_ALL` step

### Waypoints

```json
{ "x": 50, "y": -20 }
```

Each `waypoints[i]` is an **offset (delta)** from a default midpoint that the editor's orthogonal router computes from the source/target step positions and the workflow's notation — NOT an absolute canvas point. In current data the array length is effectively 0 or 1 (only `waypoints[0]` is read).

Active component depends on flow direction and whether the connection is forward or a backward loop:

| Notation              | Direction                   | Active offset | Shifts                                              |
| --------------------- | --------------------------- | ------------- | --------------------------------------------------- |
| Vertical (TB, ISA-88) | forward (`targetY>sourceY`) | `wpY`         | Y of the horizontal crossover segment               |
| Vertical              | backward (loop)             | `wpX`         | X of the vertical bypass lane to the right of nodes |
| Horizontal (LR, BPMN) | forward (`targetX>sourceX`) | `wpX`         | X of the vertical crossover segment                 |
| Horizontal            | backward (loop)             | `wpY`         | Y of the horizontal bypass lane below nodes         |

Coordinate space matches `step.position.{x, y}` (+X right, +Y down). The off-axis component is read but not applied; values are snapped to a 5 px grid in the editor. Waypoints are presentation metadata — pure execution engines may ignore them. Missing `waypoints`, `[]`, and `[{x:0, y:0}]` all render identically.

For the full routing algorithm and worked examples — needed by any runtime that wants to recreate the diagram — see [`docs/specs/07-connection-waypoint-routing.md`](docs/specs/07-connection-waypoint-routing.md).

---

## 9. Shared Definitions

### Parameter Specification (Input)

| Field           | Type   | Required | Description                           |
| --------------- | ------ | -------- | ------------------------------------- |
| `id`            | string | Yes      | Parameter name identifier             |
| `oid`           | string | No       | Snowflake OID                         |
| `description`   | string | No       | Human-readable description            |
| `default_value` | string | Yes      | Default value                         |
| `value_type`    | string | No       | `"literal"` (default) or `"property"` |
| `json_schema`   | string | No       | JSON Schema string for validation     |
| `entries`       | array  | No       | Structured `{ name, value }` entries  |

### Output Parameter Specification

| Field         | Type   | Required | Description                                |
| ------------- | ------ | -------- | ------------------------------------------ |
| `id`          | string | Yes      | Output parameter name identifier           |
| `oid`         | string | No       | Snowflake OID                              |
| `description` | string | No       | Human-readable description                 |
| `target`      | string | No       | Value property name where output is stored |
| `entries`     | array  | No       | Structured `{ name, value }` entries       |

### Property Specification (Named Values)

| Field     | Type   | Required | Description                                      |
| --------- | ------ | -------- | ------------------------------------------------ |
| `name`    | string | Yes      | Property name                                    |
| `oid`     | string | No       | Snowflake OID                                    |
| `entries` | array  | No       | Array of `{ name: string, value: string }` pairs |

### Resource Property Specification

| Field           | Type             | Required | Description                        |
| --------------- | ---------------- | -------- | ---------------------------------- |
| `name`          | string           | Yes      | Resource name                      |
| `resource_type` | string           | Yes      | Resource type (see below)          |
| `scope`         | string           | No       | `"workflow"` or `"environment"`    |
| `use_limit`     | integer          | No       | Pool size limit                    |
| `description`   | string           | No       | Description                        |
| `names`         | array of strings | No       | Named identifiers (for named pool) |

**Resource Types:**

| Value                                | Description                      |
| ------------------------------------ | -------------------------------- |
| `binary exclusive use`               | Single exclusive lock            |
| `binary shared use with pool limits` | Shared lock with pool limit      |
| `countable use with pool limits`     | Countable semaphore with limit   |
| `named pool`                         | Pool of named resource instances |
| `sync`                               | Synchronization point            |

### Resource Command Specification

| Field           | Type    | Required | Description                                 |
| --------------- | ------- | -------- | ------------------------------------------- |
| `oid`           | string  | No       | Snowflake OID                               |
| `command_type`  | string  | Yes      | Command type (see below)                    |
| `resource_name` | string  | Yes      | Target resource name                        |
| `amount`        | integer | No       | Amount for pool commands                    |
| `target`        | string  | No       | Value property to store acquired handle     |
| `source`        | string  | No       | Value property reference for sync send data |

**Command Types:**

| Value                 | Description                      |
| --------------------- | -------------------------------- |
| `Acquire`             | Acquire exclusive or shared lock |
| `Release`             | Release a lock                   |
| `Acquire Pool Amount` | Acquire a count from a pool      |
| `Release Pool Amount` | Release a count to a pool        |
| `Send`                | Send data via sync resource      |
| `Receive`             | Receive data via sync resource   |
| `Synchronize`         | Synchronize at a sync point      |

### Rich Text Content

Text and Header form elements use a wrapper format when exported:

| Field       | Type   | Description                                        |
| ----------- | ------ | -------------------------------------------------- |
| `content`   | string | HTML string (Tiptap format with parameter chips)   |
| `plainText` | string | Plain text with `<name.key>` placeholders restored |

```json
{
  "content": "<p>Hello <span data-param-chip=\"user.name\"></span>, welcome!</p>",
  "plainText": "Hello <user.name>, welcome!"
}
```

On import, the wrapper is unwrapped — only the `content` (HTML) field is stored internally.

---

## 10. WYSIWYG Form Layout

The `form_layout_config` array on `USER_INTERACTION` and `YES_NO` steps defines the WYSIWYG form for each device breakpoint.

### Form Layout Entry

| Field          | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `deviceType`   | string | Yes      | `"phone"`, `"tablet"`, or `"desktop"` |
| `canvasWidth`  | number | Yes      | Canvas width in logical pixels        |
| `canvasHeight` | number | Yes      | Canvas height in logical pixels       |
| `elements`     | array  | Yes      | Array of form element objects         |

### Standard Canvas Dimensions

| Device  | Width | Height |
| ------- | ----- | ------ |
| Phone   | 390   | 844    |
| Tablet  | 768   | 1024   |
| Desktop | 1280  | 800    |

### Chrome Zones (Reserved Areas)

Runtime devices reserve screen areas for navigation chrome. Form elements must not overlap these zones.

| Device  | Top Chrome    | Bottom Chrome    | Usable Content Area |
| ------- | ------------- | ---------------- | ------------------- |
| Phone   | 15% (0-127px) | 10% (760-844px)  | 127-760px           |
| Tablet  | 10% (0-102px) | 10% (922-1024px) | 102-922px           |
| Desktop | 10% (0-80px)  | 8% (736-800px)   | 80-736px            |

### Form Element Images

Steps with form image elements include a mapping array:

```json
"form_element_images": [
  { "image_oid": "7890123456", "filename": "photo.jpg" }
]
```

This maps each image element's stable `imageOid` to its filename in the `images/` folder of the ZIP.

---

## 11. Form Element Types

All form elements share these base fields:

| Field    | Type   | Description                                 |
| -------- | ------ | ------------------------------------------- |
| `type`   | string | Discriminant tag (permanent — never rename) |
| `x`      | number | Horizontal position in logical pixels       |
| `y`      | number | Vertical position in logical pixels         |
| `width`  | number | Width in logical pixels                     |
| `height` | number | Height in logical pixels                    |

Element `id` fields are NOT exported — they are regenerated on import via snowflake OID generation.

### button

Tappable action button that emits `outputValue` to the workflow engine.

| Field         | Type    | Description                                                    |
| ------------- | ------- | -------------------------------------------------------------- |
| `label`       | string  | Button face text                                               |
| `outputValue` | string  | Value emitted on tap (e.g., `"continue"`, `"true"`, `"false"`) |
| `deletable`   | boolean | `false` for required Yes/No buttons; absent = deletable        |

```json
{ "type": "button", "x": 95, "y": 700, "width": 200, "height": 44, "label": "Done", "outputValue": "continue" }
```

### text

Static text label. Content is rich text (HTML) wrapped in `RichTextContent` on export.

| Field        | Type                      | Description                                            |
| ------------ | ------------------------- | ------------------------------------------------------ |
| `content`    | string \| RichTextContent | Text content (HTML internally, wrapped on export)      |
| `fontSize`   | number                    | Font size in logical pixels (default: 16)              |
| `fontWeight` | string                    | `"normal"` or `"bold"` (default: `"normal"`)           |
| `color`      | string                    | CSS color string                                       |
| `align`      | string                    | `"left"`, `"center"`, or `"right"` (default: `"left"`) |

```json
{
  "type": "text",
  "x": 20,
  "y": 180,
  "width": 350,
  "height": 60,
  "content": { "content": "<p>Check the voltage reading</p>", "plainText": "Check the voltage reading" },
  "fontSize": 15
}
```

### header

Large title text. Same structure as `text` with different default styling.

| Field        | Type                      | Description                                            |
| ------------ | ------------------------- | ------------------------------------------------------ |
| `content`    | string \| RichTextContent | Header content                                         |
| `fontSize`   | number                    | Font size (default: 24)                                |
| `fontWeight` | string                    | `"normal"` or `"bold"` (default: `"bold"`)             |
| `color`      | string                    | CSS color string                                       |
| `align`      | string                    | `"left"`, `"center"`, or `"right"` (default: `"left"`) |

```json
{
  "type": "header",
  "x": 20,
  "y": 130,
  "width": 350,
  "height": 36,
  "content": { "content": "<p>Voltage Check</p>", "plainText": "Voltage Check" },
  "fontSize": 22,
  "fontWeight": "bold",
  "align": "center"
}
```

### textInput

Single-line text input field with parameter binding support.

| Field               | Type    | Description                                     |
| ------------------- | ------- | ----------------------------------------------- |
| `label`             | string  | Label displayed above the input                 |
| `placeholder`       | string  | Placeholder text when empty                     |
| `fieldName`         | string  | JSON key for output value (valid JS identifier) |
| `required`          | boolean | Must fill before submit (default: false)        |
| `fontSize`          | number  | Font size (default: 14)                         |
| `outputParameter`   | string  | Parameter `name.key` for runtime value capture  |
| `defaultSource`     | object  | Default value source (see below)                |
| `placeholderSource` | object  | Dynamic placeholder source                      |

```json
{
  "type": "textInput",
  "x": 20,
  "y": 400,
  "width": 350,
  "height": 40,
  "label": "Voltage Reading",
  "placeholder": "Enter voltage...",
  "fieldName": "voltage_reading",
  "required": true,
  "fontSize": 16,
  "outputParameter": "Readings.Voltage",
  "defaultSource": { "mode": "input", "value": "PreviousReadings.Voltage" }
}
```

**ParameterDefaultSource:**

| Mode                                          | Description                                   |
| --------------------------------------------- | --------------------------------------------- |
| `{ "mode": "static", "value": "..." }`        | Fixed literal default                         |
| `{ "mode": "property", "value": "Name.Key" }` | Value Property reference resolved at runtime  |
| `{ "mode": "input", "value": "Name.Key" }`    | Input parameter reference resolved at runtime |

### textarea

Multi-line text input. Same parameter binding as `textInput`.

| Field               | Type    | Description                              |
| ------------------- | ------- | ---------------------------------------- |
| `label`             | string  | Label displayed above                    |
| `placeholder`       | string  | Placeholder text                         |
| `fieldName`         | string  | JSON key for output value                |
| `required`          | boolean | Must fill before submit                  |
| `rows`              | number  | Visible text rows (default: 4)           |
| `outputParameter`   | string  | Parameter `name.key` for runtime capture |
| `defaultSource`     | object  | Default value source                     |
| `placeholderSource` | object  | Dynamic placeholder source               |

### image

Image display element.

| Field       | Type   | Description                                                       |
| ----------- | ------ | ----------------------------------------------------------------- |
| `src`       | string | Filename key (into images map) or https:// URL                    |
| `imageOid`  | string | Stable OID for export namespacing (generated once, never changes) |
| `objectFit` | string | `"contain"` (default), `"cover"`, or `"fill"`                     |

```json
{ "type": "image", "x": 20, "y": 176, "width": 350, "height": 200, "src": "outdoor-unit.jpg", "objectFit": "cover" }
```

### video

Video player element. Only HTTPS URLs supported.

| Field       | Type   | Description                  |
| ----------- | ------ | ---------------------------- |
| `src`       | string | HTTPS URL to video source    |
| `posterUrl` | string | Optional thumbnail image URL |

```json
{ "type": "video", "x": 20, "y": 176, "width": 350, "height": 220, "src": "https://example.com/video.mp4" }
```

### checkbox

Checkbox group. Multiple selections allowed.

| Field             | Type    | Description                                  |
| ----------------- | ------- | -------------------------------------------- |
| `label`           | string  | Group label                                  |
| `fieldName`       | string  | JSON key for selected values array           |
| `options`         | array   | `[{ "label": "...", "value": "..." }]`       |
| `fontSize`        | number  | Option label font size (default: 13)         |
| `required`        | boolean | Must check at least one                      |
| `outputParameter` | string  | Value Property reference for runtime capture |

### radio

Radio button group. Single selection.

| Field             | Type    | Description                                  |
| ----------------- | ------- | -------------------------------------------- |
| `label`           | string  | Group label                                  |
| `fieldName`       | string  | JSON key for selected value                  |
| `options`         | array   | `[{ "label": "...", "value": "..." }]`       |
| `fontSize`        | number  | Option label font size (default: 13)         |
| `required`        | boolean | Must select one                              |
| `outputParameter` | string  | Value Property reference for runtime capture |

### divider

Horizontal separator line.

| Field       | Type   | Description                             |
| ----------- | ------ | --------------------------------------- |
| `thickness` | number | Line thickness in pixels (default: 1)   |
| `color`     | string | CSS color string (default: `"#e2e8f0"`) |

```json
{ "type": "divider", "x": 20, "y": 386, "width": 350, "height": 2, "thickness": 1, "color": "#e2e8f0" }
```

### timer

Countdown or countup timer element.

| Field             | Type    | Description                                                |
| ----------------- | ------- | ---------------------------------------------------------- |
| `label`           | string  | Label above timer (default: `"Timer"`)                     |
| `fieldName`       | string  | JSON key for elapsed time value                            |
| `durationSeconds` | number  | Timer duration in seconds (minimum: 1, default: 300)       |
| `direction`       | string  | `"countdown"` or `"countup"`                               |
| `blockDone`       | boolean | Block step completion until timer expires (default: false) |
| `outputParameter` | string  | Value Property reference for runtime capture               |
| `defaultSource`   | object  | Default duration source                                    |

```json
{
  "type": "timer",
  "x": 20,
  "y": 300,
  "width": 350,
  "height": 120,
  "label": "Curing Timer",
  "fieldName": "cure_time",
  "durationSeconds": 600,
  "direction": "countdown",
  "blockDone": true
}
```

**Timer runtime behavior:**

- Countdown: starts at `durationSeconds`, counts to 0
- Countup: starts at 0, counts to `durationSeconds`
- `blockDone`: disables step Done button until timer expires or user explicitly stops
- Elapsed time captured as total seconds (integer)

---

## 12. ZIP Package Formats

### 12.1 Workflow Package (`.WFmasterX`)

The standard export format for a single workflow with its images.

**ZIP Structure:**

```
{WorkflowName}.WFmaster          # Workflow specification JSON
images/{filename}                 # UI parameter images (no prefix)
images/{imageOid}-{filename}      # Form element images (OID-prefixed)
```

No manifest file in this format. The `.WFmaster` file at the ZIP root is identified by extension.

**Import Detection:**

- Look for a `.WFmaster` file at the ZIP root (no subdirectory path)
- Extract images from `images/` folder
- For OID-prefixed images: store under both prefixed and bare filename keys

---

### 12.2 Runtime Package (`.WFmasterX`)

An extended workflow package that includes all dependent libraries for self-contained runtime deployment.

**ZIP Structure:**

```
manifest.json                            # Package metadata
{WorkflowName}.WFmaster                  # Main workflow JSON
environments/{EnvName}.WFenvir           # Environment library JSON files
actions/{ActionName}.WFaction             # Action library JSON files
images/{filename}                        # UI parameter images
images/{imageOid}-{filename}             # Form element images
```

**manifest.json:**

```json
{
  "packageVersion": "1.0",
  "workflowName": "My Workflow",
  "environmentLibraries": ["Kitchen Environment Library"],
  "actionLibraries": ["My Action Library"],
  "createdAt": "2026-03-01T12:00:00.000Z",
  "files": [
    { "path": "My Workflow.WFmaster", "type": "workflow" },
    { "path": "environments/Kitchen Environment Library.WFenvir", "type": "environment" },
    { "path": "actions/My Action Library.WFaction", "type": "action" },
    { "path": "images/outdoor-unit.jpg", "type": "image" }
  ]
}
```

**Key behaviors:**

- Referenced sub-workflows are resolved to embedded mode before export (no dangling references)
- Environment and action libraries are collected by traversing the workflow's environment specifications
- Images collected recursively from the main workflow and all child workflows

---

### 12.3 Library Package (`.WFlibX`)

Exports an entire library tree with all dependencies.

**ZIP Structure:**

```
manifest.json                            # Package metadata
{LibraryName}.WFlibX                     # Workflow library JSON (root)
steps/{StepLibName}.WFslibX              # Step library JSON files
environments/{EnvName}.WFenvir           # Environment library JSON files
actions/{ActionName}.WFaction             # Action library JSON files
images/{filename}                        # UI parameter images
images/{imageOid}-{filename}             # Form element images
```

**manifest.json:**

```json
{
  "packageType": "workflow-library",
  "packageVersion": "1.0",
  "libraryName": "My Workflow Library",
  "stepLibraries": ["Common Steps"],
  "environmentLibraries": ["Kitchen Environment Library"],
  "actionLibraries": ["My Action Library"],
  "createdAt": "2026-03-01T12:00:00.000Z",
  "files": [
    { "path": "My Workflow Library.WFlibX", "type": "workflow-library" },
    { "path": "steps/Common Steps.WFslibX", "type": "step-library" },
    { "path": "environments/Kitchen Environment Library.WFenvir", "type": "environment-library" },
    { "path": "actions/My Action Library.WFaction", "type": "action-library" },
    { "path": "images/photo.jpg", "type": "image" }
  ]
}
```

**Dependencies collected:**

- Step libraries: from `workflowProxy` nodes in reference mode
- Environment libraries: from workflow environment specifications
- Action libraries: from actions included in environments
- Images: recursively from all workflow specs in the library tree

---

### 12.4 Plain JSON Exports

Libraries without images export as plain JSON files (no ZIP wrapper):

| Type                | Extension   | Root Array                   |
| ------------------- | ----------- | ---------------------------- |
| Workflow Library    | `.WFmaster` | `workflow_specifications`    |
| Step Library        | `.WFslibX`  | `library_steps`              |
| Environment Library | `.WFenvir`  | `environment_specifications` |
| Action Library      | `.WFaction` | `action_specifications`      |

---

## 13. Image Handling

### Two Image Categories

| Category            | ZIP Path                       | Source                                             | Naming        |
| ------------------- | ------------------------------ | -------------------------------------------------- | ------------- |
| UI parameter images | `images/{filename}`            | `ui_parameter_specifications` with `type: "Image"` | Bare filename |
| Form element images | `images/{imageOid}-{filename}` | `form_layout_config` elements with `type: "image"` | OID-prefixed  |

### OID Prefixing

Form element images are prefixed to prevent collision when multiple steps use images with the same filename:

- **Primary:** `{imageOid}-{filename}` (if element has `imageOid`)
- **Fallback:** `{stepOid}-{filename}` (legacy elements without `imageOid`)

On import, the prefix is stripped:

1. Check for `{imageOid}-` prefix (8+ numeric characters followed by dash)
2. Fall back to `{stepOid}-` prefix
3. Store image under both prefixed and bare filename keys

### MIME Type Inference

| Extension       | MIME Type                  |
| --------------- | -------------------------- |
| `.png`          | `image/png`                |
| `.jpg`, `.jpeg` | `image/jpeg`               |
| `.gif`          | `image/gif`                |
| `.webp`         | `image/webp`               |
| `.svg`          | `image/svg+xml`            |
| `.bmp`          | `image/bmp`                |
| `.ico`          | `image/x-icon`             |
| Other           | `application/octet-stream` |

### Storage Format

Images are stored as data URIs internally: `data:{mime};base64,{base64Data}`

- **Export:** Parse data URI -> extract base64 -> store in ZIP as binary
- **Import:** Read binary from ZIP -> encode base64 -> reconstruct data URI with MIME type
- **External URLs** (`http://`, `https://`) are stored as-is, not included in ZIP

---

## 14. Schema Version History

| Version     | Description                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.0**     | Current. USER_INTERACTION step with WYSIWYG form layouts, resource commands (Send/Receive/Synchronize), script steps, parameter binding, rich text, timer elements. Legacy UI step types removed. |
| **3.0**     | Added FORM_ENTRY step type (migrated to USER_INTERACTION in v4.0). WYSIWYG form designer introduced.                                                                                              |
| **Pre-3.0** | Legacy formats without `schemaVersion` field. Block-based UI steps (Instruction, TextInput, PickOne, Checkbox).                                                                                   |

### Import Compatibility

- Files with `schemaVersion: "4.0"` are accepted
- Files with `schemaVersion < 4.0` or no `schemaVersion` are rejected as legacy format
- AJV (JSON Schema Draft-07) validation is applied against schema files in `src/lib/schemas/`

### Validation

Import validation uses AJV with the following schema files:

| Schema File                         | Validates                |
| ----------------------------------- | ------------------------ |
| `managed-element.json`              | Base element structure   |
| `master-action-library.json`        | Action library JSON      |
| `master-environment-library.json`   | Environment library JSON |
| `master-workflow-library.json`      | Workflow library JSON    |
| `master-workflow-step-library.json` | Step library JSON        |

All schemas are located in `src/lib/schemas/` and use JSON Schema Draft-07 with the base URI `https://trajectorypro.io/schemas/`.
