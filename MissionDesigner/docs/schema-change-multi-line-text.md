# Schema Change: Multi Line Text (textarea element)

**Date:** 2026-05-19
**Affects:** `form_layout_config[].elements[]` entries with `type: 'textarea'`

**Amended 2026-09-10 (user ruling):** the **Android 3-line visible-line floor is removed**, and
with it the per-platform split this document used to carry. Mission Pilot is one PWA renderer, so
there is no longer a form factor for a rendering rule to key off; `rows ?? 4` governs everywhere.
The floor was **never implemented** — `form-renderer/src/blocks/TextareaBlockView.tsx:17` renders
`rows={block.rows ?? 4}` and `form-schema/src/convert/blocks.ts:45` sizes from `(el.rows ?? 4)`,
neither with a floor nor a platform branch — so nothing changes at runtime. It was specified for the
native Android runtime app retired in `81965a0`.

## Summary

The form designer now exposes the existing `textarea` element type in the palette under the author-facing label **Multi Line Text**. It is the multi-line counterpart to `textInput`: at runtime the user types multi-line text and the value is stored under `fieldName` in the step's output object.

This document is the runtime-implementation contract for `textarea` elements. The element type, its discriminant string, and all of its fields already exist in the v4.0 workflow schema — no new fields are introduced. What is new is (a) the palette entry in the editor and (b) the rendering rules below.

## Element Schema (as seen by the runtime)

| Field               | Type                                                         | Required | Description                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`              | `'textarea'`                                                 | yes      | Permanent discriminant. Never rename.                                                                                                                                                                      |
| `x`, `y`            | number                                                       | yes      | Logical-pixel position on the canvas.                                                                                                                                                                      |
| `width`, `height`   | number                                                       | yes      | Outer bounding-box dimensions in logical pixels.                                                                                                                                                           |
| `zIndex`            | number                                                       | no       | Stacking order. Defaults to 0 when absent.                                                                                                                                                                 |
| `label`             | string                                                       | no       | Label rendered above the input area.                                                                                                                                                                       |
| `placeholder`       | string                                                       | no       | Static placeholder shown when the input is empty. Ignored when `placeholderSource.mode === 'input'`.                                                                                                       |
| `placeholderSource` | `{ mode: 'static' \| 'property' \| 'input', value: string }` | no       | When present, runtime resolves the source and uses the result as the placeholder. `mode: 'input'` reads the named step input parameter at runtime; `mode: 'property'` resolves a Value Property reference. |
| `fieldName`         | string                                                       | yes      | JSON key under which captured text is stored in the step output object. Valid JavaScript identifier.                                                                                                       |
| `required`          | boolean                                                      | no       | Defaults to `false`. When `true`, empty content (no chars or whitespace-only) blocks step submission.                                                                                                      |
| `outputParameter`   | string                                                       | no       | Value Property dot-notation reference. Runtime mirrors the captured text to this property.                                                                                                                 |
| `defaultSource`     | `{ mode: 'static' \| 'property' \| 'input', value: string }` | no       | When present, runtime resolves the source and pre-fills the input.                                                                                                                                         |
| `rows`              | integer (1–20)                                               | no       | Author-requested visible line count. Defaults to `4` when absent.                                                                                                                                          |
| `fontSize`          | number                                                       | no       | Logical-pixel font size for the input text. Defaults to `14` when absent.                                                                                                                                  |

## Rendering Rules

These apply identically on every device the renderer runs on — phone, tablet and desktop. There
are no per-platform exceptions and no minimum visible-line floor.

The bounding-box `width`/`height` from the canvas defines the outer container. The `rows`-derived visible line count controls how the **internal** text area is sized within that container; if user-entered text exceeds the visible line count, the input scrolls internally. The runtime does not auto-grow the element to fit more rows than `rows` requests.

- Render a multi-line input sized to `element.rows ?? 4`.
- Honor `width` and `height` from the canvas for the outer container.
- Newline characters within the user's typed text MUST be preserved on capture.
- On a touch device, use the platform's default soft-keyboard "return" behavior (insert a newline; do not submit the step).

## Capture and Output

- The user's typed string — newlines preserved — is stored at runtime under `fieldName` in the step's output object.
- When `outputParameter` is set, the runtime mirrors that string to the named Value Property reference, same as for `textInput`.
- When `defaultSource` is set, the runtime resolves the source and pre-fills the input before the user types. `mode: 'static'` uses the literal `value`; `mode: 'property'` resolves a Value Property; `mode: 'input'` resolves a step input parameter.
- When `placeholderSource` is set with `mode: 'input'`, it replaces the static `placeholder` string at runtime.

## Validation

- When `required: true`, empty content (zero characters, or only whitespace/newlines) blocks step submission, same rule as `textInput`.
- No character-class filtering applies. Unlike `textInput` modes `'number'` and `'phone'`, the multi-line input accepts any characters.

## Backward Compatibility

- All fields listed above already exist in the v4.0 workflow schema (`textarea` has been a permanent discriminant since Phase 12).
- No new fields are introduced; existing exported workflows that already contain `textarea` elements are unaffected.
- The legacy `ui_parameter_specifications` `FormFieldMultiline` entry (with its `lines` integer) is out of scope for this document; runtimes that still consume v1 UI parameters should continue handling it as before.

## Examples

### Minimal

```json
{
  "type": "textarea",
  "x": 20,
  "y": 100,
  "width": 320,
  "height": 120,
  "label": "Notes",
  "fieldName": "notes"
}
```

Effective visible lines: 4, the default when `rows` is absent.

### Author override (rows = 6)

```json
{
  "type": "textarea",
  "x": 20,
  "y": 100,
  "width": 320,
  "height": 180,
  "label": "Inspection findings",
  "placeholder": "Describe what you observed...",
  "fieldName": "findings",
  "required": true,
  "rows": 6
}
```

Effective visible lines: 6.

### Bound default and dynamic placeholder

```json
{
  "type": "textarea",
  "x": 20,
  "y": 100,
  "width": 320,
  "height": 140,
  "label": "Technician notes",
  "fieldName": "technicianNotes",
  "rows": 4,
  "defaultSource": { "mode": "property", "value": "Step.PriorTechNotes" },
  "placeholderSource": { "mode": "input", "value": "promptText" }
}
```

Effective visible lines: 4, from the explicit `rows`. Pre-fill comes from the named Value Property; the placeholder text is resolved at runtime from the named step input parameter.
