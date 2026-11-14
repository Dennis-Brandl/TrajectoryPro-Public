# Trajectory Pro — Mission FormKit Implementation Specification

Version: 1.2 (2026-11-14). Reference code: superproject `32a6da8e`, MissionFormKit `963b03b`
(`@mission/form-schema`, `@mission/form-tokens`, `@mission/form-renderer` 0.1.0), Mission Pilot 2.2.3,
Mission Engine 1.2.2 — the code with the Appendix X rulings of 2026-11-14 and the fixed-row layout of
§L.3. Line references (`[src: …]`) were taken from the 1.0 code (superproject `53a03ed7`, FormKit
`2fa7e88`) and may be a few lines off in files those changes touched; a reference without a line
number names the place by file and symbol.

---

## 0. About this document

### 0.1 Purpose

This document specifies the **form screens** of Trajectory Pro well enough to build them again on a
different platform: a native Android phone or tablet app, for example, or any other client that is
not the React web renderer. It covers:

1. the **form document** — the JSON an author builds in Mission Designer for a User Interaction or
   Yes/No step (Part 1);
2. how that document is **laid out** on a phone, a tablet or a desktop screen (Part 2);
3. how each **block** looks and behaves (Part 3);
4. the **field values, events and the completion gate** (Part 4);
5. the step's **buttons**: form buttons with a job, the buttons a host adds, and the fixed button
   row with Back and Stop (Part 5);
6. **theme and colour**: the design tokens, light/dark, and the authored-colour contrast guard (Part 6);
7. the **host**: what an app that runs a step screen must do around the form — seed values, gate the
   buttons, submit, sign, go Back, Stop, Release, keep drafts (Part 7);
8. **platform notes** that map the web mechanisms to native ones (Part 8).

A native implementation that follows Parts 1–7 shows the same screen, captures the same values and
sends the same requests as Mission Pilot does today.

### 0.2 Scope

In scope: everything between "the engine handed this operator a claimed step" and "the operator's
answer was accepted". That is FormKit's renderer (run mode) plus the part of Mission Pilot's
`TaskScreen` that drives it.

Out of scope, with where to look instead:

| Topic | Where |
|---|---|
| Sign-in, work centers, the inbox list, claim, presence, SSE, the Workflows tab | `docs/MISSION_ENGINE_SPEC.md` Part 3 (B.3–B.6) |
| What the engine does with a submit, a Back or a Stop | `docs/MISSION_ENGINE_SPEC.md` C.4.11, C.7, B.5.11–B.5.13 |
| Mission Designer's form editor (edit mode, drag and drop, inspector) | Not specified; edit mode is summarised in §R.0 only |
| The v1→v2 form converter (`form-schema/src/convert/`) | Designer-only import path; Pilot never receives a v1 form (engine spec A.7.3) |
| The FormKit prototype shell (`apps/form-shell`) | A prototype host; its rules are the same as §H but its engine is a mock |

### 0.3 Conformance language

**MUST**, **MUST NOT**, **SHOULD**, **MAY** are used as in RFC 2119. A statement without one of them
describes the reference implementation and is normative unless it is marked *(observed)*, which
means "this is what the code does; it may be a defect". Appendix X records the behaviour that was
checked and ruled on (2026-11-14).

### 0.4 Citations

`[src: path:line]` points at the code a statement was read from. Paths are relative to the
superproject root. Packages are abbreviated:

| Short form | Path |
|---|---|
| `schema/` | `MissionFormKit/packages/form-schema/src/` |
| `renderer/` | `MissionFormKit/packages/form-renderer/src/` |
| `tokens/` | `MissionFormKit/packages/form-tokens/` |
| `pilot/` | `MissionPilot/src/` |

### 0.5 Relationship to other documents

- `MissionFormKit/docs/HOST-CONTRACT.md` — the web host's obligations, written for React hosts. This
  document restates them platform-neutrally in Part 7; where they differ, this document follows the
  code.
- `MissionFormKit/docs/CONVENTIONS.md` — rules for contributing to the web kit (inline styles,
  rich-text sink, mode guards).
- `MissionDesigner/docs/superpowers/specs/2026-07-13-pwa-form-document-v2-design.md` — the original
  v2 design. Its §4 says the golden fixture suite "is the contract any future non-web renderer must
  pass" (see Appendix C).
- `docs/MISSION_ENGINE_SPEC.md` — the engine side of the same wire. Section references of the form
  "engine spec B.5.11" point there.

### 0.6 System context

```
 Mission Designer ── authors form_document ──► workflow JSON (step.form_document)
                                                      │ frozen into the runtime
                                                      ▼
 Mission Engine ── GET /api/inbox ──► InboxTask.formDocument (tokens filled, lists filled)
       ▲                                              │
       │ POST /api/assignments/:id/submit|back|stop   ▼
       └────────────────────────────── HOST (Mission Pilot today; your app tomorrow)
                                         │  owns values, gate, signature draft, drafts
                                         ▼
                                      RENDERER (FormKit) — draws one screen, emits events
```

The renderer draws exactly one form document — one screen. It owns presentation and two pieces of
private state (timer runs and the set of settled timers). Everything else belongs to the host.
[src: MissionFormKit/docs/HOST-CONTRACT.md:5-20]

### 0.7 Document map

| Part | Sections | Subject |
|---|---|---|
| 1 | F.1–F.6 | Form document JSON |
| 2 | L.1–L.8 | Screen types and layout |
| 3 | R.0–R.13 | Blocks |
| 4 | V.1–V.5 | Values, events, completion gate |
| 5 | K.1–K.6 | Buttons and the fixed button row |
| 6 | T.1–T.5 | Theme, tokens, colour guard |
| 7 | H.1–H.13 | The host |
| 8 | P.1–P.6 | Platform notes for native ports |
| App. X | | Behaviour notes and open points |
| App. C | | Conformance checklist and fixtures |

---

# Part 1 — Form document (sections F.x)

## F.1 Root

```json
{ "version": 2, "sections": [ Section, ... ] }
```

| Field | Type | Rule |
|---|---|---|
| `version` | const `2` | Required. |
| `sections` | `Section[]` | Required. May be empty. |

No other root field is allowed (`additionalProperties: false`).
[src: schema/types.ts:277-280; schema/schema/form-document.json (root)]

Hierarchy: **document → sections → rows → blocks**. A section is either `content` (scrolls) or
`footer` (stays at the bottom). A row is one 12-column grid. A block is one element on the screen.

## F.2 Section, Row, LayoutRow

**Section**

| Field | Type | Rule |
|---|---|---|
| `id` | string, min length 1 | Required. |
| `role` | `"content"` \| `"footer"` | Required. |
| `rows` | `Row[]` | Required; may be empty. The **desktop** arrangement and the only place blocks live. |
| `rowsAt` | `{ tablet?: LayoutRow[], phone?: LayoutRow[] }` | Optional per-screen re-arrangement by block id (§L.4). |

**Row**

| Field | Type | Rule |
|---|---|---|
| `id` | string, min length 1 | Required. |
| `gap` | SpaceToken | Optional; default `md` when drawn. [src: renderer/FormDocumentView.tsx:238] |
| `blocks` | `Block[]` | Required, **at least one**. |

**LayoutRow** (only inside `rowsAt`)

| Field | Type | Rule |
|---|---|---|
| `id` | string, min length 1 | Required. |
| `gap` | SpaceToken | Optional. |
| `blockIds` | string[] (each min length 1) | Required, at least one. Ids of blocks in the same section's `rows`. |

[src: schema/types.ts:244-275; form-document.json#/definitions/row, layoutRow, section]

## F.3 Shared value types

| Name | Values |
|---|---|
| SpaceToken | `none` `xs` `sm` `md` `lg` `xl` |
| TypeToken | `xs` `sm` `md` `lg` `xl` `2xl` `3xl` |
| GridSpan | integer 1–12 |
| PerBreakpoint\<T\> | `{ base: T, tablet?: T, phone?: T }` — `base` is **required** in JSON |
| SizeAt | `{ tablet?: TypeToken, phone?: TypeToken }` |
| ScalePercentAt | `{ tablet?: int 10–300, phone?: int 10–300 }` |
| OptionEntry | `{ label: string, value: string }` (both required) |
| ListItemSource | `{ mode: "static" }` or `{ mode: "input", value: string }` |
| ParameterDefaultSource | `{ mode: "static"\|"property"\|"input", value: string }` |
| ButtonJob | `continue` `yes` `no` |

[src: schema/types.ts:16-79; form-document.json#/definitions]

**BlockLayout** (`block.layout`, optional on every block; required on `image`):

| Field | Type | Default | Rendered? |
|---|---|---|---|
| `span` | PerBreakpoint\<GridSpan\> | 12 | Yes (§L.5) |
| `order` | PerBreakpoint\<int 0–12\> | none (= 0, automatic) | Yes (§L.5) |
| `visible` | PerBreakpoint\<boolean\> | true | Yes (§L.6) |
| `align` | `start` \| `center` \| `end` | none | Yes (§L.7) |
| `aspectRatio` | string matching `^[1-9][0-9]*\s*/\s*[1-9][0-9]*$` (e.g. `"16/9"`) | image: required; video: `16/9` | Yes (image, video only) |
| `minHeight` | SpaceToken or `{ rem: number > 0 }` | none | Yes (§L.5a) |
| `maxWidth` | `{ ch: number > 0 }` or `{ rem: number > 0 }` | none | Yes (§L.5a) |

[src: schema/types.ts:49-64; form-document.json#/definitions/blockLayout; renderer/blockClasses.ts:21-37]

## F.4 Blocks

Every block has `id` (string, min length 1, required), `type` (required) and optional `layout`.
No block allows fields beyond those listed (`additionalProperties: false`). There are twelve types.
[src: schema/types.ts:81-242; form-document.json#/definitions/block]

### F.4.1 `text` and `header`

| Field | Type | Req. | Default |
|---|---|---|---|
| `content` | string (sanitized HTML, §R.1) | yes | — |
| `size` | TypeToken | | text `md`, header `xl` |
| `sizeAt` | SizeAt | | — |
| `fontWeight` | `normal` \| `bold` | | text: normal; **header: bold** |
| `color` | string (CSS colour) | | theme text colour |
| `align` | `left` \| `center` \| `right` | | left |

### F.4.2 `textInput`

| Field | Type | Req. | Notes |
|---|---|---|---|
| `fieldName` | string, min 1 | yes | Key into the values map. |
| `label` | string | | Shown above the control. |
| `placeholder` | string | | |
| `required` | boolean | | |
| `inputMode` | `text` `number` `phone` `password` `dropdown` `combobox` | | default `text` |
| `listItems` | OptionEntry[] | | Choices for `dropdown`/`combobox`. |
| `listSource` | ListItemSource | | `input` mode: the engine fills `listItems` (§H.2). |
| `outputParameter` | string | | Engine capture binding (engine spec A.7.2). Opaque to the renderer. |
| `defaultSource` | ParameterDefaultSource | | `static`: the host seeds it. `property`/`input`: the engine resolves it and ships it as `static` (§H.2, §H.4). |
| `placeholderSource` | ParameterDefaultSource | | The engine resolves it and ships the result as `placeholder` (§H.2). |
| `size`, `sizeAt` | TypeToken, SizeAt | | default `md` |

### F.4.3 `textarea`

As `textInput` without `inputMode`/`listItems`/`listSource`, plus `rows` (integer ≥ 1, default 4).

### F.4.4 `checkbox` and `radio`

| Field | Type | Req. | Notes |
|---|---|---|---|
| `fieldName` | string, min 1 | yes | |
| `options` | OptionEntry[] | yes | May be empty; `listSource: input` replaces it (§H.2). |
| `label` | string | | Group label. |
| `required` | boolean | | |
| `listSource` | ListItemSource | | |
| `outputParameter` | string | | |
| `size`, `sizeAt` | | | default `sm` |

### F.4.5 `image`

| Field | Type | Req. | Notes |
|---|---|---|---|
| `src` | string, min 1 | yes | `http(s)://` URL, `data:` URI, or a **bare filename** resolved by the host (§H.10). |
| `layout.aspectRatio` | see F.3 | **yes** | The JSON Schema requires `layout` with `aspectRatio`. |
| `imageOid` | string | | Not used at runtime. |
| `objectFit` | `contain` `cover` `fill` | | default `contain` |
| `scalePercent` | int 10–300 | | default 100 |
| `scalePercentAt` | ScalePercentAt | | |

### F.4.6 `video`

`src` (string, min 1, required), `posterUrl` (string, optional). Aspect ratio from `layout.aspectRatio`,
default `16/9`.

### F.4.7 `divider`

`weight` (`hairline` default, or `thick`), `color` (optional).

### F.4.8 `timer`

| Field | Type | Req. | Notes |
|---|---|---|---|
| `label` | string | yes | |
| `fieldName` | string, min 1 | yes | Names the timer in events and in the gate. |
| `durationSeconds` | integer ≥ 1 | yes | |
| `direction` | `countdown` \| `countup` | yes | |
| `blockDone` | boolean | | true = the step cannot complete until the timer settles. |
| `outputParameter` | string | | The elapsed seconds are written here (§R.10). |
| `defaultSource` | ParameterDefaultSource | | A starting value for the field until the timer settles (§H.4). |
| `size`, `sizeAt` | | | default `md` |

### F.4.9 `button`

| Field | Type | Req. | Notes |
|---|---|---|---|
| `label` | string | yes | May be empty for a job button (the host's word is used). |
| `outputValue` | string, min 1 | yes | Job buttons use `continue` / `true` / `false`. |
| `job` | ButtonJob | | §K.1. |
| `color` | string | | Background colour. |
| `emphasis` | `primary` \| `secondary` | | default `primary` |
| `deletable` | boolean | | Editor-only. |
| `size`, `sizeAt` | | | No default: an unsized button inherits the form's font size. |

### F.4.10 `esignature`

| Field | Type | Req. | Notes |
|---|---|---|---|
| `fieldName` | string, min 1 | yes | The engine writes the signer's display name here after verification. |
| `label` | string | | Heading; default `E-signature`. |
| `meaning` | string | | What the signer attests to. |
| `roleName` | string | | Role the signer must hold in this work center; empty = any member. |
| `requireDifferentUser` | boolean | | The signer must not be the operator holding the step. |
| `outputParameter` | string | | |

At most one e-signature block is meaningful: the first in document order (walking desktop `rows`)
supplies the role and different-user rules. If an author adds more, **all** are drawn and share the
one signature draft, every one's `fieldName` enters the gate, and only the first's is exempt for No
(§H.5), so No stays gated. A port MUST draw them all the same way. [src: schema/esignature.ts:23-32;
schema/validation.ts:72-73; pilot/screens/TaskScreen.tsx:337]

## F.5 Document validation

A document is **valid** when it satisfies the JSON Schema `schema/schema/form-document.json` (draft-07)
**and** every `id` of a section, row or block is unique across the whole document. Error strings are
`"<instancePath or /> <message>"` and `"duplicate id: <id>"`. [src: schema/validate.ts:31-49]

`rowsAt` layout-row ids are **not** part of the uniqueness check, and `blockIds` are not checked for
existence — the renderer tolerates stale ids (§L.4).

A host **MUST NOT** refuse to show a document because it fails validation. Pilot checks only that the
payload is an object with an array `sections`; anything else is treated as "no form" (§H.3).
[src: pilot/screens/TaskScreen.tsx:115-119]. A native renderer **SHOULD** skip a block whose `type`
it does not know rather than fail the screen (the web renderer cannot meet a new type at runtime,
because its dispatch is exhaustive at compile time [src: renderer/blocks/index.tsx:33-63]).

## F.6 Minimal example

```json
{
  "version": 2,
  "sections": [
    { "id": "s1", "role": "content", "rows": [
      { "id": "r1", "blocks": [
        { "id": "b1", "type": "header", "content": "Batch {{BatchId}}" } ] },
      { "id": "r2", "blocks": [
        { "id": "b2", "type": "textInput", "fieldName": "weight", "label": "Weight (kg)",
          "required": true, "inputMode": "number", "outputParameter": "Weight",
          "layout": { "span": { "base": 6, "phone": 12 } } },
        { "id": "b3", "type": "timer", "label": "Cure", "fieldName": "cure",
          "durationSeconds": 120, "direction": "countdown", "blockDone": true,
          "layout": { "span": { "base": 6, "phone": 12 } } } ] } ] },
    { "id": "s2", "role": "footer", "rows": [
      { "id": "r3", "blocks": [
        { "id": "b4", "type": "button", "label": "", "outputValue": "continue", "job": "continue",
          "layout": { "span": { "base": 12 }, "align": "center" } } ] } ] }
  ]
}
```

---

# Part 2 — Screen types and layout (sections L.x)

## L.1 Screen types (breakpoints)

There are three screen types. The type is decided by the **width of the form's own container**, not
the device or the window. [src: renderer/FormDocumentView.tsx:88-92; renderer/layout.css:25-27,93-136]

| Key | Name in Designer | Container width (CSS px / Android dp) |
|---|---|---|
| `base` | Desktop | ≥ 1024 |
| `tablet` | Tablet | 600 – 1023 |
| `phone` | Phone | < 600 |

The thresholds are also tokens (`breakpoint.tabletMinPx` 600, `breakpoint.desktopMinPx` 1024).
[src: tokens/tokens/form.json; tokens/src/index.ts:16]

A native port **MUST** measure the width available to the form (after the host's own margins and
side panels) and re-decide the screen type whenever that width changes (rotation, split screen,
a side panel opening). It SHOULD decide before the first frame is shown, so a phone never flashes the
desktop arrangement. (The web renderer measures before paint, and keeps desktop `rowsAt` resolution
while no width is known yet.) [src: renderer/FormDocumentView.tsx:94-117]

> In Mission Pilot the form column is capped at 68rem (1088 px), above the 1024 px desktop threshold,
> so a wide window shows the form's desktop layout (ruling 2026-11-14, X.4). A native tablet SHOULD
> use the same cap (1088 dp).

## L.2 The cascade

Every per-screen value resolves **phone → tablet → desktop**: a phone value wins on a phone; else the
tablet value; else the desktop (`base`) value; else the default. Tablet never looks at phone.
[src: schema/resolve.ts:25-30]

The same rule applies to `span`, `order`, `visible`, `sizeAt` (falling back to `size`), `scalePercentAt`
(falling back to `scalePercent`, then 100) and `rowsAt`. [src: schema/resolve.ts:33-55; schema/layout-rows.ts:24-28]

## L.3 Screen structure

```
┌────────────────────────────── form viewport ──────────────────────────────┐
│ ┌──────────────────────── scroll region (flex 1) ───────────────────────┐ │
│ │ content section 1   (padding md; rows separated by md)                │ │
│ │ content section 2   (padding md, top padding 0)                       │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ─────────────────────── 1px border, colour `border` ─────────────────────  │
│ footer section(s)     (not scrolled; only drawn when at least one exists)  │
└───────────────────────────────────────────────────────────────────────────┘
```

- Content sections are drawn in document order inside one vertically scrolling region; footer
  sections are drawn in document order below it, outside the scroll, with a 1 px top border.
  Sections are partitioned by role first, so a footer that comes before a content section in the
  JSON is still drawn at the bottom. [src: renderer/FormDocumentView.tsx:188-211; renderer/layout.css:38-39]
- The viewport fills its parent's height (`height: 100%`) and paints the `surface` colour with the
  `text` colour, the form font family, size `md` and body line height. [src: renderer/layout.css:25-36]
- Every section has padding `md` on all sides; a section directly after another in the same region
  has top padding 0. Rows within a section are separated by `md`. [src: renderer/layout.css:41-45]

Pilot additionally keeps the footer of a legacy step, or the fixed button row of a fixed-row step
(§K.5), **visible at the bottom of the screen** while the content scrolls (sticky, opaque form
surface). On a fixed-row step the footer does **not** stick; it flows above the row (X.13).
[src: pilot/pilot.css:279-293] A native host **SHOULD** do the same: the step's button must never
scroll out of reach, and nothing may show through it.

On a **fixed-row step** the row is **always at the bottom of the screen**, also when the form is too
short to push it there (user 2026-11-14), so the step's buttons sit in one place on every screen:

- the task screen fills the height of its scroll pane; the form column stretches to the bottom and is
  painted with the form surface, so the form and the row read as one card, with the empty space (if
  any) between the form's content and the row;
- the row is pushed to the bottom of that column; a longer form grows the column and the row sticks
  to the bottom while the form scrolls, as above;
- Pilot's scroll pane keeps 16 px (`--pilot-space-4`) of padding at the bottom, so the row ends 16 px
  above the pane's edge in both cases; that strip is painted with the form surface too, so nothing is
  ever visible below the row. A legacy step's sticky footer gets the same strip.

[src: pilot/pilot.css (".task-screen-fixed-bar", ".task-screen .tfk-step-bar")] A native host on a
fixed-row step **SHOULD** pin the row to the bottom edge of the step screen at all times (e.g. a
column whose scrolling content area takes the remaining height above the row).

## L.4 Per-screen rows (`rowsAt`)

A section's `rows` is the desktop arrangement and the only home of its blocks. `rowsAt.tablet` and
`rowsAt.phone` re-arrange the same blocks by id. Resolution for screen type `bp`
[src: schema/layout-rows.ts:24-28,51-81]:

1. `bp = base`, or no `rowsAt`: use `rows` as they are.
2. Pick the arrangement: tablet → `rowsAt.tablet`; phone → `rowsAt.phone ?? rowsAt.tablet`. None → step 1.
3. Walk the arrangement's layout rows in order. Skip a layout row whose `id` was already used by an
   earlier row **that kept at least one block** (a row that ended up empty does not reserve its id). For each
   id in `blockIds`, take the block with that id from the section's `rows` — skip an unknown id and an
   id already placed. A layout row left with no blocks is dropped. Keep the layout row's `gap` if set.
4. **No block is ever lost**: after the arranged rows, every block not yet placed is shown, grouped by
   its desktop row, in desktop order. Such a leftover row keeps its desktop `id` and `gap`; if that id
   was already used, `~<bp>` is appended until it is unique.

Only `rows` vs `rowsAt` is decided in code; spans, order and visibility still come from each block's
`layout` (§L.5–L.6). In the web renderer this measurement only runs for a document that has `rowsAt`
in some section; others are drawn with desktop rows and let the CSS do the rest — the result is the
same. [src: renderer/FormDocumentView.tsx:139-141]

## L.5 The 12-column row grid

Each row is a grid of **12 equal columns** with gap = the row's `gap` token (default `md`) between
columns **and** between wrapped lines. [src: renderer/layout.css:44-51]

Placement algorithm (this is CSS Grid auto-placement, "sparse", one row element at a time):

1. Drop blocks that are hidden on this screen type (§L.6). They take no space.
2. Sort the remaining blocks by their resolved `order` value; a block with **no** `order`, or with
   `0`, is **automatic** and counts as 0 — so automatic blocks come before every block numbered 1–12 —
   and ties keep document order. This is the specified behaviour (ruling 2026-11-14, X.5); Designer
   explains it beside the Order field. [src: renderer/blockClasses.ts:27-30; renderer/layout.css:87-90]
3. Lay blocks left to right. Each takes `span` columns (resolved, default 12). If a block does not fit
   in the columns left on the current line, it starts a new line at column 1. Never back-fill a gap
   on an earlier line.
4. A line's height is the tallest block on it. Block widths are
   `span × colWidth + (span − 1) × gap`, with `colWidth = (rowWidth − 11 × gap) / 12`.
5. A block's content may be narrower than its cell; it never overflows it (`min-width: 0`).
   [src: renderer/layout.css:53]

## L.5a A block's own size limits

`layout.minHeight` and `layout.maxWidth` act on the block's **content**, not on its grid cell
(ruling 2026-11-14, X.1):

- `minHeight`: the content is at least that tall — a space token (`none` 0, `xs` 0.25rem, `sm` 0.5rem,
  `md` 1rem, `lg` 1.5rem, `xl` 2.5rem) or `rem`. A text area grows to fill the extra height.
- `maxWidth`: the content is at most that wide, in `ch` (of the content's own font) or `rem`. It sits
  at the start of its cell; text with `align` centre/right still moves to the centre/right of the
  cell (§R.1).
- Neither changes the cell, so spans, hiding and `layout.align` work as before.

[src: renderer/blockClasses.ts (blockLayoutStyle); renderer/layout.css (".tfk-block[data-min-height]")]

## L.6 Visibility

`layout.visible` resolved by the cascade; `false` hides the block on that screen type only.
[src: renderer/blockClasses.ts:31-33; renderer/layout.css:91,111-112,133-135]

> Hidden blocks **still count** in the completion gate. So that this never strands an operator,
> Designer refuses to export a form whose required field or `blockDone` timer is hidden on any
> screen type (`findHiddenRequired`; ruling 2026-11-14, X.6).

## L.7 Alignment

`layout.align` places the block vertically in its grid line (`start` top, `center`, `end` bottom).
No `align` means the cell stretches to the line height, which for every block type looks the same
as `start`. [src: renderer/blockClasses.ts:34; renderer/layout.css:54-56]

Two block types also use `align` horizontally [src: renderer/layout.css:57-72]:

- **button**: the button sits at the left, centre or right of its cell. No `align` = left.
- **image**: when the media box is narrower than its cell (scale < 100), it moves left, centre or
  right; with `objectFit: contain`, the picture inside a wider box moves the same way. No `align` =
  the box sits left and the picture is centred.

Text and headers have their own `align` field (§R.1), separate from `layout.align`.

## L.8 Metrics (default tokens)

All lengths assume 1rem = 16 px (= 16 dp at the default text scale; §T.3).

| Use | Token | Default |
|---|---|---|
| Section padding; space between rows; default row gap | `space.md` | 16 px |
| Label-to-control gap; option spacing | `space.xs` | 4 px |
| Checkbox/radio box-to-label gap | `space.sm` | 8 px |
| Button horizontal padding | `space.lg` | 24 px |
| Control padding | `control.paddingY` / `paddingX` | 8 / 12 px |
| Minimum touch target (controls, options, buttons) | `touch.minTarget` | 44 px — never reduced |
| Corner radius of controls, buttons, media | `radius.control` | 6 px |
| Text line-length cap | `measure.text` | 70 characters |
| Line height | body / heading | 1.4 / 1.2 |

[src: tokens/tokens/form.json; renderer/controls.css:20-131]

---

# Part 3 — Blocks (sections R.x)

## R.0 Modes

The renderer has two modes. **run** is the operator screen and is the subject of this document.
**edit** is Designer's canvas: identical layout, all controls inert, timers frozen (countdown shows the
full duration, count-up shows 00:00), and **no event is ever emitted**. A native port that only runs
steps needs run mode only. If it implements edit mode, the guard against events MUST be in each
control, not only on an outer "disabled" wrapper. [src: renderer/FormDocumentView.tsx:154-156,182-183;
renderer/blocks/TimerBlockView.tsx:113-120; MissionFormKit/docs/HOST-CONTRACT.md:121-130]

Every block reads the current value of its `fieldName` from the host's values map and never changes it
itself; it reports changes as `fieldChange` events (§V.2).

## R.1 Text and header

- `content` is **HTML**. It MUST be sanitized before display (the reference uses DOMPurify's `html`
  profile; script, event handlers and `javascript:` URLs never survive). If sanitization cannot run,
  the renderer MUST fail rather than show unsanitized markup. [src: renderer/sanitize.ts:20-30]
- The HTML Designer produces is TipTap StarterKit output plus coloured spans: `<p>`, `<br>`,
  `<strong>`, `<em>`, `<s>`, `<u>`, `<code>`, `<a href>`, `<h1>`–`<h6>`, `<ul>`/`<ol>`/`<li>`,
  `<blockquote>`, `<pre>`, `<hr>`, and `<span style="color: …">`. A single paragraph is stored
  unwrapped (plain inline HTML). Older documents may hold plain text with newlines.
  [src: MissionDesigner/src/components/form-designer/v2/content-editor/ContentEditorDialog.tsx:70,107-109]
  A native renderer MUST support at least bold, italic, line breaks, paragraphs and coloured spans,
  and SHOULD support the rest; unknown markup MUST degrade to its text.
- In **text** blocks, whitespace and newlines are kept as written (`white-space: pre-wrap`). In
  **header** blocks they collapse as in normal HTML (a newline is a space). [src: renderer/controls.css:32,37]
- `{{Name}}` tokens have already been replaced by the engine before the document arrives (values are
  HTML-escaped). The renderer does no substitution. (engine spec A.7.1, B.5.6)
- **Text**: default size `md`; bold only when `fontWeight: "bold"`. **Header**: default size `xl`;
  bold unless `fontWeight: "normal"`; line height 1.2; announced as a level-2 heading.
  [src: renderer/blocks/TextBlockView.tsx:22-31; renderer/blocks/HeaderBlockView.tsx:21-30; renderer/controls.css:37]
- `align`: left (default), centre, right — of the text within the block's **cell**. Text blocks are
  capped at 70 characters wide; a centred or right-aligned capped box moves within the cell so the
  alignment is measured from the cell. (Headers have no cap.) [src: renderer/controls.css:32-36]
- `color` colours the whole block, through the contrast guard (§T.4). Colours on spans inside the HTML
  go through the same guard one by one; a dropped span colour leaves the text and its other styling.
  [src: renderer/blocks/common.tsx:144-161]

## R.2 Field label (shared)

Inputs, textareas and timers show `label` above the control (never beside it), size `sm`, weight 500.
A required field adds a red ` *` (colour `danger`), which is decorative; required-ness is announced
by the control itself. No label → nothing is drawn.

What a block's `size`/`sizeAt` resizes: labels, hints and error text are always `sm` and do **not**
follow it. On inputs and textareas it sizes the control's text; on checkbox/radio groups the option
labels (not the group label); on a timer only its Stop button (the time display is always `2xl`).
[src: renderer/controls.css:39-41,118-119,130-131] [src: renderer/blocks/common.tsx:43-79;
renderer/controls.css:39-41]

## R.3 Text input

Value: the string in `values[fieldName]`, or empty when absent or not a string.
[src: renderer/blocks/TextInputBlockView.tsx:22]

| `inputMode` | Control | Behaviour |
|---|---|---|
| `text` (default) | single-line text | Every edit emits `fieldChange` with the full string. |
| `password` | masked single-line | as text |
| `phone` | single-line, phone keyboard | as text |
| `number` | single-line, numeric keyboard | **Refuses** any edit that could never become a number (§R.3.1). While the text is not a complete number, shows `Enter a number` under the field (colour `danger`) and marks the field invalid. |
| `dropdown` | single choice list | First entry is an empty-valued `placeholder` (or `Select...`); then `listItems` in order, showing `label`, storing `value`. |
| `combobox` | free text with suggestions | The operator may type anything; `listItems` are offered as suggestions (showing `label`, inserting `value`). |

[src: renderer/blocks/TextInputBlockView.tsx:19-102]

### R.3.1 Number rules

- Complete number: `^-?(\d+\.?\d*|\.\d+)$` after trimming — e.g. `5`, `-5`, `5.`, `5.25`, `.5`.
- Partial number (accepted while typing): `^-?\d*\.?\d*$` after trimming — e.g. empty, `-`, `.`, `-.`.
- An edit producing text that is not partial is ignored: the field keeps its previous text and no
  event fires. No thousands separators, exponents or locale decimal commas.
- The value stays a **string**, untrimmed: spaces around a number are kept and submitted.
- A value of only spaces counts as **empty** (ruling 2026-11-14, X.14): no error is shown, it does not
  block an optional field, and it is missing on a required one.
  [src: schema/validation.ts:25-33,65-66; renderer/blocks/TextInputBlockView.tsx:28-30,83-86]

## R.4 Textarea

Multi-line text, `rows` visible lines (default 4), placeholder, label. Every edit emits `fieldChange`.
[src: renderer/blocks/TextareaBlockView.tsx:18-36]

## R.5 Checkbox group

A group label (§R.2), then one checkbox per `options` entry showing `label`. The value is a **string
array** of the ticked options' `value`s, always **in option order**, whatever order they were ticked
in. A value that is not an array reads as nothing ticked. [src: renderer/blocks/CheckboxBlockView.tsx:18-45]
Each option row is at least 44 px high; the box is 20 × 20 px in the `accent` colour.
[src: renderer/controls.css:72-73]

## R.6 Radio group

As the checkbox group, but one choice: the value is the chosen option's `value` (a string); a
non-string value reads as nothing chosen. Selecting emits `fieldChange`. Options with the same `value`
both show as selected. [src: renderer/blocks/RadioBlockView.tsx:18-43]

## R.7 Image

- Source: an `http://` or `https://` `src` is used as is. Anything else is passed to the host's image
  resolver (§H.10). A resolver answer of "none" draws a placeholder box — dashed border, muted text,
  showing the `src` text. [src: renderer/blocks/ImageBlockView.tsx:20-41; renderer/controls.css:109-113]
- The media box has the authored `aspectRatio`, rounded corners, and clips its content.
- Width = scale% of the cell (cascade §L.2; default 100%; may exceed 100%, up to 300%). The height
  follows from the aspect ratio. [src: renderer/controls.css:103-104,136,146]
- `objectFit`: `contain` (whole picture, letterboxed; default), `cover` (fill, cropped), `fill`
  (stretched). Alignment: §L.7.
- The picture has no accessible description (`alt=""`).

## R.8 Video

- A YouTube URL (`youtube.com/watch?v=ID`, `youtu.be/ID`, `/shorts/ID`, `/embed/ID`, `/live/ID`; hosts
  `youtube.com`, `youtube-nocookie.com`, `youtu.be`, with an optional `www.` or `m.`; the id is at
  least 6 of `[A-Za-z0-9_-]`) plays as the embedded YouTube player from
  `https://www.youtube-nocookie.com/embed/<ID>`. [src: renderer/blocks/VideoBlockView.tsx:22-38,40-57]
- Anything else is a direct media URL played by a native player with controls, nothing preloaded,
  `posterUrl` as the still image.
- Box aspect ratio `layout.aspectRatio` or `16/9`. Video never autoplays.

## R.9 Divider

A horizontal rule across the cell: 1 px (`hairline`, default) or 3 px (`thick`), colour `border` or the
authored `color` through the contrast guard. [src: renderer/blocks/DividerBlockView.tsx:17-27;
renderer/controls.css:115-116]

## R.10 Timer

The timer is the one block with behaviour of its own.

**Display**: label above; the time as `MM:SS` in size `2xl` with tabular (fixed-width) digits. Minutes
are not wrapped at 60 (`90:00` for 90 minutes) and never negative. Countdown shows
`durationSeconds − elapsed`; count-up shows `elapsed`. [src: renderer/blocks/TimerBlockView.tsx:19-24,113-125;
renderer/controls.css:118-119]

**Clock**: elapsed = `floor((now − startedAt) / 1 s)` clamped to `[0, durationSeconds]`, computed from
the **wall clock**, not by counting ticks. The display refreshes once a second. A timer MUST keep true
time while the app is in the background or the device sleeps. [src: renderer/blocks/TimerBlockView.tsx:26-36]

**Life cycle** (run mode only):

1. **Start**: when the block first appears on a newly entered step instance. `startedAt = now`; emit
   `timerState {fieldName, state:"running", elapsedSeconds:0}`.
2. **Elapsed**: on the first refresh where elapsed ≥ duration — for **both** directions (a count-up
   stops at its duration too). Emit `timerState {state:"elapsed", elapsedSeconds: durationSeconds}`;
   the timer is **settled**.
3. **Stopped**: the operator presses the timer's **Stop** button (secondary style, shown under the time
   only while the timer runs). Re-read the clock, emit `timerState {state:"stopped",
   elapsedSeconds: <now>}`; the timer is settled.
4. After settling the display freezes, the Stop button disappears, and the renderer emits a fresh
   `validation` (§V.3).
5. Then the timer **writes its field**: `fieldChange {fieldName, value: "<elapsed whole seconds>"}`
   (`"90"`; the duration when it ran out). The value is submitted with the form and the engine writes
   it to the timer's `outputParameter` (ruling 2026-11-14, X.2). The `validation` that follows counts
   the timer as settled.

[src: renderer/blocks/TimerBlockView.tsx:69-111,126-130; renderer/FormDocumentView.tsx:182-186]

**Persistence across redraws**: the run (start time, settled value) is kept per block **id** for the
life of the step screen, so a timer that is redrawn because the screen type changed (rotation, §L.4)
carries on and does not restart or re-emit `running`. [src: renderer/context.ts:52-62;
renderer/blocks/TimerBlockView.tsx:40-47,71-76]

**Re-entry restarts**: a new step **instance** — a workflow loop back to the same step, or a Back that
reopens it — starts every timer from zero and re-closes its gate. This is specified behaviour, not a
bug. [src: MissionFormKit/docs/HOST-CONTRACT.md:100-119]

Before it settles the field holds only what the host seeded (a `static` default, a Back prefill or a
draft); a reopened or reloaded step restarts the timer, and the field is overwritten when it settles.

## R.11 Button

Drawn as a button at least 44 × 44 px, padding 8 × 24 px, radius 6 px, weight 500.
[src: renderer/controls.css:75-101]

- `emphasis: primary` (default): `accent` background, `accentText` text. `secondary`: `surface`
  background, `text` text, 1 px `border` outline.
- `color` replaces the background (through the contrast guard §T.4) — not while disabled.
- Size: only when `size` or `sizeAt` is set (default `md` then); otherwise the button inherits the
  form's font size.
- A **job** button's label, enabled state and click are governed by §K.1–K.2. A job-less button is
  always enabled; its click emits `action {blockId, outputValue}`.
- Disabled look: `surface` background, `textMuted` text, `border` outline, 55 % opacity; a disabled
  button emits nothing.

[src: renderer/blocks/ButtonBlockView.tsx:19-50]

## R.12 E-signature

One bordered box (1 px `border`, radius 6 px, padding 16 px) containing, in order
[src: renderer/blocks/ESignatureBlockView.tsx:24-75; renderer/controls.css:122-131]:

1. heading `label` or `E-signature` (weight 600);
2. `meaning`, if set;
3. a hint, muted, size `sm`: `Sign as: <roleName>` when a role is set, else
   `Any member of this work center`;
4. the host's **signature hint**, if any (e.g. `Must be signed by someone other than Jane Doe`, §H.7);
5. **Login name** — a text field, no auto-capitalisation, no spell-check, no autofill;
6. **Password** — a masked field, no saved-password autofill (`new-password`);
7. the host's **signature error**, if any, in `danger` colour, announced as an alert.

The two fields show the host's **signature draft** (§H.7), never the values map. Every keystroke emits
`signature {blockId, loginName, password}` with both current fields, followed by a `validation`
event. The draft MUST NOT be stored, logged or put into `values`.

## R.13 Accessibility (all blocks)

Required single controls (text, number, dropdown, **combo box**, text area) announce "required";
checkbox and radio groups carry "(required)" in their group name, hidden visually — a group with no
label gets a hidden name of just "Required" (ruling 2026-11-14, X.8); a radio group is announced as a radio group; an invalid number field
points at its error message; the e-signature error is an alert. A native port SHOULD map these to the
platform's accessibility properties (content description, error text, `isRequired`/state description).
[src: renderer/blocks/common.tsx:87-101; renderer/blocks/TextInputBlockView.tsx:38,76,79-80]

---

# Part 4 — Values, events, completion gate (sections V.x)

## V.1 The values map

`values` is a map from `fieldName` to `string | string[] | number` (Pilot only ever stores strings and
string arrays). It is **owned by the host**. The renderer shows `values[fieldName]` and reports edits;
the host applies them and redraws. [src: schema/events.ts:17-21; MissionFormKit/docs/HOST-CONTRACT.md:24-30]

Two blocks with the same `fieldName` share one value.

## V.2 Events

All events are plain JSON objects. In run mode the renderer emits:

| `kind` | Fields | When |
|---|---|---|
| `fieldChange` | `fieldName`, `value` | An input, textarea, choice group edit. |
| `timerState` | `fieldName`, `state` (`running`/`stopped`/`elapsed`), `elapsedSeconds` | §R.10. |
| `signature` | `blockId`, `loginName`, `password` | E-signature keystroke. |
| `job` | `blockId`, `job` | An enabled job button is pressed (§K.2). |
| `action` | `blockId`, `outputValue` | A job-less button is pressed. |
| `validation` | `ok`, `missing[]` | Right after a `fieldChange`, after a `signature`, and after a timer settles. |

`complete` and `decision` belong to the same vocabulary but come from host chrome, never from the
renderer. [src: schema/events.ts:28-38; renderer/FormDocumentView.tsx:154-164,182-186]

Order: for an edit, `fieldChange` is delivered **before** its `validation`; the `validation` is computed
as if the new value had already been applied. Same for `signature`.

## V.3 The completion gate — `computeValidation`

```
computeValidation(doc, values, settledTimers, signatureDraft?) -> { ok, missing[] }
```

Walk every block of every section's **desktop `rows`**, in document order (content and footer alike,
regardless of visibility). Add a `fieldName` to `missing` (once, even if several blocks share it) when
[src: schema/validation.ts:19-23,52-79]:

1. the block is `textInput`, `textarea`, `checkbox` or `radio`, `required` is true, and its value is
   absent, a string that is empty **after trimming**, or an empty array; **or**
2. the block is a `textInput` with `inputMode: "number"` (required or not) whose value is a string,
   non-empty after trimming, that is not a complete number (§R.3.1); **or**
3. the block is a `timer` with `blockDone: true` whose `fieldName` is not in `settledTimers`; **or**
4. the block is an `esignature` and the signature draft is missing or either field is blank after
   trimming. [src: schema/esignature.ts:35-37]

`ok` = `missing` is empty. The function is pure; a native port MUST implement exactly these rules.

A whitespace-only value (`"  "`) counts as **empty** (ruling 2026-11-14, X.9). The value itself is
submitted untrimmed.

## V.4 Who computes the gate (two authors)

The renderer emits `validation` only on the three triggers in V.2. It does **not** emit one when the
screen appears, when the host changes `values` itself (defaults, restored drafts, Back prefill) or
when the document changes. Therefore the host MUST compute the gate itself
[src: MissionFormKit/docs/HOST-CONTRACT.md:32-61]:

1. when a step instance is shown, before any event (with an **empty** settled-timer set — a new
   instance always starts its timers from zero);
2. whenever it changes `values` or the signature draft outside the event stream (e.g. clearing the
   password after a rejected signature — Pilot does this [src: pilot/screens/TaskScreen.tsx:222-230]).
   Except at step entry, this recompute MUST use the timers that have **actually** settled: keep a
   set from the `timerState` events (`elapsed`/`stopped`) and reset it with the step instance. Pilot
   does this (ruling 2026-11-14, X.12);

and otherwise adopt the `validation` events.

A native port MAY instead derive the gate continuously from `(doc, values, settledTimers, draft)`
whenever any of them changes. That gives the same answers and removes the two-author hazard; the
deferred design option in `MissionFormKit/docs/BACKLOG.md` §1 describes it.

## V.5 Step-instance identity

The form state (values, settled timers, timer runs, signature draft) belongs to one **step instance**
(`InboxTask.stepInstanceId`), not to a step. A host MUST start fresh — new timer runs, empty settled
set, reset draft — whenever the step instance id changes, even if the step and document are the same
(a loop straight back to the same step). It MUST NOT start fresh when only the task object is
refreshed for the same instance (every inbox push delivers a new copy), or the operator's typing is
lost. [src: MissionFormKit/docs/HOST-CONTRACT.md:71-98; pilot/screens/TaskScreen.tsx:176-201]

---

# Part 5 — Buttons (sections K.x)

## K.1 Jobs

A button's `job` says what it does for the step: `continue` (advance a User Interaction step), `yes`
or `no` (answer a Yes/No step). The renderer only draws it; the host decides whether it may be pressed
and what pressing means. Default words: `Continue`, `Yes`, `No`. Canonical `outputValue`s: `continue`,
`true`, `false`. [src: schema/buttons.ts:17-20]

The host supplies, per job, `{ enabled, label, describedBy? }`, plus `signed` (the step needs a
signature) and `actionsEnabled` (false = buttons **without** a job are drawn disabled and emit
nothing; Pilot always passes false — ruling 2026-11-14, X.7). [src: renderer/context.ts:18-37]

## K.2 Label and state of a job button

1. Label = the author's `label` if not blank; else the host's label for that job; else the default word.
2. If `signed` is true and the job is not `no`, the label becomes `signedLabel(label)`:
   `"Sign & <label>"`, unless the label already starts with the word "Sign" (case-insensitive, whole
   word), in which case it is unchanged; a blank label becomes `"Sign"`.
3. Enabled = the host's `enabled` for that job. Disabled → disabled look (§R.11), no event, and the
   button is described by the host's `describedBy` element.
4. A `continue` button advertises the shortcut Ctrl+Enter (the host wires the key, §H.12).
5. Pressing an enabled job button emits `job {blockId, job}` — never `action`.

[src: renderer/blocks/ButtonBlockView.tsx:25-45; schema/esignature.ts:44-47]

## K.3 Which form a host shows: two step kinds of button handling

A step either has a **fixed button row** (`InboxTask.buttonBar` non-null — the workflow step has
`button_bar.format: "fixed"`) or is a **legacy step** (no `buttonBar`). [src: pilot/screens/TaskScreen.tsx:366-373;
engine spec A.3.7, B.5.6]

| | Legacy step | Fixed-row step |
|---|---|---|
| Document drawn | `withStepButtons(doc, stepKind)` (§K.4) | `stripButtonBlocks(doc)` — every `button` block removed; rows emptied by that dropped; footer sections emptied by that dropped (content sections kept even if empty). No document → an empty one. |
| Step buttons | Inside the form | In the fixed row under the form (§K.5) |
| Back / Stop | Not offered | Offered when the task says so (§H.8) |

`stepKind` = `yesno` for a `YES_NO` step, else `continue`.
[src: schema/step-bar.ts:45-55]

## K.4 `withStepButtons` — making sure a legacy form has its button

Rule (user ruling 2026-11-10): the form's own button is the step's one button; the host draws none of
its own. Starting from the document (or an empty one) [src: schema/step-buttons.ts:30-81;
schema/convert-buttons.ts:31-119]:

1. **Give job-less buttons a job.** On a `continue` step every job-less button becomes a `continue`
   button. On a `yesno` step a job-less button with `outputValue` `true` becomes `yes`, `false` becomes
   `no`; any other stays job-less. A converted button gets the canonical `outputValue`; if its label was
   exactly the default word, the label is cleared (so the host's label shows).
2. **Add missing buttons.** Required jobs: `continue` step → `continue`; `yesno` step → `yes` and `no`.
   For each required job that no button has, add one button to a new row at the end of the **first
   footer section** (creating a footer section at the end if there is none): `label ""`, canonical
   `outputValue`, `emphasis: primary`, `layout {span {base: 12/n}, align: center}` where n = number of
   buttons added (1 or 2).
3. **Cover every screen type.** For each required job, find the screen types on which no button with
   that job is visible (§L.6). If any, add one more row at the end of the footer with a button per such
   job, `span 12/n`, centred, visible **only** on the screen types that lacked one.
4. Ids of added rows/blocks/sections are `pilot-step-button-1`, `-2`, … in creation order, so the same
   input always gives the same output. Creation order: in step 2, the footer section (only if one had
   to be created), then the row, then each button; in step 3, the row, then each button, then the
   footer section **last** (step 3 creates one only if none exists yet). Step-3 buttons always carry
   all three `visible` keys as booleans (`{base, tablet, phone}`); step-2 buttons have no `visible`.
   Key order of an added button: `id, type, layout, job, label, outputValue, emphasis`.
   [src: schema/convert-buttons.ts:84-102; schema/step-buttons.ts:48-80]

The result never leaves an operator without a way on, on any screen type.

## K.5 The fixed button row (`StepButtonBar`)

Drawn **below** the form, outside it, with a 1 px top border; a three-column row with padding
`space.md` × `space.lg` (16 × 24 px) and `space.md` (16 px) gaps. (The 8/16/12 px values in
`layout.css` are only fallbacks for a missing token.) [src: renderer/StepButtonBar.tsx:45-90;
renderer/layout.css:138-173; tokens/tokens/form.json:2]

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Back]                  [ Continue ]  or  [ Yes ] [ No ]      [Stop] │
└──────────────────────────────────────────────────────────────────────┘
```

- **Centre**: the step's job buttons — `continue` alone, or `yes` then `no` — primary style, labels and
  state by §K.2 rules 2–4; the label is the host's label for the job, or the default word when that is
  blank (there is no author label in the fixed row). A press calls the host directly — no `job` event
  and no `validation` are emitted. [src: renderer/StepButtonBar.tsx:103-119; pilot/screens/TaskScreen.tsx:470-474] Font size = `buttonBar.size` or `md`. Background colour: `continue` ← `buttonBar.color`,
  `yes` ← `buttonBar.yesColor`, `no` ← `buttonBar.noColor`, each through the contrast guard, none
  while disabled.
- **Left**: `Back` (when the host offers it). **Right**: `Stop` (when offered). Both are outlined,
  transparent buttons, at least 44 × 44 px, horizontal padding `space.md` (16 px), size `sm`; Stop's
  outline uses the muted text colour. Disabled: 55 % opacity.
- **Narrow**: on a narrow screen Back and Stop are **not drawn in the row**; the host shows them
  elsewhere (Pilot: Back in the line above the form, Stop in a `⋯` menu; §H.8). The host makes this
  one decision from **one** width — Pilot uses the width of the line above the form, < 600 px = narrow —
  and tells the row (`compact`), so Back and Stop always appear exactly once (ruling 2026-11-14, X.11).
  Without a host decision the row falls back to its own width.
- **Background**: the row paints the form surface colour, so a form scrolling under a stuck row never
  shows through it (ruling 2026-11-14, N1).
- **Footer content on a fixed-row step**: `stripButtonBlocks` keeps a footer section that still holds
  non-button blocks. That footer does **not** stick; it flows at the end of the form, directly above
  the row (ruling 2026-11-14, X.13). [src: pilot/pilot.css:279-293]

## K.6 Never-stuck check (Designer and host helper)

`checkNeverStuck(doc, stepKind)` lists problems for a form that has job buttons: any button whose job
the step cannot use (`continue` on a Yes/No step; `yes`/`no` on a Continue step), and every screen type
on which a required job has no visible button. A form with no job buttons has no problems.
[src: schema/buttons.ts:52-85] With §K.4 applied, a host does not need this check at runtime; it is
the authoring-time guard.

Alongside it, Designer refuses to export (rulings 2026-11-14, `schema/authoring-checks.ts`):

- `checkJoblessButtons(doc, "yesno")` — on a legacy Yes/No step, a button without a job whose
  `outputValue` is not `true`/`false` (§K.4 step 1 leaves it job-less, so it answers nothing; X.7);
- `findHiddenRequired(doc)` — a required field or `blockDone` timer hidden on any screen type (X.6);
- `findDuplicateOptionValues(doc)` — two options of one list with the same `value` (X.10; also
  refused when the form is saved). Lists filled from an input parameter keep only the first option of
  each value (§H.2).

---

# Part 6 — Theme and colour (sections T.x)

## T.1 Form tokens

The form's look comes from the tokens in `MissionFormKit/packages/form-tokens/tokens/form.json`
(Part 2 §L.8 lists the spacing ones). Type sizes:

| Token | `xs` | `sm` | `md` | `lg` | `xl` | `2xl` | `3xl` |
|---|---|---|---|---|---|---|---|
| rem | 0.75 | 0.875 | 1 | 1.125 | 1.5 | 2 | 2.5 |
| px at 16 | 12 | 14 | 16 | 18 | 24 | 32 | 40 |

Font family: `system-ui, 'Segoe UI', Roboto, sans-serif` (on Android: the system sans-serif).

Colours:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `surface` | `#ffffff` | `#0f172a` | Form background, inputs, secondary buttons |
| `text` | `#0f172a` | `#f1f5f9` | Text, labels, input text |
| `textMuted` | `#64748b` | `#94a3b8` | Hints, placeholders' box text, disabled text |
| `border` | `#d1d5db` | `#334155` | Control outlines, dividers, footer line |
| `accent` | `#3b82f6` | `#3b82f6` | Primary buttons, focus ring, check/radio marks |
| `accentText` | `#ffffff` | `#ffffff` | Text on primary buttons |
| `danger` | `#dc2626` | `#f87171` | Required asterisk, error text |

[src: tokens/tokens/form.json] Focus ring: 2 px `accent` outline, 1 px offset.
[src: renderer/controls.css:53]

## T.2 Pilot's theme bridge

Pilot does not use the form colours above. It maps the form tokens onto its own (per-site and
per-work-center) theme so a form matches the rest of the app [src: pilot/theme/tokens.css:190-215]:

| Form token | Pilot theme value |
|---|---|
| `surface` | `surfaceRaised` |
| `text`, `textMuted` | `text`, `textMuted` |
| `border` | `borderStrong` |
| `accent`, `accentText` | `accent`, `accentFg` |
| `danger` | `alarm` |
| font family | the theme font |
| type sizes `xs`–`2xl` | Pilot's sizes × the operator's **text scale** |
| `3xl` | 2.5rem × text scale |
| `radius.control` | the theme radius |
| `touch.minTarget` | 44 px (never reduced) |

Spacing, padding, line length and line heights stay FormKit's, so a form keeps the layout approved
in Designer. The theme itself comes from `GET /api/theme` (engine spec B.5.2). A native host SHOULD
apply the same mapping from the resolved theme's `colors.light` / `colors.dark`.

## T.3 Text scale

Pilot's operator preference text scale is one of **0.9, 1, 1.15, 1.3** (default 1) and multiplies all
form type sizes (not spacing). [src: pilot/theme/prefs.ts:22,51,92] A native port SHOULD honour the
platform's font scale the same way, applied to text only.

## T.4 Authored-colour contrast guard

Designer authors on a light canvas, so an authored colour can vanish on a dark surface. When the host
supplies the **surface colour** it actually draws the form on, the renderer judges every authored
colour — text/header `color`, colours set in `style` on any element inside rich text, button `color`, divider `color`,
fixed-row button colours — and **drops** one whose contrast against the surface is below **3 : 1**.
A dropped colour falls back to the theme colour; no warning is shown. [src: renderer/color-guard.ts:26,80-95;
MissionFormKit/docs/HOST-CONTRACT.md:149-161]

Algorithm:

1. No surface given → keep every colour as authored (Designer does this).
2. Parse the surface and the colour. Accepted forms: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
   `rgb(r, g, b)`, `rgba(r, g, b, a)`, `rgb(r g b / a)`, alpha as a number or a percentage (clamped to
   0–1). Channels above 255 are unreadable. [src: renderer/color-guard.ts:28-54]
3. Any other syntax (named colours, `hsl()`) is first resolved to `rgb()` by the platform; values that
   follow their context (`currentColor`, `var()`, `light-dark()`, `inherit`, system colour keywords)
   are never resolved. [src: renderer/blocks/common.tsx:110-131]
4. A colour or surface that still cannot be read is **kept**. Only the authored colour is resolved in
   step 3, never the surface: a surface given as a named colour or `hsl()` makes every colour pass.
   Hosts MUST pass the surface as hex or `rgb()`.
5. Blend a translucent colour onto the (opaque) surface, then compute the WCAG 2 contrast ratio:
   linearise each channel `c/255` (≤ 0.04045 → `/12.92`, else `((s+0.055)/1.055)^2.4`), luminance
   `0.2126R + 0.7152G + 0.0722B`, ratio `(Lmax + 0.05) / (Lmin + 0.05)`. Ratio < 3 → drop.
   [src: renderer/color-guard.ts:56-72]

The host MUST pass the surface again whenever the theme or light/dark mode changes; the guard is
re-applied on the next draw. Pilot reads it from its live theme. [src: pilot/theme/form-surface.ts:20-52]

## T.5 Light and dark

The renderer itself has no mode switch: it draws with whatever token values the host provides.
FormKit ships a light and a dark set; Pilot follows its own light/dark/system preference and theme
(§T.2).

---

# Part 7 — The host (sections H.x)

This part describes Mission Pilot's step screen (`TaskScreen`) as the reference host. A native app
that replaces Pilot MUST behave the same way unless a statement says SHOULD or MAY.

## H.1 Inputs

The host works from one **InboxTask** (engine spec B.5.6) for a step the operator has **claimed**. The
fields it uses:

| Field | Use |
|---|---|
| `assignmentId` | The id for submit, back, stop, release; the draft key. |
| `stepInstanceId` | Step-instance identity (§V.5); the draft's owner. |
| `instanceId` | Image URLs (§H.10). |
| `stepType` | `YES_NO` → `stepKind = yesno`; anything else → `continue`. |
| `stepName`, `stepOid` | Screen heading (`stepName`, else `stepOid`). |
| `runtimeLabel` | Shown in the Stop question and the arrival cue. |
| `formDocument` | The form (§H.3). |
| `yesNoConfig` | `yes_label` / `no_label` for the Yes and No words. |
| `continueLabel` | The Continue word. |
| `buttonBar` | Non-null = fixed-row step; `{size?, color?, yesColor?, noColor?}`. |
| `allowStop`, `backAvailable` | Offer Stop / Back (fixed-row steps only). |
| `prefillValues` | Values the operator submitted when this screen was last left by Back. |
| `paused` | The workflow is paused: keep the screen, lock the buttons. |

Plus the signed-in operator (`GET /api/me`: `loginName`, `displayName`) and the resolved form surface
colour (§T.4).

## H.2 What the engine has already done to the document

Before it arrives, the engine (engine spec A.7.1, B.5.6) has, on a deep copy:

- replaced `{{Name}}` in `text`/`header` `content` with the step's input values, HTML-escaped (exact
  name; unknown tokens left as typed; one pass);
- for blocks with `listSource: {mode: "input", value: <input name>}`, replaced `listItems` (text input)
  or `options` (checkbox, radio) with the elements of that input's JSON list, keeping only the first
  element of each value (X.10);
- for blocks whose `defaultSource` is `property`/`parameter`/`input`, or that have any
  `placeholderSource`: resolved them when the step was activated (property store, input values) and
  shipped a non-empty result as `defaultSource: {mode: "static", value}` and as `placeholder` (with
  `placeholderSource` removed). An empty result leaves the block as authored (X.3).
  [src: MissionEngine/src/core/form-sources.ts; mission-control-db/src/runtime/inbox.ts]

The host does no substitution of its own.

## H.3 Accepting the document

`formDocument` is trusted only if it is an object with an array `sections`; anything else (null, a
string, a broken shape) means **no form**. A step with no form still works: it shows only its
button(s); Continue sends `{kind: "complete"}`, Yes/No send `{kind: "decision", value}` without
`values`. [src: pilot/screens/TaskScreen.tsx:115-119,295-297]

## H.4 Initial values

When a step instance is first shown, the values map is built in three layers, later winning
[src: pilot/screens/TaskScreen.tsx:151-157; pilot/host/gate.ts:22-58]:

1. **Defaults**: for each block (desktop rows) with a `fieldName` and `defaultSource.mode === "static"`,
   `values[fieldName] = defaultSource.value` (a string). `property` and `input` defaults arrive here
   already resolved to `static` (§H.2); one the engine could not resolve leaves the field empty.
2. **Back prefill**: `prefillValues`, verbatim.
3. **Draft**: the operator's own saved typing for this assignment and step instance (§H.11).

Layers 1+2 are the **seed**: the baseline against which "typed values" are counted.

Then compute the gate (§V.4) with an empty settled-timer set and the initial signature draft (§H.7).
Start an empty host-side settled-timer set for the instance (§V.4 item 2).

## H.5 Button state

```
locked   = submitting || offline || task.paused
gate     = latest computeValidation result
noGateOk = gate.ok || (esig && every missing fieldName == esig.fieldName)
enabled.continue = stepKind == continue && gate.ok   && !locked
enabled.yes      = stepKind == yesno    && gate.ok   && !locked
enabled.no       = stepKind == yesno    && noGateOk  && !locked
labels: continue = continueLabel || "Continue"; yes = yes_label ?? "Yes"; no = no_label ?? "No"
signed = document has an esignature block
```

[src: pilot/screens/TaskScreen.tsx:174,333-344,377-382]

**No** ignores an incomplete signature (No never signs, §H.7) but not any other missing field.

The same `enabled` table MUST drive both what is drawn and what a press does; a press on a job that is
not enabled does nothing. [src: pilot/screens/TaskScreen.tsx:317-324,470-474]

Pilot draws **no** status line and **no** "missing fields" list: a button that cannot be pressed is
simply disabled. When paused it shows `Paused — actions are disabled until this step resumes.`
[src: pilot/screens/TaskScreen.tsx:82,363-365,433]

## H.6 Handling events and submitting

| Event | Host action |
|---|---|
| `fieldChange` | `values[fieldName] = value` |
| `signature` | draft = `{loginName, password}`; clear the signature error |
| `validation` | gate = `{ok, missing}` |
| `job` | if `enabled[job]`: `continue` → Continue; `yes`/`no` → Decide |
| `action` | nothing — job-less buttons are drawn disabled (`actionsEnabled: false`, X.7) |
| `timerState` | `elapsed`/`stopped`: add `fieldName` to the host's settled-timer set (X.12) |

[src: pilot/screens/TaskScreen.tsx:299-331]

Requests (engine spec B.5.11), all `POST /api/assignments/<assignmentId>/submit` with a JSON body:

| Action | Body |
|---|---|
| Continue, with a form | `{"kind":"submit","values":{…all values…}}` + signature (§H.7) |
| Continue, no form | `{"kind":"complete"}` |
| Decide yes | `{"kind":"decision","value":"yes","values":{…}}` + signature; `values` omitted when there is no form |
| Decide no | `{"kind":"decision","value":"no","values":{…}}` — never a signature |

`values` is the **whole** values map (seeded defaults, prefill and typing). Text stays strings, checkbox
groups are string arrays. [src: pilot/screens/TaskScreen.tsx:212-213,295-297]

While a request is in flight `submitting` is true (all buttons locked). Results
[src: pilot/screens/TaskScreen.tsx:215-245]:

| Response | Host behaviour |
|---|---|
| 200 | Clear the draft; the step is done — leave the screen. |
| error `code` starts with `SIGNATURE_` | Stay. Show the signature copy (below), clear the **password** only, recompute the gate. |
| `code: NOT_RUNNING` | Stay; toast `Something went wrong — try again.` (the step is still the operator's). |
| HTTP 403 or 409 (other codes) | Lost race: toast `This task changed — refreshing.` and leave the screen. |
| anything else (network, 5xx, 400) | Stay; toast `Something went wrong — try again.` |

Signature copy [src: pilot/screens/TaskScreen.tsx:90-108]:

| Code | Shown |
|---|---|
| `SIGNATURE_REQUIRED` | `Sign to continue` |
| `SIGNATURE_INVALID_CREDENTIALS` | `Login name or password is incorrect` |
| `SIGNATURE_SAME_USER` | `A different user than the operator must sign` |
| `SIGNATURE_NOT_MEMBER` | `That user is not a member of this work center` |
| any other `SIGNATURE_*` | the server's `error` text (it names the role), or `The signature was rejected — try again.` if the server sent none |

## H.7 E-signature

- The step needs a signature when its document has an `esignature` block (the first one counts).
- Initial draft: `loginName` = the operator's own `loginName` **unless** the block has
  `requireDifferentUser: true` (then empty); `password` empty. The draft resets on every new step
  instance. [src: pilot/screens/TaskScreen.tsx:137-142,197]
- Signature hint, when `requireDifferentUser` is true and the operator is known: `Must be signed by
  someone other than <displayName>`. [src: pilot/screens/TaskScreen.tsx:143]
- The draft travels as a separate `signature: {loginName, password}` field on Continue and Yes — never
  inside `values`, never on No, never on `complete`. It MUST NOT be persisted (not in drafts, not on
  disk) or logged.
- Job button labels become `Sign & …` (§K.2).
- The engine writes the signer's display name into `values[esig.fieldName]` on success; the host sends
  nothing for that field.

## H.8 Back, Stop, Release

**Back** — only on fixed-row steps with `backAvailable === true`. `POST /api/assignments/<id>/back`, no
body (engine spec B.5.12). The previous screen arrives as a new claim with `prefillValues`.
**Stop** — only on fixed-row steps with `allowStop === true`. Always asks first:
`Stop the whole workflow «<runtimeLabel>»? Its cleanup steps will run. This also ends work other
people are doing on it.` with **Stop workflow** and **Cancel** (focus on Cancel; Escape cancels).
Confirmed → `POST /api/assignments/<id>/stop` (engine spec B.5.13). [src: pilot/task/StopMenu.tsx:19-65]

Both use `locked` for their enabled state. Results [src: pilot/screens/TaskScreen.tsx:271-293]:

| Response | Behaviour |
|---|---|
| 200 | Clear the draft; leave the screen. |
| `NOT_CLAIMANT` or `STEP_NOT_WAITING` | Toast `This task changed — refreshing.`; leave. |
| `BACK_NOT_ALLOWED` (Back) | Toast `Back isn't available on this step any more.`; stay. |
| `STOP_NOT_ALLOWED` (Stop) | Toast `Stop isn't available on this step any more.`; stay. |
| `RUNTIME_INVALID_STATE` (Stop) | Toast `This workflow is already stopping or has finished.`; stay. |
| anything else | Toast `Something went wrong — try again.`; stay. |

Placement: wide screens — Back at the left and Stop at the right of the fixed row (§K.5). When the
step area is narrower than 600 px — `‹ Back` in the line above the form, Stop as `Stop workflow…` in a
`⋯` ("More actions") menu on the same line. [src: pilot/pilot.css:295-320]

**Release** (every step, not only fixed-row) gives the claim back: `POST /api/assignments/<id>/release`.
If the operator has typed values (§H.11 count > 0) it first asks, in place of the button,
`Release and discard 1 entered value?` / `… N entered values?` with **Release** and **Keep** (focus on
Keep). Success → clear the draft and leave. 403/409 → toast `Could not release` and leave; anything
else → `Something went wrong — try again.`, stay. Disabled while submitting or offline (not while
paused). [src: pilot/task/ReleaseButton.tsx:17-79; pilot/screens/TaskScreen.tsx:249-265,446]

## H.9 Screen layout around the form (Pilot)

From top: the step name as a heading; an optional arrival cue (`Now on: <step> · <runtime id>`) after
the operator was moved to this step; the paused notice; a line with `‹ Back` (narrow only), **Where you
are**, **Release** and the `⋯` menu (narrow only); then the form (max 1088 px wide, centred) and, on
fixed-row steps, the fixed row, always at the bottom of the pane (§L.3); a "Where you are" side
panel at ≥ 1280 px window width.
[src: pilot/screens/TaskScreen.tsx:410-500; pilot/pilot.css:158-200] A native app MAY arrange its chrome
differently, but the form, its buttons, Back, Stop and Release MUST be reachable on every screen size.

## H.10 Images

`src` values that are not `http(s)://` URLs are resolved by the host [src: pilot/screens/TaskScreen.tsx:351-361]:

- a `data:` URI → used as is;
- the literal `No image selected` (Designer's placeholder) → nothing (the renderer's placeholder box);
- anything else → `GET /api/instances/<instanceId>/images/<URL-encoded src>` with the session (engine
  spec B.5.14). Pilot adds no cache of its own; the route sends `Cache-Control: private, max-age=3600`,
  which a native client SHOULD honour.

## H.11 Drafts

Typed values survive leaving and re-opening the step in the same session [src: pilot/task/drafts.ts:17-92]:

- **Typed values** = keys (from values and seed together) whose value differs from the seed (compared
  as JSON); a cleared default counts as typed, stored as `""`.
- After every change, save `{stepInstanceId, values: typed}` under the assignment id; if nothing is
  typed, delete the entry.
- On open, restore only if the saved `stepInstanceId` equals the task's; otherwise ignore it.
- Clear on submit, Back, Stop and Release success, and **clear all** on sign-out (a shared device must
  not hand values to the next operator).
- Pilot keeps drafts per browser tab (`sessionStorage`). A native app SHOULD keep them in app memory or
  encrypted private storage scoped to the signed-in session. Signature drafts are never kept.

## H.12 Keyboard

Ctrl+Enter (or Cmd+Enter) presses Continue when it is enabled and this step screen is the one in front, except while
the Release or Stop question is open. Never Yes or No. [src: pilot/screens/TaskScreen.tsx:388-408] On a
device with a hardware keyboard a native app SHOULD offer the same.

## H.13 Offline and pause

`offline` (the host's own connectivity state) and `task.paused` lock all step buttons (§H.5) while
keeping the screen and the typed values. When the task arrives again un-paused, the buttons re-enable
without the screen being rebuilt. [src: pilot/screens/TaskScreen.tsx:171-174]

---

# Part 8 — Platform notes for native ports (sections P.x)

## P.1 Web mechanism → native equivalent

| Web reference | What it achieves | Native equivalent (Android) |
|---|---|---|
| Container queries on `.tfk-viewport` | Screen type from the form's own width | Measure the form container (`onSizeChanged` / `BoxWithConstraints`) and compute the tier (§L.1). |
| CSS Grid, 12 columns, auto-placement | Row layout | A custom layout implementing §L.5 exactly. |
| `order` classes | Reorder within a row | Stable sort by order (no order = 0). |
| `display: none` | Hidden block | Take no space and draw nothing — but keep the block alive: a hidden timer MUST still start, run and settle (§L.6). |
| `aspect-ratio` | Media box height | `Modifier.aspectRatio` / constraint ratio. |
| `object-fit` | Image fitting | `ContentScale.Fit` / `Crop` / `FillBounds`. |
| DOMPurify + `innerHTML` | Rich text | Sanitize, then map the tag set of §R.1 to spans (`HtmlCompat` with a strict allow-list, or an own parser). |
| `<datalist>` | Combobox suggestions | Exposed dropdown with free text. |
| `<select>` | Dropdown | Exposed dropdown menu, read-only text. |
| `inputmode=numeric` | Number keyboard | `KeyboardType.Decimal`, plus §R.3.1 filtering. |
| YouTube iframe | Embedded YouTube | A WebView with the nocookie embed URL, or the YouTube player; never autoplay. |
| `<video preload=none>` | Direct media | ExoPlayer/Media3 with controls, poster image, no preload. |
| `Date.now()` | Timer wall clock | `System.currentTimeMillis()` for elapsed (or `SystemClock.elapsedRealtime()`; it must count sleep time). |
| `sessionStorage` | Drafts | In-memory or encrypted session storage (§H.11). |
| Session cookie, same origin | Auth | The session cookie from engine sign-in (engine spec B.3), sent on every call including image URLs. |

## P.2 Units

Treat 1 CSS px as 1 dp and 1 rem as 16 dp × the text scale for type, 16 dp for spacing. Breakpoints are
in dp of the form container.

## P.3 Determinism

The same document, width and values MUST produce the same layout. Avoid heuristics that depend on
content measurement other than the line height of each grid line.

## P.4 Security

- Sanitize rich text with an allow-list; never execute script or follow `javascript:` links.
- Never log, persist or put the signature draft into `values`.
- Load images only through the engine route (with the session) or the authored `http(s)`/`data:` src.
- Clear drafts on sign-out.

## P.5 What a port can ignore

Edit mode, `deletable`, `imageOid`, `checkNeverStuck`, `convertButtons` outside `withStepButtons`,
`pruneRowsAt` (an authoring helper), the v1 converter, and the FormKit shell's mock engine.

## P.6 Testing a port

See Appendix C.

---

# Appendix X — Rulings of 2026-11-14

Version 1.0 of this spec listed fourteen things the code did that might be defects. Each was checked
against the code (and the layout ones measured in Chromium), the user ruled on each, and the rulings
are built and described in the body of this version. This appendix records what was found and what
was decided, so a port knows which behaviour is deliberate.

| # | Found in 1.0 | Ruling (built) | Where now |
|---|---|---|---|
| N1 | Pilot's fixed button row was transparent: a long form showed through Back/Continue/Stop. | The row paints the form surface colour. | §K.5 |
| X.1 | `layout.minHeight` / `maxWidth` were saved but never drawn (Designer offers both). | Drawn, on the block's content. | §L.5a |
| X.2 | A timer wrote no value, so its `outputParameter` was never filled. | On settling, the timer sets its field to the elapsed whole seconds. | §R.10 |
| X.3 | `property`/`input` defaults and every `placeholderSource` were ignored. | The engine resolves them at step activation; the inbox ships them as `static` default / `placeholder`. | §H.2, §H.4 |
| X.4 | Pilot capped the form at 960 px, so the desktop layout never showed. | The cap is 1088 px; wide screens show the desktop layout. | §L.1, §H.9 |
| X.5 | `order: 1` puts a block after every block without an order. | Kept as specified; Designer explains it. | §L.5 |
| N2 | Designer saved `order.base = 0` for a Tablet/Phone-only order, which the schema refused, so Save failed. | `order` accepts 0 (= automatic) everywhere. | §F, §L.5 |
| X.6 | A required field hidden on a screen type blocked the step there. | Designer refuses to export such a form; the gate is unchanged. | §L.6, §K.6 |
| X.7 | On a legacy Yes/No step a job-less button sent `kind: "submit"`, which the engine always refuses. | Designer refuses to export it; Pilot draws job-less buttons disabled and does nothing on `action`. | §K.1, §K.6, §H.6 |
| X.8 | Combo boxes and unlabeled required groups did not announce "required". | Both announce it. | §R.13 |
| X.9 | A required field of only spaces counted as answered. | Spaces only = empty. | §V.3 |
| X.10 | Two options could share a value (radios both selected, checkboxes ticking together). | Designer refuses them on save and export; input-sourced lists keep the first of each value. | §K.6, §H.2 |
| X.11 | Back/Stop placement was decided from two widths. 1.0 overstated this: at default settings both always showed. Only an unusually large browser font made them vanish. | One width decides (Pilot's topline), and the row is told (`compact`). | §K.5 |
| X.12 | After a rejected signature Pilot treated a finished timer as unfinished, so No stayed disabled. | The host keeps the set of settled timers and uses it. | §V.4, §H.6 |
| X.13 | On a fixed-row step a footer and the row both stuck to the bottom and overlapped. | The footer flows above the row; only the row sticks. | §L.3, §K.5 |
| X.14 | A number field of only spaces blocked the step with no error shown. | Spaces only = empty. | §R.3.1 |

---

# Appendix C — Conformance checklist and fixtures

## C.1 Fixtures in the repository

- `MissionFormKit/packages/form-schema/src/fixtures/kitchen-sink.ts` — every block type once; valid
  against the schema.
- `MissionFormKit/e2e/goldens.spec.ts-snapshots/` — pixel goldens of the kitchen sink at container
  widths **380, 768, 1440** (phone, tablet, desktop), run and edit modes, Windows/Chromium. Images in
  the golden harness resolve `pump.jpg` to a fixed SVG; videos get a fixed poster.
  [src: MissionFormKit/packages/form-renderer/golden/main.tsx:22-68]
- Unit tests that pin behaviour a port must match: `form-schema/src/__tests__/validation.test.ts`
  (gate), `layout-rows.test.ts` (§L.4), `step-buttons.test.ts` (§K.4), `step-bar.test.ts` (§K.3),
  `resolve.test.ts` (§L.2); `form-renderer/src/__tests__/blocks-*.test.tsx`, `color-guard.test.ts`,
  `authored-colour.test.tsx`, `per-screen-rows.test.tsx`, `StepButtonBar.test.tsx`.

Pixel-exact equality with the web goldens is not expected on another platform (fonts and anti-aliasing
differ); **structural** equality is: same tier, same rows, same blocks per grid line, same spans,
same visibility, same labels and same enabled states.

## C.2 Checklist

1. Tier from container width: 380 → phone, 768 → tablet, 1440 → desktop; 599/600 and 1023/1024 edges.
2. Cascade phone → tablet → base for span, order, visible, size, scale, rows.
3. `rowsAt` resolution including unknown ids, repeats, empty rows and leftovers (§L.4).
4. Grid wrapping with spans summing past 12; hidden blocks take no space; order 0 rule (no order
   and `0` both automatic, before 1–12); `minHeight`/`maxWidth` on the block content.
5. Footer outside the scroll and always visible on a legacy step; on a fixed-row step the footer flows
   above the row and only the opaque row stays visible; the row is at the bottom of the screen even
   under a short form, with nothing visible below it.
6. Number field filtering and the `Enter a number` error; spaces only = empty (no error, not missing
   unless required).
7. Checkbox values in option order.
8. Gate: required (spaces only = missing), number, blockDone timer, e-signature; host recompute at
   show and after host edits, with the timers that have actually settled.
9. Timer wall-clock behaviour across background/sleep; settle at duration for count-up; Stop records
   the clock; the field gets the elapsed seconds; restart on a new step instance; survive rotation.
10. `withStepButtons` output byte-for-byte equal to the reference for the same input (ids included).
11. Fixed row: labels, `Sign & …`, colours through the guard, opaque background, Back/Stop shown
    exactly once (one width, < 600 = narrow).
12. Contrast guard numbers: e.g. `#ffff00` on `#ffffff` dropped (1.07 : 1); `#1e293b` on `#0f172a`
    dropped; `#3b82f6` on `#0f172a` kept (≥ 3 : 1).
13. Submit bodies and error handling exactly as §H.6–H.8; signature never in `values`, never on No.
14. Drafts: restore only for the same step instance; cleared on success and on sign-out.
