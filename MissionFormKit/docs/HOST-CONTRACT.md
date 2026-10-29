<!-- Copyright (c) 2026 Dennis Brandl. All Rights Reserved. -->

# Host Contract

What an application must do to drive `@mission/form-renderer` correctly in `run` mode.

The renderer draws exactly one `FormDocument` — a single screen. Sequencing screens, branching on
decisions, and completing the flow are **host chrome**. This document states the obligations that
sequencing puts on the host, because the renderer cannot enforce them and they are not obvious from
the types.

Reference implementation: `apps/form-shell/src/host/useFlowHost.ts` + `FlowHost.tsx`.

**Division of labour.** The *engine* (`apps/form-shell/src/engine/FormEngine.ts`) owns navigation:
position, history, and step-instance identity. The *host* owns field values and the completion gate,
and renders whatever step the engine dispatches. The *renderer* owns nothing but presentation.

The engine seam is deliberately app-local. Execution is meaningless in the Designer editor, so nothing
about flows, navigation, or instances appears in the `form-schema` / `form-tokens` / `form-renderer`
packages Designer consumes — the renderer receives `instanceId` only as React's `key`, which is not one
of its props.

---

## 1. The host owns field state

`values` is a controlled prop. The renderer displays `values[fieldName] ?? ''` and never mutates it.
When the operator edits a field the renderer emits `fieldChange`; the host is expected to fold that
into `values` and pass it back down. The renderer also never resolves `defaultSource` /
`placeholderSource` property references — the host seeds `values` with any defaults before mount.

## 2. The host owns the completion gate — the renderer only helps

`computeValidation(doc, values, settledTimers, signature?)` is exported from `@mission/form-schema`. It is
pure and React-free, so any host (including a non-React one) can call it.

**The renderer emits a `validation` event on exactly three triggers:**

- a `fieldChange` — validation is computed with the new value already applied
- a `signature` — validation is computed with the new draft already applied
- a timer settling (elapsed or stopped)

**The renderer does NOT emit `validation`:**

- on mount
- when the host changes `values` out of band — seeding defaults, restoring values on Back
- when the `document` prop changes

**Therefore the host MUST compute the gate itself:**

1. at mount, before any event can arrive
2. on every screen/document change
3. whenever it mutates `values` outside the event stream
4. passing its current e-signature draft (the same object it hands to the renderer's `signature` prop) — the draft is host state, never part of `values` (spec 2026-09-06 D3)

and otherwise adopt the `validation` events the renderer emits.

This is a genuine split of authority, and both parties must agree. `useFlowHost` follows it in its
`gate` initializer (mount), `applyScreen` (advance and back both route through it), and `restart` —
and rule 4 too: all four call sites pass a `signature` argument, and `applyScreen`/`restart` reset the
draft to an empty one on every screen change, so a draft never leaks across screens. It works, but
nothing enforces it: a host that skips the mount computation silently shows a wrong gate until the
operator's first keystroke.

> If you are considering moving the gate entirely host-side (renderer stops emitting `validation`,
> host derives it as a `useMemo` over `(doc, values, timers)`), that is a live design option — it
> would make the gate a derivation that cannot desync. It was evaluated on 2026-07-15 and
> **deliberately deferred**: no live defect, and the API churn was not worth it while the real
> UI-host app is still unbuilt. See `BACKLOG.md`.

## 3. The host MUST remount the renderer per step INSTANCE

```tsx
<FormDocumentView key={instanceKey} document={doc} mode="run" values={values} onEvent={onEvent} />
```

**This is load-bearing, not cosmetic**, and the key must be per *instance* — see §4 for why a step can
run more than once. The renderer keeps its settled-timer set in private state, and that set is never
reset when the `document` prop changes. Only a remount discards it.

Two consequences follow, and they live in different files with nothing linking them:

- Because a remount always discards settled timers, a host is correct to pass an **empty** set when it
  recomputes the gate for a newly-entered step (as `useFlowHost` does via `EMPTY_TIMERS`). That is only
  true *given* the remount.
- A host that reuses one renderer instance across documents leaks settled timers into the next: a timer
  whose `fieldName` matches one already settled reads as pre-settled, and its gate opens **without the
  timer ever running**. Tracked in `BACKLOG.md` ("`settledTimers` never resets on document change").

> ⚠️ **A step id is not an instance id.** Keying on a step id (`screenId`) is *not* sufficient: a
> workflow that loops straight back to the same step (a "Retry" button on step A targeting A) produces
> the same step id twice in a row, so the key does not change and **React does not remount**. The key
> must change on every entry.
>
> This is why `FormEngine` mints the id rather than leaving hosts to invent one: every
> `ScreenTransition` carries an `instanceId` unique to that execution of the step, and the host keys on
> it (`FlowHost.tsx`). A host that keys on `screenId` instead silently skips the looped step's cure —
> see `BACKLOG.md` item 6 for the full failure analysis.

## 4. Re-entering a step restarts its timers — this is intentional

A step's timers start from zero every time the step is entered, and its `blockDone` gate is closed
until they settle again.

**This is the specified behaviour (decided 2026-07-15): workflows contain loops, so the same step is
repeated, and each instance starts fresh.** A cure timer measures *this* execution of the step. A
previous instance's elapsed cure says nothing about the current one — the physical operation is being
performed again.

Two ways a step is re-entered, and they are the same case:

- the workflow graph loops back to it (the primary one — this is a workflow-execution semantic, not a
  navigation one)
- the operator navigates Back to it

It is recorded here because it looks like a bug and has already been reported as one: a code reviewer
flagged the closed gate as "wrongly re-gating a settled timer on Back." It is not wrong. Making an
elapsed timer *stay* elapsed across re-entry would be a deliberate change to this contract — the host
would have to own timer state and key it per instance — not a bug fix.

## 5. Events fire only in `run` mode

In `edit` mode no event ever fires, timers never tick, and interactive controls are `inert`. Two
guards enforce this centrally in `FormDocumentView` (the `emit` gate and the `onSettle` gate).

⚠️ **Do not rely on `inert` to enforce it.** `inert` does not block a programmatic `.click()` even in
a real browser, and **jsdom does not implement `inert`'s click-blocking at all** — so a jsdom test that
clicks an edit-mode control and asserts silence is exercising the mode guards, not `inert`. A block
component must guard `mode` internally rather than delegate to the wrapper's `inert`; one real defect
has already been caused by not doing so.

## 6. Stylesheets — three imports, one of them a build output

A host must import **three** stylesheets: a tokens sheet plus *both* renderer sheets. Missing one
fails quietly as unstyled or half-styled output rather than as an error.

```ts
import '@mission/form-tokens/css/light'   // or '.../css/dark'
import '@mission/form-renderer/layout.css'
import '@mission/form-renderer/controls.css'
```

⚠️ **The tokens sheet is generated, not source.** `@mission/form-tokens/css/light` resolves via the
package's `exports` map to `./dist/form-tokens.light.css`, which does not exist until
`npm run build:tokens` has run — so a clean checkout fails to resolve that import. The two renderer
sheets resolve to `./src/*.css` and need no build step. (`npm run shell` and `npm run demo` therefore
both require `npm run build:tokens` first.)

## 7. Authored colours — the host opts in to the contrast guard

An author can colour text, header, button and divider blocks. Designer authors on a light
canvas, so on a dark theme those colours can vanish. Pass `surfaceColor` — the colour the
form is actually drawn on, resolved to `#hex` or `rgb()` — and the renderer drops any
authored colour below **3:1** against it; the block then keeps the theme's colour. No
warning is shown to the operator (Mission Pilot spec 2026-10-09 §14, ruling R6).

- Re-pass `surfaceColor` when the theme or light/dark mode changes; the renderer re-judges
  on the next render without a remount.
- Omit it (Mission Designer does) and authored colours are drawn exactly as authored.
- A colour the renderer cannot read is kept — the browser ignores an invalid inline colour
  anyway. Named colours and `hsl()` are resolved through a probe element first.

## 8. Job buttons — the author places Continue / Yes / No, the host still decides

An author can give a button block a `job` (`continue`, `yes` or `no`). The renderer draws it,
but it owns no logic: pass `buttonJobs` and the renderer shows the host's label and enabled
state, and a click emits `{ kind: 'job', blockId, job }` (never `action`). Like every event
it fires only in `run` mode (§5); in `edit` mode `buttonJobs` still sets the labels.

```ts
buttonJobs={{
  continue: { enabled: gateOk, label: 'Save batch', describedBy: 'why-blocked' },
  yes: { enabled: gateOk, label: 'Yes' },
  no: { enabled: true, label: 'No' },
  signed: stepNeedsSignature,
}}
```

- **Same gating as your own buttons.** `enabled` must be exactly the condition under which
  your own Continue/Yes/No would be enabled. A disabled job button gets the `disabled`
  attribute, so it emits nothing, and the renderer draws it greyed (`.tfk-button:disabled`,
  authored colour ignored while disabled). `describedBy` is the id of the element that says why.
- **Label.** The author's typed label wins; otherwise `buttonJobs[job].label`; otherwise the
  default word (`Continue`, `Yes`, `No`). When `signed` is true, Continue and Yes labels
  become "Sign & <label>".
- **No is never signed.** `signed` does not change No's label, and No never requires a
  signature (`noGateOk`). Ctrl+Enter is Continue-only: the Continue button advertises it
  with `aria-keyshortcuts`, and the host wires the key itself.
- **When to hide your own buttons.** Hide the host's Continue/Yes/No only when
  `hasJobButtons(doc) && checkNeverStuck(doc, stepKind).length === 0`. If the form has no
  job buttons, or any step kind could be left with no way forward, keep your own.
- **A host that ignores `job` events must not hide its buttons.** Handle `job` as you handle
  your own button of the same job, or leave your buttons visible; otherwise the operator is
  stuck.
- Job-less buttons are unchanged: they emit `action`, never hide your buttons, and do not
  count toward the never-stuck check.
