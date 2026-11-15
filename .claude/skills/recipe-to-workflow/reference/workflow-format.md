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

Recipes use `START`, `USER_INTERACTION`, `SELECT 1` and `END`.

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
(`src/lib/export/fixed-bar-checks.ts`). The builder therefore never sets Back on the first
screen. It traverses *through* a `SELECT 1`, so the first screen of a branch may offer Back.

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

The answer reaches the property through the radio block's `outputParameter`. The engine
matches it against `output_parameter_specifications[].id` and falls back to using the
string itself as the property key when nothing matches
(`MissionEngine/src/core/properties.ts:222`). The builder uses the dotted form
(`OvenType.Value`) directly, so there is no id pair to keep in step.

The workflow declares the property in `value_property_specifications`:

```json
[{ "name": "OvenType", "oid": "…", "entries": [{ "name": "Value", "value": "" }] }]
```

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

Four gates, all run by `lib/validate.ts`, none re-implemented:

| Gate | Source |
| --- | --- |
| Workflow JSON schema | `validateWorkflowSpecification` (`src/lib/import/schema-validator.ts`) |
| Form Document v2 | `validateFormDocument` (`@mission/form-schema`) — the result field is **`ok`**, not `valid` |
| Authoring checks | `findHiddenRequired`, `findDuplicateOptionValues`, `checkJoblessButtons`, `checkNeverStuck` |
| The real importer | `importWorkflow` (`src/lib/import/workflow-importers.ts`) |

`checkNeverStuck` only applies to a form that owns its buttons. These screens use the
fixed bar, so the bar is the way out and the form legitimately has none; the validator
runs that check only if a form ever grows button blocks.

It must run from `MissionDesigner` with `NODE_PATH=./node_modules`, because the file lives
outside that package and Node resolves bare specifiers from the importing file's directory.
