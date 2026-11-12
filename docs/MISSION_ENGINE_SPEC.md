# Trajectory Pro — Mission Engine Implementation Specification

| | |
|---|---|
| Reference implementation | `MissionEngine` 1.2.0 (TypeScript / Node.js / Hono / PostgreSQL) |
| Reference commit | superproject `0dddd834` (2026-11-11) |
| Database schema level | migration `0051_back_and_stop` |
| Status | Descriptive specification extracted from the reference implementation; every part independently re-verified against the code (2026-11-12) |

## 0. About this document

### 0.1 Purpose

This document specifies the Mission Engine precisely enough that it can be re-implemented on a
different system (another language, runtime, operating system or database) while still interoperating
with the rest of the Trajectory Pro Mission Control suite:

- **Mission Designer** authors workflows and exports the workflow JSON the engine executes (Part 1).
- **Mission Pilot** is the operator web app. It is served by the engine and calls the engine's operator
  REST API and event stream (Part 3).
- **Mission Commander** and **Mission XO** are the administration apps. They share the database with the
  engine (Part 5) and call the engine's internal REST API (Part 3, §B.7).
- **Action servers** (Mission Autopilot or any conforming server) run ACTION PROXY steps. The engine is
  their REST client (Part 4, §D.1).
- **Mission Broker** runs distributed (ISA 113-style) workflow actions behind the same action-server
  protocol (Part 4, §D.2).

### 0.2 Conformance language

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. A statement describes the reference
implementation's observable behaviour. A conforming re-implementation MUST reproduce that behaviour
wherever another suite component can observe it: JSON accepted or rejected, HTTP requests and responses,
database rows read by other apps, event payloads, and operator-visible results. Internal structure
(threads, caches, module layout) is described only to make the behaviour understandable and is not
normative unless marked so.

### 0.3 Citations

Most statements carry a citation such as `[src: MissionEngine/src/core/transition.ts:892]`. It points at
the reference implementation at the commit above and lets an implementer read the exact code behind a
rule. Line numbers drift as the code changes. Treat the file and function as the reference, and the line
as a hint.

### 0.4 Reference-implementation quirks

Where the reference behaves surprisingly (for example, a USER_INTERACTION step fires every outgoing
connection because Pilot never sends a button value), this document describes the behaviour as it is,
and lists it again in Appendix X ("Behaviour notes and open points"). A re-implementation that must stay
interchangeable with the reference MUST reproduce these behaviours. A re-implementation that may diverge
SHOULD treat Appendix X as the list of places to decide deliberately.

### 0.5 Relationship to other documents

| Document | Scope | Note |
|---|---|---|
| `docs/JSON_SCHEMA.md` | All suite JSON and ZIP package formats (`.WFmasterX`, `.WFlibX`, …) | Broader than this spec, but older; Appendix Y lists where it disagrees with the code |
| `docs/REST_Protocol.md` | Action-server protocol from the server's point of view | Part 4 here specifies the engine's client side; Appendix Y lists disagreements |
| `docs/DISTRIBUTED_WORKFLOW_LIBRARY.md` | Distributed workflow actions (Mission Broker) | Part 4 §D.2 |
| `MissionEngine/src/conformance/fixtures` | 94 conformance fixtures (validation, execution, parameters, resources; vendored plus local additions — `PROVENANCE.md` still says 82) | A re-implementation SHOULD pass them, except the three skipped `exec-child-*` fixtures; Part 2 §C.10 lists exactly what each one asserts |

Where this document and an older document disagree, this document (and the code) wins.

### 0.6 System context

```
                 workflow JSON (.WFmasterX)
 Mission Designer ─────────────────────────► Mission Commander ──(DB: master workflows, versions)──┐
                                                  │   ▲                                            │
                         /internal/* (x-internal-token)│ shared PostgreSQL (Part 5)                 │
                                                  ▼   │                                            ▼
 Mission Pilot (browser) ── /api/*, /api/events ─► MISSION ENGINE ◄──── LISTEN/NOTIFY ────── PostgreSQL
                         ◄─ static Pilot bundle ──     │   │
                                                       │   └── SCRIPT / GATE scripts (sandboxed workers)
                         action-server REST (Part 4)   ▼
                              Mission Autopilot · other action servers · Mission Broker
```

### 0.7 Document map

| Part | Content |
|---|---|
| Part 1 (A) | Workflow JSON the engine accepts: every field, every validation rule, examples, JSON Schema gaps |
| Part 2 (C) | Execution semantics: lifecycles, the cascade algorithm, every step type, routing, parameters, Back/Stop, timers |
| Part 3 (B) | HTTP interfaces the engine exposes: auth, operator API, SSE, internal API, Pilot bundle |
| Part 4 (D) | Outbound calls (action servers, Broker), scripts, resources, assignments, e-signatures, configuration |
| Part 5 (E) | Persistence: abstract state model, concrete table contract, locking, notifications, records |
| Appendix X | Behaviour notes and open points (collected from every part) |
| Appendix Y | Disagreements between the older docs and the code |

The parts are ordered so that each one builds on the previous: the JSON (what a workflow is), then how it
runs, then how clients drive it, then what it calls, then what it stores.

# Part 1 — Workflow JSON (sections A.x)

This section specifies the workflow JSON ("frozen control recipe") that the Mission Engine executes:
every field the engine reads, the validation it applies before running anything, and which parts are
opaque to the engine and only passed through to Mission Pilot. Everything here was read from code.
Where the engine's own TypeScript types, its bundled JSON Schema and its runtime behaviour disagree,
the runtime behaviour is what is specified, and the disagreement is recorded in Appendix X
(behaviour notes).

Notation: "MUST" / "MUST NOT" are requirements on a re-implementation. "Designer" = Mission Designer
(producer of the JSON), "Commander" = Mission Commander (loads packages, creates runtime workflows),
"Pilot" = Mission Pilot (operator app).

---

## A.0 Where the JSON comes from and when it is checked

1. The engine never receives workflow JSON over HTTP. It reads it from the database column
   `workflow_instance.spec_jsonb` of a queued instance when it claims it
   (`update workflow_instance set status='running' ... returning ... spec_jsonb, starting_params`).
   [src: mission-control-db/src/runtime/engine-access.ts:56-75]
2. The stored JSON is not the Designer master verbatim. Commander produces it with
   `instantiateSpec(master)` (ISA-88 master -> control-recipe copy), which:
   - deep-clones the master, so every unknown field survives; [src: mission-control-db/src/runtime/instantiate.ts:35-53]
   - renumbers every workflow `oid` (root and every `children[]` node, depth first) and then every
     step `oid` (per spec, root first) to `rt_1`, `rt_2`, ... ; [src: mission-control-db/src/runtime/instantiate.ts:49-66,76-82]
   - stamps `master_oid` (the pre-renumber oid) on every workflow node; [src: mission-control-db/src/runtime/instantiate.ts:68-74]
   - rewrites `connections[].from_step_id/to_step_id`, `return_config.goto_step_oid`, and
     `resource_command_specifications[].resource_source_oid` (only when `resource_source_type !== 'environment'`)
     to the new oids; [src: mission-control-db/src/runtime/instantiate.ts:79-108]
   - does NOT rewrite `connection_id`, `source_handle_id`, `catch_id`, `select1_config.options[].id`,
     environment oids, `action_proxy_config`, or binding `environment_oid`.
     [src: mission-control-db/src/runtime/instantiate.ts:76-108]
   A re-implementation MUST execute the instantiated JSON and MUST treat `master_oid` as an
   ordinary extra field (it is used only for role resolution, outside the engine core —
   [src: mission-control-db/src/runtime/assignments.ts:43-56]).
3. Starting-parameter values arrive separately, as `workflow_instance.starting_params`
   (a JSON object `{ "<id>": "<string>" }`, or null). [src: mission-control-db/src/runtime/engine-access.ts:24,72]
4. The engine MUST validate the JSON exactly once, when it starts a queued instance, with the rules
   of §A.8. On a failed validation it MUST record one instance-level trace row with state `ERRORED`
   and error text `error_message ?? error_code ?? 'invalid workflow specification'`, and settle the
   instance with status `errored`. On success it MUST record one instance-level trace row with state
   `WARNING` per warning (the warning's `message` only; the `code` is not recorded) and then start.
   [src: MissionEngine/src/core/instance.ts:49-65]
5. No other component validates workflow JSON with these rules (Commander does not import the engine
   validator). [src: grep of MissionCommander/src, mission-control-db/src for `validateWorkflow` / `spec/validator` — no hits]

---

## A.1 MasterWorkflowSpecification (root)

The root object. It inherits ManagedElement (§A.2). Unknown fields are permitted everywhere (the
schema has no `additionalProperties: false`). [src: MissionEngine/src/spec/workflow-schema.json:740-799; verified: a root/step/connection with extra fields validates]

| Field | Type | Req. | Default | Engine meaning |
|---|---|---|---|---|
| `local_id` | string | yes (schema) | — | Workflow name. Used for child lookup (§A.3.15) when this object is a child. [src: workflow-schema.json:8-18,741] |
| `oid` | string | yes (schema) | — | Workflow identity. Owner key for workflow-scoped resources (`<oid>:<resource name>`) and the `node_oid` of step rows. [src: MissionEngine/src/core/instance.ts:95-100; MissionEngine/src/core/transition.ts:81-83] |
| `version` | string | yes (schema) | — | Not read by the engine core. |
| `last_modified_date` | string | yes (schema) | — | Not read. Schema says `format: date-time` but the format is NOT enforced (ajv without formats; any string passes). [src: workflow-schema.json:15; MissionEngine/src/spec/validator.ts:898; verified: ajv logs `unknown format "date-time" ignored`] |
| `description` | string | no | — | Not read. |
| `schemaVersion` | string enum `"3.0"`,`"4.0"`,`"5.0"` | no | — | Not read at runtime; any other value fails validation (`MISSING_REQUIRED_FIELD`, message `must be equal to one of the allowed values`). [src: workflow-schema.json:745; verified "6.0"] |
| `state` | string | no on root | — | Not read by the engine core. |
| `display_style` | enum `"flowchart"`,`"bpmn"`,`"isa88"` | no | — | Not read by execution; read by the diagram projection served at `GET /api/runtime-workflows/:id/diagram`. Other values fail validation. [src: workflow-schema.json:747; mission-control-db/src/dao/workflow-diagram.ts:164] |
| `steps` | MasterWorkflowStep[] | yes | — | §A.3. [src: MissionEngine/src/spec/validator.ts:42-44] |
| `connections` | WorkflowConnection[] | yes | — | §A.4. [src: MissionEngine/src/spec/validator.ts:45-47] |
| `try_specifications` | WorkflowTrySpecification[] | no | none | Workflow-level TRY rows (§A.3.11), consulted when the failing step has no matching row of its own (a child consults its own rows, never the root's); also hosts the operator modes `OPERATOR_STOP` / `OPERATOR_ABORT`, which fire ONLY from the ROOT spec (a child's operator rows are accepted by validation but never used). [src: MissionEngine/src/core/transition.ts:2015-2031; MissionEngine/src/core/operator-cleanup.ts:50-54] |
| `starting_parameter_specifications` | ParameterSpecification[] | no | none | Workflow inputs (§A.5.2). [src: MissionEngine/src/core/instance.ts:76-79] |
| `output_parameter_specifications` | OutputParameterSpecification[] | no | none | Workflow outputs: read when the instance finishes for runtime history `outputs`, and (on a child) when the child completes (§A.3.15). [src: MissionEngine/src/core/context.ts:1359; mission-control-db/src/runtime/workflow-outputs.ts:41-54] |
| `value_property_specifications` | PropertySpecification[] | no | none | Seeds the instance property store (§A.5.4). [src: MissionEngine/src/core/properties.ts:68-77] |
| `resource_property_specifications` | ResourcePropertySpecification[] | no | none | Workflow-scoped resources (§A.5.5). [src: MissionEngine/src/core/instance.ts:95-100] |
| `resource_command_specifications` | ResourceCommandSpecification[] | no | — | Accepted by the schema; NEVER executed at workflow level (only step-level commands run). [src: MissionEngine/src/spec/types.ts:497; no reader in MissionEngine/src] |
| `environment_specifications` | MasterEnvironmentSpecification[] | no | none | Embedded environments (§A.6). |
| `children` | ChildWorkflowExport[] | no | none | Embedded child workflows (§A.2.2). |
| `viewport` | `{x:number,y:number,zoom:number}` | no | — | Editor state; not read by the engine. [src: workflow-schema.json:788-795] |

Fields seen in real Designer exports that the engine ignores: `type_name`, `library_name`,
`library_oid`. [src: Samples/Individual Workflow Tests/*.WFmasterX root keys; no reader in MissionEngine/src]

---

## A.2 ManagedElement, identity, children

### A.2.1 ManagedElement

```json
{ "local_id": "string", "oid": "string", "description": "string?", "version": "string", "last_modified_date": "string" }
```

- Root, every child, every step and every embedded environment MUST carry `local_id`, `oid`,
  `version`, `last_modified_date`, all strings. [src: workflow-schema.json:8-18,571,603,678,741]
- For steps the check is done twice: first a key-presence check (`field in step`, so `null`
  passes it), in the order `local_id`, `oid`, `version`, `last_modified_date`, then `step_type`;
  then the JSON-Schema check (a `null` or a number fails there with message `must be string`).
  [src: MissionEngine/src/spec/validator.ts:50-62; verified]
- `local_id` is the human-readable name: it is the step name in history (`stepNames`), traces,
  signatures and the inbox (`stepName`). [src: MissionEngine/src/core/context.ts:86-90; MissionEngine/src/core/submit.ts:171; mission-control-db/src/runtime/inbox.ts:330]
- `oid` is the identity: step `oid` values MUST be unique within a spec's `steps` (checked for the
  root spec only). [src: MissionEngine/src/spec/validator.ts:85-93]

### A.2.2 ChildWorkflowExport (`children[]`)

A child is a full MasterWorkflowSpecification plus:

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `parentChildSpecId` | string \| null | yes (schema; null allowed) | Provenance only; the engine never reads it. [src: workflow-schema.json:683,735; MissionEngine/src/spec/types.ts:504-506] |
| `state` | string | **yes** on children (schema) | Not read. A child without `state` fails with `MISSING_REQUIRED_FIELD` / `Missing required field: state at /children/0`. [src: workflow-schema.json:735; verified] |
| `steps`, `connections` | arrays | yes | As root. |
| `children` | array | no | Grandchildren, any depth. |

- Child nesting is recursive; every lookup (`findSpecByOid`, environment scope, resource owners,
  form warnings) walks `children` at any depth. [src: MissionEngine/src/core/context.ts:58-90; MissionEngine/src/core/env-scope.ts:47-58]
- Children are checked structurally (JSON Schema), by the resource rules and by the form-binding
  warning walk, but NOT by the graph rules (START/END counts, reachability, PARALLEL, TRY/CATCH,
  GATE, SCRIPT, ACTION PROXY, server URI, binding warnings), which run on the root only. A child
  with no START therefore validates (verified), and at runtime its WORKFLOW PROXY parks forever.
  [src: MissionEngine/src/spec/validator.ts:81-171,203-317,322-373,377-404,413-475,477-528,952-974; MissionEngine/src/core/transition.ts:2637-2645]
- Real Designer exports put no `environment_specifications` on children; the engine resolves a
  child step's environment first in the owning child, then in the root. [src: MissionEngine/src/loop.ts:342-362]

### A.2.3 Sub-workflow reference

There is no explicit reference field. A `WORKFLOW PROXY` step is bound to the FIRST element of the
CONTAINING spec's `children[]` whose `local_id` equals the step's own `local_id` (exact,
case-sensitive). No match = the step completes immediately as a no-op. [src: MissionEngine/src/core/transition.ts:2552-2556]

---

## A.3 MasterWorkflowStep

### A.3.1 step_type enum

The structural schema accepts exactly these strings (case- and whitespace-sensitive):
[src: workflow-schema.json:19-26]

`"START"`, `"END"`, `"ACTION PROXY"`, `"WORKFLOW PROXY"`, `"SELECT 1"`, `"WAIT ANY"`, `"PARALLEL"`,
`"WAIT ALL"`, `"MATH"`, `"SCRIPT"`, `"GATE"`, `"YES_NO"`, `"USER_INTERACTION"`, `"CATCH"`, `"RETURN"`

Plus one alias: `"SELECT_1"` is rewritten to `"SELECT 1"` before the schema check and at runtime
(`canonicalStepType`), and the canonical form is what is stored in `step_instance.step_type`.
[src: MissionEngine/src/spec/validator.ts:903-915; MissionEngine/src/core/step-handlers.ts:31-34; MissionEngine/src/core/transition.ts:846]

Rules a re-implementation MUST reproduce:
- `"YES NO"` / `"USER INTERACTION"` (spaces) and `"ACTION_PROXY"` etc. are REJECTED with
  `INVALID_STEP_TYPE` (`Invalid step type at /steps/<i>/step_type`), even though the graph rules
  compare types after replacing `_` with a space. [src: MissionEngine/src/spec/validator.ts:32-34,933-935; verified]
- Lower-case `"start"` gives `NO_START_STEP` (the graph rules run first). [verified]
- Runtime dispatch per canonical type [src: MissionEngine/src/core/transition.ts:2387-2513; MissionEngine/src/core/step-handlers.ts:36-43]:

| step_type | Runtime behaviour (one line) | Park state |
|---|---|---|
| `START` | Completes immediately at instance start; never gets a step row of its own. [src: MissionEngine/src/core/instance.ts:118-155] | — |
| `END` | Auto-completes. The root instance is complete when at least one ROOT `END` row is COMPLETED and no row is non-terminal. [src: MissionEngine/src/core/transition.ts:1178-1183] | — |
| `PARALLEL` | Auto-completes; every outgoing connection fires. | — |
| `WAIT ALL` | Join: completes when every incoming connection's source has completed. [src: MissionEngine/src/core/transition.ts:1113-1117,827-859] | `EXECUTING` |
| `WAIT ANY` | Auto-completes on arrival. | — |
| `MATH` | Auto-completing no-op (retired type, still accepted). [src: MissionEngine/src/core/transition.ts:2470-2476] | — |
| `SELECT 1` | Evaluates `select1_config`, routes by `connection_id` (§A.3.4). | — |
| `SCRIPT` | Runs `script_config.source` (§A.3.3); repeating when `script_config.repeat` is present. | `WAITING_SCRIPT` (repeating) |
| `GATE` | Cyclic condition and/or timer (§A.3.8). | `WAITING_GATE` |
| `USER_INTERACTION` | Operator screen (§A.3.6). | `WAITING_USER` |
| `YES_NO` | Operator yes/no screen (§A.3.5). | `WAITING_USER` |
| `ACTION PROXY` | Invokes an action on an action server (§A.3.9). | `WAITING_ACTION` |
| `WORKFLOW PROXY` | Runs a child workflow (§A.3.15). | `WAITING_ACTION` |
| `CATCH` | Entry of a catch network; writes the trigger info (§A.3.11). | — |
| `RETURN` | Exit of a catch network; executes `return_config` (§A.3.11). | — |

Any other string that somehow reaches activation MUST fail loudly (`engine v1: step type "<t>" is not yet supported`). [src: MissionEngine/src/core/transition.ts:2502-2508]

### A.3.2 Fields common to all steps

| Field | Type | Req. | Default | Engine meaning |
|---|---|---|---|---|
| ManagedElement fields | §A.2.1 | yes | — | |
| `step_type` | §A.3.1 | yes | — | |
| `position` | `{x:number,y:number}` (both required if present) | no | — | Diagram only. [src: workflow-schema.json:608-615; mission-control-db/src/dao/workflow-diagram.ts:139] |
| `input_parameter_specifications` | ParameterSpecification[] | no | `[]` | Resolved on every activation (§A.5.3). A step with none has NO inputs (never a previous step's). [src: MissionEngine/src/core/properties.ts:107-119; MissionEngine/src/core/transition.ts:2371] |
| `output_parameter_specifications` | OutputParameterSpecification[] | no | `[]` | Where the step's results land (per type; §A.5.3). |
| `value_property_specifications` | PropertySpecification[] | no | — | Accepted, **never read** at step level (only workflow-level ones seed the store). [src: MissionEngine/src/core/properties.ts:57-77; no other reader] |
| `resource_command_specifications` | ResourceCommandSpecification[] | no | `[]` | §A.5.6. Forbidden on GATE (§A.8). |
| `action_property_bindings` | ActionPropertyBinding[] | no | `[]` | Non-GATE steps: fetched once per activation before the step runs (§A.5.7). Ignored on a GATE. [src: MissionEngine/src/core/transition.ts:2372-2384] |
| `try_specifications` | StepTrySpecification[] | no | — | §A.3.11; only on TRY-capable types. |
| `ui_parameter_specifications` | UIParameterSpecification[] | no | — | Opaque except the `Button` entry (§A.7). |
| `form_layout_config` | FormLayoutExportEntry[] | no | — | Legacy v1 form (§A.7.3). |
| `form_document` | object | no | — | v2 form (§A.7). Not in the schema; not validated structurally. |
| `yes_no_config` | YesNoConfig | no | — | §A.3.5. |
| `button_bar`, `allow_back`, `allow_stop` | §A.3.7 | no | — | Fixed button row. |
| `script_config` | ScriptConfig | no | — | §A.3.3. |
| `gate_config` | GateConfig | no | — | §A.3.8. |
| `select1_config` | Select1Config | no | — | §A.3.4. |
| `action_proxy_config` | ActionProxyConfig | ACTION PROXY: yes | — | §A.3.9. Not in the schema. |
| `catch_id` | string, minLength 1 | CATCH | — | §A.3.11. |
| `return_config` | ReturnConfig | RETURN | — | §A.3.11. |
| `action_visibility` | `"opaque"`\|`"observable"` | no | — | Schema-validated enum; not read by the engine (visibility comes from the action server). [src: workflow-schema.json:660] |
| `connection_references` | string[] | no | — | Schema only; not read. [src: workflow-schema.json:661-664] |
| `description` | string | no | — | Not read. |

Seen in Designer exports and ignored by the engine: `form_element_images`
(`[{image_oid, filename}]`). [src: Samples/Individual Workflow Tests/Test_of_E-Signatures; no reader in MissionEngine/src]

Roles, work-center assignment and auto-claim are NOT part of the JSON. Allowed roles come from the
`workflow_allowed_role` table keyed by the node's `master_oid` chain; auto-claim from
`workflow.auto_claim` / `work_center.auto_claim`. [src: mission-control-db/src/runtime/assignments.ts:66-82,245-251; mission-control-db/src/runtime/dispatch.ts:38-43]

### A.3.3 SCRIPT — `script_config`

```json
"script_config": {
  "language": "javascript",
  "source": "output.status = Number(weight) <= Number(limit) ? 'ok' : 'over';",
  "repeat": { "cycle_seconds": 5, "time_limit_seconds": 600, "on_time_limit": "error" }
}
```

| Field | Type | Req. | Default | Meaning |
|---|---|---|---|---|
| `language` | string | no | — | Never read; the source is always JavaScript. [src: MissionEngine/src/core/step-handlers.ts:265-283] |
| `source` | string | no | — | Function body. Absent/empty = pass-through success (one-shot) or immediately done (repeating). [src: MissionEngine/src/core/step-handlers.ts:272-274,509-513] |
| `repeat` | object | no | absent = one-shot | Present = repeating SCRIPT. MUST be an object (not null/array). [src: MissionEngine/src/spec/validator.ts:384-388] |
| `repeat.cycle_seconds` | number 1..31449600 | no | `5` | Seconds between runs. [src: MissionEngine/src/core/step-handlers.ts:439,451-454; validator.ts:390-392] |
| `repeat.time_limit_seconds` | integer 1..31449600 | no | none | Deadline from `started_at`. [src: MissionEngine/src/core/step-handlers.ts:456-466; validator.ts:393-395] |
| `repeat.on_time_limit` | `"error"`\|`"complete"` | no (only with time limit) | `"error"` | `error` = fail the step (TRY-routable); `complete` = complete with outputs so far. [src: MissionEngine/src/core/step-handlers.ts:475-477; validator.ts:396-401] |

Execution contract (MUST be reproduced for script compatibility):
- The body is compiled as `Function(<input ids...>, 'output', body)` (repeating:
  `Function(<input ids...>, 'output', 'state', wrapped body)`) in a fresh `node:vm` context; each
  input parameter is a positional STRING argument named by its `id`. Consequently input ids MUST be
  valid JavaScript identifiers, or the script fails with a SyntaxError. [src: MissionEngine/src/core/step-handlers.ts:331-352,357-379]
- The inputs passed are the step's activation snapshot (`stepSnapshots[oid].inputParameters`),
  which is `getInputParameters()`: the resolved step inputs plus, as fallback, every starting
  parameter present in the in-memory store — i.e. only when the step activates in the same
  transaction as instance start (§A.5.2). [src: MissionEngine/src/core/transition.ts:2385,2493-2494; MissionEngine/src/core/properties.ts:233-245]
  A REPEATING script instead re-resolves its inputs before every run (`resolveInputParameters` +
  `getInputParameters()` + any Action-Property overlay), so each run sees the live property store
  (GATE evaluations do the same). [src: MissionEngine/src/core/repeating-script.ts:80-82; MissionEngine/src/core/gate.ts:100-102]
- Each run (one-shot, repeating run, or GATE evaluation) has a wall-clock limit of
  `SCRIPT_TIMEOUT_MS` (engine config, default `5000` ms), on a worker thread. [src: MissionEngine/src/config.ts:161; MissionEngine/src/core/step-handlers.ts:298-303]
- A repeating script whose `time_limit_seconds` has passed is not run again: `on_time_limit:'error'`
  fails it with mode `ERROR` and message `Script time limit (<duration>) reached`; `'complete'`
  records a `WARNING` trace and completes with the pending outputs. [src: MissionEngine/src/core/repeating-script.ts:49-79]
- Output commit: if the step has `output_parameter_specifications`, only keys equal to a spec `id`
  are read; each such key the script set writes `String(value)` to that spec's `target` (a key set to
  `undefined` writes `''`); specs without `target` are skipped. Without output specs every own key
  the script set to a non-undefined value is written as a property named by the key.
  [src: MissionEngine/src/core/step-handlers.ts:313-322,419-435]
- A repeating script runs until its body returns exactly `true` (`=== true`); `state` is a JSON
  object carried between runs (max 65,536 UTF-8 bytes; outputs per run also max 65,536 bytes);
  outputs are committed only when the step completes. [src: MissionEngine/src/core/step-handlers.ts:439-443,503-542]
- A throw, timeout, or unreadable result fails the step with mode `ERROR`. [src: MissionEngine/src/core/transition.ts:2494-2498]

### A.3.4 SELECT 1 — `select1_config`

```json
"select1_config": {
  "input_name": "GlobalPathPicked.Value",
  "input_value_type": "property",
  "options": [
    { "id": "311236913958748160", "label": "Global 1", "operator": "==", "value": "1", "value_type": "literal", "is_default": false },
    { "id": "311579272525381632", "label": "Default",  "operator": "==", "value": "",  "value_type": "literal", "is_default": true }
  ]
}
```

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `input_name` | string | no | `input_value_type: 'property'`: a key looked up as `inputs[input_name] ?? store.get(input_name) ?? ''` (the step's own resolved inputs win; `get` is exact-key, local then work-center-shared, NO group fallback). Otherwise the literal string itself is the value compared. [src: MissionEngine/src/core/step-handlers.ts:100-110; MissionEngine/src/core/properties.ts:157-161] |
| `input_value_type` | `"literal"`\|`"property"` | no | Absent = literal. |
| `options[]` | Select1Option[] | no | Evaluated in array order. |
| `options[].id` | string | yes (schema) | Matched against outgoing `connections[].connection_id`. |
| `options[].label` | string | yes (schema) | Not read. |
| `options[].operator` | `"=="`,`"!="`,`"<"`,`">"`,`"<="`,`">="`,`"Contains"`,`"Not Contains"` | yes | String operators: `===`, `!==`, JS string `<`/`>`/`<=`/`>=` (lexicographic, NOT numeric), `includes`, `!includes`. Unknown = false. [src: MissionEngine/src/core/step-handlers.ts:137-149] |
| `options[].value` | string | yes | Literal, or (`value_type: 'property'`) a key resolved as `inputs[value] ?? store.get(value) ?? ''`. [src: MissionEngine/src/core/step-handlers.ts:120-122] |
| `options[].value_type` | `"literal"`\|`"property"` | yes | |
| `options[].is_default` | boolean | yes | A default option is skipped during evaluation and chosen when nothing matched (the last default in the array wins). [src: MissionEngine/src/core/step-handlers.ts:114-133] |

Routing: the first matching option (else the default) yields `connectionId = option.id`; the engine
then fires only outgoing connections whose `connection_id` equals it. If no option matches and there
is no default, or `select1_config`/`options` is absent, NO routing is recorded and EVERY outgoing
connection fires. [src: MissionEngine/src/core/step-handlers.ts:95-98,129-134; MissionEngine/src/core/transition.ts:2477-2480,864-872]

### A.3.5 YES_NO — `yes_no_config`

```json
"yes_no_config": { "yes_label": "Accept", "no_label": "Re-weigh", "yes_value": "true", "no_value": "false", "default_selection": "none" }
```

All fields optional strings (`default_selection` ∈ `"yes"`,`"no"`,`"none"`). The engine NEVER reads
any of them: the object is passed verbatim to Pilot as `yesNoConfig`. [src: MissionEngine/src/spec/types.ts:195-201; mission-control-db/src/runtime/inbox.ts:339; grep: no engine reader of yes_value/no_value]

Answer and routing (MUST):
- Over REST the operator answers with `{"kind":"decision","value":"yes"|"no"}`; any other value is
  `400`. The engine turns it into `button_output = "yes"|"no"`. [src: MissionEngine/src/api/app.ts:504-512,565-567]
- Outgoing connections fire when `source_handle_id === answer`, or `answer === 'true' && source_handle_id === 'yes'`,
  or `answer === 'false' && source_handle_id === 'no'`, or `condition.toLowerCase() === answer.toLowerCase()`.
  Connections with neither a matching handle nor a matching condition do NOT fire (unconditional
  connections are excluded). If nothing matches, no successor fires. [src: MissionEngine/src/core/transition.ts:874-887; MissionEngine/src/core/step-handlers.ts:158-167]
- Designer writes `source_handle_id: "yes"` / `"no"`. [src: Samples Test_of_E-Signatures connections]
- Form values sent with the decision are captured like USER_INTERACTION (§A.7.2); the answer itself
  is never written to any output parameter. [src: MissionEngine/src/core/step-handlers.ts:158-167]

### A.3.6 USER_INTERACTION

No dedicated config object; the form is `form_document` (or legacy `form_layout_config`) (§A.7),
with `ui_parameter_specifications` for the completion-button label.
- Completion over REST is `{"kind":"submit","values":{...}}` or `{"kind":"complete"}` (same as an
  empty submit). [src: MissionEngine/src/api/app.ts:488-495,565-567]
- Over REST no button value is ever transmitted for a USER_INTERACTION, so no routing is recorded
  and EVERY outgoing connection fires; `condition` on its outgoing connections is ignored. (Only the
  conformance harness's `button_press` action routes a USER_INTERACTION by `condition`.)
  [src: MissionEngine/src/api/app.ts:565-567; MissionEngine/src/core/step-handlers.ts:169-181; MissionEngine/src/core/submit.ts:290-292]

### A.3.7 Fixed button row — `button_bar`, `allow_back`, `allow_stop`

```json
"button_bar": { "format": "fixed", "size": "lg", "color": "#3b82f6", "yes_color": "#22c55e", "no_color": "#ef4444" },
"allow_back": true,
"allow_stop": true
```

| Field | Type | Meaning |
|---|---|---|
| `button_bar.format` | const `"fixed"` | Required for the bar to exist; any other value fails validation (`MISSING_REQUIRED_FIELD`, `must be equal to constant`). Absent `button_bar` = legacy in-form buttons. [src: workflow-schema.json:641-650; verified] |
| `button_bar.size`, `.color`, `.yes_color`, `.no_color` | string | Opaque styling; passed to Pilot as `buttonBar: {size,color,yesColor,noColor}` (non-strings dropped). [src: mission-control-db/src/runtime/inbox.ts:52-61] |
| `allow_back` | boolean | Back is offered/accepted only when `button_bar.format === 'fixed'` AND `allow_back === true` AND the step is USER_INTERACTION/YES_NO AND a back target is recorded and that target step is a COMPLETED screen; else `409 BACK_NOT_ALLOWED`. [src: MissionEngine/src/core/go-back.ts:36-38,67-76; mission-control-db/src/runtime/inbox.ts:343] |
| `allow_stop` | boolean | Stop from Pilot only when `button_bar.format === 'fixed'` AND `allow_stop === true`; else `409 STOP_NOT_ALLOWED`. [src: MissionEngine/src/api/app.ts:611-613] |

Button text is not in `button_bar`: it stays in the `Button` UI parameter (USER_INTERACTION) and
`yes_no_config` labels (YES_NO). [src: MissionEngine/src/spec/types.ts:463-465]
Back targets: a screen hands its own oid to its successors; automated steps pass on the target they
were given; `START`, `PARALLEL`, `WAIT ALL`, `WAIT ANY`, `WORKFLOW PROXY`, and any step that routed
down more than one connection clear it. [src: MissionEngine/src/core/back-target.ts:21-31]

### A.3.8 GATE — `gate_config`

| Field | Type | Req. | Default | Meaning |
|---|---|---|---|---|
| `cycle_seconds` | number 1..31449600 | no | `5` | Re-evaluation interval. [src: MissionEngine/src/core/step-handlers.ts:544-549; validator.ts:335-338] |
| `language` | string | no | — | Not read. |
| `source` | string | no | — | Body compiled as `Function(<input ids...>, body)`; truthy return = open. No source = open immediately. No `output` object. [src: MissionEngine/src/core/step-handlers.ts:381-390,622-636] |
| `action_property_bindings` | ActionPropertyBinding[] | no | `[]` | Re-fetched before every evaluation (not for `timer`). [src: MissionEngine/src/core/step-handlers.ts:587-591] |
| `control_previous_action` | boolean | no | false | Only `=== true` arms the gate concurrently with a preceding ACTION PROXY whose single outgoing connection leads to this gate; on open the action is STOPped. [src: MissionEngine/src/core/transition.ts:2448-2465] |
| `mode` | `"condition"`,`"timer"`,`"condition_or_timer"` | no | `"condition"` | `timer` opens after `delay_seconds` and never runs the script; `condition_or_timer` opens on whichever first. Unknown values at runtime = condition (validator rejects them). [src: MissionEngine/src/core/step-handlers.ts:551-558] |
| `delay_seconds` | integer 1..31449600 | required iff timed mode | — | Deadline = activation (or arming) time + delay. [src: MissionEngine/src/core/step-handlers.ts:562-567; validator.ts:345-355] |

Step-level `action_property_bindings` on a GATE are ignored (warning). A GATE MUST NOT declare
resource commands. Exactly 1 incoming and 1 outgoing connection. (§A.8.) [src: MissionEngine/src/spec/validator.ts:322-373,424-431]

### A.3.9 ACTION PROXY — `action_proxy_config`

```json
"action_proxy_config": { "action_oid": "a3c1", "environment_oid": "e7f2", "action_name": "Preheat Oven", "environment_name": "Kitchen", "timeout_ms": 600000 }
```

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `action_oid` | string | yes (non-empty) | Roster oid in the environment's `included_actions` (`action_oid ?? oid`). [src: MissionEngine/src/spec/validator.ts:503-507; MissionEngine/src/loop.ts:415] |
| `environment_oid` | string | yes (non-empty) | Embedded environment oid; also the work-center binding key fallback. [src: MissionEngine/src/loop.ts:401,424] |
| `action_name` | string | no | Fallback name when the roster lookup misses; used for loose matching. [src: MissionEngine/src/loop.ts:415-416] |
| `environment_name` | string | no | Fallback: when no embedded env has `environment_oid`, the env whose `local_id` equals this name (owner spec first, then root) is used; 0 matches or >1 matches fail the step (`package resolution: ...`). [src: MissionEngine/src/loop.ts:401-413,357-362] |
| `timeout_ms` | number | no | Deadline from invoke time; on expiry the engine ABORTs the action and fails the step with mode `TIMEOUT`. Absent = no limit. Sent to the server as `timeoutMs`. [src: MissionEngine/src/loop.ts:418-440,494-505] |

- The action server URI is NEVER taken from the JSON; it comes from the work center's environment
  binding (`bindingLookup(workCenterId, envOid)`). [src: MissionEngine/src/actions/invoker.ts:106-111; MissionEngine/src/core/property-overlay.ts:59]
- Input sent: every entry of the activation snapshot as `{name, value}` (step inputs, plus starting
  parameters when activated in the instance-start transaction — §A.5.2); `declaredInputNames` (the
  step's own input ids) is used only for loose matching. [src: MissionEngine/src/loop.ts:388-390,418-423]
- Outputs: each `output_parameter_specifications[]` with a `target` takes the server output whose
  `name === spec.id`; a dotted target (`Result.Code`) gets the raw value; a bare target that holds a
  `[{"name","value"}...]` JSON list is also exploded into `target.<name>` entries.
  [src: MissionEngine/src/actions/monitor.ts:206-218; MissionEngine/src/core/properties.ts:187-194]

### A.3.10 PARALLEL / WAIT ALL / WAIT ANY

No config objects. PARALLEL fires every outgoing connection; every PARALLEL MUST reach a `WAIT ALL`
downstream (§A.8). WAIT ALL expects one arrival per incoming connection. [src: MissionEngine/src/spec/validator.ts:160-201; MissionEngine/src/core/transition.ts:827-859]

### A.3.11 TRY / CATCH / RETURN

TRY row (step-level `StepTrySpecification` / workflow-level `WorkflowTrySpecification`):

| Field | Type | Req. | Default | Meaning |
|---|---|---|---|---|
| `mode` | step: `"ERROR"`,`"ABORT"`,`"TIMEOUT"`; workflow: those + `"OPERATOR_STOP"`,`"OPERATOR_ABORT"` | yes | — | Failure mode handled; at most one row per mode. [src: MissionEngine/src/spec/types.ts:424-444; validator.ts:215-217] |
| `catch_id` | string, minLength 1 | yes | — | Must equal a CATCH step's `catch_id` in the same spec. [src: MissionEngine/src/spec/validator.ts:283-299] |
| `release_on_catch` | boolean | no | `true` | Absent or true: the failing step's own resource commands are released when the catch fires. [src: MissionEngine/src/core/transition.ts:2070-2078] |

- Step-level rows are allowed only on canonical types `ACTION PROXY`, `SCRIPT`, `USER_INTERACTION`,
  `YES_NO`, `WORKFLOW PROXY`, `GATE`. [src: MissionEngine/src/spec/validator.ts:214,233-237]
- Lookup order on failure: the failing step's row for the mode, then the owning spec's
  workflow-level row (skipped inside an operator cleanup). [src: MissionEngine/src/core/transition.ts:2026-2031]

CATCH: carries `catch_id` (non-empty string, unique among CATCH steps), 0 incoming and exactly 1
outgoing connection. When activated it writes trigger info into its own output targets by output
`id`: `Message` (error message or ''), `Reason` (the mode string), `Step` (failing step `local_id`),
`StepID` (failing step oid); other ids are ignored. A catch network is the set of steps reachable
from a CATCH with a non-empty `catch_id` that contains a RETURN. [src: MissionEngine/src/core/step-handlers.ts:638-656; MissionEngine/src/spec/catch-network.ts:25-67]

RETURN: 1 incoming, 0 outgoing connections, and:

```json
"return_config": { "command": "GOTO", "restart_mode": "CLEAN", "goto_step_oid": "7000000000011" }
```

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `command` | `"ABANDON"`,`"RESTART"`,`"GOTO"`,`"RETRY"`,`"COMPLETE"` | yes | ABANDON = abort (root) / abort the branch (child); RESTART = restart the workflow; GOTO = continue at `goto_step_oid`; RETRY = re-run the failing step; COMPLETE = treat the failing step as completed. [src: MissionEngine/src/core/transition.ts:1832-1852] |
| `restart_mode` | `"CLEAN"`,`"KEEP"` | required for RESTART | CLEAN re-initialises properties; KEEP keeps them (runtime default `KEEP` if absent). [src: MissionEngine/src/core/transition.ts:1841] |
| `goto_step_oid` | string | required for GOTO | Must name a step of the same spec outside every catch network. |

- During an operator cleanup (OPERATOR_STOP / OPERATOR_ABORT network, root only), ANY RETURN of the
  operator CATCH's network ends the cleanup regardless of `command`; a RETURN of a nested catch inside
  the cleanup whose command would leave it (ABANDON, RESTART, or a GOTO to a step outside the cleanup)
  also ends the cleanup instead. [src: MissionEngine/src/core/transition.ts:1808-1830]
- Runtime guard (child specs are not validated): a RETURN with missing/unknown `command`, or a GOTO
  whose target is not a step of its own spec, errors the RETURN step (`RETURN has no return_config` /
  `RETURN has unknown command '<c>'` / `RETURN GOTO target not found: '<oid>'`). [src: MissionEngine/src/core/transition.ts:1790-1799]
- Designer exports an untouched RETURN as `{"command":"ABANDON"}`. [src: MissionDesigner/src/lib/packageFormat/step-extractors.ts:302-306]

### A.3.12 START / END

No config. Exactly one START (root); at least one END (root).

### A.3.13 Resource ACQUIRE/RELEASE

There is no ACQUIRE/RELEASE step type: resource commands ride on any step (except GATE) in
`resource_command_specifications` (§A.5.6). Acquire-type commands run before the step activates (the
step waits `blockedOnResources` until granted); Release-type commands run when the step completes.

### A.3.14 E-signature

The e-signature is a block in `form_document` (`type: "esignature"`, §A.7.1). If the frozen step's
form_document contains one, `submit` requires `signature: {loginName, password}` for every kind except
a YES_NO `no` decision; the first esignature block in document order is the one used.
[src: MissionEngine/src/api/app.ts:529-558; MissionEngine/src/core/esignature.ts:36-63]

### A.3.15 WORKFLOW PROXY (sub-workflow)

- Child = first `children[]` entry of the containing spec with `local_id === step.local_id`. [src: MissionEngine/src/core/transition.ts:2552]
- Child starting parameters: for each child `starting_parameter_specifications[].id` that equals one
  of the proxy step's `input_parameter_specifications[].id`, the value is the proxy step's RESOLVED
  input (falling back to its `default_value`). [src: MissionEngine/src/core/transition.ts:2558-2569]
- Child property store seed order: child's own `value_property_specifications`, then a COPY of the
  parent's whole flat local store, then the child's starting parameters. [src: MissionEngine/src/core/transition.ts:2600-2603]
- Child workflow-scoped resources are registered under `<child oid>:<name>`. [src: MissionEngine/src/core/transition.ts:2623-2629]
- On child completion: for each child `output_parameter_specifications[].id` that equals a proxy-step
  output `id` with a `target`, the engine writes the child's flat property NAMED BY THE OUTPUT ID
  (not its target; missing = '') to the proxy output's `target`. [src: MissionEngine/src/core/transition.ts:2711-2720]

---

## A.4 WorkflowConnection

```json
{ "from_step_id": "rt_3", "to_step_id": "rt_4", "connection_id": "opt-1", "source_handle_id": "yes", "condition": "Yes", "waypoints": [ { "x": 70, "y": 0 } ] }
```

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `from_step_id` | string | yes | Source step oid (must exist; ≠ `to_step_id`). [src: MissionEngine/src/spec/validator.ts:69-74,114-131] |
| `to_step_id` | string | yes | Target step oid. |
| `connection_id` | string | no | SELECT 1 routing key: must equal a `select1_config.options[].id`. [src: MissionEngine/src/core/transition.ts:869-872] |
| `source_handle_id` | string | no | YES_NO routing key (`"yes"`/`"no"`); Designer also writes the option id on SELECT 1 edges (not read for SELECT 1). [src: MissionEngine/src/core/transition.ts:874-884] |
| `condition` | string | no | A LITERAL label, never an expression. Compared to the YES_NO answer (case-insensitive) and to a harness button value (exact or case-insensitive). No expression syntax is parsed or evaluated anywhere. [src: MissionEngine/src/core/transition.ts:878-896] |
| `waypoints` | `[{x:number,y:number}]` | no | Diagram only. [src: mission-control-db/src/dao/workflow-diagram.ts:159] |

Routing algorithm per completed step, given its recorded routing context R (MUST):
[src: MissionEngine/src/core/transition.ts:864-900]
1. No R: fire every outgoing connection (START, END, PARALLEL, WAIT ANY, MATH, SCRIPT, GATE, CATCH, ACTION PROXY, WORKFLOW PROXY, USER_INTERACTION via REST, unmatched SELECT 1).
2. R.connectionId (SELECT 1): fire connections with `connection_id === R.connectionId`.
3. R.sourceHandleId (YES_NO): the YES_NO matching rule of §A.3.5.
4. R.conditionValue only (USER_INTERACTION button press, harness only): fire connections with no
   `condition`, or `condition === value`, or case-insensitively equal.
R is stored only when the submitted action yields a truthy `conditionValue` or `connectionId`; an
empty answer stores nothing (rule 1 applies). [src: MissionEngine/src/core/submit.ts:290-292]

Cycles are allowed (loops re-enter COMPLETED steps). [src: MissionEngine/src/core/transition.ts:902-913]

---

## A.5 Parameters, properties, resources, bindings

### A.5.1 Value model

The engine has no typed values: every property, parameter, form capture and action input/output is a
STRING. Structured values are JSON text: a whole Value Property reads as
`[{"name":"<entry>","value":"<v>"},...]`, a checkbox capture as a JSON array.
[src: MissionEngine/src/core/properties.ts:39-41,135-155,225-229]

The only "value type" enums in the JSON:
- `value_type` (ParameterSpecification, Select1Option): `"literal"` | `"property"`; absent = literal. [src: MissionEngine/src/spec/types.ts:276,208]
- `defaultSource.mode` / `placeholderSource.mode` (form blocks): `"static"` | `"property"` | `"parameter"` | `"input"` — opaque to the engine (Pilot applies them). [src: MissionEngine/src/spec/types.ts:33-36; resolveDefault has no production caller]
- `listSource.mode`: `"static"` | `"input"` (applied by the inbox, §A.7.1). [src: MissionEngine/src/spec/types.ts:56-59]
- `json_schema` (string) on parameters: accepted, never read. Designer "Value Types"
  (`value_type_specifications`) are never read.

Property-key syntax (used by `default_value` with `value_type:'property'`, `target`, `source`,
`amount_property`, `input_name`): `"Name"` or `"Name.Entry"` — split on the FIRST `.`; the entry name
may itself contain dots. [src: MissionEngine/src/core/shared-properties.ts:27-32; MissionEngine/src/core/properties.ts:163-182]

Resolution of a key K (`resolveKey`), MUST be: [src: MissionEngine/src/core/properties.ts:135-155]
1. exact local key K; 2. exact work-center-shared key K;
3. group: merge every shared then local entry `K.<name>` (local wins per name), EXCLUDING any entry
   whose name is `description` case-insensitively, serialised as `[{"name","value"}...]`;
4. else `''`.

### A.5.2 Starting parameters (`starting_parameter_specifications`)

ParameterSpecification shape (§A.5.3). At instance start, for each spec in order: if
`starting_params` has the key, that string is used verbatim (no resolution); else `default_value`,
resolved through §A.5.1 when `value_type === 'property'`. Each value is also written to the
property store under its `id`. Keys of `starting_params` that match no spec `id` are ignored.
Without any `starting_parameter_specifications` nothing is seeded, whatever `starting_params` holds. [src: MissionEngine/src/core/properties.ts:85-105; MissionEngine/src/core/instance.ts:76-79]
The separate starting-parameter map is NOT persisted: it exists only in the transaction that starts
the instance (and, for a child, the one that activates the proxy). [src: MissionEngine/src/core/properties.ts:277-286; MissionEngine/src/core/context.ts:482-485]

### A.5.3 InputParameter / OutputParameter

InputParameter (`ParameterSpecification`):

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | yes | Name of the input (script local, action input name, `{{id}}` token, binding target). |
| `oid` | string | no | Not read. |
| `description` | string | no | Not read. |
| `default_value` | string | yes | Literal value, or the property key when `value_type === 'property'`. [src: MissionEngine/src/core/properties.ts:112-118] |
| `value_type` | `"literal"`\|`"property"` | no | Absent = literal. |
| `json_schema` | string | no | Not read. |
| `entries` | `[{name,value}]` | no | Not read. |

Step input resolution on every activation: clear inputs; each spec resolves to `default_value` or
`resolveKey(default_value)`; then Action-Property overlay (§A.5.7) replaces by `parameter_id`.
The snapshot stored for the step is `getInputParameters()` = inputs + (fallback) in-memory starting
parameters. [src: MissionEngine/src/core/properties.ts:107-126,233-245; MissionEngine/src/core/transition.ts:2371-2385]
Literal values are not template-expanded.

OutputParameter (`OutputParameterSpecification`):

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | yes | The producer's output name (script `output.<id>`, action output `name`, form `outputParameter`, CATCH field, child output). |
| `target` | string | no | Property key written. Missing target: SCRIPT/ACTION/CATCH/child skip the output; a form capture writes under the `outputParameter` string itself. [src: MissionEngine/src/core/step-handlers.ts:426,653; MissionEngine/src/actions/monitor.ts:209; MissionEngine/src/core/properties.ts:222-223] |
| `oid`, `description`, `entries` | | no | Not read. |

Workflow outputs (root): value = `resolveFlatKey(props, target || id) ?? props[id] ?? ''`, recorded in
runtime history as `[{name: id, value}]`. [src: mission-control-db/src/runtime/workflow-outputs.ts:41-54]

### A.5.4 ValueProperty (`PropertySpecification`)

```json
{ "name": "Batch", "oid": "x", "entries": [ { "name": "Weight", "value": "" } ] }
```
`name` (string, required), `entries` (array of `{name:string, value:string}`, required by schema),
`oid` optional. Workflow-level ones seed the store as `"<name>.<entry>" = value` and mark `<name>` as
declared locally (writes to it never go to the work-center-shared tier). Step-level and
environment-level `value_property_specifications` in the JSON are not read (environment values come
from the work-center registry table, populated outside the engine). [src: MissionEngine/src/core/properties.ts:57-77,163-182; MissionEngine/src/core/context.ts:18,718; workflow-schema.json:97-108]

### A.5.5 ResourceProperty (`ResourcePropertySpecification`)

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `name` | string | yes | Resource name. |
| `resource_type` | `"binary exclusive use"`,`"binary shared use with pool limits"`,`"countable use with pool limits"`,`"named pool"`,`"sync"` | yes | [src: workflow-schema.json:488-512] |
| `scope` | `"workflow"`,`"environment"` | no | On a workflow, `environment` means "not registered locally". Default effectively `workflow`. [src: MissionEngine/src/core/instance.ts:95-100; MissionEngine/src/spec/validator.ts:558] |
| `use_limit` | number | required > 0 for the two pool-limit types (workflow-level resources only) | Capacity. [src: MissionEngine/src/spec/validator.ts:682-687] |
| `names` | string[] | required non-empty for `named pool` (workflow-level resources only) | Slot names. [src: MissionEngine/src/spec/validator.ts:676-681] |
| `description` | string | no | Not read. |

The `use_limit` / `names` shape rules (`INVALID_RESOURCE_SPEC`) run only on the
`resource_property_specifications` of the root and of every child workflow, NOT on an embedded
environment's: an environment `named pool` without `names`, or a countable environment resource
without `use_limit`, validates (verified). (Environment resources are hydrated from the work-center
registry at runtime.) [src: MissionEngine/src/spec/validator.ts:672-700; verified]
Designer exports every embedded-environment resource with `scope: "environment"`. [src: MissionDesigner/src/lib/packageFormat/library-exporters.ts:199-215]

### A.5.6 ResourceCommand (`ResourceCommandSpecification`)

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `command_type` | `"Acquire"`,`"Release"`,`"Acquire Pool Amount"`,`"Release Pool Amount"`,`"Send"`,`"Receive"`,`"Synchronize"` | yes | Activation commands: Acquire, Acquire Pool Amount, Send, Receive, Synchronize; completion commands: Release, Release Pool Amount. [src: MissionEngine/src/core/resources.ts:656-675] |
| `resource_name` | string | yes | |
| `resource_source_oid` | string | no | Owner: a workflow oid (root/child) or an embedded environment oid. Default = the owning spec's oid, applied ONLY when the key is absent (`??`): an empty string `""` is NOT defaulted and fails `INVALID_RESOURCE_COMMAND` (`resource_source_oid "" does not match any workflow or environment in this package`, verified). Designer writes `""` when it cannot resolve the resource's source. Environment iff it names an embedded environment, or `resource_source_type === 'environment'` and an embedded environment declares that name. [src: MissionEngine/src/core/env-scope.ts:78-91; MissionEngine/src/core/transition.ts:81-83; MissionEngine/src/spec/validator.ts:603; MissionDesigner/src/lib/packageFormat/workflow-exporters.ts:333-334] |
| `resource_source_type` | `"workflow"`,`"environment"` | no | Advisory (see above). |
| `amount` | number | Pool Amount: > 0 unless `amount_property` | Count. Undefined = 1. [src: MissionEngine/src/core/transition.ts:118-127] |
| `amount_property` | non-empty string | no | Pool Amount only: property key whose value (decimal whole number ≥ 1) is the count; wins over `amount`. Acquire reads it once at the fresh attempt; Release reads it when run. A bad value fails the Acquire step (`ERROR`) / records an `ERRORED` trace and releases nothing for the Release. [src: MissionEngine/src/core/transition.ts:94-116,368-394,424-435] |
| `target` | string | no | Acquire on named pool: property receiving the granted name; Release on named pool: property holding the name; Receive: property receiving the data (also exploded if a group list). [src: MissionEngine/src/core/transition.ts:304-327,444] |
| `source` | string | no | Send: property key whose `resolveKey` value is sent. [src: MissionEngine/src/core/transition.ts:316-318] |
| `oid` | string | no | Only a bookkeeping key. [src: MissionEngine/src/core/transition.ts:102-104] |

Order: activation commands run sync commands first, then by `resource_name` (`localeCompare`);
completion commands by `resource_name`. [src: MissionEngine/src/core/resources.ts:677-686; MissionEngine/src/core/transition.ts:413-414]

### A.5.7 Action-Property bindings (`ActionPropertyBinding`)

```json
{ "parameter_id": "temperature", "environment_oid": "e7f2", "environment_name": "Kitchen", "property": "Oven.Temperature" }
```

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `parameter_id` | string | yes | The step input id overwritten with the fetched value. |
| `environment_oid` | string | no | Env lookup by oid first (owner spec, then root). |
| `environment_name` | string | no | Else the unique env whose `local_id` matches (owner scope first, then root; >1 match in the winning scope = unresolved). |
| `property` | string | yes | `"Group.Entry"` (split at first `.`) = one entry's value; `"Group"` = JSON list of all entries except `description` (case-insensitive). |

Binding key: the resolved embedded env's `oid`; if neither oid nor name resolves, the raw
`environment_oid` is STILL used as the work-center binding key (only a binding with neither
resolvable env nor `environment_oid` fails with `no resolvable environment`).
[src: MissionEngine/src/core/property-overlay.ts:50-59]
The engine fetches each group once per activation from the action server bound to the env and fails
the step (mode `ERROR`, TRY-routable) on any miss (no binding, fetch error, missing entry). Home: GATE -> `gate_config.action_property_bindings`
(every cycle); every other step -> step-level `action_property_bindings` (once, the step parks
`WAITING_PROPERTIES` while fetching). [src: MissionEngine/src/core/property-overlay.ts:35-83; MissionEngine/src/core/input-bindings.ts:92-128]

---

## A.6 EnvironmentSpecification (embedded)

| Field | Type | Req. (schema) | Engine use |
|---|---|---|---|
| ManagedElement fields | | yes | `oid` = environment identity; `local_id` = environment name (name fallback, loose matching). [src: MissionEngine/src/loop.ts:357-362,414] |
| `included_actions` | array | **yes** | Roster. Each entry: `action_name` (required, string), `action_library` (required, string), roster oid `action_oid` or `oid` (read as `action_oid ?? oid`), other fields ignored. [src: workflow-schema.json:546-568,597; MissionEngine/src/spec/validator.ts:485-492] |
| `action_server_specifications` | `[{name, uri, connection_type, description?}]` | no | `name`, `uri`, `connection_type` required by schema; `connection_type` MUST be `"REST"`; `uri` may be blank; a non-blank `uri` MUST pass the http(s) scheme check. The URI is never used for dispatch. [src: workflow-schema.json:27-36; MissionEngine/src/spec/validator.ts:952-974] |
| `resource_property_specifications` | array | no | Environment resources (shared per work center; locked/hydrated from the registry). [src: MissionEngine/src/core/env-scope.ts:47-58] |
| `value_property_specifications`, `action_property_specifications` | PropertySpecification[] | no | Not read by the engine from the JSON. |
| `library_name`, `library_oid`, `state`, `description` | | no | Not read. |
| `action_server_specifications[].api_key` | string | no | Emitted by Designer (from the library's server entry); in neither the schema nor `types.ts`; never read by the engine (extra field, validates). [src: MissionDesigner/src/lib/packageFormat/library-exporters.ts:219-231; no reader in MissionEngine/src; verified] |
| `value_type_specifications` | array | no | Designer emits it only in library packages (`includeValueTypes`), not in workflow runtime packages; never read. [src: MissionDesigner/src/lib/packageFormat/library-exporters.ts:234,269] |

Designer's `included_actions[]` entries carry, besides `action_library`/`action_name`, the inlined
action body when it resolved: `local_id`, `oid` (the roster oid the engine reads), `description`,
`version`, `last_modified_date`, `input_parameter_specifications`, `output_parameter_specifications`,
`property_specifications`, `action_visibility`. The engine reads only `action_oid ?? oid` and
`action_name`, but the schema validates the nested `input_parameter_specifications` as
ParameterSpecification (`id`, `default_value` required) and `output_parameter_specifications` as
OutputParameterSpecification (`id` required). An unresolved entry has no `oid`.
[src: MissionDesigner/src/lib/packageFormat/library-exporters.ts:239-266; workflow-schema.json:546-568]

---

## A.7 form_document (what the engine reads)

The engine does not validate `form_document` structurally. It reads only `sections[].rows[].blocks[]`,
tolerating any malformed level. [src: MissionEngine/src/core/step-handlers.ts:63-89; MissionEngine/src/spec/validator.ts:784-816]

### A.7.1 Blocks read

| Block field | Read by | Use |
|---|---|---|
| `fieldName` (non-empty string) | engine | Only blocks with a non-empty `fieldName` take part in capture; `type` defaults to `textInput` if missing. [src: MissionEngine/src/core/step-handlers.ts:75-85] |
| `outputParameter` | engine | Capture binding (§A.7.2). |
| `label` | engine | Warning text only. |
| `type` | engine | `textInput`/`textarea`/`checkbox`/`radio`/`esignature` without `outputParameter` -> `UNBOUND_FORM_INPUT` warning; `esignature` -> signature gate. [src: MissionEngine/src/spec/validator.ts:729-735] |
| esignature: `fieldName`, `label`, `meaning`, `roleName` (trimmed; blank = none), `requireDifferentUser` (`=== true`), `outputParameter` | engine | First esignature block; on a verified signature the signer's display name is written into `form_values[fieldName]` before capture. [src: MissionEngine/src/core/esignature.ts:36-63; MissionEngine/src/core/submit.ts:184-186] |
| `text`/`header` `content` (string) | inbox (engine `/api/inbox`) | `{{Name}}` tokens replaced by HTML-escaped step input values (exact name; unknown tokens left as is; one pass). [src: mission-control-db/src/runtime/inbox.ts:170-213] |
| `listSource: {mode:'input', value}` | inbox | Replaces `listItems` (textInput) or `options` (checkbox/radio) with the elements of the named input's JSON list. [src: mission-control-db/src/runtime/inbox.ts:120-136,189-198] |
| `button` with `outputValue: 'continue'` and non-blank `label` | inbox | Fallback for `continueLabel`. [src: mission-control-db/src/runtime/inbox.ts:84-99] |
| `image` `src` | images route | Bare filename served from `workflow_image` by (workflow, filename); `imageOid` not used. [src: MissionEngine/src/api/app.ts:242-263] |

Everything else (layout, sizes, colours, jobs, `defaultSource`, `placeholderSource`, `required`,
`inputMode`, timers, footer sections, `version`) is opaque and passed verbatim (after the
substitutions above) to Pilot as `formDocument`. [src: mission-control-db/src/runtime/inbox.ts:338]

`ui_parameter_specifications` (`[{type, value, value2?, oid?, font_size?, color?, lines?, align?}]`,
`type` and `value` required by schema) is opaque except: the FIRST entry with `type === 'Button'`
gives Pilot's `continueLabel` if its `value` is non-blank after trimming; if that first entry's value is
blank, later `Button` entries are NOT consulted and the `button`/`continue` block fallback applies.
Designer always writes `oid` on each entry. [src: workflow-schema.json:474-487; mission-control-db/src/runtime/inbox.ts:84-99; MissionDesigner/src/lib/packageFormat/step-extractors.ts:91-100]

### A.7.2 Capture rule (submit)

For each form element E with a truthy `outputParameter` and a `fieldName`, if
`form_values[E.fieldName] !== undefined`: key = `target` of the output spec whose `id ===
E.outputParameter` (if that spec has a target) else `E.outputParameter`; value = `JSON.stringify(v)`
for arrays, else `String(v)`. [src: MissionEngine/src/core/properties.ts:208-231]
Precedence: if `form_layout_config` is present (ANY truthy value, including `[]`), it is used and
`form_document` is ignored for capture. [src: MissionEngine/src/core/step-handlers.ts:45-62]
The submitted values are also kept verbatim for a later Back prefill. [src: MissionEngine/src/core/submit.ts:261-264]

### A.7.3 Legacy `form_layout_config`

Array of `{deviceType: "phone"|"tablet"|"desktop", canvasWidth, canvasHeight, elements[]}` (all
required). Only `[0].elements` is used. Element types: `button`, `text`, `header`, `textInput`,
`textarea`, `image`, `video`, `checkbox`, `radio`, `divider`, `timer`; each requires numeric
`x,y,width,height`; text/header `content` MUST be an object `{content, plainText}`. An element
with an unknown `type` or a wrong-typed field (e.g. a string `content`) gives
`INVALID_FORM_ELEMENT_TYPE` (`Invalid form element at /steps/<i>/form_layout_config/<k>/elements/<j>`),
but an element MISSING one of `x`,`y`,`width`,`height` gives `MISSING_REQUIRED_FIELD`
(`Missing required field: x at /steps/<i>/form_layout_config/<k>/elements/<j>`), because ajv
reports the branch `required` errors before the `oneOf` error and the `required` mapping matches
first. Every other per-type `required` list is relaxed to `["type"]`. [src: workflow-schema.json:142-373; MissionEngine/src/spec/validator.ts:845-867,925-940; verified]
- The `UNBOUND_FORM_INPUT` warning walk checks EVERY layout entry (all devices), while capture uses
  only `[0]`. [src: MissionEngine/src/spec/validator.ts:746-767; MissionEngine/src/core/step-handlers.ts:49-52]
- Pilot never receives a v1 form: the inbox passes only `form_document` (as `formDocument`), so a
  step with only `form_layout_config` shows no form fields in Pilot. Current Designer never exports
  `form_layout_config` (import-only legacy field). [src: mission-control-db/src/runtime/inbox.ts:338; MissionDesigner/src/lib/packageFormat/image-collectors.ts:49; MissionDesigner/src/lib/packageFormat/export-types.ts:395-397]

---

## A.8 Validation

### A.8.1 Result shape

```json
{ "valid": false, "error_code": "NO_END_STEP", "error_message": "No END step found" }
{ "valid": true, "warnings": [ { "code": "UNBOUND_FORM_INPUT", "message": "..." } ] }
{ "valid": true }
```
Only the FIRST error is reported. `warnings` is present only on a valid result and only when
non-empty. All error codes are fatal; all warning codes are non-fatal. [src: MissionEngine/src/spec/types.ts:550-561; MissionEngine/src/spec/validator.ts:976-1027]

### A.8.2 Phase order

0 pre-structural -> A semantic graph -> A1.5 TRY/CATCH -> A1.6 GATE -> A1.7 SCRIPT -> A2 ACTION
PROXY -> A2.5 server URI -> A3 resources -> (warnings computed) -> B JSON Schema. Warnings are
discarded if phase B fails. [src: MissionEngine/src/spec/validator.ts:976-1027]
A `null` root makes the validator throw (TypeError), not return a result. [src: MissionEngine/src/spec/validator.ts:39]

### A.8.3 Fatal rules (exact codes and messages)

`(step X)` suffix = ` (step <oid>)`. [src: MissionEngine/src/spec/validator.ts:206-207]

| Phase | Code | Condition | Message |
|---|---|---|---|
| 0 | `MISSING_REQUIRED_FIELD` | `steps` not array | `Missing steps array` [validator.ts:42-44] |
| 0 | `MISSING_REQUIRED_FIELD` | `connections` not array | `Missing connections array` [validator.ts:45-47] |
| 0 | `MISSING_REQUIRED_FIELD` | step not an object | `Invalid step entry` [validator.ts:51-53] |
| 0 | `MISSING_REQUIRED_FIELD` | step lacks key | `Step missing required field: <local_id\|oid\|version\|last_modified_date\|step_type>` [validator.ts:54-61] |
| 0 | `MISSING_REQUIRED_FIELD` | connection not object / lacks key | `Invalid connection entry` / `Connection missing from_step_id` / `Connection missing to_step_id` [validator.ts:65-74] |
| A | `DUPLICATE_STEP_OID` | repeated step oid | `Duplicate step OID: <oid>` [validator.ts:86-93] |
| A | `NO_START_STEP` | 0 START | `No START step found` [validator.ts:104-106] |
| A | `MULTIPLE_START_STEPS` | >1 START | `Multiple START steps found` [validator.ts:107-109] |
| A | `NO_END_STEP` | 0 END | `No END step found` [validator.ts:110-112] |
| A | `DANGLING_CONNECTION` | unknown from/to | `Connection references non-existent step: <oid>` [validator.ts:115-124] |
| A | `SELF_REFERENCING_CONNECTION` | from == to | `Self-referencing connection on step: <oid>` [validator.ts:127-131] |
| A | `ORPHANED_STEP` | not BFS-reachable from START and not in a catch network | `Step <oid> is not reachable from START` [validator.ts:133-158] |
| A | `UNMATCHED_PARALLEL` | no WAIT ALL reachable (BFS stops at END) | `PARALLEL step <oid> has no matching WAIT ALL` [validator.ts:160-201] |
| A1.5 | `CATCH_WRONG_DEGREE` | CATCH not 0-in/1-out | `CATCH must have 0 incoming and 1 outgoing connection (has <i> in, <o> out) (step X)` [validator.ts:226-228] |
| A1.5 | `RETURN_WRONG_DEGREE` | RETURN not 1-in/0-out | `RETURN must have 1 incoming and 0 outgoing connections (has <i> in, <o> out) (step X)` [validator.ts:229-231] |
| A1.5 | `TRY_ON_INVALID_STEP` | non-empty step TRY on other type | `try_specifications not allowed on step_type '<type>' (step X)` (type shown with spaces) [validator.ts:234-237] |
| A1.5 | `INVALID_TRY_MODE` | step mode ∉ ERROR/ABORT/TIMEOUT | `invalid try mode '<m>' (step X)` [validator.ts:240] |
| A1.5 | `DUPLICATE_TRY_MODE` | repeated step mode | `mode '<m>' appears more than once (step X)` [validator.ts:241] |
| A1.5 | `INVALID_RETURN_COMMAND` | missing/invalid command | `RETURN requires a valid return_config.command (got '<c\|none>') (step X)` [validator.ts:251-253] |
| A1.5 | `MISSING_RESTART_MODE` | RESTART w/o mode | `RESTART requires restart_mode (step X)` [validator.ts:254] |
| A1.5 | `INVALID_RESTART_MODE` | `restart_mode` present and ∉ CLEAN/KEEP (checked for ANY command, not only RESTART) | `invalid restart_mode '<m>' (step X)` [validator.ts:255] |
| A1.5 | `MISSING_GOTO_TARGET` | GOTO w/o target | `GOTO requires goto_step_oid (step X)` [validator.ts:256] |
| A1.5 | `INVALID_TRY_MODE` | workflow mode invalid | `invalid workflow-level try mode '<m>'` [validator.ts:266] |
| A1.5 | `DUPLICATE_TRY_MODE` | workflow mode repeated | `workflow-level mode '<m>' appears more than once` [validator.ts:267] |
| A1.5 | `DUPLICATE_CATCH_ID` | two CATCH share id | `catch_id '<id>' used by more than one CATCH (step X)` [validator.ts:278] |
| A1.5 | `UNMATCHED_TRY` | step TRY id unknown | `TRY references undefined catch_id '<id>' (step X)` [validator.ts:286] |
| A1.5 | `GOTO_TARGET_NOT_FOUND` | target missing | `GOTO target '<oid>' not found (step X)` [validator.ts:291] |
| A1.5 | `GOTO_TARGET_IN_CATCH` | target in catch network | `GOTO target '<oid>' is inside a catch network (step X)` [validator.ts:292] |
| A1.5 | `UNMATCHED_TRY` | workflow TRY id unknown | `workflow-level TRY references undefined catch_id '<id>'` [validator.ts:297-299] |
| A1.5 | `CROSS_NETWORK_EDGE` | edge across boundary | `connection <from> → <to> crosses the catch-network boundary` [validator.ts:306-312] |
| A1.6 | `GATE_WRONG_DEGREE` | not 1-in/1-out | `GATE must have exactly 1 incoming and 1 outgoing connection (has <i> in, <o> out) (step X)` [validator.ts:332-334] |
| A1.6 | `INVALID_GATE_CYCLE` | cycle not number 1..31449600 | `gate_config.cycle_seconds must be a number from 1 to 31449600 (got '<v>') (step X)` [validator.ts:336-338] |
| A1.6 | `INVALID_GATE_MODE` | bad mode | `gate_config.mode must be 'condition', 'timer' or 'condition_or_timer' (got '<v>') (step X)` [validator.ts:342-344] |
| A1.6 | `GATE_DELAY_REQUIRED` | timed w/o delay | `gate_config.delay_seconds is required when mode is '<m>' (step X)` [validator.ts:347-349] |
| A1.6 | `GATE_DELAY_WITHOUT_TIMER` | delay w/o timed mode | `gate_config.delay_seconds is only valid with mode 'timer' or 'condition_or_timer' (step X)` [validator.ts:350-352] |
| A1.6 | `INVALID_GATE_DELAY` | not integer 1..31449600 | `gate_config.delay_seconds must be a whole number of seconds from 1 to 31449600 (got '<v>') (step X)` [validator.ts:353-355] |
| A1.6 | `GATE_RESOURCES_UNSUPPORTED` | GATE has resource cmds | `GATE steps cannot declare resource commands (step X)` [validator.ts:367-370] |
| A1.7 | `INVALID_SCRIPT_REPEAT` | repeat not object | `script_config.repeat must be an object (step X)` [validator.ts:386-388] |
| A1.7 | `INVALID_SCRIPT_CYCLE` | bad cycle | `script_config.repeat.cycle_seconds must be a number from 1 to 31449600 (got '<v>') (step X)` [validator.ts:390-392] |
| A1.7 | `INVALID_SCRIPT_TIME_LIMIT` | bad limit | `script_config.repeat.time_limit_seconds must be a whole number of seconds from 1 to 31449600 (got '<v>') (step X)` [validator.ts:393-395] |
| A1.7 | `INVALID_SCRIPT_TIME_LIMIT_ACTION` | bad on_time_limit | `script_config.repeat.on_time_limit must be 'error' or 'complete' (got '<v>') (step X)` [validator.ts:396-398] |
| A1.7 | `SCRIPT_TIME_LIMIT_ACTION_WITHOUT_LIMIT` | on_time_limit w/o limit | `script_config.repeat.on_time_limit is only valid with time_limit_seconds (step X)` [validator.ts:399-401] |
| A2 | `INVALID_VALIDATION` | ACTION PROXY w/o config | `ACTION PROXY step <oid> missing action_proxy_config` [validator.ts:500-502] |
| A2 | `INVALID_VALIDATION` | empty action/env oid | `ACTION PROXY step <oid> action_proxy_config missing required field` [validator.ts:505-507] |
| A2 | `INVALID_VALIDATION` | unknown env oid and no env name | `ACTION PROXY step <oid> references unknown environment_oid <envOid>` [validator.ts:518-521] |
| A2 | `INVALID_VALIDATION` | action not in roster and no action name (an unknown `environment_oid` rescued by `environment_name` still needs a non-empty `action_name`, else this error) | `ACTION PROXY step <oid> action_oid <a> not in environment <e>` [validator.ts:518-525] |
| A2.5 | `INVALID_VALIDATION` | non-blank non-http(s) server URI | `Environment "<name>" has an action server "<server>" with an invalid URI "<uri>". Fix it in Designer, then re-export and re-load the workflow.` [validator.ts:958-970] |
| A3 | `INVALID_RESOURCE_COMMAND` | unknown source oid | `Step "<label>" command "<type>": resource_source_oid "<oid\|(none)>" does not match any workflow or environment in this package` [validator.ts:610-616] |
| A3 | `INVALID_RESOURCE_COMMAND` | unknown resource | `Resource command references unknown resource: "<name>"` [validator.ts:617-621] |
| A3 | `INVALID_RESOURCE_COMMAND` | type mismatch | `<command> not compatible with resource type "<type>"` [validator.ts:624-648] |
| A3 | `INVALID_RESOURCE_COMMAND` | blank amount_property | `<command> amount_property must be a non-empty property key` [validator.ts:634-639] |
| A3 | `INVALID_RESOURCE_COMMAND` | amount missing/≤0 | `<command> requires amount > 0` [validator.ts:641-644] |
| A3 | `INVALID_RESOURCE_COMMAND` | >1 sync cmd on a step | `Step "<oid>" has <n> sync commands (max 1)` [validator.ts:653-655] |
| A3 | `INVALID_RESOURCE_SPEC` | workflow-level (root/child) named pool w/o names | `Named pool "<name>" must have a non-empty names array` [validator.ts:676-681] |
| A3 | `INVALID_RESOURCE_SPEC` | workflow-level (root/child) pool-limit type w/o use_limit>0 | `Resource "<name>" requires use_limit > 0` [validator.ts:682-687] |
| B | `INVALID_FORM_ELEMENT_TYPE` | `oneOf` failure under an `elements` path | `Invalid form element at <path>` [validator.ts:929-931] |
| B | `INVALID_STEP_TYPE` | `enum` failure on a `step_type` path | `Invalid step type at <path>` [validator.ts:933-935] |
| B | `MISSING_REQUIRED_FIELD` | `required` failure | `Missing required field: <prop> at <path>` — for a root-level field the path is empty, so the message ends in `at ` with a trailing space (e.g. `Missing required field: local_id at `, verified) [validator.ts:937-939] |
| B | `INVALID_FORM_ELEMENT_TYPE` | fallback: oneOf + const-on-`/type` | `Invalid form element type` [validator.ts:943-947] |
| B | `MISSING_REQUIRED_FIELD` | any other schema failure (wrong type, other enum, const) | the first ajv message, e.g. `must be string`, `must be equal to one of the allowed values`, `must be equal to constant` [validator.ts:949] |

Resource compatibility (A3): `Acquire`/`Release` ↔ binary exclusive, binary shared, named pool;
`Acquire Pool Amount`/`Release Pool Amount` ↔ countable; `Send`/`Receive`/`Synchronize` ↔ sync.
Resource ownership is gathered over the whole tree (root, every child, every embedded env); a
workflow resource with `scope: 'environment'` is not owned by the workflow. [src: MissionEngine/src/spec/validator.ts:536-588]
A3 command checks run on the steps of the root AND of every child (unlike the graph rules). A
`command_type` outside the seven known strings is not rejected by A3 (no branch matches); it fails
later in phase B as `MISSING_REQUIRED_FIELD` / `must be equal to one of the allowed values` (verified).
[src: MissionEngine/src/spec/validator.ts:590-667; workflow-schema.json:517-524]
`ORPHANED_CATCH` is not an engine code (a CATCH no TRY references is accepted). [src: MissionEngine/src/spec/validator.ts:313-314]
Phase-B errors are scanned in ajv order (`allErrors: true`); the first error matching one of the
three keyword mappings wins. [src: MissionEngine/src/spec/validator.ts:917-950]

### A.8.4 Warnings (non-fatal)

| Code | Condition | Message |
|---|---|---|
| `UNBOUND_FORM_INPUT` | textInput/textarea/checkbox/radio/esignature element without non-empty `outputParameter` (v1 layouts and form_document; root AND children) | `Step "<label>" form <type> "<label\|fieldName>" (<device\|form_document> layout) has no outputParameter binding — captured input will be discarded. Set the element's outputParameter to one of the step's output_parameter_specifications ids, or remove the element.` [validator.ts:737-816] |
| `ESIGNATURE_MULTIPLE_BLOCKS` | >1 esignature block | `Step "<label>" form_document holds <n> e-signature blocks — only the first in document order is signed; remove the others.` [validator.ts:820-840] |
| `INPUT_BINDING_ON_GATE_IGNORED` | GATE with step-level bindings | `Step "<label>" is a GATE but carries step-level action_property_bindings — a GATE reads only gate_config.action_property_bindings; the step-level entries are ignored.` [validator.ts:424-431] |
| `GATE_BINDING_UNKNOWN_ENVIRONMENT` / `INPUT_BINDING_UNKNOWN_ENVIRONMENT` | ROOT steps only: binding names an env (oid or name given) that resolves by neither oid nor name against the ROOT's `environment_specifications` (a binding with neither field gives no warning) | `Step "<label>" <GATE binding\|input binding> for parameter "<p>" references an environment that resolves by neither oid ('<oid>') nor name ('<name>') against this spec's environment_specifications — <consequence>` [validator.ts:452-462] |
| `GATE_BINDING_UNKNOWN_PARAMETER` / `INPUT_BINDING_UNKNOWN_PARAMETER` | ROOT steps only: non-empty `parameter_id` not an input id of the step | `Step "<label>" <kind> parameter_id "<p>" matches no input_parameter_specifications id on this step — <consequence>` [validator.ts:464-470] |

`<label>` = step `local_id ?? oid ?? '<unknown>'`. `<consequence>` = `this gate's evaluation will fail
at runtime unless a TRY handles it.` (GATE) or `this step's input acquisition will fail at runtime
unless a TRY handles it.` [src: MissionEngine/src/spec/validator.ts:422,439-441]

Warning order in `warnings[]`: first all form warnings (root spec, then children depth first; per
step: v1 layout elements, then form_document blocks, then `ESIGNATURE_MULTIPLE_BLOCKS`), then all
binding warnings (root steps in order; per GATE the `INPUT_BINDING_ON_GATE_IGNORED` first). All
warnings are collected (not first-hit). [src: MissionEngine/src/spec/validator.ts:737-779,413-475,1014-1026]

---

## A.9 Examples

Both examples were run through the engine's `validate()` (results in comments). [verified with MissionEngine/src/spec/validator.ts via tsx]

### A.9.1 Minimal valid workflow  — result `{"valid":true}`

(Same shape as conformance fixture `val-struct-001`.) [src: MissionEngine/src/conformance/fixtures/validation/val-struct-001-minimal-valid.json]

```json
{
  "schemaVersion": "5.0",
  "local_id": "Minimal Workflow",
  "oid": "7000000000000001",
  "version": "1.0.0",
  "last_modified_date": "2026-11-11T00:00:00.000Z",
  "state": "Draft",
  "steps": [
    { "local_id": "Start", "oid": "7000000000000010", "version": "1.0.0", "last_modified_date": "2026-11-11T00:00:00.000Z", "step_type": "START", "position": { "x": 100, "y": 100 } },
    { "local_id": "End",   "oid": "7000000000000011", "version": "1.0.0", "last_modified_date": "2026-11-11T00:00:00.000Z", "step_type": "END",   "position": { "x": 100, "y": 300 } }
  ],
  "connections": [
    { "from_step_id": "7000000000000010", "to_step_id": "7000000000000011" }
  ]
}
```

### A.9.2 USER_INTERACTION + SCRIPT + YES_NO with routed connections — result `{"valid":true}`

Flow: the operator enters a weight (captured to `Batch.Weight`), a SCRIPT classifies it into
`Batch.Status`, the operator confirms on a YES_NO; "yes" ends, "no" loops back to the entry screen.
YES_NO edges carry both `source_handle_id` and a `condition` (either alone would route; the condition
is matched case-insensitively against the answer `yes`/`no`). SCRIPT input ids are JS identifiers.

```json
{
  "schemaVersion": "5.0",
  "local_id": "Weigh Batch",
  "oid": "7100000000000001",
  "description": "Operator records a weight, a script classifies it, the operator confirms.",
  "version": "1.0.0",
  "last_modified_date": "2026-11-11T00:00:00.000Z",
  "state": "Draft",
  "display_style": "flowchart",
  "starting_parameter_specifications": [
    { "id": "Limit", "description": "Upper weight limit in kg", "default_value": "50" }
  ],
  "output_parameter_specifications": [
    { "id": "Status", "target": "Batch.Status" }
  ],
  "value_property_specifications": [
    { "name": "Batch", "entries": [
      { "name": "Weight", "value": "" },
      { "name": "Status", "value": "pending" },
      { "name": "Description", "value": "Values captured for one batch" }
    ] }
  ],
  "steps": [
    { "local_id": "Start", "oid": "7100000000000010", "version": "1.0.0", "last_modified_date": "2026-11-11T00:00:00.000Z",
      "step_type": "START", "position": { "x": 100, "y": 50 } },
    { "local_id": "Enter Weight", "oid": "7100000000000020", "version": "1.0.0", "last_modified_date": "2026-11-11T00:00:00.000Z",
      "step_type": "USER_INTERACTION", "position": { "x": 100, "y": 150 },
      "input_parameter_specifications": [ { "id": "Limit", "default_value": "Limit", "value_type": "property" } ],
      "output_parameter_specifications": [ { "id": "Weight", "target": "Batch.Weight" } ],
      "ui_parameter_specifications": [ { "type": "Button", "value": "Record Weight" } ],
      "button_bar": { "format": "fixed" },
      "allow_back": false,
      "allow_stop": true,
      "form_document": {
        "version": 2,
        "sections": [ { "id": "7100000000000021", "role": "content", "rows": [
          { "id": "7100000000000022", "blocks": [
            { "id": "7100000000000023", "type": "header", "content": "<p>Weigh the batch (limit {{Limit}} kg)</p>", "size": "2xl" } ] },
          { "id": "7100000000000024", "blocks": [
            { "id": "7100000000000025", "type": "textInput", "fieldName": "weight", "label": "Weight (kg)", "inputMode": "number", "required": true, "outputParameter": "Weight" } ] }
        ] } ]
      } },
    { "local_id": "Classify", "oid": "7100000000000030", "version": "1.0.0", "last_modified_date": "2026-11-11T00:00:00.000Z",
      "step_type": "SCRIPT", "position": { "x": 100, "y": 250 },
      "input_parameter_specifications": [
        { "id": "weight", "default_value": "Batch.Weight", "value_type": "property" },
        { "id": "limit",  "default_value": "Limit",        "value_type": "property" }
      ],
      "output_parameter_specifications": [ { "id": "status", "target": "Batch.Status" } ],
      "script_config": { "language": "javascript", "source": "output.status = Number(weight) <= Number(limit) ? 'ok' : 'over';" } },
    { "local_id": "Confirm", "oid": "7100000000000040", "version": "1.0.0", "last_modified_date": "2026-11-11T00:00:00.000Z",
      "step_type": "YES_NO", "position": { "x": 100, "y": 350 },
      "input_parameter_specifications": [ { "id": "Status", "default_value": "Batch.Status", "value_type": "property" } ],
      "ui_parameter_specifications": [ { "type": "YesNoButtons", "value": "Accept", "value2": "Re-weigh" } ],
      "yes_no_config": { "yes_label": "Accept", "no_label": "Re-weigh", "yes_value": "true", "no_value": "false" },
      "button_bar": { "format": "fixed", "yes_color": "#22c55e", "no_color": "#ef4444" },
      "allow_back": true,
      "form_document": {
        "version": 2,
        "sections": [ { "id": "7100000000000041", "role": "content", "rows": [
          { "id": "7100000000000042", "blocks": [
            { "id": "7100000000000043", "type": "text", "content": "<p>The script classified the batch as <strong>{{Status}}</strong>. Accept it?</p>" } ] }
        ] } ]
      } },
    { "local_id": "End", "oid": "7100000000000050", "version": "1.0.0", "last_modified_date": "2026-11-11T00:00:00.000Z",
      "step_type": "END", "position": { "x": 100, "y": 450 } }
  ],
  "connections": [
    { "from_step_id": "7100000000000010", "to_step_id": "7100000000000020" },
    { "from_step_id": "7100000000000020", "to_step_id": "7100000000000030" },
    { "from_step_id": "7100000000000030", "to_step_id": "7100000000000040" },
    { "from_step_id": "7100000000000040", "to_step_id": "7100000000000050", "source_handle_id": "yes", "condition": "Yes" },
    { "from_step_id": "7100000000000040", "to_step_id": "7100000000000020", "source_handle_id": "no",  "condition": "No" }
  ]
}
```

Expected runtime data flow (from §A.3–§A.7): submit `{"kind":"submit","values":{"weight":"42"}}` on
Enter Weight -> `Batch.Weight = "42"`; Classify -> `Batch.Status = "ok"`; Confirm shows "ok" via
`{{Status}}`; `{"kind":"decision","value":"yes"}` -> End; history `outputs = [{"name":"Status","value":"ok"}]`.
Back on Confirm returns to Enter Weight (the SCRIPT passes on the back target). All twelve real Designer
sample packages under `Samples/Individual Workflow Tests/` also validate (`valid:true`), both as
exported and after `instantiateSpec`; one of them (`Test_of_E-Signatures`) carries four
`UNBOUND_FORM_INPUT` warnings. [verified: re-run by the verifier with validator.ts + instantiate.ts via tsx]

---

## Appendix A-S. JSON Schema completeness (`src/spec/workflow-schema.json` vs `src/spec/types.ts`)

The schema is NOT complete relative to `types.ts` (or to what the engine reads). It is a permissive
schema (no `additionalProperties: false`, so missing properties are simply unchecked), compiled once
with `strict: false`, `$schema` removed, and form-element `required` lists relaxed to `["type"]`.
[src: MissionEngine/src/spec/validator.ts:842-901]

Fields in `types.ts` (or read by the engine) that the schema does NOT define:
1. Step `action_proxy_config` (whole `ActionProxyConfig`: `action_oid`, `environment_oid`,
   `action_name`, `environment_name`, `timeout_ms`) — checked only by the hand-written A2 rules.
   [src: MissionEngine/src/spec/types.ts:411-422,476]
2. Step `form_document` (entire v2 document, including `esignature` blocks). [src: MissionEngine/src/spec/types.ts:461]
3. `FormElementTextInput.inputMode`, `.listItems`, `.listSource`. [src: MissionEngine/src/spec/types.ts:66-78 vs workflow-schema.json:210-228]
4. `FormElementCheckbox.listSource`, `FormElementRadio.listSource`. [src: MissionEngine/src/spec/types.ts:94-123]
5. `FormElementImage.imageOid`. [src: MissionEngine/src/spec/types.ts:154-167]
6. `included_actions[].oid` (the spelling real packages use; the schema only names `action_oid`). [src: MissionEngine/src/spec/types.ts:394 vs workflow-schema.json:546-568]
7. Step `form_layout_config` object form (`{elements: [...]}`) accepted by `getFormElements`; the schema
   only allows an array, so this form never validates. [src: MissionEngine/src/core/step-handlers.ts:55-58 vs workflow-schema.json:636-639]
8. `master_oid` (stamped by `instantiateSpec`) — in neither file. [src: mission-control-db/src/runtime/instantiate.ts:68-73]

Fields in the schema but not in `types.ts`: step `ui_parameter_specifications`, `action_visibility`,
`connection_references`; `IncludedAction.action_version`, `.action_last_modified_date`,
`.input_parameter_specifications`, `.output_parameter_specifications`, `.property_specifications`;
`FormElementText/Header.fontWeight/.color/.align`; `FormElementImage.objectFit`.
[src: workflow-schema.json:185-187,202-204,257,474-487,546-568,632-664]

Stricter in the schema than in `types.ts`: `included_actions` required on every environment;
`action_library` required on every roster entry; `state` required on every child;
`ActionServerSpecification.uri` required and `connection_type` limited to `"REST"`; `schemaVersion`
limited to `3.0`/`4.0`/`5.0`; v1 `text`/`header` `content` must be an object; `RichTextContent`
requires both `content` and `plainText`. [src: workflow-schema.json:27-36,142-149,546-568,597,682,735,745]

---

## Designer export consistency (MissionDesigner/src/lib/packageFormat)

Checked against `workflow-exporters.ts`, `step-extractors.ts`, `parameter-extractors.ts`,
`library-exporters.ts`, `action-property-bindings.ts`, `export-types.ts`:
- Step types emitted: exactly the 14 canonical strings (`START`, `END`, `ACTION PROXY`, `YES_NO`,
  `USER_INTERACTION`, `SCRIPT`, `GATE`, `WORKFLOW PROXY`, `SELECT 1`, `WAIT ANY`, `PARALLEL`, `WAIT ALL`,
  `CATCH`, `RETURN`); never `MATH` or `SELECT_1`. `schemaVersion` is `"5.0"`. [src: export-types.ts:21,514-529]
- Fields Designer emits that the engine ignores (all documented above): root/child `type_name`,
  `library_name`, `library_oid`, `viewport`; step `form_element_images`, `action_visibility`
  (ACTION PROXY, default `"opaque"`), step-level `value_property_specifications`,
  `ui_parameter_specifications[].oid/font_size/color/lines/align/value2`, `yes_no_config.yes_value`/
  `no_value` (always `"true"`/`"false"`); parameter `oid`, `description`, `json_schema`, `entries`;
  environment `state`, `library_oid`, `action_property_specifications`, `action_server_specifications[].api_key`. [src: workflow-exporters.ts:96-143,553-571; step-extractors.ts:65-162; parameter-extractors.ts:32-93]
- Designer writes `value_type` only as `"property"` (or omits it); every output gets a `target`
  (defaulting to its id); CATCH steps always export the four outputs `Message`/`Reason`/`Step`/`StepID`. [src: parameter-extractors.ts:46-93]
- Designer emits `button_bar`/`allow_back`/`allow_stop` only on USER_INTERACTION/YES_NO, and
  `control_previous_action` only when `true`; `gate_config.mode`/`delay_seconds` only for timed modes;
  step-level and gate-level `action_property_bindings` are derived at export from inputs whose
  property group is an environment Action Property. [src: step-extractors.ts:108-131,205-224; action-property-bindings.ts:34-94]
- Child workflow steps' `action_proxy_config` is resolved against the ROOT's environments; children
  carry no `environment_specifications`. [src: workflow-exporters.ts:122-134]
- No Designer-emitted field was found that the engine reads but this section omits.

# Part 2 — Execution semantics (sections C.x)

This section specifies how a Mission Engine executes a frozen workflow specification (the
`workflow_instance.spec_jsonb` recipe): the runtime-workflow and step lifecycles, the scheduling and
cascade algorithm, per-step-type behaviour, routing, parameter and property resolution, Back and
Stop, timers and failure handling. A re-implementation MUST produce the same database-visible effects
(rows, states, trace entries, step runs, history) because Mission Commander, Mission XO and Mission
Pilot read the same database.

Terminology: an **instance** is one `workflow_instance` row. A **step row** is one `step_instance`
row. A **context** is the in-memory working set for one instance during one transaction (root
context), or a **view** of it scoped to one child (sub-workflow) spec. **Trace** means
`trace_entry` rows. **Step run** means `step_run` rows. All times are read from the engine clock
`deps.now()` (never the SQL clock), except where noted.

Conformance fixtures under `MissionEngine/src/conformance/fixtures/{execution,parameters,resources}`
define a subset of this behaviour (C.10 states exactly what each one asserts). Every statement in this
section that a fixture pins is marked **[pinned: fixture-id]**. Statements without that mark are
defined only by code. Where the reference relies on a Node.js / PostgreSQL / JavaScript mechanism,
C.11 states the observable contract an equivalent must provide.

---

## C.1 Runtime workflow (instance) lifecycle

### C.1.1 Status vocabulary

`workflow_instance.status` MUST be one of these exact, case-sensitive strings (DB CHECK
`workflow_instance_status_ck`) [src: mission-control-db/src/db/schema/execution.ts:25,108]:

| Status | Class | Meaning |
|---|---|---|
| `pending` | pre-start | Created, not yet requested to start. |
| `queued` | pre-start | Waiting for an engine worker to start it. |
| `running` | active, running-like | Normal execution. |
| `pausing` | transitional | Pause requested; control pass pending. |
| `paused` | active | Dispatch frozen. |
| `resuming` | transitional | Resume requested; control pass pending. |
| `stopping` | transitional | Orderly stop (halt) in progress. |
| `aborting` | transitional | Abort in progress. |
| `stopping_cleanup` | active, running-like | Operator Stop cleanup CATCH network running. |
| `aborting_cleanup` | active, running-like | Operator Abort cleanup CATCH network running. |
| `completed` | terminal | |
| `aborted` | terminal | |
| `errored` | terminal | |
| `stopped` | terminal | |

- **Running-like** statuses are exactly `running`, `stopping_cleanup`, `aborting_cleanup`
  [src: MissionEngine/src/core/operator-cleanup.ts:29]. In a running-like status the engine MUST
  activate READY steps, invoke/monitor actions, evaluate gates and scripts, acquire property
  bindings, and accept step submissions [src: MissionEngine/src/core/operator-cleanup.ts:15-21].
- **Transitional** statuses (handled by the control pass) are `pausing`, `resuming`, `stopping`,
  `aborting` [src: MissionEngine/src/core/control.ts:66].
- **Terminal** (final) statuses are `completed`, `aborted`, `stopped`, `errored`; these are also the
  only legal `runtime_history.final_state` values [src: mission-control-db/src/db/schema/execution.ts:33,238].
- Active statuses: `queued, running, pausing, paused, resuming, stopping, aborting,
  stopping_cleanup, aborting_cleanup` [src: mission-control-db/src/db/schema/execution.ts:27].
- Deletable statuses: `pending, completed, aborted, stopped, errored` [src: mission-control-db/src/db/schema/execution.ts:32].

### C.1.2 Who changes status

Request transitions are written by the shared DAO (`mission-control-db/src/dao/runtime-control.ts`),
called by the engine's internal API (Commander/XO), the Pilot Stop route, and other DAO users; the
engine's control pass and transition code perform the settling transitions.

| From | To | Trigger / writer | Source |
|---|---|---|---|
| (insert) | `pending` | create without start | [src: mission-control-db/src/dao/runtime-workflows.ts:122] |
| (insert) | `queued` | create-and-start (incl. scheduled starts, `triggered_by='schedule'`) | [src: mission-control-db/src/dao/runtime-workflows.ts:110-118] |
| `pending` | `queued` | start request; sets `queued_at=now()`, `start_requested_by` | [src: mission-control-db/src/dao/runtime-workflows.ts:270-271] |
| `queued` | `running` | engine acquire (`acquireQueuedRuntimeWorkflows`), oldest `queued_at` first, `FOR UPDATE SKIP LOCKED`, sets `started_at = now()` (SQL clock) | [src: mission-control-db/src/runtime/engine-access.ts:55-68] |
| `queued` | `errored` | invalid spec at start, or start retries exhausted | [src: MissionEngine/src/core/instance.ts:54-61], [src: MissionEngine/src/loop.ts:138-159] |
| `running` | `pausing` | `requestPause` (only from `running`) | [src: mission-control-db/src/dao/runtime-control.ts:36] |
| `paused` | `resuming` | `requestResume` (only from `paused`) | [src: mission-control-db/src/dao/runtime-control.ts:37] |
| `running`,`paused`,`pausing` | `stopping` | `requestStop` (effect `request`) | [src: mission-control-db/src/dao/runtime-control.ts:78-81] |
| `queued`,`running`,`pausing`,`paused`,`resuming`,`stopping` | `aborting` | `requestAbort` (effect `request`) | [src: mission-control-db/src/dao/runtime-control.ts:86-90] |
| `stopping_cleanup` | `aborting` | `requestAbort` (effect `escalate`) | same |
| `stopping`,`stopping_cleanup` | `stopping` + `cleanup_skip='stop'` | `requestSkipCleanup(kind='stop')` (effect `skip_cleanup`) | [src: mission-control-db/src/dao/runtime-control.ts:92-97] |
| `aborting`,`aborting_cleanup` | `aborting` + `cleanup_skip='abort'` | `requestSkipCleanup(kind='abort')` | same |
| `pausing` | `paused` | control pass `runPausing` | [src: MissionEngine/src/core/control.ts:316-317] |
| `paused` | `pausing` | undelivered PAUSE undo (server unreachable) | [src: MissionEngine/src/core/send-failure.ts:197-198] |
| `resuming` | `running` | control pass `runResuming` | [src: MissionEngine/src/core/control.ts:453-454] |
| `stopping` | `stopped` | halt drained, no cleanup | [src: MissionEngine/src/core/operator-cleanup-flow.ts:79-83] |
| `stopping` | `stopping_cleanup` | halt drained, root has `OPERATOR_STOP` row | [src: MissionEngine/src/core/operator-cleanup-flow.ts:147-152] |
| `aborting` | `aborted` | abort pass (single pass) | [src: MissionEngine/src/core/control.ts:711] |
| `aborting` | `aborting_cleanup` | confirmed abort halt done, root has `OPERATOR_ABORT` row | [src: MissionEngine/src/core/operator-cleanup-flow.ts:147-152] |
| `stopping_cleanup` | `stopped` | cleanup ended | [src: MissionEngine/src/core/operator-cleanup-flow.ts:173-198] |
| `aborting_cleanup` | `aborted` | cleanup ended | same |
| `running` | `completed` | root END reached and nothing active | [src: MissionEngine/src/core/transition.ts:2741-2755] |
| `running` | `errored` | uncaught failure at root, malformed RETURN, engine failure | [src: MissionEngine/src/core/transition.ts:2154], [src: MissionEngine/src/core/transition.ts:1760], [src: MissionEngine/src/loop.ts:182-218] |
| `running` | `aborted` | RETURN ABANDON at root, CATCH_REENTRY | [src: MissionEngine/src/core/transition.ts:1859-1868], [src: MissionEngine/src/core/transition.ts:2057] |
| any transitional | `errored` | control pass failed `MAX_CONTROL_PASS_ATTEMPTS` (3) times | [src: MissionEngine/src/core/control.ts:861-888] |

A status request that is not legal from the current status MUST fail with DAO error
`RUNTIME_INVALID_STATE` (message `cannot <verb> from <status>`, where `<verb>` is `pause`, `resume`,
`stop`, `abort` or `skip cleanup`); a missing instance with `RUNTIME_NOT_FOUND`; a `user` actor whose
id does not exist with `USER_NOT_FOUND` — checked BEFORE the status, so an unknown user wins over an
illegal status [src: mission-control-db/src/dao/runtime-control.ts:25-34,51-66]. Pause/resume are a
single guarded `UPDATE … WHERE status IN (from)` and write NO control event. Stop/abort/skip lock the
row `FOR UPDATE`, take the first rule whose `from` list holds the current status, and MUST also insert
one `runtime_control_event` row (verb — or `recordAsVerb` for a remote Stop of a queued runtime carried
out as an Abort —, effect, from/to status, actor columns, and for a Pilot Stop the
`step_oid`/`step_name`) in the same transaction; a refusal writes nothing
[src: mission-control-db/src/dao/runtime-control.ts:44-75]. These DAO writes stamp `updated_at` with
the writer's process clock (`new Date()`), not the engine clock.

Every INSERT on `workflow_instance` and every UPDATE of its `status` column fires the statement
trigger that does `pg_notify('engine_wake', <table name>)`; every UPDATE of `step_instance.state`
does the same [src: mission-control-db/drizzle/0018_mission_engine.sql:23-30]. An engine MUST LISTEN
on `engine_wake` and on `wc_resource_grant` and wake idle workers on any notification; REST-12
property events from the property watch also wake the loop
[src: MissionEngine/src/index.ts:112-114,127], [src: mission-control-db/src/runtime/wc-resources.ts:25].
A lost listener connection is re-established after 5000 ms [src: MissionEngine/src/wake.ts:16,61].
The wake is an optimisation only: correctness MUST NOT depend on it (idle slots re-poll every 1000 ms).

### C.1.3 Settling terminal (`settleTerminal`)

Every terminal transition MUST go through one operation that, in one transaction
[src: MissionEngine/src/core/context.ts:1246-1363]:

1. Applies the **cleanup redirect**: if `engine_state.operatorCleanup.phase === 'cleanup'` and the
   requested status is not the cleanup's final status (`stopped` for stop, `aborted` for abort) and
   the settle is from `running`, from the cleanup status, or from the halt status, the status is
   replaced by the final status (and `from` by the cleanup status unless it was the halt status);
   if the requested status already is the final status and `from` is `running`, `from` becomes the
   cleanup status [src: MissionEngine/src/core/context.ts:1270-1284].
2. Executes `UPDATE workflow_instance SET status, final_state, completed_at, updated_at WHERE id = ?
   AND status = <from>` (default `from` = `running`). If zero rows match, the settle MUST be a
   no-op (**first terminal wins**): no history, no further writes [src: MissionEngine/src/core/context.ts:1287-1306].
3. If the redirect fired: writes trace `OPERATOR` (null step) `Operator Stop cleanup ended: <reason>`
   / `Operator Abort cleanup ended: <reason>` (default reason `step failed`) and queues live
   cleanup actions for ABORT+DELETE [src: MissionEngine/src/core/context.ts:1308-1315].
4. Settles the environment-resource tier (drop this instance's queue entries and unconsumed grants;
   holds survive) [src: MissionEngine/src/core/context.ts:1119-1182].
5. Records a `cancelled` step run for every row still in an active state (rows are not changed)
   [src: MissionEngine/src/core/context.ts:1326].
6. Writes one `runtime_history` row: trace assembled in reference order (C.3.8), properties =
   local on top of shared (`toHistoryJSON`), `step_params = engine_state.stepSnapshots`, step
   names, workflow outputs, starter identity, schedule label [src: MissionEngine/src/core/context.ts:1328-1362].

### C.1.4 Starting an instance

On acquire (`queued`→`running`), in the SAME transaction [src: MissionEngine/src/loop.ts:713-723],
[src: MissionEngine/src/core/instance.ts:38-187]:

1. Open a context with empty `engine_state` and `property_store` (whatever the queued row carried —
   e.g. `startAttempts` — is discarded; the first persist overwrites the column).
2. Validate the spec. If invalid: trace `ERRORED` (null step) with the validator message (or code, or
   `invalid workflow specification`), persist, settle `errored`. Stop.
3. For each validator warning: trace `WARNING` (null step) with the warning message.
4. Initialise properties: workflow value properties, then (conformance only)
   `setup.initial_properties`, then starting parameters (C.6.3).
5. Create a workflow-tier resource manager iff the root declares resource properties, any root or
   direct-child step declares resource commands, any environment declares resources, or the harness
   supplied resources. Register every root resource whose `scope !== 'environment'` under key
   `<root.oid>:<name>`.
6. Find START. (Defensive: if none, trace `ERRORED` "No START step found despite passing
   validation" and settle `errored`.) Trace START `COMPLETED` — START never gets a step row.
7. `drainCascade(root, [START])`. If this throws, record trace `ERRORED` (null step) with the
   message, record `failed` step runs for active rows, force every non-terminal row `ERRORED`,
   persist, settle `errored`. If that recovery itself throws, raise `StartRecoveryFailedError`.
8. `settleIfComplete(root)`; persist.

Start failure recovery: a `StartRecoveryFailedError` escaping the acquire transaction is handled by
`recoverFailedStart` in a new transaction: if the row is still `queued`, increment
`engine_state.startAttempts`; below `MAX_START_ATTEMPTS = 3` set `queued_at = now` (rotate to the back);
at 3 trace `ERRORED` `<message> (after <n> failed start attempts)` and settle `errored` from `queued`.
Any other throw rolls the whole transaction back to `queued` silently [src: MissionEngine/src/loop.ts:89-169,724-736].

### C.1.5 Completion rule

The root instance MUST settle `completed` exactly when (a) at least one step row with
`node_oid = root.oid`, `step_type = 'END'` and `state = 'COMPLETED'` exists, and (b) no step row of
the instance (any node) is in a non-terminal state, and (c) no Operator cleanup is active
[src: MissionEngine/src/core/transition.ts:1178-1183,2741-2755]. Terminal step states are
`COMPLETED, ERRORED, ABORTED, CANCELLED` [src: MissionEngine/src/core/transition.ts:37]. A child's
END never counts for the root [src: MissionEngine/src/core/transition.ts:1170-1177]. While a cleanup
is active, running out of non-terminal rows ends the cleanup (`drained`) instead
[src: MissionEngine/src/core/transition.ts:2745-2750]. [pinned: exec-linear-001 … exec-ui-005, all `COMPLETED` fixtures]

Note: once every row is terminal but no root END is COMPLETED (e.g. a branch routed nowhere) the
instance stays `running` with nothing to claim (see Open points).

### C.1.6 Pause and resume

- **Pause pass** (`pausing`) [src: MissionEngine/src/core/control.ts:255-324]: for every
  `WAITING_ACTION` row with an action instance and server URI (WORKFLOW PROXY parks are skipped),
  decide PAUSE support from the capabilities cache only (`supported` / `unsupported` / `unknown`;
  opaque actions are `unsupported`) using `action_invoked_oid ?? action_oid`. Rows already
  warned unreachable (`pauseUnreachableWarned`) are skipped before the cache is consulted; rows whose
  PAUSE was refused (`pauseRefused`) are skipped only once the verdict is `supported` (a refused row
  whose server is `unknown` still counts as pending). `supported`: queue PAUSE to send after
  commit, trace `PAUSED`, row → `PAUSED`, `pausedAt[stepOid] = now`. `unsupported`: leave running,
  no trace. `unknown`: wait; set `pausingSince` once; while `now - pausingSince < 120000 ms`
  (`PAUSE_UNKNOWN_LIMIT_MS`) stay `pausing`; after the limit write trace `WARNING`
  `action server unreachable — this action may still be running` on each still-unknown step and
  settle anyway. Finally `UPDATE status='paused' WHERE status='pausing'`.
- While `paused`/`pausing`/`resuming`, READY steps are never activated (the READY claim is
  running-like only), gates/scripts/property waits are not evaluated, but action polling, SSE and
  terminals continue [src: MissionEngine/src/loop.ts:257-266], [src: MissionEngine/src/actions/monitor.ts:66-77].
- **Paused-submit-held**: a user-step submission (not `fail`) is accepted while the instance is
  `paused`, `pausing` or `resuming`. The step completes and its outputs are written immediately, but
  its successors are NOT routed: the step oid is appended (once) to `engine_state.deferredRouting`.
  A `fail` action while paused is refused `NOT_RUNNING` [src: MissionEngine/src/core/submit.ts:51,119-126,309-315].
- An action terminal arriving while paused/pausing: `COMPLETED` completes the row and appends to
  `deferredRouting`; a failure terminal is NOT resolved: `wake_at` is cleared and
  `{stepOid, mode, message}` is appended once to `deferredFailures`; the row stays
  `WAITING_ACTION`/`PAUSED` [src: MissionEngine/src/actions/monitor.ts:239-247,267-287].
- **Resume pass** (`resuming`) [src: MissionEngine/src/core/control.ts:382-464]: for each `PAUSED`
  row: queue RESUME (no capability check) if it has an action; trace `EXECUTING`; shift `started_at`
  forward by `now - pausedAt[stepOid]` (timeout budget suspended); row → `WAITING_ACTION`,
  `wake_at = now`. Also queue RESUME for steps whose PAUSE was undelivered. Re-arm every
  `WAITING_GATE`/`WAITING_PROPERTIES`/`WAITING_SCRIPT` row `wake_at = now`. Then set status `running`
  BEFORE draining deferred work, then **drain deferred work**: replay every deferred failure through
  `failStep` (same mode/message) in order, `settleIfComplete` after each; then for each deferred
  routing oid run `drainCascade([oid])` and `settleIfComplete`. Clear `pausingSince`,
  `pauseUndeliveredWarned`, `pauseUnreachableWarned`, `pauseRefused`.
- Step-level `pause`/`resume` user actions (conformance vocabulary): `pause` on a `WAITING_USER` or
  `WAITING_ACTION` row traces `PAUSED` and sets `PAUSED`; `resume` on a `PAUSED` row traces
  `EXECUTING` and restores `WAITING_ACTION` (ACTION PROXY or a step with an active child) or
  `WAITING_USER`; otherwise silent no-op [src: MissionEngine/src/core/submit.ts:189-217].

### C.1.7 Stop (orderly halt)

Stop pass (`stopping`), repeated until drained [src: MissionEngine/src/core/control.ts:507-645]:

1. Every deferred failure is resolved with no TRY/CATCH: trace `ERRORED` with its message, row
   `ERRORED`, `wake_at=null`.
2. For each step row:
   - If the ROOT spec has an `OPERATOR_STOP` workflow-level row: a row in `EXECUTING` with no action
     instance (parked WAIT ALL) → step run `stopped`, `CANCELLED`.
   - `READY`, `WAITING_USER`, `WAITING_GATE`, `WAITING_PROPERTIES`, `WAITING_SCRIPT` → step run
     `stopped` (not for READY), `CANCELLED`, `wake_at=null`. No trace.
   - `WAITING_ACTION`/`PAUSED`, `step_type='ACTION PROXY'`, never invoked → step run `stopped`,
    `CANCELLED` (its `wake_at` is NOT cleared; harmless, the due-action claim only selects
    `WAITING_ACTION`/`PAUSED` rows).
   - `WAITING_ACTION`/`PAUSED`, `step_type='WORKFLOW PROXY'` → if its child node has no row in
     `WAITING_ACTION`/`PAUSED`/`EXECUTING`: step run `stopped`, `CANCELLED`, delete `childActive`.
   - Live action: once per drain (`stoppedActions`), from the cache: `unknown` → wait (retry next
     pass); `unsupported` → record attempt, leave running; `supported` → record attempt, queue
     STOP after commit, `wake_at=now`.
   - Without an `OPERATOR_STOP` row, a parked WAIT ALL is left untouched; such a stop never drains
     (abort is the escape).
3. `settleStoppedIfDrained`: if no row is in `WAITING_ACTION`, `PAUSED` or `EXECUTING`
   (`STOP_ACTIVE_STEP_STATES`) → `afterHaltDrained('stop')` [src: MissionEngine/src/core/transition.ts:1192-1220].

During `stopping`, an action terminal is recorded honestly: `COMPLETED` completes the row (no
routing); a failure forces `ERRORED` with no TRY/CATCH; then `settleStoppedIfDrained`
[src: MissionEngine/src/actions/monitor.ts:206-266].

### C.1.8 Abort

Abort pass (`aborting`) [src: MissionEngine/src/core/control.ts:666-825]:

- **Confirmed abort** applies when the root spec has an `OPERATOR_ABORT` row, `cleanup_skip !==
  'abort'`, the instance has step rows, and no abort cleanup already began
  [src: MissionEngine/src/core/operator-cleanup.ts:62-67]. First pass: READY → `CANCELLED`; a
  live action (has action instance + URI, `WAITING_ACTION`/`PAUSED`, no deferred failure) is sent
  ABORT only (after commit), `wake_at=now`, its row id added to `abortPending`; every other active
  row is aborted now (trace `ABORTED`, row `ABORTED`, ABORT+DELETE after commit). Then
  `operatorCleanup = {kind:'abort', phase:'halting', …}`; if nothing pending, `afterHaltDrained`.
  Later passes drop row ids that reached a terminal; when none remain, or 30000 ms
  (`OPERATOR_ABORT_CONFIRM_TIMEOUT_MS`) since `haltStartedAt`, abort the rest and call
  `afterHaltDrained('abort')`. While halting, any action terminal ends the row `ABORTED` with no
  routing [src: MissionEngine/src/actions/monitor.ts:183-193].
- **Single-pass abort** otherwise: if a Stop cleanup is running, trace `OPERATOR` `Operator Stop
  cleanup ended: escalated to Operator Abort`; READY → `CANCELLED` (no trace); every row in
  `ACTIVE_ROW_STATES` → trace `ABORTED` (which writes an `aborted` step run), row `ABORTED`,
  `wake_at=null`, and ABORT then DELETE to its action after commit; if skipping a running abort
  cleanup, trace `OPERATOR` `Operator Abort cleanup ended: skipped by operator`; settle `aborted`
  from `aborting`. A never-started (`queued`) instance has no rows and settles `aborted` at once.

### C.1.9 Operator Stop / Operator Abort cleanup (TRY/CATCH on operator Stop/Abort)

A ROOT workflow-level `try_specifications` row with mode `OPERATOR_STOP` or `OPERATOR_ABORT`
designates a cleanup CATCH network. Child specs' operator rows never fire
[src: MissionEngine/src/core/operator-cleanup.ts:51-55].

`afterHaltDrained(kind)` [src: MissionEngine/src/core/operator-cleanup-flow.ts:57-89]:
- If a cleanup of this kind already ran (phase `cleanup`): if `cleanup_skip === kind` end it
  (`skipped`); otherwise log an error and leave the instance unchanged.
- Else if no row, no CATCH with that `catch_id`, or `cleanup_skip === kind`: settle
  `FINAL_STATUS[kind]` from `HALT_STATUS[kind]` (no new writes).
- Else `startOperatorCleanup`.

`startOperatorCleanup(kind)` [src: MissionEngine/src/core/operator-cleanup-flow.ts:91-160]:
1. Actor = latest `runtime_control_event` for the verb; name = actor name or `system`.
2. Cancel queued resource waiters (both tiers) of every known step NOT in the cleanup network.
3. `inheritedHolds` = every workflow-tier resource with `inUse > 0` plus `env:<name>` for every
   environment hold. A cleanup step's Acquire on an inherited key is granted immediately without the
   manager; its matching Release is a no-op; any other Release of that key really releases and
   forgets the inheritance [src: MissionEngine/src/core/operator-cleanup.ts:86-127].
4. `operatorCleanup = {kind, phase:'cleanup', catchOid, haltStartedAt, cleanupStartedAt:now,
   inheritedHolds, inheritedUse:{}, abortPending:[], pendingAborts}`.
5. `activeCatches[catchOid] = {catch_oid, trigger_step_oid:'', trigger_step_name:'',
   trigger_reason:'OPERATOR_STOP'|'OPERATOR_ABORT', error_message:'Stopped by operator <name>' |
   'Aborted by operator <name>', activated_at}`.
6. Trace `OPERATOR` (null step) `Operator Stop cleanup started [by <userUuid>]` (user actor) or
   `… (by <name>)`.
7. `UPDATE status = 'stopping_cleanup'|'aborting_cleanup' WHERE status = 'stopping'|'aborting'`;
   zero rows → throw.
8. `activateAndCascade(root, catchOid, catchOid)`; if not settled, `settleIfComplete(root)`; persist.

While a cleanup is active:
- Only steps in `cleanupAllowedOids` may activate at the root: the operator CATCH's network plus,
  transitively, every CATCH network reachable from those steps' own step-level TRY rows. Activation
  of any other root step MUST be refused: log, and end the cleanup as `failure` with message
  `step '<local_id>' is outside the cleanup network` [src: MissionEngine/src/core/transition.ts:1568-1606].
- `failStep` consults only the step-level TRY row (never workflow-level rows) [src: MissionEngine/src/core/transition.ts:2016-2036].
- Any RETURN inside the operator CATCH network ends the cleanup (`return`), whatever its command.
  A RETURN of a nested catch whose command is ABANDON, RESTART, or a GOTO to a step outside the
  allowed set also ends the cleanup (`return`) [src: MissionEngine/src/core/transition.ts:1809-1829].
- An uncaught cleanup-step failure or a CATCH_REENTRY ends the cleanup (`failure`) — never `errored`
  or `aborted` [src: MissionEngine/src/core/transition.ts:2052-2056,2148-2153].
- The instance cannot be paused (`requestPause` only from `running`), and a further Stop request is
  not legal from `stopping_cleanup` (only Abort = escalate, or skip).

`endOperatorCleanup(reason)` [src: MissionEngine/src/core/operator-cleanup-flow.ts:173-199]: only
if status is the cleanup or halt status: tear down every non-terminal row (active root rows and
their child subtrees: step run `cancelled`, trace `IDLE`, delete; READY → `CANCELLED`, no run, no
trace), cancel every known step's queued resource waiters and unconsumed grants (both tiers — HELD
units are NOT released), queue every non-terminal row's live action (action instance + URI) in
`operatorCleanup.pendingAborts` [src: MissionEngine/src/core/transition.ts:1539-1558]; trace `OPERATOR`
`<Operator Stop|Operator Abort> cleanup ended: <RETURN reached | cleanup finished | step failed:
<msg> | skipped by operator>`; delete the active catch; persist; settle `FINAL_STATUS` from the
current status.

Pending cleanup aborts are sent by the loop outside transactions (`finalizeOrphanedActions`, the
first unit of every `runOnce`): it scans every `workflow_instance` whose
`engine_state.operatorCleanup.pendingAborts` is a non-empty array (settled rows included). Per entry,
with `age = wall-clock now − queuedAt`:
- if some non-terminal step row of a non-final instance still names that action instance: keep the
  entry while `age < 60000 ms` (`ORPHAN_KEEP_MS`), else DROP it WITHOUT sending anything;
- else send ABORT; on failure keep it while `age < 60000 ms`, else drop it (logged); on success send
  DELETE (best effort) and drop it.
Dropped entries are removed under a `FOR UPDATE` lock of the instance row, keeping entries added since
the scan. Kept entries are rescanned no sooner than 2000 ms later (`RETRY_SCAN_MS`); an empty scan
within 10000 ms of the last queuing rescans every 250 ms (the queuing transaction may not have
committed yet). This path uses the wall clock (`Date.now()`), not the engine clock, for `queuedAt`
and ages [src: MissionEngine/src/core/operator-cleanup-flow.ts:204-340], [src: MissionEngine/src/core/operator-cleanup.ts:140-158].

### C.1.10 Engine failure recovery

- **Transition throw** (READY-step unit, gate unit, input-binding unit): the transaction rolls back;
  `settleFailedInstance` in a new transaction, if still running-like: trace `ERRORED` (null step)
  with the message, `failed` step runs for active rows, queue live cleanup actions if a cleanup is
  active, persist, force every non-terminal row `ERRORED` (`error` = message, `completed_at` set;
  `wake_at` is NOT cleared on this path), settle `errored` from the current status with cleanup reason
  `engine error: <first line of the message, trimmed; if longer than 200 chars, its first 197 chars +
  "...">` [src: MissionEngine/src/loop.ts:182-218], [src: MissionEngine/src/core/operator-cleanup.ts:71-74].
  The gate unit and the property-binding unit use the same recovery for a throw after their claim
  [src: MissionEngine/src/core/gate.ts:380-389], [src: MissionEngine/src/core/input-bindings.ts:133-140].
- **Control pass throw**: `recoverFailedControlPass`; below 3 attempts persist
  `controlPassAttempts+1`; at 3: trace `ERRORED` `<message> (after <n> failed control-pass
  attempts)`, `failed` runs, rows `ERRORED` with `wake_at=null`, settle `errored` from the claimed
  transitional status, then ABORT+DELETE every live action. The counter resets to 0 on every
  successful pass [src: MissionEngine/src/core/control.ts:846-900,938].
- **Cascade cap**: more than `MAX_CASCADE_ACTIVATIONS = 10000` activations in one transaction
  MUST throw `cascade exceeded 10000 activations — possible unterminated machine cycle`, which is
  then handled by the path above [src: MissionEngine/src/core/transition.ts:53-60,1121-1124].

---

## C.2 Step instance lifecycle

### C.2.1 Row states

`step_instance.state` MUST be one of (DB CHECK `step_instance_state_ck`)
[src: mission-control-db/src/db/schema/execution.ts:30,143]:

| State | Meaning |
|---|---|
| `READY` | Materialized; not yet activated, or blocked on a resource (then `blockedOnResources[stepOid]` exists). |
| `EXECUTING` | A parked WAIT ALL join only. |
| `WAITING_USER` | USER_INTERACTION / YES_NO awaiting an operator. |
| `WAITING_ACTION` | ACTION PROXY awaiting its action, or WORKFLOW PROXY awaiting its child (`action_instance_id` NULL). |
| `WAITING_GATE` | GATE cycling / timing. |
| `WAITING_PROPERTIES` | Step waiting for its Action-Property binding fetch. |
| `WAITING_SCRIPT` | Repeating SCRIPT between runs. |
| `PAUSED` | Paused action (or step-level pause). |
| `COMPLETED`, `ERRORED`, `ABORTED`, `CANCELLED` | Terminal. |

`ACTIVE_ROW_STATES` = `EXECUTING, WAITING_ACTION, WAITING_USER, WAITING_GATE, WAITING_PROPERTIES,
WAITING_SCRIPT, PAUSED` ("actually doing something"; READY is not active)
[src: MissionEngine/src/core/step-run.ts:35-37]. Non-terminal = every state except the four terminal ones.

**Lazy materialization**: a step with no row is idle. START never gets a row. A reset ("idle")
traces `IDLE` and DELETES the row [src: MissionEngine/src/core/transition.ts:1222-1236]. Rows are
looked up by `(workflow_instance_id, step_oid)` alone — step oids MUST be unique across the whole
spec tree (root and all children) [src: MissionEngine/src/core/context.ts:58-60,270-275].

Row columns written by the engine: `node_oid` (owning spec oid), `step_oid`, `step_type`
(canonical, C.4.1), `state`, `error`, `started_at` (set at every park; NULL for auto-completing
steps), `completed_at`, `wake_at` (timer, C.8), `action_instance_id`, `action_server_uri`,
`action_invoked_oid` [src: mission-control-db/src/db/schema/execution.ts:117-140]. Any transition
to a terminal state MUST clear `wake_at` [src: MissionEngine/src/core/transition.ts:2180-2187].

### C.2.2 Transitions

```
(none) --materialize--> READY --activate--> COMPLETED                (auto-completing types)
                         |               \-> WAITING_USER | WAITING_ACTION | WAITING_GATE
                         |                   | WAITING_PROPERTIES | WAITING_SCRIPT
                         |-- blocked on resource (stays READY, trace WAITING)
(none) --WAIT ALL arrival--> EXECUTING --all arrived--> COMPLETED  (or straight to COMPLETED)
WAITING_* --complete--> COMPLETED ; --fail uncaught--> ERRORED ; --fail caught--> (row deleted)
WAITING_ACTION <--> PAUSED
any active --abort--> ABORTED ; READY|active --stop/abandon/cancel--> CANCELLED or (deleted)
COMPLETED --re-entry by routing (cycle)--> READY (same row id, reset in place)
any row --GOTO/RETRY/Back reset--> trace IDLE, row DELETED --> new row inserted READY (new id)
```

Re-entry by routing onto an existing row: if `COMPLETED`, reset the SAME row to `READY` with
`completed_at, error, started_at, wake_at, action_instance_id, action_server_uri,
action_invoked_oid` = NULL and delete its routing context; if `WAITING_GATE` see C.4.7; ANY other
existing state — including the terminal states `ERRORED`, `ABORTED`, `CANCELLED` — means "already
active" and the arrival is ignored (nothing is traced; the step is not run again)
[src: MissionEngine/src/core/transition.ts:924-973]. GOTO / RETRY / Back first call
`resetStepIfExists`, which records a run for an active row, traces `IDLE` and DELETES the row, so the
following activation inserts a fresh row with a new id [src: MissionEngine/src/core/transition.ts:1429-1499].

### C.2.3 Trace vocabulary

`trace_entry.state` uses the reference vocabulary, not row states. States written by the engine:
`COMPLETED`, `EXECUTING` (park point), `WAITING` (blocked on a resource), `ERRORED`, `IDLE`
(reset/deleted), `PAUSED`, `ABORTED`, `OPENED` (timed gate opened; `error` holds the cause),
`WARNING`, `OPERATOR` (operator act; `error` holds the detail), `SIGNED` (`error` =
`<login> as <role|member>`) [src: MissionEngine/src/core/context.ts:582-610],
[src: MissionEngine/src/core/submit.ts:178]. `order_index` is a per-owning-spec counter
(`engine_state.orderCounters[spec.oid]`, starting at 1; the root's counter for null-step rows);
`after_action` carries the submitted action index; `error` carries the message [src: MissionEngine/src/core/context.ts:587-605].

### C.2.4 Step runs (`step_run`)

One `step_run` row is written per execution of a step, inside the transaction that ends it
[src: MissionEngine/src/core/step-run.ts:132-191]. Results (DB CHECK) are exactly
`completed, failed, caught, aborted, stopped, cancelled, went_back`
[src: mission-control-db/src/db/schema/execution.ts:289].

| Result | Written when | Source |
|---|---|---|
| `completed` | every `COMPLETED` trace with a step oid (incl. START, joins, RETURN COMPLETE's trigger) | [src: MissionEngine/src/core/context.ts:43-45,606-609] |
| `failed` | every `ERRORED` trace with a step oid; engine give-up paths for active rows | same; [src: MissionEngine/src/core/step-run.ts:196-206] |
| `aborted` | every `ABORTED` trace with a step oid | same |
| `caught` | a failure caught by a TRY (error = failure message) | [src: MissionEngine/src/core/transition.ts:2096] |
| `stopped` | stop pass cancels an active row | [src: MissionEngine/src/core/control.ts:538-589] |
| `cancelled` | active row deleted by reset, catch-network cleanup, child teardown, ABANDON/RESTART, gate cancel, operator end; rows left active at settle | [src: MissionEngine/src/core/transition.ts:1343,1412,1465,1494,1524,1643] |
| `went_back` | the screen the operator pressed Back on | [src: MissionEngine/src/core/go-back.ts:80] |

Fields: `run_number` = existing runs of `(instance, step_oid)` + 1; `started_at` = row's
`started_at` or finish time; `performed_by_kind` = `user` when the transaction's actor
(`stepRunActor`, set by submit, Back and force-complete) matches the step, else by type
(`SCRIPT`/`MATH`→`script`, `ACTION PROXY`→`action`, `GATE`→`gate`, `USER_INTERACTION`/`YES_NO`→
`user`, else `system`); the actor is credited once; `input_parameters` = the snapshot inputs
filtered to the step's declared input ids and binding parameter ids; `output_parameters` = snapshot
outputs; `node_path` = list of `{proxyStepOid, proxyRun, workflowName}` from root to the owning
child [src: MissionEngine/src/core/step-run.ts:40-191]. A trace `IDLE` writes no run.
`step_instance_id` is the row found by `(instance, step_oid)` at the moment the run is recorded, or
NULL when no row exists yet: a WAIT ALL joined on first touch and a RETURN COMPLETE's trigger trace
`COMPLETED` BEFORE inserting their row, so those `completed` runs carry `step_instance_id = NULL` and
`started_at = finished_at` [src: MissionEngine/src/core/transition.ts:763-768,1711-1728],
[src: MissionEngine/src/core/step-run.ts:139-143,170-175]. `input_parameters`/`output_parameters` are
NULL when the step has no `stepSnapshots` entry (resp. no `outputParameters`).

---

## C.3 Scheduling and cascade algorithm

### C.3.1 Worker loop

The engine runs `ENGINE_WORKER_CONCURRENCY` (default 4) slots; each loops `runOnce`; when a cycle did
no work the slot waits for a wake notification or 1000 ms [src: MissionEngine/src/loop.ts:815-855],
[src: MissionEngine/src/config.ts:159]. `runOnce` performs at most one unit, trying in order and
returning on the first that did work [src: MissionEngine/src/loop.ts:694-785]:

1. `finalizeOrphanedActions` (pending cleanup ABORT+DELETE).
2. Acquire one `queued` instance and start it (C.1.4) — one transaction.
3. Claim one running-like instance that has a `READY` row and run `processReadyStep` — one transaction.
4. One due action step: invoke or poll/timeout (C.8.2).
5. One due `WAITING_GATE` / `WAITING_SCRIPT` row (C.4.7, C.4.4).
6. One due `WAITING_PROPERTIES` row (C.6.6).
7. One control pass on a transitional instance (C.1.6–C.1.8); it first retries queued send-failure undos.

The retention sweep and schedule tick run on their own timers (C.8.4, C.8.5).

### C.3.2 Locking

- Every unit MUST lock the instance row with `SELECT id FROM workflow_instance WHERE <status in …>
  [AND extra] ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED`, or by id with `FOR UPDATE SKIP
  LOCKED` [src: MissionEngine/src/loop.ts:44-81]. Step rows are never locked independently.
  Holding the instance row lock is the per-runtime serialization: all state changes of one instance
  happen in one transaction at a time.
- A claim that does nothing (e.g. every READY row blocked, or a raced due row) MUST bump the
  instance's `updated_at` so `ORDER BY updated_at` rotates it behind others [src: MissionEngine/src/core/transition.ts:2891-2902], [src: MissionEngine/src/loop.ts:318-325].
- Submission, Back and force-complete use claim-by-id; a busy instance fails immediately
  (`NOT_RUNNING` "is locked by another worker", or `INSTANCE_BUSY`) [src: MissionEngine/src/core/submit.ts:95-98], [src: MissionEngine/src/core/force-complete.ts:62-64].
- The submit/Back claim guard additionally locks the `instance_assignment` row `FOR UPDATE`
  [src: MissionEngine/src/core/submit.ts:142-147].
- No network call may happen while the instance lock is held: capabilities are read from a cache
  warmed before the claim; PAUSE/RESUME/STOP/ABORT/DELETE are collected and sent after commit;
  invokes, polls and property fetches run between two transactions (claim, re-arm `wake_at`, commit;
  fetch; re-claim, re-check the row, apply) [src: MissionEngine/src/core/control.ts:25-33], [src: MissionEngine/src/loop.ts:364-475].
- Environment-resource registry rows are locked inside the instance transaction in ascending name
  order (only names the recipe references); shared value-property writes are flushed sorted by
  `(propertyName, entryName)` [src: MissionEngine/src/core/context.ts:715-737], [src: MissionEngine/src/core/shared-properties.ts:89-102].
- At the tail of every instance-claiming transaction the engine MUST reconcile assignments and, if
  changed, `pg_notify('operator_change', <work_center_id>)` [src: MissionEngine/src/core/reconcile.ts:19-30].

### C.3.3 Context and persistence

Each transaction opens a root context from the row (`openContext`): loads `engine_state` (missing
keys default), `property_store`, the workflow-tier resource manager from `engine_state.resources`,
the work-center shared value tier, and (when the recipe references environment resources) hydrates
the environment tier under registry locks and recomputes revoked holds
[src: MissionEngine/src/core/context.ts:715-803]. `persist()` (root only) writes, in order: dirty
shared values; the environment registry diff + grant notifications + foreign-release takeovers;
then `engine_state` (with `resources` = local manager JSON) and `property_store` (root local store
only) and `updated_at` [src: MissionEngine/src/core/context.ts:616-691]. A view's properties are
stored in `engine_state.childProperties[childSpecOid]` [src: MissionEngine/src/core/context.ts:546-559].

### C.3.4 EngineState (`workflow_instance.engine_state`)

Plain JSON; missing keys (and `null` for any key) MUST default as listed; keys NOT in this table are
DISCARDED on load and therefore dropped by the next persist (the loader copies only the listed keys)
[src: MissionEngine/src/core/engine-state.ts:286-361]. `operatorCleanup.pendingAborts` defaults to `[]`
when an `operatorCleanup` object lacks it. Two narrow writers bypass the full persist with `jsonb_set`:
`envHoldsRevoked := []` at terminal settle and `operatorCleanup := <object>` when queuing live cleanup
actions; `pendingAborts` is also rewritten by `finalizeOrphanedActions`
[src: MissionEngine/src/core/context.ts:1176-1181,1203-1207], [src: MissionEngine/src/core/operator-cleanup-flow.ts:328-340].

| Key | Type | Default | Meaning |
|---|---|---|---|
| `orderCounters` | `{[specOid]: number}` | `{}` | Trace order counter per owning spec. |
| `routingContext` | `{[stepOid]: RoutingResult}` | `{}` | Routing decision of SELECT 1 / YES_NO / button press. |
| `waitAll` | `{[stepOid]: {expected: string[], completed: string[]}}` | `{}` | Join tracking. |
| `activeCatches` | `{[catchStepOid]: CatchContext}` | `{}` | Armed catches. CatchContext = `{catch_oid, trigger_step_oid, trigger_step_name, trigger_reason, error_message, activated_at}`. |
| `resources` | serialized manager or `null` | `null` | Workflow-tier resource pools. |
| `stepSnapshots` | `{[stepOid]: {inputParameters, outputParameters?}}` | `{}` | Per-step parameter snapshot (history). |
| `childActive` | `{[proxyStepOid]: childSpecOid}` | `{}` | Running children. |
| `childProperties` | `{[childSpecOid]: {[key]: string}}` | `{}` | Child property stores. |
| `blockedOnResources` | `{[stepOid]: {stepOid, blockedOn?:{resource_name, command_type}, remainingCommands, completionCommands}}` | `{}` | Steps waiting on a resource. |
| `deferredRouting` | `string[]` | `[]` | Completed while paused; route on resume. |
| `deferredFailures` | `[{stepOid, mode, message}]` | `[]` | Failed while paused; replay on resume. |
| `pausedAt` | `{[stepOid]: epochMs}` | `{}` | |
| `stoppedActions` | `string[]` | `[]` | STOP attempted this drain. |
| `controlPassAttempts` | number | `0` | |
| `userActionCounter` | number | `0` | Source of `'auto'` action indices (post-increment). |
| `releasedOnCatch` | `{[stepOid]: true}` | `{}` | Release already ran at catch time. |
| `resolvedAmounts` | `{[stepOid]: {[cmdKey]: number}}` | `{}` | Frozen property-sourced Acquire counts. |
| `armedGates` | `{[gateOid]: {predecessorOid, open, stopSent}}` | `{}` | |
| `scriptRuns` | `{[stepOid]: {state, pendingOutputs}}` | `{}` | Repeating script memory. |
| `envHolds` | `[{name, stepOid, amount, heldName}]` | `[]` | Environment holds of this instance. |
| `envHoldsRevoked` | same shape | `[]` | Holds removed out of band. |
| `pausingSince` | epochMs or `null` | `null` | |
| `pauseUndeliveredWarned`, `pauseUnreachableWarned`, `pauseRefused` | `string[]` | `[]` | |
| `pollFailingSince` | `{[stepOid]: epochMs}` | `{}` | |
| `pollWarned` | `string[]` | `[]` | |
| `operatorCleanup` | object or `null` | `null` | `{kind, phase:'halting'|'cleanup', catchOid, haltStartedAt, cleanupStartedAt, inheritedHolds, inheritedUse, abortPending, pendingAborts:[{stepRowId, serverUri, actionInstanceId, queuedAt}]}` |
| `backFrom` | `{[stepOid]: string|null}` | `{}` | Back target per step. |
| `lastFormValues` | `{[stepOid]: object}` | `{}` | Last submitted form values (verbatim). |
| `backPrefill` | `{[stepOid]: object}` | `{}` | Prefill for a screen reopened by Back. |

Pre-start only: `startAttempts` (number) may be present on a `queued` row [src: MissionEngine/src/loop.ts:135-167].

### C.3.5 processReadyStep

```
processReadyStep(instance):                          [src: MissionEngine/src/core/transition.ts:2847-2957]
  if status not running-like: return false
  ctx = openContext(instance)
  ready = rows WHERE state='READY' ORDER BY created_at, id
  for each ready row blocked (blockedOnResources) on an ENVIRONMENT command whose resource is
      hydrated and whose token "<instanceId>::<stepOid>" is in no queue and no pending grant of the
      environment manager:                            -- an operator cancelled the wait
     failStep(ERROR, 'Resource "<name>": wait cancelled by an operator')
     if settled: return true
     settleIfComplete(row.node_oid)
  if any was failed: persist; return true
  target = first ready row with no blockedOnResources entry
  if none:
     if ready non-empty: {settled, resumedAny} = resumeGrantedSteps
                         if settled return true
                         if resumedAny: persist; return true
                         bump updated_at
     return false
  stepCtx = contextForNode(target.node_oid)
  stepDef missing -> throw 'step "<oid>" not found in spec "<specOid>"'
  if outside cleanup network (C.1.9): end the cleanup; return true
  if step has resource commands: tryActivateResources
     bad count  -> failStep(ERROR, nothingHeld); if settled return true;
                   settleIfComplete(target.node_oid); persist; return true
     blocked    -> trace WAITING; if resumeGrantedSteps settled return true; persist; return true
  r = runStepActivation(target)
  if r.settled return true
  if r.completed: if drainCascade(stepCtx,[target]) settled return true
  settleIfComplete(target.node_oid); persist; return true
```
[src: MissionEngine/src/core/transition.ts:2793-2831] for the cancelled-wait pass.

Under eager activation (below) almost nothing stays READY unblocked; this function is the recovery
path and the entry point for grant resumption.

### C.3.6 drainCascade / materializeAndActivate / activateAndCascade

Each context (root or view) owns a persistent FIFO `cascadeQueue` and a `cascadeDraining` flag. The
cascade is breadth-first, mirroring the reference engine's completion queue
[src: MissionEngine/src/core/transition.ts:997-1144].

```
drainCascade(ctx, seed):
  ctx.cascadeQueue.push(...seed)
  if ctx.cascadeDraining: return false                 -- re-entrant: outer loop will process
  ctx.cascadeDraining = true
  loop:
    while queue not empty:
      if ctx.dead: clear queue; return false
      s = queue.shift()
      if s has resource commands:
         if releasedOnCatch[s]: delete it
         else: releaseResourceCompletionCommands(s)  -- Release / Release Pool Amount; bad counts
                                                     --  -> null-step ERRORED trace, nothing released
         if resumeGrantedSteps(ctx) settled: return true
      out = getRoutedConnections(ctx, s)             -- C.5
      carry = carriedBackTarget(type(s), s, backFrom[s], len(out))   -- C.7
      for conn in out:
        if ctx.dead: break
        t = conn.to_step_id (skip if not in spec)
        if type(t) == 'WAIT ALL':
           backFrom[t] = null
           refuse if outside cleanup -> return true
           if waitAllArrival(t, source=s): queue.push(t)
        else:
           if root.cascadeActivationCount >= 10000: throw CascadeExceededError
           root.cascadeActivationCount++
           r = materializeAndActivate(t, backTarget = isJoin(t) ? null : carry)
           if r.settled: return true
           if r.completed: queue.push(t)
    if ctx.dead: clear; return false
    swept = sweepPendingWaitAlls(ctx)
    if swept empty: break
    queue.push(...swept)
  return false
  finally ctx.cascadeDraining = false
```

```
materializeAndActivate(ctx, t, backTarget?):          [src: MissionEngine/src/core/transition.ts:914-995]
  if ctx.dead: return {false,false}
  refuse if outside cleanup -> {settled:true}
  row = existing row for t
  if row:
     if row.state == 'WAITING_GATE': (armed gate) if armedGates[t].open: delete entry, set
          backFrom[t] if given, trace COMPLETED, row COMPLETED -> {completed:true}
        else -> {false,false}   (gate keeps holding)
     if row.state != 'COMPLETED' -> {false,false}   (no re-entry onto a live step)
     reset row to READY (C.2.2), delete routingContext[t]
  else insert row READY (node_oid = ctx.spec.oid, step_type canonical)
  if backTarget given: backFrom[t] = backTarget
  if step has resource commands:
     g = tryActivateResources(t)
     bad count -> settled = failStep(ERROR, nothingHeld); return {settled, false}
     blocked   -> trace WAITING; resumeGrantedSteps; return {settled, false}  (row stays READY)
  return runStepActivation(t)

activateAndCascade(ctx, t, source):                   [src: MissionEngine/src/core/transition.ts:1150-1167]
  refuse if outside cleanup -> true
  if type(t) == 'WAIT ALL': if waitAllArrival(t, source): return drainCascade([t]); return false
  r = materializeAndActivate(t)        -- no back target: backFrom[t] is left as it was
  if r.settled return true; if r.completed return drainCascade([t]); return false
```

`activateAndCascade` is used for GOTO/RETRY targets, a CATCH entered by failStep, the operator
cleanup CATCH, and the screen reopened by Back.

**`runStepActivation(t, overlay?)`** [src: MissionEngine/src/core/transition.ts:2360-2513]:
1. Resolve input parameters (C.6.4). If no overlay, the type is not GATE, and the step has
   step-level `action_property_bindings`: set row `WAITING_PROPERTIES`, `started_at=wake_at=now`,
   return (no trace). With an overlay, overlay the fetched values.
2. `stepSnapshots[t] = {inputParameters}`.
3. Dispatch by canonical type (C.4). Auto-completing types end with `finishStep` (trace
   `COMPLETED` [with after_action], row `COMPLETED`, `completed_at`, `wake_at=null`) and return
   `completed:true`. finishStep never routes; the caller's queue does.

**`resumeGrantedSteps(ctx)`** [src: MissionEngine/src/core/transition.ts:605-713]: flush pending
grants from the workflow-tier manager and from the environment manager (this instance's tokens
only). For each grant: deliver sync data to the step's `Receive.target`
(`setSyncTarget`), deliver a reserved named-pool name to the Acquire `target`, append an envHolds
entry for an environment Acquire; continue the remaining activation commands; if blocked again trace
`WAITING`; otherwise `runStepActivation` on the row, drain its cascade if completed, then
`settleIfComplete(row.node_oid)`.

### C.3.7 Joins

**WAIT ALL** [src: MissionEngine/src/core/transition.ts:717-860]:
- `expected` = distinct `from_step_id`s of all connections into the join (in the join's own spec).
- First arrival (no row): `completed` = arriving source ∪ incoming predecessors whose rows are
  already `COMPLETED`. If `|completed| >= |expected|` (and expected non-empty): trace `COMPLETED`,
  insert row `COMPLETED` → returns joined. Else trace `EXECUTING`, insert row `EXECUTING`.
- Later arrival on an `EXECUTING` row: add source; when `|completed| >= |expected|` trace
  `COMPLETED`, row `COMPLETED` → joined. Arrival on any other existing state — INCLUDING `COMPLETED`
  — is ignored: unlike every other step type, a WAIT ALL is never re-entered by routing, so a cycle
  that loops back through an already-joined WAIT ALL stops there unless something (GOTO, RETRY,
  RESTART) deleted its row first [src: MissionEngine/src/core/transition.ts:781].
- On first touch the trace is written BEFORE the row is inserted (see C.2.4); `started_at` is set on
  the row either way.
- **Sweep** after each full drain: for each untouched WAIT ALL (no row) in spec order whose every
  incoming predecessor has a row: trace `EXECUTING`, insert `EXECUTING`; if all predecessors are
  already `COMPLETED`, trace `COMPLETED`, row `COMPLETED`, and re-seed the cascade with it.
- [pinned: exec-parallel-001 … exec-parallel-005] The exact trace orders, e.g. exec-parallel-001:
  `start:COMPLETED, parallel:COMPLETED, ui-a:EXECUTING, ui-b:EXECUTING, wait-all:EXECUTING,
  ui-a:COMPLETED@0, ui-b:COMPLETED@1, wait-all:COMPLETED, end:COMPLETED`; exec-parallel-002 (two
  scripts): no `wait-all:EXECUTING`, straight to `COMPLETED`; exec-parallel-004 (nested): inner join
  swept before outer.

**WAIT ANY** is an ordinary auto-completing step: every arrival materializes/re-enters it and it
completes and routes its successors again (no "first arrival only" latch)
[src: MissionEngine/src/core/transition.ts:2470-2476,946-965]. A join never carries a back target.

### C.3.8 Sub-workflows and child views

- A child spec executes as step rows of the SAME instance, `node_oid = child.oid`, sharing
  `engine_state`, the workflow-tier resource manager, the shared value tier and the environment tier;
  it has its own property store and its own trace counter [src: MissionEngine/src/core/context.ts:263-301].
- Views are memoized per child oid per transaction; a torn-down child's view is marked `dead`,
  which stops any cascade over it [src: MissionEngine/src/core/context.ts:496-524].
- The history/conformance trace is assembled per spec by `order_index` (ties by id), splicing a
  completed child's whole trace immediately before the parent WORKFLOW PROXY's `COMPLETED` entry,
  and appending still-active children (ordered by their first row id) at the end of the owning
  spec's trace; null-step rows belong to the root [src: MissionEngine/src/core/trace-assembly.ts:73-142].

---

## C.4 Per-step-type behaviour

### C.4.1 Canonical step type

The engine MUST canonicalize `SELECT_1` to `SELECT 1` and leave every other value unchanged
[src: MissionEngine/src/core/step-handlers.ts:31-34]. Supported canonical types: `START`, `END`,
`PARALLEL`, `MATH`, `WAIT ANY`, `WAIT ALL`, `SELECT 1`, `CATCH`, `SCRIPT`, `RETURN`, `WORKFLOW
PROXY`, `GATE`, `USER_INTERACTION`, `YES_NO`, `ACTION PROXY`. Any other type reaching activation
MUST throw `engine v1: step type "<t>" is not yet supported` (instance settles errored via C.1.10)
[src: MissionEngine/src/core/transition.ts:2502-2508].

### C.4.2 START, END, PARALLEL, MATH, WAIT ANY

Auto-complete with no side effects [src: MissionEngine/src/core/transition.ts:2471-2476]. START is
traced `COMPLETED` without a row at instance start, RESTART and child activation. PARALLEL routes to
all outgoing connections (no routing context). END completing is what C.1.5 tests.
[pinned: exec-linear-001]

### C.4.3 USER_INTERACTION and YES_NO (screens)

Activation: trace `EXECUTING`; row `WAITING_USER`, `started_at=now`, `wake_at=null`
[src: MissionEngine/src/core/transition.ts:2439-2446]. The operator offer is created by assignment
reconciliation. [pinned: exec-linear-002, exec-ui-001]

Submission (`submitUserAction`) [src: MissionEngine/src/core/submit.ts:86-322]:
1. Claim instance by id; require status running-like, or `paused/pausing/resuming` for a non-`fail`
   action; else `EngineError('NOT_RUNNING')`.
2. `idx` = numeric index given, or for `'auto'` the post-incremented `userActionCounter`.
3. Target row by `step_oid`; missing → error `Step <oid> not found`.
4. If a claim is given: the assignment row (locked `FOR UPDATE`) must have `status='claimed'`,
   `assigned_user_id = userId`, `step_instance_id = target.id`, else `NOT_CLAIMANT`.
5. If a verified e-signature is given: insert `step_signature` (`outcome='signed'`), trace `SIGNED`
   `<login> as <role or "member">`, and if the block's `fieldName` is non-empty set
   `form_values[fieldName] = signer display name` (C.4.13).
6. `pause`/`resume` handled as C.1.6.
7. Row must be `WAITING_USER` or `WAITING_ACTION`, and must not be a WORKFLOW PROXY with an active
   child; else error `Step <oid> is not EXECUTING`.
8. Set the step-run actor to the claimant.
9. `fail` → `failStep(mode = failure_mode ?? 'ERROR', error, after_action = idx)`; settleIfComplete; persist.
10. Otherwise compute routing (C.5): USER_INTERACTION captures form outputs; `button_press` sets
    `conditionValue = button_output`. YES_NO captures form outputs and sets
    `{conditionValue: button_output, sourceHandleId: button_output ?? '', excludeUnconditional:
    true}` [src: MissionEngine/src/core/step-handlers.ts:151-184].
    The branch is chosen by `step_type` as written (not canonicalized). For YES_NO the decision
    comes ONLY from `button_output` (the action name — `yes`, `no`, `submit`, `button_press` — is
    ignored); for USER_INTERACTION only an action of exactly `button_press` stores a decision. A YES_NO
    submitted without a non-empty `button_output` stores no routing context and therefore routes ALL
    its outgoing connections; any other step type (e.g. ACTION PROXY via submit) stores none either.
11. For screens: `lastFormValues[step] = shallow copy of form_values` (after the e-signature
    override), delete `backPrefill[step]`.
12. Snapshot outputs — only if `stepSnapshots[step]` exists: start from its existing
    `outputParameters`; for each output spec, key `target ?? id` (nullish: an empty-string target is
    kept as key `''`), value `props.get(key)` (local, else shared) when defined; then, if
    `form_values` was given, for each form element with a truthy `outputParameter`, key = the
    matching spec's `target ?? outputParameter`, value `props.get(key)` when defined.
13. Store `routingContext[step]` only if `conditionValue` or `connectionId` is truthy (non-empty).
14. `finishStep` with `after_action = idx`; if routing is held (paused) append to `deferredRouting`
    and persist; else `drainCascade`, `settleIfComplete`, persist.

A submit to a `WAITING_ACTION` ACTION PROXY row (no claim) completes it like a user step (no
outputs mapped) [pinned: exec-try-catch-002 second action].
[pinned: exec-linear-003/005 (after_action 0..n), exec-ui-002 (array → JSON string), exec-ui-005]

### C.4.4 SCRIPT (one-shot and repeating)

One-shot [src: MissionEngine/src/core/step-handlers.ts:265-283,422-435], [src: MissionEngine/src/core/transition.ts:2491-2501]:
- No `script_config.source` (absent or empty string) → succeed with no effect.
- The source is compiled as the BODY of a non-strict JavaScript function (`Function(p1,…,pn,'output',
  source)`) inside a fresh ECMAScript realm whose global object has a null prototype and holds only
  the standard built-ins (no `console`, `require`, timers, network or file APIs), and called with one
  positional string argument per entry of the step's resolved input map, in that map's key order and
  named by the key, plus `output` (a plain object) [src: MissionEngine/src/core/step-handlers.ts:313-352],
  [src: MissionEngine/src/core/script-pool.ts:74-86]. The input map is the step's input parameters
  plus, ONLY within the instance-start transaction, the starting parameters not shadowed by an input
  (C.6.4). A key that is not a valid JavaScript identifier makes the compile throw (a step failure).
  The function's return value is ignored. Promise jobs queued by the script run before the result is
  read, inside the same time budget. Timeout = `SCRIPT_TIMEOUT_MS` (default 5000) wall-clock ms.
  Each run executes on a worker thread (pool size = `ENGINE_WORKER_CONCURRENCY`, heap cap 256 MB per
  worker; a worker that does not answer within timeout + 2000 ms is killed and the run fails with
  `Error: Script execution timed out after <ms>ms`) [src: MissionEngine/src/core/script-pool.ts:33-38,130-140].
- A throw → failure with message `String(thrown value)` computed inside the sandbox (e.g. `Error:
  boom`, `ReferenceError: x is not defined`, `throw 7` → `7`); a timeout → `Script execution timed out
  after <ms>ms`; an unreadable error → `Script failed (its error could not be read)`; an unparseable or
  wrongly shaped result envelope → `Script result is not readable`
  [src: MissionEngine/src/core/step-handlers.ts:204-248,394-417]. Failure → `failStep(ERROR, message)`.
- Outputs: each value `String()`-ed in the sandbox (JavaScript `String()`; C.11), `undefined` →
  `null`. With a non-empty `output_parameter_specifications`: only the spec ids that are OWN
  properties of `output` are read; for each such spec that has a truthy `target`, write
  `target = value ?? ''` (via `set`, C.6.2). Without specs (absent or empty): every own key of
  `output` with a non-null value is written as a property key directly, in the object's key order.
  Then the snapshot: for EVERY spec with a truthy target, `outputParameters[spec.id] =
  props.get(target)` when defined — this also records a target's pre-existing value when the script
  did not set it [src: MissionEngine/src/core/step-handlers.ts:422-435], [src: MissionEngine/src/core/transition.ts:2211-2221].
  [pinned: res-binary-001, res-binary-002, res-countable-001, res-sync-002 (`output.x = '…'` mapped to
  its target through `output_parameter_specifications`)]

Repeating (`script_config.repeat` is an object) [src: MissionEngine/src/core/step-handlers.ts:439-542], [src: MissionEngine/src/core/transition.ts:2232-2257], [src: MissionEngine/src/core/repeating-script.ts:37-94]:
- `script_config.repeat` must be a non-array object to count as repeating. `cycle_seconds` default 5
  (non-number or < 1 → 5; fractional values ≥ 1 are kept); `time_limit_seconds` optional (non-number
  → no limit); `on_time_limit` exactly `'complete'`, anything else means `'error'`.
- Each run also receives `state` (the previous run's state, `{}` first). The source runs inside an
  inner function so a `return` in it is the verdict and `state = {…}` rebinds the state that is kept;
  the run is "done" iff that verdict is exactly `true` (`===`). After the run the state is
  `JSON.stringify`-ed in the sandbox: a throw → `Script state is not JSON`; `undefined` (e.g. a
  function) → the next state is `{}`. State JSON and `JSON.stringify(outputs)` are each limited to
  65536 UTF-8 bytes (`Script state exceeds 64 KB`, `Script outputs exceed 64 KB`). No source → done at
  once with no outputs [src: MissionEngine/src/core/step-handlers.ts:354-379,503-542].
- First run inside the activation transaction: error → failStep(ERROR); done → commit outputs and
  complete; else save `scriptRuns[step] = {state, pendingOutputs}`, trace `EXECUTING`, row
  `WAITING_SCRIPT`, `started_at=now`, `wake_at = min(now+cycle, started_at+limit)`, notify the work
  center.
- Due run: if `now >= started_at + limit`: `complete` → trace `WARNING` `Script time limit (<d>)
  reached — completed with its current outputs` and complete with pending outputs; `error` → fail
  `Script time limit (<d>) reached`. Otherwise re-resolve inputs (+ fresh binding overlay), run with
  saved state: error → fail; done → commit this run's outputs and complete; else save and re-arm.
- `<d>` is formatted from `floor(max(0, seconds))` as every non-zero unit largest first among
  `wk` (604800 s), `d` (86400), `h` (3600), `min` (60), `s` (1), each as `<n> <unit>`, joined by single
  spaces, `0 s` for zero (e.g. 7810 → `2 h 10 min 10 s`) [src: MissionEngine/src/core/step-handlers.ts:593-606].
- Neither a gate's nor a repeating script's `started_at` is shifted by a pause: their deadlines keep
  running while the instance is paused, and the resume pass makes them due at once (C.1.6).
[pinned: exec-parallel-002/005 (comment-only scripts auto-complete)]

### C.4.5 SELECT 1

`handleSelect1` [src: MissionEngine/src/core/step-handlers.ts:91-149]:
- No config or no options → no routing context (all outgoing connections fire).
- Input value: if `input_value_type === 'property'` and `input_name` is non-empty: the step's
  resolved input parameter named `input_name`, else `props.get(input_name)` (exact key, local then
  shared — NO group merge, unlike `resolveKey`), else `''`; otherwise the literal `input_name` (`''`
  when empty or absent).
- Options in order, skipping (but remembering) `is_default` ones; compare value = literal `value`,
  or for `value_type:'property'` the input parameter / property named by `value` (else `''`).
- First option whose operator holds → `routingContext[step] = {connectionId: option.id}`. No match
  → the default option's id; no default → no routing context.
- Operators on strings (case-sensitive, JavaScript string comparison — lexicographic over UTF-16
  code units, not numeric, not locale-aware): `==`, `!=`, `<`, `>`, `<=`, `>=`, `Contains` (substring;
  an empty `value` always matches), `Not Contains`; any other operator string (case-sensitive) is false.
[pinned: exec-branch-004 (`==` on a property input), exec-branch-005 (no match → `is_default`
option; its own operator/value are never evaluated), exec-branch-006 (`Contains`); all three spell
the type `SELECT_1`, so they also pin the `SELECT_1` → `SELECT 1` canonicalization, and all three
trace the SELECT 1 step only as `COMPLETED` (no `EXECUTING`)]

### C.4.6 ACTION PROXY

Activation [src: MissionEngine/src/core/transition.ts:2409-2467]: trace `EXECUTING`; row
`WAITING_ACTION`, `started_at=now`, action columns NULL, `wake_at = now` when the invoker
dispatches (production), NULL otherwise (conformance: the step simply waits) [pinned:
exec-action-proxy-001: trace `step-start:COMPLETED, step-act:EXECUTING`, state RUNNING]. If the
step's only routed successor is a GATE with `gate_config.control_previous_action === true`, arm that
gate now (C.4.7).

Invoke/poll/terminal handling is specified in C.8.2. Terminal mapping: server `COMPLETED` →
complete; `ABORTED` → fail mode `ABORT`; `STOPPED` → fail mode `ABORT`, except when an armed gate
on this step is open → complete; `ERRORED` → fail `ERROR`; engine timeout → fail `TIMEOUT` message
`action timed out` [src: MissionEngine/src/actions/monitor.ts:57-95,195-204]. On complete, outputs
come from a fresh REST-04 snapshot fetched before the lock: for each output spec with a target, the
server output whose `name === spec.id`; a target containing `.` is set directly, a bare target goes
through `setSyncTarget` (a JSON `[{name,value}]` list also writes `target.name` entries)
[src: MissionEngine/src/actions/monitor.ts:206-226]. Default failure message: `action <kind>` lower-case.

### C.4.7 GATE (condition, timer, condition_or_timer, armed)

Config defaults: `cycle_seconds` non-number or < 1 → 5; `mode` absent/unknown → `condition`;
deadline = `started_at + delay_seconds` for timed modes (none when `delay_seconds` is not a number)
[src: MissionEngine/src/core/step-handlers.ts:544-591]. A timed gate with no computable deadline counts
as EXPIRED (it opens on its first due evaluation with cause `timer (0 s)`), never as a wake-now loop.
Next wake: `timer` → deadline (or now if none); otherwise `min(now + cycle, deadline)`.
The gate script is compiled like a SCRIPT (C.4.4) but with NO `output` parameter; its return value is
converted to a boolean with JavaScript truthiness inside the sandbox (`false`, `0`, `-0`, `0n`, `''`,
`null`, `undefined`, `NaN` are false; everything else, including `'false'` and `{}`, is true).
`gateUsesBindings` = mode ≠ timer and `gate_config.action_property_bindings` non-empty.

Activation [src: MissionEngine/src/core/transition.ts:2269-2299]: trace `EXECUTING`. If mode ≠
timer and no bindings: run the gate script inline (inputs as SCRIPT, no `output`, verdict
JS-truthy; no source → open). Error → failStep(ERROR). Open → (condition_or_timer: trace `OPENED`
with error `condition`) complete. Otherwise park `WAITING_GATE`, `started_at=now`, `wake_at = now`
(bindings) or next wake; notify the work center unless mode is `condition`.

Due evaluation (`processDueGateWork`, running-like instances only) [src: MissionEngine/src/core/gate.ts:46-121,254-389]:
1. Open armed gate: retry a pending STOP every 5000 ms while the predecessor is live; else `wake_at=null`.
2. Expired timed gate: trace `OPENED` with `timer (<duration of delay_seconds>)`, open.
3. `timer` not expired: re-sleep to the deadline.
4. Re-resolve inputs, apply binding overlay (fetched outside the lock; fetch failure → failStep
   ERROR with the fetch message), snapshot, run script: error → failStep; false → re-arm; true →
   (condition_or_timer: trace `OPENED` `condition`) open.

Open (`openGateOnClaim`) [src: MissionEngine/src/core/gate.ts:128-161]: not armed → complete,
cascade, settle-if-complete. Armed and predecessor live → `open=true`, attempt STOP. Armed and
predecessor `COMPLETED` → delete entry, complete. Otherwise `open=true`, `wake_at=null`.

Armed gates [src: MissionEngine/src/core/transition.ts:2313-2337]: armed at the ACTION PROXY park:
row `WAITING_GATE`, `started_at = wake_at = now`, trace `EXECUTING`, `armedGates[gate] =
{predecessorOid, open:false, stopSent:false}`; an existing terminal row is reset; a live row is
left alone. When the predecessor completes and routes into the gate: open → complete now; closed →
hold (no completion; it completes later when it turns true). STOP attempt: no client → trace
`WARNING` `gate opened but the running action does not support STOP — waiting for natural
completion`, handled; not yet dispatched → retry in 5000 ms; `supported` → STOP after commit,
predecessor `wake_at=now`, handled; `unsupported` → same WARNING, handled; `unknown` → retry
[src: MissionEngine/src/core/gate.ts:175-228]. A failing predecessor cancels a live armed gate row
(`CANCELLED`, step run `cancelled`) [src: MissionEngine/src/core/transition.ts:2000-2014].

Force complete (Commander/Pilot) [src: MissionEngine/src/core/force-complete.ts:49-102]: errors
`RUNTIME_NOT_FOUND`, `INSTANCE_PAUSED` (paused/pausing: "Resume the workflow first"),
`RUNTIME_INVALID_STATE`, `INSTANCE_BUSY`, `STEP_NOT_FOUND`, `ALREADY_COMPLETED` (row not
`WAITING_GATE`/`WAITING_SCRIPT`), `NOT_FORCEABLE` (Pilot on a `condition` gate), `ALREADY_OPEN`.
On success: trace `OPERATOR` `Forced complete[: <reason>] [by <userId>]`, actor credited, then the
same open path (gate) or completion with pending outputs (repeating script).

### C.4.8 WORKFLOW PROXY (sub-workflow)

Activation [src: MissionEngine/src/core/transition.ts:2545-2665]:
1. Child spec = first entry of the owning spec's `children` whose `local_id` equals the step's
   `local_id`. None → auto-complete (no-op).
2. Starting params: for each child starting parameter whose id equals a step input parameter id,
   value = the step's resolved input value (or its `default_value`).
3. Fresh child every activation: delete the child's order counter, clear all step-scoped state for
   the child's step oids, empty `childProperties[child.oid]`, drop its view. Child store = child
   value properties, then a copy of the parent's LOCAL flat store, then starting params.
4. Register the child's non-environment resources under `<child.oid>:<name>` (no-op if present).
5. Trace `EXECUTING`; row `WAITING_ACTION` (action instance NULL, no `wake_at`);
   `childActive[step] = child.oid`.
6. Child START: trace `COMPLETED` (child counter), `drainCascade(childCtx, [START])`, then
   `settleIfComplete(child)`. (No child START → parent stays parked.)

Child completion: complete when some child END row is `COMPLETED` and no child-node row is
non-terminal [src: MissionEngine/src/core/transition.ts:2675-2683]. Then delete `childActive`, for
each child output spec whose id matches a proxy output spec with a `target`, set
`owner.target = childProps[childOutput.id] ?? ''`, trace `COMPLETED`, row `COMPLETED`, drain the
owner's cascade, and recurse upward [src: MissionEngine/src/core/transition.ts:2698-2770].

Failure escalation: an uncaught failure in a child (no step or child-workflow-level TRY) tears the
child subtree down (rows deleted, `cancelled` runs, queued waiters dropped) and fails the proxy step
in the parent with the same mode and message `Uncaught <MODE> in child workflow '<child local_id>'
at step '<step local_id>'[: <error>]` [src: MissionEngine/src/core/transition.ts:1881-1953].
RETURN ABANDON or a malformed RETURN inside a child does NOT settle the instance (see Open points).
The three child fixtures are skipped in conformance (known reference failures)
[src: MissionEngine/src/conformance/PROVENANCE.md:30-39].

### C.4.9 TRY / CATCH / RETURN

**failStep(step, mode, error, actionIndex?, {nothingHeld?})** [src: MissionEngine/src/core/transition.ts:1984-2156]:
1. Clear `resolvedAmounts[step]`, `armedGates[step]`, `scriptRuns[step]`; cancel any live armed gate
   whose predecessor is this step.
2. Matching TRY: the step's own row with this mode, else (not in cleanup) the owning spec's
   workflow-level row with this mode; a row whose `catch_id` names no CATCH in this spec is skipped.
   [pinned: exec-try-catch-009/010/011 workflow-level fallback; exec-try-catch-012 step beats workflow]
3. Matching CATCH already in `activeCatches` → **CATCH_REENTRY**: trace `ERRORED` `CATCH_REENTRY on
   <catch_id>`, row `ERRORED`, persist, settle `aborted` (or end cleanup as failure).
4. Caught: `activeCatches[catch] = {catch_oid, trigger_step_oid, trigger_step_name:
   step.local_id, trigger_reason: mode, error_message, activated_at}`. Resources: `nothingHeld` →
   mark `releasedOnCatch`; else if `release_on_catch !== false` (default true) and the step has
   resource commands, run its Release commands now, mark `releasedOnCatch`, resume grants. Record
   step run `caught`, trace `IDLE` (with after_action), delete the row, drop its blocked record,
   `activateAndCascade(catch)`.
5. Uncaught: trace `ERRORED` (with after_action and message), row `ERRORED` (`error`, `completed_at`,
   `wake_at = NULL`), drop its blocked record; in a child (with a mode) → escalate; at the root →
   cancel the queued resource waiters of every known step of the instance (root steps plus the steps
   of active children, both tiers; held units stay held), persist, settle `errored` — or, while a
   cleanup is active, end the cleanup with `step failed: <error ?? mode ?? 'failed'>`.
   [pinned: exec-try-catch-006 → ERRORED]

**CATCH** activation writes trigger info to its output targets by output id: `Message` →
`error_message ?? ''`, `Reason` → `trigger_reason`, `Step` → `trigger_step_name`, `StepID` →
`trigger_step_oid`; other ids ignored [src: MissionEngine/src/core/step-handlers.ts:638-656].
[pinned: exec-try-catch-007 — CATCH outputs `Reason→FailureContext.Mode`, `Message→…Message`,
`Step→…Step`, `StepID→…StepID` end as `"ERROR"`, `"thermocouple failure"`, `"Action"` (the trigger's
`local_id`), `"s2"` (its oid)]

**Catch network** = BFS closure over outgoing edges from a CATCH, counted only if it contains a
RETURN [src: MissionEngine/src/spec/catch-network.ts:26-67].

**RETURN dispatch** [src: MissionEngine/src/core/transition.ts:1783-1871]:
- Missing/unknown command → `errorReturnStep`: trace `ERRORED` (`RETURN has no return_config` /
  `RETURN has unknown command '<c>'` / `RETURN GOTO target not found: '<oid|none>'`), row
  `ERRORED`; at root persist + settle `errored` with reason `step failed: <reason>`.
- Else trace `COMPLETED`, row `COMPLETED`; find the active catch whose network contains this RETURN.
- Operator cleanup handling (C.1.9).
- `ABANDON`: every active row of this spec → child teardown, `cancelled` run, trace `IDLE`, delete;
  READY rows → `CANCELLED`; drop queued waiters; at the root settle `aborted`.
  [pinned: exec-try-catch-001/007/009/011 → ABORTED]
- `RESTART` (`restart_mode` default `KEEP`): every row of this spec → child teardown, `cancelled`
  run if active, trace `IDLE`; delete rows; clear all step-scoped state; drop waiters; `CLEAN`
  re-initialises the spec's value properties to declared defaults (other keys remain); trace START
  `COMPLETED` and drain from START. [pinned: exec-try-catch-004 (KEEP keeps `FailureContext.Mode=ERROR`),
  exec-try-catch-005 (CLEAN resets it to `""`); both end RUNNING at the re-parked action]
- `GOTO`: reset the target if it has a row, then `activateAndCascade(target)`. [pinned: exec-try-catch-003]
- `RETRY`: reset the trigger step and `activateAndCascade(trigger)`. [pinned: exec-try-catch-002]
- `COMPLETE`: trace trigger `COMPLETED`, insert/update its row `COMPLETED`, `drainCascade([trigger])`
  (its releases run unless already released at catch time). [pinned: exec-try-catch-008/010/012 → COMPLETED]
- Afterwards: every row of the catch network → `cancelled` run if active, trace `IDLE`, delete;
  delete the active catch. If ABANDON at root (or a nested settle): persist and settle `aborted`
  (no-op if already settled).

### C.4.10 Resource commands on a step

(The resource model itself is specified in the resources section.) Activation commands (`Acquire`,
`Acquire Pool Amount`, `Send`, `Receive`, `Synchronize`) run before the step's own activation, sync
commands first, then by `resource_name`; each routes to the workflow tier (`<source_oid or spec
oid>:<name>`) or the environment tier (`resource_source_oid` names an environment, or
`resource_source_type:'environment'` with a declared name) [src: MissionEngine/src/core/resources.ts:656-686],
[src: MissionEngine/src/core/env-scope.ts:82-91]. A blocked command leaves the row `READY` with trace
`WAITING`; later commands continue from where it blocked. A property-sourced `Acquire Pool Amount`
count is read once at the fresh attempt and MUST be a decimal whole number ≥ 1, else the step fails
`ERROR` with `Acquire of "<name>" could not use "<raw>" from <key> as a count: it must be a whole
number of at least 1` holding nothing [src: MissionEngine/src/core/transition.ts:106-116,368-394].
Completion commands (`Release`, `Release Pool Amount`) run when the completed step is dequeued by
the cascade, sorted by `resource_name` (activation commands too: sync commands first, then by name).
Both sorts use JavaScript `localeCompare` — ICU collation of the process locale (`en-US` in the
reference container), NOT code-unit order: e.g. `_x < a < A < b < B < e < é < Z` — and are stable
(equal names keep declaration order) [src: MissionEngine/src/core/resources.ts:677-686],
[src: MissionEngine/src/core/transition.ts:414]. A bad release count writes a null-step `ERRORED` trace `Step
"<local_id>": Release of "<name>" … — nothing was released` and does not fail the step
[src: MissionEngine/src/core/transition.ts:407-565]. A GATE may not carry resource commands (validator).

### C.4.11 E-signature steps

A screen whose `form_document` contains a block with `type: 'esignature'` (first one found) requires
a signature for every submission except a YES_NO `no` decision. The Pilot route verifies it
before the transaction (error codes and HTTP statuses: `SIGNATURE_REQUIRED` 400,
`SIGNATURE_INVALID_CREDENTIALS` 403, `SIGNATURE_SAME_USER` 403 (when `requireDifferentUser`),
`SIGNATURE_NOT_MEMBER` 403, `SIGNATURE_ROLE_UNKNOWN` 403, `SIGNATURE_ROLE_MISSING` 403); a failed
attempt inserts a `step_signature` row with `outcome='failed'` and `failure_code` outside any
transaction [src: MissionEngine/src/core/esignature.ts:37-141], [src: MissionEngine/src/api/app.ts:523-558].
A success is recorded atomically with the completion (C.4.3 step 5). Back supersedes the reopened
step's signatures (C.7).

---

## C.5 Transition evaluation (routing)

There is **no condition expression language**. `connection.condition` is compared as a literal
string. Routing uses the step's stored `routingContext` [src: MissionEngine/src/core/transition.ts:864-900]:

```
getRoutedConnections(step):
  all = connections with from_step_id == step (spec order)
  r = routingContext[step]; if none: return all
  if r.connectionId:   return all where connection_id == r.connectionId          -- SELECT 1
  if r.sourceHandleId:                                                            -- YES_NO
     m = all where source_handle_id == h
                 or (h=='true' and source_handle_id=='yes')
                 or (h=='false' and source_handle_id=='no')
                 or lower(condition) == lower(h)
     return m if non-empty else (all where lower(condition) == lower(h))
  if r.conditionValue:                                                            -- button press
     return all where (!r.excludeUnconditional and !condition)
                   or condition == v or lower(condition) == lower(v)
  return all
```

- Zero matching connections: the step still completes and nothing is routed; the branch ends
  (instance stays running unless other work completes it).
- Multiple matching connections: ALL are routed (implicit split); a routed count > 1 also clears the
  back target (C.7).
- Steps with no routing context (START, PARALLEL, SCRIPT, GATE, ACTION PROXY, WAIT ANY, USER_INTERACTION
  plain `submit`, SELECT 1 with no match and no default) route ALL outgoing connections.
- Joins: C.3.7.

`lower()` is JavaScript `toLowerCase()` (locale-independent Unicode default lower-casing); the
equality tests are exact code-unit comparisons. A connection whose `condition` is `null`/absent/`''`
counts as unconditional.

[pinned: exec-branch-001, exec-branch-002 and exec-linear-004 — YES_NO, connections with conditions
`True`/`False` and no `source_handle_id`, submitted as action `button_press` with button_output
`"true"`/`"false"` (case-insensitive condition match); exec-branch-003 — YES_NO with conditions
`approved`/`rejected` and button_output `"approved"`; exec-ui-004 — USER_INTERACTION `button_press`
with button_output `"approved"`, both connections conditioned (`approved`/`rejected`), so the
unconditional-passthrough rule is NOT exercised]

---

## C.6 Parameter and property resolution

### C.6.1 Property store

All values are strings; there is no type coercion [src: MissionEngine/src/core/properties.ts:38-311].
Keys are `Property.Entry` dotted keys (or bare ids for starting parameters / script keys).

- **Workflow value properties**: `value_property_specifications[*]` of the root (at start) or of a
  child (at child activation) seed `"<name>.<entry.name>" = entry.value`. Step-level
  `value_property_specifications` are NOT read by the engine.
- **Shared work-center values** (tier loaded each transaction): read-through, write-through.
- **Environment Action Properties**: only via bindings (C.6.6), evaluation-scoped.

### C.6.2 Read and write rules

- `get(key)`: local exact, else shared exact, else undefined [src: MissionEngine/src/core/properties.ts:157-161].
- `resolveKey(key)` (property-typed references): local exact → shared exact → group merge of
  `key.*` entries (shared first, local overwrites per entry, an entry whose name lower-cases to
  `description` excluded; the entry name is everything after `key.`, so `key.a.b` yields entry `a.b`)
  serialized as compact JSON `[{"name":…,"value":…},…]` → `''` [src: MissionEngine/src/core/properties.ts:135-155].
  Entry order: shared entries in the shared tier's order, then local entries not already present, in
  local-store iteration order; a local entry that overrides a shared one keeps the shared position.
  The local store's iteration order is insertion order within a transaction but, after a reload from
  the database, the stored JSON's key order (see C.11) [pinned: res-sync-003 — Send of the group
  `TransferData` in the start transaction delivers
  `[{"name":"Name",…},{"name":"Address",…},{"name":"PhoneNumber",…}]`, i.e. declaration order].
  No fixture pins the empty-string fallback (param-005's `defaultSource` on a form element is a client
  prefill hint the engine never reads).
- `set(key, v)`: writes the SHARED tier iff the property name (text before the first `.`; the whole
  key when there is no `.` or it is at index 0) is not declared by the owning spec, the key is not
  already in the local store, and the shared tier has that exact key; otherwise local
  [src: MissionEngine/src/core/properties.ts:163-182].
- `setSyncTarget(target, data)`: `set(target, data)`; if data parses as a non-empty JSON array of
  `{name: string, value: string}`, also `set(target.name, value)` for each [src: MissionEngine/src/core/properties.ts:187-194,291-311].
- History snapshot: shared entries overlaid by local (`toHistoryJSON`); `property_store` holds only
  the local root store.

### C.6.3 Starting parameters

For each `starting_parameter_specifications[*]`: a supplied value (key present) wins; else
`default_value`, resolved with `resolveKey` when `value_type === 'property'`. Each is ALSO stored as
a property under its bare `id` [src: MissionEngine/src/core/properties.ts:85-105]. Not fixture-pinned:
param-008 supplies `customer_name = "Acme Corp"` but asserts only `Result.Value`, which comes from the
submitted form, so it would pass even if the default were used.

### C.6.4 Step input parameters

On every activation (and every gate/repeating-script evaluation): clear the step's inputs; for each
input spec: `default_value` literally, or `resolveKey(default_value)` when `value_type ===
'property'`; then apply any binding overlay (by parameter id). The visible input map also includes
starting parameters not shadowed by an input (only during the start transaction; see Open points)
[src: MissionEngine/src/core/properties.ts:107-127,233-245]. Inputs are passed to scripts/gates as
positional string parameters, to actions as `{name: id, value}` pairs, and recorded in
`stepSnapshots`. An input spec with no `default_value` yields an undefined value (its key is then
absent from the persisted snapshot). Not fixture-pinned: param-006 declares an input
`greeting_param` from `Config.Greeting`, but fixtures cannot observe inputs — it asserts only that
`Config.Greeting` is still `Welcome` and the form-captured `Result.Value`.

### C.6.5 Outputs

- Form capture: for each form element with a truthy `outputParameter` and a `fieldName` whose value
  is present in `form_values` (value `!== undefined`; a JSON `null` IS present and is stored as
  `"null"`): key = the output spec with `id === outputParameter`'s `target` (if truthy), else
  `outputParameter`; arrays are `JSON.stringify`-ed (compact, e.g. `["Option A","Option C"]`),
  everything else is JavaScript `String()`-ed (C.11: `true` → `"true"`, `42` → `"42"`, `1e21` →
  `"1e+21"`, an object → `"[object Object]"`); the write goes through `set` (C.6.2). Elements without
  `outputParameter`/`fieldName` (headers, text, buttons) are skipped; a `defaultValue`/`defaultSource`
  on an element is never read by the engine. Elements come from `form_layout_config` when present
  (array: the FIRST entry's `elements`, empty array → none; object with `elements`; anything else →
  none — `form_document` is then NOT consulted), else from `form_document.sections[].rows[].blocks[]`
  that have a non-empty string `fieldName` [src: MissionEngine/src/core/step-handlers.ts:45-89],
  [src: MissionEngine/src/core/properties.ts:208-231].
  [pinned: exec-ui-001..005, param-001..008, exec-linear-002/003/005, exec-parallel-001/003/004/005 —
  all through `form_layout_config`; no fixture exercises `form_document`]
- SCRIPT: C.4.4. ACTION: C.4.6. CATCH: C.4.9.
- Child → parent: C.4.8 (the only propagation path; a child's other writes to its own copy are not
  visible to the parent, shared-tier writes are).
- Workflow outputs for history are computed by `workflowOutputs(spec, properties)` in the DB package
  [src: MissionEngine/src/core/context.ts:1359].

### C.6.6 Action-Property bindings (WAITING_PROPERTIES)

A non-GATE step with `action_property_bindings` parks `WAITING_PROPERTIES` (C.3.6). The due unit
claims it, re-arms `wake_at = now + INVOKE_GRACE_SECS`, commits, fetches outside any transaction,
then re-claims; if the instance is running-like and the row still `WAITING_PROPERTIES`: fetch failure
→ failStep(ERROR, message); success → `runStepActivation(overlay)` and cascade
[src: MissionEngine/src/core/input-bindings.ts:45-140]. Fetch: environment resolved by oid then
unique name (owner spec, then root); server URI from the work-center binding; one REST-11 call per
`(envOid, group)`; `Prop.Entry` picks the entry (missing → error `… property '<p>' has no entry
'<e>'`; the entry name is everything after the first `.`), a bare group yields the JSON list
excluding entries whose name lower-cases to `description`. The first failing binding ends the fetch.
`<label>` is `input binding` (steps and repeating scripts) or `gate binding`. Errors: `<label>s require
a dispatching action invoker`, `instance vanished during <label> property fetch`, `<label> for '<id>':
no resolvable environment`, `<label> for '<id>': no action server bound for environment <oid>`, or
`<label> for '<id>': <client error message>` [src: MissionEngine/src/core/property-overlay.ts:35-83].
The re-claim applies only if the instance is running-like and the row is still in the waiting state;
otherwise the fetched values are discarded.

---

## C.7 Back and Stop from a step

### C.7.1 Back target propagation

Every routed successor (non-join) receives `backFrom[successor]` computed from the dequeued
predecessor P [src: MissionEngine/src/core/back-target.ts:22-44], [src: MissionEngine/src/core/transition.ts:1101-1125]:

```
carriedBackTarget(P.type, P.oid, backFrom[P], routedCount):
  if routedCount > 1: return null                         -- split
  if P.type in {START, PARALLEL, WAIT ALL, WAIT ANY, WORKFLOW PROXY}: return null
  if P.type in {USER_INTERACTION, YES_NO}: return P.oid    -- screen
  return backFrom[P] ?? null                               -- automated steps pass it through
```

Joins (WAIT ALL / WAIT ANY) always get `null`. Entries made by activateAndCascade (GOTO, RETRY,
CATCH, Back) leave `backFrom` unchanged. A reset deletes `backFrom` and `backPrefill` but keeps
`lastFormValues` [src: MissionEngine/src/core/transition.ts:1474-1477]. Consequently Back never
crosses a split, a join, a START, or a sub-workflow boundary in either direction.

### C.7.2 Back

`POST /api/assignments/:id/back` → `goBack` [src: MissionEngine/src/core/go-back.ts:40-110]:

1. Claim the instance by id (busy → `NOT_RUNNING`); status MUST be exactly `running` (not the
   cleanup statuses) else `NOT_RUNNING`.
2. Lock the assignment `FOR UPDATE`; it must exist, be `claimed` by the caller, and its step row
   must belong to the instance, else `NOT_CLAIMANT`.
3. Target T's row must be `WAITING_USER`, else `STEP_NOT_WAITING`.
4. T must be a screen with `button_bar.format === 'fixed'` and `allow_back === true`; `S =
   backFrom[T]` must be set, S a screen, and S's row `COMPLETED`; else `BACK_NOT_ALLOWED`.
5. Actor = caller; reset T with step run `went_back`; trace `OPERATOR` on T `went back to «<S
   local_id>» [by <userId>]`.
6. Keep `backFrom[S]`; prefill = `lastFormValues[S] ?? {}`; reset S; restore `backFrom[S]`; set
   `backPrefill[S] = prefill`; mark S's `step_signature` rows superseded (`superseded_at = now`).
7. `activateAndCascade(S)`; persist; reconcile.
8. After commit, best-effort claim S's new offer for the caller (failure is logged only).

All EngineErrors map to HTTP 409 `{code, error}` [src: MissionEngine/src/api/app.ts:578-592].
Steps between S and T are not reset; they re-run on S's next submission by normal re-entry. The
Pilot reads `backAvailable` and `prefillValues` from the inbox
[src: mission-control-db/src/runtime/inbox.ts:343-344].

### C.7.3 Stop from a step

`POST /api/assignments/:id/stop` [src: MissionEngine/src/api/app.ts:594-624]: 404 if the assignment
is unknown; `NOT_CLAIMANT` (409) unless claimed by the caller; `NOT_RUNNING` (409) unless the
instance status is `running`; `STEP_NOT_WAITING` (409) unless the step row is `WAITING_USER`;
`STOP_NOT_ALLOWED` (409) unless `button_bar.format === 'fixed'` and `allow_stop === true`. Then
`requestStop` with a user actor and `{stepOid, stepName}` (recorded on the control event); DAO
errors map to 404 (`RUNTIME_NOT_FOUND`) or 409. The workflow then stops exactly as C.1.7/C.1.9.

---

## C.8 Timers, wakeups, sweeps, scheduled starts, retries

### C.8.1 `wake_at` consumers (disjoint by state)

| Unit | Claims rows | Instance statuses |
|---|---|---|
| Due action | `WAITING_ACTION`/`PAUSED`, `step_type <> 'GATE'`, `wake_at <= now` | running-like, `paused`, `pausing`, `stopping`, and `aborting` only during an Operator Abort halt |
| Due gate/script | `WAITING_GATE`/`WAITING_SCRIPT`, due | running-like |
| Due properties | `WAITING_PROPERTIES`, due | running-like |

[src: MissionEngine/src/loop.ts:255-274,284-335], [src: MissionEngine/src/core/gate.ts:241-300], [src: MissionEngine/src/core/input-bindings.ts:45-75]. The oldest due row (`wake_at`, id) is processed.

### C.8.2 Action invoke and poll

- Claim: if `action_instance_id` is NULL (invoke), re-arm `wake_at = now + INVOKE_GRACE_SECS`
  (default 60) before commit. Invoke only when the instance is running-like
  [src: MissionEngine/src/loop.ts:327-331,601-620].
- Invoke outside any transaction; environment resolution: env spec by `environment_oid` (owner,
  then root), else — only when `environment_name` is a non-empty string — by `environment_name`
  (none → ERRORED `package resolution: no embedded environment named "<n>" (step's environment_oid
  "<oid>" is not in the package)`; several → `package resolution: multiple embedded environments named
  "<n>" — ambiguous`); invoke failure → terminal ERRORED with the invoker's message. The inputs sent
  are the persisted `stepSnapshots[step].inputParameters` as `{name, value}` pairs in the stored JSON's
  key order — for a step activated inside the instance-start transaction this snapshot also contains
  every starting parameter not shadowed by an input (C.6.4) [src: MissionEngine/src/loop.ts:388-425].
  On success, in a new
  transaction, if the row is still actionable and un-invoked: set action columns, `started_at =
  invokedAt`, `wake_at = min(invokedAt + ACTION_POLL_SECS (default 20), invokedAt + timeout_ms)`,
  then open SSE monitoring; if the race was lost, DELETE the new server instance
  [src: MissionEngine/src/loop.ts:371-475].
- Poll: deadline = `started_at + timeout_ms` unless the row is `PAUSED`. Past deadline: close SSE,
  send ABORT (best effort), apply terminal TIMEOUT `action timed out`. Else REST-04: terminal state
  → apply; 404 → ERRORED `Instance lost on server`; other errors are logged (rate limited) and, after
  120000 ms of consecutive failures, one trace `WARNING` `action server not answering status checks
  (<HTTP n | message>) — this action may still be running`; re-arm `wake_at = min(now + poll,
  deadline)` [src: MissionEngine/src/loop.ts:486-593].
- `applyActionTerminal` runs in its own transaction, guarded by the row still being
  `WAITING_ACTION`/`PAUSED` and naming the same action instance; afterwards DELETE the server
  instance (best effort) [src: MissionEngine/src/actions/monitor.ts:124-316]. It first closes the
  step's SSE subscription and, for `COMPLETED` (and `STOPPED`, which may become a completion), fetches
  the REST-04 snapshot BEFORE taking any lock — a failed fetch for `COMPLETED` throws out of the call
  (nothing is applied; the poll path retries later), for `STOPPED` it maps no outputs. If the instance
  row is locked by another worker (`SKIP LOCKED` miss) the terminal is dropped without effect and the
  next poll re-discovers it. Terminals are applied only while the instance status is running-like,
  `paused`, `pausing`, `stopping`, or `aborting` during an Operator Abort halt; in `resuming` (and a
  plain `aborting`) they are ignored.

### C.8.3 Send failures (PAUSE/STOP)

A failed send is classified: `ActionServerNotAllowed`/key/token rejection or other 4xx → `refused`;
404 → `gone` (counts as delivered); everything else → `unreachable`
[src: MissionEngine/src/core/send-failure.ts:50-60]. Step STOP unreachable → remove from
`stoppedActions` (resent later); refused → trace `WARNING` `STOP could not be delivered: <reason>`.
Gate STOP unreachable → `stopSent=false`, gate `wake_at = now + 5000`; refused → same WARNING on the
gate. PAUSE: row back to `WAITING_ACTION`; refused → `pauseRefused` + WARNING `PAUSE could not be
delivered: <reason>`; unreachable before the limit → WARNING `PAUSE could not be delivered — action
server unreachable; retrying` and `paused` → `pausing`; after the limit → the unreachable WARNING.
RESUME failures are only logged. Busy instances are retried by the next control pass
[src: MissionEngine/src/core/send-failure.ts:92-231].

### C.8.4 Retention sweep

Timer: first run after 5000 ms, then every 30000 ms, skipping overlapping ticks
[src: MissionEngine/src/loop.ts:659-680]. Per work center (round-robin, batches of 500, at most 10
deleting batches per run): delete `workflow_instance` rows in a final status with `completed_at <
now - work_center.finished_retention_secs` (default 3600) that own no `wc_resource_holder` row,
oldest first, `FOR UPDATE SKIP LOCKED`; child rows cascade, `runtime_history` survives
[src: MissionEngine/src/core/sweep.ts:58-99].

### C.8.5 Scheduled starts

When `SCHEDULER_ENABLED` (default true), a timer every `SCHEDULE_TICK_MS` (default 5000) runs
`runScheduleTick(now)`, skipping overlapping ticks [src: MissionEngine/src/schedule-tick.ts:26-42].
A tick runs, in order: process ended runs (start chained items), carry out Resume/catch-up
decisions, fire due slots (at most one slot per Runtime Schedule and 20 Runtime Schedules per call),
mark lost runs (at most once per 60 s), finish completed schedules, record finished passes
[src: mission-control-db/src/scheduling/tick.ts:39-49]. A fired item creates a runtime workflow with
`start: true` (status `queued`, `triggered_by='schedule'`, schedule label) in a savepoint; a
non-transient failure records `failed_to_start` on its item-run row [src: mission-control-db/src/scheduling/fire.ts:99-144].
The engine then starts it like any queued instance. (Schedule semantics are specified in the
scheduling section.)

### C.8.6 Other constants

| Constant | Value | Source |
|---|---|---|
| idle wait | 1000 ms | [src: MissionEngine/src/loop.ts:824] |
| LISTEN reconnect backoff | 5000 ms | [src: MissionEngine/src/wake.ts:16] |
| `SCRIPT_TIMEOUT_MS` | 5000 | [src: MissionEngine/src/config.ts:161] |
| `ACTION_POLL_SECS` | 20 | [src: MissionEngine/src/config.ts:162] |
| `INVOKE_GRACE_SECS` | 60 | [src: MissionEngine/src/config.ts:163] |
| gate / script default cycle | 5 s | [src: MissionEngine/src/core/step-handlers.ts:439,544] |
| `GATE_STOP_RETRY_MS` | 5000 | [src: MissionEngine/src/core/gate.ts:163] |
| `PAUSE_UNKNOWN_LIMIT_MS` (also poll WARNING limit) | 120000 | [src: MissionEngine/src/core/control.ts:251] |
| `OPERATOR_ABORT_CONFIRM_TIMEOUT_MS` | 30000 | [src: MissionEngine/src/core/operator-cleanup.ts:49] |
| `MAX_START_ATTEMPTS`, `MAX_CONTROL_PASS_ATTEMPTS` | 3, 3 | [src: MissionEngine/src/loop.ts:89], [src: MissionEngine/src/core/control.ts:182] |
| `MAX_CASCADE_ACTIVATIONS` | 10000 | [src: MissionEngine/src/core/transition.ts:53] |
| script state / outputs limit | 65536 bytes each | [src: MissionEngine/src/core/step-handlers.ts:441-443] |
| script worker backstop grace / heap cap | 2000 ms / 256 MB | [src: MissionEngine/src/core/script-pool.ts:33-38] |
| `ORPHAN_KEEP_MS` / `RETRY_SCAN_MS` (pending cleanup aborts) | 60000 / 2000 ms | [src: MissionEngine/src/core/operator-cleanup-flow.ts:212-214] |
| pending-abort settle window / rescan | 10000 / 250 ms | [src: MissionEngine/src/core/operator-cleanup-flow.ts:228-230] |
| send-failure reason length | 200 chars (199 + `…`) | [src: MissionEngine/src/core/send-failure.ts:63-68] |
| engine-error reason line | 200 chars (197 + `...`) | [src: MissionEngine/src/core/operator-cleanup.ts:71-74] |
| sweep first run / interval / batch / batches per run | 5000 ms / 30000 ms / 500 / 10 | [src: MissionEngine/src/loop.ts:659-661], [src: MissionEngine/src/core/sweep.ts:24-25] |

### C.8.7 Instance-level trace rows (null step)

`ERRORED` (invalid spec, give-ups, bad release count), `WARNING` (validator warnings), `OPERATOR`
(cleanup start/end, runtime-level operator verbs) [src: MissionEngine/src/core/instance.ts:54-65],
[src: MissionEngine/src/core/operator-cleanup-flow.ts:145,193].

---

## C.9 Error codes produced by these paths

| Code | Where | HTTP (when via route) | Source |
|---|---|---|---|
| `NOT_RUNNING` | submit, Back, Pilot Stop | 409 | [src: MissionEngine/src/core/submit.ts:97,125], [src: MissionEngine/src/core/go-back.ts:45,49], [src: MissionEngine/src/api/app.ts:605] |
| `NOT_CLAIMANT` | submit, Back, Pilot Stop | 409 | [src: MissionEngine/src/core/submit.ts:145], [src: MissionEngine/src/core/go-back.ts:58] |
| `STEP_NOT_WAITING` | Back, Pilot Stop | 409 | [src: MissionEngine/src/core/go-back.ts:61] |
| `BACK_NOT_ALLOWED` | Back | 409 | [src: MissionEngine/src/core/go-back.ts:75] |
| `STOP_NOT_ALLOWED` | Pilot Stop | 409 | [src: MissionEngine/src/api/app.ts:612] |
| `SIGNATURE_*` | submit | 400/403 | [src: MissionEngine/src/core/esignature.ts:68-75] |
| `RUNTIME_NOT_FOUND`, `RUNTIME_INVALID_STATE`, `USER_NOT_FOUND` | control DAO | 404 / 409 / 400 (internal API) | [src: mission-control-db/src/dao/runtime-control.ts:30-32], [src: MissionEngine/src/api/internal.ts:76-77] |
| `INSTANCE_PAUSED`, `INSTANCE_BUSY`, `STEP_NOT_FOUND`, `ALREADY_COMPLETED`, `NOT_FORCEABLE`, `ALREADY_OPEN` | force complete | (verb mapping) | [src: MissionEngine/src/core/force-complete.ts:44-81] |
| `CATCH_REENTRY on <catch_id>` | trace/row error | — | [src: MissionEngine/src/core/transition.ts:2040] |
| plain errors | `Step <oid> not found`, `Step <oid> is not EXECUTING`, `engine v1: step type "<t>" is not yet supported`, `engine v1: no spec found for node "<n>" in instance <id>`, `cascade exceeded 10000 activations — possible unterminated machine cycle`, `Resource "<key>" is not registered`, `step "<oid>": environment resource "<n>" is not hydrated for work center "<wc>" — …` | — | [src: MissionEngine/src/core/submit.ts:136,222], [src: MissionEngine/src/core/context.ts:508], [src: MissionEngine/src/core/resources.ts:273], [src: MissionEngine/src/core/transition.ts:157-160] |

---

## C.10 What the conformance fixtures pin (summary)

The folders currently hold 94 fixture files: execution 37, parameters 8, resources 13, validation 36.
PROVENANCE.md still describes the 82-file vendored set (validation 28, execution 33) and its
2026-08-10 result of 79 pass / 0 fail / 3 skipped; the extra files are engine-local additions
(e.g. `exec-try-catch-009..012` for workflow-level TRY, `val-try-catch-012/013` for the operator
modes) [src: MissionEngine/src/conformance/PROVENANCE.md:8-16,42,64]. The 3 skipped fixtures are
`exec-child-001..003` [src: MissionEngine/src/conformance/PROVENANCE.md:31-40].

**Harness procedure** (an equivalent acceptance runner MUST reproduce it exactly, because several
assertions are only meaningful under it) [src: MissionEngine/src/conformance/harness.ts:41-205]:

1. `category === 'validation'` (the `validation/` folder AND `res-validation-001..003`): run only the
   validator; pass iff `valid` equals `expected.valid` and, when `expected.valid` is false and
   `expected.error_code` is given, the first error code equals it. No database, no execution.
2. Every other fixture: validate first (an invalid spec fails the fixture). Seed a fresh work center,
   a workflow and one `workflow_instance` with `status='queued'`, `queued_at=now`,
   `triggered_by='manual'`, `runtime_number=1`, `runtime_label='RW-1'`,
   `starting_params = setup.starting_parameters ?? null`.
3. Engine configuration for the run: `SCRIPT_TIMEOUT_MS=5000`; a NON-dispatching action invoker (no
   action client: ACTION PROXY steps park `WAITING_ACTION` with `wake_at = NULL` and are never
   invoked; an armed gate would warn instead of sending STOP); wall clock; `setup.initial_properties`
   merged into the store after the workflow value properties and before starting parameters (C.1.4
   step 4); each `setup.resources[i]` registered in the workflow-tier manager under key
   `test:<name>` (and its presence alone forces a manager to exist).
4. Pump `runOnce` until a cycle reports no work (at most 10000 cycles).
5. For each `user_actions[i]` in order: `submitUserAction(instance, user_actions[i], actionIndex = i)`
   with NO claim (no assignment check, no signature), then pump again. The fields used are
   `step_oid`, `action`, `button_output`, `form_values`, `failure_mode`, `error`.
6. If `expected.execution_trace` is given: assemble the trace (C.3.8) from ALL `trace_entry` rows of
   the instance and compare: the lengths MUST be equal (so any extra row — a `WAITING`, a null-step
   `WARNING`, an `IDLE` — fails the fixture); per index, `step_oid` (`''` for a null-step row) and
   `state` MUST be equal; `order` is compared only when the expected entry carries it, `after_action`
   only when the expected entry carries it; `timestamp` and `error` are never compared.
7. If `expected.workflow_state` is given: map the instance status `completed→COMPLETED`,
   `aborted→ABORTED`, `errored→ERRORED`, `running→RUNNING`, `stopped→STOPPED` (any other status
   upper-cased) and compare.
8. If `expected.final_properties` is given: every listed key MUST be present in
   `workflow_instance.property_store` (the ROOT LOCAL store only — no shared tier, no child stores)
   with exactly the listed string value; unlisted keys are ignored.

Notation below: `oid:STATE#order@after_action`. Every fixture listed with a trace pins `order` on
every entry and `after_action` on every screen `COMPLETED` entry.

**execution/ — linear, UI and branching** (all end `COMPLETED`, all traces fully pinned)

| Fixture | Actions | Asserts |
|---|---|---|
| exec-linear-001 | — | `step-start:COMPLETED#1, step-end:COMPLETED#2`. START has no row yet traces; END completes the instance. |
| exec-linear-002 | submit `{name:"Alice"}` | `start#1, step-ui:EXECUTING#2, step-ui:COMPLETED#3@0, step-end#4`; `UserResponse.Value="Alice"` (textInput `fieldName` → `outputParameter` key with no output spec). |
| exec-linear-003 | 2 submits | screens park/complete in sequence, `@0` then `@1`; order 1..6; `First.Value="Hello"`, `Second.Value="World"`. |
| exec-linear-004 | button_press `"true"` on YES_NO | `step-yn:EXECUTING#2, step-yn:COMPLETED#3@0, step-end-yes:COMPLETED#4` — condition `True` matched case-insensitively; `step-end-no` never appears. |
| exec-linear-005 | 4 submits | 4 screens in a chain, `@0..@3`, order 1..10; four captured values. |
| exec-branch-001 / -002 | button_press `"true"` / `"false"` | same shape as linear-004; routes to `step-end-yes` / `step-end-no` (conditions `True`/`False`, no `source_handle_id`). |
| exec-branch-003 | button_press `"approved"` | routes to `step-end-approve` (condition `approved`); `yes_no_config` values are irrelevant. |
| exec-branch-004 | — (`setup.initial_properties {"Status.Value":"open"}`) | `step-start#1, step-sel:COMPLETED#2, step-end-open:COMPLETED#3`: SELECT_1 property input, `==`, connection chosen by `connection_id`; no `EXECUTING` for SELECT 1. |
| exec-branch-005 | — (`"unknown"`) | routes to the `is_default` option's connection `step-end-default`. |
| exec-branch-006 | — (`"System error occurred"`) | `Contains "error"` → `step-end-match`. |
| exec-ui-001 / -003 | submit text / radio value | standard 4-entry screen trace; `Response.Value="hello"` / `Selection.Value="Option B"`. |
| exec-ui-002 | submit `{choices:["Option A","Option C"]}` | checkbox array stored as compact JSON `["Option A","Option C"]`. |
| exec-ui-004 | button_press `"approved"` on USER_INTERACTION | routes only to `step-end-approve` (condition `approved`). |
| exec-ui-005 | submit text + array | header/text/button elements ignored; `Survey.Name="Alice"`, `Survey.Interests="[\"Sports\",\"Travel\"]"`. |

**execution/ — parallel** (cascade order; all end `COMPLETED`)

| Fixture | Asserts (full trace) |
|---|---|
| exec-parallel-001 | `start#1, parallel#2, ui-a:EXECUTING#3, ui-b:EXECUTING#4, wait-all:EXECUTING#5` (join seeded by the post-drain sweep AFTER both branches parked), then after submits `ui-a:COMPLETED#6@0, ui-b:COMPLETED#7@1, wait-all:COMPLETED#8, end#9`. |
| exec-parallel-002 | two comment-only SCRIPT branches: `start, parallel, script-a:COMPLETED#3, script-b:COMPLETED#4, wait-all:COMPLETED#5, end#6` — no `wait-all:EXECUTING` (joined on first arrival because both predecessors were already COMPLETED). |
| exec-parallel-003 | three screens: three `EXECUTING` (#3–#5) then `wait-all:EXECUTING#6`; completions `@0..@2`, join #10, end #11. |
| exec-parallel-004 | nested: `parallel-outer#2, parallel-inner#3, ui-b:EXECUTING#4, ui-a1#5, ui-a2#6, wait-inner:EXECUTING#7, wait-outer:EXECUTING#8` (BFS: the outer fan-out's second target parks before the inner fan-out's targets; sweep in spec order puts the inner join first); then `ui-a1@0, ui-a2@1, wait-inner:COMPLETED#11, ui-b@2#12, wait-outer:COMPLETED#13, end#14`. |
| exec-parallel-005 | SCRIPT + screen: `script:COMPLETED#3, ui:EXECUTING#4, wait-all:EXECUTING#5, ui:COMPLETED#6@0, wait-all:COMPLETED#7, end#8`. |

**execution/ — action proxy and TRY/CATCH** (no traces pinned except action-proxy-001; states and
properties only). Every TRY fixture parks `s2` (ACTION PROXY, never invoked) and then submits
`{step_oid:"s2", action:"fail", failure_mode, error}`.

| Fixture | Setup → assertion |
|---|---|
| exec-action-proxy-001 | trace `step-start:COMPLETED#1, step-act:EXECUTING#2`; status `RUNNING` (parked, nothing due). |
| exec-try-catch-001 | step TRY ERROR → CATCH (`Reason→FailureContext.Mode`) → RETURN ABANDON: `ABORTED`, `FailureContext.Mode="ERROR"`. |
| exec-try-catch-002 | step TRY TIMEOUT → RETURN RETRY; second action `submit` on the re-parked `s2` (a submit to a WAITING_ACTION row completes it): `COMPLETED`, `Mode="TIMEOUT"`. |
| exec-try-catch-003 | step TRY ABORT → RETURN GOTO `m1` (a USER_INTERACTION); second action `submit` on `m1`: `COMPLETED`, `Mode="ABORT"`. |
| exec-try-catch-004 | RETURN RESTART KEEP: `RUNNING` (re-parked at `s2`), `Mode="ERROR"` survives. |
| exec-try-catch-005 | RETURN RESTART CLEAN: `RUNNING`, `Mode=""` (value properties re-initialised to declared defaults). |
| exec-try-catch-006 | no TRY: `ERRORED`. |
| exec-try-catch-007 | ABANDON with all four CATCH outputs: `ABORTED`, `Mode="ERROR"`, `Message="thermocouple failure"`, `Step="Action"`, `StepID="s2"`. |
| exec-try-catch-008 | RETURN COMPLETE: `COMPLETED` (trigger force-completed, routes to END), `Mode="ERROR"`. |
| exec-try-catch-009 / -011 | workflow-level TRY ERROR / ABORT (step has none) → ABANDON: `ABORTED`. |
| exec-try-catch-010 | workflow-level TRY TIMEOUT → COMPLETE: `COMPLETED`. |
| exec-try-catch-012 | step TRY ERROR → COMPLETE and workflow-level TRY ERROR → ABANDON: `COMPLETED` (step row wins). |
| exec-child-001..003 | NOT RUN (skipped as known reference failures: expected trace length 4 vs 6; expected `COMPLETED` vs `RUNNING`; spec fails validation `MISSING_REQUIRED_FIELD`). Do not use them as acceptance tests. [src: MissionEngine/src/conformance/PROVENANCE.md:31-40] |

**parameters/** (all: one or two screens, full 4/6-entry trace pinned, `COMPLETED`). They assert ONLY
form capture into the root store; none observes input parameters, prefill or default resolution.

| Fixture | Asserts |
|---|---|
| param-001 | `Result.Value="42"` (submitted string). |
| param-002 / -007 | `Config.DefaultName="Alice"` (declared value unchanged) and `Result.Value="Alice"` (from the form). |
| param-003 | dotted `outputParameter` `Response.Value` written as-is. |
| param-004 | two screens write the same key `Shared.Data`; last write wins (`"from_step_A"`). |
| param-005 | `Result.Value="user_typed"`; the element's `defaultSource` (`Missing.Prop`) is ignored. |
| param-006 | `Config.Greeting="Welcome"`, `Result.Value="Welcome"`; the declared input parameter is not observable. |
| param-008 | with `setup.starting_parameters {"customer_name":"Acme Corp"}`: `Result.Value="Acme Corp"` from the form only. |

**resources/** (category `execution` unless noted; all end `COMPLETED`; no traces pinned — only final
properties, so ordering and `WAITING` traces are NOT pinned; every command uses
`resource_source_type:"workflow"`, `resource_source_oid:"wf"`)

| Fixture | Asserts |
|---|---|
| res-binary-001 | Acquire then (later step) Release of a binary-exclusive lock; SCRIPT outputs `Result.Status="acquired"`, `Result.Done="released"`. |
| res-binary-002 | two PARALLEL SCRIPT branches each Acquire+Release the same binary lock: both run (`Result.A`/`Result.B = "done"`) and the join completes — the loser waits and is resumed by the winner's release. |
| res-countable-001 | `Acquire Pool Amount 5` of a `use_limit 10` pool, later `Release Pool Amount 5`: `Result.Status="used"`. |
| res-named-001 | named pool `["Dock 1","Dock 2"]`: Acquire with `target` writes the granted name: `Assigned.Dock="Dock 1"`. |
| res-named-002 | pool `["A","B","C"]`: three Acquires get `A`,`B`,`C`; Release with `target Held.First` frees `A`; the next Acquire gets `A` again (`Held.Fourth="A"`); a final step releases three names. |
| res-order-001 | receiver step holds `[Receive Chan, Acquire Lock]`; `Result.Received="hello"` (sync commands run before acquires). |
| res-sync-001 | Send of `Data.Value` / Receive into `Result.Received`: `"payload123"`. |
| res-sync-002 | Synchronize barrier on two branches: both outputs `"synced"`. |
| res-sync-003 | Send of the GROUP `TransferData` → Receive target `Result.Received` = `[{"name":"Name","value":"Alice"},{"name":"Address","value":"123 Main St"},{"name":"PhoneNumber","value":"555-1234"}]` (compact JSON, declaration order). |
| res-sync-004 | same Send, Receive target bare `Received`: the JSON string under `Received` AND exploded `Received.Name`, `Received.Address`, `Received.PhoneNumber`. |
| res-validation-001..003 | category `validation`: `valid=false`, `error_code="INVALID_RESOURCE_COMMAND"` (unknown resource; `Acquire Pool Amount` on a binary resource; child with a bad `resource_source_oid`). |

Behaviour defined only by code (not fixture-pinned): pause/resume/stop/abort and the operator
cleanup, gates (all modes), repeating scripts, property bindings, resources' environment tier and
blocked-step traces, action invoke/poll/timeouts, Back, Stop-from-step, e-signatures, step runs,
history, WAIT ANY, sub-workflow execution and escalation, `form_document` capture, input-parameter
and starting-parameter resolution, `resolveKey`'s empty fallback, the cascade cap, recovery paths.

---

## C.11 Platform-neutrality notes (observable contracts behind reference mechanisms)

The reference uses Node.js + PostgreSQL. A native re-implementation MUST provide the observable
behaviour below; the named mechanism is only the reference's choice.

1. **Per-instance mutual exclusion** (reference: `SELECT … FOR UPDATE SKIP LOCKED` on the
   `workflow_instance` row). Contract: at most one transaction mutates an instance's rows,
   `engine_state` and `property_store` at a time, across all engine processes sharing the database;
   a worker that finds the instance busy skips it immediately (never blocks); the background claim
   picks the eligible instance with the oldest `updated_at`, and a claim that did nothing bumps
   `updated_at` so others get their turn. Everything in one unit is atomic (all-or-nothing).
2. **Wake-up** (reference: `LISTEN/NOTIFY` on `engine_wake` / `wc_resource_grant` / `operator_change`
   and statement triggers). Contract: a status or step-state change, a new instance, or a foreign
   resource grant makes idle workers re-check promptly; without it they re-check within 1000 ms.
   Other apps (Commander, XO, Pilot) rely on `operator_change` NOTIFYs only for push freshness.
3. **Clocks.** The engine clock (`deps.now()`, JavaScript `Date`, millisecond precision, UTC) stamps
   every engine write, `wake_at` comparison and trace time. Exceptions that use another clock:
   `queued→running` sets `started_at`/`updated_at` with the SQL `now()` (transaction start time);
   DAO request writes use the requester's process clock; pending cleanup aborts use the wall clock.
   ISO strings in `engine_state` (`haltStartedAt`, `activated_at`, `queuedAt`) are
   `Date.prototype.toISOString()` (`YYYY-MM-DDTHH:mm:ss.sssZ`); epoch values (`pausedAt`,
   `pausingSince`, `pollFailingSince`) are integer milliseconds.
4. **JSON key order.** `engine_state`, `property_store` and `step_params` are PostgreSQL `jsonb`,
   which does NOT preserve key order: on reload, object keys come back ordered by key length
   (shorter first), then bytewise; JavaScript then enumerates integer-like keys (`"0"`, `"17"`) first
   in ascending numeric order, then the rest in that stored order. This is observable in: the entry
   order of a group value built by `resolveKey` from the LOCAL store after a reload (within one
   transaction the order is insertion order), and the order of the `{name, value}` input list sent
   to an action server (built from the persisted snapshot). An equivalent that wants byte-identical
   group strings MUST reproduce this ordering (or the scenario must avoid depending on it).
5. **String comparison and case.** SELECT 1 operators compare UTF-16 code units (Kotlin/Java
   `String.compareTo` is the same); `toLowerCase()` is the locale-independent Unicode default
   mapping (Kotlin `lowercase()` / Java `toLowerCase(Locale.ROOT)`). Resource-command sorting and the
   shared-value flush use `localeCompare` = ICU collation for the process locale (`en-US` in the
   reference image) — use an ICU/`java.text.Collator` for `en-US` with default strength, stable.
6. **`String(x)` of a submitted form value** (anything not an array): string → itself; boolean →
   `"true"`/`"false"`; `null` → `"null"`; number → JavaScript `Number::toString` (shortest
   round-trip digits; integers without `.0`; exponent form from 1e21 up and below 1e-6, e.g.
   `"1e+21"`, `"1e-7"`; `-0` → `"0"`); object → `"[object Object]"`. Arrays → `JSON.stringify`
   (compact, no spaces, nested values JSON-encoded, numbers as above). Group values are compact
   `JSON.stringify` of `[{"name":…,"value":…}]` with keys in that order.
7. **Numbers.** Counts from properties: the trimmed string (JavaScript `trim()`: Unicode white space
   and line terminators) must match `^[0-9]+$` and be ≤ 2^53−1 and ≥ 1. Second-based settings
   (`cycle_seconds`, `delay_seconds`, `time_limit_seconds`) are IEEE-754 doubles multiplied by 1000
   to milliseconds; fractions are allowed.
8. **Script sandbox** (reference: `node:vm` on worker threads, V8 of Node.js 22). Contract: an
   ECMAScript realm at that language level with only standard built-ins; the source compiled as a NON-strict function
   body with the parameters of C.4.4; promise jobs drained before the result is read; a wall-clock
   timeout; results crossing back only as JSON. Error MESSAGES are engine-specific: the text of
   `String(error)` for runtime/syntax errors (e.g. `ReferenceError: x is not defined`) comes from V8
   and will differ in another JavaScript engine (QuickJS, Rhino, J2V8…); messages the engine itself
   produces (timeout, unreadable, 64 KB limits, `Script state is not JSON`) are fixed strings. No
   fixture compares error strings.
9. **Byte limits** are measured as UTF-8 bytes of `JSON.stringify(value)`.

---

# Part 3 — HTTP interfaces the engine exposes (sections B.x)

This section specifies every HTTP interface the Mission Engine exposes: the public health probe, the
better-auth mount, the operator ("Pilot") REST API under `/api/*`, the Server-Sent Events stream, the
token-gated internal API under `/internal/*` used by Mission Commander, and the static Pilot bundle.
A conforming re-implementation MUST serve all of these on ONE port, same-origin with the Pilot bundle.

Notation: `UUID` means a string matching `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
[src: MissionEngine/src/api/app.ts:54] [src: MissionEngine/src/api/internal.ts:43]. All timestamps in JSON
bodies are ISO-8601 strings (JS `Date` serialized by `JSON.stringify`). All JSON bodies are UTF-8,
`Content-Type: application/json`.

---

## B.1 Process, port, configuration

| Env var | Default | Effect |
|---|---|---|
| `ENGINE_PORT` | `3006` | Listen port (positive integer, else default). [src: MissionEngine/src/config.ts:97,103] [src: MissionEngine/src/index.ts:103] |
| `ENGINE_BASE_URL` | `http://127.0.0.1:<port>` (also when value is `/`) | better-auth `baseURL`; canonical host for the GET redirect (B.2). [src: MissionEngine/src/config.ts:116] [src: MissionEngine/src/index.ts:66,72] |
| `BETTER_AUTH_SECRET` | dev fallback `insecure-dev-secret-change-me` | Session-signing secret. With `NODE_ENV=production` the engine MUST refuse to start when it is a placeholder (`insecure-dev-secret-change-me`, `change-me-in-production`, `mission-internal-dev-token`) or shorter than 32 chars (after trim). [src: MissionEngine/src/config.ts:70-78,107-112] |
| `ENGINE_INTERNAL_TOKEN` | unset → `null` | Shared secret for `/internal/*`. Unset/empty → every `/internal/*` request is 401. In production the public dev value `mission-internal-dev-token` MUST abort startup. In any mode the dev value is discarded (treated as unset) unless the engine is loopback-only (see below). [src: MissionEngine/src/config.ts:117-129] |
| `MISSION_ENGINE_BIND` | unset | Only used for the loopback-only test: loopback-only ⇔ (bind unset OR bind ∈ {`127.0.0.1`,`localhost`,`::1`,`[::1]`}) AND hostname of base URL ∈ same set; unparsable base URL ⇒ not loopback. [src: MissionEngine/src/config.ts:80-92] |
| `ALLOWED_ORIGINS` | empty | Comma-separated extra better-auth trusted origins (B.3.3). Read at call time. [src: MissionEngine/src/api/auth.ts:25-28] |
| `TRUSTED_PROXIES` | empty | Comma-separated IPs/CIDRs; a malformed entry MUST abort startup with `TRUSTED_PROXIES: "<entry>" is not an IP address or CIDR range`. [src: MissionEngine/src/api/client-ip.ts:31-46] [src: MissionEngine/src/api/app.ts:124] |
| `NODE_ENV` | — | `production` enables secret checks (above) and better-auth's rate limiter (B.3.4). |

Other env vars (worker concurrency, broker, actions, etc.) do not affect the HTTP surface and are specified
elsewhere. [src: MissionEngine/src/config.ts:156-174]

## B.2 Global request pipeline (order matters)

The engine composes one Hono application in this order [src: MissionEngine/src/index.ts:69-101]:

1. **Canonical-host redirect** (all paths): if `method === 'GET'` AND a `Host` header is present AND
   `Host !== new URL(ENGINE_BASE_URL).host` AND the path does NOT start with `/api/`, respond
   `302 Found` with `Location: <base protocol>//<base host><path><original query string>`.
   Non-GET requests and `/api/*` GETs are never redirected. [src: MissionEngine/src/index.ts:72-80]
   This applies to `/health` and to Pilot HTML/asset GETs. `HEAD` requests are NOT redirected: Hono routes a
   HEAD through the GET handlers but `c.req.method` still reads the raw `HEAD`, so the `=== 'GET'` test fails.
   [src: MissionEngine/node_modules/hono/dist/hono-base.js:263] [src: MissionEngine/node_modules/hono/dist/request.js:218-220]
2. `GET /health` (B.4).
3. The operator API app (`/api/auth/*`, `/api/*`) (B.3, B.5, B.6).
4. The internal API app (`/internal/*`) (B.7).
5. Static Pilot bundle (B.8): cache-header middlewares, `serveStatic({root:'./public'})` for every path,
   then SPA fallback `GET *` → `./public/index.html`.

There is NO global `onError` and NO `notFound` override: an uncaught exception yields Hono's default
`500` with body `Internal Server Error` (text/plain); an unmatched non-GET request yields Hono's default
`404` with body `404 Not Found` (text/plain). [src: MissionEngine/src/index.ts:69-101 (no onError/notFound registered)]
The path middlewares run first, so an unmatched non-GET under `/api/*` (outside `/api/auth/*`) answers
`401 {"error":"unauthenticated"}` without a valid session, and one under `/internal/*` answers the internal 401
(B.7.1) without a valid token; only past those gates is it the text 404.
[src: MissionEngine/src/api/app.ts:175-183] [src: MissionEngine/src/api/internal.ts:83-90]

There is NO CORS middleware: the engine sends no `Access-Control-*` headers on any route
[src: MissionEngine/src/index.ts:69-101] [src: MissionEngine/src/api/app.ts:104-627]. The Pilot is
served same-origin and calls with `credentials: 'same-origin'` [src: MissionPilot/src/api/client.ts:29-34].

---

## B.3 Authentication (better-auth mount)

### B.3.1 Configuration (normative)

The engine MUST host a better-auth 1.7 instance (`better-auth ~1.7.12`) [src: MissionEngine/package.json]
over the SHARED suite database, with exactly these options [src: MissionEngine/src/api/auth.ts:44-81]:

| Option | Value |
|---|---|
| `basePath` | `/api/auth` |
| `baseURL` | `ENGINE_BASE_URL` (B.1) |
| `secret` | `BETTER_AUTH_SECRET` (B.1) |
| `advanced.cookiePrefix` | `mission-engine` (MUST be distinct from Commander's/Designer's — they share the per-host cookie jar) |
| `advanced.database.generateId` | `false` (DB generates ids) |
| `advanced.ipAddress.ipAddressHeaders` | `['x-mission-client-ip']` |
| `emailAndPassword` | `{ enabled: true, disableSignUp: true }` in EVERY mode of the running engine (`disableSignUp = !(allowSignUp ?? false)` and the boot code never passes `allowSignUp`; it is a test-only option, not tied to `NODE_ENV`) [src: MissionEngine/src/api/auth.ts:62] [src: MissionEngine/src/index.ts:66] |
| user model | table `user` → `appUser`; field map `name→displayName`, `emailVerified`, `createdAt`, `updatedAt` |
| plugins | none (no admin plugin, no username plugin) |
| `databaseHooks.session.create.before` | if the user is disabled (`isUserDisabled`), throw `APIError('FORBIDDEN', { message: ACCOUNT_DISABLED_MESSAGE, code: 'ACCOUNT_DISABLED' })` — a disabled account never gets a session |
| `trustedOrigins` | B.3.3 |

Session lifetime uses better-auth defaults: `expiresIn` 7 days, `updateAge` 1 day
[src: MissionEngine/node_modules/better-auth/dist/context/create-context.mjs:147-148].

### B.3.2 Session cookie

The session cookie name is `mission-engine.session_token`, or `__Secure-mission-engine.session_token`
when `ENGINE_BASE_URL` starts with `https://` (better-auth's `useSecureCookies` default follows the
baseURL protocol). Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` iff the `__Secure-` prefix
is used. [src: MissionEngine/src/api/auth.ts:55] [src: MissionEngine/node_modules/better-auth/dist/cookies/index.mjs:23-40]
On read, better-auth accepts either the prefixed or unprefixed name
[src: MissionEngine/node_modules/better-auth/dist/cookies/index.mjs:266].

The engine reads session identity ONLY via `auth.api.getSession({ headers })`; it uses
`session.user.id` (= `app_user.id`, UUID) and `session.session.id` (the `session` row id) [src: MissionEngine/src/api/app.ts:175-183].

### B.3.3 Trusted origins / CSRF

`trustedOrigins` = `['http://localhost:*', 'https://localhost:*', 'http://127.0.0.1:*', 'https://127.0.0.1:*', ...ALLOWED_ORIGINS]`
(the base URL origin is trusted by better-auth implicitly). [src: MissionEngine/src/api/auth.ts:25-28]
better-auth applies its own origin/CSRF check (Origin, falling back to Referer) to non-GET/HEAD/OPTIONS
requests on `/api/auth/*` only; an untrusted origin → `403` `{ "code": "INVALID_ORIGIN", ... }`.
[src: MissionEngine/node_modules/better-auth/dist/api/middlewares/origin-check.mjs:42-46,95-100]

The engine's own `/api/*` state-changing routes (claim, submit, back, stop, presence, …) perform NO
Origin or CSRF-token check; protection rests on the `SameSite=Lax` session cookie.
[src: MissionEngine/src/api/app.ts:175-183 (gate checks session only)] (See Open points.)

### B.3.4 Client IP and rate limits

For every `/api/auth/*` request the engine MUST, before better-auth runs, delete any client-supplied
`x-mission-client-ip` header and set it to the resolved client IP [src: MissionEngine/src/api/app.ts:124] [src: MissionEngine/src/api/client-ip.ts:27,72-85]:

* `peer` = socket remote address; `::ffff:a.b.c.d` is reduced to `a.b.c.d`. Unknown/invalid peer ⇒ no header.
* If `TRUSTED_PROXIES` is empty or the peer is not in it ⇒ IP = peer.
* Else walk `X-Forwarded-For` hops right-to-left; return the first hop that is not a trusted proxy; stop
  at the first non-IP hop; if all hops are trusted (or none) ⇒ IP = peer.
  [src: MissionEngine/src/api/client-ip.ts:57-69]

better-auth's rate limiter is enabled only when `NODE_ENV=production` (better-auth default), memory storage,
per (IP, path) bucket: default `100` requests per `10` s; `/sign-in*`, `/sign-up*`, `/change-password*`,
`/change-email*`: `3` per `10` s; `/request-password-reset`, `/send-verification-email`, `/forget-password*`:
`3` per `60` s. Exceeded ⇒ `429`, body `{"message":"Too many requests. Please try again later."}`,
header `X-Retry-After: <seconds>`.
[src: MissionEngine/node_modules/better-auth/dist/context/create-context.mjs:170-176]
[src: MissionEngine/node_modules/better-auth/dist/api/rate-limiter/index.mjs:64-72,305-319]
The engine's own `/api/*` and `/internal/*` routes have NO rate limit. [src: MissionEngine/src/api/app.ts (no limiter)] [src: MissionEngine/src/api/internal.ts (no limiter)]

### B.3.5 Routes under `/api/auth/*`

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/auth/sign-out` | Engine intercept (registered before the passthrough): resolve the session from the request headers; if one exists run **releaseUserOnSignOut** (B.5.9) for `(user.id, session.id)`; then delegate to better-auth's handler (which invalidates the session and clears the cookie). [src: MissionEngine/src/api/app.ts:126-130] |
| GET, POST | `/api/auth/*` | Passed verbatim to `auth.handler(request)` (stock better-auth routes). Other methods are not routed. [src: MissionEngine/src/api/app.ts:132] |

Stock endpoints reachable this way include `POST /api/auth/sign-in/email`, `GET /api/auth/get-session`,
`POST /api/auth/sign-out`, `GET /api/auth/list-sessions`, `POST /api/auth/revoke-session(s)`,
`POST /api/auth/change-password`, `POST /api/auth/update-user`, `POST /api/auth/verify-password`, etc.
[src: MissionEngine/node_modules/better-auth/dist/api/routes/*.mjs]. `POST /api/auth/sign-up/email` is
refused because sign-up is disabled [src: MissionEngine/src/api/auth.ts:62].

**Sign-in (the only auth call the Pilot makes besides sign-out/logout)** [src: MissionPilot/src/api/client.ts:57]:

```
POST /api/auth/sign-in/email
Content-Type: application/json
Origin: http://127.0.0.1:3006

{"email":"op@example.com","password":"secret"}
```
Success: `200`, `Set-Cookie: mission-engine.session_token=...; Path=/; HttpOnly; SameSite=Lax`, body per
better-auth 1.7 (`{ "redirect": false, "token": "<session token>", "user": { "id", "email", "name", "emailVerified", "createdAt", "updatedAt", ... } }`).
Errors: `401` `{"code":"INVALID_EMAIL_OR_PASSWORD","message":...}`; `403` `{"code":"ACCOUNT_DISABLED","message":<ACCOUNT_DISABLED_MESSAGE>}`
[src: MissionEngine/src/api/auth.ts:67-77]; `403 INVALID_ORIGIN`; `429` (B.3.4).

Consumer contract: the Pilot sends this with a 15 s client timeout and only `content-type: application/json`
(the browser adds `Origin`); it ignores the response body and immediately calls `GET /api/me`. A `401` there is
reported as "session not kept" (the browser dropped the cookie). The login screen branches on `body.code === 'ACCOUNT_DISABLED'`
and on HTTP `429`; any status ≥ 500 or a network failure reads as "engine unreachable". A re-implementation MUST keep
`code: "ACCOUNT_DISABLED"` and status `429` for these to render. [src: MissionPilot/src/api/client.ts:54-57] [src: MissionPilot/src/session.tsx:71-80] [src: MissionPilot/src/screens/LoginScreen.tsx:33-36]

### B.3.6 Session gate for `/api/*`

Every `/api/*` route EXCEPT `/api/auth/*`, `GET /api/theme` and `GET /api/brand/:id` (registered
earlier) passes this gate [src: MissionEngine/src/api/app.ts:174-183]:

1. `getSession(headers)`; none ⇒ `401 {"error":"unauthenticated"}`.
2. If `app_user.status` marks the user disabled (`isUserDisabled`) ⇒ `401 {"error":"unauthenticated"}` (the
   status column is authoritative even for a pre-existing session).
3. Set context `userId = session.user.id`, `sessionId = session.session.id`.

The gate is middleware: a GET to an unknown `/api/...` path that passes the gate falls through to the static
SPA fallback and returns `index.html` with `200` (see Open points). [src: MissionEngine/src/index.ts:100-101]

### B.3.7 Work-center membership check (`requireWcMember`)

`requireWcMember(userId, wcId)` is true iff `wcId` is a UUID AND a `work_center_user` row
`(user_id=userId, work_center_id=wcId)` exists. A non-UUID returns false (never a 500).
[src: MissionEngine/src/api/app.ts:56-62] Role-based eligibility is checked separately (claim only).

---

## B.4 Health

`GET /health` → `200 {"status":"ok"}`. No auth, no DB access. [src: MissionEngine/src/health.ts:16-17]
It is subject to the canonical-host redirect (B.2). The container healthcheck is
`wget -q -O /dev/null http://localhost:3006/health` [src: MissionEngine/Dockerfile:113-114].

---

## B.5 Operator REST API (`/api/*`)

### B.5.0 Error envelope (operator API)

Operator-API errors MUST use one of two JSON shapes [src: MissionEngine/src/api/app.ts (all routes)]:

* `{ "error": "<human string>" }` — plain refusals (validation, membership, not found, claim races).
* `{ "code": "<UPPER_SNAKE>", "error": "<human string>" }` — engine-state refusals on submit/back/stop/continue.

The Pilot client reads `body.code` and `body.error` and treats 401 as "signed out" [src: MissionPilot/src/api/client.ts:35-42].

Complete operator error-code list:

| code | HTTP | Raised by | Meaning |
|---|---|---|---|
| `NOT_CLAIMANT` | 409 | submit, back, stop | Assignment is not `claimed` by the caller (or not for this step). [src: MissionEngine/src/api/app.ts:521-523,600-602] [src: MissionEngine/src/core/submit.ts:151-153] [src: MissionEngine/src/core/go-back.ts:57-59] |
| `NOT_RUNNING` | 409 | submit, back, stop | Instance locked by another worker (FOR UPDATE SKIP LOCKED miss) or status not acceptable. [src: MissionEngine/src/core/submit.ts:95-98,124-126] [src: MissionEngine/src/core/go-back.ts:44-50] [src: MissionEngine/src/api/app.ts:604-606] |
| `STEP_NOT_WAITING` | 409 | back, stop | Step state ≠ `WAITING_USER`. [src: MissionEngine/src/core/go-back.ts:60-62] [src: MissionEngine/src/api/app.ts:607-609] |
| `BACK_NOT_ALLOWED` | 409 | back | Step or its back target does not qualify (B.5.12). [src: MissionEngine/src/core/go-back.ts:74-76] |
| `STOP_NOT_ALLOWED` | 409 | stop | Step has no fixed bar or `allow_stop !== true`. [src: MissionEngine/src/api/app.ts:610-613] |
| `RUNTIME_INVALID_STATE` | 409 | stop | DAO refused the status transition. [src: mission-control-db/src/dao/runtime-control.ts:62-66] |
| `RUNTIME_NOT_FOUND` | 404 | stop | Instance vanished. [src: MissionEngine/src/api/app.ts:618] |
| `USER_NOT_FOUND` | 409 | stop | Actor user row missing (DaoError; app.ts maps every non-RUNTIME_NOT_FOUND DaoError to 409). [src: mission-control-db/src/dao/runtime-control.ts:54] [src: MissionEngine/src/api/app.ts:618] |
| `SIGNATURE_REQUIRED` | 400 | submit | Step has an e-signature block and `signature.loginName`/`password` missing/blank. [src: MissionEngine/src/api/app.ts:537-539] |
| `SIGNATURE_INVALID_CREDENTIALS` | 403 | submit | Unknown login, non-active user, or wrong password (one code). [src: MissionEngine/src/core/esignature.ts:110-120] |
| `SIGNATURE_SAME_USER` | 403 | submit | `requireDifferentUser` and signer = operator. [src: MissionEngine/src/core/esignature.ts:121-123] |
| `SIGNATURE_NOT_MEMBER` | 403 | submit | Signer not a member of the assignment's work center. [src: MissionEngine/src/core/esignature.ts:124-128] |
| `SIGNATURE_ROLE_UNKNOWN` | 403 | submit | Block `roleName` names no role. [src: MissionEngine/src/core/esignature.ts:131-134] |
| `SIGNATURE_ROLE_MISSING` | 403 | submit | Signer lacks the role in this work center. [src: MissionEngine/src/core/esignature.ts:135-137] |
| `NOT_FORCEABLE` | 403 | continue | Pilot may not continue a plain condition gate. [src: MissionEngine/src/core/force-complete.ts:77-79] [src: MissionEngine/src/api/app.ts:317] |
| `RUNTIME_NOT_FOUND`, `STEP_NOT_FOUND` | 404 | continue | `*_NOT_FOUND` → 404. [src: MissionEngine/src/api/app.ts:317] |
| `INSTANCE_PAUSED`, `RUNTIME_INVALID_STATE`, `INSTANCE_BUSY`, `ALREADY_COMPLETED`, `ALREADY_OPEN` | 409 | continue | B.5.7. [src: MissionEngine/src/core/force-complete.ts:44-82] |

Signature HTTP statuses come from `SIGNATURE_HTTP_STATUS`; an unknown signature code defaults to 403.
[src: MissionEngine/src/core/esignature.ts:68-75] [src: MissionEngine/src/api/app.ts:556]

**What the Pilot branches on (interoperability contract).** A re-implementation MUST keep these codes, statuses and,
where noted, the `error` text, because the Pilot keys its behaviour on them [src: MissionPilot/src/screens/TaskScreen.tsx:75-96,104-108,222-240,255,272-284] [src: MissionPilot/src/inbox/ContinueNowControl.tsx:43] [src: MissionPilot/src/screens/InboxScreen.tsx:54-56] [src: MissionPilot/src/workflows-data.ts:36]:

* submit: any `code` starting `SIGNATURE_` keeps the form open and shows a signature error. `SIGNATURE_REQUIRED`,
  `SIGNATURE_INVALID_CREDENTIALS`, `SIGNATURE_SAME_USER`, `SIGNATURE_NOT_MEMBER` get Pilot copy; any other `SIGNATURE_*`
  (notably `SIGNATURE_ROLE_UNKNOWN`, `SIGNATURE_ROLE_MISSING`) shows the engine's `error` string verbatim, so those
  messages are operator-facing. `NOT_RUNNING` keeps the step open (generic retry copy). Any other 403/409 = "the task changed" (race).
* back/stop: `NOT_CLAIMANT` or `STEP_NOT_WAITING` = race; `BACK_NOT_ALLOWED`,
  `STOP_NOT_ALLOWED`, `RUNTIME_INVALID_STATE` (stop) get Pilot copy; anything else is generic.
* claim/release: only the status matters (403 or 409 = lost race); the `error` text is never shown.
* continue: on 403/409 the Pilot shows the engine's `error` string verbatim ("Resume the workflow first",
  "Only timed gates can be continued from the Pilot", …) — operator-facing.
* Workflows tab projections: 403 or 404 = the instance is gone / not visible.
* Every 401 anywhere = signed out (the client fires `pilot:unauthenticated` and drops the user).

### B.5.1 Route table

| # | Method | Path | Auth | Caller |
|---|---|---|---|---|
| 1 | GET | `/api/theme[?workCenterId=UUID]` | none; session+membership when `workCenterId` given | Pilot (login screen + per WC) |
| 2 | GET | `/api/brand/:id` | none | Pilot `<img>` |
| 3 | GET | `/api/me` | session | Pilot |
| 4 | GET | `/api/work-centers` | session | Pilot picker |
| 5 | GET | `/api/inbox?workCenterId=UUID` | session + member | Pilot |
| 6 | GET | `/api/events?workCenterId=UUID` | session + member | Pilot (EventSource) |
| 7 | GET | `/api/instances/:instanceId/images/:filename` | session + member | Pilot form images |
| 8 | GET | `/api/work-centers/:wcId/runtime-workflows` | session + member | Pilot Workflows tab |
| 9 | GET | `/api/runtime-workflows/:id/diagram` | session + member | Pilot Workflows tab |
| 10 | GET | `/api/runtime-workflows/:id/live-states` | session + member | Pilot Workflows tab (2 s poll) |
| 11 | POST | `/api/runtime-workflows/:id/steps/:stepInstanceId/continue` | session + member | Pilot "Continue now" |
| 12 | POST | `/api/presence` | session + member | Pilot |
| 13 | POST | `/api/presence/heartbeat` | session | Pilot (every 30 s) |
| 14 | DELETE | `/api/presence[?workCenterId=UUID]` | session | Pilot |
| 15 | POST | `/api/logout` | session | Pilot |
| 16 | POST | `/api/assignments/:id/claim` | session + member + role | Pilot |
| 17 | POST | `/api/assignments/:id/release` | session + claimant | Pilot |
| 18 | POST | `/api/assignments/:id/submit` | session + claimant | Pilot |
| 19 | POST | `/api/assignments/:id/back` | session + claimant | Pilot |
| 20 | POST | `/api/assignments/:id/stop` | session + claimant | Pilot |

[src: MissionEngine/src/api/app.ts:142-624] [src: MissionPilot/src/api/client.ts:56-79]
[src: MissionPilot/src/presence.ts:17] [src: MissionPilot/src/screens/TaskScreen.tsx:358]

There is NO separate "sign" route: e-signatures ride inside `submit` (B.5.11).

### B.5.2 `GET /api/theme`

Query: `workCenterId` (optional). Request header `If-None-Match` (optional).
[src: MissionEngine/src/api/app.ts:142-164]

* If `workCenterId` is present: no session ⇒ `401 {"error":"unauthenticated"}`; non-UUID or not a member ⇒
  `403 {"error":"not a member of this work center"}`. (A disabled user's session is NOT re-checked here.)
* Resolve: `{rev, site} = readSiteTheme()` (rev from `system_settings` key `pilot_theme_rev`, theme from key
  `pilot_theme`; unreadable ⇒ defaults / rev 0) [src: mission-control-db/src/dao/pilot-theme-store.ts:28-40].
  Without WC: `resolveTheme([site])`; with WC: `safeResolve(site, chain-of-ancestor-overrides root→WC)`.
* `payload = { rev, theme, css, fontFamily, themeColor }`; `hash = sha256(JSON.stringify(payload)).hex[0..16)`;
  `ETag: "<rev>-<hash>"` (quoted); `Cache-Control: no-cache`.
* If `If-None-Match` equals the ETag exactly ⇒ `304`, empty body. Else `200` `{ ...payload, etag }`.

Response body (ThemePayload) [src: mission-control-db/src/dao/pilot-theme.ts:528-549,256-269,72-83]:

| Field | Type | Notes |
|---|---|---|
| `rev` | integer | global theme revision |
| `theme` | ResolvedTheme | `{ appTitle: string, font: FontId, density: 'compact'\|'comfortable'\|'touch', radius: 'none'\|'sm'\|'md'\|'lg', defaultMode: 'light'\|'dark'\|'system', logo: ThemeLogo\|null, logoDark: ThemeLogo\|null, wcAccent: string\|null, colors: { light: Record<ColorKey,string\|null>, dark: Record<ColorKey,string\|null> }, auto: { light: ColorKey[], dark: ColorKey[] } }` |
| `css` | string | ready-made CSS layer `@layer pilot.theme { :root[data-pilot-mode="light"] {...} ... }` |
| `fontFamily` | string\|null | @font-face family or null (system) |
| `themeColor` | `{ light: string, dark: string }` | resolved header background per mode |
| `etag` | string | same as the header |

`ColorKey` ∈ `brand, accent, accentFg, surface, surfaceRaised, text, textMuted, border, headerBg, headerFg, focus`;
`FontId` ∈ `system, inter, ibm-plex-sans, source-sans-3, noto-sans, roboto, open-sans, atkinson-hyperlegible, barlow, fira-sans, lato`;
`ThemeLogo` = `{ id: "sha256:<64 hex>", mime: "image/svg+xml"|"image/png", alt: string }`.
[src: mission-control-db/src/dao/pilot-theme.ts:21-69]

### B.5.3 `GET /api/brand/:id`

No auth. `id` MUST match `/^sha256:[0-9a-f]{64}$/` and exist in `brand_asset`, else `404 {"error":"not found"}`.
`200` raw bytes with headers `Content-Type: <mime>`, `Cache-Control: public, max-age=31536000, immutable`,
`X-Content-Type-Options: nosniff`, plus for SVG `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`.
[src: MissionEngine/src/api/app.ts:168-172] [src: mission-control-db/src/dao/brand-assets.ts:27,39-55]

### B.5.4 `GET /api/me`

`200` `{ "id": UUID, "email": string, "displayName": string, "loginName": string }` from `app_user`.
(`loginName` is what the Pilot prefills in the e-signature element; no role list.) [src: MissionEngine/src/api/app.ts:185-192]

### B.5.5 `GET /api/work-centers`

`200` array of `{ id: UUID, name: string, path: string[] /* ancestor names root→parent, [] for root */, openTasks: integer }`,
one per work center the user is a member of, sorted by `[...path, name].join('\u0000')` (localeCompare).
`openTasks` counts live assignments (`offered`|`claimed`) at that WC visible to the user by the visibility
rule (B.5.6) where a claim counts only if its step is `WAITING_USER` or `PAUSED`. Corrupt parent cycles
terminate path building. Empty array when the user has no memberships.
[src: MissionEngine/src/api/app.ts:196] [src: mission-control-db/src/runtime/operator-work-centers.ts:25-95]

### B.5.6 `GET /api/inbox?workCenterId=UUID`

Errors: missing ⇒ `400 {"error":"workCenterId is required"}`; non-UUID ⇒ `400 {"error":"invalid work center id"}`;
not a member ⇒ `403 {"error":"not a member of this work center"}`. [src: MissionEngine/src/api/app.ts:198-204]

Success `200` **InboxSnapshot** (also the payload of SSE `inbox` events) [src: mission-control-db/src/runtime/inbox.ts:73-79,297-363]:

```json
{
  "workCenterId": "UUID",
  "workCenterName": "string|null",
  "offers":   [InboxTask, ...],
  "myClaims": [InboxTask, ...],
  "waiting":  [WaitingStep, ...]
}
```

**Visibility rule** (`isAssignmentVisibleTo`): a `claimed` assignment is visible iff `assigned_user_id = caller`;
an `offered` assignment is visible iff its step state is `WAITING_USER` AND (`allowed_role_ids` is empty OR
intersects the caller's roles held IN THIS work center); any other status is invisible.
[src: mission-control-db/src/runtime/inbox.ts:228-240,298-300]

* `offers`: live assignments of this WC with status `offered` that are visible; sorted `suggestedForMe` desc,
  then `offeredAt` ascending (string compare). [src: mission-control-db/src/runtime/inbox.ts:348-352]
* `myClaims`: status `claimed`, visible, and step state ∈ {`WAITING_USER`,`PAUSED`}; sorted by `claimedAt` asc.
  [src: mission-control-db/src/runtime/inbox.ts:354-359]

**InboxTask** — every field [src: mission-control-db/src/runtime/inbox.ts:23-49,320-346]:

| Field | Type | Source / rule |
|---|---|---|
| `assignmentId` | UUID | `instance_assignment.id` (the id for claim/release/submit/back/stop) |
| `stepInstanceId` | UUID | `step_instance.id` |
| `stepOid` | string | `step_instance.step_oid` (runtime oid) |
| `stepType` | string | `step_instance.step_type` (canonical, e.g. `USER_INTERACTION`, `YES_NO`) |
| `stepName` | string\|null | frozen step def `local_id` if string |
| `instanceId` | UUID | `workflow_instance.id` |
| `runtimeNumber` | integer | `workflow_instance.runtime_number` |
| `runtimeLabel` | string | `workflow_instance.runtime_label` |
| `masterName` | string | `workflow_instance.master_name` |
| `masterVersion` | string | `workflow_instance.master_version` |
| `workflowPath` | string[] | child-workflow `local_id`s root→owning node; `[]` at root; nameless child ⇒ `"Sub-workflow"` |
| `stepUpdatedAt` | ISO string | `step_instance.updated_at` |
| `offeredAt` | ISO string | `instance_assignment.assigned_at` |
| `claimedAt` | ISO string\|null | `instance_assignment.claimed_at` |
| `suggestedForMe` | boolean | `preferred_user_id === caller` |
| `paused` | boolean | step state === `PAUSED` |
| `formDocument` | object\|null | frozen `form_document` with `{{Param}}` tokens in `text`/`header` blocks replaced by HTML-escaped values from `engine_state.stepSnapshots[stepOid].inputParameters` (exact-name; unknown tokens verbatim; single pass) and input-sourced lists filled (`listSource.mode==='input'` ⇒ `textInput.listItems` or `checkbox/radio.options` = `[{label,value}]`). Without a snapshot: verbatim. Never mutated in place (deep copy). |
| `yesNoConfig` | object\|null | frozen `yes_no_config` |
| `continueLabel` | string\|null | value of the first `ui_parameter_specifications[]` entry with `type==='Button'` if non-blank; else label of the first form `button` block with `outputValue==='continue'` if non-blank; else null |
| `buttonBar` | object\|null | non-null ONLY when the step's `button_bar.format === 'fixed'`: `{ size?, color?, yesColor?, noColor? }` copied from `button_bar.size/color/yes_color/no_color` when strings |
| `allowStop` | boolean | `buttonBar !== null && def.allow_stop === true` |
| `backAvailable` | boolean | `buttonBar !== null && def.allow_back === true && typeof engine_state.backFrom[stepOid] === 'string'` |
| `prefillValues` | object\|null | `engine_state.backPrefill[stepOid]` verbatim (values submitted the last time this screen was left via Back) |

Note: the inbox does NOT ship signature requirements as a separate field; the requirement is the presence of
an `esignature` block inside `formDocument` (B.5.11). [src: MissionEngine/src/core/esignature.ts:36-65]

**WaitingStep** (timed GATEs and repeating SCRIPTs at this WC) [src: mission-control-db/src/runtime/inbox.ts:62-71,249-295] [src: mission-control-db/src/runtime/gate-timer.ts:20-80]:

| Field | Type | Rule |
|---|---|---|
| `stepInstanceId` | UUID | |
| `instanceId` | UUID | |
| `stepOid` | string | |
| `stepName` | string\|null | `local_id` |
| `runtimeLabel`, `masterName`, `masterVersion` | string | |
| `workflowPath` | string[] | as above |
| `paused` | boolean | instance status ∈ {`paused`,`pausing`,`resuming`} |
| `timer` | GateTimer | see below |

Selection: step state ∈ {`WAITING_GATE`,`WAITING_SCRIPT`}, instance status ∈ {`running`,`pausing`,`paused`,`resuming`,`stopping_cleanup`,`aborting_cleanup`},
the spec contains a timed gate or repeating script, and `waitTimerOf(...)` is non-null. Sorted by `timer.deadline`
ascending, `null` deadlines last.

`GateTimer` = `{ mode: 'timer'|'condition_or_timer', deadline: ISO (started_at + gate_config.delay_seconds), cycleSeconds: null (timer) | number (condition_or_timer; gate_config.cycle_seconds if ≥1 else 5) }`
or `{ mode: 'repeat_script', deadline: ISO|null (started_at + repeat.time_limit_seconds), cycleSeconds: number (repeat.cycle_seconds if ≥1 else 5) }`.
A gate whose `engine_state.armedGates[stepOid].open` is true yields null (not listed); a gate with non-numeric
`delay_seconds` or no `started_at` yields null.

### B.5.7 `POST /api/runtime-workflows/:id/steps/:stepInstanceId/continue`

Operator "Continue now" on a waiting timed GATE or repeating SCRIPT. Any member of the instance's WC.
[src: MissionEngine/src/api/app.ts:303-322]

Body (optional JSON): `{ "reason"?: string }` — non-string ignored; truncated to 500 chars. Invalid JSON ⇒ treated as `{}`.

Checks: either id non-UUID ⇒ `404 {"error":"not found"}`; instance unknown ⇒ `404 {"error":"not found"}`;
not member ⇒ `403`. Then `forceCompleteStep(source:'pilot')` [src: MissionEngine/src/core/force-complete.ts:44-102]:

1. Warm action-server capabilities for the instance (network, before any transaction).
2. Transaction: instance missing ⇒ `RUNTIME_NOT_FOUND`; status `paused`/`pausing` ⇒ `INSTANCE_PAUSED` ("Resume the workflow first");
   status not in {`running`,`stopping_cleanup`,`aborting_cleanup`} ⇒ `RUNTIME_INVALID_STATE`; instance row lock
   (SKIP LOCKED) fails ⇒ `INSTANCE_BUSY`; status re-checked under lock; step row (id + instance) missing ⇒
   `STEP_NOT_FOUND`; state not `WAITING_GATE`/`WAITING_SCRIPT` ⇒ `ALREADY_COMPLETED`; def missing ⇒ `STEP_NOT_FOUND`;
   pilot + gate in `condition` mode ⇒ `NOT_FORCEABLE`; armed gate already open ⇒ `ALREADY_OPEN`.
3. Effects: trace row state `OPERATOR` with error text `Forced complete[: <reason>] [by <userId>]` (`<reason>` is the
   500-char-truncated body value, then `.trim()`med; blank ⇒ no `: <reason>` part) [src: MissionEngine/src/core/force-complete.ts:84-86]; `stepRunActor` = caller;
   repeating script ⇒ completes with pending outputs; gate ⇒ opens via the same path as a TRUE evaluation (armed gate
   queues a STOP to its action, sent after commit); assignment reconcile + `pg_notify('operator_change', wcId)`.
4. After commit: send queued action commands; in-process SSE push for the WC.

Success `200 {"ok":true}` (the route drops the `summary`). Errors `{ "error": <message>, "code": <code> }` with status
`403` for `NOT_FORCEABLE`, `404` for `*_NOT_FOUND`, else `409`. Not idempotent: a second call ⇒ `409 ALREADY_COMPLETED`.

```
curl -X POST -b 'mission-engine.session_token=…' -H 'content-type: application/json' \
  http://127.0.0.1:3006/api/runtime-workflows/7d2e…/steps/9a10…/continue -d '{"reason":"oven ready early"}'
→ 200 {"ok":true}
→ 403 {"error":"Only timed gates can be continued from the Pilot","code":"NOT_FORCEABLE"}
```

### B.5.8 Presence routes

Table `operator_presence(id, user_id, attending_work_center_id, session_id, status ∈ online|away|offline, last_heartbeat_at, created_at)`
with unique `(session_id)` and unique `(user_id, attending_work_center_id)`. [src: mission-control-db/src/db/schema/execution.ts:183-196]

**`POST /api/presence`** — body `{ "workCenterId": UUID }` (required). Errors: missing/non-string ⇒ `400 workCenterId is required`;
non-UUID ⇒ `400 invalid work center id`; not member ⇒ `403`. Effect, one transaction: delete this user's rows where
`session_id = current OR attending_work_center_id = target` (returning displaced WCs), insert
`{userId, attendingWorkCenterId, sessionId, status:'online', lastHeartbeatAt: now}`. After commit, for the target WC
and every displaced WC run the sole-candidate sweep; if it claimed anything, `pg_notify('operator_change', wc)` + SSE push.
`200 {"ok":true}`. Idempotent in effect. [src: MissionEngine/src/api/app.ts:324-348]

**`POST /api/presence/heartbeat`** — body optional `{ "status"?: "away"|"back" }` (`back` ⇒ `online`; anything else ⇒ no status change).
Updates `last_heartbeat_at = now` (and `status` if given) on this session's row (no row ⇒ no-op). Sweep runs only when the status
actually changed. Always `200 {"ok":true}`. [src: MissionEngine/src/api/app.ts:350-362] The Pilot sends it every 30 s
and on every away/back toggle, and ALWAYS includes `status` (`"away"` or `"back"`), so a periodic heartbeat from an
unchanged operator is a no-op status write that never sweeps; a status-free `{}` body (from `heartbeat()` with no argument)
only refreshes `last_heartbeat_at`. [src: MissionPilot/src/presence.ts:17,61-63,79] [src: MissionPilot/src/api/client.ts:69]

**`DELETE /api/presence[?workCenterId=UUID]`** — with `workCenterId` (non-UUID ⇒ `400 invalid work center id`) deletes only
this session's row for that WC; without, deletes this session's row. If a row existed, sweep that WC. `200 {"ok":true}`.
[src: MissionEngine/src/api/app.ts:364-378]

`last_heartbeat_at` is written but never read by any expiry logic in the engine; presence rows are removed only by
DELETE, re-POST, sign-out/logout or FK cascade. [src: grep lastHeartbeatAt: MissionEngine/src/api/app.ts:340,356; mission-control-db/src/dao/presence.ts:29]

### B.5.9 `POST /api/logout` and releaseUserOnSignOut

`POST /api/logout` (no body) runs **releaseUserOnSignOut(userId, sessionId)** then returns better-auth
`signOut({asResponse:true})` (clears the cookie; `200 {"success":true}`). [src: MissionEngine/src/api/app.ts:382-385]

releaseUserOnSignOut [src: MissionEngine/src/api/app.ts:71-102]:
1. Read this session's presence WC (if any).
2. `UPDATE instance_assignment SET status='offered', assigned_user_id=NULL, claimed_at=NULL, resolved_role_id=NULL,
   preferred_user_id=NULL, dispatch_policy=NULL, dispatch_reason=NULL, released_from_user_id=<old assigned_user_id>
   WHERE assigned_user_id=userId AND status='claimed'` — ALL of the user's claims (all sessions, all WCs).
3. Delete THIS session's presence row.
4. For each affected WC ∪ presence WC: `pg_notify('operator_change', wc)`, SSE push, sole-candidate sweep (+notify if it claimed).

AWAY or closing a tab never releases claims. [src: MissionEngine/src/api/app.ts:380-381]

### B.5.10 Claim / release

`loadAssignment(id)`: non-UUID or no row ⇒ route answers `404 {"error":"not found"}`. Join: assignment → step_instance →
workflow_instance → work_center. [src: MissionEngine/src/api/app.ts:389-404]

**`POST /api/assignments/:id/claim`** (no body) [src: MissionEngine/src/api/app.ts:406-444]
1. 404 if not found. 2. Not member of the assignment's WC ⇒ `403 {"error":"not a member of this work center"}`.
3. Allowed roles = `resolveStepAllowedRoles(workflowId, specJsonb, nodeOid)`; if non-empty, caller must hold one in this WC,
   else `403 {"error":"no matching role"}`; `resolved_role_id` = first matching role, else null.
4. Transaction: `UPDATE … SET status='claimed', assigned_user_id=caller, claimed_at=now, resolved_role_id, released_from_user_id=NULL
   WHERE id=:id AND status='offered'`; 0 rows ⇒ `409 {"error":"already claimed"}`; else `pg_notify('operator_change', wc)` in the tx.
5. SSE push. `200 {"ok":true}`.
Not idempotent (re-claim ⇒ 409). The step state and instance status are NOT checked: an offer whose step is PAUSED is claimable by id.

```
curl -X POST -b 'mission-engine.session_token=…' http://127.0.0.1:3006/api/assignments/3f1c…/claim
→ 200 {"ok":true}     | 409 {"error":"already claimed"} | 403 {"error":"no matching role"} | 404 {"error":"not found"}
```

**`POST /api/assignments/:id/release`** (no body) [src: MissionEngine/src/api/app.ts:446-476]
No membership re-check. Transaction: same SET clause as B.5.9 step 2 `WHERE id=:id AND status='claimed' AND assigned_user_id=caller`;
0 rows ⇒ `409 {"error":"not your claim"}`; else notify in tx. Then SSE push and sole-candidate sweep (never re-claims to the releaser
because of `released_from_user_id`). `200 {"ok":true}`.

```
curl -X POST -b '…' http://127.0.0.1:3006/api/assignments/3f1c…/release
→ 200 {"ok":true} | 409 {"error":"not your claim"}
```

### B.5.11 `POST /api/assignments/:id/submit`

Body (JSON, required) [src: MissionEngine/src/api/app.ts:488-495] [src: MissionPilot/src/api/types.ts:81-84]:

| kind | Other fields |
|---|---|
| `"complete"` | `signature?` |
| `"submit"` | `values?: object` (field values keyed by form `fieldName`/output), `signature?` |
| `"decision"` | `value: "yes"\|"no"` (required), `values?: object`, `signature?` |

`signature` = `{ "loginName": string, "password": string }`.

Processing order:
1. Not found ⇒ 404. No membership re-check (claimant-scoped).
2. Invalid JSON or `kind` ∉ {complete, submit, decision} ⇒ `400 {"error":"kind must be complete | submit | decision"}`.
3. Kind/step-type pairing (step type canonicalized): `decision` on a non-`YES_NO` step ⇒ `400 {"error":"kind \"decision\" is only valid for a YES_NO step"}`;
   `decision` with value ≠ `yes`/`no` ⇒ `400 {"error":"value must be 'yes' or 'no'"}`; a `YES_NO` step with any other kind ⇒
   `400 {"error":"a YES_NO step requires kind \"decision\""}`. [src: MissionEngine/src/api/app.ts:503-512]
4. Early claimant check: assignment status ≠ `claimed` or `assigned_user_id ≠ caller` ⇒ `409 {"code":"NOT_CLAIMANT","error":"assignment <id> is not held by the caller for step <stepOid>"}`
   (before any credential work, so the route is not a password oracle). [src: MissionEngine/src/api/app.ts:521-523]
5. **Signature gate**: the step needs a signature iff its frozen `form_document` contains a block with `type === 'esignature'`
   (first in document order; matched on type alone, fail-closed) AND NOT (`kind==='decision'` AND `value==='no'`).
   [src: MissionEngine/src/api/app.ts:529-531] [src: MissionEngine/src/core/esignature.ts:36-65]
   * `loginName` trimmed empty or `password` blank ⇒ `400 {"code":"SIGNATURE_REQUIRED","error":"This step requires an e-signature"}` (no audit row).
   * Verification (B.5.0 codes): login normalized via `normalizeLoginName`; the signer must be `status='active'` with a `credential`
     account whose scrypt hash verifies (better-auth's password verifier); `requireDifferentUser`; WC membership; `roleName`
     role exists and is held in this WC. [src: MissionEngine/src/core/esignature.ts:107-141]
   * Each failure inserts a `step_signature` row with `outcome:'failed'`, `failureCode`, signer ids when resolved,
     `signerLoginName: loginName.toLowerCase()`, `decision` (yes/no for decision else null), outside any transaction,
     then responds `{code, error}` with the mapped status. [src: MissionEngine/src/api/app.ts:545-557]
6. Build the UserAction: decision ⇒ `{step_oid, action:value, button_output:value, form_values: values}`; otherwise
   `{step_oid, action:'submit', form_values: (kind==='submit' ? values : {}) ?? {}}`. The client never names a step.
   [src: MissionEngine/src/api/app.ts:565-567]
7. `submitUserAction(instanceId, action, 'auto', claim={assignmentId, userId, signature})` [src: MissionEngine/src/core/submit.ts:86-102,110-322]:
   one transaction; instance lock (SKIP LOCKED) miss ⇒ `NOT_RUNNING`; instance status must be in {`running`,`stopping_cleanup`,`aborting_cleanup`}
   or in {`paused`,`pausing`,`resuming`} (completion is accepted while paused; successors are deferred until resume) else `NOT_RUNNING`;
   assignment re-read `FOR UPDATE` and must be `claimed` by caller for exactly this step row else `NOT_CLAIMANT`; verified signature ⇒
   `step_signature` row `outcome:'signed'` + trace `SIGNED` (`"<login> as <role|member>"`) + `form_values[esig.fieldName] = signer displayName`
   (skipped when `fieldName` is empty); step completes; screen values saved to `engine_state.lastFormValues`; `backPrefill` for the step cleared;
   cascade; `reconcileAndNotify` (closes the assignment as `completed`, opens new offers, NOTIFY `operator_change`).
   Any `EngineError` ⇒ `409 {code, error}`. [src: MissionEngine/src/api/app.ts:568-573]
8. SSE push; `200 {"ok":true}`.

Not idempotent: a repeated submit returns `409 NOT_CLAIMANT` (the assignment is no longer `claimed`).

```
curl -X POST -b '…' -H 'content-type: application/json' http://127.0.0.1:3006/api/assignments/3f1c…/submit \
  -d '{"kind":"submit","values":{"batchNo":"B-77"},"signature":{"loginName":"qa.lead","password":"…"}}'
→ 200 {"ok":true}
→ 403 {"code":"SIGNATURE_INVALID_CREDENTIALS","error":"Login name or password is incorrect"}

curl … /api/assignments/3f1c…/submit -d '{"kind":"decision","value":"no"}'
→ 200 {"ok":true}      (a "no" never needs a signature)
```

### B.5.12 `POST /api/assignments/:id/back`

No body. Not found ⇒ 404. No route-level claim check; `goBack` does all checks inside one transaction
[src: MissionEngine/src/api/app.ts:580-592] [src: MissionEngine/src/core/go-back.ts:40-110]:

1. Instance lock miss ⇒ `NOT_RUNNING` ("locked by another worker"); status ≠ `running` (exactly) ⇒ `NOT_RUNNING`.
2. Assignment `FOR UPDATE`; its step must belong to this instance, be `claimed` by caller ⇒ else `NOT_CLAIMANT`.
3. Step T state ≠ `WAITING_USER` ⇒ `STEP_NOT_WAITING`.
4. `BACK_NOT_ALLOWED` unless: T is a screen type with `button_bar.format==='fixed'` and `allow_back===true`; `S = engine_state.backFrom[T]`
   exists, S's def is a screen type, and S's step_instance row is `COMPLETED`.
5. Effects: T reset with step-run outcome `went_back` (actor = caller); trace `OPERATOR` `went back to «<S name>» [by <userId>]`;
   S reset but keeps its own `backFrom`; `backPrefill[S] = lastFormValues[S] ?? {}`; S's signatures marked superseded;
   S re-activated; persist; `reconcileAndNotify`.
6. After commit: try to claim S's new offer for the caller (`claimStepForUser`: member + allowed role in this WC; presence not required);
   on success NOTIFY `operator_change`. A failed claim is only logged; the response is still success.

`200 {"ok":true}`; `EngineError` ⇒ `409 {code, error}`.

```
curl -X POST -b '…' http://127.0.0.1:3006/api/assignments/3f1c…/back
→ 200 {"ok":true} | 409 {"code":"BACK_NOT_ALLOWED","error":"step rt_12 does not allow Back"}
```

### B.5.13 `POST /api/assignments/:id/stop`

No body. [src: MissionEngine/src/api/app.ts:596-624]
1. Not found ⇒ 404. 2. Not `claimed` by caller ⇒ `409 NOT_CLAIMANT` (`assignment <id> is not held by the caller`).
3. Instance status ≠ `running` ⇒ `409 NOT_RUNNING` (Stop is off while paused/pausing/stopping/cleanup).
4. Step state ≠ `WAITING_USER` ⇒ `409 STEP_NOT_WAITING`.
5. Def missing, `button_bar.format !== 'fixed'`, or `allow_stop !== true` ⇒ `409 STOP_NOT_ALLOWED`.
6. `requestStop(instanceId, {kind:'user', userId}, {stepOid, stepName})`: one transaction, actor user row must exist
   (`USER_NOT_FOUND`), instance row `FOR UPDATE`, status ∈ {running, paused, pausing} → `stopping` else `RUNTIME_INVALID_STATE`;
   inserts `runtime_control_event { verb:'stop', effect:'request', fromStatus, toStatus:'stopping', actor columns, stepOid, stepName }`.
   [src: mission-control-db/src/dao/runtime-control.ts:44-81] DaoError ⇒ `{code, error}` with 404 for `RUNTIME_NOT_FOUND`, else 409.
7. `pg_notify('operator_change', wc)`, SSE push, `200 {"ok":true}`. The worker loop then runs the stop/cleanup.

```
curl -X POST -b '…' http://127.0.0.1:3006/api/assignments/3f1c…/stop
→ 200 {"ok":true} | 409 {"code":"STOP_NOT_ALLOWED","error":"step rt_4 does not allow Stop"}
```

### B.5.14 Form images: `GET /api/instances/:instanceId/images/:filename`

Non-UUID instance id or unknown instance ⇒ `404 {"error":"not found"}`; not member of the instance's WC ⇒ `403`;
no `workflow_image (workflow_id = instance.workflow_id, filename = :filename)` ⇒ `404`. `200` decoded base64 bytes,
`Content-Type: <mime_type>`, `Cache-Control: private, max-age=3600`. The filename is the bare `src` of an image block
(URL-encoded by the Pilot). [src: MissionEngine/src/api/app.ts:242-263] [src: MissionPilot/src/screens/TaskScreen.tsx:358]

### B.5.15 Workflows tab projections

All three set `Cache-Control: no-store`. [src: MissionEngine/src/api/app.ts:265-299]

**`GET /api/work-centers/:wcId/runtime-workflows`** — non-UUID ⇒ `400 invalid work center id`; not member ⇒ 403.
`200` array (≤100, newest `runtimeNumber` first) of instances of this WC whose status ∈ RUNTIME_ACTIVE_STATUSES
(`queued, running, pausing, paused, resuming, stopping, aborting, stopping_cleanup, aborting_cleanup`), each:
`{ id, workCenterId, runtimeNumber, runtimeLabel, masterName, masterOid, masterVersion, masterState, status, createdByName|null,
createdByLabel|null, createdAt, queuedAt|null, startedAt|null, completedAt|null, scheduleLabel|null,
activeSteps: [{ stepOid, stepName|null, stepType, state, claimant: {userId, name|null, presence:'online'|'away'|'offline'}|null }],
errorText: string|null, mine: boolean }`. `activeSteps` = step rows in non-terminal states (`READY, EXECUTING, WAITING_ACTION,
WAITING_USER, WAITING_GATE, WAITING_PROPERTIES, WAITING_SCRIPT, PAUSED`) ordered by `order_index`, `created_at`; claimant presence
is the presence at the instance's WC, default `offline`; `errorText` = latest ERRORED step error for `errored` instances; `mine` uses the
visibility rule. [src: mission-control-db/src/dao/runtime-workflows.ts:35-55,128-137,144-227,233-266,441-482] [src: mission-control-db/src/db/schema/execution.ts:27]

**`GET /api/runtime-workflows/:id/diagram`** — non-UUID/unknown ⇒ `404 {"error":"not found"}`; not member ⇒ 403.
`200 { instanceId, runtimeNumber, runtimeLabel, masterName, root: DiagramSpec }`, where
`DiagramSpec = { oid, name (local_id or "(unnamed)"), version|null, state|null, notation: 'flowchart'|'bpmn'|'isa88' (default flowchart),
steps: [{ oid, name (local_id or "(unnamed step)"), stepType (or "UNKNOWN"), x, y (fallback 100+(i%5)*200, 100+floor(i/5)*150), childSpecOid|null, timedGate?: true }],
connections: [{ fromStepOid, toStepOid, condition|null, waypoints: [{x,y}]|null, sourceHandleId|null }], children: DiagramSpec[] }`
(recursion capped at depth 50; WORKFLOW PROXY links to the first child with equal `local_id`).
[src: mission-control-db/src/dao/workflow-diagram.ts:22-45,112-173,193-204]

**`GET /api/runtime-workflows/:id/live-states`** — same 404/403 rules. `200 { instanceId, status, steps: Record<stepOid, PilotLiveStep>, childActive: Record<string,string> }`,
one entry per reached stepOid (latest row by `order_index`, ties by `created_at`), works for terminal instances.
`PilotLiveStep = { state, nodeOid, error|null, assignment: { id, status:'offered'|'claimed', claimant: {displayName}|null, mine }|null,
armedGate: { predecessorOid, open, stopSent }|null, stepInstanceId, gateTimer: GateTimer|null }`.
[src: mission-control-db/src/dao/runtime-workflows.ts:484-582]

---

## B.6 Server-Sent Events: `GET /api/events?workCenterId=UUID`

Auth: session gate + membership. Errors (JSON, before streaming): `400 workCenterId is required`, `400 invalid work center id`,
`403 not a member of this work center`, `503 {"error":"events unavailable"}` when no hub. [src: MissionEngine/src/api/app.ts:207-213]

Stream (`Content-Type: text/event-stream`, Hono `streamSSE`) [src: MissionEngine/src/api/app.ts:214-232]:

| event | data | When |
|---|---|---|
| `inbox` | JSON InboxSnapshot (B.5.6) for this user + WC | immediately on connect; then on every debounced WC change |
| `theme` | `{"rev": <int>}` | a theme save anywhere (all sessions, any WC); client refetches `/api/theme` |
| `ping` | empty string | every 25 s keep-alive |

No `id:` fields are sent and `Last-Event-ID` is ignored: every (re)connect starts with a full snapshot; reconnect is the
browser EventSource default. The Pilot also polls `/api/inbox` every 10 s as a fallback. [src: MissionPilot/src/inbox-data.ts:19,147-166]

Fan-out (`OperatorEventHub`, one per process) [src: MissionEngine/src/api/events.ts:28-64]: each connection registered under
`<sessionId>:<wcId>:<random uuid>`; unregistered on abort and on stream end. `notifyWorkCenter(wc)` debounces 100 ms per WC, then
rebuilds the snapshot per registered session of that WC (per-user visibility); a build failure keeps the session. The hub
removes a session only when its `send` throws SYNCHRONOUSLY — but the route's `send`/`sendTheme` are
`(x) => void stream.writeSSE(...)`, which never throw (a failed write is a discarded promise rejection). In practice a dead
connection is unregistered only by `stream.onAbort` or the stream's `finally`. [src: MissionEngine/src/api/events.ts:44-49,60-61] [src: MissionEngine/src/api/app.ts:218-231]
`notifyTheme(rev)` is immediate to all sessions.

Feeding channels (each on a dedicated pg LISTEN connection, flat 5 s reconnect backoff) [src: MissionEngine/src/index.ts:114-127] [src: MissionEngine/src/wake.ts:37-83]:

| Channel | Payload | Effect |
|---|---|---|
| `operator_change` | work-center UUID | `hub.notifyWorkCenter(payload)` (empty payload ignored) |
| `pilot_theme` | rev as decimal string | `hub.notifyTheme(rev)` if a safe integer |
| `engine_wake` | table name (trigger on `workflow_instance` insert/status update, `step_instance` state update) | wakes the worker loop (not SSE) |
| `wc_resource_grant` | instance id | wakes the worker loop (not SSE) |

[src: MissionEngine/src/core/reconcile.ts:19] [src: mission-control-db/src/dao/pilot-theme-store.ts:30,57] [src: mission-control-db/src/runtime/wc-resources.ts:25] [src: mission-control-db/drizzle/0018_mission_engine.sql:23-30]

Mutating routes in this process call `hub.notifyWorkCenter` directly in addition to NOTIFY, so other replicas learn via LISTEN.
A re-implementation MUST emit `pg_notify('operator_change', <wcId>)` (or an equivalent) for every inbox-visible change so Commander-side
and multi-replica listeners stay correct.

---

## B.7 Internal API (`/internal/*`) — Mission Commander → Engine

### B.7.1 Authentication and envelope

Every `/internal/*` request MUST carry header `x-internal-token: <ENGINE_INTERNAL_TOKEN>`; compared in constant time (length
mismatch fails). Token unconfigured or mismatch ⇒ `401 {"error":{"code":"UNAUTHORIZED","message":"invalid internal token"}}`.
No session, no origin check; it shares the public port. [src: MissionEngine/src/api/internal.ts:45-48,83-90]

Error envelope: `{ "error": { "code": "<UPPER_SNAKE>", "message": string } }`. Commander reads only the HTTP status and
`error.message` (404→not_found, 409→conflict, else 502). [src: MissionEngine/src/api/internal.ts:21-23] [src: MissionCommander/src/server/lib/engine-proxy.ts:24-28] [src: MissionCommander/src/server/lib/engine-client.ts:37-70]
All requests are `POST` with optional JSON body; invalid JSON is treated as no body.
On success Commander reads nothing from the control routes (any 2xx = ok) and, from the verb/value/force-complete
routes, only `summary` (a string, else it substitutes `"Done"`); `affectedInstanceIds` is not read by any consumer.
A network failure is mapped by Commander to `502 "Engine unreachable — try again"`.
[src: MissionCommander/src/server/lib/engine-client.ts:59-70] [src: MissionCommander/src/server/lib/engine-proxy.ts:32-40]

DaoError mapping (controls): `RUNTIME_NOT_FOUND`→404, `USER_NOT_FOUND`→400, else 409. [src: MissionEngine/src/api/internal.ts:75-78]
VerbError mapping: `VALIDATION`→400, `NOT_FORCEABLE`→403, `*_NOT_FOUND`→404, else 409. [src: MissionEngine/src/api/internal.ts:238-243]

**Actor** (controls): absent/null ⇒ `{kind:'system', label:'internal'}`; `{kind:'user', userId: UUID}`; `{kind:'remote', label: non-empty string, instanceId?: string|null}`;
`{kind:'system', label: non-empty string}`; anything else ⇒ `400 VALIDATION "invalid actor"`. [src: MissionEngine/src/api/internal.ts:50,60-73]

### B.7.2 Route table

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/internal/instances/:id/pause` | `{actor?}` (validated, unused) | `{ok:true}` | non-UUID ⇒ 404 `RUNTIME_NOT_FOUND`; `RUNTIME_INVALID_STATE` 409 (`cannot pause from <s>`); only `running`→`pausing` |
| POST | `/internal/instances/:id/resume` | `{actor?}` (unused) | `{ok:true}` | only `paused`→`resuming` |
| POST | `/internal/instances/:id/stop` | `{actor?}` | `{ok:true}` | `running\|paused\|pausing`→`stopping`, audit row |
| POST | `/internal/instances/:id/abort` | `{actor?}` | `{ok:true}` | `queued\|running\|pausing\|paused\|resuming\|stopping`→`aborting` (effect `request`); `stopping_cleanup`→`aborting` (effect `escalate`) |
| POST | `/internal/instances/:id/skip-cleanup` | `{kind:'stop'\|'abort', actor:{kind:'user',…}}` | `{ok:true}` | kind invalid ⇒ 400 `VALIDATION "kind must be 'stop' or 'abort'"`; actor not user ⇒ 400 `"only a user may skip the cleanup"`; stop: `stopping\|stopping_cleanup`→`stopping`; abort: `aborting\|aborting_cleanup`→`aborting`; sets `cleanup_skip=kind` |
| POST | `/internal/assignments/:id/force-release` | none | `{ok:true}` | non-UUID/unknown ⇒ 404 `ASSIGNMENT_NOT_FOUND`; not claimed ⇒ 409 `RUNTIME_INVALID_STATE "assignment is not claimed"` |
| POST | `/internal/assignments/:id/assign` | `{userId: UUID}` | `{ok:true}` | 404 `ASSIGNMENT_NOT_FOUND`; 400 `VALIDATION "userId (uuid) required"`; 409 `USER_NOT_ELIGIBLE`; 409 `ASSIGNMENT_NOT_OFFERED` |
| POST | `/internal/work-centers/:wcId/resources/{verb}` | `{name, actorUserId, holderId?, waiterId?, amount?, poolName?}` | `{ok:true, summary, affectedInstanceIds}` | non-UUID ⇒ 404 `WORK_CENTER_NOT_FOUND`; VerbError |
| POST | `/internal/instances/:id/resources/{verb}` | `{resourceKey, actorUserId, holderId?, waiterId?: int\|stepOid, amount?, poolName?}` | `{ok:true, summary, affectedInstanceIds}` | 404 `RUNTIME_NOT_FOUND`; VerbError |
| POST | `/internal/work-centers/:wcId/value-properties` | `{propertyName, entryName, value: string, actorUserId}` | `{ok:true, summary}` | 404 `WORK_CENTER_NOT_FOUND`; VerbError |
| POST | `/internal/instances/:id/value-properties` | `{key, value: string, actorUserId, specOid?}` | `{ok:true, summary}` | 404 `RUNTIME_NOT_FOUND`; VerbError |
| POST | `/internal/instances/:id/steps/:stepInstanceId/force-complete` | `{actorUserId, reason?}` | `{ok:true, summary}` | 404 `RUNTIME_NOT_FOUND`/`STEP_NOT_FOUND`; 400 `VALIDATION "actorUserId (uuid) is required"`; VerbError |

`{verb}` ∈ `release-holder, release, reset, cancel-waiter, clear-sync` (one route per verb; unknown verb = no route ⇒ 404 text).
[src: MissionEngine/src/core/registry-verbs.ts:35] [src: MissionEngine/src/api/internal.ts:92-328] [src: mission-control-db/src/dao/runtime-control.ts:25-98]

Field validation [src: MissionEngine/src/api/internal.ts:244-311]: `name`, `resourceKey`, `propertyName`, `entryName`, `key`, `poolName`, `specOid`
must be non-empty strings when used (`poolName`/`specOid` optional); `actorUserId` must be a UUID; `holderId`, `amount` (and numeric `waiterId`)
must be positive integers when present ⇒ else `400 VALIDATION` with messages `name and actorUserId (uuid) are required`,
`holderId, waiterId and amount must be positive integers`, `resourceKey and actorUserId (uuid) are required`,
`holderId and amount must be positive integers`, `waiterId must be a positive integer or a step oid`,
`propertyName, entryName, value (string) and actorUserId (uuid) are required`, `key, value (string) and actorUserId (uuid) are required`.
`reason` truncated to 500 chars.

Pause/resume write NO audit row (the actor is parsed but discarded); stop/abort/skip-cleanup write one
`runtime_control_event` row per success in the same transaction as the status change. The worker loop picks up the
transitional statuses (`pausing`, `resuming`, `stopping`, `aborting`) on its next cycle; the status UPDATE fires the
`engine_wake` trigger. [src: MissionEngine/src/api/internal.ts:51-56] [src: mission-control-db/src/dao/runtime-control.ts:36-37,44-75]

**force-release** [src: MissionEngine/src/api/internal.ts:138-169]: same SET clause as B.5.9 step 2, `WHERE id=:id AND status='claimed'`
(no claimant predicate); NOTIFY in tx; SSE push; sole-candidate sweep (+NOTIFY if it claimed).

**assign** [src: MissionEngine/src/api/internal.ts:179-233]: target user must be a WC member (`USER_NOT_ELIGIBLE "user is not a member of this work center"`)
and hold an allowed role if any (`USER_NOT_ELIGIBLE "user holds no allowed role for this step"`); presence NOT required;
`UPDATE … SET status='claimed', assigned_user_id, claimed_at=now, resolved_role_id, released_from_user_id=NULL, dispatch_reason='commander_assign'
WHERE id AND status='offered'` (0 rows ⇒ `ASSIGNMENT_NOT_OFFERED "assignment is not an open offer"`); NOTIFY; SSE push. `preferred_user_id`
and `dispatch_policy` are left unchanged.

VerbError codes (complete): `VALIDATION, RESOURCE_NOT_FOUND, HOLDER_NOT_FOUND, WAITER_NOT_FOUND, NOTHING_TO_RELEASE, NOT_A_SYNC_RESOURCE,
NOT_SUPPORTED, RUNTIME_NOT_FOUND, RUNTIME_INVALID_STATE, INSTANCE_BUSY, VALUE_NOT_FOUND, SHARED_KEY, CHILD_NOT_ACTIVE, INSTANCE_PAUSED,
STEP_NOT_FOUND, ALREADY_COMPLETED, ALREADY_OPEN, NOT_FORCEABLE`. [src: MissionEngine/src/core/registry-verbs.ts:38-46]
Their semantics belong to the resource/property sections; force-complete semantics are B.5.7 with `source:'commander'` (condition gates allowed).

Callers: Mission Commander server only (`engine-client.ts`), base `ENGINE_BASE_URL` default `http://127.0.0.1:3006`; stop/abort/skip-cleanup send
`actor: {kind:'user', userId}`; pause/resume send no body. [src: MissionCommander/src/server/lib/engine-client.ts:37-103] [src: MissionCommander/src/server/routes/runtime-workflows.ts:240-264]
Mission XO, the Broker and remote-control operations do NOT call the engine over HTTP; remote actors are written by the DB DAO directly.
[src: mission-control-db/src/runtime/remote-control/operations.ts:113] The engine ignores the `X-Mission-App` header (a Commander/XO concern).
[src: grep x-mission-app MissionEngine/src: no hits]

```
curl -X POST -H 'x-internal-token: $TOKEN' -H 'content-type: application/json' \
  http://127.0.0.1:3006/internal/instances/7d2e…/stop -d '{"actor":{"kind":"user","userId":"5b0e…"}}'
→ 200 {"ok":true}
→ 409 {"error":{"code":"RUNTIME_INVALID_STATE","message":"cannot stop from completed"}}

curl -X POST -H 'x-internal-token: $TOKEN' http://127.0.0.1:3006/internal/assignments/3f1c…/force-release
→ 200 {"ok":true} | 409 {"error":{"code":"RUNTIME_INVALID_STATE","message":"assignment is not claimed"}}
```

---

## B.8 Static Pilot bundle and service worker

* Root `./public` (relative to the engine CWD; the Docker image copies the Pilot build there). [src: MissionEngine/src/index.ts:84,100] [src: MissionEngine/Dockerfile:91-102]
* `/assets/*` successful responses get `cache-control: public, max-age=31536000, immutable`. [src: MissionEngine/src/index.ts:89-92]
* Any successful `text/html` response without its own `cache-control` gets `cache-control: no-cache`. [src: MissionEngine/src/index.ts:93-99]
* `serveStatic` serves GET/HEAD only; then `GET *` returns `index.html` (SPA fallback; absent bundle ⇒ 404). [src: MissionEngine/src/index.ts:100-101] [src: MissionEngine/node_modules/@hono/node-server/dist/serve-static.mjs:75-76]
* The Pilot's PWA service worker (vite-plugin-pwa, `registerType:'autoUpdate'`, `start_url:'/'`) precaches `**/*.{js,css,html,svg}` plus default fonts,
  runtime-caches `/fonts/*` (CacheFirst, `pilot-fonts`, 80 entries) and `/api/brand/*` (CacheFirst, `pilot-brand`, 20 entries). No other `/api/*`
  response is cached by the SW. [src: MissionPilot/vite.config.ts:39-78] `public/theme-boot.js` applies the cached theme before React mounts.
  [src: MissionPilot/src/theme/site-theme.ts:19]

---

# Part 4 — Outbound calls, resources, assignments, signatures, configuration (sections D.x)

This section specifies everything the Mission Engine calls out to (action servers, Mission Broker, the script sandbox) and the shared-database mechanisms it runs alongside them: resources, operator assignments, e-signatures, and engine configuration. "The engine" below means a conforming re-implementation; "the reference engine" means `MissionEngine/src`.

Throughout, `deps.now()` is the engine's clock. Every time comparison in the engine MUST go through one injectable clock so tests can drive it. [src: MissionEngine/src/config.ts:36-43]

---

## D.1 Action-server client protocol (as the engine actually uses it)

### D.1.1 Where an action server is

1. The engine MUST NOT dial `action_server_specifications[*].uri` from the package. The server URI for a step comes only from the work-center binding table `work_center_environment_binding (work_center_id, environment_oid) → server_uri`, read through `getEnvironmentBinding(db, workCenterId, environmentOid)`. It returns `server_uri` or `null`. [src: MissionEngine/src/index.ts:62-63; mission-control-db/src/dao/environment-bindings.ts:55-59]
2. The binding key (`bindingEnvironmentOid`) is the oid of the **embedded environment spec** the step resolves to inside the frozen recipe (`workflow_instance.spec_jsonb`), not always `action_proxy_config.environment_oid`. Resolution, in order [src: MissionEngine/src/loop.ts:336-363, 398-415]:
   1. `findEnvSpec(spec, nodeOid, cfg.environment_oid)`: look in the step's **owning** node spec's `environment_specifications[]` by `oid`, then in the root spec's.
   2. If none was found and `cfg.environment_name` is a non-empty string: `findEnvSpecsByName` matches `local_id === environment_name`. It searches the owning scope first; the first scope with any match wins. 0 matches fails the step with `ERRORED` and the message `package resolution: no embedded environment named "<name>" (step's environment_oid "<oid>" is not in the package)`. 2 or more matches fails it with `package resolution: multiple embedded environments named "<name>" — ambiguous`.
   3. `environmentName = envSpec?.local_id ?? cfg.environment_name ?? null`.
   4. `actionName = envSpec.included_actions[].find((a.action_oid ?? a.oid) === cfg.action_oid).action_name ?? cfg.action_name ?? null`.
   5. `bindingEnvironmentOid = envSpec?.oid ?? cfg.environment_oid`.
3. With no binding row, the dispatch fails (ERRORED, failure mode `ERROR`) with the message `No action server is bound for environment "<environmentName ?? bindingOid>" in this work center. Set it in Mission Commander under the work center's environment bindings.` [src: MissionEngine/src/actions/invoker.ts:108-112]
4. The engine appends `/trajectory/v1/...` to the bound URI by plain string concatenation (`${serverUri}/trajectory/v1/...`). [src: MissionEngine/src/actions/client.ts:298,312,323,337,351,406,442; sse.ts:329]

### D.1.2 Trust policy (Strict / Loose) and allowlist

| Item | Rule | Source |
|---|---|---|
| Storage | `system_settings` rows `action_server_trust` (`'strict'`/`'loose'`) and `action_server_allowlist` (JSON array of origin strings). | mission-control-db/src/dao/system-settings.ts:43-44 |
| Read | `trust = row === 'loose' ? 'loose' : 'strict'` (absent or unknown → strict). The allowlist is `JSON.parse`d; non-array, unparseable or absent → `[]`; non-string entries are dropped. Both fail closed. | system-settings.ts:58-72 |
| Cache | The policy read is wrapped in a TTL cache (default `ttlMs = 5000`). Concurrent callers share one in-flight read, and a failed read is not cached. | MissionEngine/src/actions/policy-cache.ts:22-41; index.ts:61 |
| Check (`isAllowed`) | Parse `serverUri` with `new URL`; a parse failure → false. A protocol other than `http:`/`https:` → false. **Loose** → true, and the engine logs `console.warn` once per origin per process: `[mission-engine] action-server trust is LOOSE: contacting <origin> without an allowlist check`. **Strict** → `allowlist.includes(url.origin)`: exact origin match, no wildcards or prefixes. An empty list allows nothing. | actions/client.ts:273-290 |
| Gate | Every outbound call (invoke, getInstance, sendCommand, deleteInstance, capabilities, getProperty, both SSE streams) MUST run `assertAllowed` first, before any network I/O. A failed check throws `ActionServerNotAllowed`, message `Action server is not in the allowlist: "<serverUri>". Add its origin under Mission Commander → Settings → Action server trust, or switch the trust mode to Loose.` | client.ts:162-168, 292-294, 297, 311, 322, 335, 345, 404, 427, 441 |
| Seed | At boot, `ACTION_SERVER_ALLOWLIST` (comma-separated) seeds `action_server_allowlist` **only if the row is absent** (`INSERT … ON CONFLICT DO NOTHING`). Entries are normalized to origins (`normalizeActionServerOrigin`: http(s) only, path `/` or empty, no query or hash). Invalid entries are warned about and skipped, duplicates are removed, and an empty result writes nothing. A failed seed is logged and boot continues. | index.ts:50-60; system-settings.ts:46-56, 93-109 |

`deleteInstance` also asserts the policy. If the policy refuses, it throws **before** its own try/catch, so a not-allowed delete rejects. Every caller wraps it in `.catch(() => {})`. [src: client.ts:334-342; monitor.ts:309; loop.ts:473]

### D.1.3 Credentials

The engine holds at most two credentials. It MUST send each one only to requests whose `new URL(url).origin` equals that credential's configured origin [src: client.ts:245-254; config.ts:130-155,172-173]:

| Config (both must be set, else `null`) | Sent to origin | Header |
|---|---|---|
| `MISSION_BROKER_URL` + `MISSION_BROKER_TOKEN` | origin of `MISSION_BROKER_URL` | `Authorization: Bearer <token>` |
| `MISSION_ACTIONS_URL` + `ACTIONS_API_KEY` | origin of `MISSION_ACTIONS_URL` | `X-API-Key: <key>` |

The broker is checked first. Any other origin receives no credential. The SSE streams carry the same credential header for their origin. [src: client.ts:428,443; sse.ts:255-258]

**401 classification** (`bodyOrRefusal`, applied on the error path of invoke, getInstance, sendCommand, capabilities and getProperty) [src: client.ts:259-270]:
- If the response body contains the text `missing or wrong broker token`, throw `BrokerTokenRejected`. Message: `Mission Broker refused the call: the engine's MISSION_BROKER_TOKEN does not match the broker's, or this environment's binding does not use the MISSION_BROKER_URL address. Set the same token for both in .env, check the binding, and restart them.` [client.ts:145-151]
- Else, if the URL's origin is the Mission Autopilot origin, throw `ActionsKeyRejected`. Message: `Mission Autopilot refused the call: the engine's ACTIONS_API_KEY does not match the server's, or this environment's binding does not use the MISSION_ACTIONS_URL address. Set the same ACTIONS_API_KEY for both in .env, check the binding, and restart them.` [client.ts:154-160]
- Otherwise the body text is returned for the caller's ordinary error.

### D.1.4 Timeouts

Every non-stream request MUST be bounded by `AbortSignal.timeout(ACTION_FETCH_TIMEOUT_MS)` (default `10_000` ms). The two SSE streams MUST NOT carry that timeout: they use the raw fetch with an `AbortController` that is aborted only by `close()`. [src: client.ts:204-207, 232, 240-243, 421-429; sse.ts:241-258, 306-310; config.ts:164]

### D.1.5 Every request the engine sends

| # | Purpose | Method + path | Headers | Body | Success | Response parsing | Error handling |
|---|---|---|---|---|---|---|---|
| R1 | Invoke | `POST {uri}/trajectory/v1/actions/{encodeURIComponent(actionOid)}/invoke` | `Content-Type: application/json` + credential | `InvokeRequest` (below) | **201 only** | `json.data.instance_id` | Any non-201 → `ActionInvokeFailed(status, body)`, message `action invoke failed (<status>): <body>` |
| R2 | Status | `GET {uri}/trajectory/v1/instances/{enc(instanceId)}` | credential | — | 200 | `toSnapshot(json.data)` | 404 → `ActionInstanceLost`, message `Action instance not found on server: "<id>"`. Other non-200 → `ActionStatusFailed(status)`, message `action getInstance failed (<status>): <body>` |
| R3 | Command | `POST {uri}/trajectory/v1/instances/{enc(id)}/command` | `Content-Type: application/json` + credential | `{"command":"<CMD>"}` | **200 or 409** (both resolve) | none | Other → `ActionCommandFailed(status)`, message `action command failed (<status>): <body>` |
| R4 | Delete | `DELETE {uri}/trajectory/v1/instances/{enc(id)}` | credential | — | any | ignored | Fetch errors swallowed (the policy check is not swallowed, see D.1.2) |
| R5 | Capabilities | `GET {uri}/trajectory/v1/capabilities` | credential | — | 200 | see D.1.6 | non-200 → `Error("action capabilities failed (<status>): <body>")` |
| R6 | Property read (REST-11) | `GET {uri}/trajectory/v1/properties/{enc(group)}?environment_oid={enc(envOid)}` | credential | — | 200 | `{environmentOid: data.environment_oid, name: data.name, entries: data.entries ?? []}` | non-200 → `Error("action property read failed (<status>): <body>")` |
| R7 | Instance events (REST-06) | `GET {uri}/trajectory/v1/instances/{enc(id)}/events` | `Accept: text/event-stream` + credential | — | 200 with body | SSE, see D.1.8 | no reconnect |
| R8 | Property events (REST-12) | `GET {uri}/trajectory/v1/properties/{enc(group)}/events?environment_oid={enc(envOid)}` | `Accept: text/event-stream` + credential | — | 200 with body | SSE, see D.1.10 | reconnect with backoff (D.1.10) |

[src: client.ts:296-332, 334-374, 401-419, 426-444; sse.ts:255-258, 321-332]

The commands the engine ever sends are `PAUSE`, `RESUME`, `STOP` and `ABORT`. The type also allows `HOLD`, `UNHOLD` and `CLEAR`, but the engine never sends them. [src: client.ts:54; control.ts:16 (AfterCommitCommand command set); loop.ts:514; control.ts:897,962,966; operator-cleanup-flow.ts:297]

**InvokeRequest body** (exact field names; JSON key order as written) [src: client.ts:63-70; invoker.ts:121-128]:

```json
{
  "environment_oid": "<strict: cfg.environment_oid | loose: server's environment_oid>",
  "workflow_instance_id": "<workflow_instance.id (uuid)>",
  "step_instance_id": "<step_instance.id (uuid)>",
  "step_oid": "<step oid in the frozen recipe>",
  "input_parameters": [{ "name": "<id>", "value": "<string>" }],
  "timeout_ms": 600000
}
```

- `timeout_ms` is `action_proxy_config.timeout_ms`. When that is `undefined`, `JSON.stringify` omits the key. [src: invoker.ts:127; loop.ts:421]
- Under strict matching, `environment_oid` is `cfg.environment_oid`, not the binding oid. [src: invoker.ts:114]
- `input_parameters` is `Object.entries(engine_state.stepSnapshots[stepOid].inputParameters)` as `{name, value}` pairs. The snapshot is `PropertyStore.getInputParameters()`, taken at activation: the step's own resolved inputs (`input_parameter_specifications[].id → default_value`, resolved through the property store when `value_type === 'property'`), overlaid with Action-Property binding values, **plus every workflow starting parameter whose name is not already an input**. [src: loop.ts:389-391; transition.ts:2385; properties.ts:107-119, 233-245]
- A `value_type: 'property'` input whose key names a whole Value Property group (no exact key) resolves to the JSON list string `[{"name":..,"value":..}]`. Shared-tier entries are merged first, local entries win, and a `Description` entry (case-insensitive) is excluded. [src: properties.ts:128-150]

### D.1.6 Capabilities parsing and cache

- The engine MUST parse the grouped shape `data.environments[].{environment_oid, environment_name, actions[].{action_oid, action_name, visibility, input_parameters[].name, supported_commands}}`. It builds `byActionOid: Map<action_oid, {supportedCommands, opaque: visibility === 'opaque'}>` and an `environments[]` list for loose matching. A missing field throws, and the call fails. [src: client.ts:93-105, 355-373]
- Cache: per **origin**, TTL `CAPABILITIES_TTL_MS = 5 * 60 * 1000`. `invalidateCapabilities(uri)` deletes the entry. `peekCapabilities` returns an entry even past its TTL and never fetches or reads the policy. `hasFreshCapabilities` is a TTL check against the cache only. [src: client.ts:125, 344-396]
- **Command legality** [src: control.ts:192-221]:
  - `commandSupportCached(client, uri, actionOid, cmd)` reads the cache only.
    - No cache entry → `'unknown'`.
    - Action absent, or `opaque` → `'unsupported'`.
    - Otherwise `'supported'` iff `supportedCommands.includes(cmd)`.
  - `actionOid` is `step_instance.action_invoked_oid ?? cfg.action_oid`. [control.ts:280; gate.ts:213]
  - The engine MUST never decide PAUSE/STOP legality with a network call inside a locked transaction.
- **Warm-up** (`warmCapabilities`) runs before every control pass (`scope 'control'`) and every gate pass (`scope 'gate'`). It fetches capabilities for the distinct origins of [src: core/capability-warmup.ts:30-38, 59-77, 96-147]:
  - `'control'`: WAITING_ACTION steps of `pausing` instances, and WAITING_ACTION/PAUSED steps of `stopping` instances not yet in `engine_state.stoppedActions`.
  - `'gate'`: predecessors of due armed gates whose `stopSent` is false.
  - Per instance (`warmCapabilitiesForInstance`), run by every force-complete — Commander's `/internal/.../force-complete`
    AND the Pilot's `POST /api/runtime-workflows/:id/steps/:sid/continue` — before its transaction: the distinct
    `action_server_uri`s of that instance's step rows that have an action instance id and are in a commandable state.
    So an operator "Continue now" can cause outbound `GET /trajectory/v1/capabilities` calls. [src: core/capability-warmup.ts:98-108,162-169; core/force-complete.ts:54]

  Warm-up rules:
  - Origins are warmed in parallel, and concurrent slots share one in-flight fetch per origin.
  - A fresh entry is skipped.
  - A failed fetch invalidates the entry and backs the origin off for `WARMUP_FAILURE_BACKOFF_MS = 30_000`.
  - Warm-up never throws.
  - `markOriginUnreachable` (after an unreachable command send) invalidates the cache and starts the same 30 s back-off. [src: capability-warmup.ts:79-87]

### D.1.7 Strict vs loose matching

- The mode is `system_settings['action_matching']`: `'strict'` iff the value is exactly `'strict'`, **otherwise `'loose'`**, so the default is loose. It is read per dispatch, with no cache. [src: mission-control-db/src/dao/system-settings.ts:24-30; loop.ts:393-397]
- **Strict**: invoke the path `action_oid = cfg.action_oid` and the body `environment_oid = cfg.environment_oid`. [src: invoker.ts:113-120]
- **Loose** (`resolveLoose`) [src: invoker.ts:146-180]:
  1. If `environmentName` or `actionName` is null, fail with `loose match: the workflow package carries no name for action oid "<a>" (or environment oid "<e>") — cannot match by name`.
  2. `inputNames = declaredInputNames ?? inputParameters.map(p => p.name)`. `declaredInputNames` = the step's `input_parameter_specifications[].id`, always passed by the reference loop. [src: loop.ts:422]
  3. `resolveOnce(capabilities)` makes exact, case-sensitive comparisons:
     - environments with `environmentName === envName`: 0 → `loose match: no environment named "<n>" on the action server. Check this environment's binding in this work center.`; more than 1 → `loose match: multiple environments named "<n>" on the action server — ambiguous`
     - actions with `actionName === actionName`: 0 → `loose match: environment "<e>" has no action named "<a>". Check this environment's binding in this work center.`; more than 1 → `… has multiple actions named "<a>" — ambiguous`
     - every `inputNames` entry must be in the action's `input_parameters[].name`, else `loose match: action "<a>" is missing input parameter(s): <comma list>`
  4. On a miss: `invalidateCapabilities`, fetch again, and run `resolveOnce` one more time (exactly one retry). A fetch error becomes `{ok:false, error: err.message}`.
  5. On success, invoke the path with the server's `action_oid` and the body with the server's `environment_oid`.
- Invoke failure messages [src: invoker.ts:132-141]:
  - `ActionServerNotAllowed` → `<message> (environment "<envLabel>")`
  - `ActionInvokeFailed` with status 404 → `<serverUri> has no action "<actionName ?? actionOid>" for environment "<envLabel>". Check this environment's binding in this work center.`
  - otherwise `err.message`
- The oid actually invoked is recorded in `step_instance.action_invoked_oid`. [src: loop.ts:459-462]

### D.1.8 Invoke lifecycle, observation, timeouts

**Activation.** An ACTION PROXY step enters `WAITING_ACTION` with an `EXECUTING` trace. `action_instance_id`, `action_server_uri` and `action_invoked_oid` are set to NULL. When the invoker dispatches, `wake_at = now` (due at once). With a non-dispatching invoker (conformance mode), `wake_at = NULL` and the step parks forever. [src: transition.ts:2410-2451]

**Due-wake claim** (`claimDueActionStep`, one transaction) [src: loop.ts:285-332]:
- Candidates: `step_instance` rows with `wake_at IS NOT NULL`, `wake_at <= now`, `state IN ('WAITING_ACTION','PAUSED')` and `step_type <> 'GATE'`.
- Claim the owning instance `FOR UPDATE SKIP LOCKED`.
- Eligible instance statuses are `running`, `stopping_cleanup`, `aborting_cleanup`, `paused`, `pausing`, `stopping` and `aborting`. `aborting` counts only while `engine_state.operatorCleanup = {kind:'abort', phase:'halting'}`.
- Pick the oldest due row (order by `wake_at, id`).
- If `action_instance_id IS NULL` (invoke path), re-arm `wake_at = now + INVOKE_GRACE_SECS` (default 60) **before** commit. This is the in-flight guard and crash-recovery timer.
- A raced claim with no due row bumps `workflow_instance.updated_at`.

**Invoke path** (`invokeDueStep`) [src: loop.ts:371-476, 606-615]:
1. Only if the instance status at claim is running-like (`running`/`stopping_cleanup`/`aborting_cleanup`). Otherwise decline: no new dispatch while paused or stopping.
2. Resolve the binding and invoke **outside any transaction**.
3. On failure: route `ERRORED` with `result.error` through the terminal funnel. The resulting failure mode is `ERROR`.
4. On success, in a fresh transaction: re-claim the instance by id (SKIP LOCKED). Then, only if the row still has `action_instance_id IS NULL` and `state ∈ {WAITING_ACTION, PAUSED}`, set:
   - `action_instance_id`, `action_server_uri`, `action_invoked_oid`
   - `started_at = invokedAt`
   - `wake_at = min(invokedAt + ACTION_POLL_SECS, invokedAt + timeout_ms)`
5. If recorded, open the SSE fast path (fire-and-forget). If not recorded, send best-effort R4 DELETE for the orphan. "Not recorded" covers BOTH a race lost to a control pass (row no longer parked, or `action_instance_id` already set) AND a plain instance-lock miss: when the record transaction's `claimInstanceById` (SKIP LOCKED) finds the instance row held by another worker, the engine deletes the action instance it just created and leaves the step with `action_instance_id = NULL`, so the step is re-invoked when the grace `wake_at` (step 1 of the claim) comes due. [src: loop.ts:443-474]
6. **No invoke retry**: a failed invoke is never retried. A second invoke for the same step activation happens only through grace recovery, when the first attempt's result was never recorded and `wake_at` came due again.

**Poll path** (`pollDueStep`) [src: loop.ts:486-585]:
- Deadline:
  - If `state === 'PAUSED'`: no deadline (the timeout is suspended).
  - Else, if `timeout_ms` is set: `started_at + timeout_ms`. The resume pass shifts `started_at` forward by the paused duration. [control.ts:402-411]
- If `now >= deadline`:
  1. close SSE monitoring
  2. send best-effort `ABORT` (R3, errors swallowed)
  3. apply terminal `TIMEOUT` with message `action timed out`. Failure mode `TIMEOUT`, whatever the server later reports.
- Else R2:
  - a terminal state → apply that terminal
  - `ActionInstanceLost` (404) → terminal `ERRORED`, message `Instance lost on server`
  - any other error → **never fails the step**. It is logged at most once per 5 min per (instance, `POLL`, uri) as `[mission-engine] instance <id>: action server <uri> not answering status checks (<detail>)`. `<detail>` is `HTTP <status>` for `ActionStatusFailed`, `HTTP 401` for the token/key refusals, else the error message. The engine records `engine_state.pollFailingSince[stepOid]`. After `PAUSE_UNKNOWN_LIMIT_MS = 120_000` of continuous failure it writes **one** `WARNING` trace: `action server not answering status checks (<detail>) — this action may still be running` (deduplicated by `pollWarned`). A successful check clears both.
- Re-arm `wake_at = min(now + ACTION_POLL_SECS, deadline)` in a fresh transaction, guarded on the same `action_instance_id`.

**Terminal mapping** [src: monitor.ts:47-62, 90-95]:

| Server `state` (R2 or SSE `state_change`) | Terminal kind | Failure mode |
|---|---|---|
| `COMPLETED` | COMPLETED | — (step completes) |
| `ABORTED` | ABORTED | `ABORT` |
| `STOPPED` | STOPPED | `ABORT`, unless an armed gate on this step is `open`, then COMPLETED |
| `ERRORED` | ERRORED | `ERROR` |
| (synthetic) | TIMEOUT | `TIMEOUT` |
| any other string (e.g. `RUNNING`, `EXECUTING`, `PAUSED`, `IDLE`, `HELD`) | — still running | — |

**State parsing** (`toSnapshot`): `data.state` is accepted as a bare string, or as an object whose `current` is a string. Anything else → `''`, which counts as non-terminal. `outputs` go through `toNamePairs`: only array items that are objects; the id is `name` if it is a string, else `key` if it is a string, else the item is dropped; the value is `value == null ? '' : String(value)`. [src: client.ts:80-86; sse.ts:131-142]

**Terminal funnel** (`applyActionTerminal`) [src: monitor.ts:124-311]:
1. Close SSE for the step.
2. Pre-check on the plain db: the row must be in `WAITING_ACTION` or `PAUSED`, else no-op.
3. **Before** locking, fetch R2 again for `COMPLETED`, so outputs come from the authoritative re-read and never from the event. Errors propagate. For `STOPPED`, also fetch (errors → null).
4. Lock the instance (claim by id, SKIP LOCKED). If the instance is busy, the terminal is dropped; the next poll re-detects it. Instance status must be running-like, `paused`, `pausing`, `stopping`, or `aborting` during an Operator Abort halt.
5. Re-check the row is still parked **and** `action_instance_id` equals the pre-checked one. Otherwise the terminal belongs to a superseded instance and is discarded.
6. Abort-halt drain: the step becomes `ABORTED` (trace `ABORTED`), whatever the terminal.
7. COMPLETED: for each `output_parameter_specifications[]` with a `target`, find the output whose `name === spec.id`.
   - A target containing `.` → `props.set(target, value)`.
   - Otherwise `setSyncTarget(target, value)`: set the whole key, and if the value parses as a `[{name,value}]` list, also set `target.<name>` per entry.
   - The landed values are recorded in `stepSnapshots[stepOid].outputParameters`.
   - Then `finishStep` and the cascade (or defer routing while paused; settle the stop drain while stopping).
8. Failure kinds:
   - `stopping` → force `ERRORED`, no TRY/CATCH.
   - `paused`/`pausing` → defer: `wake_at = NULL` and push `{stepOid, mode, message}` to `deferredFailures` (replayed on resume).
   - otherwise `failStep(mode, message)`, which a matching TRY may catch. The default message is `action <kind lowercased>`.
9. After commit: best-effort R4 DELETE when an action instance id was recorded.

**SSE fast path** (`startActionMonitoring`) [src: monitor.ts:372-433; sse.ts:113-184, 234-332]:
- Opened only after a recorded invoke. It reserves the per-step slot synchronously, so a racing close never leaks a stream.
- No `Last-Event-ID`, no reconnect. When the stream ends, polling remains the backstop.
- Parser:
  - CRLF is normalized to LF and blocks are split on a blank line (`\n\n`).
  - Fields `event:`, `data:` (one leading space stripped; multiple lines joined with `\n`) and `id:`. Other lines, including `:` comments, are ignored.
  - A block with no event or no data is dropped. `data` must parse as JSON, else the block is dropped.
  - `event:` and `id:` values are `trim()`med; `id` is kept as `Number(id)` (NaN when absent) but never used.
  - Only a CR LF pair is normalized (a lone CR line ending is not), and a CR LF split across two network chunks is not
    normalized either. Bytes left in the buffer when the stream ends (a final block without its blank line) are discarded.
  - Unlike R2's `toSnapshot`, a `state_change` payload's `state` is taken verbatim: the server MUST send it as a bare
    string (`"COMPLETED"`); the object form `{current: …}` never matches a terminal on the SSE path (the poll still sees it).
  [src: sse.ts:113-126, 151-161, 287-303]
- Instance events:
  - `state_change` → `{state: data.state, previous_state, ts: data.timestamp}`
  - `output`, `log`, `heartbeat` are parsed but ignored
  - other event names are ignored
- Only a `state_change` whose `state` maps to a terminal (table above) triggers the funnel. Errors in the funnel are caught and logged (`SSE-triggered applyActionTerminal failed …`).
- A not-allowed origin skips SSE silently. A policy-read failure is logged.

### D.1.9 Commands (pause / resume / stop / abort / gate stop)

Commands decided inside a locked control pass are collected as `AfterCommitCommand` and sent **after commit**, in order. [src: control.ts:72-119, 911-977]

| Engine event | Command | Condition | Record written in the pass | Source |
|---|---|---|---|---|
| Instance `pausing` | `PAUSE` | For each WAITING_ACTION step with an action instance: `commandSupportCached(...,'PAUSE')`. `'supported'` and not in `pauseRefused` → send, and the step becomes `PAUSED` with trace `PAUSED` and `pausedAt[stepOid] = now`. `'unsupported'` → left running, no trace. `'unknown'` → wait; set `pausingSince` once, stay `pausing` for up to 120 000 ms, then settle `paused` with a `WARNING` trace `action server unreachable — this action may still be running` for each still-unknown step. | as stated | control.ts:255-324 |
| Instance `resuming` | `RESUME` | Every `PAUSED` step with an action instance, with no capability check. Also each step in `pauseUndeliveredWarned` that is still WAITING_ACTION. PAUSED rows go back to WAITING_ACTION with trace `EXECUTING`, `wake_at = now`, and `started_at += (now − pausedAt)`. WAITING_GATE/WAITING_PROPERTIES/WAITING_SCRIPT rows get `wake_at = now`. | status `running` | control.ts:382-464 |
| Instance `stopping` | `STOP` | Once per step per drain (`stoppedActions`), for WAITING_ACTION/PAUSED steps with an action instance. `'unknown'` → retry on a later pass; `'unsupported'` → recorded, no send; `'supported'` → send and set `wake_at = now`. | `stoppedActions.push(stepOid)` | control.ts:507-640 |
| Instance `aborting` (plain abort) | `ABORT`, then R4 `DELETE` | Always, for every active row with a live action (capabilities not consulted). Rows become `ABORTED` first. | row `ABORTED` | control.ts:690-726, 892-899, 960-967 |
| Operator Abort halt (confirmed abort) | `ABORT` only (no DELETE) | The live action is left parked and monitored until its terminal arrives, or `OPERATOR_ABORT_CONFIRM_TIMEOUT_MS = 30_000` passes. | none | control.ts:744-760, 964-967; operator-cleanup.ts:49 |
| Armed GATE opens | `STOP` to the predecessor action | `'supported'` → send, `stopSent = true`, predecessor `wake_at = now`. `'unsupported'` or no client → `WARNING` trace `gate opened but the running action does not support STOP — waiting for natural completion`, `stopSent = true`. `'unknown'`, or a predecessor not yet dispatched → retry in `GATE_STOP_RETRY_MS = 5_000`. | `armedGates[gate].stopSent` | gate.ts:163-226 |
| Step timeout | `ABORT` | Always, best-effort | (terminal TIMEOUT) | loop.ts:508-517 |
| Orphaned Operator-cleanup actions (`finalizeOrphanedActions`, run by the loop outside any transaction) | `ABORT`, then R4 `DELETE` | For each entry of any instance's `engine_state.operatorCleanup.pendingAborts` (settled instances included) whose `action_instance_id` no non-terminal step row of a non-final instance still names. An entry still owned by a live row is kept while younger than `ORPHAN_KEEP_MS = 60_000`, then dropped unsent. A failed ABORT is retried on later scans until the entry is 60 s old, then given up with `console.warn` `[mission-engine] instance <id>: giving up the Operator cleanup ABORT of action <aid> on <uri>: <msg>`. DELETE follows only a delivered ABORT; DELETE errors are swallowed. | entry removed from `pendingAborts` | operator-cleanup-flow.ts:212, 242-312 |

**Send-failure classification** (`classifySendError`) [src: core/send-failure.ts:44-58; control.ts:92-119]:
- `ActionServerNotAllowed`, `ActionsKeyRejected`, `BrokerTokenRejected` → `refused`.
- `ActionCommandFailed`: 404 → `gone` (treated as delivered); other 4xx → `refused`; 5xx → `unreachable`.
- Anything else (network error, timeout) → `unreachable`.
- `RESUME` failures are only logged: `[mission-engine] instance <id> RESUME to <uri> failed: <reason>`.
- `unreachable` → `markOriginUnreachable` plus undo of the record (for example, remove the step from `stoppedActions`, or revert PAUSED), so a later pass sends again.
- `refused` → the record is kept and a WARNING is shown.
- A busy undo is queued in memory and retried at the start of each control pass. An engine restart loses a queued undo.
- Reasons are truncated to 200 characters.

### D.1.10 Action-property reads and the property watch

**Reads (REST-11)** happen for [src: core/property-overlay.ts:33-83; input-bindings.ts:32-127; gate.ts:313-332]:
- a non-GATE step with step-level `action_property_bindings`: once, at activation. The step parks in `WAITING_PROPERTIES` with `wake_at = now`. The claim re-arms `now + INVOKE_GRACE_SECS`, and the fetch runs outside the lock.
- a GATE with `gate_config.action_property_bindings` (mode not `timer`): before every evaluation.
- a repeating SCRIPT with step-level bindings: before every run.

Binding resolution, per binding:
- Environment: `findEnvSpec` by `environment_oid` first, then `findEnvSpecsByName(environment_name)` **only if it yields exactly one** match. Binding oid = `envSpec?.oid ?? b.environment_oid`.
- Server URI: the work-center binding.
- Property: `[group, ...rest] = property.split('.')`. Each `(bindingEnvOid, group)` pair is read once per evaluation.
  - A bare group → the overlay value is `JSON.stringify(entries without description)` as `[{name,value}]`.
  - `Group.Entry` → that entry's value (`rest.join('.')`, exact name).

Every miss fails the step (`ERROR`, TRY-routable) with one of these messages:
- `<label>s require a dispatching action invoker`
- `<label> for '<param>': no resolvable environment`
- `<label> for '<param>': no action server bound for environment <oid>`
- `<label> for '<param>': <fetch error>`
- `<label> for '<param>': property '<p>' has no entry '<e>'`

`<label>` is `gate binding` or `input binding`.

The overlay applies only to that evaluation and is never written to the property store. [src: properties.ts:121-126]

**Watch (REST-12)** [src: core/property-watch.ts:63-133, 140-149, 153-155, 207-418]:
- Enabled unless `PROPERTY_WATCH_ENABLED` is false, and only with a dispatching invoker.
- The **database is the only source of truth**. `reconcile()` reads all `WAITING_GATE`/`WAITING_SCRIPT` rows with `wake_at IS NOT NULL`, whatever the instance status. It resolves each row's binding keys (oid-then-unique-name env, binding, `isAllowed`; failures are logged once per (row, reason)) into keys `serverUri|environmentOid|group`. Group = the text before the first `.`. Reconcile then opens missing streams and closes unneeded ones.
- Reconcile runs at boot, every `PROPERTY_WATCH_RECONCILE_MS` (default 5000), and debounced `PROPERTY_WATCH_DEBOUNCE_MS = 500` after every loop cycle that did work (`onWorkDone`).
- On an SSE event `property` (fields `environment_oid`, `property_name`, `changed_entries`, `entries`, `timestamp`; the payload is **never used as a value**), the engine runs a single UPDATE on the key's members:

  ```
  wake_at = now WHERE id IN members AND state IN ('WAITING_GATE','WAITING_SCRIPT') AND wake_at IS NOT NULL AND wake_at > now
  ```

  If any row moved, it wakes the loop. There is no instance lock and no debounce on events; a burst collapses because rows already due are not touched.
- Reconnect: on `onEnd` or a subscribe failure, retry after `min(5000 · 2^attempt, 60000)` ms. A successful open (`onOpen`) resets `attempt`. A changed reason is logged again; the same reason is not.
- Shutdown closes every stream (SIGTERM/SIGINT). [src: index.ts:129-139]
- Stream end reasons: `connect failed: <m>`, `stream open failed (<status>): <first 200 chars of body>`, `stream open failed (no response): `, `stream open failed: empty body`, `callback error: <m>`, `stream error: <m>`, `stream ended`. [src: sse.ts:96-108, 243-303]
- A bound evaluation whose `wake_at` was pulled to `now` by an event while the fetch was in flight is re-pulled to `now` after evaluation. [src: gate.ts:357-366]

---

## D.2 Mission Broker / Distributed Workflow (ISA 113 runtime control)

### D.2.1 Role and transport

Mission Broker is an action server (protocol D.1) that shares the engine's database. It serves the GLOBAL "Distributed Workflow" library actions. [src: MissionBroker/src/app.ts:44-169; catalog.ts]

| Item | Value | Source |
|---|---|---|
| Port | `BROKER_PORT`, default `3007` | MissionBroker/src/config.ts:18 |
| Token | `MISSION_BROKER_TOKEN`, trimmed, **≥ 32 chars or the broker refuses to start** | config.ts:25-26 |
| Auth | Every route except `OPTIONS` and `GET /health` needs `Authorization: Bearer <token>` (scheme matched case-insensitively, `/^Bearer /i`; the rest is `trim()`med). On `GET /trajectory/v1/instances/:id/events` the broker also accepts `?token=` when no Bearer header is present. Comparison: SHA-256 of both sides, then `timingSafeEqual`. Failure → `401 {"error":"missing or wrong broker token"}` (the exact text the engine's `bodyOrRefusal` looks for, D.1.3). CORS runs before auth, so a 401 still carries CORS headers. | auth.ts:17-43; app.ts:50-52 |
| CORS | `BROKER_CORS_ORIGINS` (comma list); default `http://localhost:3004`, `http://127.0.0.1:3004`; headers `Authorization, Content-Type`; methods `GET, POST, DELETE, OPTIONS` | config.ts:27-28; app.ts:51 |
| Health | `GET /health` → `{"ok":true}` | app.ts:54 |
| Wait poll | `BROKER_POLL_MS`, default 5000; a value that is not finite or is below 250 makes the broker refuse to start (`BROKER_POLL_MS must be at least 250`). Likewise a non-integer or non-positive `BROKER_PORT` refuses start. | config.ts:18-21 |
| Retention | `BROKER_RETENTION_DAYS`, default 14, integer ≥ 1 | config.ts:22-24 |
| DB pool | max 5, `connectionTimeoutMillis` 5000 | index.ts:26 |

### D.2.2 Capabilities

There is one environment: `{environment_oid: "broker-env", environment_name: "Distributed Workflow Management"}`. Every action has `visibility: "opaque"` and `supported_commands: ["ABORT"]`, and `input_parameters` carries `[{name}]` only. [src: catalog.ts:20; app.ts:56-64]

| key | action_name (exact) | action_oid | inputs |
|---|---|---|---|
| create | `Create Runtime Workflow` | `broker-create` | `WorkCenter`, `Workflow`, `StartingParameters` |
| createStart | `Create and Start Runtime Workflow` | `broker-create-start` | same |
| start | `Start Runtime Workflow` | `broker-start` | `RuntimeWorkflow` |
| stop | `Stop Runtime Workflow` | `broker-stop` | `RuntimeWorkflow` |
| abort | `Abort Runtime Workflow` | `broker-abort` | `RuntimeWorkflow` |
| suspend | `Suspend Runtime Workflow` | `broker-suspend` | `RuntimeWorkflow` |
| unsuspend | `Unsuspend Runtime Workflow` | `broker-unsuspend` | `RuntimeWorkflow` |
| status | `Get Runtime Workflow Status` | `broker-status` | `RuntimeWorkflow` |
| wait | `Wait for Runtime Workflow` | `broker-wait` | `RuntimeWorkflow` |
| outputs | `Get Runtime Workflow Outputs` | `broker-outputs` | `RuntimeWorkflow` |

[src: catalog.ts:22-37]

Action lookup (`findAction(oid, actionName)`): by oid, then exact name, then a trimmed case-insensitive name match. Strict matching therefore works through the calling step's `action_proxy_config.action_name`. [src: catalog.ts:41-48]

Because every action is opaque, the engine never sends PAUSE or STOP to the broker (D.1.6). Operator Stop of a caller that waits on the broker relies on the broker's own wait logic (D.2.5).

### D.2.3 Invoke (`POST /trajectory/v1/actions/:oid/invoke`)

1. Body validation: `workflow_instance_id` and `step_instance_id` must be UUID strings (`/^[0-9a-f]{8}-…$/i`), `step_oid` a string, `input_parameters` an array of `{name: string, value: string}`. Other fields are ignored. Failure → `400 {"error":{"code":"VALIDATION_ERROR","message":"workflow_instance_id, step_instance_id, step_oid and input_parameters are required"}}`. [src: app.ts:26-42, 67-68]
2. **Caller authentication by database** (`loadCaller`). The step row must exist, belong to that workflow instance, have that `step_oid`, `step_type === 'ACTION PROXY'`, `state === 'WAITING_ACTION'` and a non-null `started_at`. Otherwise `RemoteError(NOT_PERMITTED)` → `403 {"error":{"code":"FORBIDDEN","message":"The calling step is not a waiting action step of that runtime"}}`. [src: mission-control-db/src/runtime/remote-control/authority.ts:45-74; app.ts:69-75]
3. The URL action is resolved as `findAction(<URL :oid>, <calling step's configured action_proxy_config.action_name>)`: the URL oid first, and when it is not a broker oid (strict matching sends Designer's spec id), the CALLING STEP's configured action name — never a name from the URL or body. No match: `404 {"error":{"code":"ACTION_NOT_FOUND","message":"No action \"<step action_name ?? URL oid>\""}}`. The step's **configured** action (`findAction(cfg.action_oid ?? '', cfg.action_name)`) must be the same action key, else `403 {"error":{"code":"FORBIDDEN","message":"The calling step is not waiting on this action"}}`. [src: app.ts:76-85]
4. **Idempotency (migration 0043)**: there is one broker row per step **activation**, keyed `(step_instance_id, step_started_at)`. The unique partial index is `broker_action_instance_activation_uq ON (step_instance_id, step_started_at) WHERE step_started_at IS NOT NULL`. If a row exists, the broker returns `201 {"data":{"instance_id":"<existing>"}}` without executing again. Otherwise it executes, then `INSERT … ON CONFLICT DO NOTHING`, and re-selects the winner on conflict. A loop re-entry gets a fresh `started_at` and therefore counts as a new activation. [src: app.ts:86-101; store.ts:25-41; mission-control-db/drizzle/0043_broker_activation_key.sql; authority.ts:27-29]
5. Create is additionally exactly-once per activation, through `workflow_instance (created_by_step_instance_id, created_by_step_started_at)` and its unique partial index (migration 0039). A retried create returns the first child as it stands; a retried Create-and-Start does not re-apply `start`. [src: remote-control/operations.ts:54-97; drizzle/0039_distributed_workflow.sql]
6. Response: `201 {"data":{"instance_id":"<uuid>"}}`.

**Table `broker_action_instance`** (0040 + 0043) [src: drizzle/0040_broker_action_instance.sql; 0043]:

| column | type | notes |
|---|---|---|
| id | uuid PK default gen_random_uuid() | the `instance_id` |
| action_key | text NOT NULL | catalog key |
| workflow_instance_id | uuid NOT NULL | caller |
| step_instance_id | uuid NOT NULL | caller step |
| step_started_at | timestamptz (0043) | activation key |
| target_instance_id | uuid | the waited-on runtime, for `wait` |
| state | text NOT NULL default 'RUNNING' | CHECK in (`RUNNING`,`COMPLETED`,`ABORTED`) |
| outputs | jsonb NOT NULL default '[]' | `[{name,value}]` |
| created_at, updated_at | timestamptz default now() | |

### D.2.4 Other routes

| Route | Behavior | Source |
|---|---|---|
| `GET /trajectory/v1/instances/:id` | `200 {"data":{"state":"<bare string>","outputs":[...]}}`. Unknown or non-UUID id → `404 {"error":{"code":"INSTANCE_NOT_FOUND"}}` | app.ts:104-109 |
| `POST …/:id/command` | Unknown → 404 as above. Body not an object with a string `command` → `400 VALIDATION_ERROR` ("Request body must be a JSON object with a string \"command\""). Only `ABORT` from `RUNNING`, applied atomically (`UPDATE … WHERE state='RUNNING'`) → `200 {"data":{"accepted":true,"new_state":"ABORTED"}}` plus a `state_change`. Anything else → `409 {"error":{"code":"INVALID_STATE_TRANSITION","message":"Cannot <cmd> from <state>"}}`. If a wait settles the row between the read and the UPDATE, the answer is `409 "Cannot ABORT from <new state>"` (or `from a deleted instance` if the row vanished); the engine counts any 409 as delivered (D.1.5 R3). | app.ts:111-132; store.ts:49-54 |
| `DELETE …/:id` | `200 {"data":{"deleted":true}}` or `404 {"data":{"deleted":false}}` | app.ts:134-138 |
| `GET …/:id/events` | Unknown → 404 before streaming. Otherwise SSE. If the row is already terminal (`COMPLETED`/`ABORTED`), the broker immediately sends `event: state_change`, `id: <server-wide counter from 1>`, `data: {"instance_id","state","previous_state":"RUNNING","timestamp"}`. It sends a `: ping` comment every 30 s (default `pingMs`). No replay, no heartbeat event. | app.ts:140-166; events.ts:19-45 |

### D.2.5 Execution and results

- Every action except `wait` completes synchronously. Outputs are `Completion` = `[{"name":"Code","value":"<n>"}]` and `Error` = `[{"name":"Text","value":"<text>"}]`, both in Value-Property list form, followed by the action's data outputs. Refusals are **data, not HTTP errors**. [src: execute.ts:36-73; wire.ts:59-67]
- Completion codes: `OK 0, ERROR 1, NOT_FOUND 2, NOT_PERMITTED 3, WRONG_STATE 4, INVALID_INPUT 5`. [src: remote-control/codes.ts:16]
- Data outputs, and the blanks returned on refusal:
  - create/createStart: `RuntimeWorkflow` = `{ID, Label}` (blank `{ID:'',Label:''}`)
  - status/wait: `Runtime` = `{State}` (blank `Unknown`)
  - outputs: `Runtime` + `Outputs` = JSON array (blank `[]`)
  - commands: none

  [src: execute.ts:27-66]
- Unexpected errors → code 1, `Internal error: <message>`. [src: execute.ts:68-72]
- Input reading:
  - `readInput(params, param, entry)` matches the param by exact name, then case-insensitively. If its value is a `[{name,value}]` list, it returns the named entry's value (exact, then case-insensitive), else `''`. Otherwise it returns the raw string.
  - `RuntimeWorkflow.ID`, `WorkCenter.Name`, `Workflow.Name`.
  - `StartingParameters`: a single-entry list whose entry is named `value` unwraps; otherwise the raw text is passed through. Accepted forms are a `[{name,value}]` list (Description excluded), a JSON object, or `name=value; …` pairs.

  [src: wire.ts:17-56; remote-control/params.ts:16-60]
- Runtime references (`resolveRuntime`), on the `trim()`med text, in order:
  0. blank → code 5 `INVALID_INPUT`, `Runtime workflow ID is blank`
  1. a UUID (live row, else history row; matched lowercased) → else `NOT_FOUND` `Runtime workflow <id> not found`
  2. if the text contains `/`: the whole text as a label in the caller's work center
  3. split on the **last** `/` into work center (name or path) + label (no `/` → the caller's work center and the whole text)
  4. otherwise `NOT_FOUND` `Runtime workflow "<text>" not found`

  A label lookup prefers the live `workflow_instance`; else the `runtime_history` row with that label, latest `finished_at` first.

  [src: remote-control/resolve.ts:148-171]
- Authorization (ruling R7): same work center → allowed. Otherwise a `work_center_control_grant (source, target, scope ∈ {'own','any'})` must exist. `read` and `create` need any grant. `command` with scope `own` needs the target in the caller's creation lineage (walk `created_by_instance_id` — live row, else history row — from the target upward; the loop runs for `hop = 0 … MAX_LINEAGE_DEPTH`, i.e. up to **9** creator lookups, not 8). Refusals return code 3 with `Work center "<caller WC>" has no control grant for work center "<target WC>"` or `That runtime was not created by this runtime (the grant covers only its own runtimes)`. [src: authority.ts:72-102; 0039]
- Runaway guards: lineage depth `MAX_LINEAGE_DEPTH = 8`; `MAX_CREATED_PER_RUNTIME = 100` (live + history). [src: authority.ts:22-23, 104-123]
- Commands (`commandRuntime`) by target status, where `finished` = completed/stopped/aborted/errored [src: operations.ts:104-146]:
  - **start**: pending → requestStart; queued/running/pausing/paused/resuming → no-op OK; else WRONG_STATE.
  - **stop**: finished, stopping or stopping_cleanup → OK; pending → delete (`Stopped`); queued → requestAbort recorded as stop; running/paused/pausing → requestStop; else WRONG_STATE.
  - **abort**: finished, aborting or aborting_cleanup → OK; pending → delete (`Aborted`); else requestAbort.
  - **suspend**: running → requestPause; pausing/paused → OK; else WRONG_STATE.
  - **unsuspend**: paused → requestResume; running/resuming → OK; else WRONG_STATE.
  - A target found only in history: stop/abort → OK; others → WRONG_STATE.
  - The actor recorded is `{kind:'remote', label:'<WC>/<runtimeLabel>', instanceId}`.
- `Runtime.State` names: pending `Created`, queued `Starting`, running `Running`, pausing `Suspending`, paused `Suspended`, resuming `Unsuspending`, stopping/stopping_cleanup `Stopping`, aborting/aborting_cleanup `Aborting`, completed `Completed`, stopped `Stopped`, aborted `Aborted`, errored `Errored`, other `Unknown`. [src: codes.ts:27-37]
- Under loose matching (`action_matching` setting), create drops unknown starting parameters (`ignoreUnknownParams`); strict rejects them. [src: operations.ts:76-79]
- **wait**: if the target has already finished, the broker completes at once. Otherwise it inserts a `RUNNING` row with `target_instance_id`. `checkWaits` runs on every `LISTEN engine_wake` notification (reconnect 2 s), on a poll every `BROKER_POLL_MS`, and on reconnect. For each RUNNING wait [src: waits.ts:22-73; index.ts:33-80]:
  - caller step not `WAITING_ACTION`, or caller status `aborting` or finished (or caller missing) → `ABORTED`
  - caller `stopping` → `COMPLETED` with code 4, `The calling runtime is stopping`, `Runtime.State = Unknown`
  - target still live and not finished → keep waiting
  - otherwise `COMPLETED` code 0 with the target's final state name; a resolution error gives that error's code and `Unknown`
  - each transition publishes `state_change`
- **Retention**: hourly (`RETENTION_INTERVAL_MS = 3_600_000`, plus once at boot), in batches of 500. Rows are deleted where `runtime_history.finished_at < now − days`, or where no history exists, `updated_at < cutoff`, and no live `workflow_instance` remains. [src: retention.ts:18-39; index.ts:69-80]

### D.2.6 Engine-side handling of broker calls

The engine treats the broker exactly as any action server: binding, trust allowlist, Bearer token to the `MISSION_BROKER_URL` origin, invoke → SSE → poll → terminal. The broker's string `state` is accepted by `toSnapshot`. [src: client.ts:80-86, 245-254]

Wire interplay a re-implementation must preserve [src: MissionBroker/src/app.ts:29-42,86-101; loop.ts:443-474; authority.ts:45-74]:
- The broker reads only `workflow_instance_id`, `step_instance_id`, `step_oid`, `input_parameters` from the invoke body; `environment_oid` and `timeout_ms` are ignored. Every `input_parameters[].value` MUST be a string, or the whole invoke is `400 VALIDATION_ERROR`.
- The broker authenticates the call against the shared DB, so the engine MUST invoke only while the step row is `WAITING_ACTION` with a non-null `started_at` (the engine's invoke path declines unless the instance is running-like, D.1.8).
- The idempotency key uses the step's `started_at` AT INVOKE TIME. The engine overwrites `started_at` with `invokedAt` only when it records the result; a grace re-invoke after an unrecorded attempt therefore reuses the same activation key. Because the engine has already sent R4 DELETE for the unrecorded instance, the broker usually finds no row and executes again; only Create/Create-and-Start stay exactly-once (through `created_by_step_started_at`), the other actions can run twice.
- The broker's SSE `state_change.state` is a bare string, which the engine's SSE path requires (D.1.8).

---

## D.3 Script execution contract (SCRIPT and GATE)

A native engine MUST embed a JavaScript engine (for example QuickJS, Hermes, J2V8/V8 or Rhino in ES6+ mode) and reproduce the observable contract below. Everything not listed here (worker threads, `node:vm`) is the reference's mechanism, not part of the contract.

### D.3.1 Language level and sandbox

1. **Language.** JavaScript only. `script_config.language` and `gate_config.language` are never read, so any value (or none) runs as JavaScript. [src: spec/types.ts:228-233; no reader of `.language` in MissionEngine/src]
2. **Language level (reference).** The reference image is `node:22-alpine` (V8 12.4), so scripts get ECMAScript 2024 syntax and built-ins. A script body is compiled with the sandbox realm's `Function` constructor, so it is a **sloppy-mode (non-strict) function body** unless the source itself begins with a `'use strict'` directive. It is never a module and never `async`: `await` is not available (`await x` is a SyntaxError, a bare `await` a ReferenceError), and `import`/`export` are SyntaxErrors. A conforming engine MUST accept at least ES2020 syntax (`let`/`const`, arrow functions, classes, template literals, destructuring, spread, `?.`, `??`) and SHOULD accept ES2024. [src: MissionEngine/Dockerfile:49,98; step-handlers.ts:313-318, 343-352]
3. **Globals available.** A fresh, empty realm per run with only the ECMAScript standard built-ins: `Object, Function, Array, Number, String, Boolean, Symbol, BigInt, Math, JSON, Date, RegExp, Map, Set, WeakMap, WeakSet, WeakRef, FinalizationRegistry, Promise, Proxy, Reflect, Error` and its subclasses, `ArrayBuffer, SharedArrayBuffer, DataView`, the typed arrays, `Atomics, Intl, WebAssembly, globalThis, eval, parseInt, parseFloat, isNaN, isFinite, encodeURI(Component), decodeURI(Component), escape, unescape, NaN, Infinity, undefined`. V8 also installs a `console` object whose methods exist but **produce no output** (nothing reaches the engine log). `this` inside the script is the realm's global object (sloppy mode). [verified with a probe of `vm.runInNewContext` on Node 24; Node 22 has the same set minus the newest ES2025 additions]
   - The data globals `__names`, `__argv`, `__outKeys`, `__src` and (repeating only) `__stateIn` are also visible and writable. The wrapper reads them before the author's code runs, so overwriting them has no effect. A conforming engine need not expose them.
4. **Globals NOT available (contract: MUST be absent or inert).** No `require`, `import()`, `process`, `Buffer`, `setTimeout`/`setInterval`/`setImmediate`, `queueMicrotask`, `structuredClone`, `fetch`, `XMLHttpRequest`, `URL`, `TextEncoder`/`TextDecoder`, `atob`/`btoa`, file system, network, database, or any engine object (property store, step, instance). A script can affect the engine only through its declared results (D.3.2-D.3.4). The worker that hosts the realm also gets an **empty environment** (`env: {}`), so not even the engine's environment variables are reachable. [src: script-pool.ts:40-49, 142-149; step-handlers.ts:290-300]
5. **Isolation between runs.** Every run gets a new realm, so nothing a script stores in globals survives to the next run (the repeating `state` is the only carry-over, D.3.3). The reference reuses a worker thread across successful runs but never a realm. [src: script-pool.ts:75-86, 170-183]
6. **Time and locale.** `Date` reads the engine host's clock directly (not the engine's injectable `deps.now()`). Local-time methods (`getHours`, `toString`, ...) use the engine process's time zone; the reference image sets no `TZ` and ships no tzdata, so it is **UTC**. `Intl`/`toLocaleString` use the process default locale (`en-US` with no `LANG`). A native engine MUST use UTC and `en-US` to match. [src: MissionEngine/Dockerfile:98-111]
7. **Number and string semantics.** All inputs are strings (D.3.2). Arithmetic on them follows JavaScript: `'2' + 1 === '21'`, `'2' * 1 === 2`, `Number('') === 0`, `Number('abc')` is `NaN`, `parseInt('08') === 8`. Results are converted with JavaScript `String(v)` (D.3.2), so number formatting is JavaScript's shortest round-trip form: `0.1 + 0.2` → `"0.30000000000000004"`, `1e21` → `"1e+21"`, `-0` → `"0"`, `NaN` → `"NaN"`. An embedded engine provides these semantics natively; a non-JavaScript re-implementation would have to reproduce them exactly.

### D.3.2 Limits, timeouts and error mapping

1. **Timeout.** `SCRIPT_TIMEOUT_MS` (default 5000, D.7) per run, measured from the start of evaluation. It covers the script body, the conversion of its results (`String(v)`, `JSON.stringify` of `state`, which can run author getters/`toString`) and every promise callback (`microtaskMode: 'afterEvaluate'`: the microtask queue is drained inside the same timed call). Time a run spends queued behind other runs (pool full) is **not** counted. [src: script-pool.ts:114-140; step-handlers.ts:290-300]
2. **Pool.** One worker slot per `ENGINE_WORKER_CONCURRENCY` (`Math.max(1, floor(n))`), FIFO job queue. The engine thread awaits the result. [src: script-pool.ts:102-140; index.ts:46-47]
3. **Memory.** Each worker's V8 old-generation heap is capped at **256 MB**. Exceeding it fails the run. Stack overflow (deep recursion) is an ordinary in-script `RangeError` (see 5). [src: script-pool.ts:36-38, 143-149]
4. **Size caps.** Repeating SCRIPT only: `state` JSON and the run's `output` JSON are each capped at 65 536 UTF-8 bytes (D.3.4). One-shot SCRIPT outputs and GATE have no size cap beyond the heap.
5. **Error mapping.** Every failure becomes a single **string** (the step's failure message). Exact texts:

   | Cause | Message |
   |---|---|
   | The script (or its compilation) throws value `e` | `String(e)` evaluated **inside** the sandbox. An `Error` gives `<name>: <message>`, e.g. `Error: boom`, `TypeError: Cannot read properties of null (reading 'x')`, `SyntaxError: Unexpected token '}'`. A thrown string gives the string itself, `throw 42` gives `42`, `throw undefined` gives `undefined`, and an object gives its own `toString()` result (default `[object Object]`). |
   | `String(e)` itself throws | `Script failed (its error could not be read)` |
   | Run exceeds the timeout (the vm's own timer) | `Error: Script execution timed out after <timeoutMs>ms` |
   | No answer within `timeoutMs + 2000` ms (backstop; worker is replaced) | `Error: Script execution timed out after <timeoutMs>ms` (same text) |
   | Heap exhausted (`ERR_WORKER_OUT_OF_MEMORY`) | `Script ran out of memory` |
   | Worker crashed or exited | `Script stopped unexpectedly` |
   | Engine shutting down while queued or running | `Script engine shut down` |
   | The wrapper's result is not a well-formed envelope | `Script result is not readable` |
   | Repeating: `state` not JSON-serializable (cycle, BigInt) | `Script state is not JSON` |
   | Repeating: `state` JSON > 65 536 bytes | `Script state exceeds 64 KB` |
   | Repeating: `output` JSON > 65 536 bytes | `Script outputs exceed 64 KB` |

   The text of engine-generated JavaScript errors (`TypeError` messages, `SyntaxError` positions) is **V8's wording** and is implementation-defined; a native engine using another JavaScript engine will produce different text there. Everything else in the table is exact. [src: script-pool.ts:33-35, 65-73, 121-165; step-handlers.ts:204-212, 247-248, 324-327, 349, 365-369, 394, 528-535; test/script-pool.test.ts:36 asserts the `Error: ` prefix on the vm timeout]
6. **Where it runs.** A one-shot SCRIPT, a GATE evaluated at activation (no bindings) and a repeating SCRIPT's first run happen **inside** the instance's claim transaction; later GATE/repeating runs inside the due-work claim. The engine holds the instance lock (and a database connection) for up to the timeout plus 2 s. [src: transition.ts:2232-2257, 2272-2282, 2491-2500; gate.ts:98-105; repeating-script.ts:83-85]
7. **Unhandled rejections.** A rejected promise a script leaves behind is dropped with the log line `[script] a script left a rejected promise unhandled; ignored` and never fails the step or the engine. Promise callbacks run after the script body returns, so anything they write to `output` or `state` is **lost** (the result was already serialized); asynchronous work is therefore useless in a script. [src: script-pool.ts:47-49; step-handlers.ts:226-245; probe: `Promise.resolve().then(() => { output.k = 1 })` yields no `k`]

### D.3.3 One-shot SCRIPT API

The engine compiles `Function(...inputIds, 'output', source)` and calls it with `(...inputValues, outputObject)`. [src: step-handlers.ts:331-352]

- **Inputs**: each key of the step's input snapshot (`stepSnapshots[stepOid].inputParameters`, taken at activation) is a parameter holding a **string** (never a number, boolean, null or object; JSON-looking values arrive as their text and must be `JSON.parse`d). The snapshot is the declared inputs plus starting parameters (D.1.5), plus any Action-Property overlay. Parameter order is the snapshot's key order. [src: transition.ts:2493-2494; step-handlers.ts:331-336]
  - A key that is not a valid JavaScript identifier (contains a space, starts with a digit, is a reserved word like `class`) makes compilation fail: the step fails with a `SyntaxError: ...` message (Open point 6).
  - An input id `output` is shadowed by the output object (duplicate parameters are legal in sloppy mode; the last one wins). [probe]
- **Outputs**: the script assigns `output.<key> = value`. After the body returns (inside the sandbox, under the timeout):
  - With non-empty `output_parameter_specifications`: only the spec ids are read, and only when they are **own** properties of `output`. Each value becomes `null` if it is `undefined`, else `String(value)`: `null` → `"null"`, `true` → `"true"`, `[1,[2,3]]` → `"1,2,3"`, `{}` → `"[object Object]"` (use `JSON.stringify` for structured data). Then, in spec order, each spec whose id is an own key **and** that has a `target` gets `props.set(target, value ?? '')`, so an explicitly `undefined` output writes `''`; a key the script never set writes nothing.
  - Without specs: every own enumerable key (`Object.keys` order: integer-like keys ascending, then insertion order) is read the same way, and every non-null value is `props.set(key, value)` with the key as a (possibly dotted) property key. An `undefined` value is skipped.

  [src: step-handlers.ts:319-322, 419-435]
- The return value is ignored. [src: step-handlers.ts:343-352]
- No `script_config.source` (absent or `''`) → success, no-op. [src: step-handlers.ts:271-274]
- Failure → `failStep(mode 'ERROR', message)`, which a TRY can catch. Nothing is written to the property store on failure. [src: transition.ts:2494-2498; step-handlers.ts:276-282]
- After success, `snapshotScriptOutputs` records `stepSnapshots[stepOid].outputParameters[spec.id] = props.get(spec.target)` for each spec with a target whose value is defined. [src: transition.ts:2211-2221]

### D.3.4 Repeating SCRIPT (`script_config.repeat`)

| Field | Engine rule | Source |
|---|---|---|
| `repeat` | Present and a non-null, non-array object → repeating | step-handlers.ts:446-449 |
| `cycle_seconds` | a JSON number ≥ 1 (fractions allowed), else `SCRIPT_DEFAULT_CYCLE_SECONDS = 5`; no upper bound | :439, 451-454 |
| `time_limit_seconds` | any JSON number: deadline = `started_at + limit·1000` (0 or negative → already expired at the first due run); absent or non-number = no limit | :456-466 |
| `on_time_limit` | exactly `'complete'`, otherwise `'error'` | :475-477 |

- API: `Function(...inputIds, 'output', 'state', body)`, where body = `const __result = (function(){\n<source>\n})();\nreturn [__result === true, state];`. The author's source runs in an inner function, so its own `return` sets `__result`. The step is **done iff the script returns exactly `true`** (`1`, `'true'` and other truthy values are not done). [src: step-handlers.ts:357-379]
- `state`: starts as `{}`. The script may mutate it or reassign it (`state = {...}`), and the value after the run is serialized with `JSON.stringify` inside the sandbox. It may be any JSON value, not only an object (`state = 5` persists `5`). If serialization yields `undefined` (`state = undefined`, a function), the next run starts again from `{}`. Cycles/BigInt fail the step (`Script state is not JSON`). Above 65 536 UTF-8 bytes → `Script state exceeds 64 KB`. JSON round-tripping drops `undefined` members, functions, and turns `Date` into its ISO string and `NaN`/`Infinity` into `null`. [src: step-handlers.ts:359, 366-370, 503-542]
- `output` is a fresh `{}` each run, converted exactly as in D.3.3. Its JSON must be ≤ 65 536 bytes (`Script outputs exceed 64 KB`). The converted outputs of the latest not-done run are kept as `pendingOutputs`, **replacing** the previous run's (they are not merged). [src: step-handlers.ts:531-535; repeating-script.ts:87]
- No source → done at once with no outputs. [src: step-handlers.ts:509-513]
- Activation: the first run happens inline in the activation transaction, with the activation snapshot as inputs.
  - done → commit that run's outputs (D.3.3 rules), snapshot them, complete
  - error → failStep ERROR
  - otherwise save `engine_state.scriptRuns[stepOid] = {state, pendingOutputs}`, trace `EXECUTING`, `state = WAITING_SCRIPT`, `started_at = now`, `wake_at = min(now + cycle, deadline)`, and NOTIFY the work center

  [src: transition.ts:2232-2257]
- Each due run: claimed by the gate unit, status running-like only. [src: gate.ts:243-318; repeating-script.ts:67-94]
  1. If expired (`now >= deadline`): `complete` → `WARNING` trace `Script time limit (<duration>) reached — completed with its current outputs` and commit the **pending** outputs of the last run; `error` → fail with `Script time limit (<duration>) reached`. Durations are formatted from whole seconds as every non-zero unit, largest first, from `wk` (604 800 s), `d`, `h`, `min`, `s`, e.g. `2 h 10 min 20 s`; zero → `0 s`. The script does not run.
  2. Otherwise re-resolve the inputs from the **live** property store (`resolveInputParameters` + `getInputParameters`), overlaid with the fetched Action-Property values when the step has bindings, and store them as the step's new input snapshot. Run with the saved state. Done → commit that run's outputs and complete. Error → failStep ERROR. Otherwise save state and outputs and set `wake_at = min(now + cycle, deadline)`.
- While paused or stopping a repeating script does not run. Stop cancels a `WAITING_SCRIPT` row. Resume re-arms it `wake_at = now`. [src: control.ts:441-444, 550]

### D.3.5 GATE script

`Function(...inputIds, source)` with the input values; there is **no** `output` parameter (an input named `output` is an ordinary input). The return value is converted inside the sandbox with JavaScript truthiness (`v ? true : false`): `false`, `0`, `-0`, `NaN`, `''`, `null` and `undefined` keep the gate closed; everything else, including `'false'`, `'0'`, `[]` and `{}`, opens it. No source → open. A failure fails the step with mode `ERROR`. Inputs: the activation snapshot at activation; at every later evaluation, re-resolved from the live store plus the bindings overlay (as D.3.4 step 2). A `timer`-mode gate never runs its script. [src: step-handlers.ts:381-390, 587-591, 622-636; gate.ts:98-111; transition.ts:2272-2282]

---

## D.4 Resources

### D.4.1 Model

- Types (exact strings): `binary exclusive use`, `binary shared use with pool limits` (`use_limit`, default 1), `countable use with pool limits` (`use_limit`, default 1), `named pool` (`names[]`), `sync`. An unknown type throws `Unknown resource type: "<t>"` at registration. [src: core/resources.ts:233-257]
- Commands: activation = `Acquire`, `Acquire Pool Amount`, `Send`, `Receive`, `Synchronize`; **every other** `command_type` goes to the completion list, where only `Release` and `Release Pool Amount` act and anything else is silently ignored. [src: resources.ts:656-675; transition.ts:333-334, 413-416]
- Ordering: activation commands are sorted with sync commands (`Send`/`Receive`/`Synchronize`) first, then by `a.resource_name.localeCompare(b.resource_name)`; completion commands are sorted by `resource_name.localeCompare` alone. The sort is stable (equal names keep document order). `localeCompare` is **ICU collation for the process default locale (`en-US`)**, not code-point order: case and accents are secondary/tertiary differences, so `_x < 10 < 9 < a < A < b < B < e < é < f < Z`. A native engine MUST use an equivalent collator (for example `java.text.Collator.getInstance(Locale.US)` / ICU `Collator` for `en-US`, tertiary strength) to get the same acquisition order. [src: resources.ts:677-686; transition.ts:414; probe on Node 24]
- Per command [src: transition.ts:303-332, 444-447]:
  - `Acquire` passes the literal `cmd.amount` (so on a countable pool it takes `amount ?? 1` units; on the binary types one unit; on a named pool one name).
  - `Acquire Pool Amount` passes the frozen/literal count (D.4.2); on a non-countable type the amount is ignored and it behaves like `Acquire`.
  - `Send` data = `props.resolveKey(cmd.source)` when `source` is set, else `''`.
  - `Release` / `Release Pool Amount` pass `amount` (`cmd.amount`, or the property count) and, for a named pool, `name = props.get(cmd.target)` (no target, or an unset target → `undefined` → the release does nothing).
  - Calling a type-specific operation on the wrong type (`Send` on a binary resource, for example) throws `send() not supported for "<type>"`, and an unregistered key throws `Resource "<key>" is not registered`; both are engine errors, not step failures.
- The manager tracks **counts, not holders**. Fairness is **strict FIFO**: an acquire is granted at once only if capacity allows **and the queue is empty**. A countable head that is too large blocks everything behind it (no skipping). Named pools hand out names `available.shift()` in order and reserve the name at grant time (`pendingNamedAssignments`). [src: resources.ts:35-45, 283-424]
- `release` [src: resources.ts:311-424]:
  - binary exclusive: `inUse = 0`, grants the head. Returns false if not in use.
  - binary shared: `inUse--`, grants while capacity allows. Returns false at 0.
  - countable: `inUse = max(0, inUse − amount)`, grants FIFO.
  - named: only original names that are not currently available (a double release is ignored), then grants. Returns false for no name, a foreign name, or a double release.
  - sync: release is a no-op (returns false).
- Grants made by a release are queued as `pendingGrants` (step token + key) and drive `resumeGrantedSteps`; a cancelled waiter (`cancelQueuedWaiters`) also loses its pending grant, and a name already reserved for it goes back to `available`. [src: resources.ts:482-530]
- Sync:
  - `Send` matches the head receiver (the sender proceeds at once, and grants are recorded for both sender and receiver; the data is stored for the receiver) or queues the sender with its data.
  - `Receive` matches the head sender (the receiver gets the data at once; the sender is granted) or queues.
  - `Synchronize` appends the caller; as soon as two are waiting, the first two are paired and both granted (the caller proceeds at once if it was the second).
  - Sync has no capacity and no FIFO "queue empty" rule: matching happens only at enqueue time.
  - Received data is written by `setSyncTarget(cmd.target, data)`. `Send` data = `props.resolveKey(cmd.source)` or `''`.

  [src: resources.ts:426-470; transition.ts:319-328]
- **Execution point**: a step's activation commands run when it is materialized, before activation. If blocked, the row stays `READY` with a `WAITING` trace, and `blockedOnResources[stepOid] = {blockedOn, remainingCommands, completionCommands}` records where to resume. A release-driven grant resumes the remaining commands in order (no double acquire). Completion commands run inline when the step completes. [src: transition.ts:286-357, 975-993, 605-660]
- `Acquire` with a named pool and `cmd.target` → `props.set(target, name)`. [src: transition.ts:305-309]

### D.4.2 Counts from a property (`amount_property`)

- Only on `Acquire Pool Amount` and `Release Pool Amount`. A non-blank `amount_property` wins over `amount`. [src: transition.ts:92-98]
- Count parse: `/^\d+$/` after trim, a safe integer, ≥ 1. Else invalid. [src: transition.ts:105-110]
- Acquire: every property-sourced count is resolved and checked **before any command is attempted**, at the step's fresh attempt, and frozen in `engine_state.resolvedAmounts[stepOid][cmd.oid ?? '<type>|<source_oid>|<name>|<amount_property>']` while the step waits. An invalid count fails the step `ERROR` with `Acquire of "<name>" could not use "<raw>" from <key> as a count: it must be a whole number of at least 1`. The step holds and queues nothing (`nothingHeld`). [src: transition.ts:101-127, 368-394, 975-982]
- Release: the count is read when the release runs and released in full (the pool floors at 0). An invalid count releases nothing for that command and records an **instance-level** `ERRORED` trace row (step oid NULL, so it cannot end a re-run of the step) with the detail `Step "<step local_id ?? oid>": Release of "<name>" could not use "<raw>" from <key> as a count: it must be a whole number of at least 1 — nothing was released`, plus a `console.warn`; the step is not failed. [src: transition.ts:396-435, 555-565]
- `resolveKey` returns the property's string value (`''` when unset). `parseCount` accepts only ASCII decimal digits after trimming (no sign, no decimal point, no exponent: `"3"`, `" 3 "`, `"007"` → valid; `"3.0"`, `"+3"`, `"1e3"`, `"0"` → invalid) and a value ≤ 2^53 − 1. [src: transition.ts:106-112]
- A literal `amount` that is undefined counts as 1.

### D.4.3 Scoping: workflow tier vs environment tier

- **Tier rule** (`isEnvironmentCommand`), checked in order [src: core/env-scope.ts:50-91]:
  1. `(cmd.resource_source_oid ?? owningSpec.oid)` is the oid of any `environment_specifications[]` in the recipe (root or nested children, at any depth) → environment.
  2. Else `resource_source_type === 'environment'` **and** the name is declared by one of those env specs → environment.
  3. Else workflow.
- **Workflow tier**: a per-instance `InMemoryResourceManager`, key `${resource_source_oid ?? spec.oid}:${resource_name}`, token = the step oid. It is serialized into `workflow_instance` state and dies with the instance. [src: transition.ts:80-82, 150-164]
- **Environment tier**: shared per **(work center, name)** through the DB registry. [src: mission-control-db/src/runtime/wc-resources.ts]
  - `wc_resource` holds `work_center_id, name, resource_type, use_limit, pool_names[], available_names[], in_use`.
  - `wc_resource_waiter` holds `id` (identity = FIFO order), `name, instance_id, step_oid, kind, amount, payload, granted, granted_name, granted_payload`.
  - `wc_resource_holder` holds `id, work_center_id, name, instance_id, step_oid, amount, held_name, acquired_at`.
  - The queue token is `"<instanceId>::<stepOid>"` and is split at the first `::`. [src: core/env-resource-bridge.ts:31-45]
  - **Lock order**: lock the instance row, then `SELECT … FOR UPDATE` the `wc_resource` rows for exactly the names the recipe references, ordered by **name ascending** (database collation). Waiters are read without row locks, ordered by `id`. [src: wc-resources.ts:54-97]
    - Observable contract (platform-neutral): every writer of one work center's registry takes the instance lock first and then the resource-row locks in **one fixed global order**, and holds them until its transaction commits, so two transitions acquiring the same resources in opposite command order cannot deadlock. A waiter's FIFO position is a monotonically increasing id assigned at insert (an identity column in the reference). Any single-writer or ordered-lock scheme that gives the same serialization is conforming.
  - Each transition hydrates a manager from the snapshot (granted waiters become pending grants). After the transition, `diffRegistry` writes the results back: queued tokens keep their row (and FIFO position), new tokens are inserted at the tail, own grants are consumed (row deleted), foreign grants are flagged `granted=true` (a handoff), and the holder set is replaced per instance. [src: env-resource-bridge.ts:57-311; wc-resources.ts:111-152]
  - A grant to another instance sends `pg_notify('wc_resource_grant', <instanceId>)`. Every engine LISTENs on that channel and wakes its loop. [src: wc-resources.ts:21-25; context.ts:678; index.ts:122-127]
  - A command routed to the environment tier whose name was never hydrated for the work center throws `step "<oid>": environment resource "<name>" is not hydrated for work center "<wc>" — the work center's environment specification likely needs to be re-loaded`. [src: transition.ts:150-160]
  - Each granted environment Acquire appends `{name, stepOid, amount (pool amount or 1), heldName}` to `engine_state.envHolds`. [src: transition.ts:345-352]
  - **Environment-tier Release** (one command, after an inherited-hold check, below). Let `amount = count ?? 1` and `name` = the named-pool name from `cmd.target`. Matching uses `envHolds` (live ledger) and `envHoldsRevoked` (markers for holds an operator or another workflow took away, computed when the context is opened by diffing the persisted ledger against `wc_resource_holder`). "Exact" = same name **and** this step (and `heldName === name` when a name is given); "any" = same name on any step of this instance. The FIRST rule that matches wins [src: transition.ts:485-549]:
    1. exact ledger entry → real `release` through the manager; if `amount` exceeds the entry's own amount, the excess is first absorbed from a revoked marker (exact, else any) and not released again; the entry is decremented (removed at ≤ 0) only if the manager reported a release.
    2. exact revoked marker → no release; the marker is decremented by `amount`; log `Release "<name>" skipped — its hold was released by an operator or another workflow`.
    3. any revoked marker → same as 2.
    4. any ledger entry (Release on a later step than its Acquire) → as 1.
    5. none → unconditional `release` through the manager (cross-workflow release); if it freed something, `{name, amount, heldName}` is queued and, at write-back, the units are taken over from other instances' holder rows (D.4.4 item 3).
  - **Inherited holds (Operator cleanup, spec 2026-11-06 U6).** While an Operator Stop/Abort cleanup network runs (`operatorCleanup.phase === 'cleanup'`), an `Acquire`/`Acquire Pool Amount` on a resource the instance already held when cleanup began (`operatorCleanup.inheritedHolds`; environment keys are `env:<name>`, workflow keys `<ownerOid>:<name>`) is granted at once **without** asking the manager and recorded in `inheritedUse[stepOid]` (a named Acquire leaves its target property unchanged; no new ledger entry). A later Release of that key consumes one `inheritedUse` entry (this step's first, else another cleanup step's) and releases nothing; a Release with no inherited use really releases and removes the key from `inheritedHolds`. [src: operator-cleanup.ts:84-131; transition.ts:294-300, 436-443]

### D.4.4 Holds outlive the workflow (environment tier)

1. At **any** terminal (completed, errored, stopped, aborted, give-up, escalation), the engine MUST NOT release environment **holds**. The `wc_resource_holder` rows and the `in_use`/available names stay. [src: context.ts:1075-1081; wc-resources.ts:154-165]
2. It MUST drop the instance's queue entries (`DELETE wc_resource_waiter WHERE instance_id=…`), cancel its manager tokens, give back each grant it was handed but never consumed (one `release()` each, which cascades FIFO), and re-run the grant pass on every other name a waiter was removed from. [src: context.ts:1083-1150]
3. **Cross-workflow release**: a Release by an instance that holds none of the resource takes the hold over from other instances' holder rows (`consumeForeignHolders`), with the counter already changed by the manager [src: wc-resources.ts:184-236; transition.ts:547-548; context.ts:1041-1071]:
   - binary exclusive: all rows
   - binary shared: 1 unit, oldest first
   - countable: `amount` units, oldest first (rows are decremented, and deleted at 0)
   - named: the oldest row with the held name

   The former holders get `pg_notify('wc_resource_grant', id)`. Their own later Release of a taken hold is skipped (the revoked-hold markers) with the log `Release "<name>" skipped — its hold was released by an operator or another workflow`. [src: transition.ts:191-196]
4. The retention sweep does not delete a finished instance that still owns a `wc_resource_holder` row. [src: core/sweep.ts:27-28, 86]
5. Workflow tier: a TRY with `release_on_catch !== false` (absent = true) runs the failing step's completion Release commands before the catch network starts. [src: transition.ts:2070-2088]

### D.4.5 Operator registry verbs

`POST /internal/work-centers/:wcId/resources/<verb>` and `POST /internal/instances/:id/resources/<verb>` (`X-Internal-Token`). Verbs: `release-holder` (`holderId`), `release` (untracked units; `amount`, or `poolName` for a named pool), `reset`, `cancel-waiter` (`waiterId`), `clear-sync`. [src: core/registry-verbs.ts:33-56, 143-236; api/internal.ts:235-286]

- Body: the work-center route needs `name`; the instance route needs `resourceKey` (the manager key). Both need `actorUserId` (UUID). Missing → `400 VALIDATION` `name and actorUserId (uuid) are required` / `resourceKey and actorUserId (uuid) are required`. `holderId`, `waiterId`, `amount` must be positive JSON integers when present, else 400. On the instance route `waiterId` may also be a string (a workflow-tier waiter's step oid). A non-UUID `:wcId` → `404 WORK_CENTER_NOT_FOUND`; a non-UUID `:id` → `404 RUNTIME_NOT_FOUND`.
- Success: `200 {"ok":true,"summary":"<text>","affectedInstanceIds":[...]}`. Error: `{"error":{"code","message"}}` with `VALIDATION` → 400, `NOT_FORCEABLE` → 403, any `*_NOT_FOUND` → 404, everything else (`NOTHING_TO_RELEASE`, `NOT_A_SYNC_RESOURCE`, `NOT_SUPPORTED`, `INSTANCE_BUSY`, ...) → 409.
- Semantics (work-center registry; the manager is hydrated from the locked snapshot and written back with the operator id `OPERATOR_INSTANCE_ID = 00000000-0000-0000-0000-000000000000`, so every grant it causes is a handoff to another instance):
  - `release-holder`: release that holder row's units (named pool: its held name; no held name → `NOTHING_TO_RELEASE`) and delete the row. If the counter was already free the row is still deleted (summary says "ledger mismatch").
  - `release`: only **untracked** capacity = `in_use` minus (holder amounts + granted-but-unconsumed waiter amounts) for counted types, or held names that no holder row or granted waiter explains for a named pool (`poolName` required and must be one of them). Binary types release exactly 1; asking for more than is untracked → `NOTHING_TO_RELEASE`. Sync → `NOT_SUPPORTED`.
  - `reset`: drop unconsumed grants (returning reserved names), restore `in_use = 0` / all names available, re-run the grant pass, delete every holder row; the queue is preserved. A sync resource is cleared instead; an unknown type → `NOT_SUPPORTED`.
  - `cancel-waiter`: remove that waiter; if it was already granted, give its units back (counted types) and re-run the grant pass.
  - `clear-sync`: sync only (else `NOT_A_SYNC_RESOURCE`): empty send/receive/synchronize queues and drop granted sync waiters.
  - Affected instances get a per-step trace line (e.g. `reset "<name>" — hold dropped by an operator`) and are woken.

---

## D.5 Assignments (offers, claims)

### D.5.1 Data

`instance_assignment` [src: mission-control-db/src/db/schema/execution.ts:35-37, 146-170]:
- Columns: `id, step_instance_id (FK cascade), work_center_id, resolved_role_id, assigned_user_id, preferred_user_id, released_from_user_id, allowed_role_ids jsonb (snapshot), status, dispatch_policy, dispatch_reason, assigned_at, claimed_at, completed_at`.
- `status ∈ {offered, claimed, completed, cancelled}`. Live = `{offered, claimed}`.
- **At most one live assignment per step** (unique partial index `instance_assignment_step_live_uq`).

### D.5.2 Reconcile (offer lifecycle)

`reconcileAssignments(instanceId)` MUST run at the tail of **every** engine transaction that claims an instance row. If anything changed, the engine runs `pg_notify('operator_change', <work_center_id>)` (the notification fires on commit). [src: core/reconcile.ts:20-30; assignments.ts:233-379]
1. Close every live assignment whose step is neither `WAITING_USER` nor `PAUSED`: `completed` if the step is COMPLETED, else `cancelled`; set `completed_at`. A PAUSED step keeps its assignment.
2. For each `WAITING_USER` step with no live assignment, create an offer:
   - `allowed` = live allowed roles: find the step's recipe node in the **frozen recipe** (`spec_jsonb`, depth-first through `children`), take its `master_oid` and then each ancestor's (nearest first; an ancestor without a string `master_oid` is skipped; if the node itself has none the chain is empty → unrestricted). For each master oid in order, read `workflow_allowed_role` rows joined to the **live** `workflow_node` with that `node_oid` in the same `workflow_id`; the first oid with any rows wins. `[]` means unrestricted. The result is stored as the offer's `allowed_role_ids` snapshot. [assignments.ts:40-82]
   - If auto-claim is on (`workflow.auto_claim` true/false, else `work_center.auto_claim`, else false) [dispatch.ts:35-40]:
     - **Chain**: the most recent claimant (`claimed_at` DESC, non-null `assigned_user_id` and `claimed_at`) in the same `(instance, nodeOid)` scope, counting a `completed` assignment whose step is still COMPLETED or a `claimed` one whose step is WAITING_USER/PAUSED (`cancelled` and released rows never count). If that user is a WC member **and** has an `online` presence row attending this WC **and** holds one of the allowed roles in this WC (or the scope is unrestricted) → insert `claimed` with `assigned_user_id = preferred_user_id = chain user`, `resolved_role_id` = the first matching role (null when unrestricted), `dispatch_policy 'auto_claim'`, `dispatch_reason 'auto_claim_chain'`, `assigned_at = claimed_at = now`. The chain user is computed once per scope per reconcile, so a parallel fan-out in one scope all goes to the same user. [assignments.ts:84-149, 246-281]
     - **Sole candidate**: else, if exactly one distinct online eligible user exists (`listOnlineCandidates`: members with an `online` presence row attending this WC and, when restricted, a role in `allowed` held in this WC) → insert `claimed` with that user as assigned and preferred, reason `auto_claim_sole_candidate`. [assignments.ts:151-175, 283-299; dispatch.ts:52-84]
   - Else insert `offered` with a suggestion (`computeSuggestion`) [dispatch.ts:22-125]:
     - The policy is `workflow.dispatch_policy ?? work_center.dispatch_policy ?? 'least_queued_steps'`.
     - Unrestricted → no preference, reason `unrestricted: pull-based claim`.
     - No online candidate → `no candidate`.
     - `manual` → `manual: pull-based claim`.
     - `highest_priority` → max `work_center_user.priority`; reason `highest_priority: <priority>`.
     - Otherwise (`least_queued_steps`, `round_robin`, `fewest_active_instances`, or any other string) → the candidate with the fewest `claimed` assignments **across all work centers** (the count is not filtered by work center); reason `least_queued_steps: <n>`.
     - Ties (equal priority or equal count) go to the candidate the database returned first; the order is not specified (stable sort over an unordered query), so a conforming engine may break ties any way.
     - The offer stores `dispatch_policy = <effective policy>`, `preferred_user_id` = the suggestion (or null), `assigned_at = now`. A workflow `dispatch_policy` that is empty counts as unset.
3. Third pass: an existing `offered` on a WAITING_USER step becomes a sole-candidate claim when auto-claim is on, exactly one candidate exists, and that candidate is not `released_from_user_id`. The UPDATE is guarded `status='offered'`.

**Sole-candidate sweep** (`sweepSoleCandidateClaims`), work-center-wide and outside instance locks, runs after presence changes (POST/DELETE presence, heartbeat away↔back), releases, force-release and logout. [src: assignments.ts:381-398; api/app.ts:109-114, 324-379]

### D.5.3 Operator and Commander verbs

| Verb | Route | Rule | Errors | Source |
|---|---|---|---|---|
| Claim | `POST /api/assignments/:id/claim` | Caller must be a WC member. Live role re-check: if `allowed` is non-empty, the caller must hold one of the roles in this WC (`resolved_role_id` = the first match). `UPDATE … WHERE status='offered'` → `claimed`, `assigned_user_id`, `claimed_at`, clear `released_from_user_id`. PAUSED offers are claimable by id. | 404 `not found`; 403 `not a member of this work center` / `no matching role`; 409 `already claimed` | api/app.ts:406-444 |
| Release | `POST /api/assignments/:id/release` | Claimant only (no membership re-check). → `offered`; clears assigned, claimed_at, role, preferred, dispatch fields; `released_from_user_id = old assigned_user_id`. Then the sweep. | 409 `not your claim` | app.ts:446-476 |
| Logout / sign-out | `POST /api/logout`, `POST /api/auth/sign-out` | Release all of the user's claims (same SET), delete the session's presence, sweep every affected WC | — | app.ts:71-101, 126-130, 382-385 |
| Force-release | `POST /internal/assignments/:id/force-release` (`X-Internal-Token`) | `claimed` → `offered` (same SET), then the sweep | 404 `ASSIGNMENT_NOT_FOUND`; 409 `RUNTIME_INVALID_STATE` "assignment is not claimed" | internal.ts:138-169 |
| Assign | `POST /internal/assignments/:id/assign` `{userId}` | Only an **offer**. Target user must be a WC member and hold an allowed role; presence is not required. → `claimed`, `dispatch_reason 'commander_assign'` | 400 `VALIDATION`; 404; 409 `USER_NOT_ELIGIBLE`, `ASSIGNMENT_NOT_OFFERED` | internal.ts:171-232 |
| Back re-claim | after `goBack` | `claimStepForUser`: the reopened step's offer goes to the pressing user if they are a member and role-eligible (presence not required); reason `went_back`. A failure is logged and the offer is left. | — | assignments.ts:400-442; go-back.ts:91-101 |

Presence: `operator_presence (user_id, attending_work_center_id, session_id unique, status ∈ {online, away, offline}, last_heartbeat_at)`, unique per (user, WC). [src: execution.ts:183-196; app.ts:324-379]
- `POST /api/presence {workCenterId}` (member only, else 403): in one transaction, delete this user's rows that have this session **or** this work center (so another session of the same user at the same WC is displaced), then insert `online` with `last_heartbeat_at = now`. Then sweep the new WC and every displaced WC.
- `POST /api/presence/heartbeat {status?}`: `'away'` → `away`, `'back'` → `online`, anything else → keep-alive only (updates `last_heartbeat_at`). Sweeps the WC only when the status actually changed.
- `DELETE /api/presence[?workCenterId=]`: deletes this session's row (only for that WC when given), then sweeps that WC.
- Nothing in the engine expires stale presence by heartbeat age (Open point 7).

### D.5.4 What the inbox shows

`buildInbox(userId, workCenterId)` → `{workCenterId, workCenterName, offers[], myClaims[], waiting[]}`. [src: mission-control-db/src/runtime/inbox.ts:23-80, 228-363]
- **offers**: `status='offered'`, step `WAITING_USER` (so PAUSED offers are hidden), and `allowed_role_ids` (the **snapshot**) is empty or intersects the user's roles held **in this WC**. Sorted by `suggestedForMe` (= `preferred_user_id === user`) descending, then `offeredAt` ascending.
- **myClaims**: `status='claimed'`, `assigned_user_id = user`, step `WAITING_USER` or `PAUSED`. Sorted by `claimedAt`.
- **waiting**: timed GATEs (`timer`/`condition_or_timer`, not yet opened) and repeating SCRIPTs (`WAITING_GATE`/`WAITING_SCRIPT`) of this WC's instances whose status is `running, pausing, paused, resuming, stopping_cleanup` or `aborting_cleanup`; plain condition gates are not listed. Sorted by deadline ascending, no-deadline entries last. [src: inbox.ts:241-296]
- `InboxTask` fields: `assignmentId, stepInstanceId, stepOid, stepType, stepName (local_id), instanceId, runtimeNumber, runtimeLabel, masterName, masterVersion, workflowPath[], stepUpdatedAt, offeredAt, claimedAt, suggestedForMe, paused, formDocument (params substituted), yesNoConfig, continueLabel, buttonBar, allowStop, backAvailable, prefillValues`.
- Delivery: `GET /api/inbox?workCenterId=` (member-only), or SSE `GET /api/events?workCenterId=`, which pushes the full `inbox` snapshot on each `operator_change` for that WC and sends `event: ping` every 25 s. [src: api/app.ts:198-235]

---

## D.6 E-signatures

1. **Requirement**: a step requires a signature iff its frozen `form_document` contains an `esignature` block. The block is found by walking `sections[].rows[].blocks[]`; the **first** block with `type === 'esignature'` counts, even without `fieldName` (fail closed). The one exception is a YES_NO `decision` with `value 'no'`, which needs no signature. [src: core/esignature.ts:37-63; api/app.ts:525-530]
2. Block fields: `fieldName` (missing → `''`), `label`, `meaning`, `roleName` (trimmed; blank → none), `requireDifferentUser` (true only when the value is `=== true`), `outputParameter`. [src: esignature.ts:27-34, 54-60]
3. **Flow** (`POST /api/assignments/:id/submit`, body `{kind, values?, value?, signature?: {loginName, password}}`) [src: api/app.ts:478-575]:
   1. Validate the kind/step-type pairing. The caller must be the claimant (`status 'claimed'` and `assigned_user_id` = caller), else `409 {"code":"NOT_CLAIMANT","error":"assignment <id> is not held by the caller for step <stepOid>"}`. This check runs **before** any credential check, so the route cannot serve as a password oracle.
   2. `loginName` = `signature.loginName` trimmed if it is a string, else `''`; `password` = `signature.password` if it is a string, else `''`. If `loginName` is empty or `password.trim()` is empty → `400 {"code":"SIGNATURE_REQUIRED","error":"This step requires an e-signature"}`. The password itself is passed on **untrimmed**.
   3. `verifySignature` runs **outside** the instance transaction, in this order (the first failure wins) [src: esignature.ts:103-141; mission-control-db/src/dao/users.ts:28,107-110; dao/roles.ts:40-43]:
      1. Normalize the login name: `trim().toLowerCase()` (JavaScript Unicode lower-casing, locale-independent: `toLowerCase(Locale.ROOT)` in Java). Look up `app_user.login_name` by exact equality.
      2. Only if the user exists **and** `status === 'active'`: read the `account` row with `provider_id = 'credential'` for that user; if its `password` is non-empty, verify it (D.6.1). Otherwise, or on a mismatch → `SIGNATURE_INVALID_CREDENTIALS`, message `Login name or password is incorrect`. Unknown user, disabled user, user without a credential account and wrong password all give this one code.
      3. `requireDifferentUser` and signer id == operator id → `SIGNATURE_SAME_USER`, `A different user than the operator must sign`.
      4. Signer has no `work_center_user` row for the step's WC → `SIGNATURE_NOT_MEMBER`, `That user is not a member of this work center`.
      5. `roleName` set: no `role` whose `name` equals the trimmed `roleName` (exact, case-sensitive) → `SIGNATURE_ROLE_UNKNOWN`, `No role named "<roleName>" exists in Mission Commander`. The signer does not hold that role **in this WC** → `SIGNATURE_ROLE_MISSING`, `<signer display name> does not hold the role "<role name>" in this work center`.
   4. HTTP: `SIGNATURE_REQUIRED` 400; every other signature code 403. Body `{"code","error"}` (`error` = the message above). [esignature.ts:65-73; app.ts:557]
   5. **Every failed verification is audited** as a `step_signature` row, inserted outside any transaction, with `outcome 'failed'`, `failure_code`, `signer_user_id`/`signer_display_name` when the user was found (null for an unknown login), `signer_login_name` = the trimmed login name lowercased, `role_name` = the block's `roleName` (for every failure code), `role_id` only for `SIGNATURE_ROLE_MISSING`, `operator_user_id`/`operator_login_name` = the caller, `meaning`, `decision`. A `SIGNATURE_REQUIRED` (missing credentials) is **not** audited. [app.ts:546-556]
   6. On success, `submitCore` re-checks the claim under `FOR UPDATE` and inserts `step_signature` with `outcome 'signed'` **atomically with the completion** (signer fields from the database row, `role_id`/`role_name` from the resolved role or null), writes the trace `SIGNED` with detail `<signer login_name> as <role name | 'member'>`, and overrides `form_values[fieldName]` with the signer's **display name** (skipped when `fieldName` is `''`). If `submitCore` then fails (for example `NOT_CLAIMANT` after a race → 409), no signed row exists. [src: submit.ts:150-188]
4. **Meaning**: `esignature.meaning` is copied verbatim into `step_signature.meaning`. `decision` = the button output (YES_NO yes/no) or null. [src: submit.ts:168-177]
5. `step_signature` columns: `id, workflow_instance_id (soft link), runtime_number, runtime_label, work_center_id, work_center_name, step_instance_id (soft), step_oid, step_name, signer_user_id, signer_login_name, signer_display_name, role_id, role_name, operator_user_id, operator_login_name, meaning, decision, outcome ∈ {signed, failed}, failure_code, signed_at, superseded_at`. [src: execution.ts:249-281]
6. **Superseded**: when the operator presses Back from screen T to screen S, every `signed` row for `(instance, stepOid = S)` with a null `superseded_at` gets `superseded_at = now` in the same transaction. The reopened S must be signed again. [src: core/go-back.ts:80-82; dao/step-signatures.ts:57-66]


### D.6.1 Password verification (better-auth 1.7.12 default scrypt)

The engine does not configure a custom hasher, so `auth.$context.password.verify` is better-auth's default, shared with Mission Commander (which writes the hashes). A native engine MUST verify the same stored strings as follows [src: MissionEngine/node_modules/better-auth/dist/crypto/password.mjs; @better-auth/utils/dist/password.node.mjs; MissionEngine/package.json `"better-auth": "~1.7.12"` (installed 1.7.12, @better-auth/utils 0.5.0); verified by re-deriving a better-auth hash with plain `crypto.scryptSync` under these rules]:

1. Stored format (`account.password`): `<salt>:<key>`, where `<salt>` is 16 random bytes as **32 lowercase hex characters** and `<key>` is the 64-byte derived key as **128 lowercase hex characters**.
2. Split the stored string on `:` and take the first two parts. If either is empty, the reference **throws** `Invalid password hash` (this is not a SignatureError, so the submit route answers HTTP 500; Open point 16).
3. Derive `key' = scrypt(P, S, N = 16384, r = 16, p = 1, dkLen = 64)`, where
   - `P` = the UTF-8 bytes of the password after **Unicode NFKC normalization** (`password.normalize('NFKC')`; `java.text.Normalizer.normalize(pw, Normalizer.Form.NFKC)`),
   - `S` = the UTF-8 (ASCII) bytes of the **hex salt string itself** (32 bytes), **not** the 16 decoded bytes.
   - The reference's `maxmem` is `128·N·r·2` = 64 MiB; scrypt with these parameters needs about 32 MiB.
4. The password matches iff `hex(key')` (lowercase) equals `<key>` as a string. The reference comparison is ordinary string equality (not constant-time).
5. New hashes (only Commander creates them) use the same format with a fresh random salt.

---

## D.7 Configuration

### D.7.1 Environment variables read by the engine

| Variable | Default | Parse | Meaning | Source |
|---|---|---|---|---|
| `DATABASE_URL` | — (**required**; missing throws `DATABASE_URL is required`) | string | Postgres. The pool has `max: 10` and `connectionTimeoutMillis: 5000`. Dedicated LISTEN clients reconnect after a flat 5 s. | config.ts:95-96; db.ts:25-30; wake.ts:16 |
| `ENGINE_PORT` | `3006` | positive integer, else default | HTTP listen port | config.ts:97, 103 |
| `ENGINE_WORKER_CONCURRENCY` | `4` | positive integer | Worker-loop slots and the script pool size | config.ts:159; index.ts:47; loop.ts (concurrency) |
| `ACTION_SERVER_ALLOWLIST` | `''` | comma list, trimmed | First-boot seed of the trust allowlist only | config.ts:160; index.ts:53-60 |
| `SCRIPT_TIMEOUT_MS` | `5000` | positive integer | Timeout per SCRIPT or GATE run (D.3.2); the worker backstop adds 2 000 ms | config.ts:161; script-pool.ts:35 |
| `ACTION_POLL_SECS` | `20` | positive integer | Action status poll interval | config.ts:162 |
| `INVOKE_GRACE_SECS` | `60` | positive integer | Re-arm before an invoke or property fetch (crash recovery) | config.ts:163; loop.ts:328-330; input-bindings.ts:66-68 |
| `ACTION_FETCH_TIMEOUT_MS` | `10000` | positive integer | Timeout per non-stream action-server request | config.ts:164 |
| `PROPERTY_WATCH_ENABLED` | `true` | bool: `''`/unset → default; `false`/`0`/`no`/`off` (case-insensitive) → false; anything else → true | REST-12 watch switch | config.ts:99-102, 165 |
| `PROPERTY_WATCH_RECONCILE_MS` | `5000` | positive integer | Watch reconcile period | config.ts:166 |
| `SCHEDULER_ENABLED` | `true` | bool | Schedule timer switch | config.ts:167; schedule-tick.ts |
| `SCHEDULE_TICK_MS` | `5000` | positive integer | Schedule tick period | config.ts:168 |
| `BETTER_AUTH_SECRET` | dev fallback `insecure-dev-secret-change-me` | trimmed. With `NODE_ENV=production`: a placeholder (`insecure-dev-secret-change-me`, `change-me-in-production`, `mission-internal-dev-token`) or fewer than 32 characters **throws** | better-auth secret | config.ts:70-78, 104-115 |
| `ENGINE_BASE_URL` | `http://127.0.0.1:<port>` (also when `'/'`) | URL | Auth base URL and canonical host; GETs outside `/api/` with a different `Host` → 302 to the canonical host | config.ts:116; index.ts:70-80 |
| `ENGINE_INTERNAL_TOKEN` | `null` (every `/internal/*` request 401s) | string, used **untrimmed** (an empty value counts as unset). Production + a value whose trim is `mission-internal-dev-token` → throws. That dev value with a non-loopback bind or base URL → set to null (refused) | `X-Internal-Token` for `/internal/*`, compared in constant time; failure `401 {"error":{"code":"UNAUTHORIZED","message":"invalid internal token"}}` | config.ts:117-129; internal.ts:45-87 |
| `MISSION_ENGINE_BIND` | unset | host | Used only for the loopback-only check above | config.ts:80-92, 124 |
| `NODE_ENV` | — | `'production'` enables the hard secret checks | | config.ts:107 |
| `MISSION_BROKER_URL` | `''` | must be an http(s) URL if set, else throws | Broker origin for the Bearer token | config.ts:130-142 |
| `MISSION_BROKER_TOKEN` | `''` | trimmed | Broker token; warns when only one of URL/token is set | config.ts:131-142 |
| `MISSION_ACTIONS_URL` | `''` | http(s) URL, else throws | Mission Autopilot origin for `X-API-Key` | config.ts:143-155 |
| `ACTIONS_API_KEY` | `''` | trimmed | Mission Autopilot key | config.ts:144-155 |
| `TRUSTED_PROXIES` | unset | comma list of IPs or CIDRs; a bad entry **throws** at startup | Client-IP resolution for better-auth rate limits (header `x-mission-client-ip`) | api/client-ip.ts:24-85; app.ts:124 |
| `ALLOWED_ORIGINS` | `''` | comma list | Extra better-auth trusted origins, added to `http(s)://localhost:*` and `http(s)://127.0.0.1:*` | api/auth.ts:25-28 |
| `VITEST` | — | presence | Test-only: suppresses warnings | config.ts:113,121 |

**"positive integer" parsing** (`int(v, dflt)`): `n = Number(v)` with JavaScript semantics; the value is used iff `Number.isInteger(n) && n > 0`, else the default applies silently (no warning). So unset, `''`, `'0'`, `'-5'`, `'2.5'` and `'abc'` → default, while `' 7 '` → 7, `'7.0'` → 7, `'1e3'` → 1000 and `'0x10'` → 16 are accepted. A native engine that wants identical behavior must reproduce `Number(string)`: trim whitespace, accept decimal with optional fraction/exponent, `0x`/`0o`/`0b` prefixes, and `Infinity` (rejected by the integer check). [src: config.ts:97]

The image sets `NODE_ENV=production` and `ENGINE_PORT=3006` and exposes 3006. It sets no `TZ` and no `LANG`, so the process (and every script, D.3.1) runs in UTC with the `en-US` default locale. [src: MissionEngine/Dockerfile:98-111]

### D.7.2 Fixed constants (not configurable)

| Constant | Value | Source |
|---|---|---|
| Capabilities TTL | 300 000 ms | client.ts:125 |
| Trust-policy cache TTL | 5 000 ms | policy-cache.ts:22 |
| Warm-up failure back-off | 30 000 ms | capability-warmup.ts:38 |
| Pause unknown / poll warning limit | 120 000 ms | control.ts:251 |
| Waiting-log / stopping-drain heartbeat log interval | 300 000 ms | control.ts:133, 146 |
| Operator Abort confirm timeout | 30 000 ms | operator-cleanup.ts:49 |
| Gate STOP retry | 5 000 ms | gate.ts:163 |
| Gate / script default cycle | 5 s | step-handlers.ts:439, 544 |
| Script state / outputs cap | 65 536 bytes each | step-handlers.ts:441-443 |
| Script worker backstop grace / heap | 2 000 ms / 256 MB | script-pool.ts:35-38 |
| Property watch debounce / backoff base / max | 500 / 5 000 / 60 000 ms | property-watch.ts:153-155 |
| Idle slot wait | 1 000 ms (or a LISTEN wake) | loop.ts:824 |
| Sweep first run / interval | 5 000 / 30 000 ms | loop.ts:659-661 |
| Control-pass retry bound | 3 attempts | control.ts:182 |

### D.7.3 LISTEN/NOTIFY channels

| Channel | Payload | Engine reaction | Source |
|---|---|---|---|
| `engine_wake` | — | Wake idle loop slots (DB trigger on status/state changes) | index.ts:114; wake.ts |
| `operator_change` | work_center_id | Push inbox snapshots to that WC's SSE sessions | index.ts:115; reconcile.ts:19 |
| `pilot_theme` | theme rev | `event: theme` to Pilot sessions | index.ts:118-121; pilot-theme-store.ts:30 |
| `wc_resource_grant` | instance id | Wake the loop | index.ts:127; wc-resources.ts:25 |

### D.7.4 Health

`GET /health` → `200 {"status":"ok"}`, unconditionally. It does not check the database, the loop or listeners. The canonical-host redirect also applies to it: a GET with a `Host` other than `ENGINE_BASE_URL`'s gets a 302. The Dockerfile healthcheck is `wget -q -O /dev/null http://localhost:3006/health`. [src: health.ts:15-17; index.ts:70-81; Dockerfile]

---

# Part 5 — Persistence (sections E.x)

This section specifies the state the Mission Engine keeps durably, and the exact PostgreSQL
contract it shares with Mission Commander (which hosts Mission XO at `/xo`), Mission Broker and
the Designer-facing ingest. A re-implementation is either:

- **(a) drop-in**: it runs against the existing PostgreSQL database (schema owned by the
  `mission-control-db` package, migrations `0000`–`0051`, applied by Commander at startup) and
  MUST read and write the tables below exactly as specified; or
- **(b) standalone**: it brings its own store and MUST provide the same entities, invariants,
  atomicity, locking and notification semantics (§E.1, §E.8).

The engine never runs migrations. Mixed-clock note: most engine timestamps come from the
engine's injected clock `deps.now()` (in production simply the host wall clock, `() => new Date()`,
millisecond precision), but a few columns are stamped by the database clock (`now()` = start of
the current transaction, `clock_timestamp()` = actual time of the statement; microsecond
precision) or by the wall clock of another process (Commander/Broker `new Date()`); each is called
out where it happens. A re-implementation MAY store all instants with millisecond precision;
nothing in the contract depends on sub-millisecond ordering except where an identity column is
named as the tie-breaker.
`[src: MissionEngine/src/index.ts:64]` `[src: MissionEngine/src/core/sweep.ts:31-35]` `[src: mission-control-db/src/runtime/engine-access.ts:58-59]`

---

## E.1 Abstract persistent state model

The engine's whole durable state is the following. Every item is either owned by the engine
(it is the only writer), shared (several components write it), or reference data (Commander
writes it, the engine only reads it).

| # | Entity | Ownership | What it is |
|---|---|---|---|
| 1 | **RuntimeWorkflow** (`workflow_instance`) | shared: Commander/Broker/schedule create it and request control transitions; the engine executes it | One run of a frozen copy ("recipe") of a master workflow, with status, frozen identity (number, label, master name/oid/version/state), starting parameters, a root property map and an opaque engine-state document. |
| 2 | **StepRow** (`step_instance`) | engine | At most one live row per (run, step oid): the step's queue state, wake timer and action-instance handle. Reset/re-entry deletes or rewrites the row. |
| 3 | **Assignment** (`instance_assignment`) | shared: engine creates/closes; operators, Commander and the engine claim/release | An operator offer or claim for one step row. At most one live (`offered`/`claimed`) per step row. |
| 4 | **TraceEntry** (`trace_entry`) | engine (plus operator verbs run in the engine process) | Append-only per-run event log. Deleted with the run. |
| 5 | **HistoryRecord** (`runtime_history`) | engine writes once; Commander deletes only on explicit delete/purge | The permanent, self-contained record of a finished run, written atomically with the terminal status. |
| 6 | **StepRun** (`step_run`) | engine | Append-only: one row per execution of a step. Outlives the run. |
| 7 | **SignatureAttempt** (`step_signature`) | engine | Append-only e-signature audit, one row per attempt. Only `superseded_at` is ever updated. |
| 8 | **ControlEvent** (`runtime_control_event`) | the process that executes the Stop/Abort/skip request (engine internal API or Broker) | Append-only record of who sent each Stop, Abort and skip-cleanup. |
| 9 | **SharedResource / Waiter / Holder** (`wc_resource`, `wc_resource_waiter`, `wc_resource_holder`) | Commander defines; engine maintains live counters, FIFO queue and holder ledger | Work-center-scoped environment resource pools. |
| 10 | **SharedValue** (`wc_value_property`) | Commander defines; engine and Commander-via-engine update values | Work-center-scoped environment value properties. |
| 11 | **Presence** (`operator_presence`) | engine (Pilot sessions) | Which user is attending which work center, and whether online. |
| 12 | **Schedules** (`runtime_schedule`, `schedule_*`) | Commander defines/enables; the engine's schedule tick fires them | See §E.2.12. |
| 13 | **Settings** (`system_settings`) | Commander (engine seeds one key once) | Deployment-wide key/value settings. |
| 14 | Reference data | Commander | Work centers, membership, roles, users, credentials, master workflows and their nodes/allowed roles/images, environment bindings, Pilot theme, brand assets. |

Lifetime rules (normative, both deployment modes):

1. A RuntimeWorkflow and its StepRows, Assignments, TraceEntries and queued Waiters are
   **disposable**: after the run is terminal and its work center's `finished_retention_secs`
   (default 3600 s) has elapsed, the engine deletes them (unless rule 3 holds it).
   `[src: MissionEngine/src/core/sweep.ts:14-24]`
2. HistoryRecord, StepRun, SignatureAttempt and ControlEvent rows are **records** and MUST
   survive deletion of the run, its master workflow, its work center and the users named in
   them. They carry only soft links (no FK) to the run and step, and frozen copies of names and
   labels. `[src: mission-control-db/src/db/schema/execution.ts:200-201,243-249,285-288,323-324]`
3. A Holder row (an environment hold) outlives the terminal settle of the run that took it, and
   the run row is not swept while it owns one. `[src: mission-control-db/src/db/schema/work-center-runtime.ts:139-144]` `[src: MissionEngine/src/core/sweep.ts:26-30,87]`
4. A RuntimeWorkflow's label is frozen at creation and never rewritten.
   `[src: mission-control-db/src/db/schema/execution.ts:73-75]`
5. Exactly one HistoryRecord per run, written in the same transaction as the terminal status.
   `[src: MissionEngine/src/core/context.ts:1212-1245]`

---

## E.2 Concrete table contract (drop-in mode)

Conventions for every table below:

- Types are PostgreSQL types. `timestamptz` = `timestamp with time zone`. `uuid` defaults are
  `gen_random_uuid()`. `bigint identity` = `bigint GENERATED ALWAYS AS IDENTITY`.
- No PostgreSQL enum types exist: every vocabulary is `text` with a `CHECK (col in (...))`
  constraint. The strings are case-sensitive and exact. `[src: mission-control-db/src/db/schema/execution.ts:22-24,44-47]`
- "Writer" names the component that writes the column: **E** = Mission Engine process
  (including its HTTP API, its internal API called by Commander, its loop and its schedule
  tick), **C** = Mission Commander process (including XO, ingest, admin), **B** = Mission
  Broker, **A** = better-auth library (inside C or E).
- A re-implementation MUST NOT add NOT NULL constraints, triggers or FKs to these tables, and
  MUST tolerate any column it does not use being present.

### E.2.1 `workflow_instance` (RuntimeWorkflow)

`[src: mission-control-db/src/db/schema/execution.ts:49-116]`

| Column | Type | Null | Default | Writer | Meaning |
|---|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | C/E/B (creator) | PK. The runtime's public `RuntimeWorkflow.ID`. |
| `workflow_id` | uuid | NO | — | creator | Master workflow row (`workflow.id`). |
| `work_center_id` | uuid | NO | — | creator | FK `work_center.id` ON DELETE RESTRICT. |
| `environment_spec_id` | uuid | YES | — | (none) | FK `environment_spec.id` ON DELETE SET NULL. No current writer sets it. |
| `triggered_by` | text | NO | — | creator | CHECK in `('schedule','manual','event','workflow')`. Current writers use `manual` (default), `workflow` (Broker remote create), `schedule` (schedule tick). `[src: mission-control-db/src/dao/runtime-workflows.ts:100]` `[src: mission-control-db/src/runtime/remote-control/operations.ts:82]` `[src: mission-control-db/src/scheduling/fire.ts:124]` |
| `status` | text | NO | `'pending'` | C/E/B | Lifecycle, see §E.2.1.1. |
| `final_state` | text | YES | — | E | Set only by the terminal settle; equals the terminal status. No CHECK. |
| `property_store` | jsonb | YES | — | E | Root spec's flat property map `{ "<Property>" \| "<Property>.<Entry>": "<string>" }` (local tier only, never the shared tier). `[src: MissionEngine/src/core/properties.ts:258-264]` |
| `started_at` | timestamptz | YES | — | E | Set to SQL `now()` by the queued→running acquire. |
| `completed_at` | timestamptz | YES | — | E | Set by the terminal settle (`deps.now()`). Drives the retention sweep. |
| `created_by` | uuid | YES | — | creator | FK `app_user.id` ON DELETE SET NULL. Creating user. |
| `created_at` | timestamptz | NO | `now()` | DB | |
| `updated_at` | timestamptz | NO | `now()` | C/E | Bumped by every engine write; the engine's claim order (§E.4.2). |
| `spec_jsonb` | jsonb | NO | — | creator | The frozen recipe (`instantiateSpec(master spec)`). Never changed after creation. |
| `starting_params` | jsonb | YES | — | creator | Validated starting parameters `{ name: string }`. |
| `runtime_number` | integer | NO | — | creator | Per-work-center counter, never reused (§E.5). |
| `master_name`, `master_oid`, `master_version`, `master_state` | text | NO | — | creator | Frozen copy of the master's identity at creation. |
| `queued_at` | timestamptz | YES | — | C/E/B | Set when status becomes `queued`; FIFO key for start. The engine rewrites it to rotate a failing start (§E.4.6). |
| `start_requested_by` | uuid | YES | — | creator / requestStart | FK `app_user.id` SET NULL. |
| `engine_state` | jsonb | YES | — | E | Engine working state document (§E.3). NULL until first persist. |
| `runtime_label` | text | NO | — | creator | Frozen rendered Runtime ID (§E.5). |
| `created_by_instance_id` | uuid | YES | — | B | Soft link (no FK) to the runtime whose action created this one. |
| `created_by_step_instance_id` | uuid | YES | — | B | Soft link to that runtime's creating step row. |
| `created_by_step_started_at` | timestamptz | YES | — | B | The creating step's activation (its `step_instance.started_at`). |
| `created_by_label` | text | YES | — | B | Frozen display text such as `Work Center/RW-12`. |
| `cleanup_skip` | text | YES | — | E (via `requestSkipCleanup`) | CHECK in `('stop','abort')`. Set when an operator asks to skip a running Operator cleanup. Never cleared by the engine. |
| `schedule_item_run_id` | uuid | YES | — | E (schedule tick) | Soft link to `schedule_item_run.id`. |
| `schedule_label` | text | YES | — | E (schedule tick) | Frozen Runtime Schedule label (e.g. `RS-12`). |

Constraints and indexes `[src: mission-control-db/src/db/schema/execution.ts:91-116]`:

| Name | Definition |
|---|---|
| PK | `(id)` |
| `workflow_instance_wc_workflow_fk` | FK `(work_center_id, workflow_id)` → `workflow(work_center_id, id)` ON DELETE RESTRICT |
| `workflow_instance_wc_status_idx` | `(work_center_id, status)` |
| `workflow_instance_workflow_idx` | `(workflow_id)` |
| `workflow_instance_trigger_ck` | `triggered_by in ('schedule','manual','event','workflow')` |
| `workflow_instance_created_by_step_uq` | UNIQUE `(created_by_step_instance_id, created_by_step_started_at)` WHERE `created_by_step_instance_id is not null` — exactly-once child creation per creating-step activation |
| `workflow_instance_created_by_idx` | `(created_by_instance_id)` |
| `workflow_instance_status_ck` | `status in ('pending','queued','running','pausing','paused','resuming','stopping','aborting','completed','aborted','errored','stopped','stopping_cleanup','aborting_cleanup')` |
| `workflow_instance_cleanup_skip_ck` | `cleanup_skip in ('stop','abort')` |
| `workflow_instance_wc_number_uq` | UNIQUE `(work_center_id, runtime_number)` |
| `workflow_instance_wc_label_uq` | UNIQUE `(work_center_id, runtime_label)` |
| `workflow_instance_finished_idx` | `(work_center_id, completed_at)` WHERE `status in ('completed','aborted','stopped','errored')` |
| `workflow_instance_queued_idx` | `(queued_at)` WHERE `status = 'queued'` |
| trigger `workflow_instance_wake` | `AFTER INSERT OR UPDATE OF status ... FOR EACH STATEMENT EXECUTE FUNCTION engine_wake_notify()` (§E.4.4) `[src: mission-control-db/drizzle/0018_mission_engine.sql:23-29]` |

Child rows cascade on delete: `step_instance`, `trace_entry`, `wc_resource_waiter`,
`wc_resource_holder` (all `ON DELETE CASCADE`), and through `step_instance`,
`instance_assignment`. `[src: mission-control-db/src/db/schema/execution.ts:120,148,174]` `[src: mission-control-db/src/db/schema/work-center-runtime.ts:113,149]`

Status vocabulary groups (exact): `[src: mission-control-db/src/db/schema/execution.ts:25-33]` `[src: MissionEngine/src/core/operator-cleanup.ts:29,37-45]` `[src: MissionEngine/src/core/control.ts:66]`

| Group | Members |
|---|---|
| active (`RUNTIME_ACTIVE_STATUSES`) | `queued, running, pausing, paused, resuming, stopping, aborting, stopping_cleanup, aborting_cleanup` |
| final / terminal (`RUNTIME_FINAL_STATES`) | `completed, aborted, stopped, errored` |
| deletable (`RUNTIME_DELETABLE_STATUSES`) | `pending, completed, aborted, stopped, errored` |
| running-like (READY steps advance) | `running, stopping_cleanup, aborting_cleanup` |
| transitional (control pass) | `pausing, resuming, stopping, aborting` |
| halt status per cleanup kind | stop → `stopping`, abort → `aborting` |
| cleanup status per kind | stop → `stopping_cleanup`, abort → `aborting_cleanup` |
| final status per kind | stop → `stopped`, abort → `aborted` |

#### E.2.1.1 Who writes which status transition

| From → To | Writer | Mechanism |
|---|---|---|
| (insert) `pending` | C, B | `createRuntimeWorkflow(start=false)` `[src: mission-control-db/src/dao/runtime-workflows.ts:98-125]` |
| (insert) `queued` | C, B, E (schedule tick) | `createRuntimeWorkflow(start=true)`: `queued_at = now()`, or `clock_timestamp()` when `triggered_by='schedule'` so several runs of one transaction keep creation order; `start_requested_by = userId` `[src: mission-control-db/src/dao/runtime-workflows.ts:113-123]` |
| `pending` → `queued` | C, B | `requestStart`: `UPDATE ... SET status='queued', queued_at=now(), start_requested_by, updated_at=now() WHERE status='pending'`; else `RUNTIME_INVALID_STATE` / `RUNTIME_NOT_FOUND` `[src: mission-control-db/src/dao/runtime-workflows.ts:268-282]` |
| `queued` → `running` | E | acquire (§E.4.2) |
| `running` → `pausing` | E (internal API) / B | `requestPause`: guarded UPDATE `WHERE status in ('running')` `[src: mission-control-db/src/dao/runtime-control.ts:25-36]` |
| `paused` → `resuming` | E (internal API) / B | `requestResume` (from `paused`) `[src: mission-control-db/src/dao/runtime-control.ts:37]` |
| `running, paused, pausing` → `stopping` | E (internal API, Pilot Stop) / B | `requestStop`, effect `request`, writes a ControlEvent `[src: mission-control-db/src/dao/runtime-control.ts:78-81]` |
| `queued, running, pausing, paused, resuming, stopping` → `aborting` | E / B | `requestAbort`, effect `request` `[src: mission-control-db/src/dao/runtime-control.ts:86-90]` |
| `stopping_cleanup` → `aborting` | E / B | `requestAbort`, effect `escalate` |
| `stopping, stopping_cleanup` → `stopping` (+`cleanup_skip='stop'`) | E (internal API, user actor only) | `requestSkipCleanup('stop')`, effect `skip_cleanup` `[src: mission-control-db/src/dao/runtime-control.ts:93-98]` `[src: MissionEngine/src/api/internal.ts:112-130]` |
| `aborting, aborting_cleanup` → `aborting` (+`cleanup_skip='abort'`) | E (internal API, user actor only) | `requestSkipCleanup('abort')`, effect `skip_cleanup` |
| `pausing` → `paused` | E | control pass `[src: MissionEngine/src/core/control.ts:316-317]` |
| `paused` → `pausing` | E | undo of an undelivered PAUSE `[src: MissionEngine/src/core/send-failure.ts:199-200]` |
| `resuming` → `running` | E | control pass `[src: MissionEngine/src/core/control.ts:453-454]` |
| `stopping` → `stopping_cleanup`, `aborting` → `aborting_cleanup` | E | Operator cleanup begins `[src: MissionEngine/src/core/operator-cleanup-flow.ts:148-150]` |
| any → terminal | E only | `settleTerminal` (§E.6.1) |
| row deleted | E (sweep), C (`deleteRuntimeWorkflow` for deletable statuses; `deleteWorkflow` for terminal rows of that master; `deleteWorkCenter`), B (remote Stop/Abort of a `pending` run deletes it) | `[src: mission-control-db/src/dao/runtime-workflows.ts:284-295]` `[src: mission-control-db/src/dao/workflows.ts:40-71]` `[src: mission-control-db/src/dao/work-centers.ts:475]` `[src: mission-control-db/src/runtime/remote-control/operations.ts:124,131]` |

Every control request is guarded on the current status; a status not in the rule's `from` list
raises `RUNTIME_INVALID_STATE` and writes nothing; a missing row raises `RUNTIME_NOT_FOUND`.
`[src: mission-control-db/src/dao/runtime-control.ts:25-98]`

- **Pause / Resume** are ONE autocommit statement `UPDATE ... SET status=<to>, updated_at=<caller
  wall clock> WHERE id=$1 AND status IN (<from>)`; on zero rows the row is re-read to choose the
  error. Message: `cannot pause from <status>` / `cannot resume from <status>`. No ControlEvent.
- **Stop / Abort / skip** run in ONE transaction: (1) for a user actor, read `app_user`
  (`login_name`, `display_name`) — missing → `USER_NOT_FOUND`; (2) `SELECT status ... FOR UPDATE`
  on the instance row (blocking, not SKIP LOCKED); (3) the first rule whose `from` list contains
  the status wins, else `RUNTIME_INVALID_STATE` with message `cannot stop from <status>`,
  `cannot abort from <status>` or `cannot skip cleanup from <status>`; (4) `UPDATE status=<to>,
  updated_at=<caller wall clock>` (plus `cleanup_skip=<kind>` for a skip) — note a skip from
  `stopping`/`aborting` rewrites the SAME status, which still fires the `engine_wake` trigger;
  (5) INSERT the ControlEvent (`from_status` = the locked status, `to_status` = rule target,
  `verb` = the recorded verb, `step_oid`/`step_name` only for a Pilot Stop).
- `updated_at` here comes from the calling process's clock (`new Date()`), not from SQL `now()`.

Broker's remote verbs map onto these (`[src: mission-control-db/src/runtime/remote-control/operations.ts:115-140]`):
remote Stop of a `pending` run and remote Abort of a `pending` run DELETE the row
(`deleteRuntimeWorkflow`) and write no ControlEvent; remote Stop of a `queued` run is
`requestAbort(..., recordAsVerb='stop')`; a Stop/Abort of an already-finished or already
stopping/aborting run is a no-op success.

### E.2.2 `step_instance` (StepRow)

`[src: mission-control-db/src/db/schema/execution.ts:118-144]` — all columns written by **E** only.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | uuid | NO | random | PK. Sent to action servers as `step_instance_id`. |
| `workflow_instance_id` | uuid | NO | — | FK → `workflow_instance.id` ON DELETE CASCADE. Always the ROOT run, also for steps of a nested child workflow. |
| `node_oid` | text | NO | — | Oid of the (child) spec that owns the step (`context.spec.oid`). `[src: MissionEngine/src/core/transition.ts:773-776]` |
| `step_oid` | text | NO | — | Step oid. Unique across the whole recipe tree. |
| `step_type` | text | NO | — | Canonical step type: the spec's `step_type`, with `SELECT_1` rewritten to `SELECT 1`. `[src: MissionEngine/src/core/step-handlers.ts:31-34]` |
| `state` | text | NO | — | CHECK in `('READY','EXECUTING','WAITING_ACTION','WAITING_USER','WAITING_GATE','WAITING_PROPERTIES','WAITING_SCRIPT','PAUSED','COMPLETED','ERRORED','ABORTED','CANCELLED')` |
| `order_index` | integer | YES | — | Never written by the engine (always NULL); readers sort `order_index ?? 1e9`, then `created_at`. `[src: mission-control-db/src/dao/runtime-workflows.ts:169]` |
| `input_params`, `output_params` | jsonb | YES | — | Never written by the engine (always NULL). Step parameters live in `engine_state.stepSnapshots`. |
| `error` | text | YES | — | Failure message. |
| `started_at` | timestamptz | YES | — | Activation time; rewritten to the invoke time when an action invoke is recorded `[src: MissionEngine/src/loop.ts:457-462]`; shifted forward on resume by the paused duration. |
| `completed_at` | timestamptz | YES | — | |
| `created_at`, `updated_at` | timestamptz | NO | `now()` | The engine sets both explicitly from `deps.now()`. |
| `wake_at` | timestamptz | YES | — | Due time for action invoke/poll/timeout, gate re-evaluation, property acquisition or repeating-script runs. Every terminal transition MUST clear it. |
| `action_instance_id` | text | YES | — | Action server's instance id. NULL = not yet invoked (or a parked WORKFLOW PROXY, which never has a `wake_at`). |
| `action_server_uri` | text | YES | — | Server the instance lives on. |
| `action_invoked_oid` | text | YES | — | Action oid actually sent at invoke (strict: the workflow's oid; loose: the name-resolved container oid). |

Indexes/constraints: `step_instance_state_idx (workflow_instance_id, state)`; `step_instance_wake_idx (wake_at) WHERE wake_at IS NOT NULL`; `step_instance_state_ck`. Trigger `step_instance_wake`: `AFTER UPDATE OF state ... FOR EACH STATEMENT EXECUTE FUNCTION engine_wake_notify()` (INSERTs do not fire it). `[src: mission-control-db/drizzle/0018_mission_engine.sql:30]`

Row-identity rules (normative):

- There is no DB unique constraint on `(workflow_instance_id, step_oid)`, but the engine MUST keep
  at most one row per pair: it always selects a step's row with
  `WHERE workflow_instance_id = ? AND step_oid = ?` and takes the first. `[src: MissionEngine/src/core/transition.ts:740-741]` `[src: MissionEngine/src/core/submit.ts:132-133]`
- Re-activation of an existing row rewrites it in place (`state='READY'`, `completed_at`,
  `error`, `started_at`, `wake_at`, `action_*` all NULL). `[src: MissionEngine/src/core/transition.ts:960-964]`
- A reset (GOTO, RETRY, RESTART, child teardown, Back, catch arming) DELETES the row; the delete
  cascades its `instance_assignment` rows. `[src: MissionEngine/src/core/transition.ts:1345,1416,1467,1526,1551,1647,2098]`
- Other components only read this table, except Broker reads it for wait/status, and the
  property watch's `markGatesDue` moves `wake_at` earlier without an instance lock (§E.4.3).

### E.2.3 `instance_assignment` (Assignment)

`[src: mission-control-db/src/db/schema/execution.ts:146-170]`

| Column | Type | Null | Default | Writer | Meaning |
|---|---|---|---|---|---|
| `id` | uuid | NO | random | E | PK (Pilot's assignment id). |
| `step_instance_id` | uuid | NO | — | E | FK → `step_instance.id` ON DELETE CASCADE. |
| `work_center_id` | uuid | NO | — | E | FK → `work_center.id` ON DELETE RESTRICT. |
| `resolved_role_id` | uuid | YES | — | E | Role the claimant qualified with; FK `role.id` SET NULL. |
| `assigned_user_id` | uuid | YES | — | E | Claimant; FK `app_user.id` SET NULL. |
| `preferred_user_id` | uuid | YES | — | E | Dispatch suggestion. |
| `released_from_user_id` | uuid | YES | — | E | Claimant a release took the step from; the sole-candidate sweep never claims back to them. Cleared by every claim path. |
| `allowed_role_ids` | jsonb (string[]) | NO | `'[]'::jsonb` | E | Snapshot of the step's allowed roles at offer time. |
| `status` | text | NO | `'offered'` | E | CHECK in `('offered','claimed','completed','cancelled')`. |
| `dispatch_policy` | text | YES | — | E | The effective policy (`least_queued_steps`, `highest_priority`, `round_robin`, `fewest_active_instances`, `manual`) or `auto_claim`; NULL after a release. No CHECK. |
| `dispatch_reason` | text | YES | — | E | Free text. Exact values written: `unrestricted: pull-based claim`, `no candidate`, `manual: pull-based claim`, `highest_priority: <n>`, `least_queued_steps: <n>`, `auto_claim_chain`, `auto_claim_sole_candidate`, `commander_assign`, `went_back`. `[src: mission-control-db/src/runtime/dispatch.ts:100-124]` `[src: mission-control-db/src/runtime/assignments.ts:171-172,272-273,437]` `[src: MissionEngine/src/api/internal.ts:228]` |
| `assigned_at` | timestamptz | NO | `now()` | E | Offer time (engine sets `deps.now()`). |
| `claimed_at` | timestamptz | YES | — | E | |
| `completed_at` | timestamptz | YES | — | E | Close time. |

Indexes: `instance_assignment_user_status_idx (assigned_user_id, status)`;
`instance_assignment_step_idx (step_instance_id)`; `instance_assignment_wc_live_idx (work_center_id, status) WHERE status IN ('offered','claimed')`;
**`instance_assignment_step_live_uq` UNIQUE `(step_instance_id) WHERE status IN ('offered','claimed')`**;
`instance_assignment_status_ck`.

Lifecycle (all executed in the engine process; Commander reaches the two commander verbs through
the engine's internal API):

| Event | Row change |
|---|---|
| reconcile (tail of every transaction that claims an instance row) | close every live row whose step is no longer `WAITING_USER`/`PAUSED` (`completed` if the step is `COMPLETED`, else `cancelled`, `completed_at=now`); insert an offer (or an auto-claimed row) for every `WAITING_USER` step with no live row; sole-candidate claim of existing offers. `PAUSED` steps keep their rows untouched. `[src: mission-control-db/src/runtime/assignments.ts:179-345]` |
| operator claim | `status='claimed', assigned_user_id, claimed_at, resolved_role_id, released_from_user_id=NULL WHERE status='offered'` `[src: MissionEngine/src/api/app.ts:432-436]` |
| operator release / sign-out release / commander force-release | `status='offered', assigned_user_id=NULL, claimed_at=NULL, resolved_role_id=NULL, preferred_user_id=NULL, dispatch_policy=NULL, dispatch_reason=NULL, released_from_user_id=<old assigned_user_id> WHERE status='claimed' [AND assigned_user_id=<caller>]` `[src: MissionEngine/src/api/app.ts:78-88,455-465]` `[src: MissionEngine/src/api/internal.ts:144-154]` |
| commander assign | `status='claimed', assigned_user_id, claimed_at, resolved_role_id, released_from_user_id=NULL, dispatch_reason='commander_assign' WHERE status='offered'` `[src: MissionEngine/src/api/internal.ts:225-230]` |
| Back | after commit, claim the reopened step's offer for the operator, `dispatch_reason='went_back'` `[src: mission-control-db/src/runtime/assignments.ts:408-442]` |

### E.2.4 `trace_entry` (TraceEntry)

`[src: mission-control-db/src/db/schema/execution.ts:172-181]` — written by **E** only.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | bigint identity | NO | — | PK; real insertion order (tie-breaker). |
| `workflow_instance_id` | uuid | NO | — | FK → `workflow_instance.id` ON DELETE CASCADE. |
| `step_oid` | text | YES | — | NULL for instance-level entries. |
| `state` | text | NO | — | No CHECK. Values written: `EXECUTING`, `WAITING`, `COMPLETED`, `ERRORED`, `ABORTED`, `IDLE`, `OPENED`, `PAUSED`, `SIGNED`, `WARNING`, `OPERATOR`. |
| `order_index` | integer | NO | — | Per-owning-spec counter (`engine_state.orderCounters[<spec oid>]`, starting at 1). Operator-verb rows use `max(order_index)+1` of the whole run. |
| `error` | text | YES | — | Message/detail. Operator detail ends ` [by <user uuid>]`; Commander's history detail resolves those uuids to login names. `[src: mission-control-db/src/dao/runtime-history.ts:190]` |
| `at` | timestamptz | NO | `now()` | Engine sets `deps.now()`. |
| `after_action` | integer | YES | — | Operator-submission index (`engine_state.userActionCounter`). |

Index: `trace_entry_instance_order_idx (workflow_instance_id, order_index)`.

Every `COMPLETED`, `ERRORED` or `ABORTED` entry with a non-null `step_oid` MUST be accompanied, in
the same transaction, by a `step_run` row with result `completed`, `failed` or `aborted`
respectively. `[src: MissionEngine/src/core/context.ts:43-45,604-609]`

Operator-verb trace rows on the shared work-center registry are written in a SEPARATE
transaction after the registry change commits (an INSERT here takes `FOR KEY SHARE` on the
instance row through the FK, which would invert the lock order); a failure is logged, not
raised. `[src: MissionEngine/src/core/operator-verbs.ts:128-175]`

### E.2.5 `runtime_history` (HistoryRecord)

`[src: mission-control-db/src/db/schema/execution.ts:198-239]` — inserted by **E** only; deleted
only by **C** (explicit delete / purge, §E.6.3).

| Column | Type | Null | Default | Value written by the terminal settle |
|---|---|---|---|---|
| `id` | uuid | NO | random | |
| `workflow_instance_id` | uuid | YES | — | Soft link (no FK). |
| `work_center_id` | uuid | YES | — | FK `work_center.id` ON DELETE SET NULL. |
| `work_center_name` | text | NO | — | `work_center.name` at settle (`''` if missing). |
| `runtime_number` | integer | NO | — | from the instance |
| `runtime_label` | text | NO | — | from the instance |
| `master_name`, `master_oid`, `master_version`, `master_state` | text | NO | — | from the instance |
| `final_state` | text | NO | — | CHECK in `('completed','aborted','stopped','errored')` |
| `started_at` | timestamptz | YES | — | instance `started_at` |
| `finished_at` | timestamptz | NO | — | settle time (`deps.now()`), same instant as `completed_at` |
| `starting_params` | jsonb | YES | — | instance `starting_params` |
| `trace` | jsonb | NO | — | `TraceEntry[]` re-assembled into reference order (§E.6.2) |
| `properties` | jsonb | YES | — | flat map: shared values overlaid by local values (`toHistoryJSON`) |
| `step_params` | jsonb | YES | — | `engine_state.stepSnapshots` |
| `step_names` | jsonb | YES | — | `{ "<step oid>": "<local_id>" }` over the whole recipe tree |
| `created_by_instance_id`, `created_by_label` | uuid / text | YES | — | lineage copies |
| `outputs` | jsonb | YES | — | `[{ "name": <output id>, "value": <string> }]` (§E.6.2) |
| `started_by_user_id` | uuid | YES | — | `start_requested_by ?? created_by`, only if that user's login name resolves; else NULL. No FK. |
| `started_by_login_name` | text | YES | — | that user's `login_name` |
| `schedule_label` | text | YES | — | instance `schedule_label` |
| `created_at` | timestamptz | NO | `now()` | |

Indexes: **`runtime_history_instance_uq` UNIQUE `(workflow_instance_id)`** (the insert is
`ON CONFLICT (workflow_instance_id) DO NOTHING`); `runtime_history_wc_idx (work_center_id, finished_at)`;
`runtime_history_finished_idx (finished_at)`; `runtime_history_created_by_idx (created_by_instance_id)`;
`runtime_history_wc_label_idx (work_center_id, runtime_label)` (non-unique, migration 0036, serves
the label allocator probe); `runtime_history_final_state_ck`.
`[src: mission-control-db/src/runtime/engine-access.ts:80-97]` `[src: mission-control-db/drizzle/0036_runtime_history_label_idx.sql]`

The schedule tick treats the existence of a history row as proof that a scheduled run ended.
`[src: mission-control-db/src/scheduling/chain.ts:15-18,169]`

### E.2.6 `step_run` (StepRun)

`[src: mission-control-db/src/db/schema/execution.ts:295-322]` — inserted by **E** only. Never updated.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | uuid | NO | random | |
| `workflow_instance_id` | uuid | NO | — | Soft link to the ROOT run (no FK). |
| `runtime_label` | text | NO | — | Frozen copy. |
| `work_center_id` | uuid | YES | — | FK `work_center.id` SET NULL. |
| `step_instance_id` | uuid | YES | — | Soft link; may name a since-deleted row. |
| `step_oid` | text | NO | — | |
| `step_name` | text | NO | — | Step `local_id` (else the oid). |
| `step_type` | text | NO | — | Canonical step type (`UNKNOWN` if not found). |
| `run_number` | integer | NO | — | `count(step_run rows for (instance, step_oid)) + 1` at insert. |
| `started_at` | timestamptz | YES | — | The step row's `started_at`, else `finished_at` (auto-completing steps). |
| `finished_at` | timestamptz | NO | — | `deps.now()` |
| `result` | text | NO | — | CHECK in `('completed','failed','caught','aborted','stopped','cancelled','went_back')` (`went_back` added by 0051). |
| `error` | text | YES | — | |
| `input_parameters` | jsonb | YES | — | The step's declared inputs from its snapshot (its `input_parameter_specifications` ids plus Action-Property binding parameter ids). |
| `output_parameters` | jsonb | YES | — | Snapshot outputs. |
| `performed_by_user_id` | uuid | YES | — | FK `app_user.id` SET NULL; the submitting claimant, credited once. |
| `performed_by_login_name` | text | YES | — | |
| `performed_by_kind` | text | NO | — | CHECK in `('user','script','action','gate','system')`. Without a submitting user: `SCRIPT`/`MATH`→`script`, `ACTION PROXY`→`action`, `GATE`→`gate`, `USER_INTERACTION`/`YES_NO`→`user`, otherwise `system`. |
| `node_path` | jsonb | NO | `'[]'::jsonb` | `[{ "proxyStepOid", "proxyRun", "workflowName" }]` outermost first; `[]` for root steps. |

Constraints `step_run_result_ck`, `step_run_kind_ck` (migration 0051 dropped and re-created
`step_run_result_ck` to add `went_back`). `step_type` comes from the recipe definition
(`canonicalStepType(def.step_type)`, `UNKNOWN` when the oid is not in the recipe tree), not from
the step row; `step_name` is the definition's `local_id` when it is a string, else the oid;
`node_path[].workflowName` is the child spec's `local_id`; `proxyRun` = 1 + number of step_run
rows of that proxy oid whose `started_at` is before the proxy row's current `started_at` (or
`count+1` if the row/start is missing). `[src: MissionEngine/src/core/step-run.ts:74-84,132-188]`
Index: `step_run_instance_idx (workflow_instance_id, step_oid, started_at)`. There is deliberately
**no unique index** (a double write must not abort the engine transaction).
`[src: MissionEngine/src/core/step-run.ts:35-206]`

When rows are written: every ending trace (above); `caught` when a TRY catches a failure;
`stopped` for rows ended by a Stop drain; `cancelled` for active rows torn down by resets/teardown
and, at every terminal settle, for every row still in an active state
(`EXECUTING, WAITING_ACTION, WAITING_USER, WAITING_GATE, WAITING_PROPERTIES, WAITING_SCRIPT, PAUSED`);
`failed` for active rows at an engine give-up; `went_back` for the screen an operator pressed Back
on. `READY` rows never get a step_run. `[src: MissionEngine/src/core/context.ts:1326]` `[src: MissionEngine/src/core/control.ts:538-588]` `[src: MissionEngine/src/core/transition.ts:2096]` `[src: MissionEngine/src/core/go-back.ts:78-80]`

### E.2.7 `step_signature` (SignatureAttempt)

`[src: mission-control-db/src/db/schema/execution.ts:252-281]` — inserted by **E** only.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | uuid | NO | random | |
| `workflow_instance_id` | uuid | NO | — | Soft link (no FK, by design: the failed-attempt insert runs outside the instance transaction). |
| `runtime_number` | integer | NO | — | |
| `runtime_label` | text | NO | — | |
| `work_center_id` | uuid | YES | — | FK SET NULL |
| `work_center_name` | text | NO | — | |
| `step_instance_id` | uuid | YES | — | Soft link |
| `step_oid`, `step_name` | text | NO | — | |
| `signer_user_id` | uuid | YES | — | FK SET NULL; NULL when the login did not resolve |
| `signer_login_name` | text | NO | — | resolved login, or the typed login lower-cased on failure |
| `signer_display_name` | text | YES | — | |
| `role_id` / `role_name` | uuid / text | YES | — | `signed`: the role the signer qualified with (`role_name` NULL = qualified as a plain member). `failed`: `role_id` from the error (may be NULL), `role_name` = the block's configured `roleName` (not a resolved name). |
| `operator_user_id` | uuid | YES | — | FK SET NULL; the claimant |
| `operator_login_name` | text | NO | — | |
| `meaning` | text | YES | — | block's `meaning` |
| `decision` | text | YES | — | YES_NO answer (`yes`/`no`) or NULL (signed rows: the submission's `button_output`; failed rows: the decision value when the body is a decision). A decision `no` never requires a signature. `[src: MissionEngine/src/api/app.ts:531,553]` |
| `outcome` | text | NO | — | CHECK in `('signed','failed')` |
| `failure_code` | text | YES | — | `SIGNATURE_INVALID_CREDENTIALS`, `SIGNATURE_SAME_USER`, `SIGNATURE_NOT_MEMBER`, `SIGNATURE_ROLE_UNKNOWN`, `SIGNATURE_ROLE_MISSING` |
| `signed_at` | timestamptz | NO | `now()` | DB clock (the engine does not set it). |
| `superseded_at` | timestamptz | YES | — | Set (engine clock) by Back on the reopened screen's rows with `outcome='signed' AND superseded_at IS NULL`, matched by `(workflow_instance_id, step_oid)` (0051). `[src: mission-control-db/src/dao/step-signatures.ts:57-67]` |

Indexes: `step_signature_instance_idx (workflow_instance_id)`; `step_signature_wc_signed_idx (work_center_id, signed_at DESC)`; `step_signature_outcome_ck`.

A `signed` row MUST be inserted in the same transaction as the completion it authorises, together
with a `SIGNED` trace entry whose `error` is `<login> as <role name | member>`. A `failed` row is
inserted on its own, before any instance transaction. `[src: MissionEngine/src/core/submit.ts:165-180]` `[src: MissionEngine/src/api/app.ts:545-556]` `[src: mission-control-db/src/dao/step-signatures.ts:58-67]`

### E.2.8 `runtime_control_event` (ControlEvent)

`[src: mission-control-db/src/db/schema/execution.ts:325-349]` — inserted by whichever process
executes `requestStop` / `requestAbort` / `requestSkipCleanup` (E or B). Never updated.

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | bigint identity | NO | — | |
| `workflow_instance_id` | uuid | NO | — | Soft link |
| `verb` | text | NO | — | CHECK `('stop','abort')`. A remote Stop of a queued run is executed as an Abort but recorded as `stop`. |
| `effect` | text | NO | — | CHECK `('request','escalate','skip_cleanup')` |
| `from_status`, `to_status` | text | NO | — | |
| `actor_kind` | text | NO | — | CHECK `('user','remote','system')` |
| `actor_user_id` | uuid | YES | — | FK SET NULL (user actors) |
| `actor_login_name`, `actor_display_name` | text | YES | — | user actors (looked up in `app_user`) |
| `actor_label` | text | YES | — | remote/system actors; the engine's default system actor label is `internal` |
| `actor_instance_id` | uuid | YES | — | remote actors: the sender's own runtime |
| `step_oid`, `step_name` | text | YES | — | the step a Pilot Stop was pressed on (0051) |
| `at` | timestamptz | NO | `now()` | DB clock |

Index: `runtime_control_event_instance_idx (workflow_instance_id)`; constraints
`runtime_control_event_verb_ck`, `runtime_control_event_effect_ck`,
`runtime_control_event_actor_kind_ck`. Pause/Resume write no row.
`[src: MissionEngine/src/api/internal.ts:50-57]`

### E.2.9 Shared environment registry

#### `wc_resource` `[src: mission-control-db/src/db/schema/work-center-runtime.ts:60-101]`

| Column | Type | Null | Default | Writer |
|---|---|---|---|---|
| `work_center_id` | uuid | NO | — | C (FK `work_center` CASCADE) |
| `name` | text | NO | — | C |
| `resource_type` | text | NO | — | C; CHECK in `('binary exclusive use','binary shared use with pool limits','countable use with pool limits','named pool','sync')` |
| `use_limit` | integer | YES | — | C; NULL also means "1" for countable/shared pools — readers MUST apply `?? 1` |
| `pool_names` | jsonb string[] | NO | `'[]'` | C |
| `available_names` | jsonb string[] | NO | `'[]'` | **E** (live) |
| `in_use` | integer | NO | 0 | **E** (live); CHECK `in_use >= 0`, may exceed `use_limit` |
| `description` | text | YES | — | C |
| `defined_by_env_spec_id` | uuid | YES | — | C (FK SET NULL; NULL = orphaned) |
| `defined_from_name`, `defined_from_version`, `defined_from_state` | text | YES | — | C |
| `created_at`, `updated_at` | timestamptz | NO | `now()` | C (engine writes do not bump `updated_at`) |

PK `(work_center_id, name)`; constraints `wc_resource_type_ck`, `wc_resource_in_use_ck`
(`in_use >= 0`). Rows are created by Commander's ingest
(`materializeEnvironmentRegistry`); the engine never inserts or deletes them.
`[src: mission-control-db/src/dao/work-center-runtime.ts:196-218]`

#### `wc_resource_waiter` — FIFO queue `[src: mission-control-db/src/db/schema/work-center-runtime.ts:109-137]` — writer **E**

| Column | Type | Null | Default | Meaning |
|---|---|---|---|---|
| `id` | bigint identity | NO | — | PK. **The FIFO order**: every queue read MUST order by `id`. |
| `work_center_id`, `name` | uuid, text | NO | — | FK `(work_center_id, name)` → `wc_resource` CASCADE |
| `instance_id` | uuid | NO | — | FK `workflow_instance.id` CASCADE |
| `step_oid` | text | NO | — | waiting step |
| `kind` | text | NO | — | CHECK `('acquire','send','receive','sync')` |
| `amount` | integer | YES | — | units for count pools |
| `payload` | text | YES | — | sync message |
| `granted` | boolean | NO | false | set by a releasing instance for a cross-instance hand-off |
| `granted_name`, `granted_payload` | text | YES | — | |
| `enqueued_at` | timestamptz | NO | `now()` | |

Indexes: `wc_resource_waiter_fifo_idx (work_center_id, name, id)`; `wc_resource_waiter_instance_idx (instance_id)`; `wc_resource_waiter_granted_idx (instance_id) WHERE granted`; `wc_resource_waiter_kind_ck`; FK name `wc_resource_waiter_resource_fk`.

#### `wc_resource_holder` — holder ledger `[src: mission-control-db/src/db/schema/work-center-runtime.ts:145-166]` — writer **E**

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint identity | NO | — |
| `work_center_id`, `name` | uuid, text | NO | — (FK → `wc_resource` CASCADE) |
| `instance_id` | uuid | NO | — (FK `workflow_instance` CASCADE) |
| `step_oid` | text | NO | — |
| `amount` | integer | NO | 1 (CHECK `> 0`) |
| `held_name` | text | YES | — (named pool) |
| `acquired_at` | timestamptz | NO | `now()` |

Indexes `wc_resource_holder_resource_idx (work_center_id, name)`, `wc_resource_holder_instance_idx (instance_id)`; `wc_resource_holder_amount_ck` (`amount > 0`); FK name `wc_resource_holder_resource_fk`.
Because the engine replaces its own holder rows wholesale at every persist (below) and the insert
does not carry `acquired_at`, a holder row's `id` and `acquired_at` are re-stamped (DB `now()`,
new identity value) every time the holding instance persists while it is open; "oldest row" in a
foreign release therefore means "row written longest ago", not "hold taken first".
`[src: mission-control-db/src/runtime/wc-resources.ts:145-151]`

Write protocol (normative): within a transition, the engine locks the resource rows it may touch
(§E.4.1), reads every waiter on them, computes the new state in memory, then applies in order:
counter UPDATEs (`in_use`, `available_names`), waiter DELETEs, waiter grant UPDATEs, waiter
INSERTs, then **deletes and re-inserts all holder rows of its own instance** from
`engine_state.envHolds`. It never touches another instance's holder rows except through a
cross-workflow Release (`consumeForeignHolders`, foreign rows read in `id` order: binary
exclusive deletes every foreign row; named pool deletes the oldest row with that `held_name`
(nothing when the release carries no name); binary shared consumes exactly 1 unit and countable
consumes `amount` units, oldest row first, deleting a row whose amount is ≤ the units left and
otherwise decrementing it; an unknown type does nothing; the instances whose rows changed get a
`wc_resource_grant` NOTIFY). At the terminal settle it deletes its own waiter
rows (queued and granted-unconsumed) but keeps its holder rows. Operator verbs (internal API)
change counters, delete/grant waiters and delete specific holder rows, never insert waiters.
`[src: mission-control-db/src/runtime/wc-resources.ts:67-288]` `[src: MissionEngine/src/core/context.ts:616-692,1119-1182]`

#### `wc_value_property` — shared values `[src: mission-control-db/src/db/schema/work-center-runtime.ts:175-189]`

| Column | Type | Null | Default | Writer |
|---|---|---|---|---|
| `work_center_id` | uuid | NO | — | C (FK CASCADE) |
| `property_name`, `entry_name` | text | NO | — | C |
| `value` | text | NO | `''` | C (definition), **E** (runs and commander edits) |
| `defined_by_env_spec_id` | uuid | YES | — | C (FK SET NULL) |
| `updated_at` | timestamptz | NO | `now()` | E/C |
| `updated_by` | uuid | YES | — | NULL for an engine (workflow) write; the commander's user id for an edit through the internal API (FK SET NULL) |

PK `(work_center_id, property_name, entry_name)`. The engine reads all rows of the work center
without locks at context open and, at persist, issues one `UPDATE ... SET value, updated_at,
updated_by=NULL` per changed entry; a zero-row update is logged and ignored, never an insert.
Last writer wins. `[src: mission-control-db/src/runtime/wc-value-properties.ts:30-98]`

### E.2.10 `operator_presence`

`[src: mission-control-db/src/db/schema/execution.ts:183-196]` — writer **E** (Pilot routes).

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | NO | random |
| `user_id` | uuid | NO | — (FK `app_user` CASCADE) |
| `attending_work_center_id` | uuid | NO | — (FK `work_center` CASCADE) |
| `session_id` | text | NO | — (better-auth session id) |
| `status` | text | NO | `'online'`; CHECK `('online','away','offline')` |
| `last_heartbeat_at` | timestamptz | NO | `now()` |
| `created_at` | timestamptz | NO | `now()` |

Unique `operator_presence_session_uq (session_id)`, unique `operator_presence_user_wc_uq (user_id, attending_work_center_id)`, index `operator_presence_wc_status_idx (attending_work_center_id, status)`, `operator_presence_status_ck`.
`POST /api/presence` runs ONE transaction: `DELETE ... WHERE user_id=<me> AND (session_id=<this
session> OR attending_work_center_id=<wc>)`, then INSERT a fresh `online` row with
`last_heartbeat_at = deps.now()` (it MUST NOT catch a unique violation inside the transaction —
the pre-delete is what avoids both uniques); heartbeat updates `last_heartbeat_at` and optionally
`status` (`away`, or `online` for `back`) for this session's row; `DELETE /api/presence` deletes
this session's row, restricted to `attending_work_center_id = ?workCenterId` when that query
parameter is given; sign-out deletes this session's row and also releases EVERY claim the user
holds in any work center. The engine writes only `online`/`away`; nothing ever expires a row by
`last_heartbeat_at` (there is no stale-presence sweep), so a vanished client stays "present"
until its session signs out or another POST for the same user/work center replaces it.
`[src: MissionEngine/src/api/app.ts:71-102,324-380]`

### E.2.11 `system_settings`

`[src: mission-control-db/src/db/schema/system-settings.ts:19-23]` — `key text PK`, `value text NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`.

| Key | Engine use | Value / fail-safe |
|---|---|---|
| `action_matching` | read | `strict`; anything else or absent = `loose` |
| `action_server_trust` | read | `loose`; anything else or absent = `strict` |
| `action_server_allowlist` | read; **inserted once** by the engine from `ACTION_SERVER_ALLOWLIST` (`INSERT ... ON CONFLICT DO NOTHING`, only if the list is non-empty) | JSON array of origins; unparseable = `[]` |
| `runtime_id_timezone` | read by the label allocator | IANA zone; invalid/absent = server zone, else `UTC` |
| `schedule_late_tolerance_minutes` | read by the schedule tick | |
| `pilot_theme`, `pilot_theme_rev` | read | site theme JSON and its revision |

`[src: mission-control-db/src/dao/system-settings.ts:25-155]` `[src: mission-control-db/src/dao/pilot-theme-store.ts:28-30]` `[src: MissionEngine/src/index.ts:52-61]`

### E.2.12 Scheduling tables (written by the engine's schedule tick)

The engine process runs the schedule tick every `SCHEDULE_TICK_MS` (default 5000) unless
`SCHEDULER_ENABLED=false`; it skips a tick while one is running. A tick processes ended runs,
catch-up, due slots, lost runs (at most once per 60 s), finished schedules and history, in that
order. `[src: MissionEngine/src/schedule-tick.ts:24-42]` `[src: mission-control-db/src/scheduling/tick.ts:29-46]`
Detailed scheduling semantics belong to the scheduling section; the persistence contract is:

| Table | Writer | Key facts |
|---|---|---|
| `master_schedule`, `master_schedule_item` | C | definitions; `source` CHECK `('commander','api')`; unique `(work_center_id, name)` and `(work_center_id, external_key)` `[src: mission-control-db/src/db/schema/schedules.ts:38-73]` |
| `runtime_schedule` | C (enable, controls), E (tick: `next_fire_at`, `missed_*`, `catchup_*`, `status`, `ended_at`) | `status` CHECK `('active','paused','cancelled','finished')`; label `RS-<runtime_number>` where `runtime_number = max(per work center)+1` under a `work_center` FOR UPDATE lock (no unique index); partial uniques: one live per master (not run-once), one per run-once request id, one live per `(work_center_id, external_key)` `[src: mission-control-db/src/db/schema/schedules.ts:76-124]` `[src: mission-control-db/src/scheduling/enable.ts:255-261]` |
| `runtime_schedule_item` | C | frozen items; `spec_jsonb` NULLed when the schedule ends; `workflow_id` soft link |
| `schedule_occurrence` | E | unique `(runtime_schedule_id, scheduled_at)` = once-only per slot; `origin` CHECK `('on_time','late','resume')` |
| `schedule_item_run` | E (C acknowledges) | unique `(occurrence_id, item_id)` = once-only per chain item; `status` CHECK `('started','finished','not_triggered','skipped_disabled','held','start_requested','cancelled','skipped_on_resume','failed_to_start','lost')`; `workflow_instance_id` soft link |
| `schedule_history` | E (C purges) | one row per completed pass; unique `(occurrence_id)` |
| `runtime_schedule_event` | C, E | append-only audit; `actor_kind` CHECK `('user','api_client','system')`; `action` values include `enabled, paused, resumed, cancelled, removed, finished, run_once, slot_fired, slots_missed, slot_already_recorded, catchup_finished, next_fire_realigned, items_acknowledged, master_created, master_updated, master_deleted` |
| `api_client` | C | REST credentials (token SHA-256 only) |
| `workflow_instance` | E (tick) | runs created via `createRuntimeWorkflow(triggeredBy='schedule', start=true)`, with `schedule_item_run_id` and `schedule_label` |

---

## E.3 The `engine_state` document (`workflow_instance.engine_state`)

A plain-JSON object written whole by every engine `persist()` together with `property_store`
and `updated_at` (`updated_at = deps.now()`); `resources` is replaced at write time by the local
(workflow-scoped) resource manager's serialization, never the environment tier.
`[src: MissionEngine/src/core/engine-state.ts:38-362]` `[src: MissionEngine/src/core/context.ts:682-690]`

Load semantics (normative, `loadEngineState`): a column that is NULL or not a JSON object yields
the full default document; otherwise each key is taken as stored when it is present and not
`null`, and defaulted when it is absent OR `null` (JavaScript `??`). Values are NOT
shape-validated on load. `operatorCleanup`: any truthy value is kept with `pendingAborts`
defaulted to `[]`; a falsy one becomes `null`. Keys not in the list below (e.g. `startAttempts`)
are dropped on load and therefore disappear at the next `persist()`. JSON key order is not
significant anywhere; consumers never depend on it.
`[src: MissionEngine/src/core/engine-state.ts:325-362]`

| Key | Type | Default | Read outside the engine? |
|---|---|---|---|
| `orderCounters` | `{ [specOid]: number }` — last `order_index` issued per owning spec (key `__unknown__` if a context has no spec) | `{}` | |
| `routingContext` | `{ [stepOid]: RoutingResult }` | `{}` | |
| `waitAll` | `{ [stepOid]: { expected: string[], completed: string[] } }` | `{}` | |
| `activeCatches` | `{ [key]: CatchContext }` | `{}` | |
| `resources` | `SerializedResources \| null` (`{ resources: [name, state][], pendingGrants, syncMatchedData, pendingNamedAssignments }`) — workflow-scoped pools only, never the shared tier | `null` | Commander shared-state pane `[src: mission-control-db/src/dao/shared-state.ts:343-358]` |
| `stepSnapshots` | `{ [stepOid]: { inputParameters: {..}, outputParameters?: {..} } }` | `{}` | Pilot inbox (task-document substitution) `[src: mission-control-db/src/runtime/inbox.ts:212-220]` |
| `childActive` | `{ [proxyStepOid]: childSpecOid }` | `{}` | Commander live states `[src: mission-control-db/src/dao/runtime-workflows.ts:580]` |
| `childProperties` | `{ [childSpecOid]: { key: value } }` | `{}` | Commander shared-state pane `[src: mission-control-db/src/dao/shared-state.ts:442]` |
| `blockedOnResources` | `{ [stepOid]: PendingResourceState }` | `{}` | |
| `deferredRouting` | `string[]` | `[]` | |
| `deferredFailures` | `{ stepOid, mode, message }[]` | `[]` | |
| `pausedAt` | `{ [stepOid]: epochMs }` | `{}` | |
| `stoppedActions` | `string[]` | `[]` | |
| `controlPassAttempts` | number | 0 | |
| `userActionCounter` | number | 0 | |
| `releasedOnCatch` | `{ [stepOid]: true }` | `{}` | |
| `resolvedAmounts` | `{ [stepOid]: { [cmdKey]: number } }` | `{}` | |
| `armedGates` | `{ [gateOid]: { predecessorOid, open, stopSent } }` | `{}` | Commander live detail, Pilot inbox `[src: mission-control-db/src/dao/runtime-workflows.ts:339-343]` `[src: mission-control-db/src/runtime/inbox.ts:256]` |
| `scriptRuns` | `{ [stepOid]: { state, pendingOutputs } }` | `{}` | |
| `envHolds` | `{ name, stepOid, amount, heldName }[]` | `[]` | (the holder table is what others read) |
| `envHoldsRevoked` | same shape | `[]` | |
| `pausingSince` | epochMs \| null | `null` | |
| `pauseUndeliveredWarned`, `pauseUnreachableWarned`, `pauseRefused`, `pollWarned` | `string[]` | `[]` | |
| `pollFailingSince` | `{ [stepOid]: epochMs }` | `{}` | |
| `operatorCleanup` | `{ kind: 'stop'\|'abort', phase: 'halting'\|'cleanup', catchOid, haltStartedAt (ISO), cleanupStartedAt (ISO\|null), inheritedHolds: string[], inheritedUse: {..}, abortPending: string[], pendingAborts: { stepRowId, serverUri, actionInstanceId, queuedAt (ISO) }[] } \| null` | `null` | engine claim SQL reads `{operatorCleanup,kind}` and `{operatorCleanup,phase}` `[src: MissionEngine/src/loop.ts:272-274]` |
| `backFrom` | `{ [stepOid]: stepOid \| null }` | `{}` | Pilot inbox (`backAvailable`) `[src: mission-control-db/src/runtime/inbox.ts:323-345]` |
| `lastFormValues` | `{ [stepOid]: {..} }` | `{}` | |
| `backPrefill` | `{ [stepOid]: {..} }` | `{}` | Pilot inbox (`prefillValues`) |
| `startAttempts` | number | (absent) | written only by the start-retry path; not part of the loaded shape |

Sub-shapes (all field names exact, camelCase unless shown otherwise) `[src: MissionEngine/src/spec/types.ts:320-349,424-434,530-569]` `[src: MissionEngine/src/core/resources.ts:32,96-166]` `[src: mission-control-db/src/runtime/wc-resources.ts:40]` `[src: MissionEngine/src/core/step-handlers.ts:288]`:

| Type | Shape |
|---|---|
| `RoutingResult` | `{ conditionValue?: string, connectionId?: string, sourceHandleId?: string, excludeUnconditional?: boolean }` |
| `CatchContext` | `{ catch_oid, trigger_step_oid, trigger_step_name, trigger_reason, error_message: string\|null, activated_at: string }` (snake_case); `trigger_reason` ∈ `ERROR`, `ABORT`, `TIMEOUT`, `OPERATOR_STOP`, `OPERATOR_ABORT` |
| `DeferredFailure` | `{ stepOid, mode: 'ERROR'\|'ABORT'\|'TIMEOUT', message }` |
| `PendingResourceState` | `{ stepOid, blockedOn?: { resource_name, command_type }, remainingCommands: ResourceCommandSpecification[], completionCommands: ResourceCommandSpecification[] }` (commands verbatim from the recipe) |
| `EnvHold` | `{ name, stepOid, amount: integer, heldName: string\|null }` (= a `wc_resource_holder` row without id/instance) |
| `SerializedResources` | `{ resources: [resourceKey, state][], pendingGrants: { stepOid, resourceKey }[], syncMatchedData: [string, string][], pendingNamedAssignments: [string, string][] }`; `state.type` is the resource-type string and carries `ownerId`, `scope` (`workflow`\|`environment`), `resourceKey`, plus: binary exclusive `inUse` (0\|1), `queue: stepOid[]`; binary shared `inUse`, `useLimit`, `queue: stepOid[]`; countable `inUse`, `useLimit`, `queue: { stepOid, amount }[]`; named pool `available: string[]`, `originalNames: string[]`, `queue: stepOid[]`; sync `sendQueue: { stepOid, data }[]`, `receiveQueue: string[]`, `pendingSync: string[]` |
| `scriptRuns[x]` | `{ state: <any JSON, ≤ 64 KB>, pendingOutputs: { [name]: string\|null } }` |
| `operatorCleanup.inheritedUse` | `{ [stepOid]: resourceKey[] }` |

Arrays in the document that represent queues (`queue`, `sendQueue`, `deferredRouting`,
`deferredFailures`, `envHolds`) are ORDERED and their order is significant; the `{ }` maps are
unordered.

A drop-in implementation MUST keep the keys marked "read outside the engine" in exactly this
shape, because Commander, XO and the Pilot inbox read them straight from the column. The rest
may be engine-private, but `operatorCleanup.kind`/`.phase` are queried in SQL by the claim.

Partial in-place updates (`jsonb_set`) occur for `envHoldsRevoked` (cleared to `[]`),
`operatorCleanup` (whole object) and `operatorCleanup.pendingAborts`.
`[src: MissionEngine/src/core/context.ts:1176-1182,1203-1207]` `[src: MissionEngine/src/core/operator-cleanup-flow.ts:327-339]`

---

## E.4 Transactions, locking and notifications

### E.4.1 Locking protocol (normative)

1. **One unit of work = one transaction that first claims ONE `workflow_instance` row** with
   `SELECT id FROM workflow_instance WHERE <filter> ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED`
   (or `WHERE id = $1 FOR UPDATE SKIP LOCKED` for a known instance). N engine replicas therefore
   never double-claim. `step_instance` rows of a claimed instance are never locked separately.
   `[src: MissionEngine/src/loop.ts:44-81]`
2. **Global lock order**: instance row → `wc_resource` rows of the instance's own work center,
   locked `FOR UPDATE` **ordered by name ascending**, restricted to the names the frozen recipe
   references (plus any legacy holds). Waiter rows are read without a lock (the parent row lock
   serializes all writers). `[src: mission-control-db/src/runtime/wc-resources.ts:56-97]` `[src: MissionEngine/src/core/context.ts:730-736]`
3. An operator verb on the shared registry takes ONLY the registry locks; it MUST NOT lock any
   instance row and MUST NOT insert into an FK child of `workflow_instance` in that transaction
   (an FK insert takes `FOR KEY SHARE` on the parent row) — its trace rows go in a later
   transaction. `[src: MissionEngine/src/core/operator-verbs.ts:128-160]`
4. `instance_assignment` rows that operator routes mutate are locked with `SELECT ... FOR UPDATE`
   inside the engine's submit and Back transactions (after the instance row). The claim/release
   routes themselves only use a guarded `UPDATE ... WHERE status=...` with no instance lock; the
   live-per-step unique index arbitrates races. `[src: MissionEngine/src/core/submit.ts:140-153]` `[src: MissionEngine/src/core/go-back.ts:53]` `[src: mission-control-db/src/runtime/assignments.ts:346-351]`
5. **No network call inside a claim transaction.** Commands decided by a pass are sent after
   commit; an action invoke is made outside any transaction and recorded afterwards in a new
   claim transaction that re-checks `action_instance_id IS NULL` and the step state; a lost race
   deletes the orphaned remote instance. `[src: MissionEngine/src/core/control.ts:28-33]` `[src: MissionEngine/src/loop.ts:442-475]`
6. Shared values are read without locks and written by plain UPDATEs (row lock taken by the
   UPDATE itself). `[src: mission-control-db/src/runtime/wc-value-properties.ts:26-46]`

Other row locks taken in the shared database (a drop-in engine MUST interoperate with them):

| Where | Lock |
|---|---|
| `createRuntimeWorkflow` | `workflow` row `FOR SHARE`, then `work_center` row `FOR UPDATE` (label allocation) `[src: mission-control-db/src/dao/runtime-workflows.ts:83-97]` `[src: mission-control-db/src/dao/work-centers.ts:121-127]` |
| Draft reload / `deleteWorkflow` | `workflow` row `FOR UPDATE` `[src: mission-control-db/src/dao/workflows.ts:44]` |
| `deleteWorkCenter` | that WC's `workflow` rows `FOR UPDATE` (id order), `work_center` `FOR UPDATE`, every `workflow_instance` of the WC `FOR UPDATE` (engine claimers skip them) `[src: mission-control-db/src/dao/work-centers.ts:423-446]` |
| Stop/Abort/skip requests | instance row `FOR UPDATE` (blocking) `[src: mission-control-db/src/dao/runtime-control.ts:62-63]` |
| `clearPendingAborts` | instance row `FOR UPDATE` (blocking), also on terminal rows `[src: MissionEngine/src/core/operator-cleanup-flow.ts:327-339]` |
| schedule tick | `runtime_schedule` rows `FOR UPDATE SKIP LOCKED` / `FOR SHARE`; `schedule_item_run` `FOR UPDATE SKIP LOCKED`; `schedule_history` scan `FOR NO KEY UPDATE SKIP LOCKED`; workflow rows `FOR SHARE` in id order before the WC row `[src: mission-control-db/src/scheduling/fire.ts:70-78,200,235]` `[src: mission-control-db/src/scheduling/chain.ts:84,126,176,239]` `[src: mission-control-db/src/scheduling/history.ts:55]` |
| History purge | `REPEATABLE READ` transaction `[src: mission-control-db/src/dao/runtime-history.ts:258-291]` |

**Advisory locks.** The engine takes none. Commander uses transaction-scoped advisory locks
`pg_advisory_xact_lock(91001)` (work-center reparent cycle guard) and `91002` (last-administrator
guard); a drop-in engine MUST NOT use these keys. `[src: mission-control-db/src/dao/work-centers.ts:329]` `[src: mission-control-db/src/dao/access.ts:110,129]`

### E.4.2 Claim queries per unit of work

Each worker slot (default `ENGINE_WORKER_CONCURRENCY=4`) loops: try the units below in order,
stop at the first that did work; when none did, wait for a wake or 1 s. `[src: MissionEngine/src/loop.ts:694-788,815-855]` `[src: MissionEngine/src/config.ts:159]`

| # | Unit | Claim |
|---|---|---|
| 0 | finalize orphaned cleanup actions | NO claim lock: an unlocked scan `SELECT id, engine_state #> '{operatorCleanup,pendingAborts}' FROM workflow_instance WHERE that path IS NOT NULL AND <> '[]'` (any status, settled rows included), run only while a per-process "maybe pending" flag is set (set at process start and whenever a cleanup end queues entries; cleared by an empty scan more than 10 s after the last queuing; retry scans spaced 2 s, settle scans 250 ms). An entry is skipped while a non-terminal step row of a non-terminal run still names its `action_instance_id` (dropped after 60 s), else ABORT then DELETE is sent and the entry removed by `clearPendingAborts`. Ages use the host wall clock (`Date.now()`), not `deps.now()`. Two replicas may both send the ABORT (a repeat is answered 409 and is harmless). `[src: MissionEngine/src/core/operator-cleanup-flow.ts:204-325]` |
| 1 | start a queued run | one statement: `UPDATE workflow_instance SET status='running', started_at=now(), updated_at=now() WHERE id IN (SELECT id FROM workflow_instance WHERE status='queued' ORDER BY queued_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, work_center_id, runtime_number, spec_jsonb, starting_params, master_name, master_oid, master_version, master_state`, then the instance start, in the SAME transaction `[src: mission-control-db/src/runtime/engine-access.ts:55-72]` |
| 2 | advance one READY step | `buildClaimInstanceQuery`: status in running-like (`running, stopping_cleanup, aborting_cleanup`) AND `EXISTS (SELECT 1 FROM step_instance si WHERE si.workflow_instance_id = workflow_instance.id AND si.state='READY')`, `ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED` `[src: MissionEngine/src/loop.ts:44-53]` `[src: MissionEngine/src/core/operator-cleanup.ts:29]` |
| 3 | due action invoke/poll/timeout | candidates `step_instance.wake_at <= now AND state IN ('WAITING_ACTION','PAUSED') AND step_type <> 'GATE'`; instance status in `running, stopping_cleanup, aborting_cleanup, paused, pausing, stopping, aborting` (aborting only during an Operator Abort halt); on the invoke branch `wake_at` is pushed forward by `INVOKE_GRACE_SECS` (default 60) before commit `[src: MissionEngine/src/loop.ts:255-334]` |
| 4 | due GATE / repeating SCRIPT | candidates `state IN ('WAITING_GATE','WAITING_SCRIPT') AND wake_at <= deps.now()`; claim among those instances with status running-like `[src: MissionEngine/src/core/gate.ts:241,261-273]` |
| 5 | due property acquisition | candidates `state='WAITING_PROPERTIES' AND wake_at <= deps.now()`; claim with status running-like `[src: MissionEngine/src/core/input-bindings.ts:49-59]` |
| 6 | control pass | first retries the in-memory undelivered-command undos, then claims status in `('pausing','resuming','stopping','aborting')` `[src: MissionEngine/src/core/control.ts:66,911-977]` |
| — | retention sweep | own timer: first run after 5 s, then every 30 s (§E.6.4) |

Head-of-line guards `[src: MissionEngine/src/loop.ts:89-216,317-325,694-778]`:

- A claim that finds nothing to do on the claimed instance bumps its `updated_at` (so the
  `ORDER BY updated_at` claim moves on to other instances).
- Units 2–5: a transaction that throws after claiming is rolled back and followed by a separate
  recovery transaction (`settleFailedInstance`): re-claim by id (SKIP LOCKED; give up if busy or
  gone); only if the status is still running-like: ERRORED trace with the message, `failed`
  step_runs for active rows, queue live cleanup actions, persist, bulk-set every non-terminal step
  row `ERRORED` (`error`=message), `settleTerminal('errored', from=<current status>)`, reconcile.
- Unit 1 (start): only a throw tagged `StartRecoveryFailedError` (the instance start's own inline
  recovery failed) gets `recoverFailedStart`: re-claim by id; only if still `queued`:
  `attempts = engine_state.startAttempts + 1`; if `attempts >= MAX_START_ATTEMPTS (3)` → ERRORED
  trace `<message> (after <n> failed start attempts)` and `settleTerminal('errored', from='queued')`;
  otherwise write `engine_state = {...old, startAttempts: attempts}`, `queued_at = updated_at =
  deps.now()` (rotate to the back). So the first two such failures rotate, the third settles.
  Any OTHER throw escaping the acquire+start transaction just rolls it back (the row returns to
  `queued` with its old `queued_at`) and is logged — it gets no rotation and will be picked first
  again on the next cycle.

Every transaction that claimed an instance row MUST end by reconciling that instance's
assignments (§E.2.3) and, if anything changed, `NOTIFY operator_change, '<work_center_id>'`.
`[src: MissionEngine/src/core/reconcile.ts:21-30]`

### E.4.3 Writes made without the instance lock

| Write | Guard |
|---|---|
| operator claim / release / commander assign / force-release | guarded `UPDATE ... WHERE status=...` + live unique index |
| `sweepSoleCandidateClaims` after presence changes and releases | guarded `UPDATE ... WHERE status='offered'` |
| `markGatesDue` (property event) | `UPDATE step_instance SET wake_at=now, updated_at=now WHERE id IN (...) AND state IN ('WAITING_GATE','WAITING_SCRIPT') AND wake_at IS NOT NULL AND wake_at > now` — only ever moves `wake_at` earlier `[src: MissionEngine/src/core/property-watch.ts:136-149]` |
| failed e-signature row | plain INSERT (no FK) |
| control requests | instance row `FOR UPDATE` (blocking) |

### E.4.4 LISTEN / NOTIFY

Every listener uses its own dedicated connection (never a pooled one), and reconnects with a flat
5 s back-off on error/close. Channel names are fixed constants. A NOTIFY issued inside a
transaction is delivered only on commit. `[src: MissionEngine/src/wake.ts:16-84]`

| Channel | Payload | Sent by | Listened by | Effect |
|---|---|---|---|---|
| `engine_wake` | `TG_TABLE_NAME` (`workflow_instance` or `step_instance`) — ignored | DB triggers: `workflow_instance` AFTER INSERT OR UPDATE OF `status`; `step_instance` AFTER UPDATE OF `state`; both FOR EACH STATEMENT, function `engine_wake_notify()` = `PERFORM pg_notify('engine_wake', TG_TABLE_NAME); RETURN NULL;` | engine (wakes all idle slots), Mission Broker | `[src: mission-control-db/drizzle/0018_mission_engine.sql:23-30]` `[src: MissionEngine/src/index.ts:114]` `[src: MissionBroker/src/index.ts:50-66]` |
| `operator_change` | work center id (uuid text) | engine (reconcile, claim/release/assign/force-release, sign-out, presence sweeps, Back claim, timed-gate list changes, Pilot Stop) | engine (every replica relays to its Pilot SSE clients of that WC) | `[src: MissionEngine/src/core/reconcile.ts:19-37]` `[src: MissionEngine/src/index.ts:115]` |
| `wc_resource_grant` | instance id of the waiter granted / holder changed — ignored | engine (registry write-back, operator verbs) | engine (wake all idle slots) | `[src: mission-control-db/src/runtime/wc-resources.ts:21-25]` `[src: MissionEngine/src/index.ts:127]` |
| `pilot_theme` | new `pilot_theme_rev` as decimal string | Commander (same transaction as a theme save) | engine (SSE `theme` event when the payload is a safe integer) | `[src: mission-control-db/src/dao/pilot-theme-store.ts:43-57]` `[src: MissionEngine/src/index.ts:118-121]` |

Mission Broker's own `engine_wake` listener reconnects after 2 s (not 5 s) and runs one wait-check
tick immediately after every (re)connect, so wakes missed while disconnected are recovered.
`operator_change` NOTIFYs are also sent outside transactions (autocommit `pg_notify`) by the
sign-out and presence paths; every sender in the engine process additionally pushes the event to
its own SSE hub directly. `[src: MissionBroker/src/index.ts:50-66]` `[src: MissionEngine/src/api/app.ts:64-66,96-100]`

NOTIFY is a latency optimization only: every engine unit is also found by polling (1 s idle wait),
so a lost notification delays but never loses work. Pilot's inbox likewise re-polls every 10 s
besides its SSE stream, so a lost `operator_change` delays an inbox refresh by at most ~10 s; a
lost `pilot_theme` delays the theme until the next theme event or a reload.
`[src: MissionPilot/src/inbox-data.ts:19,146-172]`

### E.4.5 Outbox / deferred-work mechanisms

| Mechanism | Durable? | Where |
|---|---|---|
| Operator-cleanup ABORT+DELETE owed for torn-down actions | yes: `engine_state.operatorCleanup.pendingAborts`, written in the teardown transaction, drained after commit by unit 0, cleared under a blocking row lock | `[src: MissionEngine/src/core/engine-state.ts:300-320]` `[src: MissionEngine/src/core/operator-cleanup-flow.ts:260-339]` |
| Undo of an undelivered PAUSE/STOP whose instance was busy | **no**: in-memory queue retried every control pass; an engine restart can lose one undo (accepted) | `[src: MissionEngine/src/core/send-failure.ts:26-28,68-75]` |
| Cross-instance resource grant | yes: `wc_resource_waiter.granted=true` row, consumed at the target instance's next context open; plus `wc_resource_grant` NOTIFY | `[src: mission-control-db/src/db/schema/work-center-runtime.ts:103-108]` |
| Deferred routing / failures while paused | yes: `engine_state.deferredRouting` / `deferredFailures` | |
| Action invoke re-try after a crash | yes: `wake_at` pushed `INVOKE_GRACE_SECS` ahead before the network call; still-NULL `action_instance_id` after that is re-invoked | `[src: MissionEngine/src/loop.ts:326-333]` |

---

## E.5 Runtime ID format (migrations 0035/0036) and label generation

Columns: `work_center.next_runtime_number int NOT NULL DEFAULT 1` (never restarts),
`work_center.runtime_id_template text NULL` (NULL/blank = built-in `RW-{SEQ}`),
`work_center.runtime_seq_bucket text NULL`, `work_center.runtime_seq_next int NOT NULL DEFAULT 1`;
frozen `runtime_label text NOT NULL` on `workflow_instance`, `runtime_history`, `step_signature`
(and `step_run`). Migration 0035 backfilled labels to `'RW-' || runtime_number` and set
`runtime_seq_next = next_runtime_number`, `runtime_seq_bucket = ''`. `[src: mission-control-db/drizzle/0035_runtime_id_format.sql]` `[src: mission-control-db/src/db/schema/work-centers.ts:23-54]`

**Allocation** (`allocateRuntimeIdentity`, inside the run-creating transaction, after the
`workflow` FOR SHARE lock) `[src: mission-control-db/src/dao/work-centers.ts:115-236]`:

1. `SELECT runtime_seq_bucket, runtime_seq_next, name, runtime_id_template, next_runtime_number FROM work_center WHERE id=$1 FOR UPDATE`; missing → `WORK_CENTER_NOT_FOUND`.
2. `runtime_number = next_runtime_number`.
3. `bucket = runtimeIdBucket(template, now, tz)` where `tz` = `system_settings.runtime_id_timezone`
   if valid, else the server zone (the work center's own `time_zone` column is for schedules
   only). `baseSeq = (coalesce(runtime_seq_bucket,'') = bucket) ? runtime_seq_next : 1`.
   "Valid zone" = accepted by the platform's IANA zone database; server zone = the host's
   default zone, else `UTC`. `[src: mission-control-db/src/dao/system-settings.ts:116-128]`
   `now` is the creating process's wall clock (`new Date()`), not `deps.now()` and not SQL `now()`.
   `[src: mission-control-db/src/dao/runtime-workflows.ts:94-97]`
4. If `validateRuntimeIdTemplate(template ?? '', { workCenterName })` fails: label
   `RW-<runtime_number>`, `nextSeq = baseSeq` (so 1 after a bucket change, else unchanged), and a
   warning is logged. The bucket is still written in step 6.
5. Else probe `seq = baseSeq, baseSeq+1, ...` for at most 1000 candidates: render the candidate
   and accept it when no row in `workflow_instance` NOR `runtime_history` has
   `(work_center_id, runtime_label) = (wc, candidate)` (exact, case-sensitive text equality).
   On success `nextSeq = seq+1`; if all 1000 are taken, label `<candidate for baseSeq+999>-<runtime_number>`
   and `nextSeq = baseSeq+1000` (the first value never probed).
6. `UPDATE work_center SET next_runtime_number = next_runtime_number + 1, runtime_seq_next = <nextSeq>, runtime_seq_bucket = <bucket>, updated_at = now() WHERE id=$1 RETURNING next_runtime_number - 1`
   (the returned value is the `runtime_number`; zero rows → `WORK_CENTER_NOT_FOUND`).

All of steps 1–6 and the `workflow_instance` INSERT are ONE transaction; the `work_center` row lock
is what serializes concurrent creators in one work center (the probe sees no uncommitted label).
`createRuntimeWorkflow` raises `RUNTIME_MASTER_NOT_FOUND` when the master row is missing.
`[src: mission-control-db/src/dao/runtime-workflows.ts:81-125]`

**Rendering** `[src: mission-control-db/src/lib/runtime-id.ts:19-106]`:

- The template is first trimmed (leading/trailing whitespace); NULL or blank → `RW-{SEQ}`.
- Tokens (names case-sensitive: `MM` = month, `mm` = minute): `{YYYY}` (4-digit year), `{YY}`
  (its last two characters), `{MM} {DD} {HH} {mm} {ss}` (always two digits), all in the chosen zone
  on the Gregorian calendar, 24-hour clock with hour `24` rendered `00`;
  `{WC}` = work-center name upper-cased (JavaScript `toUpperCase`, full Unicode mapping), every run
  of characters outside `[A-Z0-9]` replaced by one `-`, leading/trailing `-` removed, cut to the
  first 24 characters, leading/trailing `-` removed again, empty → `WC`;
  `{SEQ}` = decimal sequence, `{SEQ:n}` = left-padded with `0` to at least n digits (never
  truncated). Token regex `\{([A-Za-z]+)(?::(\d))?\}` (the width is ONE digit, so `{SEQ:10}` is
  not a token); an unknown token renders as itself. An unknown zone falls back to UTC.
- The bucket is the concatenation of the rendered date/time tokens only, in order of appearance
  (no separators; `''` for the default template); `{SEQ}` restarts at 1 exactly when the bucket
  string changes.

**Validation** (Commander on save; the allocator before use) `[src: mission-control-db/src/lib/runtime-id.ts:108-175]`:
checks run on the trimmed template, in this order, first failure wins (exact reason strings):

1. blank → valid.
2. length > 64 → `Format must be 64 characters or fewer`.
3. for each token in order: unknown name → `Unknown token {<name>}`; a `{WC}`/`{SEQ}` pair
   (either order, consecutive tokens) whose literal gap is empty or starts with `0-9` →
   `{WC} and {SEQ} must be separated by a character that is not a digit`; `{SEQ:n}` with n < 1
   (n > 9 cannot match) → `{SEQ:n} width must be between 1 and 9`; width on another token →
   `{<name>} does not take a width`.
4. no `{SEQ}` → `Format must contain {SEQ} — it is what keeps IDs unique`; more than one →
   `Format must contain {SEQ} exactly once`.
5. the concatenated literal text (everything outside tokens) must match `^[A-Za-z0-9 \-_./#:()]*$`
   (so any stray `{` or `}` fails) → `Text may use letters, digits, space and - _ . / # : ( ) only`.
6. render with the current time, zone `UTC`, the work-center name and `seq=999999`; length > 96
   → `Format renders <n> characters; the limit is 96`.

Lengths are JavaScript string lengths (UTF-16 code units).

Runtime Schedule labels are `RS-<n>` (§E.2.12).

---

## E.6 Record keeping and audit requirements

### E.6.1 Terminal settle (atomic)

`settleTerminal(status, finalState, from='running')` MUST, in ONE transaction:
`[src: MissionEngine/src/core/context.ts:1246-1363]`

1. Redirect while `engine_state.operatorCleanup.phase = 'cleanup'` (kind K; FINAL = `stopped`/`aborted`,
   CLEANUP = `stopping_cleanup`/`aborting_cleanup`, HALT = `stopping`/`aborting`):
   - if `status ≠ FINAL[K]` and `from ∈ {running, CLEANUP[K], HALT[K]}`: `status = finalState = FINAL[K]`;
     `from` becomes `CLEANUP[K]` unless it was `HALT[K]` (the skip's re-halt keeps it); cleanup ended;
   - else if `from = 'running'`: `from = CLEANUP[K]`; cleanup ended;
   - otherwise no change. (Default `reason` = `step failed`.)
2. `UPDATE workflow_instance SET status, final_state, completed_at=at, updated_at=at WHERE id=$1 AND status=<from> RETURNING ...`
   with `at = deps.now()`. Zero rows → return (first terminal wins; nothing else is written).
3. If a cleanup ended: an instance-level `OPERATOR` trace `Operator Stop cleanup ended: <reason>` /
   `Operator Abort cleanup ended: <reason>`, and every non-terminal step row with an action
   instance is queued into `pendingAborts` (written with `jsonb_set` in this transaction).
4. Environment tier (only if the run hydrated it): delete ALL of the run's waiter rows (queued and
   granted-unconsumed); give back each unconsumed grant to the pool; re-run the FIFO grant pass for
   every touched resource (which may grant other runs' waiters → `wc_resource_grant` NOTIFY);
   write counters/waiters back and re-write this run's holder rows unchanged (holders stay);
   apply pending foreign releases; if `envHoldsRevoked` is non-empty, `jsonb_set` it to `[]`.
5. Record `cancelled` step_runs for every still-active row (rows keep their states).
6. Starter = `start_requested_by ?? created_by`; its `login_name` is looked up; read the work
   center name; read all trace rows ordered by `id` and assemble them (§E.6.2).
7. Insert the `runtime_history` row (§E.2.5) `ON CONFLICT (workflow_instance_id) DO NOTHING`, with
   `properties` and `step_params` taken from the in-memory context (persisted or not).

`settleTerminal` itself does NOT reconcile assignments: every caller is inside a claim transaction
whose tail reconcile closes the live assignments (their steps are no longer `WAITING_USER`/`PAUSED`
— except rows a settle left active, whose offers stay live until the run is swept).
`[src: MissionEngine/src/core/context.ts:1119-1183,1246-1363]`

### E.6.2 History payload derivations

- `trace`: all `trace_entry` rows of the run, grouped by owning spec (derived from the step oid
  via the recipe tree; NULL-step rows and step oids not found in the tree belong to the root),
  each group sorted by `(order_index, id)` ascending; a WORKFLOW PROXY step is linked to the child
  spec of its owning spec whose `local_id` equals the proxy's `local_id`; that child's whole
  (recursively assembled) entry list is spliced immediately before the FIRST `COMPLETED` entry of
  the proxy step (once only); a child that has rows but no consumed `COMPLETED` is appended at the
  end of its parent's entries, several such children ordered by their smallest row id. Each entry
  is `{ "step_oid": <oid or "">, "state", "order": <order_index>, "timestamp": <epoch ms of at>, "after_action"?: n, "error"?: s }`
  (`after_action` omitted when NULL; `error` omitted when NULL or empty string).
  `[src: MissionEngine/src/core/trace-assembly.ts:68-143]`
- `outputs`: for each root `output_parameter_specifications[]` entry with a non-empty `id`:
  key = `target` if a non-empty string else `id`; value = exact key in the history property map,
  else (whole Value Property) JSON `[{"name","value"}]` of every `key.<entry>` except
  `Description` (case-insensitive), else `props[id]`, else `''`. `[src: mission-control-db/src/runtime/workflow-outputs.ts:18-54]`

### E.6.3 What must never be deleted or updated

| Table | Rule |
|---|---|
| `runtime_history` | Insert-once (unique per run). Never updated. Deleted ONLY by Commander's explicit history delete (refused with `HISTORY_RUN_PENDING` while a `schedule_item_run` for the run is still `started`) or the age-based purge (which skips such rows); either deletes the run's `step_signature`, `step_run` and `runtime_control_event` rows in the same transaction. `[src: mission-control-db/src/dao/runtime-history.ts:200-291]` |
| `step_run` | Append-only; never updated; deleted only with its history record. |
| `step_signature` | Append-only; the only permitted UPDATE is setting `superseded_at` (once) on `signed` rows when Back reopens that step; deleted only with its history record. |
| `runtime_control_event` | Append-only; deleted only with its history record. |
| `trace_entry` | Append-only while the run exists; deleted by cascade with the run (the permanent copy is `runtime_history.trace`). |
| `schedule_history`, `runtime_schedule_event` | Append-only; `schedule_history` removed only by the purge. |
| `workflow_instance.spec_jsonb`, `runtime_number`, `runtime_label`, `master_*`, `starting_params`, `created_by_*` | Immutable after insert. |

Record rows use soft links and frozen copies so that no delete of a run, master, user, role or
work center is ever blocked by, or cascades into, the audit record (user/role/work-center FKs on
record tables are `ON DELETE SET NULL`).

### E.6.4 Retention sweep

Every 30 s (first run 5 s after start), for each work center ordered by id, round-robin, batches of
500, at most 10 row-deleting batches per run:
`DELETE FROM workflow_instance WHERE id IN (SELECT id FROM workflow_instance WHERE work_center_id=$wc AND status IN ('completed','aborted','stopped','errored') AND completed_at < $cutoff AND NOT EXISTS (SELECT 1 FROM wc_resource_holder h WHERE h.instance_id = workflow_instance.id) ORDER BY completed_at LIMIT 500 FOR UPDATE SKIP LOCKED) RETURNING id`,
where `$cutoff = deps.now() - finished_retention_secs` (engine clock, not SQL `now()`; `deps.now()`
is read ONCE at the start of a sweep run; the comparison is strict `<`).
`[src: MissionEngine/src/core/sweep.ts:41-99]` `[src: MissionEngine/src/loop.ts:659-680]`

Exact scheduling of one run: read `SELECT id, finished_retention_secs FROM work_center ORDER BY id`;
`active` = all of them; while `active` is non-empty and fewer than 10 row-deleting batches ran:
for each work center in `active` (stopping when the budget is used up) execute the DELETE above;
a DELETE that removed ≥ 1 row counts as one batch; a work center whose DELETE removed exactly
500 rows stays in the next round, the others drop out. Each DELETE is its own autocommit
statement (no surrounding transaction). A sweep tick is skipped while the previous one is still
running; failures are logged once per distinct message. Rows locked by anyone else are skipped,
never waited on. Deleting a run cascades its step rows, assignments, trace rows, waiters (and
holders, which by the predicate do not exist).

---

## E.7 Tables Commander writes and the engine only reads

All reads below are performed by the engine process (including the `mission-control-db` DAOs it
calls). Columns not listed are not read.

| Table | Columns the engine reads | Purpose |
|---|---|---|
| `work_center` | `id, name, finished_retention_secs, dispatch_policy, auto_claim, pilot_theme, parent_work_center_id`, and (run creation by the schedule tick) `runtime_id_template, runtime_seq_bucket, runtime_seq_next, next_runtime_number` (also written there), `time_zone` (schedules) | settle, sweep, dispatch, theme chain, Pilot WC list, label allocation `[src: MissionEngine/src/core/context.ts:1337]` `[src: MissionEngine/src/core/sweep.ts:74-76]` `[src: mission-control-db/src/runtime/dispatch.ts:28-43]` |
| `work_center_user` | `work_center_id, user_id, priority` | membership checks, candidates, highest-priority dispatch, e-signature `SIGNATURE_NOT_MEMBER` `[src: MissionEngine/src/api/app.ts:55-61]` |
| `work_center_user_role` | `work_center_id, user_id, role_id` | role eligibility at claim/assign/auto-claim, e-signature role check |
| `role` | `id, name` | e-signature `roleName` lookup (exact name) `[src: MissionEngine/src/core/esignature.ts:118-126]` |
| `app_user` | `id, login_name, display_name, status` (+ better-auth fields) | login, disabled check (`status='disabled'`), signer lookup, step_run / history / control-event names |
| `account` | `user_id, provider_id, password` (provider `credential`) | e-signature password verification (better-auth scrypt) `[src: MissionEngine/src/core/esignature.ts:108-113]` |
| `session` | better-auth fields | **written** by the engine's own better-auth mount (sign-in creates rows, sign-out deletes them); cookie prefix `mission-engine`; sessions are refused for disabled users `[src: MissionEngine/src/api/auth.ts:45-80]` |
| `workflow` | `id, work_center_id, dispatch_policy, auto_claim, spec_jsonb` (diagram), plus `name, oid, version, state, spec_jsonb` when the schedule tick creates runs | dispatch/auto-claim overrides (`workflow.x ?? work_center.x`), master diagram |
| `workflow_node` | `id, workflow_id, node_oid` | allowed-role resolution |
| `workflow_allowed_role` | `workflow_id, workflow_node_id, role_id` | allowed roles of a step: walk the recipe node's master-oid chain, first master node with grants wins; none = unrestricted `[src: mission-control-db/src/runtime/assignments.ts:66-82]` |
| `workflow_image` | `workflow_id, filename, mime_type, data_base64` | `GET /api/instances/:instanceId/images/:filename` `[src: MissionEngine/src/api/app.ts:242-266]` |
| `work_center_environment_binding` | `work_center_id, environment_oid, server_uri` | action server URI for an environment |
| `brand_asset` | `id, mime, data_base64, width, height` | Pilot logos |
| `system_settings` | see §E.2.11 | |
| `runtime_schedule*`, `master_schedule*` | schedule tick | |

The engine never reads `environment_spec`, `workflow_environment`, `workflow_signature_role`,
`work_center_control_grant` or `broker_action_instance` (Broker owns the last two's use).

---

## E.8 Entity-relationship summary for a different store

```
WorkCenter 1──* RuntimeWorkflow 1──* StepRow 1──0..1 live Assignment (plus closed history rows)
     │               │  │  └──* TraceEntry                (deleted with the run)
     │               │  └──0..1 HistoryRecord ─┐          (soft link, permanent)
     │               ├──* StepRun ─────────────┤ soft links by run id
     │               ├──* SignatureAttempt ────┤
     │               └──* ControlEvent ────────┘
     ├──* SharedResource 1──* Waiter (FIFO by identity) ──> RuntimeWorkflow
     │                   1──* Holder ──> RuntimeWorkflow (blocks the run's sweep)
     ├──* SharedValue
     ├──* Presence <── User
     └── RuntimeSchedule 1──* Occurrence 1──* ItemRun ──soft──> RuntimeWorkflow
MasterWorkflow 1──* RuntimeWorkflow (frozen copy; master delete refused while unfinished runs exist)
User *──* WorkCenter (membership, priority) ; (User, WorkCenter) *──* Role
```

A standalone store MUST provide:

1. **Atomic multi-entity transactions** covering one run's row, its step rows, assignments, trace,
   step runs, signatures, history record and the locked shared-registry rows.
2. **Skip-locked exclusive claims** on runs ("take one unlocked candidate, oldest
   `updated_at`/`queued_at` first"), plus blocking exclusive locks for control requests.
3. **Ordered locks** on shared resources (by name ascending, after the run lock).
4. **Monotonic identities** for waiter FIFO order and trace tie-breaking.
5. **Uniqueness**: run number and label per work center; one live assignment per step row; one
   history record per run; one child run per creating-step activation; once-only schedule slots
   and chain items.
6. **Commit-time notifications** equivalent to the four channels in §E.4.4 (or polling at ≤ 1 s).
7. **Guarded conditional updates** (`UPDATE ... WHERE status = <expected>` reporting rows affected).
8. The record-keeping rules of §E.6 (append-only records with frozen copies that outlive every
   referenced entity).

The subsections below make these requirements concrete enough for an embedded store (e.g. SQLite
/ Room on Android). Where they name a PostgreSQL mechanism, it is the reference's choice; the
OBSERVABLE contract is what an implementation must reproduce.

### E.8.1 Deployment choices for a native engine

- **Remote shared PostgreSQL** (the engine runs on the device but talks to the existing
  database): this is drop-in mode (§E.2–§E.7) verbatim — same SQL semantics, same triggers,
  same LISTEN/NOTIFY, same lock order. Commander, Broker and other engine replicas keep working.
- **Local store only** (SQLite/Room, no other process shares it): standalone mode. Commander,
  XO and Broker cannot see the data unless the device exposes the REST/internal APIs; the
  database-level contract with them (§E.2.1.1 writers C/B, `engine_wake` to Broker,
  `pilot_theme` from Commander) then collapses into in-process calls. Everything else in this
  section still applies.
- Mixing (a local cache that is the source of truth for some runs while Postgres holds others)
  is NOT covered by the reference and is outside this contract.

### E.8.2 Required uniqueness (standalone)

All of these are enforced by the reference database and MUST be enforced by the store (SQLite
supports each as a UNIQUE or partial UNIQUE index, `CREATE UNIQUE INDEX ... WHERE ...`):

| Entity | Unique key | Reference |
|---|---|---|
| RuntimeWorkflow | `id`; `(work_center_id, runtime_number)`; `(work_center_id, runtime_label)`; `(created_by_step_instance_id, created_by_step_started_at)` where `created_by_step_instance_id` is not NULL | §E.2.1 |
| Assignment | `id`; `(step_instance_id)` where `status IN ('offered','claimed')` | §E.2.3 |
| HistoryRecord | `(workflow_instance_id)` (NULLs distinct); insert is "do nothing on conflict" | §E.2.5 |
| Presence | `(session_id)`; `(user_id, attending_work_center_id)` | §E.2.10 |
| SharedResource | `(work_center_id, name)`; SharedValue `(work_center_id, property_name, entry_name)` | §E.2.9 |
| Settings | `key` | §E.2.11 |
| Schedules | `(runtime_schedule_id, scheduled_at)`, `(occurrence_id, item_id)`, `schedule_history(occurrence_id)` and the partial uniques of §E.2.12 | §E.2.12 |

Uniqueness enforced ONLY by code (the store need not, but the engine MUST keep it): one StepRow
per `(workflow_instance_id, step_oid)` (§E.2.2); RuntimeSchedule `runtime_number` per work center
(allocated under the work-center lock). Deliberately NOT unique: `step_run` rows (a duplicate
write must never abort the transaction), trace rows, holder rows.

Identity columns (`trace_entry.id`, `wc_resource_waiter.id`, `wc_resource_holder.id`,
`runtime_control_event.id`) MUST be strictly increasing in commit order of insertion within one
store and never reused (SQLite: `INTEGER PRIMARY KEY AUTOINCREMENT`; a plain rowid may reuse the
highest id after a delete). Waiter FIFO and trace tie-breaks depend on this. UUIDs are canonical
lower-case 36-character text in the reference (PostgreSQL `uuid` output); store and compare them
in one canonical form.

### E.8.3 Atomicity units (which writes MUST commit together)

Each row below is ONE all-or-nothing transaction in the reference; a re-implementation MUST NOT
split it and MUST NOT merge separate rows into one where the reference keeps them apart (the
separation is what avoids lock-order inversions and keeps audit rows on failure paths).

| # | Unit | Writes that commit together |
|---|---|---|
| U1 | Create run | work-center counters (`next_runtime_number`, `runtime_seq_next`, `runtime_seq_bucket`) + the RuntimeWorkflow insert (`pending` or `queued`). Schedule-created runs: also the schedule bookkeeping of that tick step. |
| U2 | Start run | `queued→running` + `started_at` + every initial StepRow, trace row, step_run, engine_state/property_store, shared-tier writes, registry writes, assignment reconcile; or (invalid spec) ERRORED trace + terminal settle + history. |
| U3 | Any claimed unit of work (units 2–6 of §E.4.2, submit, Back, internal verbs that claim a run) | all StepRow inserts/updates/deletes (and the cascaded assignment deletes), trace rows with their step_run rows, `signed` signature rows, superseded-at updates, engine_state + property_store + `updated_at`, SharedValue updates, registry counters/waiters/holders of locked resources, terminal settle + HistoryRecord, the tail assignment reconcile, and the queued notifications. |
| U4 | Record an action invoke | `action_instance_id`, `action_server_uri`, `action_invoked_oid`, `started_at`, `wake_at` of one StepRow (a separate claim transaction AFTER the network call). |
| U5 | Control request (Stop/Abort/skip) | status (+`cleanup_skip`) + ControlEvent. Pause/Resume: the status only. |
| U6 | Operator claim / release / commander assign / force-release | the single Assignment update + the `operator_change` notification. Sign-out: the bulk release, then (separately) the presence delete, then per-WC sole-candidate sweeps, each its own statement. |
| U7 | Presence POST | delete of the user's conflicting rows + insert of the new row. |
| U8 | Failed e-signature | the single `failed` SignatureAttempt insert, committed even though the submit is refused. |
| U9 | Operator verb on a shared resource | counters + waiter deletes/grants + holder deletes (+ grant notifications); its OPERATOR trace rows in a LATER, separate transaction (best effort). |
| U10 | Retention sweep batch | one DELETE of ≤ 500 terminal runs (and their cascades). |
| U11 | History delete / purge | the HistoryRecord(s) + that run's SignatureAttempts, StepRuns and ControlEvents (purge: also schedule_history rows), one transaction; the purge additionally needs a stable snapshot (REPEATABLE READ) so every statement selects the same victims. |
| U12 | Start-failure rotation | `engine_state.startAttempts`, `queued_at`, `updated_at`. |
| U13 | `clearPendingAborts` | removal of the sent entries from `operatorCleanup.pendingAborts` (read-modify-write under the run's lock, keeping entries added since the scan). |

Network I/O (action-server calls, Broker calls) MUST NOT happen inside U2/U3/U4; commands a
transaction decides are sent only after it commits, and a rolled-back transaction sends nothing.

### E.8.4 Ordering guarantees

- **Trace order**: per owning spec, `order_index` (a counter in `engine_state.orderCounters`,
  committed atomically with the rows) then identity `id`. Wall-clock `at` is informational.
- **Waiter FIFO**: identity `id` ascending per `(work_center_id, name)`; a new waiter always
  queues behind every committed waiter.
- **Start order**: queued runs are started in ascending `queued_at`; ties (same transaction
  timestamp) are broken arbitrarily by the reference (schedule-created runs use per-statement
  timestamps precisely to avoid ties). A store with coarse timestamps SHOULD add a
  deterministic tie-breaker (e.g. insertion order) — this does not change any specified result.
- **Work fairness**: among eligible runs, the least recently updated (`updated_at` ascending) is
  claimed first; a claim that does nothing still bumps `updated_at`.
- **StepRun numbering**: `run_number = 1 + count of existing rows for (run, step_oid)` computed
  inside U3, so it is gap-free per step as long as U3 is serialized per run.
- **Reconcile last**: the assignment reconcile runs after every other write of U2/U3, so it
  sees the transaction's final step states.
- **Notifications after commit**: no observer may learn of a change before it is committed, and a
  rolled-back transaction emits nothing.
- Several due rows of one run: oldest `wake_at` first, then StepRow `id`.

### E.8.5 Replacing SKIP LOCKED and blocking row locks

Observable contract of the reference locking:

1. At most one unit of work (U2–U4, U12, U13) runs per RuntimeWorkflow at any instant, across all
   worker slots and all engine processes.
2. A worker looking for work never WAITS for a busy run: it skips it and takes the next eligible
   candidate in claim order (or reports "no work").
3. Control requests (Stop/Abort/skip) and `clearPendingAborts` DO wait for a busy run and then
   apply against the status it has after the in-flight unit committed.
4. Shared-resource rows are taken after the run, in ascending name order; operator verbs take
   only the resource rows (never a run), and never write a run's child rows in the same unit.
5. Claim/release/assign of assignments do not take the run; the live-assignment unique key plus
   `WHERE status = <expected>` decides races ("first writer wins", the loser sees 0 rows).

A single-process SQLite engine satisfies 1–3 with an in-memory per-run mutex table: claimers use
`tryLock(runId)` while iterating candidates in claim order (skip on failure), control requests
use a blocking `lock(runId)`; the database transaction runs while the mutex is held. Because
SQLite allows one writer at a time, write transactions SHOULD be `BEGIN IMMEDIATE` so a unit
never fails late on a lock upgrade; long work inside a transaction then blocks all other writers,
which is why rule "no network inside a transaction" is mandatory there too. Rule 4's deadlock
avoidance is automatic with a single writer but the order still matters if per-resource mutexes
are used. Several engine processes against one SQLite file are not supported by this contract.

### E.8.6 Replacing LISTEN/NOTIFY

Observable contract: (a) every notification is emitted only after its transaction commits and
is dropped on rollback; (b) a notification may be lost or duplicated without changing any
result, because every consumer also polls (engine slots every 1 s idle; Pilot inbox every
10 s; Broker on its own backstop); (c) payloads: `engine_wake` none (consumers ignore it),
`operator_change` = work-center id, `wc_resource_grant` = run id (ignored), `pilot_theme` =
decimal revision. A standalone implementation replaces them with an in-process event bus fed by
an after-commit hook (e.g. Room `InvalidationTracker` or a post-commit callback list per
transaction), with these minimum emitters:

| Event | Emit when (after commit) | Effect |
|---|---|---|
| wake | a RuntimeWorkflow is inserted or its status updated (any writer); a StepRow's state is updated (NOT on insert — the reference trigger fires only on `UPDATE OF state`, statement-level, even when the value is unchanged); a waiter is granted or a foreign holder row changes | wake all idle worker slots |
| operator_change(wc) | assignment reconcile changed something; claim/release/assign/force-release; presence change with sweep; Back claim; timed-gate list change; Pilot Stop | push a fresh inbox to that WC's live Pilot clients |
| theme(rev) | Pilot theme saved | Pilot clients refetch the theme |

Waking more often than the reference is harmless; waking less often only adds latency bounded by
the polling interval.

### E.8.7 Type and value mapping for a non-PostgreSQL store

| PostgreSQL | Contract a store must preserve |
|---|---|
| `uuid` | 128-bit id; text form lower-case `8-4-4-4-12` hex. Generated randomly (v4) where the default is `gen_random_uuid()`. |
| `timestamptz` | An absolute instant; at least millisecond precision; comparisons (`wake_at <= now`, `completed_at < cutoff`, `ORDER BY updated_at/queued_at`) are on the instant, never on local wall time. Store as UTC epoch milliseconds (INTEGER) or a fixed-width UTC ISO-8601 string — never mix the two in one column, or ordering breaks. Values crossing the wire use ISO-8601 with `Z` (JSON) or epoch ms (history `timestamp`). |
| `jsonb` | A JSON value. Key order is irrelevant; duplicate keys collapse (last wins in PostgreSQL); numbers are IEEE-754 doubles as read by the engine. In-place updates (`jsonb_set` of `envHoldsRevoked`, `operatorCleanup`, `operatorCleanup.pendingAborts`) can be done as read-modify-write of the whole document inside the same transaction and lock. The path read `engine_state #>> '{operatorCleanup,kind}'` (claim filter for `aborting`) needs either SQLite's `json_extract(engine_state,'$.operatorCleanup.kind')` or an in-memory filter. |
| `text` + CHECK | Exact, case-sensitive strings; equality is byte-wise (PostgreSQL deterministic collation); no locale folding anywhere in the contract except where a rule says "case-insensitive". |
| `integer` / `bigint identity` | 32-bit signed / 64-bit monotonically increasing. |
| `boolean` | true/false (SQLite 0/1). |
| ON DELETE CASCADE / SET NULL / RESTRICT | MUST be reproduced (SQLite needs `PRAGMA foreign_keys=ON`) or the equivalent deletes performed in the same transaction. In particular deleting a run MUST delete its StepRows, Assignments (through StepRows), TraceEntries, Waiters and Holders and MUST NOT touch the record tables. |

---

# Appendix X — Behaviour notes and open points

These are places where the reference implementation behaves surprisingly or where the code leaves a question open. See §0.4.

## X.A From Part 1 — Workflow JSON

1. **USER_INTERACTION conditions are dead over REST.** Pilot's submit never carries a button value,
   so every outgoing connection of a USER_INTERACTION fires regardless of `condition`; condition-based
   branching exists only in the conformance harness (`button_press`). [src: MissionEngine/src/api/app.ts:565-567; MissionEngine/src/core/step-handlers.ts:169-181]
2. **Unmatched SELECT 1 fires every branch.** No matching option and no default -> no routing context
   -> all outgoing connections fire (parallel-like, without a WAIT ALL). [src: MissionEngine/src/core/step-handlers.ts:129-134; MissionEngine/src/core/transition.ts:867]
3. **SELECT 1 `<`, `>`, `<=`, `>=` are string comparisons** (`"10" < "9"` is true). [src: MissionEngine/src/core/step-handlers.ts:141-144]
4. **YES_NO with no matching edge** completes and routes nowhere; the instance then never completes
   unless another branch reaches END. Unconditional edges never fire from a YES_NO answered "yes"/"no".
   [src: MissionEngine/src/core/transition.ts:874-887]
5. **Starting parameters leak into step inputs only in the start transaction.** `getInputParameters()`
   falls back to the in-memory starting-parameter map, which is never persisted. A SCRIPT/GATE/ACTION
   PROXY activated in the same transaction as START receives every starting parameter as an extra
   input (script local / action input); the same step activated later does not. A starting parameter
   whose id is not a JS identifier therefore breaks any SCRIPT/GATE in the start cascade (SyntaxError).
   [src: MissionEngine/src/core/properties.ts:233-245,277-286; MissionEngine/src/core/transition.ts:2385; MissionEngine/src/loop.ts:388-390]
6. **Script/GATE input ids must be JS identifiers** (they become `Function` parameter names); the
   validator does not check this — the step fails at runtime. Real Designer exports use ids with spaces
   on form steps (e.g. `"Radio Group Color"`), harmless there but fatal on a SCRIPT. [src: MissionEngine/src/core/step-handlers.ts:331-347]
7. **`form_layout_config: []` disables form_document capture** (empty array is truthy). [src: MissionEngine/src/core/step-handlers.ts:46-52]
8. **Graph validation ignores children.** A child without START/END, with dangling edges, a bad
   ACTION PROXY config, or a bad TRY passes validation; failures surface at runtime (e.g. the proxy
   parks forever). [src: MissionEngine/src/spec/validator.ts:81-171,477-528; MissionEngine/src/core/transition.ts:2637-2645]
9. **Child outputs read by id, not target.** The parent receives `childProps[output.id]`; a child
   whose output `target` differs from its `id` hands the parent `''` (while runtime history for a root
   uses the target). Designer defaults every output's `target` to its own name (`target || name`), so
   this bites only when the author sets a different target (e.g. `Batch.Status`). [src: MissionEngine/src/core/transition.ts:2711-2720; mission-control-db/src/runtime/workflow-outputs.ts:35-41; MissionDesigner/src/lib/packageFormat/parameter-extractors.ts:90-92]
10. **Schema type errors are reported as `MISSING_REQUIRED_FIELD`** with a bare ajv message and no
    path (e.g. `must be string`). [src: MissionEngine/src/spec/validator.ts:949]
11. **Warning codes are lost**: only `message` is written to the WARNING trace row. [src: MissionEngine/src/core/instance.ts:63-65]
12. **`validate(null)` throws** instead of returning invalid. [src: MissionEngine/src/spec/validator.ts:38-47]
13. **The ACTION PROXY rule uses the raw `step_type`** (`=== 'ACTION PROXY'`), while TRY/GATE rules
    normalise; harmless today because the schema rejects other spellings, but the order of checks means
    an `ACTION_PROXY` step fails with `INVALID_STEP_TYPE`, not `INVALID_VALIDATION`. [src: MissionEngine/src/spec/validator.ts:497]
14. **A CATCH without `catch_id`** is not a catch network, so it fails as `ORPHANED_STEP` rather than a
    TRY/CATCH code. [src: MissionEngine/src/spec/catch-network.ts:43; verified]
15. **`release_on_catch` default is true**, although `types.ts` marks it optional with no stated default. [src: MissionEngine/src/core/transition.ts:2078]
16. **`resolveDefault` / `resolveDefaultValue` (form `defaultSource`) have no production caller**; the
    engine never applies form defaults. [src: MissionEngine/src/core/properties.ts:24-36,196-206]
17. **Last `is_default` option wins** if several SELECT 1 options are marked default. [src: MissionEngine/src/core/step-handlers.ts:114-118]
18. **Empty `resource_source_oid` is not defaulted.** `""` does not fall back to the owning spec's oid
    (`??`), so the validator rejects it; Designer writes `""` for a resource it could not resolve. [src: MissionEngine/src/spec/validator.ts:603; MissionDesigner/src/lib/packageFormat/workflow-exporters.ts:334]
19. **Environment resource shape is unchecked.** `INVALID_RESOURCE_SPEC` covers only workflow-level
    resources; a malformed environment resource (named pool w/o names) validates. [src: MissionEngine/src/spec/validator.ts:672-700; verified]
20. **Missing form-element geometry is `MISSING_REQUIRED_FIELD`, not `INVALID_FORM_ELEMENT_TYPE`.** [verified; MissionEngine/src/spec/validator.ts:925-940]
21. **Designer exports `api_key` inside embedded environments' action servers**, so it lands in
    `spec_jsonb`; the engine never reads it. [src: MissionDesigner/src/lib/packageFormat/library-exporters.ts:231]

## X.C From Part 2 — Execution semantics

1. **USER_INTERACTION button routing is unreachable through the Pilot REST API.** The submit route
   only produces actions `submit` or `yes`/`no` (decision), never `button_press`
   [src: MissionEngine/src/api/app.ts:565-567]; a USER_INTERACTION `submit` sets no routing context,
   so ALL outgoing connections (conditioned or not) fire.
2. **WAIT ANY re-fires on every arrival** (a COMPLETED row is reset and re-completed, successors
   routed again). There is no "first arrival wins" latch.
3. **SELECT 1 with no matching option and no default routes ALL outgoing connections** (no routing
   context stored). Comparisons are lexicographic string comparisons (`"10" < "9"`).
4. **Zero routed connections strands the instance**: e.g. a YES_NO answer matching no handle or
   condition completes the step, routes nothing, and the instance stays `running` with no claimable
   work (no END completed, no non-terminal rows).
5. **A child that runs RETURN ABANDON, or hits a malformed RETURN, never completes**; its parent
   WORKFLOW PROXY stays `WAITING_ACTION` forever (faithful to the reference engine). Only an
   uncaught failure escalates.
6. **Starting parameters in input maps only during the start transaction**: `startingParameters` is
   in-memory and not persisted; `getInputParameters()` includes them as a fallback only within the
   transaction that initialised them (step-run input filtering compensates). Later transitions see
   them only as properties under their bare ids.
7. **Output snapshot keys differ by step type**: user steps key `stepSnapshots.outputParameters` by
   target (or id), SCRIPT/ACTION/CATCH-less paths key by spec id.
8. **Step oid uniqueness across children is assumed** (rows looked up by `step_oid` without
   `node_oid`), while a comment says "a child workflow used twice can repeat a step oid"
   [src: MissionEngine/src/core/engine-state.ts:268-270]; behaviour for duplicated oids is undefined.
9. **`started_at` at acquire uses the SQL clock** (`now()`), unlike the engine's `deps.now()` everywhere else.
10. **Stop without an `OPERATOR_STOP` row never drains a parked WAIT ALL**; only an Abort ends it.
11. **Paused submit accepts `resuming`** as a hold status, while a `fail` in any of
    paused/pausing/resuming is refused `NOT_RUNNING`; `stopping` refuses all submissions.
12. **Back requires status exactly `running`**, so Back is unavailable inside a cleanup network even
    though screens there are submittable.
13. **`yes_no_config` is never read by the engine** (labels, `yes_value`, `no_value`,
    `default_selection` are client-side only).
14. **Runtime canonicalization only maps `SELECT_1`**; the validator compares types with `_`→space,
    so any other underscore/space variant that passed validation would hit the "not yet supported"
    throw at activation.
15. `resolveDefaultValue` / `PropertyStore.resolveDefault` (modes `static/property/parameter/input`)
    exist but are not used by any engine runtime path.
16. MATH is listed as auto-completing with no effect (schema still accepts it).
17. A RETURN in a catch network whose CATCH is not currently active (no `activeCatches` entry)
    dispatches with no catch context: RETRY/COMPLETE then do nothing (return false).
18. **A WAIT ALL never re-fires in a routing cycle**: arrival on its `COMPLETED` row is ignored
    (C.3.7), whereas every other step type is reset and re-run by a routing re-entry. Similarly a
    routing arrival on an `ERRORED`/`ABORTED`/`CANCELLED` row of any type is silently ignored (C.2.2).
19. **A YES_NO submitted without `button_output`** (Pilot `kind:"submit"` on a YES_NO, or any
    non-decision submit) stores no routing context and routes ALL outgoing connections.
20. **The Pilot inbox's `backAvailable` is looser than the engine's Back check**: it requires only the
    fixed bar, `allow_back === true` and a string `backFrom` entry
    [src: mission-control-db/src/runtime/inbox.ts:343], while `goBack` also requires that S is a
    screen and its row is `COMPLETED` (C.7.2) — a Back button can be offered that the engine then
    refuses with `BACK_NOT_ALLOWED`.
21. **`step_run.step_instance_id` is NULL for some `completed` runs** (WAIT ALL joined on first
    touch, RETURN COMPLETE's trigger) because the trace is written before the row exists (C.2.4).
22. **`settleFailedInstance` leaves `wake_at` set on the rows it forces `ERRORED`** (the control-pass
    give-up clears it); harmless because every due claim filters by state.
23. **Repeating-script and timed-gate deadlines keep running while paused** (only action timeout
    budgets are suspended); on resume an expired one opens / completes / fails at once.
24. **SCRIPT error strings are V8-specific** (C.11 item 8) and the step's input parameter ids become
    JavaScript parameter names, so an id that is not a valid identifier fails every run of that step.
25. **`pending` instances are never touched by the engine** — only `queued` ones are acquired; an
    Abort is not legal from `pending` (the DAO rules list `queued` but not `pending`).
26. **The resume pass turns EVERY `PAUSED` row into `WAITING_ACTION`**, including a screen paused by a
    step-level `pause` user action (which the conformance vocabulary allows on `WAITING_USER`); such a
    screen then sits in `WAITING_ACTION` with no action behind it
    [src: MissionEngine/src/core/control.ts:387-416], [src: MissionEngine/src/core/submit.ts:197-203].

## X.B From Part 3 — HTTP interfaces the engine exposes

1. **No CSRF/Origin check on engine `/api/*` mutations** (claim/submit/back/stop/presence/logout/continue). Only better-auth's own routes check Origin. Protection is `SameSite=Lax` alone. [src: MissionEngine/src/api/app.ts:175-183]
2. **Unknown `GET /api/*` with a valid session returns the SPA `index.html` with 200**, not a JSON 404 (session gate is middleware; static fallback follows). Unknown `GET /internal/*` with a valid token likewise. [src: MissionEngine/src/index.ts:100-101]
3. **Uncaught errors are text/plain 500.** E.g. submitting a claimed step whose step state is `PAUSED` passes the route, then `submitCore` throws a plain `Error("Step … is not EXECUTING")` ⇒ `500 Internal Server Error`, not a 409 code. Same for "Step … not found". [src: MissionEngine/src/core/submit.ts:137,162,221-232]
4. `GET /api/theme?workCenterId=` validates the session but NOT the disabled-account status (unlike the gate). A non-UUID WC id there yields 403, not 400. [src: MissionEngine/src/api/app.ts:144-150]
5. `GET /api/me` for a session whose user row vanished would `c.json(undefined)`. [src: MissionEngine/src/api/app.ts:189-191]
6. Presence `last_heartbeat_at` is never used for expiry; a crashed Pilot leaves an `online` row (affecting sole-candidate auto-claim) until another write removes it. [src: MissionEngine/src/api/app.ts:340,356]
7. Claim does not check step state or instance status (PAUSED offers claimable by id, deliberately). Release/submit/back/stop never re-check WC membership (deliberately). [src: MissionEngine/src/api/app.ts:410-414,450-451,482-484]
8. Back refuses unless status is exactly `running` (refuses during `stopping_cleanup`/`aborting_cleanup` and while paused), whereas submit accepts those. Stop route refuses while paused even though `requestStop` allows `paused`/`pausing`. [src: MissionEngine/src/core/go-back.ts:48] [src: MissionEngine/src/api/app.ts:604] [src: mission-control-db/src/dao/runtime-control.ts:80]
9. Back's post-commit re-claim failure is swallowed; the client gets `200 {ok:true}` while S may sit as an open offer. [src: MissionEngine/src/core/go-back.ts:99-108]
10. The `continue` route discards `summary`; the internal force-complete returns it. [src: MissionEngine/src/api/app.ts:314] [src: MissionEngine/src/api/internal.ts:326]
11. Internal pause/resume validate but ignore `actor` and write no `runtime_control_event`. [src: MissionEngine/src/api/internal.ts:51-53]
12. Internal force-release reuses code `RUNTIME_INVALID_STATE` for "assignment is not claimed". [src: MissionEngine/src/api/internal.ts:160]
13. The canonical-host redirect also redirects `GET /health` from a non-canonical Host (container healthcheck uses `localhost` and relies on wget following redirects when `ENGINE_BASE_URL` host differs). [src: MissionEngine/src/index.ts:73-80] [src: MissionEngine/Dockerfile:113-114]
14. better-auth endpoints beyond sign-in/out (e.g. `change-password`, `update-user`, `revoke-sessions`) are reachable through the engine's mount and act on the SHARED user/account tables. [src: MissionEngine/src/api/app.ts:132]
15. The e-signature signer's display name is injected into `form_values` under the block's `fieldName`, not its `outputParameter`; capture then follows normal form-value mapping. [src: MissionEngine/src/core/submit.ts:184-186]
16. Rate limiting is per process memory and off unless `NODE_ENV=production`; with several replicas each has its own buckets. [src: MissionEngine/node_modules/better-auth/dist/context/create-context.mjs:172-175]
17. The PWA's default `navigateFallback` (index.html) has no denylist for `/api/` navigations. [src: MissionPilot/vite.config.ts:63-77]
18. Pilot types `kind:'complete'` without `signature`, but the engine accepts and gates `signature` on `complete` too. [src: MissionPilot/src/api/types.ts:82] [src: MissionEngine/src/api/app.ts:489]
19. The SSE hub's "drop on send failure" never fires for real streams: `send`/`sendTheme` wrap `stream.writeSSE` in `void`, so a
    failed write is an unobserved promise rejection and the session stays registered (re-snapshotted on every change) until
    `onAbort`/`finally` runs. [src: MissionEngine/src/api/app.ts:222-223] [src: MissionEngine/src/api/events.ts:47-48,60-61]
20. `HEAD` requests bypass the canonical-host redirect (raw method is `HEAD`) yet are served by every GET route, including
    `HEAD /api/events` (opens and immediately discards a stream). [src: MissionEngine/src/index.ts:75] [src: MissionEngine/node_modules/hono/dist/hono-base.js:263]

## X.D From Part 4 — Outbound calls, resources, assignments, signatures, configuration

1. **The default matching mode is loose.** `action_matching` absent → `'loose'`, while the trust default is `'strict'`. [system-settings.ts:16,27-30]
2. **Property reads under loose matching send the package's environment oid.** `getProperty` sends the binding env oid (the package's embedded env spec oid), even under loose matching. Invoke sends the server's own `environment_oid` in that mode, so a container with different oids may 404/409 on REST-11/12 while invoke works. [property-overlay.ts:51-63 vs invoker.ts:113-120]
3. **A missing env name on a property binding only skips the name fallback.** A binding whose `environment_name` resolves to 2+ env specs silently skips the fallback; it then falls through to `b.environment_oid` or fails. Invoke fails explicitly on ambiguity. [property-overlay.ts:52-56]
4. **A refetch 404 after COMPLETED errors the step.** On the poll path, if the server reports `COMPLETED` but the authoritative refetch then 404s, `ActionInstanceLost` is caught by the poll's catch and the step fails `ERRORED "Instance lost on server"`. On the SSE path the same throw is only logged, and the next poll repeats it. [loop.ts:521-532; monitor.ts:141-147, 408-411]
5. **`deleteInstance` throws on a trust refusal.** Its "best-effort" try/catch does not cover the policy check. All callers catch it. [client.ts:334-342]
6. **Starting parameters go to every action, and become script locals.** Every invoke also sends every workflow starting parameter, and SCRIPT/GATE locals include them. A starting-parameter or input id that is not a valid JavaScript identifier (e.g. contains a space) makes `Function(...)` throw a SyntaxError inside the sandbox, so **every** SCRIPT/GATE in that workflow fails. [properties.ts:233-245; step-handlers.ts:331-347]
7. **No presence expiry.** Nothing marks presence offline when heartbeats stop. A closed tab leaves the user "online", so they still count for sole-candidate auto-claim and suggestions. [app.ts:324-379; no reader of `last_heartbeat_at` besides display DAOs]
8. **Inbox and claim use different role sets.** Offers list visibility uses the **snapshot** `allowed_role_ids`, but claim re-checks the **live** roles. A role added to a node after the offer is born lets a user claim by id an offer they cannot see, and the reverse leaves visible offers that 403. [inbox.ts:228-238; app.ts:416-431]
9. **`/health` is redirected for non-canonical hosts.** A GET `/health` whose `Host` differs from `ENGINE_BASE_URL` gets a 302. Health probes that do not follow redirects see 302. [index.ts:73-80]
10. **The SCRIPT runs inside the claim transaction.** It runs on a worker thread, but the instance lock and a pooled connection are held for up to `SCRIPT_TIMEOUT_MS` (+2 s backstop), plus any pool queue wait (Open point 17). [transition.ts:2491-2496; script-pool.ts:14-24]
11. **`monitor.ts`'s comment about the policy cache is stale.** It says the policy is "read live, per call, no cache", but production wraps it in the 5 s `cachedPolicySource`. [monitor.ts:343-348 vs index.ts:61]
12. **A capabilities call can throw on a partial response.** `capabilities()` throws on any response missing `data.environments[].actions[].input_parameters` (it calls `.map` on undefined). A server that omits `input_parameters` therefore breaks loose matching and every PAUSE/STOP legality check (the verdict becomes 'unknown'). [client.ts:357-370]
13. **A refused undo can be lost.** When a broker or Autopilot refuses a STOP/PAUSE undo whose instance is busy, the undo is queued only in memory, so an engine restart loses it (accepted in the spec). [send-failure.ts:25-28]
14. **The broker aborts by itself when the caller stops waiting.** It decides "the caller step stopped waiting" (`state !== 'WAITING_ACTION'`) on its own and marks the row `ABORTED`. The engine may see ABORTED for a step it already resolved; the funnel's parked-state guard makes that harmless. [waits.ts:41-51]
15. **Broker defaults are unvalidated.** `BROKER_PORT` falls back to 3007 only when unset: `Number('')` = 0 throws. [MissionBroker/src/config.ts:18-20]
16. **A malformed stored password hash turns a signature attempt into HTTP 500.** better-auth's verify throws `Invalid password hash` when `account.password` is non-empty but lacks a `salt:key` pair; `verifySignature` does not catch it, the submit route rethrows non-SignatureErrors, and no `failed` audit row is written. [esignature.ts:111; app.ts:543-545; @better-auth/utils password.node.mjs]
17. **A queued script holds its instance lock.** The run is requested from inside the claim transaction, and the pool's queue wait is not bounded by `SCRIPT_TIMEOUT_MS` (the timer starts at dispatch). With every slot busy, an instance can hold its row lock and a pooled DB connection for several script timeouts. The pool size equals the loop's concurrency, so this needs other work (for example the Pilot's force-complete) to contend. [script-pool.ts:114-140; transition.ts:2491-2496]
18. **Scripts read the wall clock, not the engine clock.** `Date.now()` / `new Date()` inside a script bypass the injectable `deps.now()`, so tests that pump the clock cannot steer script time. [D.3.1 item 6]
19. **Suggestions count claims in every work center.** `least_queued_steps` counts a candidate's `claimed` assignments with no work-center filter, so work held elsewhere lowers their chance here. [dispatch.ts:116-121]
20. **Resource command order is locale collation.** Acquisition and release order use `localeCompare` (ICU, `en-US`), not code-point order, so an implementation that sorts by code points acquires `B` before `a` where the reference acquires `a` first. [resources.ts:684; transition.ts:414]

## X.E From Part 5 — Persistence

1. `step_instance.order_index`, `input_params` and `output_params` exist but are never written
   by the engine; Commander code still sorts by `order_index`. `[src: mission-control-db/src/dao/runtime-workflows.ts:169]`
2. `workflow_instance.environment_spec_id` has no writer.
3. `step_instance` has no unique constraint on `(workflow_instance_id, step_oid)`; the engine's
   one-row-per-step invariant is enforced only by code. A comment in Commander's live-states DAO
   says "loops re-enter with fresh rows" and picks the latest row per step oid, while the engine
   reuses or deletes and re-inserts. `[src: mission-control-db/src/dao/runtime-workflows.ts:510-534]`
4. Resetting a step deletes its row, which cascades its `instance_assignment` rows; `step_run`
   and `step_signature` keep a dangling `step_instance_id`.
5. Recording an action invoke overwrites `step_instance.started_at` with the invoke time, so
   `started_at` is not stable across an activation. Broker's idempotency key and
   `created_by_step_started_at` use the value read at invoke time. `[src: MissionEngine/src/loop.ts:457-462]`
6. Clock mixing: `started_at` (acquire), `queued_at`, `signed_at`, `runtime_control_event.at`,
   and control-request `updated_at` use the DB clock or the Commander/Broker clock; everything
   else uses the engine's `deps.now()`.
7. `engine_state.startAttempts` is written by `recoverFailedStart` but dropped by
   `loadEngineState`, so it survives only while the start keeps failing. `[src: MissionEngine/src/loop.ts:156-166]` `[src: MissionEngine/src/core/engine-state.ts:327-361]`
8. `cleanup_skip` is never cleared after use.
9. The `engine_wake` trigger fires on `UPDATE OF status` even when the value does not change, and
   per statement, not per row; the payload carries no id.
10. `runtime_schedule` has no unique index on `(work_center_id, runtime_number)`; `RS-<n>` uniqueness
    depends on the `work_center` FOR UPDATE lock, and `max()+1` restarts if rows lose their
    `work_center_id` (SET NULL on work-center delete).
11. Operator trace rows for shared-registry verbs use `max(order_index)+1` across the whole run,
    so their position in the reassembled history trace is approximate (their `at` is authoritative).
    `[src: MissionEngine/src/core/operator-verbs.ts:40-75]`
12. `wc_resource.updated_at` is not bumped by engine counter writes.
13. The pause/resume DAO accepts only `running` → `pausing` and `paused` → `resuming`; the
    engine's own undo writes `paused` → `pausing`.
14. Holder rows are deleted and re-inserted at every persist of the holding run, so their `id`
    and `acquired_at` (DB `now()`) show the last persist, not when the hold was taken; the
    "oldest row first" rule of a foreign release follows that. `[src: mission-control-db/src/runtime/wc-resources.ts:145-151]`
15. A terminal settle leaves still-active step rows in their states (it only records `cancelled`
    step_runs). A `WAITING_USER` row left that way keeps its live assignment (reconcile closes only
    rows whose step left `WAITING_USER`/`PAUSED`), and the Pilot inbox query does not filter on
    the run's status, so such a task can stay visible until the run is swept; a submit then fails
    `NOT_RUNNING`. Derived from code reading, not reproduced. `[src: MissionEngine/src/core/context.ts:1322-1326]` `[src: mission-control-db/src/runtime/inbox.ts:297-318]`
16. Only a `StartRecoveryFailedError` escaping the start transaction rotates `queued_at`; any
    other throw rolls the run back to `queued` with the same `queued_at`, so a deterministically
    failing start of that kind is re-picked first on every cycle (head-of-line). `[src: MissionEngine/src/loop.ts:713-736]`
17. Presence never expires: nothing reads `last_heartbeat_at` to mark rows `offline`, so
    dispatch suggestions and sole-candidate auto-claims can target an operator whose browser is
    gone until their session signs out.
18. Unit 0 (orphaned cleanup ABORTs) is driven by a per-process flag and takes no lock, so in a
    multi-replica deployment only a replica that queued the entries or started afterwards scans
    for them, and two replicas may both send the ABORT.
19. Control requests stamp `updated_at` with the Commander/Broker host clock, while the engine
    stamps it with its own; clock skew between hosts shifts a run's position in the
    `ORDER BY updated_at` claim order (harmless for correctness).
20. `runtime_history.started_by_user_id` is written only when that user's `login_name` still
    resolves at settle time; a user deleted before the run ended leaves both columns NULL.

# Appendix Y — Disagreements between older docs and the code

Each item names a place in `docs/JSON_SCHEMA.md` or `docs/REST_Protocol.md` that disagrees with the reference code. The code (and this document) wins.

## Y.A Found while writing Part 1 — Workflow JSON

1. **docs/JSON_SCHEMA.md:176** — "Step types are compared after replacing `_` with a space, so `YES_NO` and `YES NO` are the same type." Code: only the graph rules normalise; the JSON Schema enum rejects `"YES NO"` with `INVALID_STEP_TYPE`, and runtime keeps underscores. Only `SELECT_1` is an accepted alias. [src: MissionEngine/src/spec/validator.ts:903-935; verified]
2. **docs/JSON_SCHEMA.md:339** — "the engine matches the answer `"true"` to `"yes"` and `"false"` to `"no"`." Code: over REST the answer is literally `yes`/`no` (anything else is 400); `yes_value`/`no_value` are never read. The true->yes mapping only affects non-REST callers. [src: MissionEngine/src/api/app.ts:504-512,565-567; MissionEngine/src/core/transition.ts:877-882]
3. **docs/JSON_SCHEMA.md:519** — `condition` "the engine also matches `condition` against ... a button's value as a fallback." Code: no button value ever reaches the engine for a USER_INTERACTION via REST; all outgoing connections fire. [src: MissionEngine/src/api/app.ts:565-567]
4. **docs/JSON_SCHEMA.md:508** — example `"condition": "Status.Value == open"` suggests an expression; the engine never evaluates conditions, only compares them as literal labels. [src: MissionEngine/src/core/transition.ts:878-896]
5. **docs/JSON_SCHEMA.md:887** — v1 `text`/`header` `content` "string OR `{content, plainText}`". Code: the engine schema requires the object form; a string fails with `INVALID_FORM_ELEMENT_TYPE`. [src: workflow-schema.json:142-149,176-209; verified]
6. **docs/JSON_SCHEMA.md:678** — "A blank `uri` is allowed." Code: blank string is allowed, but the `uri` key itself is required (missing -> `MISSING_REQUIRED_FIELD`), and `connection_type` must be `"REST"`. [src: workflow-schema.json:27-36; verified]
7. **docs/JSON_SCHEMA.md:673** — roster entries described as joined by `action_name` + `action_library`, without saying the engine rejects an entry lacking `action_library` (`MISSING_REQUIRED_FIELD ... action_library`). [src: workflow-schema.json:567; verified]
8. **docs/JSON_SCHEMA.md:451** — "Mission Engine rejects (`INVALID_VALIDATION`) a step with no `action_proxy_config` ..." Code: only ROOT-level ACTION PROXY steps are checked; child steps are not. [src: MissionEngine/src/spec/validator.ts:478,496-497]
9. **docs/JSON_SCHEMA.md:556 and :366** — Value Properties described as "workflow- or step- or env-scoped" and "Every step type MAY carry ... `value_property_specifications`". Code: step-level and embedded-environment `value_property_specifications` are never read; only workflow-level ones (root and child) seed the store; environment values come from the work-center registry. [src: MissionEngine/src/core/properties.ts:57-77; MissionEngine/src/core/context.ts:718]
10. **docs/JSON_SCHEMA.md:163** — `display_style` "the engine ignores it." Code: the engine's schema rejects values outside the enum (`MISSING_REQUIRED_FIELD`), and the engine's diagram route reads it. [src: workflow-schema.json:747; mission-control-db/src/dao/workflow-diagram.ts:164; verified]
11. **docs/JSON_SCHEMA.md:190** — lists error codes as if each violation had its own code; it does not say that schema type/enum/const failures (other than `step_type` and form elements) are reported as `MISSING_REQUIRED_FIELD` with a bare ajv message. [src: MissionEngine/src/spec/validator.ts:949]
12. **docs/JSON_SCHEMA.md:322** — "Each outgoing connection from a `SELECT 1` step MUST set `connection_id` ..." — does not state that with no matching option and no default every outgoing connection fires. [src: MissionEngine/src/core/step-handlers.ts:129-134; MissionEngine/src/core/transition.ts:867]
13. **docs/JSON_SCHEMA.md:293** — SCRIPT inputs "Each input parameter is a local variable named by its `id`" — omits that ids must be JS identifiers and that starting parameters are also injected when the step runs in the start transaction. [src: MissionEngine/src/core/step-handlers.ts:331-347; MissionEngine/src/core/properties.ts:233-245]
14. **docs/REST_Protocol.md:309** — "Mission Engine sends the step's declared inputs **plus** every workflow starting parameter." Code: starting parameters are included only when the ACTION PROXY is activated in the same transaction as instance start; afterwards only the declared inputs are sent. [src: MissionEngine/src/core/properties.ts:233-245,277-286; MissionEngine/src/loop.ts:388-390]

## Y.C Found while writing Part 2 — Execution semantics

1. `docs/JSON_SCHEMA.md:244` — WAIT ANY "completes when any predecessor is done". Code: it
   completes and routes its successors on EVERY predecessor arrival (no one-shot semantics)
   [src: MissionEngine/src/core/transition.ts:2470-2476,946-965].
2. `docs/JSON_SCHEMA.md:339` (§1.5.5) — implies the engine uses `yes_value`/`no_value` and matches
   `"true"`→`"yes"`. Code: `yes_no_config` is never read; routing uses the client's `button_output`
   (Pilot sends `yes`/`no`), with `true`/`false` mapped to `yes`/`no` handles only as a legacy
   fallback [src: MissionEngine/src/core/transition.ts:874-887], [src: MissionEngine/src/api/app.ts:565].
3. `docs/JSON_SCHEMA.md:519` (§1.6) and `:569` (§1.7.3 "Addressed in expressions") — present
   `condition` as condition text / expressions (example `"Status.Value == open"`). Code: there is no
   expression evaluator; `condition` is compared literally (case-insensitive) with a button/answer
   value only [src: MissionEngine/src/core/transition.ts:864-900].
4. `docs/JSON_SCHEMA.md:519` (§1.6) — "the engine also matches `condition` against … a button's
   value". Via the Pilot API no button value is ever submitted for USER_INTERACTION, so all outgoing
   connections fire on submit [src: MissionEngine/src/api/app.ts:565-567], [src: MissionEngine/src/core/step-handlers.ts:169-181].
5. `docs/JSON_SCHEMA.md:322` (§1.5.4) — "the engine follows the connection whose connection_id
   equals the chosen option's id". Not documented: with no matching option and no default the
   engine follows ALL outgoing connections, and comparisons are string (lexicographic) comparisons
   [src: MissionEngine/src/core/step-handlers.ts:112-149].
6. `docs/JSON_SCHEMA.md:370` (§1.5.7) — lists `value_property_specifications` as a per-step array.
   The engine never reads step-level value properties; only spec-level ones seed the store
   [src: MissionEngine/src/core/properties.ts:68-77].
7. `docs/JSON_SCHEMA.md:176` — "Step types are compared after replacing `_` with a space". True of
   the validator only; the runtime canonicalizes only `SELECT_1`→`SELECT 1`
   [src: MissionEngine/src/core/step-handlers.ts:31-34], [src: MissionEngine/src/spec/validator.ts:32-34].
8. `docs/REST_Protocol.md:938` (§5.5.3) — "Operator Abort | ABORT, then DELETE | Always". With a
   root `OPERATOR_ABORT` row, live actions get ABORT only, are kept and monitored up to 30 s for their
   terminal, and only the stragglers get ABORT+DELETE [src: MissionEngine/src/core/control.ts:752-825].
9. `docs/REST_Protocol.md:934` (§5.5.3) — Operator Pause "otherwise the action keeps running".
   Not documented: when the server's capabilities are unknown the pause waits (status stays
   `pausing`) up to 120 s before settling with an unreachable WARNING [src: MissionEngine/src/core/control.ts:281-314].
10. `docs/JSON_SCHEMA.md:185` — "Cycles ARE allowed". Not documented: one transaction's cascade is
    capped at 10000 activations, after which the instance is settled `errored`
    [src: MissionEngine/src/core/transition.ts:53,1121-1124].
11. `docs/JSON_SCHEMA.md:243` — WAIT ALL "completes when all predecessors are done". Not documented:
   once joined it never joins again — a later arrival on its `COMPLETED` row is ignored, so a cycle
   through a WAIT ALL stops there [src: MissionEngine/src/core/transition.ts:781].
12. `MissionEngine/src/conformance/PROVENANCE.md:8-16,42` — counts 82 fixtures (execution 33,
   validation 28) and a 79/0/3 result; the folders now hold 94 (execution 37, validation 36) with
   engine-local additions.

## Y.B Found while writing Part 3 — HTTP interfaces the engine exposes

Neither `docs/REST_Protocol.md` nor `docs/JSON_SCHEMA.md` documents the engine's own HTTP surface (operator `/api/*`, SSE, `/internal/*`); REST_Protocol.md covers only Engine→action-server traffic. Concrete disagreements/omissions:

1. `docs/REST_Protocol.md:1-19` — scope lists the action-server protocol only; the engine's operator API, `/api/events` SSE and `/internal/*` (token header `x-internal-token`) are undocumented anywhere in docs/. Code: B.5–B.7.
2. `docs/REST_Protocol.md:805-843` (§4 SSE reconnection: ring buffer, Last-Event-ID replay, heartbeats) — describes action-server SSE; the engine's own SSE sends no event ids, ignores `Last-Event-ID`, and uses an `event: ping` (empty data) every 25 s with a full snapshot on every connect. A reader could wrongly apply §4 to `/api/events`. [src: MissionEngine/src/api/app.ts:215-231]
3. `docs/JSON_SCHEMA.md:341-361` (§1.5.6) and the step field tables — omit `button_bar` (`{format:'fixed', size?, color?, yes_color?, no_color?}`), `allow_back`, `allow_stop`, which the engine schema accepts and the inbox/back/stop routes depend on (`buttonBar`, `allowStop`, `backAvailable`). [src: MissionEngine/src/spec/types.ts:465-469] [src: MissionEngine/src/spec/workflow-schema.json:641-652] [src: mission-control-db/src/runtime/inbox.ts:52-61,341-343]
4. `docs/JSON_SCHEMA.md:864` ("Buttons and jobs … A host hides its own Continue/Yes/No buttons only when …") — with `button_bar.format:'fixed'` the step uses the fixed button row (inbox `buttonBar` non-null) regardless of job buttons; the doc describes only the legacy in-form-button behaviour. [src: mission-control-db/src/runtime/inbox.ts:38-40,51-61]
5. `docs/JSON_SCHEMA.md:866` ("On submit, each input block's value is stored under `outputParameter`") / `:868` (esignature `outputParameter`) — for an `esignature` block the engine overwrites `form_values[fieldName]` with the signer's display name server-side; the doc does not say the value is server-written nor keyed by `fieldName`. It also does not say a YES_NO "no" decision is exempt from the signature requirement. [src: MissionEngine/src/core/submit.ts:184-186] [src: MissionEngine/src/api/app.ts:531]
6. `docs/JSON_SCHEMA.md:866` ("A step cannot be completed while … an e-signature is incomplete") — presented as a host rule; the engine enforces it server-side with `400 SIGNATURE_REQUIRED` and five 403 verification codes, and audits every failed attempt in `step_signature`. [src: MissionEngine/src/api/app.ts:533-557]

## Y.D Found while writing Part 4 — Outbound calls, resources, assignments, signatures, configuration

1. **docs/REST_Protocol.md:865 (§5.1)** says that without `GET /capabilities`, "every command except ABORT/RESUME is treated as unsupported". In code, a server whose capabilities cannot be fetched is **'unknown'**, not 'unsupported': PAUSE waits up to 120 s and then settles paused with a WARNING; STOP is never recorded as handled and the stop drain keeps retrying; a gate STOP retries every 5 s indefinitely. [control.ts:204-221, 281-284, 592-603; gate.ts:220-225; capability-warmup.ts:55-70]
2. **docs/REST_Protocol.md:730 (REST-12 last paragraph)** says the engine "uses events only as a trigger (debounced about 500 ms)". In code, events are **not** debounced: each `property` event immediately runs `markGatesDue` and wakes the loop. The 500 ms debounce applies to the **registry reconcile**. [property-watch.ts:153, 341-357]
3. **docs/REST_Protocol.md:730 (REST-12)** says the engine "opens one stream per (server, environment, property) watched by an open GATE". In code, streams are keyed by property **group** (the text before the first `.`), and are also opened for **repeating SCRIPT** steps (`WAITING_SCRIPT`) with step-level bindings. Rows with `wake_at = NULL` (open armed gates) are excluded. [property-watch.ts:63-71, 82-85, 119-133]
4. **docs/REST_Protocol.md:667 (REST-11)** says values are "fetched when the step activates" for step inputs. Repeating SCRIPT steps with bindings also re-read **before every run**. [gate.ts:303-332]
5. **docs/REST_Protocol.md:921 (§5.5.1 last sentence)** says "the invoke body's input_parameters names are the step's input ids". The body also carries every workflow starting parameter not shadowed by an input, as REST-03's own field table (:315) correctly says. [properties.ts:233-245; loop.ts:389-391]
6. **docs/REST_Protocol.md:938 (§5.5.3, Operator Abort row)** says "ABORT, then DELETE — Always". For a confirmed **Operator Abort** halt (an `OPERATOR_ABORT` row), only `ABORT` is sent at first. The instance stays monitored, and `DELETE` follows only when its terminal arrives (or after the 30 s confirm limit, via the normal terminal path). [control.ts:744-760, 964-967; monitor.ts:183-193, 308-310]
7. **docs/REST_Protocol.md:82 (§1.3.2 Strict)** says any non-allowlisted origin "fails the step's dispatch". That holds only for invoke. For a non-allowlisted origin on an already-invoked step, polls do **not** fail the step: they are logged and retried until `timeout_ms`, plus a WARNING after 2 min. SSE is silently skipped, and PAUSE/STOP sends are classified `refused`. [loop.ts:533-536; monitor.ts:413-421; send-failure.ts:47-49]
8. **docs/JSON_SCHEMA.md:293 (§1.5.3)** says "each key is stored through the step's output_parameter_specifications". With output specs, keys that are not spec ids are **ignored** and an unset spec key writes `''`. Without specs, each key is written **directly as a property key**. [step-handlers.ts:419-435]
9. **docs/JSON_SCHEMA.md:293 (§1.5.3)** says "Each input parameter is a local variable named by its id". The locals also include every workflow starting parameter and any Action-Property overlay. Names that are not valid identifiers make the script fail to compile. [step-handlers.ts:331-347; properties.ts:233-245]
10. **docs/JSON_SCHEMA.md:858 (§1.12 table)** lists `fieldName` as **required** on `esignature`. The engine tolerates a missing `fieldName` (it becomes `''`): the signature is still required and recorded, and only the display-name binding is skipped. [esignature.ts:46-60; submit.ts:182-188]
11. **docs/JSON_SCHEMA.md:299 (§1.5.3 repeat table)** gives the `cycle_seconds` range as 1 – 31,449,600. At runtime the engine falls back to 5 s for any value that is not a number or is < 1, and applies **no** upper bound (the range is a validator rule only). [step-handlers.ts:451-454]

Total discrepancies: 11.

## Y.E Found while writing Part 5 — Persistence

`docs/JSON_SCHEMA.md` and `docs/REST_Protocol.md` say almost nothing about persistence. The few
places that touch it agree with the code:

- `docs/REST_Protocol.md:319` (Broker idempotency keyed by `step_instance_id` plus the step's
  start time) matches `broker_action_instance_activation_uq` (migration 0043).
- `docs/REST_Protocol.md:927` (`INVOKE_GRACE_SECS`, default 60 s) matches `config.ts:163`.
- `docs/JSON_SCHEMA.md:192` (validation warnings recorded as `WARNING` trace rows at start)
  matches `MissionEngine/src/core/instance.ts:64`.

No concrete contradictions found (0). Omission: neither doc describes the database tables,
status vocabularies, LISTEN/NOTIFY channels, the runtime-ID template or the retention sweep.

Verifier re-check (2026-11-12): the three doc citations above were re-read against the docs and
the code (`REST_Protocol.md:319`, `:927`; `JSON_SCHEMA.md:192`; migration 0043's
`broker_action_instance_activation_uq` on `(step_instance_id, step_started_at) WHERE step_started_at IS NOT NULL`)
and still agree. Still 0 contradictions.
