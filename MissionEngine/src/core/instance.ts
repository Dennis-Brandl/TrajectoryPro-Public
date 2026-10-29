// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { eq, and, inArray } from 'drizzle-orm';
import { stepInstance } from 'mission-control-db/src/db/schema/index';
import type { AcquiredRuntimeWorkflow } from 'mission-control-db/src/runtime/engine-access';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import { validate } from '../spec/validator.js';
import { canonicalStepType } from './step-handlers.js';
import { InMemoryResourceManager } from './resources.js';
import { openContext, settleTerminal } from './context.js';
import { recordFailedActiveRuns } from './step-run.js';
import { drainCascade, settleIfComplete, NON_TERMINAL_STEP_STATES, StartRecoveryFailedError } from './transition.js';

/**
 * Start a freshly-acquired queued instance. `acquireQueuedRuntimeWorkflows` (mission-control-
 * db's shared engine-access contract) already flipped status queued->running and stamped
 * started_at as part of its own atomic SKIP LOCKED claim — see loop.ts's runOnce, which calls
 * it before this function ever runs. So the "set status running+startedAt" half of the
 * brief's contract is already done by the time we get here; this function's job is:
 *   - validate the spec (ported validator) — on failure, OVERRIDE to status 'errored' with an
 *     error trace entry and a stamped completedAt/finalState (history wiring is Task 17);
 *   - on success: init PropertyStore + resources (transcribed from reference
 *     engine.ts:116-168), complete the START step, and materialize its routed successors as
 *     READY step_instance rows.
 */
export async function startInstanceFromQueued(
  tx: Db,
  acquired: AcquiredRuntimeWorkflow,
  deps: EngineDeps,
): Promise<void> {
  const context = await openContext(
    tx,
    { id: acquired.id, workCenterId: acquired.workCenterId, specJsonb: acquired.specJsonb, engineState: null, propertyStore: null },
    deps,
  );

  const validation = validate(acquired.specJsonb as Record<string, unknown>);
  if (!validation.valid) {
    await context.recordTrace(
      tx, null, 'ERRORED', undefined,
      validation.error_message ?? validation.error_code ?? 'invalid workflow specification',
    );
    await context.persist(tx);
    await settleTerminal(tx, context, 'errored', 'errored', deps.now);
    return;
  }
  // Non-fatal validator findings (UNBOUND_FORM_INPUT downgrade, 2026-08-10): one instance-
  // level WARNING trace row each — same null-stepOid channel as the ERRORED row above, which
  // trace assembly attributes to the root spec — then startup proceeds normally. The unbound
  // value is discarded at submit time by captureFormOutputs, exactly as the message says.
  for (const w of validation.warnings ?? []) {
    await context.recordTrace(tx, null, 'WARNING', undefined, w.message);
  }

  const spec = context.spec;
  context.props.initializeFromWorkflow(spec);
  // Task 13 (conformance harness): setup.initial_properties, merged in BEFORE starting-parameter
  // resolution — matches the reference engine.ts constructor's own ordering (initializeFromWorkflow
  // -> initializeFromSetup -> initializeStartingParameters). deps.harnessInitialProperties is only
  // ever set by src/conformance/harness.ts; undefined for every real production instance.
  if (deps.harnessInitialProperties) {
    context.props.initializeFromSetup(deps.harnessInitialProperties);
  }
  context.props.initializeStartingParameters(
    spec.starting_parameter_specifications,
    acquired.startingParams ?? undefined,
  );

  // Resource manager init — transcribed from reference engine.ts:133-168 (start()).
  const hasResourceSpecs = !!spec.resource_property_specifications?.length;
  const hasResourceCmds = spec.steps.some(s => s.resource_command_specifications?.length);
  const childHasResourceCmds = spec.children?.some(cw => cw.steps.some(s => s.resource_command_specifications?.length));
  const hasEnvResources = spec.environment_specifications?.some(env => env.resource_property_specifications?.length);
  // Task 13: a fixture's setup.resources (never itself part of the workflow's own declared
  // resources) also forces a ResourceManager into existence, mirroring the reference runner's
  // own fallback (runner.ts:154-157).
  const hasHarnessResources = !!deps.harnessSetupResources?.length;
  if (hasResourceSpecs || hasResourceCmds || childHasResourceCmds || hasEnvResources || hasHarnessResources) {
    context.resources = new InMemoryResourceManager();
  }

  // Workflow-scoped resources: keyed `${workflow.oid}:${name}`.
  if (context.resources && spec.resource_property_specifications) {
    for (const r of spec.resource_property_specifications) {
      if (r.scope !== 'environment') {
        context.resources.registerResource(`${spec.oid}:${r.name}`, r, spec.oid, 'workflow');
      }
    }
  }
  // Task 4 (Phase 2a, Ruling B): environment-scoped resources are NO LONGER registered into the
  // local manager — they route to context.root.envResources (openContext's hydration, routed by
  // transition.ts's resolveResourceTier) instead. Registering them here too would be dead
  // weight at best (unreachable once routing exists) and a landmine at worst: it would still
  // serialize into engine_state.resources and still show up in the local manager's
  // getSnapshot(), reporting a resource as free while it is actually held elsewhere in the work
  // center — exactly the "a key is either local or shared, never both" trap this program exists
  // to close.
  // Task 13 (conformance harness): setup.resources, keyed `test:${name}` — reference
  // runner.ts:139-145's ad hoc registration, ported verbatim (fixed "test" owner id).
  if (context.resources && deps.harnessSetupResources) {
    for (const r of deps.harnessSetupResources) {
      context.resources.registerResource(`test:${r.name}`, r, 'test');
    }
  }

  const startStep = spec.steps.find(s => canonicalStepType(s.step_type) === 'START');
  if (!startStep) {
    // Defensive: the validator guarantees exactly one START step (NO_START_STEP /
    // MULTIPLE_START_STEPS), so this is unreachable in practice.
    await context.recordTrace(tx, null, 'ERRORED', undefined, 'No START step found despite passing validation');
    await context.persist(tx);
    await settleTerminal(tx, context, 'errored', 'errored', deps.now);
    return;
  }

  // START auto-completes immediately (reference engine.ts:174-178); it never becomes a
  // step_instance row of its own — only its routed successors do.
  await context.recordTrace(tx, startStep.oid, 'COMPLETED');

  // Task 13: drainCascade eagerly activates START's routed successors (and cascades through
  // any further auto-completing chain, exactly matching the reference's fully-synchronous
  // `start()` -> `drainCompletionQueue()`) rather than leaving them as bare READY rows for a
  // later processReadyStep pickup — see transition.ts's drainCascade doc comment for why this
  // matters for PARALLEL fan-out trace parity (task-13-brief.md's exec-parallel-* fixtures).
  //
  // Narrowly try/catch JUST this call (C2-for-instance-start fix) — NOT the settleIfComplete/
  // persist calls below, which the C1 atomicity test (linear-flow.test.ts) deliberately exploits
  // to prove a genuine infrastructure failure (e.g. persist() itself throwing) rolls the WHOLE
  // acquire+start transaction back to 'queued', a legitimately retryable state, rather than
  // being silently reinterpreted as a poisoned workflow. drainCascade is where STEP ACTIVATION
  // LOGIC runs (deps.beforeStepActivation's test hook, and any real step-logic throw) — a step
  // that can never successfully activate must not roll back to 'queued' and get re-acquired
  // FIRST on every subsequent runOnce cycle forever (queued_at ordering has no back-off), which
  // would permanently starve every other queued instance behind it — the exact head-of-line-
  // blocking shape C2 already guards against for the processReadyStep path (ledgered from
  // Task 9's review, M5/C2). Before this task, everything beyond START's IMMEDIATE successors
  // only ever activated in a LATER, separate processReadyStep transaction, where loop.ts's own
  // C2 recovery (settleFailedInstance) already handled this; eager cascading moved that same
  // risk into THIS transaction, so it needs the identical treatment here, inline (never
  // re-thrown — re-throwing would roll back the acquireQueuedRuntimeWorkflows UPDATE too).
  let settled: boolean;
  try {
    settled = await drainCascade(tx, context, [startStep.oid], deps);
  } catch (err) {
    // I4 fix (Task 13 post-review): if THIS recovery itself throws (a genuine DB-level failure,
    // not a poisoned workflow), re-throw a tagged StartRecoveryFailedError so loop.ts's own
    // recovery layer (recoverFailedStart) can tell it apart from an ordinary throw escaping
    // from somewhere else entirely (e.g. the untouched happy-path persist() below, at the very
    // end of this function — the C1 atomicity test's own scenario, which must keep rolling back
    // to a silent, retryable 'queued' state exactly as before, NOT get bounced into I4's
    // bounded-retry machinery).
    try {
      const message = err instanceof Error ? err.message : String(err);
      await context.recordTrace(tx, null, 'ERRORED', undefined, message);
      await recordFailedActiveRuns(tx, context, message);
      await tx.update(stepInstance).set({
        state: 'ERRORED', error: message, completedAt: deps.now(), updatedAt: deps.now(),
      }).where(and(
        eq(stepInstance.workflowInstanceId, acquired.id),
        inArray(stepInstance.state, NON_TERMINAL_STEP_STATES),
      ));
      await context.persist(tx);
      await settleTerminal(tx, context, 'errored', 'errored', deps.now);
      return;
    } catch (recoveryErr) {
      throw new StartRecoveryFailedError(recoveryErr);
    }
  }
  if (settled) return; // failStep/dispatchReturn already persisted + settled the instance terminal

  // A trivial workflow (e.g. START -> END with nothing else) can now complete ENTIRELY within
  // this eager cascade — settleIfComplete's root case must run here too, or the instance would
  // be left 'running' forever with no READY row left for any future runOnce call to ever find.
  await settleIfComplete(tx, context, context.spec.oid, deps);
  await context.persist(tx);
}
