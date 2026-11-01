# Mission Designer JSON Schema Specification

**Schema Version:** 5.0
**JSON Schema Draft:** Draft-07
**Base URI:** `https://trajectorypro.io/schemas/`

This document describes the JSON schemas used by Mission Designer for import and export of workflow specifications, libraries, and related data. All schemas use JSON Schema Draft-07 and share a common base element (`managed-element.json`). The schema files themselves are in `src/lib/schemas/` and are authoritative; the field tables below summarise them. ZIP package layouts are specified in [`SCHEMA-SPECIFICATION.md`](./SCHEMA-SPECIFICATION.md) §12 and [`docs/package-format.md`](./docs/package-format.md).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Managed Element (Base Schema)](#2-managed-element-base-schema)
3. [Master Action Library](#3-master-action-library)
4. [Master Environment Library](#4-master-environment-library)
5. [Master Workflow Library](#5-master-workflow-library)
6. [Master Workflow Step Library](#6-master-workflow-step-library)
7. [Shared Definitions](#7-shared-definitions)
8. [Export Packaging](#8-export-packaging)
9. [Schema Version History](#9-schema-version-history)

---

## 1. Introduction

A workflow defines any activity that is a sequence and/or set of actions that must be performed to accomplish a goal. Examples of consumer workflow types include exercise routines, party planning, recipes, trip planning, and instruction manuals. Examples of business workflow types include expense report filing, weekly activity checklists, and service call resolution checklists. Examples of manufacturing workflows include recipe execution, equipment startup procedures, equipment shutdown procedures, and emergency response procedures. Workflows can be triggered by external event, time, location, messages, or any other defined event.

Workflows are generated within a department or group in a company, across the entire company, or even across companies in a supply chain. Workflow requirements often change and require distributed workflows to be revised or replaced. This work describes a set of applications and interface specifications that allow for exchange of workflow specifications and communication of triggers and information between independent workflow execution environments.

This specification defines the data models of distributed workflows for exchanges using JSON messages. It defines the data models to be implemented as a set of JSON schemas.

JSON schemas allow for the exchange of:

1. A Master Workflow Library with its OID, and all Master Workflow Specifications with their OIDs, and all contained steps.
2. A Master Workflow Step Library with its OID, and all its reusable Master Workflow Specifications with their OIDs, and all contained steps.
3. A Master Environment Library with all Master Environment Specifications with their OIDs, and the OIDs of all Master Action Specifications.
4. A Master Action Library with its OID, and all Master Action Specifications with their OIDs.

This specification is for exchanges between Master Workflow Systems and Runtime Execution Systems.

### Workflow Data Model

#### Data Objects

- **Master Action Library** -- A collection of Master Action Specifications. A specialized type of Managed Workflow Element. Contains a local identification and OID, an optional description, a version number, and the last modified date.

- **Master Action Specification** -- A template and description for the information to be exchanged when performing a Runtime Action Realization. The specification does not define the logic in the action; it contains input parameter specifications, output parameter specifications, and property specifications.

- **Master Environment Library** -- A collection of Master Environment Specifications. A specialized type of Managed Workflow Element.

- **Master Environment Specification** -- A collection of IDs of Master Action Specifications that may be referenced by a Master Workflow Specification. Contains value property specifications and resource property specifications. Steps that reference actions may only use Master Action Specifications identified in the Master Environment Specification.

- **Master Workflow Library** -- A collection of Master Workflow Specifications. A specialized type of Managed Workflow Element.

- **Master Workflow Step Library** -- A collection of reusable Master Workflow Specifications that a workflow can run as child workflows.

- **Master Workflow Specification** -- A collection of Master Workflow Steps and Workflow Step Connections, with optional sets of Resource Command Specifications, Value Property Specifications, starting parameter specifications, and output parameter specifications.

- **Master Workflow Step** -- Contains optional sets of Resource Command Specifications, Value Property Specifications, input parameter specifications with default values, and output parameter specifications. References zero or more Workflow Step Connections.

@@END

#### Properties

- **Value Property Specifications** -- The definition of named values in master elements that can be identified as input parameters to a step or places to store output parameters from execution. They contain a name, an optional default value, and an optional description. Value property specifications are name/default-value pairs.

- **Value Property Realizations** -- Where the actual values are maintained in runtime elements. Used to hold information passed to actions and nested workflows, and to store information returned from them.

#### Resources

Resources may represent physical equipment, logical equipment, or abstract limited-availability objects or information. The system supports single-use resources, multiple-use resources with limits, and named resource pools.

- **Binary exclusive use** -- Only one runtime element at a time may use the resource (e.g., a single mixer used by multiple kitchen lines).

- **Binary shared use with pool limits** -- Multiple runtime elements may use the resource simultaneously until the count reaches zero. Each acquire decreases and each release increases the available count by one (e.g., a set of knives used by multiple cooks).

- **Countable use with pool limits** -- Multiple runtime elements may use the resource simultaneously until the count reaches zero. Each acquire/release changes the count by the specified amount (e.g., a pool of mixing bowls, each with an ID).

- **Named pool** -- A pool of named resource instances that can be individually identified.

- **Sync** -- Synchronization point for coordinating between concurrent execution paths.

#### Resource Commands

- **Acquire** -- Acquire a resource; the step waits until the resource is available.
- **Release** -- Release a previously acquired resource.
- **Acquire Pool Amount** -- Acquire a specified amount from a resource pool.
- **Release Pool Amount** -- Return a specified amount to a resource pool.
- **Send** -- Send data via a sync resource.
- **Receive** -- Receive data via a sync resource.
- **Synchronize** -- Synchronize at a sync point.

#### Parameters

- Input parameters are not typed -- passed as strings. Examples: `abbbbc`, `0110110`, `[1,2,3,4]`.
- Input parameter specifications may optionally include a JSON schema for validation of inputs and representation of complex types, arrays, and structures.
- Output parameters are not typed -- returned as strings.

---

## 2. Managed Element (Base Schema)

**Schema ID:** `managed-element.json`

All top-level objects and specifications inherit from this base element.

| Field                | Type               | Required | Description                                                                                                                        |
| -------------------- | ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `local_id`           | string             | Yes      | Human-readable name/identifier                                                                                                     |
| `oid`                | string             | Yes      | Snowflake OID (globally unique)                                                                                                    |
| `version`            | string             | Yes      | Version string                                                                                                                     |
| `last_modified_date` | string (date-time) | Yes      | ISO 8601 timestamp                                                                                                                 |
| `description`        | string             | No       | Human-readable description                                                                                                         |
| `schemaVersion`      | string             | No       | Trajectory schema version: `"3.0"`, `"4.0"` or `"5.0"`. Mission Designer writes `"5.0"` on every workflow specification it exports |

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
| `child_libraries`       | array  | No       | Nested child action libraries (recursive `$ref: "#"`)      |
| `parent_library_oid`    | string | No       | OID of the parent library (provenance only; not read back) |

### Action Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                             | Type   | Required | Description                                                                               |
| --------------------------------- | ------ | -------- | ----------------------------------------------------------------------------------------- |
| `input_parameter_specifications`  | array  | No       | Input parameters (see [Parameter Specification](#parameter-specification))                |
| `output_parameter_specifications` | array  | No       | Output parameters (see [Output Parameter Specification](#output-parameter-specification)) |
| `property_specifications`         | array  | No       | Named value properties (see [Property Specification](#property-specification))            |
| `action_visibility`               | string | No       | `"opaque"` or `"observable"`; Mission Designer always writes it (default `"opaque"`)      |
| `state`                           | string | No       | Lifecycle state (`Draft` … `Obsolete`); accepted, not written by Mission Designer         |

### JSON Schema

The JSON Schema for the action library is [`src/lib/schemas/master-action-library.json`](./src/lib/schemas/master-action-library.json); the field tables above summarise it.

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
      "input_parameter_specifications": [
        {
          "id": "Temperature",
          "default_value": "350",
          "value_type": "literal"
        }
      ],
      "output_parameter_specifications": [
        {
          "id": "ActualTemp",
          "target": "CurrentTemperature"
        }
      ]
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
| `child_libraries`            | array  | No       | Nested child environment libraries (recursive `$ref: "#"`) |
| `parent_library_oid`         | string | No       | OID of the parent library (provenance only; not read back) |

### Environment Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                              | Type   | Required | Description                                                                                                                                                                                                                          |
| ---------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `library_name`                     | string | No       | Name of the environment library (a workflow package import links environments by this name)                                                                                                                                          |
| `library_oid`                      | string | No       | OID of the environment library (provenance)                                                                                                                                                                                          |
| `state`                            | string | No       | Lifecycle state (`Draft` … `Obsolete`)                                                                                                                                                                                               |
| `included_actions`                 | array  | Yes      | Actions included in this environment                                                                                                                                                                                                 |
| `value_property_specifications`    | array  | No       | Named value properties                                                                                                                                                                                                               |
| `action_property_specifications`   | array  | No       | Action Properties: values held on the action server that bound step inputs read live                                                                                                                                                 |
| `value_type_specifications`        | array  | No       | Value Type templates (`{ name, oid?, description?, entries: [{ name, value? }] }`); written into Mission Designer library packages and the `environments/` files of a `.WFmasterX`, never into `.WFenvirX`; the runtime ignores them |
| `resource_property_specifications` | array  | No       | Resource definitions (see [Resource Property Specification](#resource-property-specification))                                                                                                                                       |
| `action_server_specifications`     | array  | No       | `{ name, uri, description?, connection_type: "REST", api_key? }`; a blank `uri` means the server is bound per work center in Mission Commander                                                                                       |

### Included Action

An `IncludedAction` carries `action_name` + `action_library` as the cross-package join keys, plus the **full inlined `MasterActionSpecification` body** (same field names as a `.WFaction` action_specifications entry). Inlining makes the environment self-contained for downstream consumers — workflow runtime and Action Server — that don't have access to the originating action library.

| Field                             | Type               | Required | Description                                                                   |
| --------------------------------- | ------------------ | -------- | ----------------------------------------------------------------------------- |
| `action_library`                  | string             | Yes      | The `local_id` of the action's parent library. Cross-package join key.        |
| `action_name`                     | string             | Yes      | The action's name. Mirrors `local_id` when the body is inlined.               |
| `local_id`                        | string             | No       | The action's `local_id` (same as `action_name` when present).                 |
| `oid`                             | string             | No       | OID of the action specification.                                              |
| `description`                     | string             | No       | Description of the action specification.                                      |
| `version`                         | string             | No       | Version of the action specification.                                          |
| `last_modified_date`              | string (date-time) | No       | Last modified date of the action specification.                               |
| `action_visibility`               | string             | No       | `"opaque"` or `"observable"`.                                                 |
| `input_parameter_specifications`  | array              | No       | Inlined input parameters (see [Action Specification](#action-specification)). |
| `output_parameter_specifications` | array              | No       | Inlined output parameters.                                                    |
| `property_specifications`         | array              | No       | Inlined property specifications.                                              |

When the action could be resolved at export time, all inlined fields are populated together. When not (legacy entries, missing library context), only `action_name` + `action_library` are emitted — consumers can detect the unresolved case by absence of `oid`. Mission Engine reads a roster entry's OID as `action_oid ?? oid`; Mission Designer writes `oid`.

### JSON Schema

The JSON Schema for the environment library is [`src/lib/schemas/master-environment-library.json`](./src/lib/schemas/master-environment-library.json); the field tables above summarise it.

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
        {
          "name": "Oven",
          "resource_type": "binary exclusive use"
        },
        {
          "name": "Mixing Bowls",
          "resource_type": "countable use with pool limits",
          "use_limit": 10
        }
      ]
    }
  ]
}
```

---

## 5. Master Workflow Library

**Schema ID:** `master-workflow-library.json`

A collection of workflow specifications. This is the primary export format.

### Top Level

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                     | Type  | Required | Description                                             |
| ------------------------- | ----- | -------- | ------------------------------------------------------- |
| `workflow_specifications` | array | Yes      | List of workflow specifications                         |
| `child_libraries`         | array | No       | Nested child workflow libraries (recursive `$ref: "#"`) |

### Workflow Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                               | Type   | Required | Description                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                     | string | No       | `"5.0"` (written by Mission Designer); a `.WFmasterX` import requires `"4.0"` – `"5.0"`                                                                                                                                                                                                                              |
| `type_name`                         | string | No       | Optional ISA 88 type (e.g. `Operation`), at most 50 characters. Informational only; never affects execution. Omitted when unset. Also allowed on each child workflow.                                                                                                                                                |
| `display_style`                     | string | No       | `"flowchart"`, `"bpmn"` or `"isa88"` — the authoring notation                                                                                                                                                                                                                                                        |
| `state`                             | string | No       | Lifecycle state (`Draft`, `InTest`, `InReview`, `Approved`, `Effective`, `Superseded`, `Obsolete`)                                                                                                                                                                                                                   |
| `library_name`, `library_oid`       | string | No       | Name and OID of the library the workflow lives in (provenance)                                                                                                                                                                                                                                                       |
| `steps`                             | array  | Yes      | Workflow steps (see [Workflow Step](#workflow-step))                                                                                                                                                                                                                                                                 |
| `connections`                       | array  | Yes      | Step connections (see [Connection](#connection))                                                                                                                                                                                                                                                                     |
| `resource_command_specifications`   | array  | No       | Workflow-level resource commands (allowed; not written by Mission Designer)                                                                                                                                                                                                                                          |
| `resource_property_specifications`  | array  | No       | Workflow-level resource definitions                                                                                                                                                                                                                                                                                  |
| `value_property_specifications`     | array  | No       | Workflow-level named values                                                                                                                                                                                                                                                                                          |
| `starting_parameter_specifications` | array  | No       | Workflow input parameters                                                                                                                                                                                                                                                                                            |
| `output_parameter_specifications`   | array  | No       | Workflow output parameters                                                                                                                                                                                                                                                                                           |
| `try_specifications`                | array  | No       | Workflow-level TRY fallback rows (see [TRY / CATCH / RETURN](#try--catch--return))                                                                                                                                                                                                                                   |
| `environment_specifications`        | array  | No       | Embedded environment specifications                                                                                                                                                                                                                                                                                  |
| `children`                          | array  | No       | Embedded child workflows: each has the workflow fields plus required `parentChildSpecId` (`null` = direct child of the root), `version` and `state`, and nests its own `children`. A `WORKFLOW PROXY` step runs the child whose `local_id` equals the step's. The pre-v7.0 `child_workflows` field is no longer read |
| `viewport`                          | object | No       | Canvas viewport state (`x`, `y`, `zoom`)                                                                                                                                                                                                                                                                             |

### Workflow Step

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                             | Type             | Required | Description                                                                        |
| --------------------------------- | ---------------- | -------- | ---------------------------------------------------------------------------------- |
| `step_type`                       | string           | Yes      | Step type enum (see [Step Types](#step-types))                                     |
| `position`                        | object           | No       | Canvas position (`{ x: number, y: number }`)                                       |
| `action_visibility`               | string           | No       | `"opaque"` or `"observable"` (written on every `ACTION PROXY`, default `"opaque"`) |
| `input_parameter_specifications`  | array            | No       | Step input parameters                                                              |
| `output_parameter_specifications` | array            | No       | Step output parameters                                                             |
| `output_parameter_name`           | string           | No       | Output parameter name for UI steps (allowed; not written)                          |
| `value_property_specifications`   | array            | No       | Step-level named values                                                            |
| `resource_command_specifications` | array            | No       | Step-level resource commands (not allowed on a GATE)                               |
| `ui_parameter_specifications`     | array            | No       | UI elements for user interaction steps                                             |
| `yes_no_config`                   | object           | No       | YES_NO step configuration                                                          |
| `script_config`                   | object           | No       | SCRIPT step configuration                                                          |
| `gate_config`                     | object           | No       | GATE step configuration                                                            |
| `select1_config`                  | object           | No       | SELECT 1 step configuration                                                        |
| `action_proxy_config`             | object           | No       | ACTION PROXY runtime identity (required by Mission Engine on every ACTION PROXY)   |
| `action_property_bindings`        | array            | No       | Live Action Property bindings of a non-GATE step's inputs (derived at export)      |
| `form_document`                   | object           | No       | The step's form as a Form Document v2 (see [Form Document](#form-document))        |
| `form_element_images`             | array            | No       | `[{ image_oid, filename }]` for the form's image blocks                            |
| `form_layout_config`              | array            | No       | Legacy WYSIWYG form layouts (≤ 4.0; import only)                                   |
| `try_specifications`              | array            | No       | TRY rows (see [TRY / CATCH / RETURN](#try--catch--return))                         |
| `catch_id`                        | string           | No       | CATCH steps only                                                                   |
| `return_config`                   | object           | No       | RETURN steps only                                                                  |
| `connection_references`           | array of strings | No       | References to Workflow Step Connections (allowed; not written)                     |

The legacy `text_input_config`, `pick_one_config` and `checkbox_config` objects (below) are not in the current schema files; Mission Designer neither writes nor reads them.

### Step Types

| Value              | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| `START`            | Workflow entry point                                             |
| `END`              | Workflow exit point                                              |
| `ACTION PROXY`     | Execute an environment action and wait for it to finish          |
| `WORKFLOW PROXY`   | Run a child workflow                                             |
| `SELECT 1`         | Conditional branch (evaluate one path)                           |
| `WAIT ANY`         | Wait for any incoming branch to complete                         |
| `PARALLEL`         | Fork execution into parallel branches                            |
| `WAIT ALL`         | Wait for all incoming branches to complete                       |
| `SCRIPT`           | Execute a JavaScript script, once or repeatedly                  |
| `GATE`             | Hold the flow until a script returns true and/or a timer expires |
| `YES_NO`           | Binary user decision with configurable labels                    |
| `USER_INTERACTION` | General user interaction with a form                             |
| `CATCH`            | Entry point of a catch network that handles a TRY                |
| `RETURN`           | Exit of a catch network; says how the workflow continues         |

Older packages may contain `WAIT ACTION PROXY`, `NOWAIT ACTION PROXY` or `MATH`; the importer maps all three to an `ACTION PROXY` step and the exporter never writes them.

### Connection

| Field              | Type   | Required | Description                                                                            |
| ------------------ | ------ | -------- | -------------------------------------------------------------------------------------- |
| `from_step_id`     | string | Yes      | Source step `oid`                                                                      |
| `to_step_id`       | string | Yes      | Target step `oid`                                                                      |
| `connection_id`    | string | No       | Connection identifier; on a SELECT 1 edge, the option `id` the engine routes on        |
| `source_handle_id` | string | No       | Source handle ID (`"yes"` / `"no"` on YES_NO edges; the option `id` on SELECT 1 edges) |
| `condition`        | string | No       | Condition expression (for SELECT 1 connections)                                        |
| `waypoints`        | array  | No       | Edge routing waypoints (`{ x: number, y: number }` offsets)                            |

#### Waypoint Semantics

Each `waypoints[i] = { x, y }` is an **offset (delta)** from a default midpoint that the editor's orthogonal router computes from the source/target step positions and the workflow's notation — NOT an absolute canvas point. In current data the array length is effectively 0 or 1 (only `waypoints[0]` is read). Which component is active depends on flow direction and forward vs. backward routing:

- **Vertical notation, forward** (`targetY > sourceY`): `wpY` shifts the horizontal crossover segment up/down; `wpX` is unused.
- **Vertical, backward (loop)** (`targetY < sourceY`): `wpX` shifts the vertical bypass lane that routes around the right of both nodes; `wpY` is unused.
- **Horizontal, forward** (`targetX > sourceX`): `wpX` shifts the vertical crossover segment left/right; `wpY` is unused.
- **Horizontal, backward**: `wpY` shifts the horizontal bypass lane below both nodes; `wpX` is unused.

Coordinate space matches `step.position.{x, y}` (+X right, +Y down). Values are snapped to a 5 px grid in the editor. Waypoints are presentation metadata only — pure execution engines may ignore them.

For the full routing algorithm and worked examples (so a runtime can recreate the diagram pixel-identically), see [`docs/specs/07-connection-waypoint-routing.md`](docs/specs/07-connection-waypoint-routing.md).

### UI Parameter Specification

Used by `USER_INTERACTION` and `YES_NO` steps to define screen content.

| Field       | Type    | Required | Description                                                 |
| ----------- | ------- | -------- | ----------------------------------------------------------- |
| `oid`       | string  | No       | Snowflake OID                                               |
| `type`      | string  | Yes      | UI element type (see [UI Element Types](#ui-element-types)) |
| `value`     | string  | Yes      | Content value                                               |
| `font_size` | number  | No       | Font size for text elements                                 |
| `color`     | string  | No       | Text color                                                  |
| `lines`     | integer | No       | Number of lines for text input                              |
| `align`     | string  | No       | Text alignment: `"left"`, `"center"`, `"right"`             |
| `value2`    | string  | No       | Secondary value (e.g., No label for YesNoButtons)           |

### UI Element Types

| Value                | Description                       |
| -------------------- | --------------------------------- |
| `Button`             | Action button                     |
| `Header`             | Large text heading                |
| `Text`               | Body text                         |
| `SmallText`          | Small text                        |
| `Image`              | Image element (value is filename) |
| `Video`              | Video element                     |
| `TextInput`          | Single-line text input            |
| `YesNoButtons`       | Yes/No button pair                |
| `PickList`           | Single-selection list             |
| `CheckboxList`       | Multi-selection checkboxes        |
| `FormField`          | Single-line form field            |
| `FormFieldMultiline` | Multi-line form field             |
| `FormFieldNumeric`   | Numeric input field               |
| `FormFieldPhone`     | Phone number input field          |
| `FormFieldEmail`     | Email input field                 |
| `Divider`            | Horizontal divider line           |

### Yes/No Config

| Field               | Type   | Required | Description                                                                 |
| ------------------- | ------ | -------- | --------------------------------------------------------------------------- |
| `yes_label`         | string | No       | Custom label for Yes button (default: `"Yes"`)                              |
| `no_label`          | string | No       | Custom label for No button (default: `"No"`)                                |
| `yes_value`         | string | No       | Output value when Yes is selected (Mission Designer always writes `"true"`) |
| `no_value`          | string | No       | Output value when No is selected (Mission Designer always writes `"false"`) |
| `default_selection` | string | No       | `"yes"`, `"no"`, or `"none"`                                                |

### Script Config

| Field      | Type   | Required | Description                                                                                                                                                                                                   |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `language` | string | No       | Mission Designer writes `"javascript"`; Mission Engine runs every script as JavaScript                                                                                                                        |
| `source`   | string | No       | Script source code                                                                                                                                                                                            |
| `repeat`   | object | No       | Present = run every `cycle_seconds` (1 – 31,449,600; default 5) until the script returns `true`; optional `time_limit_seconds` (whole seconds, 1 – 31,449,600) with `on_time_limit` `"error"` or `"complete"` |

### Gate Config

All fields optional; see [`SCHEMA-SPECIFICATION.md`](./SCHEMA-SPECIFICATION.md) §7 (GATE Steps) for the behaviour.

| Field                      | Type    | Description                                                                                                                                |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cycle_seconds`            | number  | Re-evaluation interval, 1 – 31,449,600 (default 5)                                                                                         |
| `language`, `source`       | string  | Condition script; the gate opens when it returns a truthy value (no source = open at once)                                                 |
| `control_previous_action`  | boolean | Written only as `true`: run alongside the preceding ACTION PROXY and STOP it on opening                                                    |
| `mode`                     | string  | `"condition"` (default), `"timer"` or `"condition_or_timer"`; written only for timed modes                                                 |
| `delay_seconds`            | integer | Whole seconds, 1 – 31,449,600; present exactly when `mode` is timed                                                                        |
| `action_property_bindings` | array   | `[{ parameter_id, environment_oid?, environment_name?, property }]` — inputs re-read live from the environment's action server every cycle |

### Action Proxy Config

| Field              | Type   | Required | Description                                                 |
| ------------------ | ------ | -------- | ----------------------------------------------------------- |
| `action_oid`       | string | Yes      | OID of the action in the environment's `included_actions[]` |
| `environment_oid`  | string | Yes      | OID of one of the workflow's `environment_specifications[]` |
| `action_name`      | string | No       | (5.0+) The action's name                                    |
| `environment_name` | string | No       | (5.0+) The environment's `local_id`                         |
| `timeout_ms`       | number | No       | Authored time limit in milliseconds; absent = no time limit |

### TRY / CATCH / RETURN

`try_specifications` is an array of `{ mode, catch_id, release_on_catch? }` with `mode` `"ERROR"`, `"ABORT"` or `"TIMEOUT"`, allowed on `ACTION PROXY`, `SCRIPT`, `GATE`, `USER_INTERACTION`, `YES_NO` and `WORKFLOW PROXY` steps and at workflow level. A `CATCH` step carries `catch_id`; a `RETURN` step carries `return_config: { command, restart_mode?, goto_step_oid? }` with `command` `"ABANDON"`, `"RESTART"`, `"GOTO"`, `"RETRY"` or `"COMPLETE"` and `restart_mode` `"CLEAN"` or `"KEEP"`.

### Select1 Config

| Field              | Type   | Required | Description                   |
| ------------------ | ------ | -------- | ----------------------------- |
| `input_name`       | string | No       | Name of the input to evaluate |
| `input_value_type` | string | No       | `"literal"` or `"property"`   |
| `options`          | array  | No       | Branch options                |

**Select1 Option:**

| Field        | Type    | Required | Description                                                                                        |
| ------------ | ------- | -------- | -------------------------------------------------------------------------------------------------- |
| `id`         | string  | Yes      | Unique option identifier                                                                           |
| `label`      | string  | Yes      | Display label                                                                                      |
| `operator`   | string  | Yes      | Comparison operator (Mission Engine: `==`, `!=`, `<`, `>`, `<=`, `>=`, `Contains`, `Not Contains`) |
| `value`      | string  | Yes      | Comparison value                                                                                   |
| `value_type` | string  | Yes      | `"literal"` or `"property"`                                                                        |
| `is_default` | boolean | Yes      | Whether this is the default branch                                                                 |

### Text Input Config (Legacy)

Retained for backward compatibility.

| Field             | Type    | Required | Description                                                                   |
| ----------------- | ------- | -------- | ----------------------------------------------------------------------------- |
| `required`        | boolean | No       | Whether input is required                                                     |
| `validation_type` | string  | No       | `"unrestricted"`, `"number"`, `"phone"`, `"alphanumeric"`, `"email"`, `"uri"` |
| `default_value`   | string  | No       | Default value pre-filled in the input                                         |

### Pick One Config (Legacy)

Retained for backward compatibility.

| Field               | Type   | Required | Description                       |
| ------------------- | ------ | -------- | --------------------------------- |
| `options`           | array  | No       | Array of `{ id, label, value }`   |
| `default_option_id` | string | No       | ID of the default-selected option |

### Checkbox Config (Legacy)

Retained for backward compatibility.

| Field            | Type    | Required | Description                                       |
| ---------------- | ------- | -------- | ------------------------------------------------- |
| `options`        | array   | No       | Array of `{ id, label, value, default_checked? }` |
| `output_format`  | string  | No       | `"array"`, `"csv"`, `"json"`                      |
| `min_selections` | integer | No       | Minimum selections required                       |
| `max_selections` | integer | No       | Maximum selections allowed                        |

### Form Document

From package format 5.0, a `USER_INTERACTION` or `YES_NO` step carries its form as `form_document`, a Form Document v2 validated against `src/lib/schemas/form-document.json` (an identical copy of Mission FormKit's schema). It is a `{ version: 2, sections: [{ id, role: "content" | "footer", rows: [{ id, gap?, blocks: [...] }] }] }` tree; block types are `text`, `header`, `textInput`, `textarea`, `checkbox`, `radio`, `image`, `video`, `divider`, `timer`, `button` and `esignature`. The full field reference, including button jobs, the bottom bar (`footer` section) and per-device text sizes (`size` / `sizeAt`), is [`SCHEMA-SPECIFICATION.md`](./SCHEMA-SPECIFICATION.md) §15.

### Form Layout Config

Legacy (package format ≤ 4.0): Mission Designer no longer writes `form_layout_config`; an imported one is converted to a `form_document`. WYSIWYG form layout for `USER_INTERACTION` and `YES_NO` steps, with per-device breakpoints.

| Field          | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `deviceType`   | string | Yes      | `"phone"`, `"tablet"`, or `"desktop"` |
| `canvasWidth`  | number | Yes      | Canvas width in pixels                |
| `canvasHeight` | number | Yes      | Canvas height in pixels               |
| `elements`     | array  | Yes      | Array of form element objects         |

### JSON Schema

The JSON Schema for the workflow library is [`src/lib/schemas/master-workflow-library.json`](./src/lib/schemas/master-workflow-library.json); the field tables above summarise it.

### Example

```json
{
  "local_id": "My Workflow Library",
  "oid": "3000000001",
  "version": "1.0",
  "last_modified_date": "2026-02-24T12:00:00.000Z",
  "workflow_specifications": [
    {
      "local_id": "Bake Cookies",
      "oid": "3000000002",
      "version": "1.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "schemaVersion": "5.0",
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
          "local_id": "Preheat Oven",
          "oid": "3000000011",
          "version": "1.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "ACTION PROXY",
          "position": { "x": 250, "y": 150 },
          "input_parameter_specifications": [
            {
              "id": "Temperature",
              "default_value": "375",
              "value_type": "literal"
            }
          ],
          "resource_command_specifications": [
            {
              "command_type": "Acquire",
              "resource_name": "Oven"
            }
          ]
        },
        {
          "local_id": "Confirm Ready",
          "oid": "3000000013",
          "version": "1.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "YES_NO",
          "position": { "x": 250, "y": 300 },
          "yes_no_config": {
            "yes_label": "Ready",
            "no_label": "Not Yet",
            "default_selection": "none"
          }
        },
        {
          "local_id": "End",
          "oid": "3000000012",
          "version": "1.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "END",
          "position": { "x": 250, "y": 450 }
        }
      ],
      "connections": [
        {
          "from_step_id": "3000000010",
          "to_step_id": "3000000011"
        },
        {
          "from_step_id": "3000000011",
          "to_step_id": "3000000013"
        },
        {
          "from_step_id": "3000000013",
          "to_step_id": "3000000012",
          "source_handle_id": "yes"
        }
      ],
      "resource_property_specifications": [
        {
          "name": "Oven",
          "resource_type": "binary exclusive use"
        }
      ],
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

| Field                     | Type   | Required | Description                                                                                                                           |
| ------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow_specifications` | array  | Yes      | Workflow specifications (same structure as in a [Workflow Library](#workflow-specification); each requires `steps` and `connections`) |
| `child_libraries`         | array  | No       | Nested child step libraries (recursive `$ref: "#"`)                                                                                   |
| `parent_library_oid`      | string | No       | OID of the parent library (provenance only; not read back)                                                                            |

### JSON Schema

The JSON Schema for the step library is [`src/lib/schemas/master-workflow-step-library.json`](./src/lib/schemas/master-workflow-step-library.json); the field tables above summarise it.

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
      "local_id": "Run Analysis Script",
      "oid": "4000000002",
      "version": "1.0.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "steps": [
        {
          "local_id": "Start",
          "oid": "4000000010",
          "version": "1.0.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "START"
        },
        {
          "local_id": "Analyse",
          "oid": "4000000011",
          "version": "1.0.0",
          "last_modified_date": "2026-02-24T12:00:00.000Z",
          "step_type": "SCRIPT",
          "input_parameter_specifications": [{ "id": "input_value", "default_value": "21" }],
          "output_parameter_specifications": [{ "id": "result", "target": "result" }],
          "script_config": { "language": "javascript", "source": "output.result = String(Number(input_value) * 2)" }
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
        { "from_step_id": "4000000011", "to_step_id": "4000000012" }
      ]
    }
  ]
}
```

---

## 7. Shared Definitions

### Parameter Specification

Used for input parameters on actions, steps, and workflows.

| Field           | Type   | Required | Description                                                                                          |
| --------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------- |
| `id`            | string | Yes      | Parameter name identifier                                                                            |
| `oid`           | string | No       | Snowflake OID                                                                                        |
| `description`   | string | No       | Human-readable description                                                                           |
| `default_value` | string | Yes      | Default value                                                                                        |
| `value_type`    | string | No       | `"literal"` (default) or `"property"` (reference to a value property); written only for `"property"` |
| `json_schema`   | string | No       | JSON Schema string for value validation                                                              |
| `entries`       | array  | No       | Structured `{ name, value }` entries                                                                 |

### Output Parameter Specification

| Field         | Type   | Required | Description                                                                                                                                       |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string | Yes      | Output parameter name identifier                                                                                                                  |
| `oid`         | string | No       | Snowflake OID                                                                                                                                     |
| `description` | string | No       | Human-readable description                                                                                                                        |
| `target`      | string | No       | Property key (`Name` or `Name.Entry`) where the output is stored; Mission Designer always writes it, using the output's own name when none is set |
| `entries`     | array  | No       | Structured `{ name, value }` entries                                                                                                              |

### Property Specification

Named value properties used for configuration.

| Field     | Type   | Required | Description                                      |
| --------- | ------ | -------- | ------------------------------------------------ |
| `name`    | string | Yes      | Property name                                    |
| `oid`     | string | No       | Snowflake OID                                    |
| `entries` | array  | No       | Array of `{ name: string, value: string }` pairs |

### Resource Property Specification

Defines a resource that can be acquired and released during workflow execution.

| Field           | Type             | Required | Description                                                                            |
| --------------- | ---------------- | -------- | -------------------------------------------------------------------------------------- |
| `name`          | string           | Yes      | Resource name                                                                          |
| `resource_type` | string           | Yes      | Resource type (see below)                                                              |
| `scope`         | string           | No       | `"workflow"` or `"environment"` (written by Mission Designer)                          |
| `use_limit`     | integer          | No       | Limit for shared or countable resources (required > 0 for those two types at run time) |
| `description`   | string           | No       | Human-readable description                                                             |
| `names`         | array of strings | No       | Named identifiers (for named pool resources)                                           |

**Resource Types:**

| Value                                | Description                         |
| ------------------------------------ | ----------------------------------- |
| `binary exclusive use`               | Single exclusive lock               |
| `binary shared use with pool limits` | Shared lock with pool limit         |
| `countable use with pool limits`     | Countable semaphore with pool limit |
| `named pool`                         | Pool of named resource instances    |
| `sync`                               | Synchronization point               |

### Resource Command Specification

Commands that steps execute to interact with resources.

| Field                  | Type    | Required | Description                                                      |
| ---------------------- | ------- | -------- | ---------------------------------------------------------------- |
| `oid`                  | string  | No       | Snowflake OID                                                    |
| `command_type`         | string  | Yes      | Command type (see below)                                         |
| `resource_name`        | string  | Yes      | Name of the target resource                                      |
| `resource_source_type` | string  | No       | `"workflow"` or `"environment"` — where the resource is declared |
| `resource_source_oid`  | string  | No       | OID of the declaring workflow or environment                     |
| `amount`               | integer | No       | Amount for pool commands                                         |
| `target`               | string  | No       | Value property to store acquired handle                          |
| `source`               | string  | No       | Value property reference for sync send data                      |

**Command Types:**

| Value                 | Description                      |
| --------------------- | -------------------------------- |
| `Acquire`             | Acquire exclusive or shared lock |
| `Release`             | Release a lock                   |
| `Acquire Pool Amount` | Acquire a count from a pool      |
| `Release Pool Amount` | Release a count back to a pool   |
| `Send`                | Send data via sync resource      |
| `Receive`             | Receive data via sync resource   |
| `Synchronize`         | Synchronize at a sync point      |

### Rich Text Content

Text fields in legacy (≤ 4.0) form layouts use a rich text wrapper format. A Form Document v2 block's `content` is a plain HTML string.

| Field       | Type   | Description                  |
| ----------- | ------ | ---------------------------- |
| `content`   | string | HTML content (TipTap format) |
| `plainText` | string | Plain text extraction        |

---

## 8. Export Packaging

### ZIP Format

A workflow exports as a `.WFmasterX` ZIP containing:

```
{WorkflowName}({version}).WFmasterX
  {WorkflowName}.WFmaster          # The workflow specification JSON
  manifest.json                    # Package metadata (advisory)
  environments/{EnvLibName}.WFenvir   # Environment libraries the workflow uses
  actions/{ActionLibName}.WFaction    # Action libraries those environments use
  images/
    image1.png                     # Image UI parameters (bare filename)
    {imageOid}-image2.jpg          # Form image blocks (prefixed with the block's imageOid, or the step OID without one)
```

### Image References

- **Step-level images:** Stored in `images/` folder, referenced by filename in `ui_parameter_specifications` with `type: "Image"`.
- **Form element images:** Stored with an `{imageOid}-{filename}` prefix (falling back to `{stepOid}-`) to avoid collisions across steps; `form_element_images` maps each `imageOid` to its filename.

### Library Exports

Libraries export as ZIP packages: `.WFlibX` (workflow library), `.WFstepLibX` (step library), `.WFenvirLibX` (environment library), `.WFactionLibX` (action library), and `.WFenvirX` for a single environment. Their layouts are in [`SCHEMA-SPECIFICATION.md`](./SCHEMA-SPECIFICATION.md) §12.

---

## 9. Schema Version History

| Version | Description                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.0     | Current version. Forms exported as a Form Document v2 (`form_document`); `form_layout_config` import-only. `action_proxy_config` may carry `action_name` and `environment_name`. |
| 4.0     | USER_INTERACTION step type, WYSIWYG form layouts, resource commands with Send/Receive/Synchronize, script steps, sync resources.                                                 |
| 3.0     | Added FORM_ENTRY step type (migrated to USER_INTERACTION in v4.0).                                                                                                               |
| Pre-3.0 | Legacy formats without `schemaVersion` field.                                                                                                                                    |

### Import Compatibility

- Files with `schemaVersion` `"4.0"` or `"5.0"` are accepted.
- Files with `schemaVersion < 4.0` or no `schemaVersion` are rejected as legacy format; a `.WFmasterX` with a `schemaVersion` above `"5.0"` is also rejected.
- AJV (JSON Schema Draft-07) validation is applied against the schema files in `src/lib/schemas/`, including `form-document.json` for every `form_document`.

### Identification

Each library and specification gets a unique UUID, and each step, parameter, property and form block a unique Snowflake OID. The `local_id` provides a human-readable name, while the `oid` provides globally unique identification for cross-system exchange.
