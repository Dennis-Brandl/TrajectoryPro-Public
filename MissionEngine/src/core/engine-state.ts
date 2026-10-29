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
import type { RoutingResult, CatchContext, PendingResourceState, FailureMode } from '../spec/types.js';
import type { SerializedResources } from './resources.js';
import type { EnvHold } from './env-resource-bridge.js';
import type { ScriptOutputs } from './step-handlers.js';

/** Task 16 (review fix, Critical 1 + controller Ruling A): a failure terminal that reached an
 *  action-backed step while dispatch was frozen (paused/pausing) — deferred rather than resolved
 *  immediately (resolving it now, via failStep, could activate a CATCH network = new dispatch
 *  during the freeze) and NOT discarded (the trigger step is left exactly as it was — still
 *  WAITING_ACTION/PAUSED — so isWorkflowComplete/settleIfComplete correctly refuse to treat the
 *  instance as done until this is actually resolved). Replayed through failStep exactly once,
 *  by the resuming control pass, with the SAME mode/message the original terminal carried. */
export interface DeferredFailure {
  stepOid: string;
  mode: FailureMode;
  message: string;
}

/**
 * The engine's per-instance working state, persisted to `workflow_instance.engine_state`
 * between transitions (one transition per transaction — see loop.ts). Everything here must
 * be plain-JSON-serializable (round-trips through jsonb as-is, no Map/Set/class instances).
 */
export interface EngineState {
  /** Trace order counter per owning spec oid — mirrors the reference engine's
   *  per-WorkflowEngine-instance traceOrder. This task only ever uses the root workflow's
   *  own oid as the key; child spec oids arrive with Task 12 (WORKFLOW PROXY). */
  orderCounters: Record<string, number>;
  /** Per-step routing decision recorded by SELECT 1 / YES_NO / button-press handlers
   *  (Task 10) so getRoutedConnections can filter outgoing edges. Unused in this task —
   *  v1 routing is unconditional (all outgoing edges). */
  routingContext: Record<string, RoutingResult>;
  /** WAIT ALL join tracking: step oid -> branches expected vs completed (Task 10). */
  waitAll: Record<string, { expected: string[]; completed: string[] }>;
  /** Currently-armed CATCH contexts triggered by a TRY dispatch (Task 11). */
  activeCatches: Record<string, CatchContext>;
  /** Serialized resource-manager state, or null if this instance declares no resources. */
  resources: SerializedResources | null;
  /** Per-step input/output parameter snapshots, for CM display and history (Task 17). */
  stepSnapshots: Record<string, { inputParameters: Record<string, string>; outputParameters?: Record<string, string> }>;
  /** Active child-workflow spec oid per parent WORKFLOW PROXY step oid (Task 12). Entries are
   *  removed the moment the child completes (completeChildWorkflow), the child is torn down
   *  (tearDownActiveChild), or a stopping drain cancels the proxy row once the child subtree
   *  has drained (runStopping) — presence here IS "this WORKFLOW PROXY step currently has a
   *  running child", mirroring the reference's activeChildEngines map. */
  childActive: Record<string, string>;
  /** Task 12: per-child-context PropertyStore home, keyed by child spec oid (unique across the
   *  whole tree — deepCopySpec gives every child, at every nesting depth, its own oid).
   *  `workflow_instance.property_store` only ever holds the ROOT spec's flat property map
   *  (WorkflowContext.props / persist()); a child gets its OWN store — seeded as a COPY of the
   *  parent's flat map at activation (reference engine.ts:700-701's `initialProperties`), then
   *  mutated independently thereafter (reference: each WorkflowEngine owns its own
   *  PropertyStore instance) — so it needs a separate serializable home here. A
   *  WorkflowContext "view" for a child spec (WorkflowContext.contextForNode) constructs a
   *  fresh PropertyStore from this entry on access and writes mutations back via
   *  `view.syncChildProps()`; nothing else reads or writes this map. Entries for a completed
   *  child are harmless, orphaned garbage (never read again) — not actively cleaned up. */
  childProperties: Record<string, Record<string, string>>;
  /** Steps blocked mid resource-activation (acquire-before-activate; reference
   *  engine.ts:1042-1053): queue state stays READY, but the step must NOT be re-attempted
   *  from scratch (that would double-acquire the already-queued command) — it can only
   *  resume from `remainingCommands` once a grant arrives. This task only records the gate
   *  (a blocked step is simply skipped by the READY picker); Task 10 adds the
   *  flushGranted()-driven resumption cascade. Not in the brief's literal Produces list —
   *  added because "a blockedOnResources marker in EngineState" needs a concrete field. */
  blockedOnResources: Record<string, PendingResourceState>;
  /** Task 16: step oids that reached COMPLETED while the instance was NOT 'running' (paused or
   *  pausing) — dispatch is frozen in those statuses, so monitor.ts's applyActionTerminal
   *  deliberately skips routing that step's own outgoing connections (successors only
   *  materialize while running — spec §7's Pause paragraph). The resuming control pass
   *  (core/control.ts) evaluates each listed oid's outgoing connections exactly once, draining
   *  this list to empty, before settling back to 'running'. Tracking the EXACT set of skipped
   *  steps — rather than inferring "already routed" from "does a successor row exist" — matters
   *  for a WAIT ALL target: a sibling branch's own arrival can already have created the join's
   *  row before THIS branch's (deferred) arrival is ever evaluated, so row-existence alone can't
   *  tell whether this step's own arrival was recorded against it. Never populated for a
   *  'stopping' drain — an orderly stop never resumes, so nothing here would ever be consumed. */
  deferredRouting: string[];
  /** Task 16 (review fix, Critical 1 + controller Ruling A): see DeferredFailure's own doc
   *  comment. Replayed (through failStep, in order) by the resuming control pass; never
   *  populated during a `stopping` drain — that path's failures are resolved immediately,
   *  forced ERRORED with no TRY/CATCH re-entry, per spec §7's Stop paragraph. */
  deferredFailures: DeferredFailure[];
  /** Task 16 (review fix, controller Ruling B): epoch-ms timestamp of when a step was flipped
   *  to PAUSED (control.ts's runPausing), keyed by step oid. The resuming control pass reads
   *  this to shift the step's `startedAt` forward by exactly the paused duration — suspending
   *  its action-timeout budget for the whole time it sat PAUSED, so it resumes with its
   *  REMAINING budget rather than the clock having kept running underneath it. Cleared for a
   *  step the instant resume consumes it; a stale entry for a step that never resumes (the
   *  instance instead stops/aborts) is harmless orphaned garbage, same tolerance as
   *  childProperties. */
  pausedAt: Record<string, number>;
  /** Task 16 (review fix, Important 1): STOP commands already attempted for an action step
   *  during the CURRENT stopping drain, keyed by step oid — control.ts's runStopping checks
   *  this before re-running a capabilities check + sendCommand(STOP), so a stopping instance
   *  that's re-claimed every idle-wait cycle while it waits for a terminal doesn't repeat a
   *  network round trip (and doesn't fabricate "did work" out of a pure repeat) on every single
   *  pass. Recorded regardless of whether the action turned out to support STOP — a "checked,
   *  unsupported" result is just as settled a fact as a "checked, sent" one. */
  stoppedActions: string[];
  /** Task 16 (review fix, Important 1): bounded-retry counter for a control pass that threw —
   *  mirrors instance.ts/loop.ts's own `startAttempts` (recoverFailedStart) precedent. Reset
   *  implicitly once the instance leaves its transitional status (a fresh EngineState read
   *  after settling elsewhere never has a reason to consult this again). */
  controlPassAttempts: number;
  /** Monotonic counter for live operator submissions — supplies trace `after_action` when the
   *  operator API passes actionIndex 'auto'. The conformance harness keeps passing explicit
   *  fixture indices; the two callers share one entry point (spec §4.4). */
  userActionCounter: number;
  /** Spec 2026-08-22 §3.4 (D6), final-review fix: step oids whose Release / Release Pool Amount
   *  completion commands ALREADY ran at CATCH time (failStep's `release_on_catch !== false`
   *  path), so `drainCascade`'s dequeue-time release (the Task-13 I2 fix) must NOT run them a
   *  SECOND time for that same acquire. Reachable whenever a caught step is later force-completed
   *  without ever re-acquiring — RETURN COMPLETE re-seeds the ORIGINAL trigger step into
   *  drainCascade (returnComplete), whose dequeue loop releases every dequeued step's completion
   *  commands unconditionally. Two releases against one acquire corrupt pool state under
   *  contention: for a binary-exclusive lock the catch-time release hands the lock to a queued
   *  contender, and the second release then flips `inUse` 1 -> 0 while that contender still holds
   *  it, letting a third acquirer into the critical section (the manager has no per-holder
   *  tracking — resources.ts's MODEL note — so nothing downstream catches it).
   *
   *  PERSISTED, not in-memory: the catch network can PARK (e.g. CATCH -> USER_INTERACTION ->
   *  RETURN) so the RETURN COMPLETE that re-seeds the trigger dispatches in a LATER transaction,
   *  with a freshly-constructed WorkflowContext in between.
   *
   *  Lifecycle: SET in failStep right after the catch-time release runs; CONSUMED (checked +
   *  deleted) by drainCascade's dequeue-time release block; CLEARED whenever the step is
   *  reset/re-activated — resetStepIfExists (GOTO/RETRY), clearStepScopedState (RESTART / child
   *  teardown / WORKFLOW PROXY re-activation), and — the one that actually covers RETRY, whose
   *  resetStepIfExists early-returns because failStep already deleted the row —
   *  tryActivateResources, i.e. any FRESH activation attempt: a step that re-runs its Acquire
   *  owes a new release, so any earlier catch-time record for it is spent. A leftover entry for
   *  a step that is never dequeued again (RETURN ABANDON / GOTO elsewhere) is harmless orphaned
   *  garbage, same tolerance as pausedAt/childProperties. */
  releasedOnCatch: Record<string, true>;
  /** GATE spec 2026-08-29 §5.3/§6.4: gates armed concurrently with their preceding
   *  ACTION PROXY step, keyed by gate step oid. `open` = the script already returned TRUE
   *  (cycling stopped, wake_at cleared); `stopSent` = the STOP attempt already happened
   *  this arming (recorded regardless of support — never re-check, mirrors
   *  stoppedActions). Entries clear on gate completion, predecessor failure teardown,
   *  step resets (resetStepIfExists/clearStepScopedState), and are harmless orphaned
   *  garbage on instance terminal (same tolerance as pausedAt). */
  armedGates: Record<string, { predecessorOid: string; open: boolean; stopSent: boolean }>;
  /** Spec 2026-10-13 §6.5: a repeating SCRIPT's memory between runs, keyed by step oid —
   *  `state` is what the script kept (JSON, ≤ 64 KB) and `pendingOutputs` its latest run's
   *  output object, committed only when the step completes. Removed when the step leaves
   *  WAITING_SCRIPT (completion, failStep, resets); an entry left by stop/abort is harmless
   *  orphaned garbage on a terminal instance (same tolerance as pausedAt). */
  scriptRuns: Record<string, { state: unknown; pendingOutputs: ScriptOutputs }>;
  /** Spec 2026-08-31 Phase 2a (plan delta D3): what this instance currently HOLDS of the
   *  work-center-shared environment resources — the authoritative in-transaction record that
   *  `wc_resource_holder` is reconciled from at write-back.
   *
   *  It cannot be derived from the ResourceManager: that model deliberately tracks no holders
   *  (see resources.ts's MODEL note), which is exactly why environment resources previously
   *  had no auto-release. Appended when an environment Acquire is granted, removed when the
   *  matching Release runs, and cleared wholesale by auto-release on terminal. */
  envHolds: EnvHold[];
  /** Phase 4a (plan Ruling P3b): holds this instance wrote that an operator released out of band
   *  (`release-holder` / `reset`); consumed by the step's own later Release so it does not free a
   *  unit that now backs somebody else's hold.
   *
   *  This is the ONLY discriminator that works. An empty `envHolds` for a name is ambiguous —
   *  it is equally "this instance acquired and an operator took the hold away" and "this
   *  instance never held it and is legitimately releasing what somebody else holds" (the
   *  reference model's asymmetric release, which `env-resource-routing.test.ts` pins). Neither
   *  the recipe's nor the releasing step's command list can tell those apart; only the
   *  difference between what this instance PERSISTED and what the live `wc_resource_holder`
   *  table now carries can, which is what `openContext` computes into this list. Entries are
   *  spliced out when consumed, and cleared wholesale alongside `envHolds` on terminal. */
  envHoldsRevoked: EnvHold[];
  /** Data safety round 2 (spec 2026-10-22 §2): epoch ms when the current pause request first
   *  found an action server whose capabilities are unknown. Round 3 (spec
   *  2026-10-22-data-safety-3 §1): also set the first time a PAUSE could not be delivered
   *  (send-failure.ts), and it lasts for the whole pause request — kept when the run settles
   *  `paused`, cleared only by the resuming pass — so undelivered-PAUSE retries count toward the
   *  same 2-minute limit (control.ts's PAUSE_UNKNOWN_LIMIT_MS). Persisted so a restart doesn't
   *  reset the limit; null when no pause request has waited. */
  pausingSince: number | null;
  /** Data safety round 3 (spec 2026-10-22-data-safety-3 §1): step oids whose PAUSE could not
   *  be delivered because the action server was unreachable, in this pause request. Before the
   *  2-minute limit the first such failure writes the `PAUSE could not be delivered — action
   *  server unreachable; retrying` WARNING, so it is written at most once per step. A PAUSE that
   *  timed out may still have reached the server, so the resuming pass also sends RESUME to each
   *  of these steps that is still WAITING_ACTION. Cleared by the resuming pass. */
  pauseUndeliveredWarned: string[];
  /** Final-review fix: step oids that already carry the `action server unreachable — this
   *  action may still be running` WARNING in this pause request (written by the pausing pass at
   *  the limit, or by an undelivered-PAUSE undo past it), so it is written once per step. The
   *  pausing pass skips these steps: the limit ended their cycle. Cleared by the resuming pass. */
  pauseUnreachableWarned: string[];
  /** Data safety round 3: step oids whose PAUSE the action server refused (a 4xx, an auth
   *  rejection, not allowlisted) in this pause request. The pausing pass treats them as not
   *  supporting PAUSE — never resent — and the refusal WARNING is written once. Cleared by the
   *  resuming pass. */
  pauseRefused: string[];
  /** Round 2 (spec 2026-10-23 goal 5): step oid -> epoch ms of the first failed status check
   *  (loop.ts pollDueStep) in the current run of failures. Any failure kind (an HTTP refusal, a
   *  network error) keeps the same clock; a successful check, or the step's terminal, clears it. */
  pollFailingSince: Record<string, number>;
  /** Round 2: step oids that already carry the `action server not answering status checks`
   *  WARNING for the current run of failures, so it is written once. Cleared with
   *  pollFailingSince. */
  pollWarned: string[];
}

export function defaultEngineState(): EngineState {
  return {
    orderCounters: {},
    routingContext: {},
    waitAll: {},
    activeCatches: {},
    resources: null,
    stepSnapshots: {},
    childActive: {},
    childProperties: {},
    blockedOnResources: {},
    deferredRouting: [],
    deferredFailures: [],
    pausedAt: {},
    stoppedActions: [],
    controlPassAttempts: 0,
    userActionCounter: 0,
    releasedOnCatch: {},
    armedGates: {},
    scriptRuns: {},
    envHolds: [],
    envHoldsRevoked: [],
    pausingSince: null,
    pauseUndeliveredWarned: [],
    pauseUnreachableWarned: [],
    pauseRefused: [],
    pollFailingSince: {},
    pollWarned: [],
  };
}

/** Load an EngineState from `workflow_instance.engine_state` (null for a fresh instance, or
 *  a previously-persisted plain object). Missing keys default rather than throw, so the
 *  shape can grow across tasks without a migration. */
export function loadEngineState(row: unknown): EngineState {
  const defaults = defaultEngineState();
  if (!row || typeof row !== 'object') return defaults;
  const r = row as Partial<EngineState>;
  return {
    orderCounters: r.orderCounters ?? defaults.orderCounters,
    routingContext: r.routingContext ?? defaults.routingContext,
    waitAll: r.waitAll ?? defaults.waitAll,
    activeCatches: r.activeCatches ?? defaults.activeCatches,
    resources: r.resources ?? defaults.resources,
    stepSnapshots: r.stepSnapshots ?? defaults.stepSnapshots,
    childActive: r.childActive ?? defaults.childActive,
    childProperties: r.childProperties ?? defaults.childProperties,
    blockedOnResources: r.blockedOnResources ?? defaults.blockedOnResources,
    deferredRouting: r.deferredRouting ?? defaults.deferredRouting,
    deferredFailures: r.deferredFailures ?? defaults.deferredFailures,
    pausedAt: r.pausedAt ?? defaults.pausedAt,
    stoppedActions: r.stoppedActions ?? defaults.stoppedActions,
    controlPassAttempts: r.controlPassAttempts ?? defaults.controlPassAttempts,
    userActionCounter: r.userActionCounter ?? defaults.userActionCounter,
    releasedOnCatch: r.releasedOnCatch ?? defaults.releasedOnCatch,
    armedGates: r.armedGates ?? defaults.armedGates,
    scriptRuns: r.scriptRuns ?? defaults.scriptRuns,
    envHolds: r.envHolds ?? defaults.envHolds,
    envHoldsRevoked: r.envHoldsRevoked ?? defaults.envHoldsRevoked,
    pausingSince: r.pausingSince ?? null,
    pauseUndeliveredWarned: r.pauseUndeliveredWarned ?? [],
    pauseUnreachableWarned: r.pauseUnreachableWarned ?? [],
    pauseRefused: r.pauseRefused ?? [],
    pollFailingSince: r.pollFailingSince ?? {},
    pollWarned: r.pollWarned ?? [],
  };
}
