<!-- Copyright (c) 2026 Dennis Brandl. All Rights Reserved. -->

# Mission FormKit — Backlog

Living document. Items deferred from a completed phase's review, with enough context to act on
without re-deriving the analysis. Delete an item when it ships.

> Provenance: everything below was raised by the P1 final whole-branch review (`67bdf47..30c7a47`)
> or its fix-wave re-review (2026-07-15), triaged with Dennis, and deliberately deferred. These are
> decisions, not oversights.

---

## v1→v2 converter — ship-as-is Minors (from the final whole-branch review, 2026-07-16)

The converter (`@mission/form-schema` `convert/`) merged READY=YES. These Minors were reviewer-triaged
as ship-as-is / design-consistent — recorded so they aren't rediscovered, to revisit if real v1 corpora
surface them:
- **Silent quantization losses.** `divider` maps `thickness` (px) → `{hairline|thick}` and a lone element at
  ≥55% width is promoted to `span 12`, both with NO report entry. The design deliberately marks only
  `fontSize` as LOSSY, so this is consistent — but if the migration report should be exhaustive, add
  advisory entries for these two.
- **Multiple trailing button rows flatten to one footer row.** `splitTrailingButtonRows` `.flat()`s all
  trailing all-button rows and the orchestrator emits a single `footer-row-0`, re-apportioning spans across
  every button. A v1 form with two distinct trailing button rows renders as two at runtime but converts to
  one. Rare; still valid/sensible. A fidelity simplification, not a bug.
- **Pure-footer forms yield an empty content section.** A form whose only elements are a dropped Continue or
  a Yes/No pair produces `{ role:'content', rows: [] }`. Schema-valid (no `minItems` on `section.rows`) and
  brief-specified; consider omitting an empty content section for tidiness.
- **`?? ''`/`?? 0` fallbacks on unconstrained fields.** They cover content/options/direction/label, which
  (unlike fieldName/src/outputValue/durationSeconds) have no schema min-constraint — so genuinely corrupt v1
  data there would yield a schema-VALID-but-wrong document. All are non-optional in v1's real types (so
  unreachable with valid data). Defense-in-depth option if ever wanted: push a report entry whenever any
  fallback fires (turns a silent substitution into an advisory one).

---

> **P2 is complete (2026-07-15).** Every item below is resolved or deliberately deferred.
> Next is **P3 — the Mission Designer editor rebuild**, which gates the engine adapter: Mission Designer authors the UI
> steps, so until it emits v2 documents there is nothing real for an engine to execute.

## P2 — should be decided or done during the PWA shell phase

### 1. Validation-contract coherence — ✅ DECIDED 2026-07-15 (documented; code change deferred)

**Outcome: documented, not changed.** See `HOST-CONTRACT.md` §2–§4.

The original finding claimed three host workarounds stood in for one missing design decision, and
rested on the premise that `useFlowHost.ts:71,98,106` "wrongly re-gate an already-settled timer on
Back". **That premise was wrong.** Dennis decided (2026-07-15) that revisiting a screen is a *fresh
cure cycle* — so the renderer genuinely remounts with no settled timers, and `EMPTY_TIMERS` is the
truth rather than a workaround. All four `computeValidation` call sites re-traced and correct. No live
defect. That semantic is now pinned in `HOST-CONTRACT.md` §4 precisely because it reads like a bug and
has already been reported as one.

What remained was a real but latent hazard, now written down instead of fixed: **the gate has two
authors** (host at mount/advance/back/restart; renderer on fieldChange/timer-settle), agreeing only by
convention. A characterization test (`validation-events.test.tsx`, "emits NO validation on mount")
pins the renderer's half so the doc cannot drift silently.

**Still open as a design option — revisit when the real UI-host app is built:** move the gate entirely
host-side (renderer stops emitting `validation`; host derives it as a `useMemo` over
`(doc, values, timers)`). This makes the gate a *derivation* rather than a synchronized mirror, so it
cannot desync, and it deletes the stale-closure surface that caused P1's Critical bug. Rejected for now
only on churn-vs-benefit with no live defect and no second host yet.

If that option is ever taken: **Dennis's stated preference (2026-07-15) is to also remove the
`validation` kind from the `FormEvent` union and amend design spec §6** — a UI gating derivation is not
a workflow event the execution app needs, so it is arguably a category error in the wire vocabulary.
Not actionable today: the renderer still emits it, so §6 remains accurate as written.

### 2. Accessibility pass — ✅ DONE 2026-07-15

Single controls (`textInput` incl. dropdown/combobox, `textarea`) now carry
`aria-required={block.required || undefined}`. Checkbox/radio groups are named by a `<legend>`
(`GroupLabel`) instead of a `<label>` pointing at nothing, and radio groups expose `role="radiogroup"`.

Required-ness rides in the group's accessible name as visually-hidden text (`.tfk-sr-only`), not
`aria-required`: `<fieldset>` maps to role `group`, which has no such state, and putting it on each
checkbox would claim every option is individually required. Radio groups *could* have used
`role="radiogroup"` + `aria-required`, but then the two group kinds would announce required-ness
differently — one way for both beat the purer state on one of them.

Notes for whoever touches this next:
- `.tfk-fieldset > legend { padding: 0 }` is load-bearing. A legend is **not** a flex item — it renders
  above the fieldset's anonymous flex box — so without zeroing its UA padding the group label sits
  offset from every other stacked label. Verified visually in the regenerated baselines.
- The kitchen-sink fixture's checkbox/radio had **no label**, so the whole `GroupLabel`/legend path was
  invisible to both golden suites. Gave the checkbox `label: 'Parts checked', required: true` and the
  radio `label: 'Grade'` so the baselines actually watch it. All 6 PNGs regenerated and reviewed; run
  and edit remain pixel-identical (spec §5 parity).

### 3. Vite pin — ✅ DECIDED 2026-07-15: stay on `^6` deliberately

P1 Task 11's brief-mandated `vite@^6.0.0` devDep (added for the demo harness) silently downgraded the
monorepo's deduped vite from 7.3.6 → 6.4.3 — the same instance `vite-node` uses for the entire test
suite, not just the demo. **Dennis's call: keep `^6`, as a choice rather than an inherited accident.**
It is proven green here (full unit suite + pixel goldens), and vite 6's `engines` range is *broader*
than vite 7's, so it constrains the toolchain less. vitest accepts `^5 || ^6 || ^7`, so nothing forces
a bump. Revisit only if a dependency actually requires vite 7.

### 4. Test-infra trap to know about before writing more edit-mode tests
*(Now also stated in `HOST-CONTRACT.md` §5, where host authors will actually meet it.)*

**jsdom does not implement `inert`'s click-blocking** (verified by probe: the handler fires). So any
jsdom test that clicks an element inside an `inert` wrapper and asserts nothing happened is testing
the renderer provider's `emit`/`onSettle` mode-guards (`FormDocumentView.tsx:38,:50`) — **not**
`inert`. Real browsers do block user clicks, but `inert` does not block a programmatic `.click()`
even there.

This already produced one real defect: P1's parity fix made the timer's Stop button render in edit
mode, and because `stop()` mutated local state (`setSettled`) with no mode guard, an edit-mode click
made the button delete itself — the exact parity defect the fix existed to prevent. Fixed in
`c3bff05` by guarding `stop()` on `mode !== 'run'`.

**Generalised lesson:** a block must not delegate its edit-mode invariant to the distant wrapper's
`inert`. Guard mode inside the component. Anything in P3 that re-hosts a block outside
`FormDocumentView`'s wrapper would silently drop that protection.

### 6. ✅ FIXED 2026-07-15 — Step-instance identity: a workflow loop silently skipped a `blockDone` cure

**Fixed, then hardened.** First in the host (a monotonic per-entry key), then folded into the engine so
a host cannot get it wrong by inventing its own: `FormEngine.ScreenTransition` now carries an
`instanceId` unique per step execution, and `FlowHost` keys on it. Shipped with a looping sample flow
(`flows/rework.ts` — a Rework button targeting its own step) and regression tests in
`FlowHost.test.tsx` + `MockEngine.test.ts`. The host tests were confirmed to FAIL against the unfixed
code with the exact predicted symptoms: the Stop button absent (timer never restarted) and the
missing-count at zero (**the gate had opened without this instance's cure**).

Because the id now arrives with every transition, the follow-on hardening once listed here — "nothing
detects a host getting §3 wrong" — is largely answered: the correct key is handed to the host rather
than derived. A host could still ignore it, which is what `HOST-CONTRACT.md` §3 is for.

Navigation moved with it: `FormEngine` gained `back()`/`canGoBack()`/`step()` and now owns position and
value history, reversing the form-shell prototype's "host-owned Back, positionless engine" decision.
That is faithful to D1 — a separate app executes the workflow, so navigation is execution — and it
leaves one stack rather than two to keep in sync.

⚠️ **Correction to the analysis below: the renderer half is impossible, not merely deferred.** On a
self-loop `MockEngine` returns the *same* `document` object, so with an unchanged key every prop the
renderer sees is identical — re-entry is invisible in its inputs and there is no identity change to
react to. Resetting `settledTimers` on document-identity change would not have fixed this, and worse
would desync: `TimerBlockView`'s own `settledRef` would survive (its deps are `[mode, block.id]`), so
the gate would demand a timer that refuses to run. **Remounting is the host's job alone** — this is why
`HOST-CONTRACT.md` §3 states it as a host obligation the renderer cannot enforce.

Original analysis retained below for the reasoning.

---

**Was: highest-severity open item. Not reachable today; reachable the moment a real looping workflow runs.**

Established 2026-07-15: **workflows contain loops, so the same step repeats and each instance must start
fresh** (`HOST-CONTRACT.md` §4). But `screenId` identifies a *step*, not a *step instance*, and
`FlowHost.tsx:25` keys the renderer on `screenId`. A loop straight back to the same step (a "Retry"
button on step A targeting A — `transitions: { retry: 'A' }`, which `MockEngine` fully permits) yields
the same key twice in a row, so **React does not remount** and the renderer's private `settledTimers`
survives into the next instance.

Two failure modes, both live once a flow loops:

1. **Deadlock.** The host recomputes the gate with `EMPTY_TIMERS` → closed. The renderer never re-emits:
   `settledRef.current` is already `true` and the effect's deps `[mode, block.id]` are unchanged, so the
   timer never runs again. The gate can never open.
2. **Skipped cure (the dangerous one).** Any `fieldChange` makes the renderer emit validation computed
   with *its* stale settled set → `{ok: true}` → **the gate opens without this instance's cure ever
   running.** A required hold is silently skipped and the batch record says the step completed. In a
   regulated batch context that is a data-integrity and process-safety defect, not a UX bug.

Why it is invisible today: the sample flows (`inspection.ts`, `kitchenSink.ts`) are strictly acyclic, so
every transition happens to change the key.

~~Fix has two candidate halves~~ → **Fixed host-side only** (entry counter). The renderer half was
evaluated and proven impossible — see the correction above.

Still open, and now the only defence against a host getting §3 wrong: nothing detects the violation.
A host that keys per step id rather than per entry silently skips cures, exactly as this did. Worth
considering for P2/P3 — e.g. a dev-mode warning if a `blockDone` timer mounts already-settled, or
folding the instance key into the `FormEngine` `Transition` contract so the engine mints it and a host
cannot forget.

---

## P4 — must be settled before the v1→v2 converter

### 5. `divider.color` — ✅ FIXED 2026-07-15, and the rule that blocked it corrected

`DividerBlockView` now renders `style={{ borderTopColor: block.color }}`, so authored divider colours
survive and P4's converter has somewhere to put v1 colours.

The blocker was never the code — it was the rule's *wording*. The P1 plan wrote "inline styles are
banned except `color` and `aspectRatio`" as an allowlist of two properties. That enumeration was
already false when written: `ButtonBlockView` used `background`, which the same plan specified. The
real rule is **layout vs appearance**, and listing properties mistook two examples for the principle —
which is how a spec'd, typed property came to be silently dropped.

The corrected rule now has a committed home in [`CONVENTIONS.md`](CONVENTIONS.md), rather than living
only in a gitignored plan.

---

## Unscheduled minors

### ✅ Cleared 2026-07-15
- **Checkbox now emits option order, not click order.** The array is workflow data landing in a batch
  record, so the same selection must serialise identically however the operator ticked it — otherwise
  records describing identical work compare as different. Pinned by a test that ticks the same two
  boxes in opposite orders and asserts one value.
- **`sanitizeHtml` no longer re-runs every render** (`useMemo` on `block.content` in `TextBlockView` /
  `HeaderBlockView`). Every `fieldChange` re-renders the tree, so each keystroke was costing a full
  DOMPurify parse of every text block on screen — real on low-end industrial tablets.
- **`EMPTY_VALUES` hoisted** so omitting `values` no longer mints a fresh object per render, and the
  `images` docstring now asks for a stable reference. Matters once block views get `React.memo`.
- **`React.ReactNode` UMD-global references replaced** with `import type { ReactNode }`
  (`blocks/index.tsx`, `TextInputBlockView.tsx`), matching the rest of the repo.
- **The stopped-timer interval leak now has a discriminating test.** Every other timer test passed with
  or without `clearTimer()` in `stop()`, because the `settledRef` guard already froze the display —
  `vi.getTimerCount()` is the one assertion that can tell.
- **Docs gaps.** The three-stylesheet requirement is `HOST-CONTRACT.md` §6 (with the trap that the
  tokens sheet resolves to `./dist/` and needs `build:tokens` first); README gained its `npm run demo`
  bullet and links to the contract and backlog.
- ~~`settledTimers` never resets on `document` change~~ — superseded by item 6; the renderer cannot
  detect re-entry at all, so remounting is the host's job and the engine now mints the key.

### Still open (deliberately)
- **`demo/` and `golden/` sit outside `tsc -b`**, so a type error in either surfaces only in an IDE.
  Intentional and consistent between them; both are throwaway harnesses. `demo/index.html` has no
  licence header (its P1 brief's own sample was headerless).
- **The degraded-DOM sanitize path is untested.** `sanitize-no-dom.test.ts` drives the no-DOM path
  (`purify.cjs.js:432`), which was already loud pre-fix. The genuinely-silent path (`:532`, needs
  `implementation.createHTMLDocument`) has no coverage. Low value — the guard branches on the same
  `isSupported` flag the existing test already drives to `false`.
