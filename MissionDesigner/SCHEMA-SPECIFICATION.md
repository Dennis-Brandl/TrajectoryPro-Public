# Mission Designer — Schema & Package Specification

**Schema Version:** 5.0
**JSON Schema Draft:** Draft-07
**Base URI:** `https://trajectorypro.io/schemas/`
**Last Updated:** 2026-10-29

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
15. [Form Document v2](#15-form-document-v2)

---

## 1. Introduction

Trajectory Pro Mission Control is a distributed workflow system: users author workflows in Mission Designer, export them as packages, load them into work centers in Mission Commander, and run them on Mission Engine, with operators working in Mission Pilot. This specification defines the JSON data models and ZIP packaging formats Mission Designer uses for import, export and interchange with the rest of the suite. The suite-wide reference, covering every application's packages, is `docs/JSON_SCHEMA.md` at the root of the Trajectory Pro Mission Control repository.

### Exchangeable Artifacts

| Artifact                    | Extension       | Format | Description                                                            |
| --------------------------- | --------------- | ------ | ---------------------------------------------------------------------- |
| Workflow (Runtime) Package  | `.WFmasterX`    | ZIP    | Workflow + its environment and action libraries + images               |
| Workflow Library Package    | `.WFlibX`       | ZIP    | Full workflow library tree + dependencies + images                     |
| Step Library Package        | `.WFstepLibX`   | ZIP    | Step library + its environment and action libraries + images           |
| Environment Library Package | `.WFenvirLibX`  | ZIP    | Environment library + the action libraries it uses                     |
| Action Library Package      | `.WFactionLibX` | ZIP    | Action library                                                         |
| Environment Package         | `.WFenvirX`     | ZIP    | One environment + its actions (also loads into Mission Commander)      |
| Workflow Specification      | `.WFmaster`     | JSON   | One workflow specification (canvas export; inner file of `.WFmasterX`) |
| Workflow Library            | `.WFlib`        | JSON   | Workflow library JSON (inner file of `.WFlibX`)                        |
| Step Library                | `.WFslib`       | JSON   | Step library JSON (inner file of `.WFstepLibX` and `.WFlibX`)          |
| Environment Library         | `.WFenvir`      | JSON   | Environment library JSON (a single environment inside `.WFenvirX`)     |
| Action Library              | `.WFaction`     | JSON   | Action library JSON (a single action inside `.WFenvirX`)               |

`.WFslibX` is the former name of `.WFstepLibX`; Mission Designer still imports it.

### Identification System

Every entity uses dual identification:

- **`local_id`** — Human-readable name (e.g., "Bake Cookies")
- **`oid`** — Globally unique, opaque string

Mission Designer issues UUIDs for library and specification OIDs and numeric snowflake strings (e.g. `"6000000000001"`) for steps, parameters, properties and form blocks. Treat every OID as opaque. The `local_id` serves as the display name and may be renamed by users.

### Parameters

- Input parameters are untyped strings (e.g., `"350"`, `"[1,2,3]"`, `"abcdef"`)
- Optional JSON Schema validation can constrain parameter values
- Parameters use dot notation for referencing value properties: `PropertyName.EntryName`

---

## 2. Managed Element (Base Schema)

**Schema ID:** `managed-element.json`

All top-level objects and specifications inherit from this base.

| Field                | Type               | Required | Description                                                                                                                                                  |
| -------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `local_id`           | string             | Yes      | Human-readable name                                                                                                                                          |
| `oid`                | string             | Yes      | Snowflake OID (globally unique)                                                                                                                              |
| `version`            | string             | Yes      | Version string; Mission Designer writes `"1.0.0"` when none is set, and on every step                                                                        |
| `last_modified_date` | string (date-time) | Yes      | ISO 8601 timestamp                                                                                                                                           |
| `description`        | string             | No       | Human-readable description                                                                                                                                   |
| `schemaVersion`      | string             | No       | Trajectory schema version: `"3.0"`, `"4.0"` or `"5.0"`. Mission Designer writes `"5.0"` on every workflow specification (root and children) and nowhere else |

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/managed-element.json",
  "title": "Managed Workflow Element",
  "type": "object",
  "properties": {
    "schemaVersion": { "type": "string", "enum": ["3.0", "4.0", "5.0"] },
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

| Field                   | Type   | Required | Description                                                |
| ----------------------- | ------ | -------- | ---------------------------------------------------------- |
| `action_specifications` | array  | Yes      | List of action specifications                              |
| `child_libraries`       | array  | No       | Nested child action libraries (recursive)                  |
| `parent_library_oid`    | string | No       | OID of the parent library (provenance only; not read back) |

### Action Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                             | Type   | Required | Description                                                                                     |
| --------------------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------- |
| `state`                           | string | No       | Lifecycle state (`Draft` … `Obsolete`); accepted by the schema, not written by Mission Designer |
| `input_parameter_specifications`  | array  | No       | Input parameters                                                                                |
| `output_parameter_specifications` | array  | No       | Output parameters                                                                               |
| `property_specifications`         | array  | No       | Named value properties                                                                          |
| `action_visibility`               | string | No       | `"opaque"` or `"observable"`; Mission Designer always writes it (default `"opaque"`)            |

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

| Field                        | Type   | Required | Description                                                |
| ---------------------------- | ------ | -------- | ---------------------------------------------------------- |
| `environment_specifications` | array  | Yes      | List of environment specifications                         |
| `child_libraries`            | array  | No       | Nested child environment libraries (recursive)             |
| `parent_library_oid`         | string | No       | OID of the parent library (provenance only; not read back) |

### Environment Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                              | Type   | Required | Description                                                                                                                                                                                       |
| ---------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library_name`                     | string | No       | Name of the environment library; a workflow package import links a workflow to its environments by this name                                                                                      |
| `library_oid`                      | string | No       | OID of the environment library (provenance)                                                                                                                                                       |
| `state`                            | string | No       | Lifecycle state (`Draft` … `Obsolete`)                                                                                                                                                            |
| `included_actions`                 | array  | Yes      | Actions included in this environment                                                                                                                                                              |
| `value_property_specifications`    | array  | No       | Named value properties                                                                                                                                                                            |
| `value_type_specifications`        | array  | No       | Designer-only Value Type templates (Designer library packages only; omitted from runtime packages). Entry: `{ name, oid?, description?, entries: [{ name, value? }] }`, entries in authored order |
| `action_property_specifications`   | array  | No       | Action Properties: values held on the action server that bound step inputs read live (see [Action Property Binding](#gate-steps))                                                                 |
| `resource_property_specifications` | array  | No       | Resource definitions                                                                                                                                                                              |
| `action_server_specifications`     | array  | No       | `{ name, uri, description?, connection_type: "REST", api_key? }`. A blank `uri` is allowed: the server is then bound per work center in Mission Commander                                         |

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

When the action could be resolved at export time, all inlined fields are populated together. When not (legacy entries, missing library context), only `action_name` + `action_library` are emitted — consumers can detect the unresolved case by absence of `oid`. Mission Engine reads a roster entry's OID as `action_oid ?? oid`, so packages that spell it `action_oid` still run; Mission Designer writes `oid`.

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
| `schemaVersion`                     | string | No       | `"5.0"` (written by Mission Designer). A `.WFmasterX` import requires `"4.0"` – `"5.0"`                                                                               |
| `type_name`                         | string | No       | Optional ISA 88 type (e.g. `Operation`), at most 50 characters. Informational only; never affects execution. Omitted when unset. Also allowed on each child workflow. |
| `display_style`                     | string | No       | `"flowchart"`, `"bpmn"` or `"isa88"` — the authoring notation                                                                                                         |
| `state`                             | string | No       | Lifecycle state (`Draft`, `InTest`, `InReview`, `Approved`, `Effective`, `Superseded`, `Obsolete`)                                                                    |
| `library_name`, `library_oid`       | string | No       | Name and OID of the library the workflow lives in (provenance)                                                                                                        |
| `steps`                             | array  | Yes      | Workflow steps                                                                                                                                                        |
| `connections`                       | array  | Yes      | Step connections                                                                                                                                                      |
| `resource_command_specifications`   | array  | No       | Workflow-level resource commands (allowed; Mission Designer does not write them)                                                                                      |
| `resource_property_specifications`  | array  | No       | Workflow-level resource definitions                                                                                                                                   |
| `value_property_specifications`     | array  | No       | Workflow-level named values                                                                                                                                           |
| `starting_parameter_specifications` | array  | No       | Workflow input parameters                                                                                                                                             |
| `output_parameter_specifications`   | array  | No       | Workflow output parameters                                                                                                                                            |
| `try_specifications`                | array  | No       | Workflow-level TRY fallback rows (see [TRY / CATCH / RETURN](#try--catch--return))                                                                                    |
| `environment_specifications`        | array  | No       | Embedded environment specifications (in full, with inlined action bodies)                                                                                             |
| `children`                          | array  | No       | Embedded child workflows (see [Child Workflows](#child-workflows))                                                                                                    |
| `viewport`                          | object | No       | Canvas viewport state                                                                                                                                                 |

### Child Workflows

Each `children[]` entry has the same fields as a workflow specification plus `parentChildSpecId` (required; `null` for a direct child of the root, otherwise the OID of the parent child) and required `version` and `state` (Mission Designer writes the root workflow's values). Grandchildren nest under `children`. A `WORKFLOW PROXY` step runs the child whose `local_id` equals the step's `local_id`. In a `.WFmasterX`, children carry no `environment_specifications`: the engine resolves them against the root's. The pre-v7.0 flat `child_workflows` field is no longer read.

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
      "schemaVersion": "5.0",
      "local_id": "Bake Cookies",
      "oid": "3000000002",
      "version": "1.0.0",
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
      "connections": [{ "from_step_id": "3000000010", "to_step_id": "3000000012" }],
      "viewport": { "x": 0, "y": 0, "zoom": 1 }
    }
  ]
}
```

---

## 6. Master Workflow Step Library

**Schema ID:** `master-workflow-step-library.json`

A collection of reusable workflows. A `WORKFLOW PROXY` step can reference one; the reference is resolved into an embedded child workflow when the workflow is exported as a `.WFmasterX`.

### Top Level

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                     | Type   | Required | Description                                                                                                |
| ------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| `workflow_specifications` | array  | Yes      | Workflow specifications (same structure as in a workflow library; each requires `steps` and `connections`) |
| `child_libraries`         | array  | No       | Nested child step libraries (recursive)                                                                    |
| `parent_library_oid`      | string | No       | OID of the parent library (provenance only; not read back)                                                 |

### Example

```json
{
  "local_id": "Common Steps",
  "oid": "4000000001",
  "version": "1.0.0",
  "last_modified_date": "2026-02-24T12:00:00.000Z",
  "workflow_specifications": [
    {
      "schemaVersion": "5.0",
      "local_id": "User Confirmation",
      "oid": "4000000002",
      "version": "1.0.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "state": "Draft",
      "steps": [
        {
          "local_id": "Start",
          "oid": "4000000010",
          "version": "1.0.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "START"
        },
        {
          "local_id": "Confirm",
          "oid": "4000000011",
          "version": "1.0.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "YES_NO",
          "yes_no_config": { "yes_label": "Confirm", "no_label": "Cancel", "yes_value": "true", "no_value": "false" }
        },
        {
          "local_id": "End",
          "oid": "4000000012",
          "version": "1.0.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "END"
        }
      ],
      "connections": [
        { "from_step_id": "4000000010", "to_step_id": "4000000011" },
        { "from_step_id": "4000000011", "to_step_id": "4000000012", "source_handle_id": "yes" },
        { "from_step_id": "4000000011", "to_step_id": "4000000012", "source_handle_id": "no" }
      ]
    }
  ]
}
```

---

## 7. Workflow Step Schema

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

### Common Fields

| Field                             | Type             | Required | Description                                                                                                               |
| --------------------------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `step_type`                       | string           | Yes      | Step type enum (see below)                                                                                                |
| `position`                        | object           | No       | Canvas position `{ x: number, y: number }`                                                                                |
| `action_visibility`               | string           | No       | `"opaque"` or `"observable"` (written on every `ACTION PROXY`, default `"opaque"`)                                        |
| `input_parameter_specifications`  | array            | No       | Step input parameters                                                                                                     |
| `output_parameter_specifications` | array            | No       | Step output parameters                                                                                                    |
| `output_parameter_name`           | string           | No       | Output parameter name for UI steps (allowed by the schema; not written)                                                   |
| `value_property_specifications`   | array            | No       | Step-level named values                                                                                                   |
| `resource_command_specifications` | array            | No       | Step-level resource commands                                                                                              |
| `action_property_bindings`        | array            | No       | Live Action Property bindings of a non-GATE step's inputs (see [Action Property Binding](#gate-steps)); derived at export |
| `try_specifications`              | array            | No       | TRY rows (see [TRY / CATCH / RETURN](#try--catch--return))                                                                |
| `catch_id`                        | string           | No       | CATCH steps only                                                                                                          |
| `return_config`                   | object           | No       | RETURN steps only                                                                                                         |
| `connection_references`           | array of strings | No       | References to connections (allowed by the schema; not written)                                                            |

### Step Types

| Value              | Description                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `START`            | Workflow entry point                                                                                                                                 |
| `END`              | Workflow exit point                                                                                                                                  |
| `ACTION PROXY`     | Execute an environment action and wait for it to finish                                                                                              |
| `WORKFLOW PROXY`   | Run a child workflow                                                                                                                                 |
| `SELECT 1`         | Conditional branch (evaluate conditions)                                                                                                             |
| `WAIT ANY`         | Wait for any incoming branch to complete                                                                                                             |
| `PARALLEL`         | Fork execution into parallel branches                                                                                                                |
| `WAIT ALL`         | Wait for all incoming branches to complete                                                                                                           |
| `SCRIPT`           | Execute a JavaScript script, once or repeatedly                                                                                                      |
| `GATE`             | Cyclic boolean transition (ISA-88: Transition Step); re-evaluates a script on a cycle until it returns true and/or waits for a timer, then continues |
| `YES_NO`           | Binary user decision with configurable labels                                                                                                        |
| `USER_INTERACTION` | General user interaction with a form                                                                                                                 |
| `CATCH`            | Entry point of a catch network that handles a TRY                                                                                                    |
| `RETURN`           | Exit of a catch network; says how the workflow continues                                                                                             |

Older packages may contain `WAIT ACTION PROXY`, `NOWAIT ACTION PROXY` or `MATH`; the importer maps all three to an `ACTION PROXY` step and the exporter never writes them.

### Step-Type-Specific Fields

#### USER_INTERACTION / YES_NO Steps

| Field                         | Type   | Description                                                                                                                              |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ui_parameter_specifications` | array  | UI elements defining screen content (a YES_NO step's `YesNoButtons` entry holds its labels)                                              |
| `form_document`               | object | The step's form as a Form Document v2 (see [§15](#15-form-document-v2)); written only when the form has at least one block               |
| `form_layout_config`          | array  | Legacy WYSIWYG form layouts (3 device breakpoints); package format ≤ 4.0, read on import and converted to `form_document`, never written |
| `form_element_images`         | array  | Image OID-to-filename mapping for form images                                                                                            |

#### YES_NO Steps

| Field           | Type   | Description                 |
| --------------- | ------ | --------------------------- |
| `yes_no_config` | object | Yes/No button configuration |

**yes_no_config:**

| Field               | Type   | Default   | Description                                                                 |
| ------------------- | ------ | --------- | --------------------------------------------------------------------------- |
| `yes_label`         | string | `"Yes"`   | Custom label for Yes button                                                 |
| `no_label`          | string | `"No"`    | Custom label for No button                                                  |
| `yes_value`         | string | `"true"`  | Output value when Yes is selected (Mission Designer always writes `"true"`) |
| `no_value`          | string | `"false"` | Output value when No is selected (Mission Designer always writes `"false"`) |
| `default_selection` | string | `"none"`  | `"yes"`, `"no"`, or `"none"`                                                |

#### SCRIPT Steps

| Field           | Type   | Description          |
| --------------- | ------ | -------------------- |
| `script_config` | object | Script configuration |

**script_config:**

| Field      | Type   | Description                                                                                                                                                                                 |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `language` | string | Mission Designer writes `"javascript"`; Mission Engine runs every script as JavaScript                                                                                                      |
| `source`   | string | Script source code. Inputs are local variables named by `input_parameter_specifications[].id` (strings); results go in an `output` object, stored through `output_parameter_specifications` |
| `repeat`   | object | Optional. Present = repeat until the script returns `true` (see below)                                                                                                                      |

**script_config.repeat:**

| Field                | Type    | Description                                                                                                                        |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `cycle_seconds`      | number  | Seconds between runs, 1 – 31,449,600 (Mission Designer always writes it; default 5)                                                |
| `time_limit_seconds` | integer | Optional whole seconds, 1 – 31,449,600; absent = no time limit                                                                     |
| `on_time_limit`      | string  | `"error"` (fail the step) or `"complete"` (keep the outputs set so far and complete); present exactly when `time_limit_seconds` is |

#### GATE Steps

A GATE step has exactly one incoming and one outgoing connection (validated), no output parameters, and no `resource_command_specifications` (the engine rejects resource commands on a GATE step with error code `GATE_RESOURCES_UNSUPPORTED` -- a GATE never acquires resources during its own activation, armed or not, but the engine's completion pipeline still releases any resource commands a step declares, which would release a pool slot no acquire ever granted).

| Field         | Type   | Description                               |
| ------------- | ------ | ----------------------------------------- |
| `gate_config` | object | Gate configuration -- all fields optional |

**gate_config:**

| Field                      | Type    | Default           | Description                                                                                                                                                                                                                                                          |
| -------------------------- | ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cycle_seconds`            | number  | `5`               | Re-evaluation interval in seconds; 1 – 31,449,600 when present                                                                                                                                                                                                       |
| `language`                 | string  | --                | Script language (mirrors `script_config.language`)                                                                                                                                                                                                                   |
| `source`                   | string  | pass-through TRUE | Script source; must `return` a value, coerced by JS truthiness. No source means the gate opens immediately. Inputs are supplied the same way as SCRIPT steps (positional locals by `input_parameter_specifications[].id`, all strings); there is no `output` object. |
| `control_previous_action`  | boolean | `false`           | Opt into armed behavior (see below). Absent/false = the gate waits for the previous step to complete like any other step. Never emitted as `false` -- absence and `false` are the same "off" state on the wire.                                                      |
| `mode`                     | string  | `"condition"`     | `"condition"`, `"timer"` or `"condition_or_timer"`. `timer` opens after `delay_seconds` and evaluates no script; `condition_or_timer` opens on whichever comes first. Written only for the two timed modes.                                                          |
| `delay_seconds`            | integer | --                | Whole seconds, 1 – 31,449,600. Present exactly when `mode` is a timed mode.                                                                                                                                                                                          |
| `action_property_bindings` | array   | `[]`              | Bindings of gate script inputs to live Environment Action Properties (see below). Never written for a `timer` gate.                                                                                                                                                  |

**Action Property Binding:**

| Field              | Type   | Required | Description                                                                                                                                                                                           |
| ------------------ | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parameter_id`     | string | Yes      | Matches an `input_parameter_specifications[].id` on the same GATE step                                                                                                                                |
| `environment_oid`  | string | No       | OID of the environment declaring the Action Property                                                                                                                                                  |
| `environment_name` | string | No       | Local name of the environment, used as a fallback if `environment_oid` fails to resolve (the engine tries `environment_oid` first, then `environment_name`, so the dual binding survives a stale oid) |
| `property`         | string | Yes      | Dotted `Property.Entry` name on the action server; the outer name alone means the whole group                                                                                                         |

A binding causes that input to be re-read live from the bound environment's action server on every evaluation cycle, instead of from the workflow's own property store. Any other step type carries the same binding objects in its own top-level `action_property_bindings`; those are read once, when the step starts. Mission Designer derives every binding at export from inputs with `value_type: "property"` whose property is an environment Action Property (a Value Property of the same name in scope wins, and no binding is written). When `control_previous_action` is `true` and the GATE step is the sole successor of an ACTION PROXY step, the two run concurrently: a TRUE result while the action is still running sends the action a STOP command (if supported) and opens the gate; if the action completes first, execution holds at the gate until it independently returns TRUE. When `control_previous_action` is absent or `false` (the default), the gate is an ordinary successor -- it is materialized only once the preceding step completes, the same as a gate anywhere else in the workflow.

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

| Field        | Type    | Required | Description                                                                       |
| ------------ | ------- | -------- | --------------------------------------------------------------------------------- |
| `id`         | string  | Yes      | Unique ID (also the outgoing connection's `connection_id` and `source_handle_id`) |
| `label`      | string  | Yes      | Display label                                                                     |
| `operator`   | string  | Yes      | `"=="`, `"!="`, `"<"`, `">"`, `"<="`, `">="`, `"Contains"`, `"Not Contains"`      |
| `value`      | string  | Yes      | Comparison value                                                                  |
| `value_type` | string  | Yes      | `"literal"` or `"property"`                                                       |
| `is_default` | boolean | Yes      | Whether this is the default branch                                                |

#### ACTION PROXY Steps

| Field                 | Type   | Description                                                         |
| --------------------- | ------ | ------------------------------------------------------------------- |
| `action_proxy_config` | object | Runtime identity of the invoked action — required by Mission Engine |

**action_proxy_config:**

| Field              | Type   | Required | Description                                                         |
| ------------------ | ------ | -------- | ------------------------------------------------------------------- |
| `action_oid`       | string | Yes      | OID of the action in the environment's `included_actions[]`         |
| `environment_oid`  | string | Yes      | OID of one of the workflow's `environment_specifications[]`         |
| `action_name`      | string | No       | (5.0+) The action's name, equal to the roster entry's `action_name` |
| `environment_name` | string | No       | (5.0+) The environment's name, equal to its `local_id`              |
| `timeout_ms`       | number | No       | Authored time limit in milliseconds; absent = no time limit         |

Mission Designer derives the OIDs and names on every export by name from the environment roster it embeds, falling back to the stored config only when nothing resolves. Mission Engine accepts a config whose OIDs do not match the package when it carries the corresponding names, and resolves the action by name.

#### TRY / CATCH / RETURN

`try_specifications` (on `ACTION PROXY`, `SCRIPT`, `GATE`, `USER_INTERACTION`, `YES_NO` and `WORKFLOW PROXY` steps, and at workflow level) is an array of `{ mode, catch_id, release_on_catch? }`: `mode` is `"ERROR"`, `"ABORT"` or `"TIMEOUT"` (at most one row per mode) and `catch_id` names a CATCH step. A `CATCH` step carries a unique `catch_id` and has no incoming and one outgoing connection; a `RETURN` step has one incoming and no outgoing connection and carries `return_config`:

| Field           | Type   | Required | Description                                                                                                   |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| `command`       | string | Yes      | `"ABANDON"`, `"RESTART"`, `"GOTO"`, `"RETRY"` or `"COMPLETE"` (written as `ABANDON` when left at the default) |
| `restart_mode`  | string | RESTART  | `"CLEAN"` or `"KEEP"`                                                                                         |
| `goto_step_oid` | string | GOTO     | Step to continue at; must be outside every catch network                                                      |

A CATCH step always exports its four canonical outputs describing what was caught.

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

These pre-v4.0 shapes are no longer in the schema files; Mission Designer neither writes nor reads them (pre-v4.0 files are rejected on import):

**text_input_config:** `{ required?, validation_type?, default_value? }`
**pick_one_config:** `{ options?: [{ id, label, value }], default_option_id? }`
**checkbox_config:** `{ options?: [{ id, label, value, default_checked? }], output_format?, min_selections?, max_selections? }`

---

## 8. Connections

Connections define the edges between workflow steps.

| Field              | Type   | Required | Description                           |
| ------------------ | ------ | -------- | ------------------------------------- |
| `from_step_id`     | string | Yes      | Source step `oid`                     |
| `to_step_id`       | string | Yes      | Target step `oid`                     |
| `connection_id`    | string | No       | Unique identifier for this connection |
| `source_handle_id` | string | No       | Source handle ID (for branching)      |
| `condition`        | string | No       | Condition expression (for SELECT 1)   |
| `waypoints`        | array  | No       | Edge routing waypoints                |

### Branching Conventions

**YES_NO branches:**

- Yes path: `{ "source_handle_id": "yes" }`
- No path: `{ "source_handle_id": "no" }`
- The paths usually rejoin at a `WAIT ANY` step (not enforced)

**SELECT 1 branches:**

- Each option's connection carries the option's `id` as `connection_id` (which the engine routes on) and as `source_handle_id`
- The `condition` field contains the display text

**PARALLEL branches:**

- Fork from `PARALLEL` step to multiple branches
- The branches must reach a `WAIT ALL` step (Mission Engine rejects a `PARALLEL` that does not, with `UNMATCHED_PARALLEL`)

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

| Field           | Type   | Required | Description                                                                                                                                                       |
| --------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | string | Yes      | Parameter name identifier                                                                                                                                         |
| `oid`           | string | No       | Snowflake OID                                                                                                                                                     |
| `description`   | string | No       | Human-readable description                                                                                                                                        |
| `default_value` | string | Yes      | Default value                                                                                                                                                     |
| `value_type`    | string | No       | `"literal"` (default) or `"property"`; written only for `"property"`, where `default_value` is a property reference (`Name` or `Name.Entry`) resolved at run time |
| `json_schema`   | string | No       | JSON Schema string for validation                                                                                                                                 |
| `entries`       | array  | No       | Structured `{ name, value }` entries                                                                                                                              |

For a workflow's `starting_parameter_specifications`, a value supplied when the runtime workflow is created wins; otherwise the default (resolved when `value_type` is `"property"`) is used.

### Output Parameter Specification

| Field         | Type   | Required | Description                                                                                                                                       |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string | Yes      | Output parameter name identifier                                                                                                                  |
| `oid`         | string | No       | Snowflake OID                                                                                                                                     |
| `description` | string | No       | Human-readable description                                                                                                                        |
| `target`      | string | No       | Property key (`Name` or `Name.Entry`) where the output is stored; Mission Designer always writes it, using the output's own name when none is set |
| `entries`     | array  | No       | Structured `{ name, value }` entries                                                                                                              |

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

| Field                  | Type    | Required | Description                                                                           |
| ---------------------- | ------- | -------- | ------------------------------------------------------------------------------------- |
| `oid`                  | string  | No       | Snowflake OID                                                                         |
| `command_type`         | string  | Yes      | Command type (see below)                                                              |
| `resource_name`        | string  | Yes      | Target resource name                                                                  |
| `resource_source_type` | string  | No       | `"workflow"` or `"environment"` — where the resource is declared                      |
| `resource_source_oid`  | string  | No       | OID of the declaring workflow or environment (resolved by Mission Designer at export) |
| `amount`               | integer | No       | Amount for pool commands (required > 0 for the pool commands)                         |
| `target`               | string  | No       | Value property to store acquired handle                                               |
| `source`               | string  | No       | Value property reference for sync send data                                           |

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

Legacy (≤ 4.0) Text and Header form elements use a wrapper format; a Form Document v2 block's `content` is a plain HTML string with no wrapper:

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

> **Legacy (package format ≤ 4.0).** Sections 10 and 11 describe the v1 `form_layout_config` layout. Mission Designer no longer writes it: forms are exported as `form_document` (see [§15](#15-form-document-v2)). A `form_layout_config` in an imported package is converted to a `form_document`.

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

This maps each image element's stable `imageOid` to its filename in the `images/` folder of the ZIP. In 5.0 packages it is built from the `form_document` image blocks.

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

Mission Designer exports every single workflow as the runtime package described in 12.2 (with `manifest.json` and the environment and action libraries it uses). The download is named `{WorkflowName}({version}).WFmasterX`; the `.WFmaster` entry inside is the workflow name with characters outside `A–Z a–z 0–9 . _ -` replaced by `_`.

**Import Detection:**

- Look for a `.WFmaster` file (the first one found is the workflow; `schemaVersion` must be `"4.0"` – `"5.0"`)
- Recreate or reuse the environment and action libraries from `environments/` and `actions/`
- Extract images from `images/` folder; an image a form references but the ZIP lacks is left empty
- Any other entry fails the import (`zip_filename_invalid`)

---

### 12.2 Runtime Package (`.WFmasterX`)

An extended workflow package that includes all dependent libraries for self-contained runtime deployment.

**ZIP Structure:**

```
manifest.json                            # Package metadata
{WorkflowName}.WFmaster                  # Main workflow JSON
environments/{EnvLibName}.WFenvir        # Environment library JSON files
actions/{ActionLibName}.WFaction         # Action library JSON files
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
- `manifest.json` is advisory; importers do not read it
- On import, a workflow is linked to an environment library when `environments/{EnvLibName}.WFenvir` matches the embedded environment's `library_name`; a library of that name already in the importing team (or in GLOBAL) is reused as it is. An unmatched link is dropped with an import warning

---

### 12.3 Library Package (`.WFlibX`)

Exports an entire library tree with all dependencies.

**ZIP Structure:**

```
manifest.json                            # Package metadata (required on import)
{LibraryName}.WFlib                      # Workflow library JSON (root)
steps/{StepLibName}.WFslib               # Step library JSON files
environments/{EnvLibName}.WFenvir        # Environment library JSON files
actions/{ActionLibName}.WFaction         # Action library JSON files
images/{filename}                        # UI parameter images
images/{imageOid}-{filename}             # Form element images
```

The root `.WFlib` holds every root workflow of the library and of its child libraries in `workflow_specifications[]` (each with its own `library_name` / `library_oid`); its `child_libraries[]` lists the direct child libraries' managed-element fields only. Library JSONs in this package include `value_type_specifications`.

**manifest.json:**

```json
{
  "packageType": "workflow-library",
  "packageVersion": "1.1",
  "libraryName": "My Workflow Library",
  "createdAt": "2026-03-01T12:00:00.000Z",
  "files": [
    { "path": "My Workflow Library.WFlib", "type": "workflow-library" },
    { "path": "steps/Common Steps.WFslib", "type": "step-library" },
    { "path": "environments/Kitchen Environment Library.WFenvir", "type": "environment-library" },
    { "path": "actions/My Action Library.WFaction", "type": "action-library" },
    { "path": "images/photo.jpg", "type": "image" }
  ],
  "oidIndex": {
    "libraries": [{ "oid": "…", "name": "My Workflow Library", "entityType": "workflow", "version": "1.0.0" }],
    "specifications": [{ "oid": "…", "libraryOid": "…", "name": "Bake Cookies", "version": "1.0.0" }]
  }
}
```

The import refuses a package without `manifest.json` (`missing_manifest`), with another `packageType` (`wrong_package_type`), or without `packageVersion` `"1.1"` and an `oidIndex` (`unsupported_package_version`). `oidIndex.libraries[].entityType` is `workflow`, `step`, `environment` or `action`.

**Dependencies collected:**

- Step libraries: from `workflowProxy` nodes in reference mode
- Environment libraries: from workflow environment specifications
- Action libraries: from actions included in environments
- Images: recursively from all workflow specs in the library tree

---

### 12.4 Plain JSON Files

Inside the packages, each library is a plain JSON file:

| Type                | Extension   | Root Array                   |
| ------------------- | ----------- | ---------------------------- |
| Workflow Library    | `.WFlib`    | `workflow_specifications`    |
| Step Library        | `.WFslib`   | `workflow_specifications`    |
| Environment Library | `.WFenvir`  | `environment_specifications` |
| Action Library      | `.WFaction` | `action_specifications`      |

A bare `.WFmaster` (the canvas export) is one workflow specification, with no root array.

### 12.5 Step, Environment and Action Library Packages

`.WFstepLibX`, `.WFenvirLibX` and `.WFactionLibX` share one layout:

```
manifest.json                            # { packageType, packageVersion: "1.0", libraryName,
                                         #   environmentLibraries?, actionLibraries?, createdAt, files[] }
{LibraryName}.WFslib | .WFenvir | .WFaction   # The library JSON
environments/{EnvLibName}.WFenvir        # Step libraries only: environment libraries the workflows use
actions/{ActionLibName}.WFaction         # Step and environment libraries: action libraries the environments use
images/{filename}                        # Step libraries only
images/{imageOid}-{filename}             # Step libraries only
```

`packageType` is `step-library`, `environment-library` or `action-library`. Step and environment library JSONs include `value_type_specifications`. The importer picks the parser by the inner file's extension and still accepts the former outer names `.WFslibX` and `.WFactionX` (and, without an `environment-package` manifest, `.WFenvirX`).

### 12.6 Environment Package (`.WFenvirX`)

A single environment and the actions it includes. Mission Commander loads it into a work center; Mission Designer imports it as one environment.

```
{EnvName}.WFenvir                        # The environment specification itself (no library wrapper), included_actions inline
actions/{ActionLibName}/{ActionName}.WFaction   # Each included action (standalone action JSON), grouped by action library
manifest.json                            # { packageType: "environment-package", formatVersion: 2, createdAt,
                                         #   environmentName, actionCount, actionLibraries: [{ name, actions: [...] }] }
```

Value Type templates are never written into this package.

---

## 13. Image Handling

### Two Image Categories

| Category            | ZIP Path                       | Source                                                                              | Naming        |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------- | ------------- |
| UI parameter images | `images/{filename}`            | `ui_parameter_specifications` with `type: "Image"`                                  | Bare filename |
| Form element images | `images/{imageOid}-{filename}` | `form_document` blocks with `type: "image"` (legacy: `form_layout_config` elements) | OID-prefixed  |

Image blocks whose `src` is an `http(s)://` URL, a `data:` URI or the `"No image selected"` placeholder are not packaged.

### OID Prefixing

Form element images are prefixed to prevent collision when multiple steps use images with the same filename:

- **Primary:** `{imageOid}-{filename}` (if element has `imageOid`)
- **Fallback:** `{stepOid}-{filename}` (legacy elements without `imageOid`)

On import, the prefix is stripped:

1. Check for `{imageOid}-` prefix (numeric characters followed by dash)
2. Fall back to `{stepOid}-` prefix
3. Store image under both prefixed and bare filename keys

A `.WFmasterX` imported through the server matches a referenced filename against the bare entry, the `{specOid}-` prefixed entry, or any entry ending in `-{filename}`.

### MIME Type Inference

Library package imports infer the MIME type from the extension (table below). A `.WFmasterX` imported through the server instead sniffs each `images/` entry's magic bytes and accepts only PNG, JPEG, WebP and GIF.

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

| Version     | Description                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **5.0**     | Current. Forms are exported as a Form Document v2 (`form_document`, [§15](#15-form-document-v2)); `form_layout_config` is import-only. `action_proxy_config` may carry `action_name` and `environment_name`. |
| **4.0**     | USER_INTERACTION step with WYSIWYG form layouts, resource commands (Send/Receive/Synchronize), script steps, parameter binding, rich text, timer elements. Legacy UI step types removed.                     |
| **3.0**     | Added FORM_ENTRY step type (migrated to USER_INTERACTION in v4.0). WYSIWYG form designer introduced.                                                                                                         |
| **Pre-3.0** | Legacy formats without `schemaVersion` field. Block-based UI steps (Instruction, TextInput, PickOne, Checkbox).                                                                                              |

### Import Compatibility

- Files with `schemaVersion` `"4.0"` or `"5.0"` are accepted
- Files with `schemaVersion < 4.0` or no `schemaVersion` are rejected as legacy format; a `.WFmasterX` with a `schemaVersion` above `"5.0"` is also rejected (`unsupported_schema_version`)
- AJV (JSON Schema Draft-07) validation is applied against schema files in `src/lib/schemas/`; every imported `form_document` is validated against `form-document.json` and an invalid one fails the import

### Validation

Import validation uses AJV with the following schema files:

| Schema File                         | Validates                                           |
| ----------------------------------- | --------------------------------------------------- |
| `managed-element.json`              | Base element structure                              |
| `master-action-library.json`        | Action library JSON                                 |
| `master-environment-library.json`   | Environment library JSON                            |
| `master-workflow-library.json`      | Workflow library JSON                               |
| `master-workflow-step-library.json` | Step library JSON                                   |
| `form-document.json`                | Form Document v2 (copy of Mission FormKit's schema) |

All schemas are located in `src/lib/schemas/` and use JSON Schema Draft-07 with the base URI `https://trajectorypro.io/schemas/`.

---

## 15. Form Document v2

From package format 5.0, a `USER_INTERACTION` or `YES_NO` step carries its form as `form_document`. The schema is owned by Mission FormKit (`packages/form-schema/src/schema/form-document.json` in the MissionFormKit repository); `src/lib/schemas/form-document.json` is an identical copy. The document is exported verbatim, ids included, and the schema forbids unknown properties at every level. All ids (sections, rows, blocks) must be unique within the document.

### Structure

| Object   | Fields                                                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document | `version` (required, always `2`), `sections` (required array)                                                                                                                                                                      |
| Section  | `id`, `role` (`"content"` or `"footer"`), `rows` — all required. A `footer` section is the form's bottom bar, drawn below the content; Mission Designer lets only buttons be dropped there and drops empty footer sections on save |
| Row      | `id`, `blocks` (at least one) required; `gap` optional (space token)                                                                                                                                                               |
| Block    | `id`, `type` required; optional `layout`; type-specific fields below                                                                                                                                                               |

Tokens: space `none`, `xs`, `sm`, `md`, `lg`, `xl`; type size `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`.

**Block `layout`** (all optional, except `aspectRatio` on images):

| Field         | Type                                         | Description                                                                                                               |
| ------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `span`        | `{ base, tablet?, phone? }`, integers 1 – 12 | Grid columns of 12 (default 12). `base` is desktop; resolution is `phone ?? tablet ?? base`                               |
| `order`       | `{ base, tablet?, phone? }`, integers 1 – 12 | Reflow order within the row                                                                                               |
| `visible`     | `{ base, tablet?, phone? }`, booleans        | Hide the block at a breakpoint (default `true`)                                                                           |
| `minHeight`   | space token or `{ rem }`                     | Minimum height                                                                                                            |
| `maxWidth`    | `{ ch }` or `{ rem }`                        | Width cap                                                                                                                 |
| `aspectRatio` | string `"W/H"`                               | Required on image blocks                                                                                                  |
| `align`       | `"start"`, `"center"`, `"end"`               | Alignment in the grid cell; on a button it also sets the horizontal position (start = left, center = middle, end = right) |

**Per-device text size:** `size` is the desktop type token and `sizeAt: { tablet?, phone? }` overrides it per device (resolution `phone ?? tablet ?? size`). Allowed on `text`, `header`, `textInput`, `textarea`, `checkbox`, `radio`, `timer` and `button`.

### Block Types

| `type`              | Required fields                                                                    | Optional fields                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`, `header`    | `content` (HTML string)                                                            | `size`, `sizeAt`, `fontWeight` (`normal`/`bold`), `color`, `align` (`left`/`center`/`right`)                                                                                                                     |
| `textInput`         | `fieldName`                                                                        | `label`, `placeholder`, `required`, `inputMode` (`text`/`number`/`phone`/`password`/`dropdown`/`combobox`), `listItems`, `listSource`, `outputParameter`, `defaultSource`, `placeholderSource`, `size`, `sizeAt` |
| `textarea`          | `fieldName`                                                                        | `label`, `placeholder`, `required`, `rows`, `outputParameter`, `defaultSource`, `placeholderSource`, `size`, `sizeAt`                                                                                            |
| `checkbox`, `radio` | `fieldName`, `options` (`[{ label, value }]`)                                      | `label`, `required`, `listSource`, `outputParameter`, `size`, `sizeAt`                                                                                                                                           |
| `image`             | `src`, `layout.aspectRatio`                                                        | `imageOid`, `objectFit` (`contain`/`cover`/`fill`), `scalePercent` (10 – 300)                                                                                                                                    |
| `video`             | `src`                                                                              | `posterUrl`                                                                                                                                                                                                      |
| `divider`           | —                                                                                  | `weight` (`hairline`/`thick`), `color`                                                                                                                                                                           |
| `timer`             | `label`, `fieldName`, `durationSeconds` (≥ 1), `direction` (`countdown`/`countup`) | `blockDone`, `outputParameter`, `defaultSource`, `size`, `sizeAt`                                                                                                                                                |
| `button`            | `label`, `outputValue`                                                             | `job` (`continue`/`yes`/`no`), `emphasis` (`primary`/`secondary`), `color`, `deletable`, `size`, `sizeAt`                                                                                                        |
| `esignature`        | `fieldName`                                                                        | `label`, `meaning`, `roleName`, `requireDifferentUser`, `outputParameter`                                                                                                                                        |

`defaultSource` and `placeholderSource` use the same `{ mode, value }` shape as v1 (`static`, `property`, `input`). `listSource` is `{ "mode": "static" }` or `{ "mode": "input", "value": "..." }`.

**Buttons.** A button with a `job` does the step's own work: `continue` completes a USER_INTERACTION step, `yes` and `no` answer a YES_NO step. Mission Designer writes `outputValue` `"continue"`, `"true"` or `"false"` for the three jobs, and an empty `label` means the default word (`Continue`, `Yes`, `No`) or the host's label. A host shows only the form's buttons when every device shows the jobs the step needs and no button has a job the step cannot use; otherwise it keeps its own buttons. A button without a `job` is an ordinary action button that emits its `outputValue`.

**Capture.** An input block's value is stored under its `outputParameter`: when that equals an `output_parameter_specifications[].id` of the step, the value goes to that output's `target`. A step cannot complete while a `required` input is empty, a `number` text input holds text that is not a number, a `blockDone` timer is running, or an e-signature is incomplete. Mission Engine warns (`UNBOUND_FORM_INPUT`) about any `textInput`, `textarea`, `checkbox`, `radio` or `esignature` block without an `outputParameter`.

### Example

```json
{
  "version": 2,
  "sections": [
    {
      "id": "7000000200001",
      "role": "content",
      "rows": [
        {
          "id": "7000000200002",
          "blocks": [
            {
              "id": "7000000200003",
              "type": "header",
              "content": "<p>Voltage Check</p>",
              "size": "2xl",
              "sizeAt": { "phone": "xl" }
            },
            {
              "id": "7000000200004",
              "type": "textInput",
              "fieldName": "voltage",
              "label": "Voltage",
              "inputMode": "number",
              "required": true,
              "outputParameter": "Voltage"
            }
          ]
        }
      ]
    },
    {
      "id": "7000000200005",
      "role": "footer",
      "rows": [
        {
          "id": "7000000200006",
          "blocks": [
            {
              "id": "7000000200007",
              "type": "button",
              "job": "continue",
              "label": "",
              "outputValue": "continue",
              "layout": { "align": "end" }
            }
          ]
        }
      ]
    }
  ]
}
```
