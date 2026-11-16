# The Trajectory format facts this builder relies on

Every claim here was read out of the repository, and each is cited so a future schema
change can be checked against it rather than guessed at. The authoritative document is
[`docs/JSON_SCHEMA.md`](../../../../docs/JSON_SCHEMA.md); this file records only the parts
the builder depends on.

## The output: `.WFmasterX`

A ZIP (`docs/JSON_SCHEMA.md` §2.2). Mission Commander loads **only** this format; the bare
`.WFmaster` JSON is Designer's canvas export and Commander will not take it.

```
Roast Chicken(1.0.0).WFmasterX
├── Roast_Chicken.WFmaster     one MasterWorkflowSpecification
└── manifest.json              advisory; importers must not route on it
```

Rules the builder follows:

- Exactly one file at the ZIP root ending in `.WFmaster`.
- The entry name is the workflow name with every character outside `A–Za–z0–9._-`
  replaced by `_` (`buildWorkflowPackage.ts:65`, `SAFE_NAME_RE`).
- The downloaded file is `<name>(<version>).WFmasterX` (`src/lib/export/filename.ts`,
  `withVersionSuffix`).
- **The importer accepts only** `*.WFmaster`, `manifest.json`, `images/`, `environments/`
  and `actions/`. Any other path fails with `zip_filename_invalid`. Recipes use no
  environments or actions, so only the first two appear.

`schemaVersion` must be `"4.0"`–`"5.0"`; missing is rejected. The builder emits `"5.0"`,
which is `CURRENT_SCHEMA_VERSION` (`src/lib/packageFormat/export-types.ts:21`).

## Steps

`step_type` is spelled **`"SELECT 1"`, with a space**, in the library and package schemas
(`src/lib/schemas/master-workflow-library.json`, `src/lib/import/type-mapping.ts`). The
Engine's own conformance fixtures use `SELECT_1`; that is the Engine's internal dialect and
is **not** what an import accepts. This is a genuine trap.

Every step is a managed element: `local_id`, `oid`, `version`, `last_modified_date` are
required. So is the library envelope itself, if you ever emit a `.WFlibX` — leaving them
off fails with four "must have required property" errors that name no file.

Recipes use `START`, `USER_INTERACTION`, `SELECT 1`, `WAIT ANY` and `END`.

**`local_id` is the step's name on screen.** Designer labels a canvas node with it
(`workflow-importers.ts`: `nodeData.label = step.local_id`), and the same label heads the
step's group in the SELECT 1 source picker. It is free text in the schema
(`ManagedElement.local_id` is a plain `string`), so it should read as a name, not a key:
the builder uses the header shown inside the step, de-duplicating with a ` (2)` suffix.
`step-4` imports perfectly well and tells a reader nothing. Identity lives in the `oid`,
which is seeded from a stable key, so naming a step does not renumber anything.

## Screens and the fixed button bar

A `USER_INTERACTION` step carries a `form_document` — the Form Document v2 shape, not the
retired `form_layout_config` (deprecated at `master-workflow-library.json:268`; v4.0 files
are still converted on import).

The buttons are the part worth understanding. **`button_bar` and in-form button blocks are
alternatives, not layers** (`src/lib/form-document/fixed-bar.ts`). With `button_bar` set:

- the form document contains **no** button blocks;
- the button's text travels as a `Button` entry in `ui_parameter_specifications`;
- Pilot and XO pin the row to the bottom of the viewport, so it never scrolls away.

`allow_back` and `allow_stop` add Back and Stop to that same row. They are real export and
import fields (`export-types.ts:310`, `workflow-importers.ts:204`) even though the library
JSON schema does not enumerate them — the schema leaves `additionalProperties` unset, so
they validate.

**Back needs somewhere to go.** Designer warns `"<step>: Back will never be available
here"` for a screen with `allow_back` whose upstream holds no other screen
(`src/lib/export/fixed-bar-checks.ts`). Back walks upstream until it hits a barrier, and
`BARRIER_TYPES` covers `START`, `PARALLEL`, `WAIT ALL`, `WAIT ANY` and `WORKFLOW PROXY`.

So whether a screen may offer Back is a property of the finished graph, not of the step's
place in the recipe. Two consequences the builder depends on:

- a `SELECT 1` is **not** a barrier, so the first screen of each branch may offer Back, and
  it lands on the question — which is what a cook wants when they pick the wrong oven;
- a `WAIT ANY` **is** a barrier, so the first shared screen after the branches rejoin must
  not offer Back.

Get this wrong and the step still imports: Back is simply dead on arrival. The validator
runs Designer's own `collectFixedBarWarnings` over the imported graph rather than guessing.

## Branching

```json
"select1_config": {
  "input_name": "OvenType.Value",
  "input_value_type": "property",
  "options": [
    { "id": "<oid>", "label": "Gas oven", "operator": "==",
      "value": "gas", "value_type": "literal", "is_default": true }
  ]
}
```

Each outgoing edge carries the option id in **both** `connection_id` and
`source_handle_id`. Designer routes on `source_handle_id`
(`workflow-importers.ts:461`); the Engine's fixtures use `connection_id`. Setting both
satisfies each without having to know which consumer sees the file.

### Getting the answer to the branch

This is the easiest part of the format to get half-right, because half-right still runs.

A `SELECT 1` reads **one key out of the property store** (`step-handlers.ts` `handleSelect1`).
Three things have to name that key, and all three have to agree:

| Where | Field | Value |
| --- | --- | --- |
| the radio block | `outputParameter` | `OvenType.Value` |
| the question step | `output_parameter_specifications[].id` / `.target` | `OvenType.Value` |
| the `SELECT 1` | `input_name` (with `input_value_type: "property"`) | `OvenType.Value` |

The step's declaration is the part that is easy to skip, **and skipping it still works at
runtime**. `captureFormOutputs` resolves a block's `outputParameter` against the step's
`output_parameter_specifications` and, finding nothing, falls back to treating the string
itself as the property key (`MissionEngine/src/core/properties.ts`). The recipe runs; the
branch routes. What breaks is authoring:

- Designer's Parameter Binding inspector fills its **Output Parameter** dropdown from the
  step's `outputs` (`form-designer/v2/inspector/sections/ParameterBindingSection.tsx`). With
  nothing declared the dropdown is empty and the binding looks unset.
- The **SELECT 1 source picker** lists the output parameters of every *other* step
  (`hooks/useSourcePickerExtraGroups.ts`) and skips any step whose `outputs` are empty. The
  question step does not appear at all, so the value the branch depends on is invisible at
  the one place you choose it.

So declare it. `id` and `target` are kept **identical** on purpose: the engine writes
`target`, while the source picker offers the output by `name` (which exports as `id`), and
if the two differ the pickers suggest a string the engine never writes. A dotted name is
fine and intended — `properties.ts` says as much ("which may already be dotted").

```json
"output_parameter_specifications": [
  { "id": "OvenType.Value", "oid": "…", "target": "OvenType.Value",
    "description": "The oven chosen on this screen." }
]
```

The workflow also declares the property in `value_property_specifications`, which is what
puts `OvenType` / `OvenType.Value` in the picker's **Value Properties** group and what makes
the write stay local (`declaredLocally`, `properties.ts`):

```json
[{ "name": "OvenType", "oid": "…", "entries": [{ "name": "Value", "value": "" }] }]
```

### Rejoining

Branches rejoin through a **`WAIT ANY`**, never by running one edge per branch into the next
shared step. `WAIT ANY` is the join type: it auto-completes on the first arrival, so with
exactly one branch live it costs nothing. Several edges into an ordinary step also run, but
the canvas then shows a step with three inbound arrows and Back has no single target. The
validator rejects a fan-in on any step that is not `WAIT ANY` or `WAIT ALL`.

## Three screen sizes

A Form Document v2 is `{ version: 2, sections: [{ id, role, rows: [{ id, blocks }] }] }`.
There is no separate layout per device. One set of blocks is **resolved per breakpoint**
through `PerBreakpoint<T> { base, tablet?, phone? }`, resolving phone ?? tablet ?? base
(`MissionFormKit/packages/form-schema/src/types.ts`). `base` is the desktop frame.

The builder uses:

| Control | Use |
| --- | --- |
| `layout.span` | 12-column grid. Drawing beside text on desktop, stacked or dropped on phone. |
| `layout.visible` | Hides the drawing on the phone when the body is long. |
| `sizeAt` | Smaller type on the phone. |
| `scalePercentAt` | Smaller drawing on the phone. |
| `section.rowsAt` | Available for regrouping rows per breakpoint; not needed so far. |

`layout.aspectRatio` is **required on image blocks**.

**A required block may not be hidden at any breakpoint.** `findHiddenRequired` rejects a
required input, or a `blockDone` timer, hidden on any screen size. Only decorative
drawings are ever hidden.

## Validation

All run by `lib/validate.ts`. The product's own validators are called, never
re-implemented, so a package that passes is one Designer accepts rather than one that
matches this skill's reading of the schema:

| Gate | Source |
| --- | --- |
| Workflow JSON schema | `validateWorkflowSpecification` (`src/lib/import/schema-validator.ts`) |
| Form Document v2 | `validateFormDocument` (`@mission/form-schema`) — the result field is **`ok`**, not `valid` |
| Authoring checks | `findHiddenRequired`, `findDuplicateOptionValues`, `checkJoblessButtons`, `checkNeverStuck` |
| Back and Stop | `collectFixedBarWarnings` (`src/lib/export/fixed-bar-checks.ts`), run on the graph `importWorkflow` produces |
| The real importer | `importWorkflow` (`src/lib/import/workflow-importers.ts`) |

On top of those, four graph rules this builder has broken at least once each, every one of
which imports cleanly and so needs checking separately:

- every `SELECT 1` option has an outgoing edge;
- nothing is stranded — every step but `END` leads somewhere, every step but `START` is reachable;
- no fan-in except on a join (`WAIT ANY`, `WAIT ALL`);
- **every form binding names an output parameter its own step declares, and every `SELECT 1`
  reads a key that some step able to reach it actually writes.** This is the one that matters
  most, because a branch reading an unwritten key runs happily and silently takes its default
  option on every execution.

`checkNeverStuck` only applies to a form that owns its buttons. These screens use the
fixed bar, so the bar is the way out and the form legitimately has none; the validator
runs that check only if a form ever grows button blocks.

It must run from `MissionDesigner` with `NODE_PATH=./node_modules`, because the file lives
outside that package and Node resolves bare specifiers from the importing file's directory.
