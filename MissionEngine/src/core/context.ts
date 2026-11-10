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
import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';
import { workflowInstance, stepInstance, traceEntry, workCenter, appUser, type StepRunResult } from 'mission-control-db/src/db/schema/index';
import { writeRuntimeHistory } from 'mission-control-db/src/runtime/engine-access';
import { workflowOutputs } from 'mission-control-db/src/runtime/workflow-outputs';
import { loadSharedValueProperties, writeSharedValueProperties } from 'mission-control-db/src/runtime/wc-value-properties';
import {
  lockRegistry, readHolders, applyRegistryWrites, releaseInstanceWaiters, consumeForeignHolders,
  NOTIFY_GRANT_CHANNEL,
  type WcRegistrySnapshot,
} from 'mission-control-db/src/runtime/wc-resources';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { MasterWorkflowSpecification, MasterWorkflowStep } from '../spec/types.js';
import { PropertyStore } from './properties.js';
import { SharedPropertyTier } from './shared-properties.js';
import { InMemoryResourceManager } from './resources.js';
import { loadEngineState, type EngineState } from './engine-state.js';
import {
  snapshotToSerialized, indexWaiters, diffRegistry, envToken, parseEnvToken, allManagerTokens,
  type LoadedWaiterIndex, type EnvHold,
} from './env-resource-bridge.js';
import { isEnvironmentCommand, collectEnvironmentScope, type EnvironmentScope } from './env-scope.js';
import { assembleReferenceTrace, type RawTraceRow } from './trace-assembly.js';
import { recordStepRun, recordFailedActiveRuns } from './step-run.js';
import { CLEANUP_STATUS, FINAL_STATUS, HALT_STATUS, queueCleanupAborts } from './operator-cleanup.js';

export type TerminalStatus = 'completed' | 'aborted' | 'stopped' | 'errored';

/** The trace states that end a step run, and the step_run result each records. */
const TRACE_RUN_RESULT: Record<string, StepRunResult | undefined> = {
  COMPLETED: 'completed', ERRORED: 'failed', ABORTED: 'aborted',
};

/** Minimal shape WorkflowContext needs from a workflow_instance row. A freshly-acquired
 *  queued row (instance.ts) synthesizes this with null engineState/propertyStore; a
 *  re-selected running row (transition.ts) passes the real columns straight through. */
export interface ContextRow {
  id: string;
  workCenterId: string;
  specJsonb: unknown;
  engineState: unknown;
  propertyStore: unknown;
}

/** Recursively search a spec tree (this spec + every nested `.children` entry, at any depth)
 *  for the spec whose own `oid` matches `oid`. deepCopySpec gives every child a unique oid at
 *  creation time, so at most one match exists anywhere in the tree (Task 12). */
export function findSpecByOid(spec: MasterWorkflowSpecification, oid: string): MasterWorkflowSpecification | undefined {
  if (spec.oid === oid) return spec;
  for (const child of spec.children ?? []) {
    const found = findSpecByOid(child, oid);
    if (found) return found;
  }
  return undefined;
}

/** Recursively search a spec tree for the step definition owning `stepOid` (this spec's own
 *  `.steps`, or any nested child spec, at any depth). Returns the OWNING spec alongside the
 *  step definition — Task 12. */
function findStepInSpec(spec: MasterWorkflowSpecification, stepOid: string): [MasterWorkflowSpecification, MasterWorkflowStep] | undefined {
  const found = spec.steps.find(s => s.oid === stepOid);
  if (found) return [spec, found];
  for (const child of spec.children ?? []) {
    const nested = findStepInSpec(child, stepOid);
    if (nested) return nested;
  }
  return undefined;
}

/** Phase 7 (spec D6): oid -> local_id for every step of the root and every nested child —
 *  the display-name map that survives instance deletion (the frozen spec does not). Same
 *  recursive shape as trace-assembly.ts's collectSpecMaps, kept local: only names needed. */
function collectStepNames(spec: MasterWorkflowSpecification, into: Record<string, string> = {}): Record<string, string> {
  for (const s of spec.steps) into[s.oid] = s.local_id;
  for (const child of spec.children ?? []) collectStepNames(child, into);
  return into;
}

/** Reference engine.ts:825 collectKnownStepOids: this context's own step oids, PLUS —
 *  recursively — the steps of any CURRENTLY ACTIVE child spawned from one of them (Task 12;
 *  ledgered from Task 11's review). An inactive/already-completed child is correctly excluded
 *  (its childActive entry is gone by the time it's inactive), mirroring the reference's own
 *  activeChildEngines-scoped recursion. Used to scope resource-waiter cancellation so it never
 *  reaches into siblings or ancestors outside this context's own branch.
 *
 *  Task 5 (review round 2, Finding 2): moved here from transition.ts, alongside envSweepTokens
 *  below — transition.ts already imports findSpecByOid from this file, so this is the ONE
 *  direction that avoids a circular import; a hand-duplicated copy in context.ts (round 1's
 *  own envQueueTokensForInstance) is exactly the drift pair this file's own env-scope.ts doc
 *  comment warns about. transition.ts now imports both from here. */
export function knownStepOids(context: WorkflowContext): Set<string> {
  return collectStepOidsUnder(context.spec, context.state.childActive);
}

/** The SAME walk as knownStepOids, rooted at an arbitrary nested spec rather than a context's
 *  own — transition.ts's reset/teardown paths use it to snapshot a DYING child subtree's oids
 *  BEFORE tearDownActiveChild deletes the `childActive` links the walk depends on (whole-branch
 *  review C2's defence-in-depth half), without having to materialize a view for a child that is
 *  about to be dropped. Returns an empty set for a spec oid that isn't in this tree. */
export function knownStepOidsUnder(root: WorkflowContext, specOid: string): Set<string> {
  const spec = findSpecByOid(root.spec, specOid);
  return spec ? collectStepOidsUnder(spec, root.state.childActive) : new Set<string>();
}

function collectStepOidsUnder(
  spec: MasterWorkflowSpecification, childActive: Record<string, string>,
): Set<string> {
  const result = new Set<string>();
  const collect = (s: MasterWorkflowSpecification): void => {
    for (const step of s.steps) {
      result.add(step.oid);
      const childOid = childActive[step.oid];
      if (!childOid) continue;
      const childSpec = findSpecByOid(s, childOid);
      if (childSpec) collect(childSpec);
    }
  };
  collect(spec);
  return result;
}

/** Task 4 (Ruling A): map a set of bare step oids into their environment-tier tokens for
 *  cancelQueuedWaiters/flushGranted sweeps — the env manager's queues (and pending grants) hold
 *  `envToken(instanceId, stepOid)` tokens, never bare oids, so an unmapped sweep would cancel
 *  nothing there. A cancelled or aborted step's env waiter surviving write-back is not cosmetic:
 *  diffRegistry would see it as still-queued, so its `wc_resource_waiter` row would persist, and
 *  when the holder eventually releases, the resource would be granted to a DEAD step's token —
 *  nothing can ever consume that grant (the step is gone), so the capacity stays reserved and
 *  the resource wedges for the WHOLE WORK CENTER, not just this one instance. */
export function envSweepTokens(instanceId: string, oids: Set<string>): Set<string> {
  return new Set([...oids].map((oid) => envToken(instanceId, oid)));
}

/**
 * Whole-branch review C2 (Critical): EVERY environment-tier token the live manager currently
 * holds — queued or already granted-and-parked — that belongs to THIS instance. The terminal
 * sweep's token set, derived from the MANAGER rather than from the spec tree.
 *
 * `envSweepTokens(id, knownStepOids(ctx))` (above) is an incomplete cover of this instance's own
 * tokens and cannot be made complete: `knownStepOids` walks `state.childActive`, so it sees this
 * context's own steps plus the steps of CURRENTLY ACTIVE children only — and `tearDownActiveChild`
 * deletes a `childActive` link (and every `step_instance` row under it) while sweeping nothing.
 * From that moment the torn-down child's queued token is invisible to every knownStepOids-scoped
 * sweep, including `settleEnvTierAtTerminal`'s own. That is not cosmetic: an own-token still sitting
 * at the queue head when the terminal sweep calls `manager.release()` gets handed the freed
 * capacity straight back — precisely the self-grant hazard that function's doc comment claims to
 * have closed (it was closed only for steps knownStepOids could see) — and a surviving waiter row
 * for a dead step wedges the resource for the WHOLE work center.
 *
 * Ownership is the only correct filter, and it is exact: a token is `${instanceId}::${stepOid}`
 * (env-resource-bridge.ts), so `parseEnvToken(...).instanceId === context.id` matches this
 * instance's tokens and NOTHING else. Deliberately not "every token in the queue": a FOREIGN
 * instance's queued token is not this one's to cancel, and cancelling one would trade the wedge
 * this fixes for a different leak (a live instance waiting forever on a queue entry that silently
 * vanished). Used ONLY at terminal, where cancelling every one of this instance's own waits is
 * exactly right; the mid-instance sweeps (transition.ts) stay branch-scoped by design.
 */
export function ownEnvTokens(context: WorkflowContext): Set<string> {
  const manager = context.root.envResources;
  if (!manager) return new Set<string>();
  const own = new Set<string>();
  for (const token of allManagerTokens(manager)) {
    if (parseEnvToken(token).instanceId === context.root.id) own.add(token);
  }
  return own;
}

/**
 * Post-Task-5 review (Critical fix): the "capture" half of giving back a cancelled branch's
 * still-outstanding environment RESERVATIONS — a queued Acquire the manager already granted
 * (a foreign release's FIFO pass, or an earlier command in the same blocking attempt) but this
 * instance never consumed through resumeGrantedSteps before the branch holding it was
 * cancelled/escalated/errored uncaught. `cancelQueuedWaiters` clears matching `pendingGrants`
 * entries as a side effect (resources.ts's own doc comment) but returns nothing, and
 * `flushGranted`'s own return was previously discarded at every one of transition.ts's three
 * cancel-sweep sites — so that reserved unit was neither released back through the manager (no
 * FIFO cascade to the next waiter) nor ever recorded anywhere recoverable: gone from
 * `pendingGrants` (swept), never in `state.envHolds` (only a CONSUMED grant is appended there).
 * After persist()'s write-back, `wc_resource.inUse` stays permanently elevated with zero holder
 * rows and zero waiter rows — wedged for the WHOLE WORK CENTER, the exact failure mode Ruling A
 * exists to prevent, reached through a different door. Worse than the equivalent terminal-path
 * bug this mirrors: none of these three sites end the instance, so the leak persists while the
 * instance keeps running, and it can never be cleaned up later at terminal either —
 * `settleEnvTierAtTerminal` (below) derives ITS OWN reservations from `flushGranted`'s live
 * return too, and by then this one is already gone from `pendingGrants`.
 *
 * MUST be called BEFORE `cancelQueuedWaiters(ownTokens)` runs for the SAME token set —
 * `cancelQueuedWaiters` filters `pendingGrants` by those oids as part of its own queue sweep, so
 * capturing afterward finds nothing left to capture.
 *
 * Looks up each grant's amount/name against the frozen hydration-time snapshot's granted waiter
 * rows for this instance — safe because a grant `flushGranted` still returns here has NOT been
 * consumed by resumeGrantedSteps earlier in this transaction (consumption is exactly what would
 * have removed it from `pendingGrants`), so the snapshot values cannot be stale for it.
 *
 * Whole-branch review (deferred item 8): `settleEnvTierAtTerminal` below now CALLS this function
 * rather than carrying a near-verbatim copy of it. The copy was justified while the terminal path
 * was thought to need its own ordering guarantees, but the two blocks were provably identical —
 * the capture half is pure (flush the live grants, look each up in the frozen snapshot, warn and
 * skip an unmatched one) and carries no ordering obligation of its own beyond "before the cancel
 * sweep", which both callers already satisfy. This was the third instance of that duplication
 * class in the program. Paired with `releaseEnvReservations` below, which must run AFTER the
 * cancel sweep. */
export function captureEnvReservations(root: WorkflowContext, ownTokens: Set<string>): EnvHold[] {
  const manager = root.envResources;
  if (!manager) return [];
  const liveGrants = manager.flushGranted(ownTokens);
  if (liveGrants.length === 0) return [];
  const snapByToken = new Map(
    (root.envSnapshot?.waiters ?? [])
      .filter((w) => w.granted && w.instanceId === root.id)
      .map((w) => [envToken(w.instanceId, w.stepOid), w] as const),
  );
  const reservations: EnvHold[] = [];
  for (const g of liveGrants) {
    const w = snapByToken.get(g.stepOid);
    if (!w) {
      console.warn(
        `[mission-engine] instance ${root.id}: a pending environment grant for resource "${g.resourceKey}" ` +
        `(token "${g.stepOid}") has no matching hydration-time waiter row — cannot determine its ` +
        'reserved amount/name; skipping the give-back for this one reservation',
      );
      continue;
    }
    reservations.push({ name: w.name, stepOid: w.stepOid, amount: w.amount ?? 1, heldName: w.grantedName });
  }
  return reservations;
}

/**
 * Post-Task-5 review (Critical fix): the "release" half of `captureEnvReservations` above — run
 * AFTER `cancelQueuedWaiters(ownTokens)` has already cleared this instance's own QUEUE entries
 * out of the manager, so `release()`'s own FIFO grant pass can only ever hand the freed capacity
 * to a genuinely FOREIGN instance's waiter, never back to one of this same cancelled branch's
 * own remaining queued steps — the identical self-grant hazard `settleEnvTierAtTerminal`'s own
 * doc comment describes for the terminal case, reached here through the ordinary (non-terminal)
 * cancel path instead. One `release()` call per reservation — the only way to both decrement the
 * counter AND cascade the grant onward to the next queued waiter, rather than merely letting the
 * capacity evaporate uncounted. No separate DB write here: none of this function's three callers
 * (transition.ts's `releaseAllInstanceResources`, `escalateChildFailure`, and `failStep`'s
 * uncaught path) are the terminal choke point `settleEnvTierAtTerminal` owns, so the eventual
 * registry write-back rides on whatever `persist()` call runs later in this SAME transaction
 * (Task 5's diffRegistry already reads `root.envResources`'s live, just-updated state). */
export function releaseEnvReservations(root: WorkflowContext, reservations: EnvHold[]): void {
  const manager = root.envResources;
  if (!manager) return;
  for (const r of reservations) manager.release(r.name, r.amount, r.heldName ?? undefined);
}

/**
 * Live, in-memory working set for one workflow_instance for the duration of a single
 * transition (one transaction — see loop.ts's LOCKING PROTOCOL). Constructed fresh from the
 * locked row at the start of the transaction and persist()ed back at the end; never held
 * across transactions.
 *
 * Task 12 (WORKFLOW PROXY / child workflows): a child spec executes its steps as
 * `step_instance` rows in the SAME `workflow_instance`, sharing this context's `id`,
 * `resources` (ResourceManager — reference engine.ts:707's shared resourceManager), and
 * `state` (EngineState — trace order counters, routingContext, waitAll, etc. are all keyed by
 * spec oid or step oid, which are globally unique across the whole tree, so one shared EngineState
 * safely holds everyone's bookkeeping). What a child does NOT share is `.spec` (its OWN steps/
 * connections, not the root's) or `.props` (its OWN PropertyStore, seeded as a COPY of the
 * parent's flat map at activation — reference engine.ts:700-701 — then diverging independently;
 * see EngineState.childProperties's doc comment for why it needs its own serializable home).
 *
 * `contextForNode(nodeOid)` returns a "view": a WorkflowContext scoped to a nested child spec
 * (or the real root, if nodeOid is the root's own oid). Views are MEMOIZED on the root, one per
 * node oid, for the lifetime of this root instance (i.e. for the duration of the whole
 * transition — a fresh root, and hence a fresh empty cache, is constructed per
 * processReadyStep/submitUserAction call). This is load-bearing, not an optimization (C1 fix,
 * post-Task-12 review): every caller resolving the SAME child spec oid — e.g.
 * processReadyStep's stepCtx for one step, and a LATER resumeGrantedSteps call resolving a
 * DIFFERENT step in that same child via findStep — must share the exact same PropertyStore
 * INSTANCE. Minting a fresh PropertyStore per call (the pre-fix behavior) meant two temporary
 * views of one child, each built by deserializing the same stale state.childProperties
 * snapshot, would silently clobber each other's writes whichever one's syncChildProps() ran
 * last — real data loss, not just a redundant rebuild. With memoization there is only ever ONE
 * live PropertyStore per child spec oid per transition, so ordinary in-process aliasing
 * semantics apply: every writer's mutation is immediately visible to every other holder of the
 * same view, and syncChildProps() (still called, in bulk, by persist() — see below) can run at
 * any time without a "sync before the next possible persist" ordering rule to get right.
 *
 * persist() must NEVER be called on a view (it would clobber the ROOT's property_store column
 * with a child's properties) — it throws if attempted; only the true root instance (constructed
 * directly from a workflow_instance row) may call it. persist() flushes EVERY currently cached
 * view's props into state.childProperties (syncAllChildProps()) before serializing state to
 * JSON, so callers never need to sync a view manually.
 */
export class WorkflowContext {
  readonly id: string;
  /** The work center this instance belongs to — same for the root and every view derived from
   *  it (a child spec never moves work centers). Phase 2b: the key openContext (below) loads
   *  the shared value-property tier under. */
  readonly workCenterId: string;
  /** This context's scope: the root spec for the true root, or a nested child spec for a view
   *  returned by contextForNode. */
  readonly spec: MasterWorkflowSpecification;
  /** True only for the instance constructed directly from a workflow_instance row — false for
   *  every view returned by contextForNode, including one scoped back to the root's own oid
   *  (contextForNode always returns the SAME real root instance for that case, never a view —
   *  see contextForNode below — so in practice isRoot is a simple discriminant, not a case that
   *  needs its own view construction path). */
  readonly isRoot: boolean;
  /** Shared, by reference, across the root and every view derived from it. */
  readonly state: EngineState;
  readonly props: PropertyStore;
  /** Shared, by reference, across the root and every view — Task 12: children acquire from and
   *  release to the SAME resource pools as the parent (reference engine.ts:707). */
  resources: InMemoryResourceManager | null;
  /** Phase 2b: the work-center-shared value-property tier, loaded by openContext (below) and
   *  shared BY REFERENCE with every view (contextForNode) exactly like `resources` — a child's
   *  write must be visible to its parent within the same transition, and to every other
   *  instance in the work center on its next read. Every ROOT construction site goes through
   *  openContext (see its own doc comment for the full list); the only place that deliberately
   *  does NOT is contextForNode's view branch, which shares the root's `sharedProps` by
   *  reference instead of loading its own. Null when this instance's work center has no shared
   *  rows — in that case PropertyStore behaves exactly as it did before this phase. */
  sharedProps: SharedPropertyTier | null = null;
  /** Phase 2a: the ENVIRONMENT tier — work-center-shared, hydrated from the registry under row
   *  locks and written back in persist(). Null when this recipe references no environment
   *  resources, in which case hydration never ran and costs nothing.
   *
   *  Deliberately a SECOND manager rather than more entries in `resources`: environment queues
   *  hold instance-prefixed tokens (`${instanceId}::${stepOid}`) and workflow queues hold bare
   *  step oids, and mixing the two key spaces in one map would force every call site of
   *  cancelQueuedWaiters/knownStepOids to get both encodings right. Shared by reference with
   *  every child view, exactly like `resources`. */
  envResources: InMemoryResourceManager | null = null;
  /** The registry rows this context was hydrated from — write-back diffs against them. */
  envSnapshot: WcRegistrySnapshot | null = null;
  /** (name, token) -> loaded waiter id, so a surviving waiter keeps its FIFO position. */
  envIndex: LoadedWaiterIndex | null = null;
  /** The names `openContext` actually got `wc_resource` rows back for, out of the lock set
   *  (`envResourceNames`) it locked — i.e. the registry's own account of what it holds, as
   *  opposed to what the recipe merely NAMES. The two can legitimately differ: this program's
   *  standing "no backfill" trap means a work center whose environment spec was never re-loaded
   *  after a package started declaring a new environment resource can be missing that resource's
   *  row entirely. Task 4 uses this set to detect exactly that gap and fail LOUDLY rather than
   *  silently falling back to a per-instance manager that was never the shared pool. Empty (not
   *  null) when hydration never ran, so callers can call `.has()` unconditionally. Shared by
   *  reference with every child view, exactly like the three fields above. */
  envKnownNames: ReadonlySet<string> = new Set();
  /** Every environment spec oid (and the resource names those specs declare) reachable in this
   *  frozen recipe — `collectEnvironmentScope`'s output, computed once (env-scope.ts). The SAME
   *  scope object `envResourceNames` (below) used to compute the registry lock set is what
   *  Task 4's routing reads via `context.root.envScope`, so "which tier a command belongs to"
   *  can never drift from "which names got locked" — both are the identical
   *  `isEnvironmentCommand(cmd, owningSpec, scope)` call over the identical `scope`. Computed
   *  synchronously from `.spec` alone (no DB read), so — unlike the three fields above — it is
   *  set in the constructor itself, not by `openContext`, and is available even on a
   *  direct-construction context. Shared by reference with every child view. */
  readonly envScope: EnvironmentScope;
  /** M1 fix (post-Phase-2b review): true once this ROOT context has gone through openContext
   *  (below) — set there via markHydrated(), never in the constructor, so a root built by
   *  calling `new WorkflowContext(row, now)` directly (skipping openContext) is structurally
   *  distinguishable from one built by the real factory. A direct-construction root silently
   *  leaves `sharedProps` null, dropping shared values from history and skipping the shared
   *  flush — exactly this miss already happened once this phase (loop.ts's settleFailedInstance
   *  site, caught only by a re-grep, not a test), and Phase 2a is about to add resource
   *  hydration to the same openContext seam, raising the cost of a future miss. Irrelevant for
   *  views: they never go through openContext by design (contextForNode shares the root's tier
   *  by reference instead), so assertHydrated() below is a no-op for them. */
  private hydrated = false;
  /** The engine clock. Public (read-only) so step-run.ts can stamp a run's finish time with the
   *  same clock recordTrace uses. */
  readonly now: () => Date;
  /** The true root instance this context was built from (itself, for the root). Views use this
   *  to reach the real `id`/`state`/`resources`/`now` and to search the whole spec tree. Public
   *  so callers holding ANY context (root or view) can reach the root directly — e.g. to check
   *  `context.root.spec.oid` or search `context.root.spec` for a step/child anywhere in the
   *  tree — without threading a separate root parameter through every helper (Task 12). */
  readonly root: WorkflowContext;
  /** Task 12 (C1 fix): memoized child views, keyed by spec oid, ONLY ever populated/read via
   *  the ROOT instance (`this.root.viewCache`) — every context, root or view, shares this ONE
   *  cache so a child spec oid always resolves to the identical WorkflowContext (and hence the
   *  identical PropertyStore) for as long as this root instance lives. See the class doc
   *  comment above for why this is load-bearing. */
  private readonly viewCache: Map<string, WorkflowContext>;

  /** Task 13 post-review (I1 fix): the pending BFS cascade queue for THIS context instance
   *  (root, or one memoized child view) — mirrors the reference's `completionQueue` being a
   *  PERSISTENT INSTANCE FIELD on WorkflowEngine (engine.ts), not a value created fresh per
   *  `drainCompletionQueue()` call. A nested, re-entrant trigger for the SAME context (e.g.
   *  `completeChildWorkflow`'s post-completion routing, a RETURN handler's re-activation, a
   *  resource grant's resumption — all of which can fire WHILE an outer cascade for this exact
   *  context is still mid-flight, several stack frames up) appends here instead of starting an
   *  isolated drain, so sibling activations an outer, still-active drain already queued keep
   *  their place (engine.ts:757-758's own comment on completeChildWorkflow/returnComplete makes
   *  this explicit: "sibling activations already queued keep their place"). See transition.ts's
   *  `drainCascade` for the drain loop and the `cascadeDraining` re-entrancy flag below. Each
   *  memoized child view gets its OWN separate queue (a fresh array per WorkflowContext
   *  instance), exactly matching the reference's per-child-WorkflowEngine independent
   *  `completionQueue` — cross-context cascades never share a queue, only same-context
   *  re-entrancy does. */
  cascadeQueue: string[] = [];
  /** True while `drainCascade` is actively iterating `cascadeQueue` for THIS context instance —
   *  a nested `drainCascade` call for the SAME context sees this and appends-then-returns
   *  instead of starting a second, competing drain loop (I1 fix). */
  cascadeDraining = false;
  /** Task 13 post-review (I3 fix): total activation attempts across THIS TRANSACTION's whole
   *  cascade — always read/written via `context.root.cascadeActivationCount` so root and every
   *  child share ONE counter (a machine cycle confined to a single child context must still be
   *  bounded by the SAME transaction-wide cap as a root-level one). `drainCascade` throws once
   *  this exceeds `MAX_CASCADE_ACTIVATIONS`, guarding against a validator-accepted machine cycle
   *  (e.g. a GOTO loop with no terminating condition) running forever inside one open PG
   *  transaction and wedging a worker slot. */
  cascadeActivationCount = 0;
  /** Spec 2026-08-22 §3.3: set when this context's subtree was torn down mid-transition
   *  (escalation, GOTO/RETRY reset, RESTART sweep — anything routing through dropCachedView).
   *  A still-unwinding drainCascade over a dead context must stop rather than materialize
   *  rows for a branch that no longer exists. Never set on the root. */
  dead = false;
  /** Spec 2026-10-27 §6.3: the person behind the step completing in THIS transaction — set by
   *  submit.ts (the claimant) and force-complete.ts (the operator) just before the completion,
   *  read by step-run.ts when that step's run is recorded. In memory only, never persisted into
   *  engine_state; always read/written via `context.root` so every view sees the one value. */
  stepRunActor: { stepOid: string; userId: string } | null = null;
  /** 2026-11-10: environment Releases this instance ran on a resource it held none of (transition.ts
   *  outcome 5) whose counter change already happened in `envResources`. The write-back
   *  (`applyForeignReleases`, from persist() and the terminal sweep) drains them and takes the
   *  units over from other instances' holder rows. In memory only; always read via `context.root`. */
  foreignReleases: Array<{ name: string; amount: number; heldName: string | null }> = [];

  constructor(row: ContextRow, now: () => Date);
  /** Internal: construct a child-context view sharing `root`'s id/state/resources/now, scoped
   *  to `spec`. Use WorkflowContext#contextForNode instead of calling this directly — it also
   *  handles memoization, which this constructor does NOT do on its own. */
  constructor(view: { root: WorkflowContext; spec: MasterWorkflowSpecification });
  constructor(
    rowOrView: ContextRow | { root: WorkflowContext; spec: MasterWorkflowSpecification },
    now?: () => Date,
  ) {
    if ('root' in rowOrView) {
      const { root, spec } = rowOrView;
      this.id = root.id;
      this.workCenterId = root.workCenterId;
      this.spec = spec;
      this.isRoot = false;
      this.state = root.state;
      this.props = PropertyStore.fromJSON(root.state.childProperties[spec.oid] ?? {});
      this.resources = root.resources;
      this.now = root.now;
      this.root = root;
      this.viewCache = root.viewCache;
      // Phase 2b: a view shares the ROOT's tier by reference, never loads its own — a child's
      // write must be visible to the root, and to every other instance, immediately.
      this.sharedProps = root.sharedProps;
      this.props.attachShared(root.sharedProps);
      // Phase 2a: same reasoning for the environment-resource tier — a child acquires from and
      // releases to the SAME pools as its parent, exactly like `resources` above.
      this.envResources = root.envResources;
      this.envSnapshot = root.envSnapshot;
      this.envIndex = root.envIndex;
      this.envKnownNames = root.envKnownNames;
      this.envScope = root.envScope;
      this.props.bindDeclaredNames(spec);
      return;
    }
    const row = rowOrView;
    this.id = row.id;
    this.workCenterId = row.workCenterId;
    this.spec = row.specJsonb as MasterWorkflowSpecification;
    this.isRoot = true;
    // Phase 2a: pure/synchronous — no DB read — so it is set here, not by openContext, and is
    // available even on a direct-construction context. Task 4's routing reads this SAME object
    // (via context.root.envScope) rather than recomputing it, so lock set and routing set can
    // never drift apart from each other.
    this.envScope = collectEnvironmentScope(this.spec);
    this.state = loadEngineState(row.engineState);
    this.props = row.propertyStore
      ? PropertyStore.fromJSON(row.propertyStore as Record<string, string>)
      : new PropertyStore();
    this.resources = this.state.resources ? InMemoryResourceManager.fromJSON(this.state.resources) : null;
    this.now = now!;
    this.root = this;
    this.viewCache = new Map();
    // Phase 2b: bind which property names THIS spec declares as its own — the shared tier
    // itself is attached separately by openContext (below), which needs an async DB read this
    // synchronous constructor can't perform.
    this.props.bindDeclaredNames(this.spec);
  }

  /** Resolve the context that owns `nodeOid` — the root spec's own oid, or any nested child
   *  spec oid anywhere in the tree (Task 12). Every `step_instance` row's `node_oid` column is
   *  exactly one of these, so this is the single place callers turn a row into the right
   *  context to process it against. Memoized (C1 fix) — repeat calls for the same nodeOid
   *  within this root's lifetime return the IDENTICAL context/PropertyStore instance. Throws if
   *  `nodeOid` doesn't resolve — defensive: every row this engine ever creates stamps a
   *  `node_oid` it just resolved from the tree itself. */
  contextForNode(nodeOid: string): WorkflowContext {
    if (nodeOid === this.root.spec.oid) return this.root;
    const cached = this.root.viewCache.get(nodeOid);
    if (cached) return cached;
    const spec = findSpecByOid(this.root.spec, nodeOid);
    if (!spec) throw new Error(`engine v1: no spec found for node "${nodeOid}" in instance ${this.id}`);
    const view = new WorkflowContext({ root: this.root, spec });
    this.root.viewCache.set(nodeOid, view);
    return view;
  }

  /** Task 12 (C1 fix): drop a memoized view so the NEXT contextForNode call for this oid mints
   *  a fresh one. Used by activateWorkflowProxy's "fresh child every activation" reset (a cycle
   *  re-entry onto the same WORKFLOW PROXY step must not resolve the OLD child's cached
   *  PropertyStore instance) and by child/grandchild teardown (returnAbandon/returnRestart's
   *  recursive cleanup) so a torn-down child's stale view can never be resolved again within
   *  this same transition. */
  dropCachedView(nodeOid: string): void {
    const cached = this.root.viewCache.get(nodeOid);
    if (cached) cached.dead = true; // spec 2026-08-22 §3.3 — stop any in-flight cascade over it
    this.root.viewCache.delete(nodeOid);
  }

  /** Find the step definition for `stepOid` anywhere in the tree (this context's own spec, or
   *  any nested child spec — Task 12) and return the context scoped to whichever spec owns it,
   *  paired with the step definition. Used wherever a step oid needs resolving without a DB
   *  row's node_oid already at hand — e.g. resumeGrantedSteps, since a resource grant (shared
   *  ResourceManager) can target any step anywhere in the tree, not just ones in the CURRENT
   *  context. */
  findStep(stepOid: string): { context: WorkflowContext; stepDef: MasterWorkflowStep } | undefined {
    const found = findStepInSpec(this.root.spec, stepOid);
    if (!found) return undefined;
    const [owningSpec, stepDef] = found;
    return { context: this.contextForNode(owningSpec.oid), stepDef };
  }

  /** Flush a view's in-memory PropertyStore mutations back into the shared
   *  state.childProperties home (Task 12). No-op for the root — its props live directly in
   *  workflow_instance.property_store via persist(). Idempotent and cheap. Callers generally
   *  don't need to call this directly — persist() calls syncAllChildProps() (below), which
   *  calls this for every currently memoized view — kept public for any call site that wants a
   *  single view's state.childProperties entry to be current before something else reads it
   *  directly (e.g. completeChildWorkflow reading a just-finished child's flat map). */
  syncChildProps(): void {
    if (this.isRoot) return;
    this.root.state.childProperties[this.spec.oid] = this.props.toJSON();
  }

  /** Task 12 (C1 fix): flush every currently memoized child view's props into
   *  state.childProperties in one pass. Called by persist() so no scattered, order-sensitive
   *  "sync before the next possible persist" calls are needed anywhere else — with views
   *  memoized (see contextForNode), a view's PropertyStore is the single live source of truth
   *  for that child for the whole transition, and only needs to be serialized once, right
   *  before persist() writes state to the DB. */
  private syncAllChildProps(): void {
    for (const view of this.root.viewCache.values()) view.syncChildProps();
  }

  /** M1 fix: called ONLY by openContext once the shared-property tier load (and, from Phase 2a,
   *  resource hydration) completes. Not folded into the constructor: the constructor is
   *  synchronous and openContext's DB read is not. */
  markHydrated(): void {
    this.hydrated = true;
  }

  /** M1 fix: throws if this ROOT context reaches persist() or settleTerminal without having
   *  gone through openContext. Public (like syncChildProps above) only because settleTerminal is
   *  a free function in this file, not a method — not meant to be called from outside
   *  context.ts. No-op for views (isRoot === false): they legitimately never go through
   *  openContext, and persist() already refuses to run on a view at all. */
  assertHydrated(): void {
    if (!this.isRoot) return;
    if (!this.hydrated) {
      throw new Error(
        `WorkflowContext ${this.id} (work center ${this.workCenterId}): constructed directly instead of through openContext() — the shared value-property tier was never loaded`,
      );
    }
  }

  /** Insert a trace_entry using the REFERENCE StepState vocabulary (COMPLETED, EXECUTING,
   *  WAITING, ERRORED, ...) — never the engine's queue vocabulary (READY, WAITING_USER, ...).
   *  Order is a per-owning-spec counter (Task 12: `this.spec.oid` is the CURRENT context's own
   *  spec — the root's oid for root-level steps, a child spec's oid for that child's own steps,
   *  restarting at 1 — mirroring the reference's per-WorkflowEngine-instance traceOrder). */
  async recordTrace(
    tx: Db,
    stepOid: string | null,
    state: string,
    afterAction?: number,
    error?: string,
  ): Promise<void> {
    const counterKey = this.spec?.oid ?? '__unknown__';
    const next = (this.state.orderCounters[counterKey] ?? 0) + 1;
    this.state.orderCounters[counterKey] = next;
    await tx.insert(traceEntry).values({
      workflowInstanceId: this.id,
      stepOid: stepOid ?? null,
      state,
      orderIndex: next,
      error: error ?? null,
      afterAction: afterAction ?? null,
      at: this.now(),
    });
    // Spec 2026-10-27 §6.2: the single choke point for a step run's ending — every COMPLETED/
    // ERRORED/ABORTED trace writes its step_run row in this same transaction.
    const result = stepOid ? TRACE_RUN_RESULT[state] : undefined;
    if (stepOid && result) await recordStepRun(tx, this, stepOid, result, error);
  }

  /** Write engine_state + property_store + updated_at back to workflow_instance. Does NOT
   *  touch status/final_state/completed_at — settleTerminal (below) owns those. Task 12: only
   *  the true root instance may call this — a view's `.props` is a DIFFERENT (child-scoped)
   *  store, and writing it here would clobber the root's property_store column. */
  async persist(tx: Db): Promise<void> {
    if (!this.isRoot) {
      throw new Error('WorkflowContext.persist() must only be called on the root context — call syncChildProps() on a child view instead');
    }
    this.assertHydrated();
    this.syncAllChildProps();
    // Phase 2b: flush any shared-tier writes accumulated since the last flush. Drained (not
    // just read) so persist() being called more than once in a transition never double-writes.
    // Deliberately BEFORE the workflow_instance UPDATE below, matching every other pre-existing
    // write in this method — order doesn't matter for correctness (different tables), but
    // keeping the shared flush textually first mirrors "load, then use, then flush" symmetry
    // with openContext's own "construct, then load" ordering.
    const dirtyShared = this.sharedProps?.takeDirty() ?? [];
    if (dirtyShared.length > 0) {
      const matched = await writeSharedValueProperties(tx, this.workCenterId, dirtyShared, this.now());
      if (matched < dirtyShared.length) {
        // M5 fix: writeSharedValueProperties treats a zero-row UPDATE as non-fatal by design (a
        // row can be removed from the work center underneath a long transition — see its own doc
        // comment) but a silently dropped write should still leave a trace: takeDirty() already
        // drained the entries above, so without this log a write to a row deleted mid-transition
        // vanishes with no record it ever happened.
        console.warn(
          `[mission-engine] instance ${this.id}: shared-property flush matched ${matched}/${dirtyShared.length} rows — ` +
          `${dirtyShared.length - matched} write(s) silently dropped (row(s) removed from work center ${this.workCenterId} mid-transition)`,
        );
      }
    }
    // Phase 2a (Task 5): write back the environment-resource tier — the shared tier's own
    // counterpart to the shared-value-property flush above. Deliberately AFTER that flush and
    // BEFORE serializedState below: nothing the earlier phases added here is reordered or
    // removed. `serializedState` (below) spreads `this.state`, so `state.envHolds` serializes
    // for free — that is correct and intended — but `resources:` there keeps taking ONLY the
    // LOCAL manager's toJSON(): `this.envResources` must NEVER be written into engine_state,
    // or the per-instance copy this whole phase exists to eliminate would come right back.
    if (this.envResources && this.envSnapshot && this.envIndex) {
      // Deferred Task 3 minor, resolved by the controller as "assert, don't filter": readHolders
      // (openContext) returns every hold for this instance regardless of name, while the lock set
      // taken here is filtered to the names the frozen recipe's own commands reference — so
      // state.envHolds can in principle name a resource this hydration never locked. Filtering
      // the holds silently here would DROP that entry from the write-back and orphan it.
      // Assert the invariant instead: a mismatch here would otherwise write a
      // wc_resource_holder row for a resource nobody locked in this transaction.
      for (const h of this.state.envHolds) {
        if (!this.envKnownNames.has(h.name)) {
          throw new Error(
            `WorkflowContext ${this.id} (work center ${this.workCenterId}): envHolds names ` +
            `resource "${h.name}", which was not locked in this hydration — known names: ` +
            `[${[...this.envKnownNames].join(', ')}]`,
          );
        }
      }
      const envDiff = diffRegistry({
        snap: this.envSnapshot, manager: this.envResources, index: this.envIndex,
        instanceId: this.id, holds: this.state.envHolds,
      });
      await applyRegistryWrites(tx, {
        workCenterId: this.workCenterId, instanceId: this.id,
        counters: envDiff.counters, deleteWaiterIds: envDiff.deleteWaiterIds,
        grantWaiters: envDiff.grantWaiters, insertWaiters: envDiff.insertWaiters,
        holders: envDiff.holders,
      });
      for (const target of envDiff.foreignGrantInstanceIds) {
        await tx.execute(sql`SELECT pg_notify(${NOTIFY_GRANT_CHANNEL}, ${target})`);
      }
      await applyForeignReleases(tx, this);
    }
    const serializedState: EngineState = {
      ...this.state,
      resources: this.resources ? this.resources.toJSON() : null,
    };
    await tx.update(workflowInstance).set({
      engineState: serializedState,
      propertyStore: this.props.toJSON(),
      updatedAt: this.now(),
    }).where(eq(workflowInstance.id, this.id));
  }
}

/**
 * Construct the root WorkflowContext for `row` and load its work center's shared value-
 * property tier before any step logic runs (Phase 2b, spec §5.6). This is the ONE seam every
 * root construction site goes through — every place a WorkflowContext is built from a real or
 * synthesized workflow_instance row calls this, not the constructor directly, INCLUDING the
 * settle-only recovery paths (e.g. loop.ts's recoverFailedStart, settleFailedInstance,
 * control.ts's recoverFailedControlPass) — their terminal history write goes through
 * settleTerminal's toHistoryJSON() exactly like every other path, so it must see the same
 * merged (local + shared) view too. The only construction path that deliberately does NOT go
 * through here is contextForNode's view branch (above): a view shares its root's
 * `sharedProps` by reference instead of loading its own, exactly like `resources`.
 *
 * Attaches nothing (and leaves `context.sharedProps` null) when the work center has no shared
 * rows — an empty work center costs exactly one cheap SELECT, never a behavior change.
 *
 * Phase 2a: this same "construct, then load" shape also hydrates the environment-resource tier
 * (`envResources`/`envSnapshot`/`envIndex`/`envKnownNames`, `state.envHolds`) under the
 * registry's row locks — but ONLY for the names the frozen recipe's own commands reference
 * (`envResourceNames`, below). A recipe that references no environment resources never calls
 * `lockRegistry` at all, so it takes no extra locks and pays nothing beyond the one spec walk.
 */
export async function openContext(tx: Db, row: ContextRow, deps: EngineDeps): Promise<WorkflowContext> {
  const context = new WorkflowContext(row, deps.now);
  const sharedRows = await loadSharedValueProperties(tx, context.workCenterId);
  context.sharedProps = sharedRows.length > 0 ? SharedPropertyTier.fromRows(sharedRows) : null;
  context.props.attachShared(context.sharedProps);
  // Task 6 (spec §5.7): union in any PRE-2a per-instance environment-resource holds this
  // instance's engine_state.resources still carries (see legacyEnvResourceEntries below) — a
  // legacy hold can name a resource the CURRENT recipe's commands no longer reference (the
  // recipe changed, or the hold is orphaned), and folding it in without widening the lock set
  // would write a wc_resource row nobody locked. Unioned into this SAME lockRegistry call rather
  // than a second one, which could acquire a name lexically before one already held and break
  // the name-ascending order this whole phase's deadlock story rests on. This also covers a
  // recipe that references NO environment resources at all but whose instance still carries a
  // legacy hold — without the union, envNames would be empty and hydration (and the fold) would
  // never run.
  const legacyNames = legacyEnvResourceEntries(context.resources).map(([key]) => legacyResourceName(key));
  const envNames = [...new Set([...envResourceNames(context.spec, context.envScope), ...legacyNames])].sort();
  if (envNames.length > 0) {
    const snap = await lockRegistry(tx, context.workCenterId, envNames);
    context.envSnapshot = snap;
    context.envIndex = indexWaiters(snap);
    context.envKnownNames = new Set(snap.resources.map((r) => r.name));
    context.envResources = InMemoryResourceManager.fromJSON(snapshotToSerialized(snap, context.workCenterId));
    const persisted = context.state.envHolds;
    const live = await readHolders(tx, context.id);
    // Ruling P3b: a hold this instance wrote at its last persist() that the ledger no longer
    // carries was removed OUT OF BAND — an operator's release-holder / reset, or (2026-11-10)
    // another workflow's Release taking the hold over (consumeForeignHolders).
    // Remember it durably so this instance's own later Release of it touches nothing
    // (releaseResourceCompletionCommands): the freed unit may already back another hold.
    //
    // Final-review I2: this is a MULTISET diff on (name, step, heldName, AMOUNT), not a
    // `live.some(...)` membership test. One step may legitimately hold the same resource twice
    // (two Acquire commands — see attemptResourceCommands, which pushes one entry per command),
    // which is two identical entries and two identical rows; a membership test lets the ONE
    // surviving row satisfy BOTH persisted entries, records no marker at all, and the step's
    // second Release then falls through to the unconditional outcome — a double-free, permanently
    // below the ledger. Each live row may therefore back exactly ONE persisted entry, and
    // whatever is left over is what an operator took away. `amount` joins the comparison for the
    // same reason (two 'Acquire Pool Amount' commands of 2 and 3 on one step must not match each
    // other's row, or the marker carries the wrong amount); it is safe to compare because rows
    // and entries are written from the one array in the one persist(), and a partial release
    // decrements the entry and the row together.
    //
    // 2026-11-10: a row can also SHRINK out of band — another workflow's Release taking over
    // part of a count-pool hold (consumeForeignHolders decrements the oldest row). A persisted
    // entry left unmatched by the exact pass is therefore paired, second, with a leftover live
    // row of the same (name, step, heldName) carrying a SMALLER amount: the marker is the
    // difference only, and the row stays in the ledger at its new amount.
    const same = (a: EnvHold, b: EnvHold) =>
      a.name === b.name && a.stepOid === b.stepOid && a.heldName === b.heldName && a.amount === b.amount;
    const unmatched = [...live];
    const leftover: EnvHold[] = [];
    for (const p of persisted) {
      const i = unmatched.findIndex((l) => same(l, p));
      if (i >= 0) unmatched.splice(i, 1); else leftover.push(p);
    }
    const newlyRevoked: EnvHold[] = [];
    for (const p of leftover) {
      const i = unmatched.findIndex((l) =>
        l.name === p.name && l.stepOid === p.stepOid && l.heldName === p.heldName && l.amount < p.amount);
      if (i >= 0) {
        newlyRevoked.push({ ...p, amount: p.amount - unmatched[i].amount });
        unmatched.splice(i, 1);
      } else {
        newlyRevoked.push(p);
      }
    }
    // Residual R1: appended WITHOUT deduping against the markers this state already carries.
    // The marker list is a MULTISET for the same reason the diff above is — each revoked ROW is
    // one marker, and two identical markers mean two revoked holds, exactly as two identical
    // entries mean two holds. A dedupe cannot protect anything here: a hydration that observed a
    // removal but never committed persisted NEITHER the marker NOR `envHolds = live`, so the
    // next hydration re-reads the SAME persisted ledger and records the marker into a freshly
    // loaded (marker-free) state — there is nothing to duplicate. What a dedupe DOES do is drop
    // the second of two SEQUENTIAL revocations: a step holding `Pool` twice whose first row is
    // revoked (and whose marker any intervening transition then persists) diffs `[{A}]` vs `[]`
    // when the second row goes, and matching that against the already-known `[{A}]` swallows it
    // — the step's second Release then falls through to the unconditional outcome and frees a
    // unit somebody else now holds. That is I2's permanent double-free, one revocation later.
    context.state.envHoldsRevoked.push(...newlyRevoked);
    context.state.envHolds = live;
    // Fold any legacy holds found above into the tier just hydrated above — purely in-memory,
    // see foldOutLegacyEnvResources's own doc comment for why it writes nothing itself.
    foldOutLegacyEnvResources(context, snap);
  }
  context.markHydrated(); // M1 fix — must come after every load above, not before
  return context;
}

/** Every environment-scoped resource name this frozen recipe references, root and children.
 *  This is the LOCK SET: a transition can only reach resources its own commands name, and it
 *  can only grant on resources it releases, which is a subset of the same set. Narrowing to
 *  the recipe is what keeps one work center's transitions from serializing behind each other.
 *
 *  `scope` defaults to a fresh `collectEnvironmentScope(spec)` so this stays a self-contained
 *  pure function for callers that only have a spec (e.g. its own unit tests) — but `openContext`
 *  passes the context's own `envScope` explicitly, so the SAME `isEnvironmentCommand` call that
 *  computed this lock set is the one Task 4's routing reuses via `context.root.envScope`,
 *  rather than each side risking its own, possibly-drifted, copy.
 *
 *  Reads only STEP-LEVEL `resource_command_specifications` deliberately: a spec's own top-level
 *  `resource_command_specifications` field exists in the type (MasterWorkflowSpecification) but
 *  no runtime code anywhere in this engine ever reads it — only a step's own array is ever
 *  attempted or released — so walking it here would lock names nothing can ever acquire. */
export function envResourceNames(
  spec: MasterWorkflowSpecification,
  scope: EnvironmentScope = collectEnvironmentScope(spec),
): string[] {
  const names = new Set<string>();
  const walk = (s: MasterWorkflowSpecification): void => {
    for (const step of s.steps) {
      for (const cmd of step.resource_command_specifications ?? []) {
        if (isEnvironmentCommand(cmd, s, scope)) names.add(cmd.resource_name);
      }
    }
    for (const child of s.children ?? []) walk(child);
  };
  walk(spec);
  return [...names].sort();
}

// ── Task 6 (spec §5.7): fold PRE-2a per-instance environment resources into the registry ──
//
// An instance already running when this phase deploys carries its environment resources
// inside its OWN engine_state.resources (this file's LOCAL `InMemoryResourceManager`, the one
// serialized via `state.resources`/`context.resources`) — the shape `registerResource` produced
// before this phase existed, keyed `${resource_source_oid}:${name}`. Its first hydrate through
// `openContext` (above) must fold those into the SHARED `context.envResources` tier exactly
// once. The user drains the work centers before this deploys (spec §10 step 0), so this path is
// expected to be dead in practice; it is built and tested anyway for any instance that slips
// through.

/** Every entry in `resources`'s internal map whose serialized `scope === 'environment'` — a
 *  legacy environment-resource hold, pre-dating this phase. Reaches into the manager's private
 *  state the same way env-resource-bridge.ts's `queuedTokens`/`countersFor` already do (there is
 *  no public API for "list every entry of a given scope", and adding one to a verbatim
 *  transcription of the reference resource-manager for a single, dying migration path is not
 *  worth it) — kept loosely typed for the same reason those two functions are: the runtime
 *  `ResourceState` union isn't exported from resources.ts. */
function legacyEnvResourceEntries(resources: InMemoryResourceManager | null): [string, any][] {
  if (!resources) return [];
  const raw = (resources as unknown as { resources: Map<string, any> }).resources;
  return [...raw.entries()].filter(([, state]) => state.scope === 'environment');
}

/** The legacy key is `${envOid}:${name}` while the registry is keyed by the BARE name — take
 *  the substring after the FIRST colon, safe even for a resource name containing a colon since
 *  the owner half is always an oid (getSnapshot's own display-name split has this same shape and
 *  truncates such names — don't copy that idiom here). */
function legacyResourceName(key: string): string {
  const at = key.indexOf(':');
  return at >= 0 ? key.slice(at + 1) : key;
}

/**
 * Fold this context's legacy per-instance environment-resource holds (see above) into the
 * just-hydrated `context.envResources` — PURELY IN-MEMORY. Adds each legacy entry's counters to
 * the shared tier (a named pool: removes its held names from `available`) and converts its
 * queue entries into env-tier waiter tokens for THIS instance (`envToken(context.id, stepOid)`),
 * then deletes the folded entry out of `context.resources`. Writes nothing to the database
 * itself.
 *
 * That is deliberate, not an oversight (a controller ruling that supersedes an earlier one which
 * had this write the registry directly): not every `openContext` call site's caller goes on to
 * call `context.persist(tx)` on every path (e.g. loop.ts's `recoverFailedStart` never does, by
 * design — it is the backstop for a `persist()` that already threw). A direct write here would
 * commit the registry side of the fold while `engine_state` kept the legacy entry on such a
 * path, and the NEXT hydrate would fold — and double-count — the same units again, with the
 * idempotence guard below unable to catch it because it reads the very `engine_state` that was
 * never written.
 *
 * Purely in-memory has no such failure mode: `persist()` (Task 5) already diffs
 * `context.envResources`'s LIVE state against the loaded snapshot to compute registry counters
 * (`diffRegistry`'s `countersFor`), and already serializes `context.resources`'s post-fold
 * contents (the legacy entries gone) into `engine_state.resources` (this manager's own
 * `toJSON()`) — so the SAME atomic write that already exists carries both halves of this fold.
 * On a call site that never persists, NOTHING is written on either side, so the two stay
 * consistent and the fold simply retries on this instance's next hydrate that does persist.
 *
 * Idempotent by construction: once an entry is folded and deleted here, there is nothing left
 * with `scope === 'environment'` to find on the next call — no version flag needed (`scope`
 * survives a full serialize/deserialize round trip, since resources.ts's `stateToJSON` spreads
 * the whole state).
 *
 * A folded hold is deliberately UNTRACKED: nothing is appended to `context.state.envHolds`
 * (which is the ONLY source `persist()` reads to populate `wc_resource_holder` rows), because
 * per-holder information for these units never existed on this side either — the pre-2a manager
 * this fold reads from has no per-holder tracking (resources.ts's own MODEL note). `in_use`
 * rises in the registry with zero matching holder rows; the untracked-release operator verb
 * exists precisely to clear a unit in this state.
 *
 * Returns whether anything was folded.
 */
export function foldOutLegacyEnvResources(context: WorkflowContext, snap: WcRegistrySnapshot): boolean {
  const entries = legacyEnvResourceEntries(context.resources);
  if (entries.length === 0 || !context.envResources) return false;

  const knownNames = new Set(snap.resources.map((r) => r.name));
  const targetRaw = (context.envResources as unknown as { resources: Map<string, any> }).resources;
  const legacyRaw = (context.resources as unknown as { resources: Map<string, any> }).resources;
  // Review fix (Important-adjacent minor): the fold migrates the `resources` map only — never
  // `pendingGrants`/`pendingNamedAssignments`/`syncMatchedData`, which are manager-level (not
  // per-resource) collections that can still hold entries tied to a key this loop is about to
  // delete. Read once, outside the loop, purely to WARN below — never migrated (a bigger change
  // on a path the drain should make dead), so a parked legacy grant a step later consumes would
  // resume through the WORKFLOW tier, not the environment tier, and silently fail to reach its
  // target property with no envHolds entry ever recorded.
  const legacyGrants = (context.resources as unknown as { pendingGrants: { stepOid: string; resourceKey: string }[] }).pendingGrants;
  const legacyNamedAssignments = (context.resources as unknown as { pendingNamedAssignments: Map<string, string> }).pendingNamedAssignments;
  const legacySyncMatchedData = (context.resources as unknown as { syncMatchedData: Map<string, string> }).syncMatchedData;

  let folded = false;
  for (const [key, state] of entries) {
    const name = legacyResourceName(key);
    if (!knownNames.has(name)) {
      console.warn(
        `[mission-engine] instance ${context.id}: legacy environment-resource hold "${key}" has ` +
        `no matching wc_resource row for "${name}" (work center ${context.workCenterId}) — leaving ` +
        'it unfolded; it will re-widen the lock set and re-emit this warning on every future hydrate ' +
        'until either the environment spec is re-loaded (creating the missing row) or this stale ' +
        "entry is removed from the instance's engine_state.resources directly",
      );
      continue;
    }
    const target = targetRaw.get(name);
    if (!target || target.type !== state.type) {
      console.warn(
        `[mission-engine] instance ${context.id}: legacy environment-resource hold "${key}" is a ` +
        `"${state.type}" but the registry's "${name}" is` +
        `${target ? ` a "${target.type}"` : ' unmodeled'} — leaving it unfolded rather than ` +
        'guessing at a conversion',
      );
      continue;
    }

    switch (state.type) {
      case 'binary exclusive use':
        target.inUse += state.inUse;
        // Review fix (minor): no CHECK constrains this column, and the more likely cause than a
        // single instance holding two owner oids for the same bare name is TWO undrained
        // instances each legacy-holding the same environment resource across separate hydrates —
        // this fold clamps to the type's own 0|1 domain but must not let a silent value pass
        // uncommented. Self-heals on the NEXT hydrate regardless (snapshotToSerialized clamps
        // `inUse > 0 ? 1 : 0`), which is exactly what would otherwise let this go unnoticed.
        if (target.inUse > 1) {
          console.warn(
            `[mission-engine] instance ${context.id}: legacy hold "${key}" folded a binary-exclusive ` +
            `resource's in-use count to ${target.inUse} — clamped to 1. Two undrained instances ` +
            `apparently held "${name}" independently before this phase; one unit is now UNTRACKED ` +
            'and unaccounted for (not double-granted).',
          );
          target.inUse = 1;
        }
        for (const stepOid of state.queue) target.queue.push(envToken(context.id, stepOid));
        break;
      case 'binary shared use with pool limits':
        target.inUse += state.inUse;
        for (const stepOid of state.queue) target.queue.push(envToken(context.id, stepOid));
        break;
      case 'countable use with pool limits':
        target.inUse += state.inUse;
        for (const q of state.queue) {
          target.queue.push({ stepOid: envToken(context.id, q.stepOid), amount: q.amount });
        }
        break;
      case 'named pool': {
        const held: string[] = [...state.originalNames].filter((n: string) => !state.available.includes(n));
        for (const n of held) {
          const idx = target.available.indexOf(n);
          if (idx >= 0) {
            target.available.splice(idx, 1);
          } else if (!target.originalNames.has(n)) {
            // Review fix (minor): split from the "held elsewhere" case below — an operator needs
            // to know these are two different problems with two different remedies.
            console.warn(
              `[mission-engine] instance ${context.id}: legacy hold on named pool "${name}" claims ` +
              `name "${n}", which is no longer part of the pool's roster (it shrank since this hold ` +
              'was recorded) — leaving it unremoved; the pool now understates its true in-use count ' +
              'by one',
            );
          } else {
            console.warn(
              `[mission-engine] instance ${context.id}: legacy hold on named pool "${name}" claims ` +
              `name "${n}", which the registry already shows unavailable — held by ANOTHER instance's ` +
              "own hold — leaving it unremoved; both holds are now double-counted against the same " +
              'name',
            );
          }
        }
        for (const stepOid of state.queue) target.queue.push(envToken(context.id, stepOid));
        break;
      }
      case 'sync':
        for (const s of state.sendQueue) target.sendQueue.push({ stepOid: envToken(context.id, s.stepOid), data: s.data });
        for (const stepOid of state.receiveQueue) target.receiveQueue.push(envToken(context.id, stepOid));
        for (const stepOid of state.pendingSync) target.pendingSync.push(envToken(context.id, stepOid));
        break;
    }

    const grantsForKey = legacyGrants.filter((g) => g.resourceKey === key);
    if (grantsForKey.length > 0) {
      const namedHits = grantsForKey.filter((g) => legacyNamedAssignments.has(g.stepOid)).length;
      const syncHits = grantsForKey.filter((g) => legacySyncMatchedData.has(g.stepOid)).length;
      console.warn(
        `[mission-engine] instance ${context.id}: legacy environment-resource hold "${key}" has ` +
        `${grantsForKey.length} pending grant(s) for step(s) [${grantsForKey.map((g) => g.stepOid).join(', ')}] ` +
        'that this fold does NOT migrate' +
        (namedHits > 0 || syncHits > 0
          ? ` (including ${namedHits} named-pool assignment(s) and ${syncHits} sync payload(s))`
          : '') +
        ' — if consumed later it will resume through the WORKFLOW tier, not the environment tier, and ' +
        "silently fail to reach its target property with no envHolds entry ever recorded",
      );
    }

    legacyRaw.delete(key);
    folded = true;
  }
  return folded;
}

/**
 * 2026-11-10 (cross-workflow release): drain `root.foreignReleases` — environment Releases this
 * instance ran on a resource it held none of (transition.ts outcome 5), whose counter change the
 * manager already made — and take each one's units over from OTHER instances' holder rows
 * (`consumeForeignHolders`), so the ledger keeps matching the counter. Called by persist() and by
 * the terminal sweep, after their own `applyRegistryWrites`, under this hydration's registry
 * locks; drained, so a second write-back in the same transaction never applies one twice. Only
 * names this hydration locked can appear (resolveResourceTier throws for any other), which keeps
 * the name-ascending lock order intact.
 *
 * Wakes each former holder: a still-running one hydrates, finds its hold gone (openContext's
 * revoked-hold diff records a marker) and skips its own later Release instead of freeing the unit
 * a second time. No trace row is written on the former holder — that would take a FOR KEY SHARE
 * on a second instance row inside this transaction (operator-verbs.ts, Ruling P9).
 */
async function applyForeignReleases(tx: Db, root: WorkflowContext): Promise<void> {
  if (root.foreignReleases.length === 0) return;
  const pending = root.foreignReleases.splice(0);
  const wake = new Set<string>();
  for (const r of pending) {
    const row = root.envSnapshot?.resources.find((x) => x.name === r.name);
    if (!row || !root.envKnownNames.has(r.name)) {
      console.warn(
        `[mission-engine] instance ${root.id}: a Release of "${r.name}" by a workflow that held none of it ` +
        `could not be matched to a locked registry row (work center ${root.workCenterId}) — the counter ` +
        'changed, but no holder row was taken over',
      );
      continue;
    }
    const affected = await consumeForeignHolders(tx, root.workCenterId, root.id, {
      name: r.name, resourceType: row.resourceType, amount: r.amount, heldName: r.heldName,
    });
    for (const id of affected) wake.add(id);
  }
  for (const id of wake) await tx.execute(sql`SELECT pg_notify(${NOTIFY_GRANT_CHANNEL}, ${id})`);
}

/**
 * The environment tier at a terminal settle. User ruling 2026-11-10, replacing spec §5.5 /
 * decision U4's auto-release: an Environment HOLD survives the end of the workflow that took it.
 * Its `wc_resource_holder` rows stay, `in_use` / available names are not changed by the settle,
 * and `state.envHolds` stays as the last ledger the instance wrote. Another workflow's Release
 * (transition.ts outcome 5 → `applyForeignReleases`) or an operator verb releases it later. Same
 * rule on every terminal path (completed, errored, stopped, aborted, give-up, escalation), and
 * for a U6 inherited hold an Operator cleanup did not release.
 *
 * What a terminal instance still gives up is whatever was only ever a CLAIM, never a hold:
 *  - its QUEUE entries — every `wc_resource_waiter` row (`releaseInstanceWaiters`) and the live
 *    manager's own queued tokens. Nothing pumps a terminal instance (claimInstanceForWork filters
 *    on `status = 'running'`), so a surviving entry would later be granted to a dead step and
 *    wedge the resource for the whole work center (whole-branch review C1);
 *  - grants it was handed but never consumed — a step that never ran acquired nothing. Read from
 *    the LIVE manager (`captureEnvReservations` → `flushGranted`), never from the hydration
 *    snapshot alone: a grant consumed earlier in this same transaction is already in `envHolds`
 *    and must not be given back (review round 3). Each gets one `release()`, the only way to both
 *    decrement the counter and cascade the FIFO grant onward;
 *  - and the FIFO grant pass is re-run on every other name a waiter row was removed from: a
 *    countable queue head that was too large can strand a smaller request behind it, with nobody
 *    left who owes a release on that name (review C1/I1).
 *
 * Ordering, all load-bearing:
 *  - Called from settleTerminal AFTER its guarded status UPDATE (first-terminal-wins), so a losing
 *    racer never touches the registry.
 *  - `ownEnvTokens` — derived from the live MANAGER, not the spec tree, which cannot see a
 *    torn-down child's steps (review C2) — is captured, then cancelled, BEFORE any reservation is
 *    released, so `release()`'s grant pass can only hand capacity to a genuinely FOREIGN waiter,
 *    never back to this dead instance (review Critical 2).
 *  - It mutates the LIVE `context.envResources` and writes the registry itself, in this same
 *    transaction: some terminal call sites never persist() afterwards (loop.ts's
 *    recoverFailedStart), and on the settle-before-persist paths (settleIfComplete) a later
 *    persist() re-diffs the identical manager — a harmless redundant write. The holder rows are
 *    written from `state.envHolds` here for the same reason: an Acquire granted in this very
 *    transaction has no row yet, and must not lose it because no persist() follows.
 *
 * A reservation on a resource the manager cannot model (unknown or in-place-retyped type) is
 * logged and skipped rather than thrown, so a terminal settle never crashes over it (I2).
 *
 * `envHoldsRevoked` IS cleared — in memory, and through a narrow `jsonb_set` on engine_state for
 * the persist-before-settle paths (a second writer of that column, inside settleTerminal's own
 * exception to "persist() is the only durability path"): a marker only guards this instance's own
 * later Release, and a terminal instance runs none.
 */
async function settleEnvTierAtTerminal(tx: Db, context: WorkflowContext): Promise<void> {
  const manager = context.envResources;
  const snap = context.envSnapshot;
  const index = context.envIndex;
  // Zero cost for a recipe that never touches the registry: it never hydrated the tier, and
  // `applyRegistryWrites` — the only writer of waiter/holder rows — only ever runs when it did.
  if (!manager || !snap || !index) return;

  const ownTokens = ownEnvTokens(context);
  const reservations = captureEnvReservations(context, ownTokens); // must precede the cancel sweep
  const touched = await releaseInstanceWaiters(tx, context.id);
  manager.cancelQueuedWaiters(ownTokens);

  const released = new Set<string>();
  for (const r of reservations) {
    if (!manager.hasResource(r.name)) {
      console.warn(
        `[mission-engine] instance ${context.id}: cannot give back an unconsumed grant on "${r.name}" ` +
        `(work center ${context.workCenterId}) — the name was locked but this hydration never ` +
        'modelled it (an unknown or in-place-retyped resource_type); skipping it rather than ' +
        'crashing the terminal settle',
      );
      continue;
    }
    manager.release(r.name, r.amount, r.heldName ?? undefined);
    released.add(r.name);
  }
  for (const name of touched) {
    // A name already released above ran its grant pass to exhaustion inside release().
    if (released.has(name)) continue;
    if (!context.envKnownNames.has(name)) {
      // A waiter row can only exist for a locked name (diffRegistry inserts them only for
      // `snap.resources`, and the recipe is frozen) — believed unreachable. Locking it now would
      // break the name-ascending lock order.
      console.warn(
        `[mission-engine] instance ${context.id}: removed a waiter row for "${name}" ` +
        `(work center ${context.workCenterId}), which this hydration never locked — no FIFO grant ` +
        'pass could be run for it here; a queued waiter on that resource may have to wait for the ' +
        'next release',
      );
      continue;
    }
    if (manager.hasResource(name)) manager.runGrantPass(name);
  }

  // Holds are written back unchanged (the holder rows stay); everything else follows the manager.
  const d = diffRegistry({ snap, manager, index, instanceId: context.id, holds: context.state.envHolds });
  await applyRegistryWrites(tx, {
    workCenterId: context.workCenterId, instanceId: context.id,
    counters: d.counters, deleteWaiterIds: d.deleteWaiterIds,
    grantWaiters: d.grantWaiters, insertWaiters: d.insertWaiters, holders: d.holders,
  });
  for (const target of d.foreignGrantInstanceIds) {
    await tx.execute(sql`SELECT pg_notify(${NOTIFY_GRANT_CHANNEL}, ${target})`);
  }
  await applyForeignReleases(tx, context);

  if (context.state.envHoldsRevoked.length > 0) {
    context.state.envHoldsRevoked = [];
    await tx.update(workflowInstance).set({
      engineState: sql`jsonb_set(${workflowInstance.engineState}, '{envHoldsRevoked}', '[]'::jsonb)`,
    }).where(eq(workflowInstance.id, context.id));
  }
}

/** Spec 2026-11-06 (Operator cleanup): every action still live on one of this instance's step
 *  rows goes into operatorCleanup.pendingAborts (ABORT + DELETE after commit, by the loop), and
 *  that list is written to engine_state now, in the caller's transaction — whether or not the
 *  caller persists afterwards. Used by settles that end a cleanup without endOperatorCleanup's
 *  teardown; a caller that marks the rows terminal first queues them itself before doing so. */
export async function queueLiveCleanupActions(tx: Db, context: WorkflowContext): Promise<void> {
  const oc = context.state.operatorCleanup;
  if (!oc) return;
  const rows = await tx.select({
    id: stepInstance.id, serverUri: stepInstance.actionServerUri, actionInstanceId: stepInstance.actionInstanceId,
  }).from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, context.id),
    notInArray(stepInstance.state, ['COMPLETED', 'ERRORED', 'ABORTED', 'CANCELLED']),
    isNotNull(stepInstance.actionInstanceId), isNotNull(stepInstance.actionServerUri),
  ));
  const queued = queueCleanupAborts(context, rows.map(r => ({
    stepRowId: r.id, serverUri: r.serverUri!, actionInstanceId: r.actionInstanceId!,
  })));
  if (!queued) return;
  await tx.update(workflowInstance).set({
    // The whole in-memory operatorCleanup (it holds the new entries): also right when the caller
    // has not persisted the cleanup phase yet.
    engineState: sql`jsonb_set(coalesce(${workflowInstance.engineState}, '{}'::jsonb), '{operatorCleanup}', ${JSON.stringify(oc)}::jsonb)`,
  }).where(eq(workflowInstance.id, context.id));
}

/** Stamp a terminal status + matching final_state + completed_at in one UPDATE, AND (Task 17,
 *  spec §9) write the matching `runtime_history` row in the SAME transaction — every terminal
 *  settle in this engine (instance.ts's invalid-spec-at-start path, transition.ts's completion/
 *  error paths, control.ts's abort/stop/give-up paths, loop.ts's C2/I4 give-up paths) now goes
 *  through this ONE function, so a terminal instance can never end up without a matching history
 *  row. Lives here (not instance.ts/transition.ts) so neither imports the other.
 *
 *  First-terminal-wins (C1 fix): scoped with `and status = from` (default `'running'`, every
 *  pre-Task-16 call site's implicit status) so a settle can only ever fire once per instance —
 *  the guarded UPDATE's own `.returning()` doubles as the idempotency check: a second call whose
 *  guard no longer matches (the instance already left `from`) updates zero rows and returns
 *  immediately, writing no history at all (writeRuntimeHistory's own unique-index
 *  onConflictDoNothing is a second, independent backstop, never actually needed in practice).
 *  Without the status guard, a SCRIPT failure discovered mid-pump (failStep settles 'errored')
 *  could be silently overwritten by a LATER branch of the same cascade reaching END and computing
 *  isWorkflowComplete = true — the pump loop doesn't stop just because the instance died;
 *  processReadyStep's own status re-check (transition.ts) is the OTHER half of this fix, stopping
 *  the pump from doing that further work at all, but this guard is the backstop even if some
 *  future call site forgets that check.
 *
 *  Task 16: control.ts's stopping/aborting passes settle from `'stopping'`/`'aborting'` — an
 *  optional trailing `from` parameter (defaulting to `'running'`) keeps every existing call
 *  site's positional arguments untouched.
 *
 *  `context` MUST be the true root (every call site already guarantees this — see each caller's
 *  own doc comment) — its in-memory `.props`/`.state.stepSnapshots` are used DIRECTLY for the
 *  history snapshot's `properties`/`stepParams` rather than re-reading `property_store`/
 *  `engine_state` off the row, because call-site ordering between `context.persist(tx)` and
 *  `settleTerminal` is NOT consistent (some settle before persisting, e.g. settleIfComplete's
 *  documented "callers persist after" contract; others persist first) — reading the in-memory
 *  values sidesteps that ordering entirely, since both are already current the instant this
 *  runs, persisted or not (same open transaction, nothing else can observe the difference).
 *  `trace` is read fresh from `trace_entry` regardless (every row already committed via
 *  `recordTrace`'s own INSERT, independent of persist() timing) and reassembled into the
 *  reference merge order via trace-assembly.ts's `assembleReferenceTrace` — shared, not
 *  duplicated, per task-17-brief.md's binding ruling. */
export async function settleTerminal(
  tx: Db,
  context: WorkflowContext,
  status: TerminalStatus,
  finalState: TerminalStatus,
  now: () => Date,
  from: string = 'running',
  /** Spec 2026-11-06: why an Operator cleanup ended, when this settle ends one through the
   *  redirect below ("step failed: <msg>", "engine error: <msg>", …). */
  cleanupEndReason: string = 'step failed',
): Promise<void> {
  context.assertHydrated(); // M1 fix — see WorkflowContext.assertHydrated's own doc comment
  // Spec 2026-11-06 U3 / C2 catch-all: while an Operator cleanup network runs, any settle the
  // network's steps reach on a path not hooked explicitly (errorReturnStep, settleFailedInstance,
  // …) ends the cleanup with the command's final status instead — never 'errored' / 'aborted' /
  // 'completed' — including a settle from the skip's re-halt (HALT_STATUS[kind] while the phase
  // is still 'cleanup'). operatorCleanup is null for an instance with no Operator row, so this never
  // fires there.
  //
  // A settle from 'running' (the default) can never match while a cleanup runs — the instance is
  // in its cleanup status — so it is always moved there, even when the requested status already
  // is the final one (an Abort cleanup asked to settle 'aborted'): otherwise the UPDATE would
  // match nothing and leave the instance stuck after its rows were torn down. endOperatorCleanup
  // and the halt passes always pass an explicit `from`, so they are unaffected.
  const oc = context.state.operatorCleanup;
  let cleanupEnded = false;
  if (oc?.phase === 'cleanup') {
    if (status !== FINAL_STATUS[oc.kind]
      && (from === 'running' || from === CLEANUP_STATUS[oc.kind] || from === HALT_STATUS[oc.kind])) {
      status = finalState = FINAL_STATUS[oc.kind];
      // The skip's re-halt (HALT_STATUS, U3 still binding) settles from where it is; otherwise the
      // instance is in its cleanup status.
      if (from !== HALT_STATUS[oc.kind]) from = CLEANUP_STATUS[oc.kind];
      cleanupEnded = true;
    } else if (from === 'running') {
      from = CLEANUP_STATUS[oc.kind];
      cleanupEnded = true;
    }
  }
  const instanceId = context.id;
  const at = now();
  const [updated] = await tx.update(workflowInstance).set({
    status, finalState, completedAt: at, updatedAt: at,
  }).where(and(eq(workflowInstance.id, instanceId), eq(workflowInstance.status, from)))
    .returning({
      workCenterId: workflowInstance.workCenterId,
      runtimeNumber: workflowInstance.runtimeNumber,
      runtimeLabel: workflowInstance.runtimeLabel,
      masterName: workflowInstance.masterName,
      masterOid: workflowInstance.masterOid,
      masterVersion: workflowInstance.masterVersion,
      masterState: workflowInstance.masterState,
      startingParams: workflowInstance.startingParams,
      startedAt: workflowInstance.startedAt,
      createdByInstanceId: workflowInstance.createdByInstanceId,
      createdByLabel: workflowInstance.createdByLabel,
      startRequestedBy: workflowInstance.startRequestedBy,
      createdBy: workflowInstance.createdBy,
      scheduleLabel: workflowInstance.scheduleLabel,
    });
  if (!updated) return; // already settled by an earlier call — first-terminal-wins, no history write

  if (cleanupEnded) {
    await context.recordTrace(tx, null, 'OPERATOR', undefined,
      `${oc!.kind === 'stop' ? 'Operator Stop' : 'Operator Abort'} cleanup ended: ${cleanupEndReason}`);
    // Live cleanup actions on other branches are not torn down here (only endOperatorCleanup
    // does that): ABORT + DELETE them after commit through the durable pendingAborts queue,
    // written in this same transaction.
    await queueLiveCleanupActions(tx, context);
  }

  // The environment tier: drop this instance's queue entries and unconsumed grants (its HOLDS
  // stay — 2026-11-10). Deliberately AFTER the guard above, not merely after the UPDATE — running
  // before it would let a LOSING racer (an already-settled instance) rewrite the registry.
  await settleEnvTierAtTerminal(tx, context);

  // Spec 2026-10-27 §6: a run that ends while other steps are still active (an uncaught failure
  // on one branch, a branch parked elsewhere) must not silently omit them from the step record.
  // Record only — their rows keep their states. Runs after the guard, so a repeat call never
  // double-records; an abort's rows were already recorded 'aborted' and are no longer active.
  await recordFailedActiveRuns(tx, context, null, 'cancelled');

  // Who started the run, frozen into history: the requester, else the creator. A deleted user
  // (the FK is set null) or a missing login leaves both null.
  const starterId = updated.startRequestedBy ?? updated.createdBy ?? null;
  let starterLogin: string | null = null;
  if (starterId) {
    const [u] = await tx.select({ loginName: appUser.loginName }).from(appUser).where(eq(appUser.id, starterId));
    starterLogin = u?.loginName ?? null;
  }

  const [wc] = await tx.select({ name: workCenter.name }).from(workCenter).where(eq(workCenter.id, updated.workCenterId));

  const rawRows = await tx.select().from(traceEntry)
    .where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));
  const trace = assembleReferenceTrace(rawRows.map((r): RawTraceRow => ({
    id: r.id, stepOid: r.stepOid, state: r.state, orderIndex: r.orderIndex ?? 0,
    error: r.error, afterAction: r.afterAction, at: r.at,
  })), context.spec);
  const properties = context.props.toHistoryJSON();

  await writeRuntimeHistory(tx, {
    workflowInstanceId: instanceId,
    workCenterId: updated.workCenterId, workCenterName: wc?.name ?? '',
    runtimeNumber: updated.runtimeNumber, runtimeLabel: updated.runtimeLabel,
    masterName: updated.masterName, masterOid: updated.masterOid,
    masterVersion: updated.masterVersion, masterState: updated.masterState,
    finalState,
    startedAt: updated.startedAt, finishedAt: at,
    startingParams: (updated.startingParams as Record<string, string> | null) ?? null,
    trace, properties, stepParams: context.state.stepSnapshots,
    stepNames: collectStepNames(context.spec),
    createdByInstanceId: updated.createdByInstanceId, createdByLabel: updated.createdByLabel,
    outputs: workflowOutputs(context.spec, properties),
    startedByUserId: starterLogin ? starterId : null, startedByLoginName: starterLogin,
    scheduleLabel: updated.scheduleLabel,
  });
}
