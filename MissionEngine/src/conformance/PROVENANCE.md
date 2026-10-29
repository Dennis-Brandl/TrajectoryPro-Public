# Fixture Provenance

These fixtures are vendored from an external reference repository and must not be edited in place. Any corrections, additions, or deletions must be made in the source repository and re-synced via manual copy.

**Source Repository:** TrajectoryRuntime (the reference runtime; not part of this repository)
**Source Commit:** fcec3987aa21f48aab1b3d6391093a2397f5dfd6
**Sync Date:** 2026-08-01

**Fixture Manifest:**
- validation/: 28 fixtures (test-specification schema and semantic validation)
- execution/: 33 fixtures (runtime execution scenarios)
- parameters/: 8 fixtures (parameter resolution)
- resources/: 13 fixtures (resource management)
- test-fixture-schema.json: schema definition

**Total:** 82 fixture files

**Re-sync procedure:** To bring fixtures up to date after changes in the source repo, repeat the directory copy from the reference repository's `spec/conformance/` and regenerate this document.

---

## Known reference failures (parity baseline)

The following fixtures are known to fail in the reference repository's own conformance runner (verified at commit fcec3987aa21f48aab1b3d6391093a2397f5dfd6). The port MUST reproduce these reference failures to maintain parity; they represent known defects in the fixtures themselves, not in the validator/engine logic.

**Validation fixtures (1):**
- **val-struct-002** (`validation/val-struct-002-full-valid.json`)
  - Reference failure: `Expected valid=true, got valid=false (error: UNBOUND_FORM_INPUT)`
  - Root cause: Fixture contains textInput element without outputParameter binding; the reference validator rejects per its form-input-binding validation rule
  - **Engine divergence (2026-08-10, user-testing ruling):** the engine downgraded `UNBOUND_FORM_INPUT` from a fatal reject to non-fatal `warnings` on a valid result (surfaced as instance-level `WARNING` trace rows at start — `src/spec/validator.ts` `formInputBindingWarnings`, `src/core/instance.ts`). The fixture's `valid=true` expectation therefore now genuinely PASSES in the engine — this is the one place the port intentionally does NOT reproduce the reference failure recorded at the vendored commit. Test re-enabled (no longer `test.skip`) in `test/validator-conformance.test.ts`. The live TrajectoryRuntime engines adopted the same downgrade on 2026-08-10 (`e248fd1`), so their own runner also scores 79/3 now; the failure documented above remains true of the vendored commit `fcec3987`.

**Execution fixtures (3, deferred to Task 13):**
- **exec-child-001** (`execution/exec-child-001-simple.json`)
  - Reference failure: `Trace mismatch: Trace length mismatch: expected 4, got 6`

- **exec-child-002** (`execution/exec-child-002-params.json`)
  - Reference failure: `Workflow state: expected "COMPLETED", got "RUNNING"`

- **exec-child-003** (`execution/exec-child-003-user-interaction.json`)
  - Reference failure: `Validation failed: MISSING_REQUIRED_FIELD`

**Harness scope (updated — Task 13 complete):** validation fixtures (28) run via `validate()` directly in `test/validator-conformance.test.ts`; execution (33), parameters (8), and resources (13) run via the DB-backed conformance harness (`src/conformance/harness.ts`, `test/conformance.test.ts`), which also handles the 3 validation-category fixtures living inside `resources/` (`res-validation-001/002/003`) through the harness's own `validate()` dispatch path. Result (updated 2026-08-10): 79 passed / 0 failed / 3 skipped across all 82 fixtures. The reference runner's own split at the vendored commit remains 78 passed / 4 failed; the engine deliberately deviates on `val-struct-002` (the UNBOUND_FORM_INPUT warning downgrade above), which now passes here, while the 3 `exec-child-*` fixtures stay routed to `test.skip` with a reason pointing back here.

---

## `workflow-schema.json` vendoring (final-review Critical 1 fix, 2026-08-02)

`src/spec/workflow-schema.json` is a **separate vendoring** from the fixtures above — same E8 vendoring stance (external reference repo is the source of truth; corrections happen there and get re-synced here), different file, different reason: `src/spec/validator.ts`'s `structuralValidation` needs the actual JSON Schema document, not a test fixture.

**Source Repository:** TrajectoryRuntime (the reference runtime; not part of this repository)
**Source Path:** `spec/workflow-schema.json`
**Source Commit:** `90bf069372df0ca6143e1acd05f5cbc10f695086` (Task 2 schemaVersion 5.0 bump)
**Vendor Date:** 2026-08-03
**Schema version:** `v4.0` document (`$id: https://trajectory.com/schemas/workflow/v4.0/workflow-schema.json`; enum widened to accept instance schemaVersion "5.0" — the 5.0 envelope's form_document field needs no schema entry; the schema has no additionalProperties:false)

**Why this file exists at all (the defect being fixed):** before this vendoring, `validator.ts`'s `loadSchema()` located the schema via a `readFileSync` probe against a list of `__dirname`-relative candidate paths. Under `tsx` in local dev, the last candidate happened to resolve to the `TrajectoryRuntime` submodule checkout — the ONLY copy of the file that existed anywhere in the repo. The production Docker image copies nothing but the bundled `engine.mjs` into the final stage (`Dockerfile`), and the root `.dockerignore` excludes `TrajectoryRuntime` from the build context entirely — so in the container every candidate path missed, `loadSchema` threw, and because that throw happened inside the acquire+start transaction (not tagged `StartRecoveryFailedError`), the transaction rolled back to `queued` and the SAME instance re-wedged head-of-line forever, with only a rate-limited stderr line as a symptom.

**The fix:** `validator.ts` now imports this file as a **static JSON module** (`import workflowSchemaRaw from './workflow-schema.json' with { type: 'json' }`) instead of probing paths at runtime. esbuild inlines the JSON content directly into `engine.mjs` at bundle time (the Dockerfile's existing `npx esbuild ... --bundle` step needs no changes), so the production image is self-contained by construction — no COPY step, no runtime path resolution, no submodule dependency at container-run time. `tsx` (dev) and Vite/vitest (tests) both resolve `with { type: 'json' }` imports natively, so the same source line works unmodified in every context this file runs in. The old candidate-path probe was removed outright rather than kept as a fallback — keeping it around risked exactly the shadowing this defect already demonstrated (a stale/independently-drifted submodule copy silently winning over the vendored one in dev, while prod always used the bundle) with no compensating benefit, since the static import can never fail to resolve once `npm ci`/`npm run typecheck` succeed.

**Re-sync procedure:** when `TrajectoryRuntime`'s `spec/workflow-schema.json` changes (e.g. gains a `5.0` schema version), copy it over this file (the reference repository's `spec/workflow-schema.json` to `MissionEngine/src/spec/workflow-schema.json`) and update the Source Commit / Schema version fields above. `loadSchema()`'s own `relaxFormElementRequired` + `$schema`-deletion post-processing runs on every read from a deep clone, so re-syncing never requires touching `validator.ts` itself unless the schema's `$defs` shape actually changes. **Push-order rule:** the TrajectoryRuntime commit must be pushed to its origin BEFORE the superproject gitlink bump is committed (a pointer must never precede its commit on the remote).

**Engine divergence — form_document (2026-08-03):** both `getFormElements` and `formInputBindingValidation` read the 5.0 envelope's `form_document`; the reference predates it, so there is nothing to transcribe — the fallback and validation guard are engine-only code, spec'd in `docs/superpowers/specs/2026-08-03-schemaversion-5-design.md`.
