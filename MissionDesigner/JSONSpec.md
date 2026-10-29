# Mission Designer JSON Schema Specification

**Schema Version:** 4.0
**JSON Schema Draft:** Draft-07
**Base URI:** `https://trajectorypro.io/schemas/`

This document describes the JSON schemas used by Mission Designer for import and export of workflow specifications, libraries, and related data. All schemas use JSON Schema Draft-07 and share a common base element (`managed-element.json`).

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
2. A Master Workflow Step Library with its OID, and all Master Workflow Library Steps with their OIDs, and all contained steps.
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

- **Master Workflow Step Library** -- A collection of Master Workflow Library Steps.

- **Master Workflow Specification** -- A collection of Master Workflow Steps and Workflow Step Connections, with optional sets of Resource Command Specifications, Value Property Specifications, starting parameter specifications, and output parameter specifications.

- **Master Workflow Step** -- Contains optional sets of Resource Command Specifications, Value Property Specifications, input parameter specifications with default values, and output parameter specifications. References zero or more Workflow Step Connections.

- **Master Workflow Library Step** -- Has the same structure as a Master Workflow Step.

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

| Field                | Type               | Required | Description                         |
| -------------------- | ------------------ | -------- | ----------------------------------- |
| `local_id`           | string             | Yes      | Human-readable name/identifier      |
| `oid`                | string             | Yes      | Snowflake OID (globally unique)     |
| `version`            | string             | Yes      | Version string                      |
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

| Field                   | Type  | Required | Description                                           |
| ----------------------- | ----- | -------- | ----------------------------------------------------- |
| `action_specifications` | array | Yes      | List of action specifications                         |
| `child_libraries`       | array | No       | Nested child action libraries (recursive `$ref: "#"`) |

### Action Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                             | Type   | Required | Description                                                                               |
| --------------------------------- | ------ | -------- | ----------------------------------------------------------------------------------------- |
| `input_parameter_specifications`  | array  | No       | Input parameters (see [Parameter Specification](#parameter-specification))                |
| `output_parameter_specifications` | array  | No       | Output parameters (see [Output Parameter Specification](#output-parameter-specification)) |
| `property_specifications`         | array  | No       | Named value properties (see [Property Specification](#property-specification))            |
| `action_visibility`               | string | No       | `"opaque"` or `"observable"`                                                              |

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/master-action-library.json",
  "title": "Master Action Library",
  "description": "A collection of Master Actions Specifications.",
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
          "input_parameter_specifications": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "default_value"],
              "properties": {
                "id": { "type": "string" },
                "oid": { "type": "string" },
                "description": { "type": "string" },
                "default_value": { "type": "string" },
                "json_schema": { "type": "string" },
                "value_type": { "type": "string", "enum": ["literal", "property"] },
                "entries": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name", "value"],
                    "properties": {
                      "name": { "type": "string" },
                      "value": { "type": "string" }
                    }
                  }
                }
              }
            }
          },
          "output_parameter_specifications": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id"],
              "properties": {
                "id": { "type": "string" },
                "oid": { "type": "string" },
                "description": { "type": "string" },
                "target": { "type": "string" },
                "entries": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name", "value"],
                    "properties": {
                      "name": { "type": "string" },
                      "value": { "type": "string" }
                    }
                  }
                }
              }
            }
          },
          "action_visibility": {
            "type": "string",
            "enum": ["opaque", "observable"]
          },
          "property_specifications": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string" },
                "oid": { "type": "string" },
                "entries": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name", "value"],
                    "properties": {
                      "name": { "type": "string" },
                      "value": { "type": "string" }
                    }
                  }
                }
              }
            }
          }
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

| Field                        | Type  | Required | Description                                                |
| ---------------------------- | ----- | -------- | ---------------------------------------------------------- |
| `environment_specifications` | array | Yes      | List of environment specifications                         |
| `child_libraries`            | array | No       | Nested child environment libraries (recursive `$ref: "#"`) |

### Environment Specification

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                              | Type  | Required | Description                                                                                    |
| ---------------------------------- | ----- | -------- | ---------------------------------------------------------------------------------------------- |
| `included_actions`                 | array | Yes      | Actions included in this environment                                                           |
| `value_property_specifications`    | array | No       | Named value properties                                                                         |
| `action_property_specifications`   | array | No       | Action-scoped shared properties                                                                |
| `resource_property_specifications` | array | No       | Resource definitions (see [Resource Property Specification](#resource-property-specification)) |

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

When the action could be resolved at export time, all inlined fields are populated together. When not (legacy entries, missing library context), only `action_name` + `action_library` are emitted — consumers can detect the unresolved case by absence of `oid`.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/master-environment-library.json",
  "title": "Master Environment Library",
  "description": "A collection of Master Environment Specifications.",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["environment_specifications"],
  "properties": {
    "environment_specifications": {
      "type": "array",
      "items": {
        "type": "object",
        "allOf": [{ "$ref": "managed-element.json" }],
        "required": ["included_actions"],
        "properties": {
          "included_actions": {
            "type": "array",
            "description": "Inlined MasterActionSpecification entries (see Action Specification). action_name + action_library are join keys; the rest mirror a .WFaction action_specifications item.",
            "items": {
              "type": "object",
              "required": ["action_name", "action_library"],
              "properties": {
                "action_library": { "type": "string" },
                "action_name": { "type": "string" },
                "local_id": { "type": "string" },
                "oid": { "type": "string" },
                "description": { "type": "string" },
                "version": { "type": "string" },
                "last_modified_date": { "type": "string", "format": "date-time" },
                "action_visibility": { "type": "string", "enum": ["opaque", "observable"] },
                "input_parameter_specifications": { "type": "array" },
                "output_parameter_specifications": { "type": "array" },
                "property_specifications": { "type": "array" }
              }
            }
          },
          "value_property_specifications": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string" },
                "oid": { "type": "string" },
                "entries": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name", "value"],
                    "properties": {
                      "name": { "type": "string" },
                      "value": { "type": "string" }
                    }
                  }
                }
              }
            }
          },
          "action_property_specifications": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string" },
                "oid": { "type": "string" },
                "entries": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name", "value"],
                    "properties": {
                      "name": { "type": "string" },
                      "value": { "type": "string" }
                    }
                  }
                }
              }
            }
          },
          "resource_property_specifications": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "resource_type"],
              "properties": {
                "name": { "type": "string" },
                "resource_type": {
                  "type": "string",
                  "enum": [
                    "binary exclusive use",
                    "binary shared use with pool limits",
                    "countable use with pool limits",
                    "named pool",
                    "sync"
                  ]
                },
                "use_limit": { "type": "integer" },
                "description": { "type": "string" },
                "names": { "type": "array", "items": { "type": "string" } }
              }
            }
          }
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

| Field                               | Type   | Required | Description                                                                                                                                                           |
| ----------------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                     | string | No       | `"4.0"`                                                                                                                                                               |
| `type_name`                         | string | No       | Optional ISA 88 type (e.g. `Operation`), at most 50 characters. Informational only; never affects execution. Omitted when unset. Also allowed on each child workflow. |
| `steps`                             | array  | Yes      | Workflow steps (see [Workflow Step](#workflow-step))                                                                                                                  |
| `connections`                       | array  | Yes      | Step connections (see [Connection](#connection))                                                                                                                      |
| `resource_command_specifications`   | array  | No       | Workflow-level resource commands                                                                                                                                      |
| `resource_property_specifications`  | array  | No       | Workflow-level resource definitions                                                                                                                                   |
| `value_property_specifications`     | array  | No       | Workflow-level named values                                                                                                                                           |
| `starting_parameter_specifications` | array  | No       | Workflow input parameters                                                                                                                                             |
| `output_parameter_specifications`   | array  | No       | Workflow output parameters                                                                                                                                            |
| `environment_specifications`        | array  | No       | Embedded environment specifications                                                                                                                                   |
| `child_workflows`                   | array  | No       | Embedded sub-workflow specifications                                                                                                                                  |
| `viewport`                          | object | No       | Canvas viewport state (`x`, `y`, `zoom`)                                                                                                                              |

### Workflow Step

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field                             | Type             | Required | Description                                                |
| --------------------------------- | ---------------- | -------- | ---------------------------------------------------------- |
| `step_type`                       | string           | Yes      | Step type enum (see [Step Types](#step-types))             |
| `position`                        | object           | No       | Canvas position (`{ x: number, y: number }`)               |
| `action_visibility`               | string           | No       | `"opaque"` or `"observable"`                               |
| `input_parameter_specifications`  | array            | No       | Step input parameters                                      |
| `output_parameter_specifications` | array            | No       | Step output parameters                                     |
| `output_parameter_name`           | string           | No       | Output parameter name for UI steps that capture user input |
| `value_property_specifications`   | array            | No       | Step-level named values                                    |
| `resource_command_specifications` | array            | No       | Step-level resource commands                               |
| `ui_parameter_specifications`     | array            | No       | UI elements for user interaction steps                     |
| `yes_no_config`                   | object           | No       | YES_NO step configuration                                  |
| `script_config`                   | object           | No       | SCRIPT step configuration                                  |
| `select1_config`                  | object           | No       | SELECT 1 step configuration                                |
| `form_layout_config`              | array            | No       | WYSIWYG form layouts                                       |
| `text_input_config`               | object           | No       | Legacy text input configuration                            |
| `pick_one_config`                 | object           | No       | Legacy pick one configuration                              |
| `checkbox_config`                 | object           | No       | Legacy checkbox configuration                              |
| `connection_references`           | array of strings | No       | References to Workflow Step Connections                    |

### Step Types

| Value                 | Description                                   |
| --------------------- | --------------------------------------------- |
| `START`               | Workflow entry point                          |
| `END`                 | Workflow exit point                           |
| `ACTION PROXY`        | Execute an action (default)                   |
| `WAIT ACTION PROXY`   | Execute an action and wait for completion     |
| `NOWAIT ACTION PROXY` | Execute an action without waiting             |
| `WORKFLOW PROXY`      | Invoke a sub-workflow                         |
| `SELECT 1`            | Conditional branch (evaluate one path)        |
| `WAIT ANY`            | Wait for any incoming branch to complete      |
| `PARALLEL`            | Fork execution into parallel branches         |
| `WAIT ALL`            | Wait for all incoming branches to complete    |
| `MATH`                | Mathematical computation step                 |
| `SCRIPT`              | Execute a script (e.g., Python)               |
| `YES_NO`              | Binary user decision with configurable labels |
| `USER_INTERACTION`    | General user interaction with UI form layout  |

### Connection

| Field              | Type   | Required | Description                                                 |
| ------------------ | ------ | -------- | ----------------------------------------------------------- |
| `from_step_id`     | string | Yes      | Source step `local_id`                                      |
| `to_step_id`       | string | Yes      | Target step `local_id`                                      |
| `connection_id`    | string | No       | Unique identifier for this connection                       |
| `source_handle_id` | string | No       | Source handle ID (for SELECT 1 routing)                     |
| `condition`        | string | No       | Condition expression (for SELECT 1 connections)             |
| `waypoints`        | array  | No       | Edge routing waypoints (`{ x: number, y: number }` offsets) |

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

| Field               | Type   | Required | Description                                           |
| ------------------- | ------ | -------- | ----------------------------------------------------- |
| `yes_label`         | string | No       | Custom label for Yes button (default: `"Yes"`)        |
| `no_label`          | string | No       | Custom label for No button (default: `"No"`)          |
| `yes_value`         | string | No       | Output value when Yes is selected (default: `"true"`) |
| `no_value`          | string | No       | Output value when No is selected (default: `"false"`) |
| `default_selection` | string | No       | `"yes"`, `"no"`, or `"none"`                          |

### Script Config

| Field      | Type   | Required | Description                        |
| ---------- | ------ | -------- | ---------------------------------- |
| `language` | string | No       | Script language (e.g., `"python"`) |
| `source`   | string | No       | Script source code                 |

### Select1 Config

| Field              | Type   | Required | Description                   |
| ------------------ | ------ | -------- | ----------------------------- |
| `input_name`       | string | No       | Name of the input to evaluate |
| `input_value_type` | string | No       | `"literal"` or `"property"`   |
| `options`          | array  | No       | Branch options                |

**Select1 Option:**

| Field        | Type    | Required | Description                        |
| ------------ | ------- | -------- | ---------------------------------- |
| `id`         | string  | Yes      | Unique option identifier           |
| `label`      | string  | Yes      | Display label                      |
| `operator`   | string  | Yes      | Comparison operator                |
| `value`      | string  | Yes      | Comparison value                   |
| `value_type` | string  | Yes      | `"literal"` or `"property"`        |
| `is_default` | boolean | Yes      | Whether this is the default branch |

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

### Form Layout Config

WYSIWYG form layout for `USER_INTERACTION` and `YES_NO` steps, with per-device breakpoints.

| Field          | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `deviceType`   | string | Yes      | `"phone"`, `"tablet"`, or `"desktop"` |
| `canvasWidth`  | number | Yes      | Canvas width in pixels                |
| `canvasHeight` | number | Yes      | Canvas height in pixels               |
| `elements`     | array  | Yes      | Array of form element objects         |

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/master-workflow-library.json",
  "title": "Master Workflow Library",
  "description": "A collection of Master Workflow Specifications.",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["workflow_specifications"],
  "properties": {
    "workflow_specifications": {
      "type": "array",
      "items": {
        "type": "object",
        "allOf": [{ "$ref": "managed-element.json" }],
        "required": ["steps", "connections"],
        "properties": {
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "allOf": [{ "$ref": "managed-element.json" }],
              "required": ["step_type"],
              "properties": {
                "step_type": {
                  "type": "string",
                  "enum": [
                    "START",
                    "END",
                    "ACTION PROXY",
                    "WAIT ACTION PROXY",
                    "NOWAIT ACTION PROXY",
                    "WORKFLOW PROXY",
                    "SELECT 1",
                    "WAIT ANY",
                    "PARALLEL",
                    "WAIT ALL",
                    "MATH",
                    "SCRIPT",
                    "YES_NO",
                    "USER_INTERACTION"
                  ]
                },
                "output_parameter_name": { "type": "string" },
                "ui_parameter_specifications": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["type", "value"],
                    "properties": {
                      "oid": { "type": "string" },
                      "type": {
                        "type": "string",
                        "enum": [
                          "Button",
                          "Header",
                          "Text",
                          "SmallText",
                          "Image",
                          "Video",
                          "TextInput",
                          "YesNoButtons",
                          "PickList",
                          "CheckboxList",
                          "FormField",
                          "FormFieldMultiline",
                          "FormFieldNumeric",
                          "FormFieldPhone",
                          "FormFieldEmail",
                          "Divider"
                        ]
                      },
                      "value": { "type": "string" },
                      "font_size": { "type": "number" },
                      "color": { "type": "string" },
                      "lines": { "type": "integer" },
                      "align": { "type": "string", "enum": ["left", "center", "right"] },
                      "value2": { "type": "string" }
                    }
                  }
                },
                "text_input_config": {
                  "type": "object",
                  "properties": {
                    "required": { "type": "boolean" },
                    "validation_type": {
                      "type": "string",
                      "enum": ["unrestricted", "number", "phone", "alphanumeric", "email", "uri"]
                    },
                    "default_value": { "type": "string" }
                  }
                },
                "yes_no_config": {
                  "type": "object",
                  "properties": {
                    "yes_label": { "type": "string" },
                    "no_label": { "type": "string" },
                    "yes_value": { "type": "string" },
                    "no_value": { "type": "string" },
                    "default_selection": { "type": "string", "enum": ["yes", "no", "none"] }
                  }
                },
                "pick_one_config": {
                  "type": "object",
                  "properties": {
                    "options": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": ["id", "label", "value"],
                        "properties": {
                          "id": { "type": "string" },
                          "label": { "type": "string" },
                          "value": { "type": "string" }
                        }
                      }
                    },
                    "default_option_id": { "type": "string" }
                  }
                },
                "checkbox_config": {
                  "type": "object",
                  "properties": {
                    "options": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": ["id", "label", "value"],
                        "properties": {
                          "id": { "type": "string" },
                          "label": { "type": "string" },
                          "value": { "type": "string" },
                          "default_checked": { "type": "boolean" }
                        }
                      }
                    },
                    "output_format": { "type": "string", "enum": ["array", "csv", "json"] },
                    "min_selections": { "type": "integer" },
                    "max_selections": { "type": "integer" }
                  }
                },
                "script_config": {
                  "type": "object",
                  "properties": {
                    "language": { "type": "string" },
                    "source": { "type": "string" }
                  }
                },
                "select1_config": {
                  "type": "object",
                  "properties": {
                    "input_name": { "type": "string" },
                    "input_value_type": { "type": "string", "enum": ["literal", "property"] },
                    "options": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": ["id", "label", "operator", "value", "value_type", "is_default"],
                        "properties": {
                          "id": { "type": "string" },
                          "label": { "type": "string" },
                          "operator": { "type": "string" },
                          "value": { "type": "string" },
                          "value_type": { "type": "string", "enum": ["literal", "property"] },
                          "is_default": { "type": "boolean" }
                        }
                      }
                    }
                  }
                },
                "form_layout_config": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["deviceType", "canvasWidth", "canvasHeight", "elements"],
                    "properties": {
                      "deviceType": { "type": "string", "enum": ["phone", "tablet", "desktop"] },
                      "canvasWidth": { "type": "number" },
                      "canvasHeight": { "type": "number" },
                      "elements": { "type": "array", "items": { "type": "object" } }
                    }
                  }
                },
                "resource_command_specifications": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["command_type", "resource_name"],
                    "properties": {
                      "oid": { "type": "string" },
                      "command_type": {
                        "type": "string",
                        "enum": [
                          "Acquire",
                          "Release",
                          "Acquire Pool Amount",
                          "Release Pool Amount",
                          "Send",
                          "Receive",
                          "Synchronize"
                        ]
                      },
                      "resource_name": { "type": "string" },
                      "amount": { "type": "integer" },
                      "target": { "type": "string" },
                      "source": { "type": "string" }
                    }
                  }
                },
                "value_property_specifications": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name"],
                    "properties": {
                      "name": { "type": "string" },
                      "oid": { "type": "string" },
                      "entries": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "required": ["name", "value"],
                          "properties": {
                            "name": { "type": "string" },
                            "value": { "type": "string" }
                          }
                        }
                      }
                    }
                  }
                },
                "input_parameter_specifications": { "type": "array" },
                "output_parameter_specifications": { "type": "array" },
                "connection_references": { "type": "array", "items": { "type": "string" } },
                "position": {
                  "type": "object",
                  "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" }
                  }
                },
                "action_visibility": { "type": "string", "enum": ["opaque", "observable"] }
              }
            }
          },
          "connections": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["from_step_id", "to_step_id"],
              "properties": {
                "from_step_id": { "type": "string" },
                "to_step_id": { "type": "string" },
                "connection_id": { "type": "string" },
                "source_handle_id": { "type": "string" },
                "condition": { "type": "string" },
                "waypoints": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "x": { "type": "number" },
                      "y": { "type": "number" }
                    }
                  }
                }
              }
            }
          },
          "viewport": {
            "type": "object",
            "properties": {
              "x": { "type": "number" },
              "y": { "type": "number" },
              "zoom": { "type": "number" }
            }
          },
          "resource_command_specifications": { "type": "array" },
          "value_property_specifications": { "type": "array" },
          "starting_parameter_specifications": { "type": "array" },
          "output_parameter_specifications": { "type": "array" },
          "resource_property_specifications": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "resource_type"],
              "properties": {
                "name": { "type": "string" },
                "resource_type": {
                  "type": "string",
                  "enum": [
                    "binary exclusive use",
                    "binary shared use with pool limits",
                    "countable use with pool limits",
                    "named pool",
                    "sync"
                  ]
                },
                "use_limit": { "type": "integer" },
                "description": { "type": "string" },
                "names": { "type": "array", "items": { "type": "string" } }
              }
            }
          },
          "environment_specifications": { "type": "array" },
          "child_workflows": {
            "type": "array",
            "items": {
              "type": "object",
              "allOf": [{ "$ref": "managed-element.json" }],
              "required": ["steps", "connections"],
              "properties": {
                "steps": { "type": "array", "items": { "type": "object" } },
                "connections": { "type": "array", "items": { "type": "object" } },
                "resource_command_specifications": { "type": "array" },
                "value_property_specifications": { "type": "array" },
                "starting_parameter_specifications": { "type": "array" },
                "output_parameter_specifications": { "type": "array" },
                "child_workflows": { "type": "array" },
                "viewport": {
                  "type": "object",
                  "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "zoom": { "type": "number" }
                  }
                }
              }
            }
          }
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
      "schemaVersion": "4.0",
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
          "from_step_id": "Start",
          "to_step_id": "Preheat Oven",
          "connection_id": "conn-1"
        },
        {
          "from_step_id": "Preheat Oven",
          "to_step_id": "Confirm Ready",
          "connection_id": "conn-2"
        },
        {
          "from_step_id": "Confirm Ready",
          "to_step_id": "End",
          "connection_id": "conn-3"
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

A collection of reusable workflow steps that can be dragged onto a canvas.

### Top Level

Inherits all fields from [Managed Element](#2-managed-element-base-schema).

| Field             | Type  | Required | Description                                                               |
| ----------------- | ----- | -------- | ------------------------------------------------------------------------- |
| `library_steps`   | array | Yes      | List of library steps (same structure as [Workflow Step](#workflow-step)) |
| `child_libraries` | array | No       | Nested child step libraries (recursive `$ref: "#"`)                       |

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://trajectorypro.io/schemas/master-workflow-step-library.json",
  "title": "Master Workflow Step Library",
  "description": "A collection of Master Workflow Library Steps.",
  "allOf": [{ "$ref": "managed-element.json" }],
  "type": "object",
  "required": ["library_steps"],
  "properties": {
    "library_steps": {
      "type": "array",
      "description": "A collection of steps with the same structure as Master Workflow Steps.",
      "items": { "..." }
    },
    "child_libraries": {
      "type": "array",
      "items": { "$ref": "#" }
    }
  }
}
```

The `library_steps` array items have the identical structure to steps within [Workflow Specification](#workflow-step), including all step type configurations, UI parameters, resource commands, form layouts, etc.

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
    },
    {
      "local_id": "Run Analysis Script",
      "oid": "4000000003",
      "version": "1.0",
      "last_modified_date": "2026-02-24T12:00:00.000Z",
      "step_type": "SCRIPT",
      "script_config": {
        "language": "python",
        "source": "result = input_value * 2\nprint(result)"
      }
    }
  ]
}
```

---

## 7. Shared Definitions

### Parameter Specification

Used for input parameters on actions, steps, and workflows.

| Field           | Type   | Required | Description                                                           |
| --------------- | ------ | -------- | --------------------------------------------------------------------- |
| `id`            | string | Yes      | Parameter name identifier                                             |
| `oid`           | string | No       | Snowflake OID                                                         |
| `description`   | string | No       | Human-readable description                                            |
| `default_value` | string | Yes      | Default value                                                         |
| `value_type`    | string | No       | `"literal"` (default) or `"property"` (reference to a value property) |
| `json_schema`   | string | No       | JSON Schema string for value validation                               |
| `entries`       | array  | No       | Structured `{ name, value }` entries                                  |

### Output Parameter Specification

| Field         | Type   | Required | Description                                |
| ------------- | ------ | -------- | ------------------------------------------ |
| `id`          | string | Yes      | Output parameter name identifier           |
| `oid`         | string | No       | Snowflake OID                              |
| `description` | string | No       | Human-readable description                 |
| `target`      | string | No       | Value property name where output is stored |
| `entries`     | array  | No       | Structured `{ name, value }` entries       |

### Property Specification

Named value properties used for configuration.

| Field     | Type   | Required | Description                                      |
| --------- | ------ | -------- | ------------------------------------------------ |
| `name`    | string | Yes      | Property name                                    |
| `oid`     | string | No       | Snowflake OID                                    |
| `entries` | array  | No       | Array of `{ name: string, value: string }` pairs |

### Resource Property Specification

Defines a resource that can be acquired and released during workflow execution.

| Field           | Type             | Required | Description                                  |
| --------------- | ---------------- | -------- | -------------------------------------------- |
| `name`          | string           | Yes      | Resource name                                |
| `resource_type` | string           | Yes      | Resource type (see below)                    |
| `use_limit`     | integer          | No       | Limit for shared or countable resources      |
| `description`   | string           | No       | Human-readable description                   |
| `names`         | array of strings | No       | Named identifiers (for named pool resources) |

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

| Field           | Type    | Required | Description                                 |
| --------------- | ------- | -------- | ------------------------------------------- |
| `oid`           | string  | No       | Snowflake OID                               |
| `command_type`  | string  | Yes      | Command type (see below)                    |
| `resource_name` | string  | Yes      | Name of the target resource                 |
| `amount`        | integer | No       | Amount for pool commands                    |
| `target`        | string  | No       | Value property to store acquired handle     |
| `source`        | string  | No       | Value property reference for sync send data |

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

Text fields in form layouts use a rich text wrapper format.

| Field       | Type   | Description                  |
| ----------- | ------ | ---------------------------- |
| `content`   | string | HTML content (TipTap format) |
| `plainText` | string | Plain text extraction        |

---

## 8. Export Packaging

### ZIP Format

Workflow exports use ZIP packaging (via JSZip) containing:

```
workflow-name.zip
  workflow.json          # The workflow specification JSON
  images/
    image1.png           # Referenced images from step nodes
    stepOid-image2.jpg   # Form element images (prefixed with step OID)
```

### Image References

- **Step-level images:** Stored in `images/` folder, referenced by filename in `ui_parameter_specifications` with `type: "Image"`.
- **Form element images:** Stored with `{stepOid}-{filename}` prefix to avoid collisions across steps.

### Library Exports

Libraries export as plain JSON files (no ZIP wrapper) since they don't contain images.

---

## 9. Schema Version History

| Version | Description                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.0     | Current version. USER_INTERACTION step type, WYSIWYG form layouts, resource commands with Send/Receive/Synchronize, script steps, sync resources. |
| 3.0     | Added FORM_ENTRY step type (migrated to USER_INTERACTION in v4.0).                                                                                |
| Pre-3.0 | Legacy formats without `schemaVersion` field.                                                                                                     |

### Import Compatibility

- Files with `schemaVersion: "4.0"` are accepted.
- Files with `schemaVersion < 4.0` or no `schemaVersion` are rejected as legacy format.
- AJV (JSON Schema Draft-07) validation is applied against the schema files in `src/lib/schemas/`.

### Identification

For each created library, specification, step, and workflow, a unique Snowflake OID is assigned. The `local_id` provides a human-readable name, while the `oid` provides globally unique identification for cross-system exchange.
