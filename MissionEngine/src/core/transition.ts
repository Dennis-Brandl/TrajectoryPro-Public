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
import { workflowInstance, stepInstance, ENGINE_STEP_STATES } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type {
  ResourceCommandSpecification, WorkflowConnection, FailureMode, MasterWorkflowStep, CatchContext,
  MasterWorkflowSpecification, TrySpecification,
} from '../spec/types.js';
import {
  WorkflowContext, openContext, settleTerminal, findSpecByOid, knownStepOids, knownStepOidsUnder,
  envSweepTokens, captureEnvReservations, releaseEnvReservations,
} from './context.js';
import { canonicalStepType, needsUserAction, executeScript, handleSelect1, activateCatchStep, executeGateScript, gateMode, gateUsesBindings, nextGateWake, runRepeatingScript, commitScriptOutputs, nextScriptWake, scriptRepeat } from './step-handlers.js';
import { notifyWorkCenter } from './reconcile.js';
import { ACTIVE_ROW_STATES, recordStepRun } from './step-run.js';
import { splitResourceCommands, sortActivationCommands, type InMemoryResourceManager } from './resources.js';
import { partitionCatchNetworks } from '../spec/catch-network.js';
import { isEnvironmentCommand } from './env-scope.js';
import { envToken, parseEnvToken, allManagerTokens, type EnvHold } from './env-resource-bridge.js';

export const TERMINAL_STEP_STATES = new Set(['COMPLETED', 'ERRORED', 'ABORTED', 'CANCELLED']);
/** Shared with loop.ts's settleFailedInstance (processReadyStep path) and instance.ts's own
 *  Task 13 recovery (drainCascade-during-acquire+start path) — both mark every non-terminal
 *  step_instance row ERRORED when settling an instance that died mid-cascade. */
export const NON_TERMINAL_STEP_STATES = ENGINE_STEP_STATES.filter(s => !TERMINAL_STEP_STATES.has(s));

/** Task 13 post-review (I3 fix): hard ceiling on activations within one drainCascade "outer"
 *  call (one open transaction's cascade — the controller-ruled invariant is now
 *  "one-cascade-segment-per-transaction, bounded by parks + a hard cap"). A validator-accepted
 *  machine cycle (e.g. a GOTO loop the validator's own reachability checks don't reject, since
 *  they only prove every step is REACHABLE, not that every path TERMINATES) would otherwise run
 *  forever inside one open PG transaction, wedging a worker slot and holding a transaction open
 *  indefinitely — a handful of such instances can starve the whole engine. Exceeding it throws
 *  `CascadeExceededError`, which instance.ts's own recovery catch (or loop.ts's C2 path, for the
 *  processReadyStep route) settles the instance 'errored' with a clear message, exactly like any
 *  other step-activation-logic failure. */
export const MAX_CASCADE_ACTIVATIONS = 10_000;

export class CascadeExceededError extends Error {
  constructor(limit: number) {
    super(`cascade exceeded ${limit} activations — possible unterminated machine cycle`);
    this.name = 'CascadeExceededError';
  }
}

/** Task 13 post-review (I4 fix): thrown by instance.ts's OWN inline drainCascade-failure
 *  recovery (its narrow catch around drainCascade — see instance.ts) when its OWN recovery
 *  statements throw (a genuine DB-level failure, not a poisoned workflow). Distinguishes this
 *  specific "recovery itself failed" case from an ordinary throw escaping the acquire+start
 *  transaction from somewhere else entirely — critically, the pre-existing C1 atomicity test
 *  (linear-flow.test.ts) deliberately exploits a throw from the UNTOUCHED happy path (context.
 *  persist() at the very end of startInstanceFromQueued, never reached by instance.ts's own
 *  catch block at all) and expects THAT to keep rolling back to a silent, retryable 'queued'
 *  state exactly as before — loop.ts's I4 recovery (recoverFailedStart, bounded retry) must
 *  ONLY engage for this tagged case, or it would swallow C1's own scenario into the wrong
 *  recovery path. Lives in transition.ts (not loop.ts or instance.ts) so both can import it
 *  without a circular dependency (loop.ts already imports from instance.ts). */
export class StartRecoveryFailedError extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'StartRecoveryFailedError';
  }
}

function buildResourceKey(cmd: ResourceCommandSpecification, ownerOid: string): string {
  return `${cmd.resource_source_oid ?? ownerOid}:${cmd.resource_name}`;
}

/**
 * Task 4 (Phase 2a): resolve which tier `cmd` belongs to and the (manager, key, token) triple
 * that tier's InMemoryResourceManager calls need. `context.root.envScope` is the IDENTICAL
 * EnvironmentScope object `envResourceNames` (context.ts) used to compute the registry LOCK
 * SET — routing MUST read it through here, never recompute its own copy, or "which tier a
 * command belongs to" could drift from "which names actually got locked" (see env-scope.ts's
 * own doc comment for why that already bit this program once, pre-fix).
 *
 * Fails loudly, rather than silently falling back to the workflow-tier manager, when a command
 * routes as environment but this work center was never hydrated for that name — the program's
 * standing no-backfill trap: a work center whose environment spec was never re-loaded can be
 * missing the `wc_resource` row a newer recipe declares. Falling back would silently un-share
 * the resource per instance again, which is the exact founding defect Phase 2a exists to close.
 *
 * The workflow-tier branch does NOT throw on a missing `context.resources` — it returns `mgr:
 * null` and lets each caller decide (attemptResourceCommands throws, matching its pre-existing
 * defensive posture; releaseResourceCompletionCommands silently skips, matching ITS pre-existing
 * posture) rather than this shared helper picking one behavior for both and silently changing
 * the other's.
 */
function resolveResourceTier(
  context: WorkflowContext,
  stepOid: string,
  cmd: ResourceCommandSpecification,
): { mgr: InMemoryResourceManager | null; key: string; token: string; env: boolean } {
  const env = isEnvironmentCommand(cmd, context.spec, context.root.envScope);
  if (env) {
    if (!context.root.envResources || !context.root.envKnownNames.has(cmd.resource_name)) {
      throw new Error(
        `step "${stepOid}": environment resource "${cmd.resource_name}" is not hydrated for work center ` +
        `"${context.root.workCenterId}" — the work center's environment specification likely needs to be re-loaded`,
      );
    }
    return { mgr: context.root.envResources, key: cmd.resource_name, token: envToken(context.root.id, stepOid), env: true };
  }
  return { mgr: context.resources, key: buildResourceKey(cmd, context.spec.oid), token: stepOid, env: false };
}

/**
 * Phase 4a (plan Ruling P3b): which entry of a hold list a Release may consume. Both lists —
 * `state.envHolds` and `state.envHoldsRevoked` — have the same shape and the same matching
 * rule, which is exactly why the same two functions serve both; the ORDER the caller runs them
 * in is where the whole guard lives (see `releaseResourceCompletionCommands`).
 *
 * `findExactEnvHold` matches (name, stepOid[, heldName]) — one Release accounting for one
 * Acquire on the SAME step, the Task 4 convention. `findAnyEnvHold` matches any step of this
 * instance holding `name` — a Release placed on a later step than its Acquire is legal and is
 * matched correctly either way. -1 = no entry in THIS list.
 *
 * Final-review I1 is why these are two functions rather than one exact-then-any fallback: a
 * single function forces "both matches in the ledger, then both in the revoked list", and an
 * instance holding one resource on TWO steps then releases the OTHER step's live hold when the
 * revoked step's own Release runs. The four lookups have to interleave the two lists.
 *
 * Task 4 (review fix, Finding 1) note that carries over unchanged: a step CAN hold several
 * SEPARATE one-unit entries for the same (name, stepOid) pair — e.g. a binary-shared-use
 * resource acquired twice by the same step in two separate Acquire commands — and findIndex
 * matches only the first of those per call, exactly one Release accounting for exactly one
 * acquire. A `heldName` of undefined (a Release with no `target`, or one whose target never
 * resolved) deliberately matches ANY entry for the name, so a FAILED named-pool release still
 * finds its entry and `removeEnvHoldAt` below is what declines to touch it.
 */
function findExactEnvHold(holds: EnvHold[], resourceName: string, stepOid: string, heldName: string | undefined): number {
  return holds.findIndex((h) =>
    h.name === resourceName && h.stepOid === stepOid && (heldName === undefined || h.heldName === heldName));
}

function findAnyEnvHold(holds: EnvHold[], resourceName: string, heldName: string | undefined): number {
  return holds.findIndex((h) => h.name === resourceName && (heldName === undefined || h.heldName === heldName));
}

/** The one instrumentation site for a Release the revoked-hold marker swallowed. Hoisted out of
 *  `releaseResourceCompletionCommands` because BOTH marker lookups (exact and any) report it
 *  with the identical message — a dropped release is a wedge report either way (Phase 2a
 *  lesson: instrumented, never silent). */
function warnReleaseSkipped(instanceId: string, stepOid: string, resourceName: string): void {
  console.warn(
    `[mission-engine] instance ${instanceId} step ${stepOid}: Release "${resourceName}" skipped — ` +
    'its hold was released by an operator',
  );
}

/** Decrement-then-splice-at-zero on the entry the caller's lookup chose (findExactEnvHold /
 *  findAnyEnvHold, above). A failed release leaves the
 *  ledger untouched — deliberately (a named release whose name did not resolve keeps its entry).
 *
 *  Task 4 (review fix, Finding 1), unchanged by Ruling P3's split: `released` is release()'s own
 *  return value — false for a failed release (a named-pool release whose `cmd.target` never
 *  resolved to a name, or a double-release on a binary resource) must leave the ledger
 *  untouched, since removing an entry for a release that never happened would make the ledger
 *  claim free capacity the registry still has reserved.
 *
 *  `releasedAmount` (cmd.amount ?? 1) is subtracted from the matched entry's own `amount`,
 *  splicing the entry out only once it reaches zero or below. This matters specifically for a
 *  COUNTABLE pool: `attemptResourceCommands`' 'Acquire Pool Amount' records ONE entry carrying
 *  the WHOLE acquired amount (e.g. amount: 3), not three separate one-unit entries — a
 *  'Release Pool Amount' of 1 must decrement that single entry to 2, not delete it outright, or
 *  the ledger would claim the step holds nothing while 2 units are still reserved in the shared
 *  registry (the same wedge Ruling A exists to prevent, arriving through a different door). A
 *  plain (non-pool-amount) 'Release' always targets a one-unit entry (only 'Acquire' — never
 *  'Acquire Pool Amount' — produces those), so passing amount 1 there always fully removes it. */
function removeEnvHoldAt(holds: EnvHold[], idx: number, released: boolean, releasedAmount: number): void {
  if (!released) return;
  const remaining = holds[idx].amount - releasedAmount;
  if (remaining <= 0) {
    holds.splice(idx, 1);
  } else {
    holds[idx] = { ...holds[idx], amount: remaining };
  }
}

/**
 * Attempt a (sorted, already-split) list of activation commands, continuing from wherever a
 * prior attempt left off — shared by a step's FIRST resource attempt (tryActivateResources,
 * below) and a resumed one driven by a release (resumeGrantedSteps). Transcribed from
 * reference engine.ts:992-1063's executeActivationCommands. Returns true iff every command in
 * `remaining` was granted this call; on a block, (re-)records `blockedOnResources` from the
 * command that blocked onward, so the NEXT resumption picks up after it rather than
 * re-attempting (and double-acquiring) anything already granted.
 *
 * Task 4: each command is routed independently via resolveResourceTier — a single step can mix
 * workflow- and environment-scoped commands. An environment Acquire / Acquire Pool Amount that
 * is granted IMMEDIATELY here (never queued) earns its envHolds entry inline, right after the
 * grant; a queued one earns it later, in resumeGrantedSteps, where the grant that completes it
 * actually lands.
 */
function attemptResourceCommands(
  context: WorkflowContext,
  stepOid: string,
  remaining: ResourceCommandSpecification[],
  completionCommands: ResourceCommandSpecification[],
): boolean {
  for (let i = 0; i < remaining.length; i++) {
    const cmd = remaining[i];
    const tier = resolveResourceTier(context, stepOid, cmd);
    // Task 4 (review fix, unremarked-behavior-change minor): this throw used to run ONCE before
    // the loop, over `context.resources` alone, so ANY resource command on a step with no
    // workflow-tier manager failed the same way. Now it is per-command and reachable only for a
    // WORKFLOW-scoped command specifically — a step whose commands are ALL environment-scoped
    // legitimately has no workflow-tier manager at all (nothing ever registers one for it), and
    // must not throw here just because `context.resources` happens to be null. Deliberate.
    if (!tier.mgr) {
      throw new Error(
        `step "${stepOid}" declares resource_command_specifications but no workflow-tier ResourceManager ` +
        `is registered for spec "${context.spec.oid}"`,
      );
    }
    const { mgr, key, token, env } = tier;
    let blocked = false;
    let grantedName: string | null = null;
    switch (cmd.command_type) {
      case 'Acquire': {
        const r = mgr.acquire(key, token, cmd.amount);
        if (!r.granted) { blocked = true; break; }
        if (r.name && cmd.target) context.props.set(cmd.target, r.name);
        grantedName = r.name ?? null;
        break;
      }
      case 'Acquire Pool Amount': {
        const r = mgr.acquire(key, token, cmd.amount);
        if (!r.granted) blocked = true;
        break;
      }
      case 'Send': {
        const data = cmd.source ? context.props.resolveKey(cmd.source) : '';
        const r = mgr.send(key, token, data);
        if (!r.ready) blocked = true;
        break;
      }
      case 'Receive': {
        const r = mgr.receive(key, token);
        if (!r.available) { blocked = true; break; }
        if (cmd.target) context.props.setSyncTarget(cmd.target, r.data);
        break;
      }
      case 'Synchronize': {
        const r = mgr.synchronize(key, token);
        if (!r.ready) blocked = true;
        break;
      }
      default:
        break; // Release / Release Pool Amount are completion commands, not activation.
    }
    if (blocked) {
      context.state.blockedOnResources[stepOid] = {
        stepOid,
        blockedOn: { resource_name: cmd.resource_name, command_type: cmd.command_type },
        remainingCommands: remaining.slice(i + 1),
        completionCommands,
      };
      return false;
    }
    if (env && (cmd.command_type === 'Acquire' || cmd.command_type === 'Acquire Pool Amount')) {
      context.root.state.envHolds.push({
        name: cmd.resource_name,
        stepOid,
        amount: cmd.command_type === 'Acquire Pool Amount' ? (cmd.amount ?? 1) : 1,
        heldName: grantedName,
      });
    }
  }
  delete context.state.blockedOnResources[stepOid];
  return true;
}

/** A step's FIRST resource activation attempt (Acquire / Acquire Pool Amount / Send / Receive /
 *  Synchronize), transcribed from reference engine.ts:981-990's processResourceCommands: split
 *  + sort the full command list, then hand it to attemptResourceCommands. */
function tryActivateResources(
  context: WorkflowContext,
  stepOid: string,
  cmds: ResourceCommandSpecification[],
): boolean {
  // Final-review fix (see EngineState.releasedOnCatch): a FRESH activation attempt supersedes any
  // catch-time release recorded for this step — it is about to acquire again, so the release it
  // owes at ITS completion is a NEW one and must not be suppressed. This is the clearing site
  // that actually covers RETRY: returnRetry's resetStepIfExists early-returns (failStep already
  // deleted the trigger's row), and a GOTO/machine-cycle that reaches the trigger again through
  // ordinary routing never resets it at all.
  delete context.state.releasedOnCatch[stepOid];
  const { activation, completion } = splitResourceCommands(cmds);
  const sorted = sortActivationCommands(activation);
  return attemptResourceCommands(context, stepOid, sorted, completion);
}

/** Run a completing step's Release / Release Pool Amount commands (reference
 *  engine.ts:803-822's processReleaseCommands). Runs inline in the same transition as the
 *  step's own completion — v1 has no reason to defer it, since the step never re-enters
 *  WAITING between activation and completion (that only happens via the block path above,
 *  which returns before this is ever reached). */
export function releaseResourceCompletionCommands(
  context: WorkflowContext,
  stepOid: string,
  cmds: ResourceCommandSpecification[],
): void {
  const { completion } = splitResourceCommands(cmds);
  const sorted = [...completion].sort((a, b) => a.resource_name.localeCompare(b.resource_name));
  for (const cmd of sorted) {
    if (cmd.command_type === 'Release' || cmd.command_type === 'Release Pool Amount') {
      // Task 4: routed independently per command, same as attemptResourceCommands — a step's
      // completion commands can mix tiers too. A missing WORKFLOW-tier manager stays a silent
      // skip (mgr === null), matching this function's pre-existing defensive posture; a missing
      // ENVIRONMENT-tier hydration still fails loudly (resolveResourceTier throws) — that
      // posture must not soften just because this is the release side of the same command.
      const tier = resolveResourceTier(context, stepOid, cmd);
      if (!tier.mgr) continue;
      const name = cmd.target ? context.props.get(cmd.target) : undefined;
      if (!tier.env) {
        tier.mgr.release(tier.key, cmd.amount, name);
        continue;
      }
      // Phase 4a (plan Ruling P3b): the ENVIRONMENT tier is guarded by a REVOKED-HOLD MARKER.
      // Phase 4a's `release-holder` / `reset` verbs delete another instance's holder rows and
      // hand the freed capacity to the next waiter. If that former holder's own step then runs
      // its declared Release, the shared counter is decremented a SECOND time — `in_use` drops
      // below the holder ledger and two instances hold one exclusive resource.
      //
      // An EMPTY ledger cannot be the discriminator: it reads identically for "this instance
      // acquired and an operator took the hold away" and for "this instance never held it and
      // is legitimately releasing what somebody ELSE holds" — the reference model's asymmetric
      // release, which env-resource-routing.test.ts's `releaser` step pins and which neither
      // the recipe's nor the releasing step's command list can distinguish (both tried; both
      // failed on one of the two cases). Only `openContext` can tell them apart, by diffing what
      // this instance PERSISTED against what `wc_resource_holder` now carries — that diff is
      // `state.envHoldsRevoked`.
      //
      // FIVE outcomes, in this order (final-review I1, residual R2): exact-ledger,
      // exact-revoked, any-revoked, any-ledger, unconditional. The two lists INTERLEAVE — a
      // revoked marker outranks a live hold of the same resource on ANOTHER step of this
      // instance, at BOTH precision levels. Checking both of one list before either of the other
      // is what I1 caught: an instance holding a `use_limit 2` pool at steps A and B, whose A
      // row an operator released to somebody else, would answer A's own Release from B's
      // still-live ledger entry — freeing a unit B is still using and granting it to a third
      // instance, `in_use` below reality, which is the exact wedge class this marker exists to
      // prevent. R2 is the same window one precision level down: with A's Acquire on `acq-a` and
      // its Release on a later `ui-a`, NEITHER exact lookup can match, so an any-ledger check
      // ahead of any-revoked reproduces I1 exactly.
      //
      // Revoked-first among the ANY-step lookups is also the safe way to be WRONG. When both
      // any-lookups would match and neither is exact, this Release cannot be attributed with
      // certainty to either hold; consuming the marker leaves a unit held until the sibling
      // step's own Release (or terminal auto-release) gives it back — under-subscription, which
      // self-heals — while consuming the ledger entry frees a unit another step is still using,
      // which is the wedge and does not.
      const holds = context.root.state.envHolds;
      const revoked = context.root.state.envHoldsRevoked;
      const releasedAmount = cmd.amount ?? 1;
      const exactHold = findExactEnvHold(holds, cmd.resource_name, stepOid, name);
      if (exactHold >= 0) {
        // 1. The ledger backs it on THIS step — an ordinary release, one Release accounting for
        //    one Acquire on the same step (the Task 4 convention).
        const released = tier.mgr.release(tier.key, cmd.amount, name);
        removeEnvHoldAt(holds, exactHold, released, releasedAmount);
        continue;
      }
      const exactRevoked = findExactEnvHold(revoked, cmd.resource_name, stepOid, name);
      if (exactRevoked >= 0) {
        // 2. THIS step DID hold it and an operator released the hold out of band. Consume this
        //    Release's SHARE of the marker and touch nothing: the freed units already back
        //    somebody else's hold. Decrement-by-amount, exactly as the ledger path does — an
        //    'Acquire Pool Amount' of 3 records ONE entry (and therefore ONE marker) carrying
        //    amount 3, so a bare splice here would let a 'Release Pool Amount 1' consume the
        //    whole marker and leave the recipe's remaining two releases to fall through to the
        //    unconditional outcome and decrement the shared counter after all — the very wedge
        //    this guard exists to close. `released: true` because a SKIPPED release still spends
        //    its share. A binary hold (amount 1) splices on the first call, exactly as before.
        removeEnvHoldAt(revoked, exactRevoked, true, releasedAmount);
        warnReleaseSkipped(context.root.id, stepOid, cmd.resource_name);
        continue;
      }
      const anyRevoked = findAnyEnvHold(revoked, cmd.resource_name, name);
      if (anyRevoked >= 0) {
        // 3. SOME step of this instance held it and an operator revoked that hold — the
        //    cross-step case of (2): skip and consume, exactly as (2) does. Ahead of the
        //    any-ledger lookup below (R2) for the two reasons in the doc comment: it is the
        //    only thing that guards a revoked branch whose Release sits on a LATER step than
        //    its Acquire, and a mis-attribution here under-subscribes rather than wedging.
        removeEnvHoldAt(revoked, anyRevoked, true, releasedAmount);
        warnReleaseSkipped(context.root.id, stepOid, cmd.resource_name);
        continue;
      }
      const anyHold = findAnyEnvHold(holds, cmd.resource_name, name);
      if (anyHold >= 0) {
        // 4. Some OTHER step of this instance holds it, and nothing of this instance's was
        //    revoked — a Release placed on a later step than its Acquire, which is legal.
        //    Reconciling the ledger here also closes a PRE-EXISTING double-free: before this
        //    fallback, such a Release left the entry in place and the terminal auto-release
        //    freed the unit a second time.
        const released = tier.mgr.release(tier.key, cmd.amount, name);
        removeEnvHoldAt(holds, anyHold, released, releasedAmount);
        continue;
      }
      // 5. Neither list, on any step: this instance never held it. The reference model's
      //    unconditional asymmetric release stands, and there is by definition no ledger entry
      //    to reconcile. §5.7 legacy holds land here too — untracked by design, so never
      //    persisted, so never revoked — keeping exactly the behaviour they have today.
      tier.mgr.release(tier.key, cmd.amount, name);
    }
  }
}

/**
 * After a step's resource activation attempt produces one or more grants (whether from a full
 * release, per finishStep, or from an EARLIER command in the SAME blocking attempt already
 * succeeding before a LATER one blocked — reference engine.ts:844-918's
 * resumeGrantedSteps/processGrantedSteps, adapted: no cross-engine `knownStepOids` filter for
 * the WORKFLOW tier — v1 has one workflow-tier ResourceManager per instance, never shared
 * across instances, so every grant IT produces belongs to THIS context. For each grant: deliver
 * any sync data / named-pool assignment, continue the step's remaining activation commands from
 * where `blockedOnResources` left off, and — once fully granted — run it the rest of the way,
 * cascading its OWN successors (drainCascade) if it completes. Task 13 fix: resumed completions
 * now go through the SAME eager BFS cascade as every other completion (drainCascade), rather
 * than the old direct-recursive routeSuccessors — a resumed step's own fan-out gets the
 * identical reference-parity treatment.
 *
 * Task 4 (Phase 2a): also flushes `context.root.envResources`, filtered to THIS INSTANCE's own
 * tokens (`envToken(context.root.id, oid)` over `knownStepOids(context.root)`) — unlike the
 * workflow-tier manager, envResources is shared across the WHOLE work center, so an unfiltered
 * flush would steal a grant that just landed on a DIFFERENT instance's queued waiter (Task 5's
 * write-back hands that one off via a targeted pg_notify instead, never resuming it directly).
 * Scoped off `context.root`, not the (possibly narrower) `context` this function was called
 * with — drainCascade can invoke this with a child view — so a step belonging to a sibling or
 * ancestor branch of the SAME instance is never excluded either: diffRegistry deletes an owned
 * grant's waiter row on the assumption it was consumed here, so silently skipping a legitimately
 * owned token would strand that step forever with no queued row left to ever wake it again. An
 * environment grant's envHolds entry is appended HERE, not in attemptResourceCommands — the
 * manager already granted it internally (via a release's tryGrantXXX) when the ORIGINAL Acquire
 * blocked and queued; this is the first point the engine-level bookkeeping catches up.
 *
 * Returns `{ settled, resumedAny }`: `settled` iff resuming any grant settled the WHOLE
 * instance (a SCRIPT failure via failStep, discovered deep in a nested resume) — callers must
 * stop cascading immediately when this happens, same contract as drainCascade/finishStep (C1).
 * `resumedAny` (Task 5, Critical 1 fix) iff there was at least one grant to process at all,
 * regardless of whether it settled, fully completed, or only re-blocked further along its own
 * command list — the manager's internal state (pendingGrants, queue) changed either way, so a
 * caller with no other reason to believe it did work (processReadyStep's own `!target` branch,
 * below — a cross-instance grant landing on an otherwise-idle instance) needs this to decide
 * whether to persist() and report having done anything at all.
 */
export async function resumeGrantedSteps(tx: Db, context: WorkflowContext, deps: EngineDeps): Promise<{ settled: boolean; resumedAny: boolean }> {
  const mgr = context.resources;
  const workflowGrants = mgr ? mgr.flushGranted() : [];

  const envMgr = context.root.envResources;
  // Task 4 (review fix, Minor): call the hoisted envSweepTokens helper (below) rather than
  // inlining the same envToken/knownStepOids mapping a second time — two copies of that
  // mapping is exactly the kind of pair that drifts.
  const envGrants = envMgr
    ? envMgr.flushGranted(envSweepTokens(context.root.id, knownStepOids(context.root)))
    : [];

  type ResolvedGrant = { mgr: InMemoryResourceManager; queueKey: string; stepOid: string; resourceKey: string; env: boolean };
  const granted: ResolvedGrant[] = [
    ...workflowGrants.map((g): ResolvedGrant => ({ mgr: mgr!, queueKey: g.stepOid, stepOid: g.stepOid, resourceKey: g.resourceKey, env: false })),
    ...envGrants.map((g): ResolvedGrant => ({ mgr: envMgr!, queueKey: g.stepOid, stepOid: parseEnvToken(g.stepOid).stepOid, resourceKey: g.resourceKey, env: true })),
  ];
  const resumedAny = granted.length > 0;

  for (const grant of granted) {
    const pending = context.state.blockedOnResources[grant.stepOid];
    if (!pending) {
      // Task 4 (review fix, Minor): the reviewer could not construct a reachable path that
      // drops an environment grant here — but for the WORKFLOW tier a dropped grant only ever
      // wedges this one dying instance, while for the ENVIRONMENT tier the manager has already
      // decremented shared capacity (a release's tryGrantXXX already ran) with nothing left to
      // ever consume that grant, wedging the resource for the WHOLE work center. A trace beats
      // a silent vanish if this ever does fire.
      if (grant.env) {
        console.warn(`[mission-engine] instance ${context.root.id}: dropped an environment grant for resource "${grant.resourceKey}" (token "${grant.queueKey}") — no blockedOnResources record for step "${grant.stepOid}"`);
      }
      continue; // defensive — every real grant traces back to a block we recorded
    }

    // Task 12: a grant can belong to ANY step in the shared-resource-manager tree — root or a
    // (possibly nested) child — not just the CURRENT context's own steps, since resources are
    // shared instance-wide (reference engine.ts:707). findStep resolves the owning context
    // regardless of which context instance this function was called with.
    const found = context.findStep(grant.stepOid);
    if (!found) {
      if (grant.env) {
        console.warn(`[mission-engine] instance ${context.root.id}: dropped an environment grant for resource "${grant.resourceKey}" (token "${grant.queueKey}") — step "${grant.stepOid}" not found anywhere in the spec tree`);
      }
      delete context.state.blockedOnResources[grant.stepOid];
      continue;
    }
    const { context: stepCtx, stepDef } = found;

    const syncData = grant.mgr.getSyncData(grant.queueKey);
    if (syncData !== undefined) {
      const receiveCmd = stepDef.resource_command_specifications?.find(c => c.command_type === 'Receive');
      if (receiveCmd?.target) stepCtx.props.setSyncTarget(receiveCmd.target, syncData);
      grant.mgr.clearSyncData(grant.queueKey);
    }
    const assignedName = grant.mgr.consumePendingNamedAssignment(grant.queueKey);
    // Task 4 (review fix, minor): matching on bare resource_name alone (the env branch) is
    // ambiguous when a step declares BOTH a workflow-scoped and an environment-scoped Acquire
    // for the same bare name (e.g. two commands both named "Ink", one workflow- one
    // environment-scoped) — find() would take whichever comes first regardless of which tier
    // this grant actually belongs to, corrupting the envHolds amount/target below. Re-running
    // isEnvironmentCommand on each candidate (the SAME check resolveResourceTier uses) confines
    // the match to a command that is genuinely the same tier as this grant.
    const acquireCmd = stepDef.resource_command_specifications?.find((c) => {
      if (c.command_type !== 'Acquire' && c.command_type !== 'Acquire Pool Amount') return false;
      if (isEnvironmentCommand(c, stepCtx.spec, stepCtx.root.envScope) !== grant.env) return false;
      return grant.env ? c.resource_name === grant.resourceKey : buildResourceKey(c, stepCtx.spec.oid) === grant.resourceKey;
    });
    if (assignedName !== undefined && acquireCmd?.target) {
      stepCtx.props.set(acquireCmd.target, assignedName);
    }
    if (grant.env && acquireCmd) {
      context.root.state.envHolds.push({
        name: acquireCmd.resource_name,
        stepOid: grant.stepOid,
        amount: acquireCmd.command_type === 'Acquire Pool Amount' ? (acquireCmd.amount ?? 1) : 1,
        heldName: assignedName ?? null,
      });
    }

    const stillGranted = attemptResourceCommands(
      stepCtx, grant.stepOid, pending.remainingCommands, pending.completionCommands,
    );
    if (!stillGranted) {
      await stepCtx.recordTrace(tx, grant.stepOid, 'WAITING');
      continue; // blocked again, on a later command in the same list
    }

    const [grantedRow] = await tx.select().from(stepInstance)
      .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, grant.stepOid)));
    if (!grantedRow) {
      if (grant.env) {
        console.warn(`[mission-engine] instance ${context.root.id}: dropped an environment grant for resource "${grant.resourceKey}" (token "${grant.queueKey}") — no step_instance row for step "${grant.stepOid}"`);
      }
      continue; // defensive — the row must exist (it was activated once already)
    }
    const result = await runStepActivation(tx, stepCtx, grantedRow, stepDef, deps);
    if (result.settled) return { settled: true, resumedAny };
    if (result.completed) {
      const cascadeSettled = await drainCascade(tx, stepCtx, [grantedRow.stepOid], deps);
      if (cascadeSettled) return { settled: true, resumedAny };
    }
    // Task 12: the resumed step may have been the LAST active step of some child context —
    // bubble that child's completion (and any ancestor it completes in turn) up now, in the
    // SAME cascade the reference's synchronous drainCompletionQueue would have run inline.
    await settleIfComplete(tx, context.root, grantedRow.nodeOid, deps);
  }
  return { settled: false, resumedAny };
}

// ── WAIT ALL joins (reference engine.ts:1178-1273) ──

function getIncomingStepOids(context: WorkflowContext, targetOid: string): string[] {
  const seen = new Set<string>();
  for (const c of context.spec.connections) {
    if (c.to_step_id === targetOid) seen.add(c.from_step_id);
  }
  return [...seen];
}

/**
 * WAIT ALL join arrival — reference engine.ts:1178 handleWaitAllArrival, ported directly.
 * Task 13 fix: no longer recurses into routing when it completes (the pre-Task-13 version's
 * `seedOrCompleteWaitAll`/`completeWaitAllStep` pair called `routeSuccessors` synchronously,
 * inline, the instant a join was satisfied) — that recursive-DFS shape is exactly what produced
 * the exec-parallel-* trace divergences task-13-brief.md's ledger flagged (see drainCascade's
 * doc comment for the full analysis). This function now ONLY traces/mutates the row and
 * returns whether the join just became COMPLETED; the caller (drainCascade / activateAndCascade)
 * pushes the oid onto its OWN BFS queue for the NEXT wave — mirroring the reference's own
 * `completeWaitAll`, which does `completionQueue.push(waitAll.oid)` rather than calling
 * `drainCompletionQueue()` recursively (engine.ts:1212-1216).
 */
async function waitAllArrival(
  tx: Db, context: WorkflowContext, stepDef: MasterWorkflowStep, sourceOid: string, deps: EngineDeps,
): Promise<boolean> {
  const [existing] = await tx.select().from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, stepDef.oid)));

  if (!existing) {
    // First arrival — seed `expected` from incoming edges, `completed` from the arriving
    // source plus any incoming predecessor that already reached COMPLETED before this join
    // even started tracking (reference engine.ts:1183-1189).
    const expected = getIncomingStepOids(context, stepDef.oid);
    const priorCompleted = expected.length
      ? await tx.select({ stepOid: stepInstance.stepOid }).from(stepInstance).where(and(
          eq(stepInstance.workflowInstanceId, context.id),
          inArray(stepInstance.stepOid, expected),
          eq(stepInstance.state, 'COMPLETED'),
        ))
      : [];
    const completed = new Set(priorCompleted.map(r => r.stepOid));
    completed.add(sourceOid);
    context.state.waitAll[stepDef.oid] = { expected, completed: [...completed] };

    if (expected.length > 0 && completed.size >= expected.length) {
      // Already satisfied on FIRST touch — skip the EXECUTING park entirely, go straight to
      // COMPLETED (reference engine.ts:1193-1195).
      delete context.state.waitAll[stepDef.oid];
      await context.recordTrace(tx, stepDef.oid, 'COMPLETED');
      await tx.insert(stepInstance).values({
        workflowInstanceId: context.id, nodeOid: context.spec.oid, stepOid: stepDef.oid,
        stepType: canonicalStepType(stepDef.step_type), state: 'COMPLETED',
        startedAt: deps.now(), completedAt: deps.now(), createdAt: deps.now(), updatedAt: deps.now(),
      });
      return true;
    }

    await context.recordTrace(tx, stepDef.oid, 'EXECUTING');
    await tx.insert(stepInstance).values({
      workflowInstanceId: context.id, nodeOid: context.spec.oid, stepOid: stepDef.oid,
      stepType: canonicalStepType(stepDef.step_type), state: 'EXECUTING',
      startedAt: deps.now(), createdAt: deps.now(), updatedAt: deps.now(),
    });
    return false;
  }

  if (existing.state !== 'EXECUTING') return false; // already joined (or otherwise terminal) — no re-entry (reference parity)

  const tracking = context.state.waitAll[stepDef.oid] ?? { expected: getIncomingStepOids(context, stepDef.oid), completed: [] };
  const completed = new Set(tracking.completed);
  completed.add(sourceOid);
  context.state.waitAll[stepDef.oid] = { expected: tracking.expected, completed: [...completed] };
  if (completed.size >= tracking.expected.length) {
    delete context.state.waitAll[stepDef.oid];
    await context.recordTrace(tx, stepDef.oid, 'COMPLETED');
    await tx.update(stepInstance).set({
      state: 'COMPLETED', completedAt: deps.now(), updatedAt: deps.now(),
    }).where(eq(stepInstance.id, existing.id));
    return true;
  }
  return false;
}

/**
 * Post-drain sweep — reference engine.ts:1218 activatePendingWaitAlls, run ONCE per drainCascade
 * "wave" (after its BFS queue fully drains), never once per individual step completion — that
 * timing is what makes exec-parallel-001's ui-a/ui-b both reach EXECUTING BEFORE step-wait-all
 * gets its own EXECUTING trace, and what lets exec-parallel-002's wait-all skip straight to
 * COMPLETED (both script-a and script-b are ALREADY at COMPLETED state, via the BFS wave that
 * ran before either one's OWN routing happened, by the time wait-all's arrival fires — see
 * drainCascade's doc comment for the full derivation task-13-brief.md's report walks through).
 *
 * Pre-activates any WAIT ALL step that has never been touched (no row yet) once EVERY one of
 * its incoming branches has at least started (has a row of its own — under this eager model a
 * row only ever exists once real activation has already been attempted, so "row exists" is
 * exactly "started", unlike the old lazy model where a bare READY row could sit unactivated).
 * Runs in step-definition order (exec-parallel-004: inner before outer for nested parallels).
 *
 * Returns the oids of any WAIT ALL that became COMPLETED via this very sweep (satisfied on
 * first touch) — the caller pushes these back onto its OWN queue and re-drains. Deliberate
 * improvement over a genuine reference quirk: the reference's own `completeWaitAll` ALSO
 * pushes onto completionQueue when this happens (engine.ts:1212-1216), but
 * `activatePendingWaitAlls` runs strictly AFTER `drainCompletionQueue`'s own `while` loop exits
 * (engine.ts:798-799), so that push is never redrained within the SAME call — apparently
 * unintentional. None of the 82 vendored fixtures can distinguish "redrained immediately" from
 * "left for the next external trigger" (arrival always wins first in every topology they
 * exercise — verified by hand for exec-parallel-001..005), so this port redrains instead of
 * replicating the quirk.
 */
async function sweepPendingWaitAlls(tx: Db, context: WorkflowContext, deps: EngineDeps): Promise<string[]> {
  const completedNow: string[] = [];
  for (const stepDef of context.spec.steps) {
    if (canonicalStepType(stepDef.step_type) !== 'WAIT ALL') continue;
    const [existing] = await tx.select().from(stepInstance)
      .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, stepDef.oid)));
    if (existing) continue; // already touched — either parked or joined; this sweep only seeds untouched joins

    const incoming = getIncomingStepOids(context, stepDef.oid);
    if (incoming.length === 0) continue;

    const startedRows = await tx.select({ stepOid: stepInstance.stepOid, state: stepInstance.state })
      .from(stepInstance)
      .where(and(eq(stepInstance.workflowInstanceId, context.id), inArray(stepInstance.stepOid, incoming)));
    const startedByOid = new Map(startedRows.map(r => [r.stepOid, r.state]));
    if (!incoming.every(oid => startedByOid.has(oid))) continue;

    const completed = new Set(incoming.filter(oid => startedByOid.get(oid) === 'COMPLETED'));
    context.state.waitAll[stepDef.oid] = { expected: incoming, completed: [...completed] };
    await context.recordTrace(tx, stepDef.oid, 'EXECUTING');
    const [inserted] = await tx.insert(stepInstance).values({
      workflowInstanceId: context.id, nodeOid: context.spec.oid, stepOid: stepDef.oid,
      stepType: canonicalStepType(stepDef.step_type), state: 'EXECUTING',
      startedAt: deps.now(), createdAt: deps.now(), updatedAt: deps.now(),
    }).returning();

    if (completed.size >= incoming.length) {
      delete context.state.waitAll[stepDef.oid];
      await context.recordTrace(tx, stepDef.oid, 'COMPLETED');
      await tx.update(stepInstance).set({
        state: 'COMPLETED', completedAt: deps.now(), updatedAt: deps.now(),
      }).where(eq(stepInstance.id, inserted.id));
      completedNow.push(stepDef.oid);
    }
  }
  return completedNow;
}

// ── Routing (reference engine.ts:1275-1315 getRoutedConnections) ──

export function getRoutedConnections(context: WorkflowContext, stepOid: string): WorkflowConnection[] {
  const all = context.spec.connections.filter(c => c.from_step_id === stepOid);
  const routing = context.state.routingContext[stepOid];
  if (!routing) return all;

  if (routing.connectionId) {
    // SELECT 1: filter by connection_id.
    return all.filter(c => c.connection_id === routing.connectionId);
  }

  if (routing.sourceHandleId) {
    // YES_NO: source_handle_id = button outputValue.
    // Match directly, then try legacy "yes"/"no" handles, then condition field.
    const handle = routing.sourceHandleId;
    const matched = all.filter(c =>
      c.source_handle_id === handle ||
      (handle === 'true' && c.source_handle_id === 'yes') ||
      (handle === 'false' && c.source_handle_id === 'no') ||
      (c.condition && c.condition.toLowerCase() === handle.toLowerCase()),
    );
    if (matched.length > 0) return matched;
    // Last resort: condition "True"/"False" for legacy test fixtures.
    return all.filter(c => c.condition?.toLowerCase() === handle.toLowerCase());
  }

  if (routing.conditionValue) {
    // button_press (USER_INTERACTION): filter by condition, allow unconditional passthrough.
    const val = routing.conditionValue;
    return all.filter(c =>
      (!routing.excludeUnconditional && !c.condition) ||
      c.condition === val ||
      c.condition?.toLowerCase() === val.toLowerCase(),
    );
  }

  return all;
}

/**
 * Materialize ONE routed target's row (insert READY, or — cycle re-entry, reference
 * engine.ts:1067-1072 — reset an existing COMPLETED row back to READY and clear its stored
 * routing context) and, unless it's already active (a live park/executing row — no re-entry),
 * IMMEDIATELY attempt its resource gate and run its own activation. This eager "materialize
 * THEN activate, in the same call" is the Task 13 fix: the pre-Task-13 version only inserted
 * the row and left activation to a LATER, separate processReadyStep pickup — which is exactly
 * what let a WAIT ALL's pre-activation sweep (or arrival check) see a freshly-routed SIBLING as
 * merely "routed" rather than "genuinely started", producing traces the reference's own eager
 * `activateStep` (engine.ts:1066-1082, called synchronously as part of routing, never deferred)
 * never produces. See drainCascade's doc comment for the full fixture-level derivation.
 */
async function materializeAndActivate(
  tx: Db, context: WorkflowContext, stepOid: string, stepDef: MasterWorkflowStep, deps: EngineDeps,
): Promise<{ settled: boolean; completed: boolean }> {
  if (context.dead) return { settled: false, completed: false }; // torn-down subtree (spec §3.3)
  const [existing] = await tx.select().from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, stepOid)));

  let target: { id: string; stepOid: string };
  if (existing) {
    if (existing.state === 'WAITING_GATE') {
      const armed = context.root.state.armedGates[stepOid];
      if (armed?.open) {
        // GATE spec §5.3.4: the predecessor's terminal routed into an ALREADY-OPEN armed
        // gate — complete it now; the BFS wave routes its successors next.
        delete context.root.state.armedGates[stepOid];
        await context.recordTrace(tx, stepOid, 'COMPLETED');
        await tx.update(stepInstance).set({
          state: 'COMPLETED', completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
        }).where(eq(stepInstance.id, existing.id));
        return { settled: false, completed: true };
      }
      // Closed armed gate: the live row deliberately HOLDS progress (§5.3.4) — the gate
      // keeps cycling and completes itself on a later TRUE.
      return { settled: false, completed: false };
    }
    if (existing.state !== 'COMPLETED') {
      return { settled: false, completed: false }; // already active — no re-entry onto a live step
    }
    delete context.state.routingContext[stepOid];
    // wakeAt/actionInstanceId/actionServerUri: null (Task 15 review fix, Critical 2 — defense
    // in depth). The needsUserAction park code (runStepActivation) that normally runs right
    // after this reset already wipes these three for an ACTION PROXY cycle re-entry, but a
    // step that ALSO declares resource_command_specifications can block here BEFORE reaching
    // that code (the resource-gate check right below, in the caller) and leave the row parked
    // at READY with the PREVIOUS run's now-stale action-server bookkeeping until its resources
    // free up — clearing it here too means that interim state is never wrong, not just
    // eventually self-correcting.
    // startedAt: null (spec 2026-10-27 §6) — every park path sets it afresh, but a re-entered
    // step that finishes without parking (a gate that opens at once, a repeating SCRIPT done on
    // its first pass) would otherwise record this run with the PREVIOUS run's start time.
    await tx.update(stepInstance).set({
      state: 'READY', completedAt: null, error: null, startedAt: null, updatedAt: deps.now(),
      wakeAt: null, actionInstanceId: null, actionServerUri: null, actionInvokedOid: null,
    }).where(eq(stepInstance.id, existing.id));
    target = { id: existing.id, stepOid };
  } else {
    const [inserted] = await tx.insert(stepInstance).values({
      workflowInstanceId: context.id, nodeOid: context.spec.oid, stepOid,
      stepType: canonicalStepType(stepDef.step_type), state: 'READY',
      createdAt: deps.now(), updatedAt: deps.now(),
    }).returning();
    target = { id: inserted.id, stepOid };
  }

  if (stepDef.resource_command_specifications?.length) {
    const granted = tryActivateResources(context, stepOid, stepDef.resource_command_specifications);
    if (!granted) {
      await context.recordTrace(tx, stepOid, 'WAITING');
      // I3-style defensive flush (mirrors processReadyStep's own fix, below): an activation
      // list can grant EARLIER commands before a LATER one blocks; nothing else revisits a
      // stray grant under this eager model, so flush right here too.
      const { settled } = await resumeGrantedSteps(tx, context, deps);
      return { settled, completed: false }; // blocked — row stays READY (queue-state convention)
    }
  }

  return await runStepActivation(tx, context, target, stepDef, deps);
}

/**
 * BFS-cascade a batch of just-completed step oids' outgoing routing — a faithful port of the
 * reference's `drainCompletionQueue` (engine.ts:773-801), replacing the pre-Task-13 recursive/
 * depth-first `routeSuccessors` + `activateSuccessorStep` pair.
 *
 * WHY THIS EXISTS (Task 13 fix, task-13-brief.md's exec-parallel-* failures): the reference is
 * fully synchronous per WorkflowEngine — routing a step's successors calls `activateStep`
 * INLINE for each one (auto-completing types run to completion immediately and get requeued for
 * THEIR OWN routing; park types record EXECUTING immediately) — and `activatePendingWaitAlls`
 * runs exactly ONCE per `drainCompletionQueue()` call, after ALL of that cascading is done, not
 * once per individual completion.
 *
 * SHARED QUEUE (Task 13 post-review, I1 fix): `completionQueue` is a PERSISTENT INSTANCE FIELD
 * on the reference's WorkflowEngine (`context.cascadeQueue` here — see context.ts's doc comment
 * on that field), not a value created fresh per `drainCompletionQueue()` call. A nested,
 * re-entrant trigger for the SAME context — `completeChildWorkflow`'s post-completion routing,
 * a RETURN handler's re-activation (returnComplete/returnGoto/returnRetry/returnRestart), or a
 * resource grant's resumption — can fire WHILE an outer `drainCascade` call for that exact
 * context is still mid-flight (several stack frames up, itself in the middle of iterating one
 * dequeued step's own outgoing connections). The pre-fix version gave each such nested call a
 * FRESH local queue, isolated from whatever the outer call had already queued but not yet
 * processed — which silently REORDERED processing relative to the reference (proven: on
 * START -> PARALLEL -> {a -> a2, proxy(child) -> x2} -> WAIT ALL -> END, the fresh-queue version
 * emitted an extra `wa:EXECUTING` and processed a2 after x2 instead of before, because the
 * nested completeChildWorkflow-triggered drain never saw 'a' — already queued by the OUTER
 * call's own PARALLEL-fan-out iteration — sitting right there waiting its turn). This function
 * now appends to and drains `context.cascadeQueue` directly; `cascadeDraining` detects
 * re-entrancy — a nested call for a context ALREADY being drained just appends and returns
 * `false`, trusting the active outer loop (reading the SAME array) to pick the new items up on
 * its very next iteration, exactly like the reference's own re-entrant `drainCompletionQueue()`
 * calls draining the SAME `this.completionQueue`. A DIFFERENT context (e.g. a child's own view,
 * entered via `activateWorkflowProxy`) is a genuinely separate queue — cross-context cascades
 * are never shared, matching each child's own independent `completionQueue` field in the
 * reference.
 *
 * DEQUEUE-TIME RELEASE (Task 13 post-review, I2 fix): the reference runs
 * `processReleaseCommands` + `resumeGrantedSteps` at the top of EACH dequeue (engine.ts:775-781)
 * — AFTER every sibling from the wave that queued this step already had its own first
 * activation attempt — never at the moment the step itself completed (which, for an
 * auto-completing step, happens while STILL processing a PREDECESSOR's own outgoing-connection
 * loop, before any of that predecessor's OTHER siblings get their turn). The pre-fix version ran
 * release+resume immediately in `finishStep`, at completion time — proven wrong on
 * res-binary-002 (two PARALLEL siblings racing for the same binary-exclusive lock): the WINNING
 * branch's release fired before its SIBLING's own Acquire attempt (processed later in the SAME
 * predecessor's outgoing loop) ever got a chance to contest the lock, so the port never recorded
 * the sibling's `WAITING` trace entry the reference always does. `finishStep` no longer touches
 * resources at all; this loop does it for every dequeued item, seed or cascaded alike.
 *
 * Mechanics: `context.cascadeQueue` holds oids of steps that just COMPLETED and need their OWN
 * outgoing connections routed (mirrors `completionQueue`). For each dequeued step: release its
 * own resource completion commands and resume anything they unblock; then route each outgoing
 * connection — a WAIT ALL target goes through `waitAllArrival` (pushing its oid back onto the
 * queue if it just joined); anything else is materialized + eagerly activated via
 * `materializeAndActivate` (pushing its oid onto the queue if IT auto-completed, and counting
 * against `MAX_CASCADE_ACTIVATIONS` — I3 fix). Once the queue drains, `sweepPendingWaitAlls`
 * runs exactly once; if it satisfies any WAIT ALL on the spot, those oids seed the NEXT outer
 * iteration (a deliberate correctness improvement over a reference quirk — see
 * sweepPendingWaitAlls' own doc comment).
 *
 * Returns true iff the cascade settled the WHOLE instance (a SCRIPT failure via failStep, or a
 * RETURN dispatch that aborts/errors) — callers must stop immediately in that case, same
 * contract as every other "settled" signal in this file (C1). A DEFERRED (re-entrant) call
 * always returns `false` regardless of what the queued items eventually do — the ACTIVE outer
 * call is the one that will discover and propagate a later settle, since it owns the loop that
 * actually processes them; nothing downstream of a deferred call needs that answer any sooner
 * (see the doc comment on context.cascadeDraining).
 */
export async function drainCascade(tx: Db, context: WorkflowContext, seed: string[], deps: EngineDeps): Promise<boolean> {
  context.cascadeQueue.push(...seed);
  if (context.cascadeDraining) {
    return false; // re-entrant: an outer drain for THIS context is already active on the call stack
  }
  context.cascadeDraining = true;
  try {
    for (;;) {
      if (context.dead) { context.cascadeQueue.length = 0; return false; }
      while (context.cascadeQueue.length > 0) {
        if (context.dead) { context.cascadeQueue.length = 0; return false; }
        const stepOid = context.cascadeQueue.shift()!;

        // I2 fix: release + resume run at DEQUEUE time (see the header comment above), for
        // EVERY dequeued item — the seed itself included, exactly like any cascaded one.
        const dequeuedDef = context.spec.steps.find(s => s.oid === stepOid);
        if (dequeuedDef?.resource_command_specifications?.length) {
          // Final-review fix (see EngineState.releasedOnCatch): skip the release — ONLY the
          // release — for a step whose completion commands already ran at CATCH time
          // (release_on_catch). RETURN COMPLETE re-seeds the original trigger here, and running
          // its Release a second time against a single acquire corrupts pool state under
          // contention. The marker is consumed (deleted) on this one dequeue, so a later,
          // genuinely new acquire+complete cycle for the same step releases normally.
          // `resumeGrantedSteps` still runs unconditionally: it flushes ANY pending grant, not
          // just ones this step's release produced (e.g. a sibling's Send earlier in the same
          // wave — see materializeAndActivate's and processReadyStep's own defensive flushes),
          // and it is a free no-op when the grant list is empty.
          if (context.state.releasedOnCatch[stepOid]) {
            delete context.state.releasedOnCatch[stepOid];
          } else {
            releaseResourceCompletionCommands(context, stepOid, dequeuedDef.resource_command_specifications);
          }
          const { settled } = await resumeGrantedSteps(tx, context, deps);
          if (settled) return true;
        }

        const outgoing = getRoutedConnections(context, stepOid);
        for (const conn of outgoing) {
          if (context.dead) break; // this dequeued step's own routing died mid-iteration
          const stepDef = context.spec.steps.find(s => s.oid === conn.to_step_id);
          if (!stepDef) continue; // dangling target — the validator rejects this before instance start

          if (canonicalStepType(stepDef.step_type) === 'WAIT ALL') {
            const justCompleted = await waitAllArrival(tx, context, stepDef, stepOid, deps);
            if (justCompleted) context.cascadeQueue.push(stepDef.oid);
          } else {
            // I3 fix: bound total activations for this WHOLE transaction (shared via
            // context.root, so a cycle confined to a child context is still capped).
            if (context.root.cascadeActivationCount >= MAX_CASCADE_ACTIVATIONS) {
              throw new CascadeExceededError(MAX_CASCADE_ACTIVATIONS);
            }
            context.root.cascadeActivationCount++;
            const result = await materializeAndActivate(tx, context, conn.to_step_id, stepDef, deps);
            if (result.settled) return true;
            if (result.completed) context.cascadeQueue.push(conn.to_step_id);
          }
        }
      }
      // Fix round 1: the inner while can drain to EMPTY (rather than hitting its own guard) on a
      // context that died mid-iteration — reached in practice by the escalation-mid-cascade case —
      // so the sweep needs its own guard, not just the top-of-outer-loop one. A dead context must
      // never seed a WAIT ALL row for a branch that no longer exists (spec §3.3).
      if (context.dead) { context.cascadeQueue.length = 0; return false; }
      const swept = await sweepPendingWaitAlls(tx, context, deps);
      if (swept.length === 0) break;
      context.cascadeQueue.push(...swept);
    }
    return false;
  } finally {
    context.cascadeDraining = false;
  }
}

/** Activate ONE fresh target directly — not "route the successors of a just-completed step"
 *  (that's drainCascade's job) but "this exact target needs activating right now": GOTO/RETRY's
 *  direct re-entry, or a failStep-armed CATCH's entry point. Continues the cascade if the
 *  target itself completes. Returns settled. */
async function activateAndCascade(
  tx: Db, context: WorkflowContext, targetOid: string, sourceOid: string, deps: EngineDeps,
): Promise<boolean> {
  const stepDef = context.spec.steps.find(s => s.oid === targetOid);
  if (!stepDef) return false; // dangling target — validator-guarded, defensive no-op

  if (canonicalStepType(stepDef.step_type) === 'WAIT ALL') {
    const justCompleted = await waitAllArrival(tx, context, stepDef, sourceOid, deps);
    if (!justCompleted) return false;
    return await drainCascade(tx, context, [stepDef.oid], deps);
  }

  const result = await materializeAndActivate(tx, context, targetOid, stepDef, deps);
  if (result.settled) return true;
  if (result.completed) return await drainCascade(tx, context, [targetOid], deps);
  return false;
}

/** Workflow-completion check, transcribed from reference engine.ts:1572 checkWorkflowCompletion:
 *  complete when at least one END step of the ROOT workflow has reached COMPLETED and no
 *  step_instance row for the instance is left in a non-terminal state
 *  (READY/EXECUTING/WAITING_ACTION/WAITING_USER/PAUSED). A child's END never counts: in the
 *  reference each child runs in its own engine, so its END is not among the parent's steps. Here
 *  child rows share the instance, and a child that finishes inside its proxy's activation
 *  settles before the parent's next step has a row, so an unscoped END check settled the whole
 *  run 'completed' with that step about to wait for an operator (isChildComplete scopes the
 *  same way). */
export async function isWorkflowComplete(tx: Db, instanceId: string, rootOid: string): Promise<boolean> {
  const rows = await tx.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  const anyEndCompleted = rows.some(r => r.nodeOid === rootOid && r.stepType === 'END' && r.state === 'COMPLETED');
  if (!anyEndCompleted) return false;
  return !rows.some(r => !TERMINAL_STEP_STATES.has(r.state));
}

/** Task 16 (spec §7's Stop paragraph): the exact queue states an orderly stop waits out —
 *  WAITING_ACTION/PAUSED (an action step whose terminal hasn't arrived yet, or a WORKFLOW PROXY
 *  proxy row whose child is still running) and EXECUTING (a parked WAIT ALL join that will never
 *  be satisfied once dispatch is frozen — a "command-less" active step with no corresponding
 *  network command to send; its own escape hatch is that abort is legal from stopping). Checked
 *  across the WHOLE instance regardless of node_oid — a nested child context's own active rows
 *  count identically, since the entire tree must quiesce before an orderly stop can settle. */
export const STOP_ACTIVE_STEP_STATES = ['WAITING_ACTION', 'PAUSED', 'EXECUTING'];

export async function hasActiveSteps(tx: Db, instanceId: string): Promise<boolean> {
  const rows = await tx.select({ id: stepInstance.id }).from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, instanceId),
    inArray(stepInstance.state, STOP_ACTIVE_STEP_STATES),
  )).limit(1);
  return rows.length > 0;
}

/** Task 16: called both by control.ts's own stopping pass (after issuing STOP commands to every
 *  supporting in-flight action) and by monitor.ts's applyActionTerminal (the stopDrain path,
 *  right after honestly recording one action step's terminal during an orderly stop) —
 *  whichever caller happens to observe the LAST active step reach a terminal is the one that
 *  settles the instance 'stopped'. Returns whether it settled. */
export async function settleStoppedIfDrained(tx: Db, context: WorkflowContext, deps: EngineDeps): Promise<boolean> {
  if (await hasActiveSteps(tx, context.id)) return false;
  await settleTerminal(tx, context, 'stopped', 'stopped', deps.now, 'stopping');
  return true;
}

// ── TRY/CATCH/RETURN failure routing (reference engine.ts:262-441) ──
//
// LAZY MATERIALIZATION ADAPTATION (applies to every function below): the reference's
// StepInstance always exists in memory with a StepState that includes 'IDLE' — "not currently
// doing anything" is a real state value. Our step_instance.state CHECK constraint has no IDLE
// value (ENGINE_STEP_STATES = READY/EXECUTING/WAITING_ACTION/WAITING_USER/PAUSED/COMPLETED/
// ERRORED/ABORTED/CANCELLED — see mission-control-db's execution.ts), and per the lazy-
// materialization convention established in Tasks 9-10, a step with no row IS the IDLE
// equivalent (rows only exist for steps that are READY or further along). So everywhere the
// reference "idles" a step (recordTrace(oid,'IDLE') + state='IDLE'), our port traces 'IDLE'
// (trace_entry.state has no CHECK constraint — the reference StepState vocabulary is used
// verbatim there) and then DELETES the row. Everywhere the reference "resets" a step
// (resetStep: idle + clear routingContext/pendingResources/stepParameterSnapshots/
// waitAllTracking), our port does the same idle-trace-then-delete plus clears the matching
// EngineState maps by oid.

// 'EXECUTING' included (post-Task-12 review, I1 fix): a parked WAIT ALL row's queue state is
// 'EXECUTING' (waitAllArrival/sweepPendingWaitAlls — the join hasn't been satisfied yet), not
// one of the queue-vocabulary park states. Omitting it here was cosmetic pre-Task-12 (ABANDON
// always settled the WHOLE instance regardless of row cleanup), but a CHILD-scoped ABANDON
// (Task 12) does NOT settle the instance — it leaves it running, so a surviving EXECUTING row
// (an uncleared parked WAIT ALL) permanently blocks isWorkflowComplete/isChildComplete from
// ever seeing "no non-terminal rows", stranding the instance forever.
// 'WAITING_GATE' included (GATE spec 2026-08-29 §5.7): a waiting gate is swept by
// returnAbandon/returnRestart exactly like any other active row — same reasoning as EXECUTING
// above, an uncleared parked gate would otherwise strand a CHILD-scoped ABANDON/RESTART forever.
// 'WAITING_PROPERTIES' included (spec 2026-09-04 §5.4.5): swept by returnAbandon/returnRestart
// like any other active row. (The sweep deletes the row after an IDLE trace and never calls the
// action server — safe for a row with no action instance.)
// 'WAITING_SCRIPT' included (spec 2026-10-13 §6.5): a waiting repeating script is swept like a waiting gate.
// (ACTIVE_ROW_STATES itself now lives in step-run.ts — spec 2026-10-27 — imported above, so this
// sweep, control.ts's ABORT sweep and the step-run records share one definition.)

// knownStepOids + envSweepTokens moved to context.ts (review round 2, Finding 2) — imported
// above. context.ts's autoReleaseEnvHoldings needed the identical mapping and transition.ts
// already imports findSpecByOid from context.ts, so that is the one import direction that
// doesn't create a cycle; a second hand-copied definition here would be exactly the drift pair
// their own doc comments (see context.ts) warn against.

/** Reference engine.ts:637 releaseAllResources: cancel queued waiters + discard pending
 *  grants. Pool state itself (already-acquired locks/pool amounts) is untouched — per the
 *  reference's own comment, there is no per-holder tracking, so an abort cannot know what to
 *  release; that stays the workflow author's responsibility. Used by ABANDON and RESTART. The
 *  narrower uncaught-failure path (below) only cancels queued waiters, matching the
 *  reference's own narrower call there.
 *
 *  Task 4 (Ruling A): also sweeps the environment tier, over the SAME known-oid set mapped
 *  through envToken — see envSweepTokens' own doc comment for why. Held units are untouched
 *  here either way (workflow or environment) — only a terminal settle auto-releases (Task 5).
 *
 *  Whole-branch review C2 (defence in depth): `known` is a PARAMETER now, defaulting to the old
 *  in-function `knownStepOids(context)` call. Both ABANDON and RESTART tear their active children
 *  down BEFORE calling this, and knownStepOids walks `state.childActive` — the very links
 *  tearDownActiveChild deletes — so computing it here saw a subtree that no longer existed and
 *  swept nothing for it. Callers now snapshot it FIRST and pass it in, exactly as
 *  escalateChildFailure has always done. */
function releaseAllInstanceResources(context: WorkflowContext, known: Set<string> = knownStepOids(context)): void {
  if (context.resources) {
    context.resources.cancelQueuedWaiters(known);
    context.resources.flushGranted(known);
  }
  if (context.root.envResources) {
    const envKnown = envSweepTokens(context.root.id, known);
    // Post-Task-5 review (Critical fix): capture this branch's still-outstanding environment
    // reservations BEFORE the cancel sweep (which would otherwise clear them unrecoverably —
    // see captureEnvReservations' own doc comment), then release them back through the manager
    // AFTER the sweep has cleared this branch's own queue entries, so the FIFO grant pass can
    // only ever hand the freed capacity to a genuinely foreign waiter.
    const reservations = captureEnvReservations(context.root, envKnown);
    context.root.envResources.cancelQueuedWaiters(envKnown);
    releaseEnvReservations(context.root, reservations);
  }
}

function buildPartition(context: WorkflowContext) {
  return partitionCatchNetworks(
    context.spec.steps.map(s => ({ oid: s.oid, step_type: canonicalStepType(s.step_type), catch_id: s.catch_id })),
    context.spec.connections.map(c => ({ from_step_id: c.from_step_id, to_step_id: c.to_step_id })),
  );
}

/** Reference engine.ts:306 findCatchByCatchId. */
function findCatchByCatchId(context: WorkflowContext, catchId: string): MasterWorkflowStep | undefined {
  return context.spec.steps.find(s => canonicalStepType(s.step_type) === 'CATCH' && s.catch_id === catchId);
}

/** Reference engine.ts:319 findActiveCatchForReturn: which (if any) currently-active CATCH's
 *  network contains this RETURN step — via partitionCatchNetworks' BFS-closure-from-CATCH,
 *  same helper the validator already uses for its topology checks (spec §6.5). Returns the
 *  CATCH step's oid (the activeCatches map's key), not its catch_id. */
function findActiveCatchForReturn(context: WorkflowContext, returnStepOid: string): string | undefined {
  const partition = buildPartition(context);
  for (const [catchId, net] of partition.networksByCatchId) {
    if (!net.has(returnStepOid)) continue;
    const catchStep = findCatchByCatchId(context, catchId);
    if (catchStep && context.state.activeCatches[catchStep.oid]) return catchStep.oid;
  }
  return undefined;
}

/** Reference engine.ts:330 cleanupCatchNetwork: idle every step in the catch's network (CATCH
 *  through RETURN and anything between) so a LATER failure with the same catch_id starts from
 *  a virgin network rather than tripping over stale COMPLETED rows. Deliberately narrow — no
 *  EngineState map clearing (the reference's own cleanupCatchNetwork doesn't call resetStep,
 *  just the bare idle-trace-if-not-already-idle) and idempotent by construction: a step whose
 *  row was already deleted (e.g. by returnRestart's own bulk reset, which runs first in the
 *  RESTART case) has nothing here to re-trace or re-delete. */
async function cleanupCatchNetwork(tx: Db, context: WorkflowContext, catchOid: string): Promise<void> {
  const catchStep = context.spec.steps.find(s => s.oid === catchOid);
  const cid = catchStep?.catch_id;
  if (!cid) return;
  const net = buildPartition(context).networksByCatchId.get(cid);
  if (!net || net.size === 0) return;
  const rows = await tx.select().from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, context.id),
    inArray(stepInstance.stepOid, [...net]),
  ));
  for (const row of rows) {
    // Spec 2026-10-27 §6.2: a still-active network step's run ends here (finished ones already
    // recorded theirs).
    if (ACTIVE_ROW_STATES.has(row.state)) await recordStepRun(tx, context, row.stepOid, 'cancelled');
    await context.recordTrace(tx, row.stepOid, 'IDLE');
    await tx.delete(stepInstance).where(eq(stepInstance.id, row.id));
  }
}

/** Clear every EngineState map entry scoped to the given step oids — routingContext,
 *  stepSnapshots, waitAll, blockedOnResources, childActive, releasedOnCatch, and any
 *  activeCatches keyed by one of these oids. Both call sites represent "what a freshly-constructed reference engine
 *  instance starts with: nothing" — returnRestart (this context's OWN steps, reference
 *  engine.ts:390) and activateWorkflowProxy's F2 fix, below (a re-activated child's OWN internal
 *  steps, since the reference builds a genuinely NEW WorkflowEngine — with fresh, empty maps —
 *  on every activation, not just a fresh PropertyStore). */
function clearStepScopedState(context: WorkflowContext, oids: Iterable<string>): void {
  const oidSet = new Set(oids);
  for (const oid of oidSet) {
    delete context.state.routingContext[oid];
    delete context.state.stepSnapshots[oid];
    delete context.state.waitAll[oid];
    delete context.state.blockedOnResources[oid];
    delete context.state.childActive[oid];
    delete context.state.releasedOnCatch[oid];
    delete context.state.armedGates[oid];
    delete context.state.scriptRuns[oid];
  }
  for (const catchOid of Object.keys(context.state.activeCatches)) {
    if (oidSet.has(catchOid)) delete context.state.activeCatches[catchOid];
  }
  // GATE spec 2026-08-29: also drop any armed-gate entry whose PREDECESSOR falls within this
  // scope — the predecessor is being torn down/reset out from under it. Map-only (unlike
  // resetStepIfExists's own sweep, review fix Important 1, which also CANCELs a still-live
  // swept gate row): every caller here (returnRestart's own bulk delete; escalateChildFailure/
  // activateWorkflowProxy's re-activation, both via tearDownActiveChild) already deletes every
  // step_instance row in this exact oid set BEFORE reaching this call, gate rows included, so
  // there is never a live orphaned row left behind for this sweep to need to touch.
  for (const [gateOid, entry] of Object.entries(context.state.armedGates)) {
    if (oidSet.has(entry.predecessorOid)) delete context.state.armedGates[gateOid];
  }
}

/**
 * Task 12 (I2 fix, post-review): recursively tear down an ACTIVE child spawned from
 * `parentStepOid` — mirrors the reference's resetStep deleting an activeChildEngines entry
 * wholesale (engine.ts:1560-1563), which drops the child engine — and everything nested under
 * it — in one shot. Deletes every step_instance row scoped to the child's own node_oid,
 * recursing FIRST into any of those rows' own active grandchildren (bottom-up teardown for
 * multi-level nesting), then drops the childActive link, the childProperties entry, and any
 * memoized view for that child oid (WorkflowContext#dropCachedView) so a later
 * contextForNode/findStep call in the SAME transaction can never resolve a torn-down child's
 * now-orphaned PropertyStore. No-op if `parentStepOid` has no active child. No IDLE trace for
 * the torn-down descendant rows (mirrors the reference's OWN silence about children here — it
 * just drops the map entry, no per-descendant-step trace either); the CALLER traces
 * `parentStepOid` itself IDLE separately. Shared by resetStepIfExists (GOTO/RETRY),
 * returnAbandon, and returnRestart — everywhere the reference's resetStep-family functions run.
 */
async function tearDownActiveChild(tx: Db, context: WorkflowContext, parentStepOid: string): Promise<void> {
  const childOid = context.state.childActive[parentStepOid];
  if (!childOid) return;

  const childRows = await tx.select({ id: stepInstance.id, stepOid: stepInstance.stepOid, state: stepInstance.state })
    .from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.nodeOid, childOid)));

  // Spec 2026-10-27 §6.2: every still-active descendant's run ends here, with no trace of its
  // own. Recorded bottom-up and BEFORE this level's childActive link is deleted — each run's
  // node path is walked through those links.
  for (const row of childRows) {
    await tearDownActiveChild(tx, context, row.stepOid); // recurse into any grandchild first
    if (ACTIVE_ROW_STATES.has(row.state)) await recordStepRun(tx, context.root, row.stepOid, 'cancelled');
  }
  delete context.state.childActive[parentStepOid];
  if (childRows.length > 0) {
    await tx.delete(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id),
      eq(stepInstance.nodeOid, childOid),
    ));
  }
  delete context.state.childProperties[childOid];
  context.dropCachedView(childOid);
}

/** Reference engine.ts:1550 resetStep, used by GOTO's backward-reset-if-not-IDLE and RETRY's
 *  reset-before-reactivate: idle-trace + delete the row (a no-op if none exists — already the
 *  IDLE equivalent) and drop this step's per-step tracking from every EngineState map —
 *  including (I2 fix) any active child/grandchild this step spawned. */
async function resetStepIfExists(tx: Db, context: WorkflowContext, oid: string, deps: EngineDeps): Promise<void> {
  const [existing] = await tx.select().from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, oid)));
  if (!existing) return;
  // Whole-branch review C2 (defence in depth): this site used to sweep NOTHING. A GOTO/RETRY onto
  // a WORKFLOW PROXY tears its whole child subtree down here, and a child step queued on a
  // resource leaves its token in the manager (and its wc_resource_waiter row in the registry)
  // behind — while the re-activation that follows calls clearStepScopedState, dropping the
  // blockedOnResources record that was the only thing able to consume a later grant. A foreign
  // release then reserves capacity for a step that no longer exists, resumeGrantedSteps drops the
  // unconsumable grant with a warning, and the resource wedges work-center-wide. Snapshot the
  // dying subtree's oids BEFORE tearDownActiveChild deletes the childActive link the walk needs,
  // then sweep exactly that subtree in both tiers — the same shape escalateChildFailure uses,
  // scoped to the child being dropped rather than to this whole context.
  const dyingChildOid = context.state.childActive[oid];
  const dyingKnown = dyingChildOid ? knownStepOidsUnder(context.root, dyingChildOid) : new Set<string>();
  await tearDownActiveChild(tx, context, oid);
  if (dyingKnown.size > 0) {
    const root = context.root;
    if (root.resources) {
      root.resources.cancelQueuedWaiters(dyingKnown);
      root.resources.flushGranted(dyingKnown);
    }
    if (root.envResources) {
      const envDyingKnown = envSweepTokens(root.id, dyingKnown);
      // Capture before the cancel sweep, release after it — see captureEnvReservations' own doc
      // comment for why that order is the one that neither loses nor self-grants a reservation.
      const reservations = captureEnvReservations(root, envDyingKnown);
      root.envResources.cancelQueuedWaiters(envDyingKnown);
      releaseEnvReservations(root, reservations);
    }
  }
  if (ACTIVE_ROW_STATES.has(existing.state)) await recordStepRun(tx, context, oid, 'cancelled'); // spec 2026-10-27 §6.2
  await context.recordTrace(tx, oid, 'IDLE');
  await tx.delete(stepInstance).where(eq(stepInstance.id, existing.id));
  delete context.state.routingContext[oid];
  delete context.state.stepSnapshots[oid];
  delete context.state.waitAll[oid];
  delete context.state.blockedOnResources[oid];
  delete context.state.releasedOnCatch[oid]; // final-review fix — see EngineState.releasedOnCatch
  // GATE spec 2026-08-29: drop this step's own armed-gate entry AND any entry that
  // paired a gate to it as predecessor (the gate is being reset out from under it).
  delete context.state.armedGates[oid];
  delete context.state.scriptRuns[oid]; // a re-entered repeating script starts with fresh state
  for (const [gateOid, entry] of Object.entries(context.state.armedGates)) {
    if (entry.predecessorOid !== oid) continue;
    delete context.state.armedGates[gateOid];
    // Review fix (Important 1): the swept gate's OWN row is NOT deleted above (only `oid`'s
    // row is) — if it's still LIVE (WAITING_GATE), CANCEL it here too. Without this, a still-
    // live gate silently degrades to an ordinary (un-armed) gate that can open and cascade
    // downstream while the predecessor keeps running, then complete a SECOND time when that
    // predecessor's own terminal later routes through — leaving it CANCELLED instead means
    // the fixed armGateStep (Critical 1) cleanly re-arms it fresh on the predecessor's re-park.
    const [gateRow] = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, gateOid)));
    if (gateRow && gateRow.state === 'WAITING_GATE') {
      await recordStepRun(tx, context, gateOid, 'cancelled'); // spec 2026-10-27 §6.2
      await tx.update(stepInstance).set({ state: 'CANCELLED', wakeAt: null, updatedAt: deps.now() })
        .where(eq(stepInstance.id, gateRow.id));
    }
  }
}

/** Reference engine.ts:381 returnAbandon: idle-and-delete every currently ACTIVE step (our
 *  WAITING_ACTION/WAITING_USER/PAUSED row states — the queue-state analog of the reference's
 *  ACTIVE_STEP_STATES), cancel every queued-but-not-yet-run READY row (our analog of clearing
 *  the reference's in-memory completionQueue — CANCELLED, not deleted, so the cancellation
 *  itself is visible in history), and release resources. No EngineState map clearing (matches
 *  the reference: returnAbandon does NOT call resetStep) — the instance is about to be
 *  settled terminal by the caller, so nothing will read those maps again. */
async function returnAbandon(tx: Db, context: WorkflowContext, deps: EngineDeps): Promise<void> {
  // Task 12: scoped to THIS context's own rows (node_oid) — reference returnAbandon only ever
  // sweeps `this.steps` (whichever engine — root or child — is running the ABANDON), never a
  // sibling/ancestor's. Pre-Task-12 every row belonged to the root anyway, so this is a no-op
  // change for existing (root-only) callers.
  const rows = await tx.select().from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, context.id),
    eq(stepInstance.nodeOid, context.spec.oid),
  ));
  // Whole-branch review C2: snapshot the sweep set BEFORE the teardown loop below deletes the
  // childActive links knownStepOids walks — otherwise an active child's queued resource tokens
  // are invisible to the sweep that follows (escalateChildFailure already does exactly this).
  const known = knownStepOids(context);
  for (const row of rows) {
    if (ACTIVE_ROW_STATES.has(row.state)) {
      await tearDownActiveChild(tx, context, row.stepOid); // I2 fix: drop any active child/grandchild
      await recordStepRun(tx, context, row.stepOid, 'cancelled'); // spec 2026-10-27 §6.2
      await context.recordTrace(tx, row.stepOid, 'IDLE');
      await tx.delete(stepInstance).where(eq(stepInstance.id, row.id));
    } else if (row.state === 'READY') {
      await tx.update(stepInstance).set({ state: 'CANCELLED', updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
    }
  }
  releaseAllInstanceResources(context, known);
}

/** Reference engine.ts:390 returnRestart: full workflow-global teardown (every step idled and
 *  deleted — trace stays append-only, only the LIVE row goes away), every EngineState map
 *  cleared, resources released, and — CLEAN only — Value Properties re-initialised to their
 *  declared defaults (the same call the ctor/startInstanceFromQueued uses). Then re-fires
 *  START exactly as startInstanceFromQueued does: trace it COMPLETED (it never gets a row of
 *  its own) and drain its cascade (Task 13: via drainCascade, same as every other START).
 *
 *  Task 12: "workflow-global" is scoped to THIS context's OWN spec — reference returnRestart
 *  only ever tears down `this.steps`/`this.workflow` (whichever single engine — root or child —
 *  is running the RESTART), never a sibling/ancestor's. Row select/delete is filtered by
 *  node_oid, and the EngineState map clears are filtered to keys belonging to this spec's own
 *  steps (rather than the old blanket `= {}`) — for a root-only instance (every task before
 *  this one) every row/key already belonged to the root, so this is behavior-preserving; it
 *  only changes anything once a child context exists. I2 fix (post-review): an active
 *  grandchild spawned from one of THIS spec's own steps is now recursively torn down
 *  (tearDownActiveChild) — rows, childActive link, childProperties entry, and cached view all
 *  dropped — rather than left as orphaned rows the instance can never complete around, and
 *  (KEEP or CLEAN either way) a step re-parked on RESTART re-enters with a genuinely FRESH
 *  child on its next WORKFLOW PROXY activation, never a stale row surviving from a prior
 *  attempt.
 *
 *  Returns settled (Task 13): true iff the re-fired START's own cascade settled the whole
 *  instance (an uncaught SCRIPT failure immediately on restart, or similar) — see
 *  dispatchReturn's tail for why a redundant persist+settleTerminal('aborted') afterward is
 *  always safe regardless of origin. */
async function returnRestart(tx: Db, context: WorkflowContext, deps: EngineDeps, mode: 'CLEAN' | 'KEEP'): Promise<boolean> {
  const rows = await tx.select({ id: stepInstance.id, stepOid: stepInstance.stepOid, state: stepInstance.state })
    .from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id),
      eq(stepInstance.nodeOid, context.spec.oid),
    ));
  // Whole-branch review C2: snapshot BEFORE the teardown loop — see returnAbandon's own comment.
  const known = knownStepOids(context);
  for (const row of rows) {
    await tearDownActiveChild(tx, context, row.stepOid); // I2 fix: drop any active child/grandchild
    if (ACTIVE_ROW_STATES.has(row.state)) await recordStepRun(tx, context, row.stepOid, 'cancelled'); // spec 2026-10-27 §6.2
    await context.recordTrace(tx, row.stepOid, 'IDLE');
  }
  if (rows.length > 0) {
    await tx.delete(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id),
      eq(stepInstance.nodeOid, context.spec.oid),
    ));
  }
  clearStepScopedState(context, context.spec.steps.map(s => s.oid));
  releaseAllInstanceResources(context, known);
  if (mode === 'CLEAN') context.props.initializeFromWorkflow(context.spec);

  const startStep = context.spec.steps.find(s => canonicalStepType(s.step_type) === 'START');
  if (startStep) {
    await context.recordTrace(tx, startStep.oid, 'COMPLETED');
    return await drainCascade(tx, context, [startStep.oid], deps);
  }
  return false;
}

/** Reference engine.ts:414 returnGoto: branch-local — reset the target if it isn't already
 *  idle-equivalent (a backward GOTO onto a COMPLETED/ERRORED/etc. step), then activate it and
 *  cascade. Every OTHER active branch is untouched (contrast with ABANDON/RESTART's
 *  workflow-global sweep). Returns settled. */
async function returnGoto(tx: Db, context: WorkflowContext, deps: EngineDeps, sourceOid: string, gotoOid: string): Promise<boolean> {
  if (!context.spec.steps.some(s => s.oid === gotoOid)) return false; // guarded by dispatchReturn's validation; defensive no-op
  await resetStepIfExists(tx, context, gotoOid, deps);
  return await activateAndCascade(tx, context, gotoOid, sourceOid, deps);
}

/** Reference engine.ts:420 returnRetry: reset the trigger step (normally already row-less —
 *  failStep deleted it when the catch first armed — but reset defensively, matching the
 *  reference's own `if (trigger.state !== 'IDLE')` guard) and re-activate + cascade it,
 *  re-invoking whatever parked/auto-completing logic it originally ran. Returns settled. */
async function returnRetry(tx: Db, context: WorkflowContext, deps: EngineDeps, sourceOid: string, ctx: CatchContext | undefined): Promise<boolean> {
  if (!ctx) return false;
  const triggerOid = ctx.trigger_step_oid;
  if (!context.spec.steps.some(s => s.oid === triggerOid)) return false;
  await resetStepIfExists(tx, context, triggerOid, deps);
  return await activateAndCascade(tx, context, triggerOid, sourceOid, deps);
}

/** Reference engine.ts:434 returnComplete: force-complete the ORIGINAL trigger step (not the
 *  RETURN step) as if it had succeeded, and cascade its successors via drainCascade —
 *  branch-local, exactly like GOTO/RETRY: sibling branches that were never part of this catch
 *  network (e.g. other PARALLEL legs) are untouched.
 *
 *  RESOURCES (corrected, final review): this function itself runs none of the trigger's resource
 *  commands, but the `drainCascade` it seeds DOES — the Task-13 I2 fix releases every dequeued
 *  step's Release / Release Pool Amount commands at dequeue time, and the trigger is seeded
 *  straight into that queue here. So a trigger that still held a resource when it failed IS
 *  released, exactly as if it had completed normally. The one exception is the case where
 *  failStep ALREADY released it at catch time (`release_on_catch !== false`): that path records
 *  `EngineState.releasedOnCatch[trigger]`, which drainCascade consumes to skip its own release —
 *  net effect exactly ONE release per acquire either way. (The older comment here claimed
 *  returnComplete never processes the trigger's resource commands at all; that stopped being
 *  true when the release moved to dequeue time, and with release_on_catch it produced a genuine
 *  double release.)
 *
 *  The trigger's row is normally already gone (idled at catch time) so this typically inserts
 *  fresh; the existing-row branch is defensive symmetry with materializeAndActivate's own dual
 *  path. Returns settled. */
async function returnComplete(tx: Db, context: WorkflowContext, deps: EngineDeps, ctx: CatchContext | undefined): Promise<boolean> {
  if (!ctx) return false;
  const triggerOid = ctx.trigger_step_oid;
  const triggerDef = context.spec.steps.find(s => s.oid === triggerOid);
  if (!triggerDef) return false;
  await context.recordTrace(tx, triggerOid, 'COMPLETED');
  const [existing] = await tx.select().from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, triggerOid)));
  if (existing) {
    // wakeAt: null (Task 15 review fix, Critical 1) — defensive symmetry with the insert branch
    // below (which never sets one): this row is normally already gone by the time we get here
    // (idled+deleted when the catch first armed), but if it somehow still exists it could be an
    // ACTION PROXY trigger with a stale wake_at from before the failure.
    await tx.update(stepInstance).set({
      state: 'COMPLETED', completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
    }).where(eq(stepInstance.id, existing.id));
  } else {
    await tx.insert(stepInstance).values({
      workflowInstanceId: context.id, nodeOid: context.spec.oid, stepOid: triggerOid,
      stepType: canonicalStepType(triggerDef.step_type), state: 'COMPLETED',
      completedAt: deps.now(), createdAt: deps.now(), updatedAt: deps.now(),
    });
  }
  return await drainCascade(tx, context, [triggerOid], deps);
}

/** Mark a RETURN step ERRORED (defense-in-depth: validator.ts rejects a missing/unknown
 *  command or an unresolvable GOTO target at load, so this is unreachable for a workflow that
 *  actually passed validation — reference engine.ts:344-363's own comments make the same
 *  point) and settle the whole instance 'errored', so a malformed RETURN that somehow reaches
 *  the engine anyway can't strand the instance RUNNING forever with no active steps.
 *
 *  Task 12: that "settle the whole instance" behavior is ROOT-only. Reference submitAction
 *  (engine.ts:183-194) only ever notices a child's completion via `getWorkflowState() ===
 *  'COMPLETED'` — a child that errors is left running-but-stuck forever from the PARENT's
 *  point of view (its WORKFLOW PROXY step stays EXECUTING/WAITING_ACTION), never noticed, so
 *  it can never abort the whole outer instance. Replicated faithfully here rather than
 *  inventing better failure semantics the reference doesn't have: for a CHILD context, trace +
 *  error the RETURN's own row (that branch is dead) but do NOT persist/settleTerminal — return
 *  `false` so the caller's normal settleIfComplete tail runs instead, finds this child
 *  permanently incomplete (no END ever reached), and leaves the instance running. */
async function errorReturnStep(
  tx: Db, context: WorkflowContext, target: { id: string; stepOid: string }, deps: EngineDeps, reason: string,
): Promise<boolean> {
  await context.recordTrace(tx, target.stepOid, 'ERRORED', undefined, reason);
  await tx.update(stepInstance).set({
    state: 'ERRORED', error: reason, completedAt: deps.now(), updatedAt: deps.now(),
  }).where(eq(stepInstance.id, target.id));
  if (!context.isRoot) {
    return false;
  }
  await context.persist(tx);
  await settleTerminal(tx, context, 'errored', 'errored', deps.now);
  return true;
}

/**
 * Dispatch a RETURN step — reference engine.ts:340-441 dispatchReturn. Owns the RETURN step's
 * own terminal state entirely (COMPLETED for a valid command, ERRORED for an invalid one) and
 * never falls through to finishStep's generic release/route pipeline: a RETURN has no
 * resource commands of its own, and its "successors" are command-specific (a re-fired START,
 * a branch-local GOTO/RETRY target, or the ORIGINAL trigger's own successors for COMPLETE) —
 * never a plain outgoing-edge routing of the RETURN step itself (RETURN has 0 outgoing
 * connections per the validator's RETURN_WRONG_DEGREE check).
 *
 * Returns true iff this call already persisted context + settled the instance terminal
 * (ABANDON -> aborted; invalid command/target -> errored; OR — Task 13 — a nested cascade
 * triggered by RESTART/GOTO/RETRY/COMPLETE's own eager re-activation already settled it with
 * whatever status THAT determined) — same "settled" contract as failStep/finishStep: callers
 * must stop immediately, skipping their own isWorkflowComplete/persist/settleTerminal('completed')
 * check. False (RESTART/GOTO/RETRY/COMPLETE with no nested settle) means the instance is still
 * running — the caller's normal generic tail handles it, including the COMPLETE case
 * legitimately reaching END (exec-try-catch-008) via that SAME generic isWorkflowComplete
 * check, not a special case here.
 */
async function dispatchReturn(
  tx: Db,
  context: WorkflowContext,
  target: { id: string; stepOid: string },
  stepDef: MasterWorkflowStep,
  deps: EngineDeps,
): Promise<boolean> {
  const rc = stepDef.return_config;
  const VALID_COMMANDS = new Set(['ABANDON', 'RESTART', 'GOTO', 'RETRY', 'COMPLETE']);
  if (!rc || !rc.command || !VALID_COMMANDS.has(rc.command)) {
    const reason = rc?.command ? `RETURN has unknown command '${rc.command}'` : 'RETURN has no return_config';
    return await errorReturnStep(tx, context, target, deps, reason);
  }
  if (rc.command === 'GOTO' && (!rc.goto_step_oid || !context.spec.steps.some(s => s.oid === rc.goto_step_oid))) {
    const reason = `RETURN GOTO target not found: '${rc.goto_step_oid ?? 'none'}'`;
    return await errorReturnStep(tx, context, target, deps, reason);
  }

  await context.recordTrace(tx, target.stepOid, 'COMPLETED');
  await tx.update(stepInstance).set({
    state: 'COMPLETED', completedAt: deps.now(), updatedAt: deps.now(),
  }).where(eq(stepInstance.id, target.id));

  const catchOid = findActiveCatchForReturn(context, target.stepOid);
  const ctx = catchOid ? context.state.activeCatches[catchOid] : undefined;

  let settledTerminal = false;
  switch (rc.command) {
    case 'ABANDON':
      await returnAbandon(tx, context, deps);
      // Task 12: ABANDON inside a CHILD only aborts that branch (returnAbandon is already
      // scoped to this context's own node_oid) — see errorReturnStep's doc comment for why the
      // whole instance must NOT settle terminal in that case (faithful reference replication).
      settledTerminal = context.isRoot;
      break;
    case 'RESTART':
      settledTerminal = await returnRestart(tx, context, deps, rc.restart_mode ?? 'KEEP');
      break;
    case 'GOTO':
      settledTerminal = await returnGoto(tx, context, deps, target.stepOid, rc.goto_step_oid!);
      break;
    case 'RETRY':
      settledTerminal = await returnRetry(tx, context, deps, target.stepOid, ctx);
      break;
    case 'COMPLETE':
      settledTerminal = await returnComplete(tx, context, deps, ctx);
      break;
  }

  if (catchOid) {
    await cleanupCatchNetwork(tx, context, catchOid);
    delete context.state.activeCatches[catchOid];
  }

  if (settledTerminal) {
    // Covers BOTH origins safely: ABANDON's own genuine 'aborted' settle, and a nested cascade
    // (RESTART/GOTO/RETRY/COMPLETE re-activating a target whose OWN eager chain immediately hit
    // an uncaught failure or another RETURN) that already persisted + settled with its OWN
    // status — settleTerminal's first-terminal-wins guard (status='running') makes this second
    // call a safe no-op in that case, so one unconditional call here covers both without needing
    // to distinguish them.
    await context.persist(tx);
    await settleTerminal(tx, context, 'aborted', 'aborted', deps.now);
    return true;
  }
  return false;
}

/**
 * Spec 2026-08-22 §3.1 step 3 / §3.3: an uncaught failure inside a child context escalates —
 * tear the child branch down and re-raise the failure in the parent as a failure of the
 * WORKFLOW PROXY step that spawned the child (same mode; message wrapped with the child chain
 * detail, so multi-level escalation chains naturally). Returns the recursive failStep's own
 * settled result, or undefined when no childActive link / proxy row exists (defensive — the
 * caller falls back to the old dead-branch behavior).
 */
async function escalateChildFailure(
  tx: Db,
  context: WorkflowContext,
  stepDef: MasterWorkflowStep | undefined,
  mode: FailureMode,
  error: string | null,
  deps: EngineDeps,
): Promise<boolean | undefined> {
  const root = context.root;
  const proxyStepOid = Object.entries(root.state.childActive).find(([, v]) => v === context.spec.oid)?.[0];
  if (!proxyStepOid) return undefined;
  const found = root.findStep(proxyStepOid);
  if (!found) return undefined;
  const parentCtx = found.context;
  const [proxyRow] = await tx.select().from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, root.id),
    eq(stepInstance.stepOid, proxyStepOid),
  ));
  if (!proxyRow) return undefined;

  // Snapshot the dying subtree's oids BEFORE teardown — knownStepOids walks childActive
  // links, which tearDownActiveChild is about to delete.
  const childKnown = knownStepOids(context);

  // tearDownActiveChild recursively deletes the subtree's rows, childActive links,
  // childProperties, and cached views — dropCachedView marks each dropped view dead, which
  // stops any still-unwinding drainCascade over this subtree (spec §3.3).
  await tearDownActiveChild(tx, parentCtx, proxyStepOid);

  // Queued waiters + pending grants scoped to the dead subtree are discarded. Pool state is
  // untouched — no per-holder tracking (same posture as returnAbandon/returnRestart).
  if (root.resources) {
    root.resources.cancelQueuedWaiters(childKnown);
    root.resources.flushGranted(childKnown);
  }
  // Task 4 (Ruling A): the environment tier too — see envSweepTokens' own doc comment for why a
  // dead subtree's env waiters must be swept here just like its workflow-tier ones.
  if (root.envResources) {
    const envChildKnown = envSweepTokens(root.id, childKnown);
    // Post-Task-5 review (Critical fix): same capture-before-cancel, release-after-cancel
    // give-back as releaseAllInstanceResources — see captureEnvReservations' own doc comment.
    const reservations = captureEnvReservations(root, envChildKnown);
    root.envResources.cancelQueuedWaiters(envChildKnown);
    releaseEnvReservations(root, reservations);
  }
  clearStepScopedState(root, childKnown);
  root.state.deferredFailures = root.state.deferredFailures.filter(f => !childKnown.has(f.stepOid));
  root.state.deferredRouting = root.state.deferredRouting.filter(oid => !childKnown.has(oid));

  const wrapped =
    `Uncaught ${mode} in child workflow '${context.spec.local_id}' at step '${stepDef?.local_id ?? 'unknown'}'`
    + (error ? `: ${error}` : '');
  const settled = await failStep(tx, parentCtx, { id: proxyRow.id, stepOid: proxyStepOid }, mode, wrapped, deps);
  if (settled) return true;
  // The parent's catch network may have immediately re-completed the catching context (e.g.
  // RETURN COMPLETE cascading to its END) — check completion for the CATCHING context, since
  // our own caller only ever checks the (now-empty) child's.
  //
  // Fix round 1 (Critical): ONLY when the parent is not itself mid-drain. With an ACTIVE outer
  // drain on parentCtx, failStep's activateAndCascade is re-entrant (drainCascade appends and
  // returns — see context.cascadeDraining), so the catch network is merely QUEUED at this
  // instant, while the trigger proxy row has already been idled/deleted and the child subtree
  // torn down. isWorkflowComplete would then see "some END row COMPLETED (an EARLIER child's
  // END counts) + nothing non-terminal left" and settle the instance 'completed', stranding the
  // still-queued catch network inside a terminal instance. Mid-drain, the active outer drain's
  // OWN caller tail (processReadyStep / submit.ts / instance.ts, all of which run
  // settleIfComplete after drainCascade returns) is the correct — and already-existing — place
  // for this check, once the catch network has actually run.
  if (!parentCtx.cascadeDraining) {
    await settleIfComplete(tx, root, parentCtx.spec.oid, deps);
  }
  return false;
}

/**
 * Handle a step failure — a submitted 'fail' user action (submit.ts, `actionIndex` set) or an
 * engine-originated failure discovered mid-activation (SCRIPT's throw path in
 * runStepActivation, `actionIndex` undefined) — transcribed from reference engine.ts:262-303
 * handleStepFailure. Three outcomes:
 *   1. A matching TRY (by mode) — the step's own row, or (spec 2026-08-22) the enclosing spec's
 *      workflow-level row — whose CATCH is not already active: idle the trigger (trace
 *      IDLE with `actionIndex` — see the lazy-materialization note above the TRY/CATCH/RETURN
 *      section for why "idle" means DELETING the row here), register a CatchContext keyed by
 *      the CATCH step's oid, and eagerly activate + cascade the catch network's entry step
 *      (Task 13: via activateAndCascade, not a bare READY-row insert).
 *   2. CATCH_REENTRY (spec §6.4): the matching CATCH is already active (its RETURN hasn't
 *      dispatched yet — reachable in THIS engine when the catch network itself parks on a
 *      user-facing step before reaching RETURN, e.g. CATCH -> USER_INTERACTION -> RETURN) —
 *      abort the workflow rather than silently clobbering the in-flight CatchContext.
 *   3. No matching TRY at either tier: at the ROOT, the uncaught failure errors the workflow
 *      (mirrors the SCRIPT-error path runStepActivation already had before this task); inside a
 *      CHILD, it ESCALATES (spec 2026-08-22 §3.1 step 3 / D3 — escalateChildFailure below): the
 *      child branch is torn down and the failure is re-raised, same mode, as a failure of the
 *      parent's WORKFLOW PROXY step, which runs this same three-outcome logic one level up.
 *
 * Returns true iff this call already persisted context + settled the instance terminal
 * (CATCH_REENTRY -> aborted, uncaught -> errored, OR — Task 13 — the catch network's own eager
 * cascade settled it) — same "settled" contract as dispatchReturn/finishStep: callers must
 * stop immediately and skip their own isWorkflowComplete/persist/settleTerminal('completed')
 * check. False means a catch was armed and its cascade didn't itself settle the instance — the
 * caller's normal generic tail (isWorkflowComplete -> persist -> conditional settle) handles
 * it, exactly like any other non-terminal transition.
 */
export async function failStep(
  tx: Db,
  context: WorkflowContext,
  target: { id: string; stepOid: string },
  mode: FailureMode | undefined,
  error: string | null,
  deps: EngineDeps,
  actionIndex?: number,
): Promise<boolean> {
  const stepDef = context.spec.steps.find(s => s.oid === target.stepOid);

  // GATE spec §5.3.4: a failing step with an armed successor gate tears that gate down —
  // TRY/CATCH owns what happens next; the gate must not keep cycling or hold completion.
  delete context.root.state.armedGates[target.stepOid]; // a failing GATE clears its own entry
  delete context.root.state.scriptRuns[target.stepOid]; // …and a failing repeating SCRIPT its saved state
  for (const [gateOid, entry] of Object.entries(context.root.state.armedGates)) {
    if (entry.predecessorOid !== target.stepOid) continue;
    delete context.root.state.armedGates[gateOid];
    const [gateRow] = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, gateOid)));
    if (gateRow && gateRow.state === 'WAITING_GATE') {
      await recordStepRun(tx, context, gateOid, 'cancelled'); // spec 2026-10-27 §6.2
      await tx.update(stepInstance).set({ state: 'CANCELLED', wakeAt: null, updatedAt: deps.now() })
        .where(eq(stepInstance.id, gateRow.id));
    }
  }

  // Spec 2026-08-22 §3.1: two-tier lookup — the failing step's own TRY row first, then the
  // ENCLOSING spec's workflow-level row (a child consults its own rows, never the root's).
  // Defensive posture matches the old single-tier code: a row whose catch_id doesn't resolve
  // to a real CATCH here is skipped (the validator rejects that spec at instance start).
  let matching: TrySpecification | undefined;
  let catchStep: MasterWorkflowStep | undefined;
  if (mode) {
    for (const candidate of [
      stepDef?.try_specifications?.find(t => t.mode === mode),
      context.spec.try_specifications?.find(t => t.mode === mode),
    ]) {
      if (!candidate) continue;
      const cs = findCatchByCatchId(context, candidate.catch_id);
      if (cs) { matching = candidate; catchStep = cs; break; }
    }
  }

  if (mode && stepDef && matching && catchStep) {
    if (context.state.activeCatches[catchStep.oid]) {
      const reason = `CATCH_REENTRY on ${matching.catch_id}`;
      await context.recordTrace(tx, target.stepOid, 'ERRORED', actionIndex, reason);
      // wakeAt: null (Task 15 review fix, Critical 1) — see finishStep's own comment; this
      // branch can terminally error a genuine ACTION PROXY row (a second failure racing an
      // already-active catch), which must not leave a stale wake_at behind either.
      await tx.update(stepInstance).set({
        state: 'ERRORED', error: reason, completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
      }).where(eq(stepInstance.id, target.id));
      // Spec 2026-08-22 §3.5 (D8): re-entry aborts the instance uniformly — the old
      // child-context early-return (silent branch death) is gone. persist/settle go through
      // the ROOT: a view's persist() throws by design (context.ts).
      await context.root.persist(tx);
      await settleTerminal(tx, context.root, 'aborted', 'aborted', deps.now);
      return true;
    }

    context.state.activeCatches[catchStep.oid] = {
      catch_oid: catchStep.oid,
      trigger_step_oid: target.stepOid,
      trigger_step_name: stepDef.local_id,
      trigger_reason: mode,
      error_message: error,
      activated_at: deps.now().toISOString(),
    };

    // Spec 2026-08-22 §3.4 (D6): release_on_catch (absent = true) runs the failing step's
    // declared completion (Release / Release Pool Amount) commands before the catch network
    // activates — the resource model has no per-holder tracking, so the step's own declared
    // releases ARE the release semantics — then resumes whatever the freed capacity unblocks.
    if (matching.release_on_catch !== false && stepDef.resource_command_specifications?.length) {
      releaseResourceCompletionCommands(context, target.stepOid, stepDef.resource_command_specifications);
      // Final-review fix: record that THIS acquire's release is already spent, so drainCascade's
      // dequeue-time release skips it if the catch later force-completes this same step (RETURN
      // COMPLETE re-seeds the trigger — returnComplete). Persisted, because that RETURN can
      // dispatch in a LATER transaction when the catch network parks. Set BEFORE
      // resumeGrantedSteps so an early `settled` return still persists the marker with the
      // release it describes. See EngineState.releasedOnCatch.
      context.state.releasedOnCatch[target.stepOid] = true;
      const { settled: releaseSettled } = await resumeGrantedSteps(tx, context, deps);
      if (releaseSettled) return true;
    }

    // Deactivate the trigger step — caught, do NOT propagate. The failure is swallowed: no
    // ERRORED trace for the trigger itself, only IDLE (with the after_action index, so the CM
    // can still correlate this trace entry with the submitted action that caused it).
    // Spec 2026-10-27 §6.2: the run still ends here, as caught — recorded before the row goes.
    await recordStepRun(tx, context, target.stepOid, 'caught', error);
    await context.recordTrace(tx, target.stepOid, 'IDLE', actionIndex);
    await tx.delete(stepInstance).where(eq(stepInstance.id, target.id));
    delete context.state.blockedOnResources[target.stepOid];

    return await activateAndCascade(tx, context, catchStep.oid, target.stepOid, deps);
  }

  // Uncaught in THIS spec (step + workflow tiers both missed).
  await context.recordTrace(tx, target.stepOid, 'ERRORED', actionIndex, error ?? undefined);
  // wakeAt: null (Task 15 review fix, Critical 1) — see finishStep's own comment; an uncaught
  // ABORT/ERROR/TIMEOUT terminal applied to a genuine ACTION PROXY row (monitor.ts's
  // applyActionTerminal) must not leave a stale wake_at behind either.
  await tx.update(stepInstance).set({
    state: 'ERRORED', error: error ?? null, completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
  }).where(eq(stepInstance.id, target.id));
  delete context.state.blockedOnResources[target.stepOid];

  // Spec 2026-08-22 §3.1 step 3 (D3): inside a child, escalate — tear this child down and
  // re-raise as a failure of the parent's WORKFLOW PROXY step with the same mode. The
  // escalation does its own subtree-scoped waiter cancellation; the knownStepOids sweep below
  // is the ROOT-level (or defensive-fallback) path only.
  if (!context.isRoot && mode) {
    const escalated = await escalateChildFailure(tx, context, stepDef, mode, error, deps);
    if (escalated !== undefined) return escalated;
    // No childActive link / proxy row (defensive) — fall through to the old dead-branch shape.
  }

  const uncaughtKnown = knownStepOids(context);
  if (context.resources) {
    context.resources.cancelQueuedWaiters(uncaughtKnown);
  }
  // Task 4 (Ruling A): the environment tier too — same reasoning as releaseAllInstanceResources
  // (envSweepTokens' own doc comment). This site never called flushGranted for the WORKFLOW
  // tier (no per-holder tracking there either way, so nothing could be given back regardless).
  // Post-Task-5 review (Critical fix): the ENVIRONMENT tier's cancelQueuedWaiters call clears
  // pendingGrants for these tokens as a side effect even without an explicit flushGranted call
  // (resources.ts's own doc comment) — so this site had the identical unconsumed-reservation
  // leak as the other two despite never calling flushGranted itself. Same capture-before-cancel,
  // release-after-cancel give-back.
  if (context.root.envResources) {
    const envUncaughtKnown = envSweepTokens(context.root.id, uncaughtKnown);
    const reservations = captureEnvReservations(context.root, envUncaughtKnown);
    context.root.envResources.cancelQueuedWaiters(envUncaughtKnown);
    releaseEnvReservations(context.root, reservations);
  }
  if (!context.isRoot) {
    // Defensive only (mode undefined, or the childActive link is already gone): the old
    // pre-escalation behavior — this branch dies, the instance keeps running.
    return false;
  }
  await context.persist(tx);
  await settleTerminal(tx, context, 'errored', 'errored', deps.now);
  return true;
}

/** Complete a step that has already run its own type-specific logic: trace COMPLETED (with
 *  `afterAction` for a user-submitted completion) and flip the row. Task 13: no longer routes
 *  this step's own successors (that used to be a trailing `routeSuccessors` call) — every caller
 *  now explicitly continues via `drainCascade([target.stepOid])` once this returns, matching the
 *  reference's `completionQueue.push` (the step's OWN routing happens in the NEXT BFS wave, not
 *  recursively inline) rather than the old immediate-recursive shape. Task 13 post-review (I2
 *  fix): no longer releases this step's own resource completion commands either — that now
 *  happens at DEQUEUE time, inside `drainCascade`'s own loop, matching the reference's
 *  `processReleaseCommands`-at-dequeue timing exactly (see `drainCascade`'s doc comment for the
 *  proven res-binary-002 divergence this fixes). Shared by the auto-complete tail of
 *  runStepActivation, WORKFLOW PROXY's no-matching-child no-op, and submit.ts's user-action
 *  completion. */
export async function finishStep(
  tx: Db,
  context: WorkflowContext,
  target: { id: string; stepOid: string },
  stepDef: MasterWorkflowStep,
  deps: EngineDeps,
  afterAction?: number,
): Promise<boolean> {
  await context.recordTrace(tx, target.stepOid, 'COMPLETED', afterAction);
  await tx.update(stepInstance).set({
    // `wakeAt: null` (Task 15 review fix, Critical 1): this is the ONLY place an ACTION PROXY
    // row's own COMPLETED transition is recorded (via monitor.ts's applyActionTerminal) —
    // leaving a past `wake_at` on a terminal row means loop.ts's claimDueActionStep re-selects
    // it forever (its due-row query has no state filter of its own, by design — the state
    // machine's own invariant is supposed to be "no wake_at once terminal"), spinning a worker
    // slot at 100% CPU and starving every other instance behind it on the claim order.
    state: 'COMPLETED', completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
  }).where(eq(stepInstance.id, target.id));
  return false;
}

/** Complete a waiting step that has finished its own work — an open gate, a done repeating
 *  script: COMPLETED + cascade + settle-if-complete (the processReadyStep tail). Returns true
 *  iff the instance settled. */
export async function completeWaitingStep(
  tx: Db, context: WorkflowContext, stepCtx: WorkflowContext,
  target: { id: string; stepOid: string }, stepDef: MasterWorkflowStep,
  deps: EngineDeps, nodeOid: string,
): Promise<boolean> {
  const settledMid = await finishStep(tx, stepCtx, target, stepDef, deps);
  if (settledMid) return true;
  const cascadeSettled = await drainCascade(tx, stepCtx, [target.stepOid], deps);
  if (cascadeSettled) return true;
  await settleIfComplete(tx, context, nodeOid, deps);
  await context.persist(tx);
  return false;
}

/** Reference engine.ts:1149-1162: after a successful script, snapshot the values it wrote via
 *  output_parameter_specifications — keyed by spec id (not target), read back from the property
 *  store after the commit. Shared by the one-shot SCRIPT and every repeating-script completion. */
export function snapshotScriptOutputs(context: WorkflowContext, stepOid: string, stepDef: MasterWorkflowStep): void {
  const snapshot = context.state.stepSnapshots[stepOid];
  if (!snapshot || !stepDef.output_parameter_specifications) return;
  const outputParameters: Record<string, string> = { ...(snapshot.outputParameters ?? {}) };
  for (const spec of stepDef.output_parameter_specifications) {
    if (!spec.target) continue;
    const val = context.props.get(spec.target);
    if (val !== undefined) outputParameters[spec.id] = val;
  }
  snapshot.outputParameters = outputParameters;
}

/**
 * Repeating SCRIPT activation (spec 2026-10-13 §6.5): the first run happens here, inside the
 * activation transaction, exactly like a one-shot script. Done on the first run → commit and
 * complete (the one-shot shape: no EXECUTING row). Otherwise keep its state and pending
 * outputs, trace EXECUTING once (the park convention) and park WAITING_SCRIPT with started_at
 * = now (the time limit's anchor) and wake_at on the next cycle; the gate due-work unit
 * (gate.ts) runs it from then on. A script error, or state that is too big / not JSON, fails
 * the step (TRY/CATCH-capable).
 */
export async function activateRepeatingScript(
  tx: Db, context: WorkflowContext, target: { id: string; stepOid: string },
  stepDef: MasterWorkflowStep, deps: EngineDeps,
): Promise<{ settled: boolean; completed: boolean }> {
  const inputs = context.state.stepSnapshots[target.stepOid]?.inputParameters ?? {};
  const run = runRepeatingScript(stepDef, inputs, undefined, deps.config.scriptTimeoutMs);
  if (!run.success) {
    const settled = await failStep(tx, context, target, 'ERROR', run.error ?? null, deps);
    return { settled, completed: false };
  }
  if (run.done) {
    commitScriptOutputs(stepDef, context.props, run.output);
    snapshotScriptOutputs(context, target.stepOid, stepDef);
    const settled = await finishStep(tx, context, target, stepDef, deps);
    return { settled, completed: !settled };
  }
  context.root.state.scriptRuns[target.stepOid] = { state: run.state, pendingOutputs: run.output };
  await context.recordTrace(tx, target.stepOid, 'EXECUTING');
  const now = deps.now();
  await tx.update(stepInstance).set({
    state: 'WAITING_SCRIPT', startedAt: now, updatedAt: now, wakeAt: nextScriptWake(stepDef, now, now),
  }).where(eq(stepInstance.id, target.id));
  // Pilot's Waiting list (§6.7) shows repeating scripts — tell the work center one appeared.
  await notifyWorkCenter(tx, context.workCenterId);
  return { settled: false, completed: false };
}

/**
 * GATE activation (spec 2026-08-29 §5.2): trace EXECUTING once (the park convention,
 * :1484). No action-property bindings → evaluate inline immediately (same in-transaction
 * exposure as SCRIPT above); TRUE completes the step, FALSE parks WAITING_GATE with
 * wake_at = now + cycle. WITH bindings the property fetch must run outside any
 * transaction (Task 6), so the gate parks immediately with wake_at = now and the loop's
 * due pickup runs the first evaluation (§5.2.3). A timer / condition_or_timer gate (spec
 * 2026-10-13) anchors its deadline at started_at + delay_seconds and parks to the earlier of
 * the deadline and its next cycle; a pure timer never runs its script.
 */
export async function activateGateStep(
  tx: Db, context: WorkflowContext, target: { id: string; stepOid: string },
  stepDef: MasterWorkflowStep, deps: EngineDeps,
): Promise<{ settled: boolean; completed: boolean }> {
  await context.recordTrace(tx, target.stepOid, 'EXECUTING');
  const mode = gateMode(stepDef);
  const hasBindings = gateUsesBindings(stepDef);
  // Spec 2026-10-13 §3.4: a pure timer never runs its script — it only parks.
  if (mode !== 'timer' && !hasBindings) {
    const inputs = context.state.stepSnapshots[target.stepOid]?.inputParameters ?? {};
    const result = executeGateScript(stepDef, inputs, deps.config.scriptTimeoutMs);
    if (!result.success) {
      const settled = await failStep(tx, context, target, 'ERROR', result.error ?? null, deps);
      return { settled, completed: false };
    }
    if (result.open) {
      if (mode === 'condition_or_timer') await context.recordTrace(tx, target.stepOid, 'OPENED', undefined, 'condition');
      const settled = await finishStep(tx, context, target, stepDef, deps);
      return { settled, completed: !settled };
    }
  }
  // started_at is the timer's anchor (§3.3): the deadline is started_at + delay_seconds.
  const now = deps.now();
  const wakeAt = hasBindings ? now : nextGateWake(stepDef, now, now);
  await tx.update(stepInstance).set({
    state: 'WAITING_GATE', startedAt: now, updatedAt: now, wakeAt,
  }).where(eq(stepInstance.id, target.id));
  // Pilot's Waiting list (§5.3) shows timed gates — tell the work center one appeared.
  if (mode !== 'condition') await notifyWorkCenter(tx, context.workCenterId);
  return { settled: false, completed: false };
}

/** Materialize an armed gate's row at its predecessor's park (spec §5.3.1). Precondition
 *  (amended 2026-08-30): only called when the gate's `gate_config.control_previous_action`
 *  is explicitly `true` — see the call site in runStepActivation. WAITING_GATE,
 *  wake_at = now (first evaluation via the loop's due pickup — uniform for the bindings
 *  and no-bindings cases), EXECUTING trace, armedGates pairing. A TERMINAL row from a
 *  previous cycle — COMPLETED (normal cycle re-entry, materializeAndActivate's own
 *  precedent) or ERRORED/ABORTED/CANCELLED (review fix, Critical 1: a predecessor failure's
 *  own teardown CANCELs a live gate row; a CATCH/RETURN RETRY that re-parks the SAME
 *  predecessor must be able to re-arm over that CANCELLED row, or the retried action's later
 *  completion finds neither WAITING_GATE nor COMPLETED in materializeAndActivate and the
 *  instance wedges 'running' forever with no claimable row) — resets the same way. A LIVE
 *  (non-terminal) row is left alone. */
async function armGateStep(
  tx: Db, context: WorkflowContext, predecessorOid: string,
  gateDef: MasterWorkflowStep, deps: EngineDeps,
): Promise<void> {
  const [existing] = await tx.select().from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, gateDef.oid)));
  if (existing && !TERMINAL_STEP_STATES.has(existing.state)) return;
  await context.recordTrace(tx, gateDef.oid, 'EXECUTING');
  if (existing) {
    delete context.state.routingContext[gateDef.oid];
    await tx.update(stepInstance).set({
      state: 'WAITING_GATE', completedAt: null, error: null, startedAt: deps.now(),
      updatedAt: deps.now(), wakeAt: deps.now(),
      actionInstanceId: null, actionServerUri: null, actionInvokedOid: null,
    }).where(eq(stepInstance.id, existing.id));
  } else {
    await tx.insert(stepInstance).values({
      workflowInstanceId: context.id, nodeOid: context.spec.oid, stepOid: gateDef.oid,
      stepType: 'GATE', state: 'WAITING_GATE',
      startedAt: deps.now(), wakeAt: deps.now(), createdAt: deps.now(), updatedAt: deps.now(),
    });
  }
  context.root.state.armedGates[gateDef.oid] = { predecessorOid, open: false, stopSent: false };
  if (gateMode(gateDef) !== 'condition') await notifyWorkCenter(tx, context.workCenterId);
}

/**
 * Continue a step past its resource gate (already granted, or the step declares none):
 * resolve + snapshot input parameters, then either park it (USER_INTERACTION/YES_NO ->
 * WAITING_USER, ACTION PROXY -> WAITING_ACTION) or run its auto-completing type-specific logic
 * and finish it. Called by materializeAndActivate (a freshly routed successor's first
 * activation attempt) and resumeGrantedSteps (a resource-unblocked resumption). Task 13: no
 * longer recurses into routing on auto-complete — returns `completed: true` instead, so the
 * CALLER'S OWN BFS queue (drainCascade) picks up this step's successors in the NEXT wave,
 * matching the reference's `completionQueue.push` rather than the pre-Task-13 direct-recursive
 * `finishStep` -> `routeSuccessors` chain.
 *
 * `settled` true means the whole instance was already persisted + settled terminal (a SCRIPT
 * failure via failStep, or a RETURN dispatch that aborts/errors) — callers must skip their own
 * isWorkflowComplete/settleTerminal check and stop cascading immediately. `completed` (only
 * meaningful when `!settled`) means this step reached COMPLETED and its OWN successors still
 * need routing — RETURN and WORKFLOW-PROXY-with-an-active-child are the two cases that are
 * neither settled nor completed (RETURN owns its own successor activation entirely; a parked
 * WORKFLOW PROXY, like any other park, has nothing to route yet).
 *
 * Exported for core/input-bindings.ts, which resumes a WAITING_PROPERTIES step with `overlay`.
 */
export async function runStepActivation(
  tx: Db,
  context: WorkflowContext,
  target: { id: string; stepOid: string },
  stepDef: MasterWorkflowStep,
  deps: EngineDeps,
  overlay?: Record<string, string>,
): Promise<{ settled: boolean; completed: boolean }> {
  const stepType = canonicalStepType(stepDef.step_type);
  deps.beforeStepActivation?.(target.stepOid, stepType); // test-only seam — see config.ts

  context.props.resolveInputParameters(stepDef.input_parameter_specifications);
  // Spec 2026-09-04 §5.4.2: a non-GATE step with Action-Property bindings parks WAITING_PROPERTIES
  // (due now) so core/input-bindings.ts can fetch the values OUTSIDE any transaction (the GATE
  // §6.2 rule) and resume this activation with the fetched overlay. GATE keeps its own per-cycle
  // path (gate_config bindings, activateGateStep). No trace at park — the resumed activation
  // records its normal traces. The park sits AFTER the resource gate, so held resources ride out
  // the (fetch-timeout-bounded) acquisition exactly as they ride out an ACTION PROXY invoke.
  if (!overlay && stepType !== 'GATE' && (stepDef.action_property_bindings?.length ?? 0) > 0) {
    await tx.update(stepInstance).set({
      state: 'WAITING_PROPERTIES', startedAt: deps.now(), updatedAt: deps.now(), wakeAt: deps.now(),
    }).where(eq(stepInstance.id, target.id));
    return { settled: false, completed: false };
  }
  if (overlay) context.props.applyInputOverlay(overlay); // D3: evaluation-scoped, never the store
  context.state.stepSnapshots[target.stepOid] = { inputParameters: context.props.getInputParameters() };

  if (stepType === 'RETURN') {
    // dispatchReturn owns the terminal state entirely (reference engine.ts:1103-1108's own
    // early special-case, structurally BEFORE the isAutoCompleting/needsUserAction branching
    // below) — never falls through to finishStep's generic release pipeline, and never
    // "completes" in the drainCascade sense (its own successor activation, if any, is handled
    // entirely inside dispatchReturn's command handlers).
    const settled = await dispatchReturn(tx, context, target, stepDef, deps);
    return { settled, completed: false };
  }

  if (stepType === 'WORKFLOW PROXY') {
    // Task 12: child-workflow execution — reference engine.ts:674-723 activateWorkflowProxy.
    // Owns the step's park/complete lifecycle entirely (WAITING_ACTION park with an active
    // child, or a no-op finishStep-equivalent when no matching child spec exists) — never
    // falls through to the generic needsUserAction/isAutoCompleting handling below.
    return await activateWorkflowProxy(tx, context, target, stepDef, deps);
  }

  if (stepType === 'GATE') {
    return await activateGateStep(tx, context, target, stepDef, deps);
  }

  if (needsUserAction(stepType)) {
    // USER_INTERACTION / YES_NO -> WAITING_USER; ACTION PROXY -> WAITING_ACTION. Reference
    // trace vocabulary records EXECUTING either way (the park point). The row's OWN queue
    // state is WAITING_ACTION immediately for ACTION PROXY too — Task 9/10's original behavior,
    // proven load-bearing by existing tests that assert this synchronously right after park
    // (e.g. try-catch.test.ts's CATCH_REENTRY test, child-workflows.test.ts's I1 regression) —
    // NOT a transient "invocation in progress" state of its own. Task 15's real dispatch is
    // layered on top via `wake_at` alone: nullActionInvoker (`dispatches: false`, conformance/
    // dev parking mode) never schedules one, so due-wake (loop.ts) never revisits the row —
    // exactly Task 10's behavior, verified by the exec-action-proxy-001 conformance fixture,
    // which has no environment binding configured at all and must never see a "no action
    // server bound" failure.
    //
    // httpActionInvoker (`dispatches: true`) schedules `wake_at = now` — DUE IMMEDIATELY, so
    // due-wake's invoke path (loop.ts) picks it up on its very next opportunity (bounded only by
    // the worker loop's own idle cadence, not by `invokeGraceSecs`) — Task 15 review fix
    // (Important 1): the first dispatch must not idle for a full `invokeGraceSecs` (production
    // default 60s) before the action server is ever contacted; that config value is now used
    // ONLY as loop.ts's claimDueActionStep re-arms it forward, protecting an in-flight invoke
    // attempt from a concurrent re-pick — never as a deliberate delay before the FIRST attempt.
    // Resolving the binding and calling the server still happens entirely outside this
    // transaction, per the "never hold a lock across slow I/O" principle (spec §8).
    //
    // `actionInstanceId`/`actionServerUri` are explicitly wiped here too — Task 15 review fix
    // (Critical 2): a cycle re-entry onto a step that already ran to COMPLETED once
    // (materializeAndActivate's READY-reset branch) reaches this SAME code path, but that reset
    // only clears `state`/`completedAt`/`error`, not these two columns. Without wiping them here,
    // due-wake's own invoke-vs-poll discriminator (`actionInstanceId === null`) would wrongly
    // take the POLL branch against the PREVIOUS run's already-deleted action instance, producing
    // an immediate "Instance lost on server" failure instead of a genuine second invoke.
    const isActionProxy = stepType === 'ACTION PROXY';
    const queueState = isActionProxy ? 'WAITING_ACTION' : 'WAITING_USER';
    const wakeAt = isActionProxy && deps.invoker.dispatches ? deps.now() : null;
    await context.recordTrace(tx, target.stepOid, 'EXECUTING');
    await tx.update(stepInstance).set({
      state: queueState, startedAt: deps.now(), updatedAt: deps.now(), wakeAt,
      ...(isActionProxy ? { actionInstanceId: null, actionServerUri: null, actionInvokedOid: null } : {}),
    }).where(eq(stepInstance.id, target.id));

    if (isActionProxy) {
      // GATE spec 2026-08-29 §5.3.1 (amended 2026-08-30): arming a GATE immediately following
      // this Environment Action so it arms NOW — both live concurrently (the deliberate,
      // scoped exception to the one-live-row norm) — is OPT-IN via the gate's own
      // `gate_config.control_previous_action === true`. Without that flag the gate is an
      // ordinary successor: it is left alone here and materialized by the normal cascade only
      // once this ACTION PROXY completes, exactly like a gate after any other step type (no
      // concurrent row, no STOP command ever sent). ACTION PROXY is 1-out by validation, so at
      // most one successor.
      const outgoing = getRoutedConnections(context, target.stepOid);
      const gateDef = outgoing.length === 1
        ? context.spec.steps.find(s => s.oid === outgoing[0].to_step_id)
        : undefined;
      if (gateDef && canonicalStepType(gateDef.step_type) === 'GATE'
        && gateDef.gate_config?.control_previous_action === true) {
        await armGateStep(tx, context, target.stepOid, gateDef, deps);
      }
    }

    return { settled: false, completed: false };
  }

  switch (stepType) {
    case 'START':
    case 'END':
    case 'PARALLEL':
    case 'MATH':
    case 'WAIT ANY':
      break; // auto-completing, no config side effects in v1
    case 'SELECT 1': {
      const routing = handleSelect1(stepDef, context.props);
      if (routing.connectionId) context.state.routingContext[target.stepOid] = routing;
      break;
    }
    case 'CATCH': {
      // Populated by failStep when a matching TRY routes here (Task 11); a CATCH reached any
      // other way (unreachable per the validator's CATCH_WRONG_DEGREE + reachability rules —
      // a CATCH has 0 incoming connections, so nothing but failStep's activation call ever
      // targets one) has no context, matching reference: `if (ctx) activateCatchStep(...)`.
      const ctx = context.state.activeCatches[target.stepOid];
      if (ctx) activateCatchStep(stepDef, ctx, context.props);
      break;
    }
    case 'SCRIPT': {
      if (scriptRepeat(stepDef)) return await activateRepeatingScript(tx, context, target, stepDef, deps);
      const inputs = context.state.stepSnapshots[target.stepOid]?.inputParameters ?? {};
      const result = executeScript(stepDef, context.props, inputs, deps.config.scriptTimeoutMs);
      if (!result.success) {
        const settled = await failStep(tx, context, target, 'ERROR', result.error ?? null, deps);
        return { settled, completed: false };
      }
      snapshotScriptOutputs(context, target.stepOid, stepDef);
      break;
    }
    default:
      // Every step_type the schema currently defines is handled above (RETURN/WORKFLOW PROXY
      // before this switch) or in one of the cases above. A genuinely new type reaching here
      // (a future schema addition) fails loud rather than silently falling through to
      // finishStep as if it were a no-op auto-completer; runOnce's per-instance settle means it
      // never crashes the loop or wedges other instances behind it.
      throw new Error(`engine v1: step type "${stepType}" is not yet supported`);
  }

  const settled = await finishStep(tx, context, target, stepDef, deps);
  return { settled, completed: !settled };
}

// ── WORKFLOW PROXY / child workflows (Task 12, reference engine.ts:674-757) ──

/**
 * Activate a WORKFLOW PROXY step — reference engine.ts:674-723 activateWorkflowProxy. The
 * child spec is looked up by the PARENT step's own `local_id` against `context.spec.children`
 * (indexed by the CHILD spec's own `local_id` in the reference — engine.ts:109-114); a missing
 * child auto-completes the step as a no-op (reference engine.ts:676-681), matching any other
 * auto-completing step's `finishStep` treatment (Task 13: returns `completed: true` rather than
 * routing directly).
 *
 * When a child IS found: parent input params map to the child's starting params by id
 * (`value_type: 'property'` resolves through the PARENT's store — reference engine.ts:684-698);
 * the child's OWN PropertyStore is seeded fresh (declared defaults, then the parent's full flat
 * map overlaid as a COPY, then starting params — reference engine.ts:700-701 + the
 * WorkflowEngine ctor's own ordering); the parent step traces EXECUTING and parks in queue
 * state WAITING_ACTION with `action_instance_id` left NULL (decision recorded in
 * engine-state.ts's childActive doc comment: WAITING_ACTION already means "blocked on external
 * work", and Task 15's action paths always check `action_instance_id IS NOT NULL` before
 * touching a step, so a NULL-action WAITING_ACTION row is never mistaken for a pending
 * invocation); `childActive[parentStepOid] = childSpec.oid` records the link.
 *
 * The child's START auto-completes immediately (reference `childEngine.start()`) — traced
 * COMPLETED under the CHILD's own counter — and its OWN cascade is drained via drainCascade,
 * scoped to the CHILD's context (Task 13: this is the per-context BFS scope the reference's
 * per-child WorkflowEngine instance gives for free via its own independent completionQueue —
 * a child's cascade never interleaves with the parent's). completeChildWorkflow (via
 * settleIfComplete) is what notices a child that finished, whether that took one BFS wave or
 * several (a park inside the child stops the child's OWN cascade there, exactly like any other
 * park).
 */
async function activateWorkflowProxy(
  tx: Db,
  context: WorkflowContext,
  target: { id: string; stepOid: string },
  stepDef: MasterWorkflowStep,
  deps: EngineDeps,
): Promise<{ settled: boolean; completed: boolean }> {
  const childSpec = context.spec.children?.find(c => c.local_id === stepDef.local_id);
  if (!childSpec) {
    const settled = await finishStep(tx, context, target, stepDef, deps);
    return { settled, completed: !settled };
  }

  const startingParams: Record<string, string> = {};
  if (stepDef.input_parameter_specifications && childSpec.starting_parameter_specifications) {
    // Spec 2026-09-04 D9: read the step's RESOLVED inputs (runStepActivation resolved them just
    // above — with any Action-Property overlay applied) rather than re-resolving default_value
    // here, so a bound value reaches the child. Identical for unbound parameters:
    // resolveInputParameters uses the same resolvePropertyKey that resolveKey wraps.
    const resolved = context.props.getInputParameters();
    for (const childParam of childSpec.starting_parameter_specifications) {
      const parentParam = stepDef.input_parameter_specifications.find(p => p.id === childParam.id);
      if (parentParam) startingParams[childParam.id] = resolved[parentParam.id] ?? parentParam.default_value;
    }
  }

  // Fresh child every activation — reference engine.ts:704 constructs a brand-new
  // WorkflowEngine on EVERY activateWorkflowProxy call, including a cycle re-entry onto the
  // same WORKFLOW PROXY step; discard any stale property-store home from a prior run rather
  // than let it leak into this one. dropCachedView is REQUIRED here, not just the JSON reset
  // (I2 fix, post-review "PROBE6"): with views memoized per spec oid (C1 fix), a prior run's
  // completed child may still have a LIVE cached WorkflowContext sitting in viewCache — without
  // dropping it, contextForNode below would hand back that STALE instance (built from the OLD
  // childProperties blob before this reset) instead of ever re-reading the freshly emptied one,
  // so a form parked in attempt #1 could still satisfy attempt #2.
  //
  // F2 fix (Task 13 post-review, flagged gap): a re-activation (e.g. a RESTART re-firing the
  // WORKFLOW PROXY step, or a GOTO cycling back onto it) resolves the SAME static `childSpec`
  // object every time (`context.spec.children` never changes mid-instance), so its `.oid` — and
  // hence every EngineState map keyed by it — is IDENTICAL across attempts. The reference builds
  // a genuinely fresh `WorkflowEngine` per activation (`traceOrder = 0` in its own constructor),
  // so the child's trace order restarts at 1 on every attempt; without clearing
  // `orderCounters[childSpec.oid]` here, a second activation would keep counting up from
  // wherever the FIRST attempt left off, corrupting assembleReferenceTrace's per-context sort
  // (harness.ts) and diverging from the reference's own per-engine-instance counter. The child's
  // OWN internal step oids (routingContext/stepSnapshots/waitAll/blockedOnResources/childActive/
  // activeCatches) get the SAME "fresh engine" treatment — tearDownActiveChild (called by
  // whatever reset/teardown path led here — resetStepIfExists for GOTO/RETRY, or returnRestart's
  // own sweep) already clears rows/childActive/childProperties/cached-view for a PRIOR active
  // child, but never touched these OTHER per-step maps, which live in this SAME flat
  // (spec-oid-agnostic) EngineState regardless of nesting depth.
  delete context.root.state.orderCounters[childSpec.oid];
  clearStepScopedState(context.root, childSpec.steps.map(s => s.oid));
  context.root.state.childProperties[childSpec.oid] = {};
  context.root.dropCachedView(childSpec.oid);
  const childCtx = context.root.contextForNode(childSpec.oid);
  childCtx.props.initializeFromWorkflow(childSpec);
  childCtx.props.initializeFromSetup(context.props.toFlatMap());
  childCtx.props.initializeStartingParameters(childSpec.starting_parameter_specifications, startingParams);

  // Reference child engines register THEIR OWN workflow-scoped resources into the SHARED
  // manager when they start (engine.ts:149-168; the parent hands its manager down at
  // 703-706). The port has no per-child engine, so this is that registration's home: on
  // every activation, register the child spec's WORKFLOW-scoped resources under the same
  // `${owner.oid}:${name}` keys instance.ts uses for the root. registerResource is a no-op on
  // an already-registered key, so a loop/RESTART re-entry onto the same proxy preserves
  // in-flight pool state — exactly the reference's behavior with its long-lived shared manager.
  // Without this, the first child step carrying an Acquire against a child-declared resource
  // threw "Resource ... is not registered" out of the activation cascade (2026-08-11, RW-8).
  //
  // Task 4 (Phase 2a, Ruling B): a child-carried ENVIRONMENT spec's resources are deliberately
  // NOT registered here any more — they route to context.root.envResources instead (openContext's
  // hydration walks the whole recipe, root and every nested child, so a child's own environment
  // resources are already locked and hydrated before this ever runs). Registering them here too
  // would be unreachable once routing exists, but would still serialize into engine_state.resources
  // and still surface in the local manager's getSnapshot() as a free resource that is actually
  // held elsewhere in the work center — the same "local or shared, never both" trap instance.ts's
  // own removal avoided.
  if (context.root.resources) {
    for (const r of childSpec.resource_property_specifications ?? []) {
      if (r.scope !== 'environment') {
        context.root.resources.registerResource(`${childSpec.oid}:${r.name}`, r, childSpec.oid, 'workflow');
      }
    }
  }

  await context.recordTrace(tx, target.stepOid, 'EXECUTING');
  await tx.update(stepInstance).set({
    state: 'WAITING_ACTION', startedAt: deps.now(), updatedAt: deps.now(),
  }).where(eq(stepInstance.id, target.id));
  context.state.childActive[target.stepOid] = childSpec.oid;

  const childStart = childSpec.steps.find(s => canonicalStepType(s.step_type) === 'START');
  if (!childStart) {
    // Defensive: validator.ts's NO_START_STEP would reject a child missing one, but this task
    // doesn't extend validation to walk `children` (out of scope) — a hand-built spec could
    // still lack one. Leave the parent parked rather than crash; nothing will ever complete
    // this branch, matching the general "malformed child leaves the parent stuck" posture
    // documented on errorReturnStep above.
    return { settled: false, completed: false };
  }
  await childCtx.recordTrace(tx, childStart.oid, 'COMPLETED');
  // Spec 2026-08-22 (D3): a child's cascade CAN now settle the whole instance — an uncaught
  // child failure escalates through failStep and can reach the root's uncaught path (instance
  // 'errored') or a CATCH_REENTRY abort. Propagate instead of discarding (the pre-escalation
  // comment here claimed a child could never settle; that stopped being true).
  const childSettled = await drainCascade(tx, childCtx, [childStart.oid], deps);
  if (childSettled) return { settled: true, completed: false };
  // Task 13 fix: under the pre-Task-13 lazy model, a child's own completion was ALWAYS noticed
  // by a LATER, separate processReadyStep/submitUserAction call's own settleIfComplete tail —
  // there was no way for a child to finish "before" its caller returned. Eager cascading changes
  // that: a trivial (no-park) child can now run to COMPLETED entirely within THIS SAME call,
  // several frames before runStepActivation (let alone processReadyStep) ever returns — nothing
  // upstream would otherwise notice, leaving the parent WORKFLOW PROXY step permanently stuck
  // at WAITING_ACTION. Mirrors the reference's own activateWorkflowProxy, which calls
  // completeChildWorkflow synchronously, inline, the instant childEngine.getWorkflowState() ===
  // 'COMPLETED' (engine.ts:716-718) — settleIfComplete is the row-based equivalent of that
  // check, and its own recursion handles however many nesting levels this just completed.
  await settleIfComplete(tx, context.root, childSpec.oid, deps);
  return { settled: false, completed: false };
}

/** Task 12: whether a child context (identified by its own spec) has fully finished — its END
 *  reached COMPLETED and no step_instance row scoped to its node_oid is left non-terminal.
 *  Scoped analog of isWorkflowComplete (whole instance) restricted to just this child's own
 *  rows: a nested grandchild's OWN steps carry the GRANDCHILD's node_oid, not this child's, so
 *  they don't interfere with this check; the WORKFLOW PROXY step (if any) that spawned that
 *  grandchild DOES carry THIS child's node_oid, and stays non-terminal (WAITING_ACTION) until
 *  completeChildWorkflow marks it COMPLETED — so a still-running grandchild correctly keeps
 *  THIS check false too, exactly like a still-EXECUTING regular step would. */
async function isChildComplete(tx: Db, instanceId: string, childSpec: MasterWorkflowSpecification): Promise<boolean> {
  const rows = await tx.select().from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, instanceId),
    eq(stepInstance.nodeOid, childSpec.oid),
  ));
  const anyEndCompleted = rows.some(r => r.stepType === 'END' && r.state === 'COMPLETED');
  if (!anyEndCompleted) return false;
  return !rows.some(r => !TERMINAL_STEP_STATES.has(r.state));
}

/**
 * Finish an active child — reference engine.ts:725-757 completeChildWorkflow: map its outputs
 * onto the parent WORKFLOW PROXY step's own `output_parameter_specifications` (matched by id,
 * written into the OWNING context's property store — root, or an ancestor child for a nested
 * grandchild's parent), complete + cascade that step in the OWNING context (Task 13: via
 * drainCascade rather than the old direct-recursive routeSuccessors — a genuine "settled"
 * from this cascade is safely absorbed by the caller's own subsequent settleIfComplete
 * recursion regardless, since a non-root owning context can never settle the whole instance,
 * and a root owning context settling here just makes settleIfComplete's own root-case check a
 * harmless redundant read). `parentRow` carries its own `node_oid`, so the owning context
 * resolves correctly regardless of nesting depth. Only ever called from settleIfComplete, once
 * `isChildComplete` confirms the child is done.
 */
async function completeChildWorkflow(
  tx: Db,
  root: WorkflowContext,
  parentRow: { id: string; stepOid: string; nodeOid: string },
  childSpec: MasterWorkflowSpecification,
  deps: EngineDeps,
): Promise<void> {
  const ownerCtx = root.contextForNode(parentRow.nodeOid);
  const parentStepDef = ownerCtx.spec.steps.find(s => s.oid === parentRow.stepOid);
  if (!parentStepDef) return; // defensive — the row's own spec must declare the step that created it

  delete root.state.childActive[parentRow.stepOid];

  if (childSpec.output_parameter_specifications && parentStepDef.output_parameter_specifications) {
    const childCtx = root.contextForNode(childSpec.oid);
    const childProps = childCtx.props.toFlatMap();
    for (const childOutParam of childSpec.output_parameter_specifications) {
      const parentOutParam = parentStepDef.output_parameter_specifications.find(p => p.id === childOutParam.id);
      if (parentOutParam?.target) {
        ownerCtx.props.set(parentOutParam.target, childProps[childOutParam.id] ?? '');
      }
    }
  }

  await ownerCtx.recordTrace(tx, parentRow.stepOid, 'COMPLETED');
  await tx.update(stepInstance).set({
    state: 'COMPLETED', completedAt: deps.now(), updatedAt: deps.now(),
  }).where(eq(stepInstance.id, parentRow.id));

  await drainCascade(tx, ownerCtx, [parentRow.stepOid], deps);
}

/**
 * After a step's own context has settled (routed, WAIT ALL sweep run), check whether the
 * CONTEXT THAT OWNS `nodeOid` has itself now finished — recursing up through however many
 * nested WORKFLOW PROXY levels are active (Task 12). The root case is the same
 * isWorkflowComplete + settleTerminal('completed') tail every prior task's processReadyStep/
 * submitUserAction already ran; a completed CHILD instead triggers completeChildWorkflow (which
 * may itself make ITS OWNER complete — hence the recursion) and never settles the whole
 * instance on its own — an in-flight nested child never means the WHOLE workflow finished.
 *
 * Does NOT persist — callers persist the root context exactly once, after this returns.
 */
export async function settleIfComplete(tx: Db, root: WorkflowContext, nodeOid: string, deps: EngineDeps): Promise<void> {
  if (nodeOid === root.spec.oid) {
    if (await isWorkflowComplete(tx, root.id, root.spec.oid)) {
      await settleTerminal(tx, root, 'completed', 'completed', deps.now);
    }
    return;
  }

  const childSpec = findSpecByOid(root.spec, nodeOid);
  if (!childSpec) return; // defensive — every node_oid this engine creates resolves in the tree
  if (!(await isChildComplete(tx, root.id, childSpec))) return;

  const parentStepOid = Object.entries(root.state.childActive).find(([, v]) => v === nodeOid)?.[0];
  if (!parentStepOid) return; // defensive — already completed/cleared by an earlier pass
  const [parentRow] = await tx.select().from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, root.id), eq(stepInstance.stepOid, parentStepOid)));
  if (!parentRow) return; // defensive

  await completeChildWorkflow(tx, root, parentRow, childSpec, deps);
  await settleIfComplete(tx, root, parentRow.nodeOid, deps);
}

/**
 * Phase 4a (spec §7.1, plan delta D12): an operator's cancel-waiter / clear-sync is delivered
 * IN BAND. The verb deletes this instance's waiter row under the registry lock and wakes this
 * instance; it never touches this instance's engine_state or step rows (that would need two
 * instance locks in one transaction, which the §5.3 lock order forbids). So the signal is the
 * ABSENCE of the token: a READY row whose blockedOnResources record names an environment
 * command, whose token `envToken(instance, step)` is in no queue and in no pendingGrants of
 * the manager we just hydrated, has been cancelled. Fail it through failStep with mode ERROR
 * so a TRY of mode ERROR catches it like any other failure (uncaught: the instance errors).
 *
 * A token that is GRANTED but unconsumed is present in pendingGrants (snapshotToSerialized
 * seeds it there), so it is never mistaken for a cancel — resumeGrantedSteps consumes it.
 * A WORKFLOW-tier block is skipped: its queue lives in engine_state and only this instance's
 * own transactions (or Task 5's instance verb, which fails the step itself) can dequeue it.
 * A block whose resource this hydration did not lock is skipped too — resolveResourceTier
 * would throw "not hydrated" on the normal path, and this pass must not invent a second
 * failure mode for that.
 *
 * Returns 'settled' when a failure settled the whole instance (caller returns at once),
 * 'failed' when at least one step was failed (caller persists and reports work), else 'none'.
 */
async function failOperatorCancelledWaits(
  tx: Db, context: WorkflowContext, readyRows: Array<{ id: string; stepOid: string; nodeOid: string }>,
  deps: EngineDeps,
): Promise<'none' | 'failed' | 'settled'> {
  const envMgr = context.root.envResources;
  if (!envMgr) return 'none';
  const live = new Set(allManagerTokens(envMgr));
  let failed = false;
  for (const row of readyRows) {
    const pending = context.state.blockedOnResources[row.stepOid];
    if (!pending?.blockedOn) continue;
    const found = context.findStep(row.stepOid);
    if (!found) continue;
    const { resource_name, command_type } = pending.blockedOn;
    const cmd = found.stepDef.resource_command_specifications?.find(
      (c) => c.resource_name === resource_name && c.command_type === command_type,
    );
    if (!cmd) continue;
    if (!isEnvironmentCommand(cmd, found.context.spec, context.root.envScope)) continue;
    if (!context.root.envKnownNames.has(resource_name)) continue;
    if (live.has(envToken(context.root.id, row.stepOid))) continue;
    const settled = await failStep(
      tx, found.context, { id: row.id, stepOid: row.stepOid }, 'ERROR',
      `Resource "${resource_name}": wait cancelled by an operator`, deps,
    );
    if (settled) return 'settled';
    failed = true;
    // failStep returning false means "a catch was armed and its cascade didn't itself settle the
    // instance — the caller's normal generic tail handles it". That tail is this call: a catch
    // network ending in RETURN COMPLETE (or a GOTO onto one) can run the instance all the way to
    // END inside failStep, and nothing below would notice. Without it such an instance sits
    // 'running' with every row terminal and no READY row left, so claimInstanceForWork's
    // READY_STEP_EXISTS filter never selects it again — wedged, permanently. Same placement as
    // resumeGrantedSteps' own per-item settleIfComplete, and scoped to the row's own node_oid so
    // a cancelled wait inside a CHILD bubbles that child's completion up through its proxy.
    await settleIfComplete(tx, context.root, row.nodeOid, deps);
  }
  return failed ? 'failed' : 'none';
}

/**
 * Advance one READY step on an already-running instance: claim the instance's full row,
 * pick the oldest actionable READY step (createdAt, id tiebreak — skipping any already
 * blocked on resources), run it, cascade its successors if it completes, and settle the
 * workflow if it just completed. Returns whether it did anything (false only when every READY
 * step in this instance is currently blocked on resources).
 *
 * Task 13: under the new eager-activation model (drainCascade/materializeAndActivate), a
 * genuinely stray READY row reaching this function is rare — nearly everything gets activated
 * inline the moment it's routed to. This remains the WORKER LOOP's entry point for finding work
 * at all (loop.ts's runOnce), and the recovery path for anything the eager cascade legitimately
 * leaves READY-and-unblocked (there is none by construction today, but keeping this generic
 * matches the C2 head-of-line-blocking guard's own "never trust a single code path" posture).
 */
export async function processReadyStep(tx: Db, instanceId: string, deps: EngineDeps): Promise<boolean> {
  const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  if (!row) return false;
  // C1 fix: re-check status on every call, not just at the top of a pump loop. A prior call
  // WITHIN THE SAME pump (submit.ts's while-loop, which keeps calling this after each unit of
  // work) can have already settled the instance 'errored' via a SCRIPT failure — without this
  // guard, this call would go on to process an UNRELATED branch's READY row, route it all the
  // way to END, and isWorkflowComplete/settleTerminal would overwrite the already-terminal
  // status with 'completed'. claimInstanceForWork's own status='running' filter is what keeps
  // the WORKER LOOP path safe; this call also runs from inside submit.ts's own transaction,
  // which does its OWN single running-check up front and then keeps calling this in a loop —
  // so this function must re-verify on every single call, not trust its caller's earlier check.
  if (row.status !== 'running') return false;
  const context = await openContext(tx, row, deps);

  const readyRows = await tx.select().from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.state, 'READY')))
    .orderBy(stepInstance.createdAt, stepInstance.id);

  // Phase 4a (D12): an operator may have cancelled one of this instance's environment waits
  // since its last transition — surface that BEFORE choosing a target, so the failure (and its
  // TRY/CATCH routing) is the unit of work this pump reports.
  const cancelled = await failOperatorCancelledWaits(tx, context, readyRows, deps);
  if (cancelled === 'settled') return true;
  if (cancelled === 'failed') { await context.persist(tx); return true; }

  const target = readyRows.find(r => !context.state.blockedOnResources[r.stepOid]);
  if (!target) {
    if (readyRows.length > 0) {
      // Task 5 (Critical 1 fix): a FOREIGN instance's release can flag one of THIS instance's
      // own queued environment waiters granted, entirely via write-back's pg_notify — this
      // instance did nothing of its own this cycle to trigger the normal release-driven
      // resumeGrantedSteps call (every OTHER call site only ever fires as a side effect of
      // THIS instance's own activation/dequeue/release work). Without this, the grant channel's
      // wake only gets this instance reclaimed sooner — nothing here ever consumed the grant,
      // and it wedges the resource work-center-wide (same shape envSweepTokens' own doc
      // comment describes for the cancel side). Flush BEFORE the head-of-line bump below, so a
      // genuine resume reports real work rather than a silent rotation no-op.
      const { settled, resumedAny } = await resumeGrantedSteps(tx, context, deps);
      if (settled) return true; // an unrelated resumed step's SCRIPT failure settled the instance
      if (resumedAny) {
        await context.persist(tx);
        return true; // did work: a cross-instance grant resumed (partially or fully)
      }
      // Every READY step is blocked on a resource that can only be released by an external
      // actor (e.g. submitUserAction on a DIFFERENT, already-parked step in this same
      // instance that holds it) — nothing left in this instance's own READY queue can run to
      // trigger that release itself. Left alone, this instance's updated_at would never
      // advance, so claimInstanceForWork's `order by updated_at asc` would keep re-selecting
      // it FIRST forever, starving every other runnable instance behind it — the same
      // head-of-line-blocking shape C2 guards against, but silent (a plain `false` return,
      // not a throw), so C2's recovery path never sees it. Ledgered from Task 9's review
      // (M5); bumping updated_at here — even though no trace/step work happened — rotates
      // this instance to the back of the claim order so other instances get their turn.
      await tx.update(workflowInstance).set({ updatedAt: deps.now() }).where(eq(workflowInstance.id, instanceId));
    }
    return false;
  }

  // Task 12: resolve the step's OWNING context from the row's own node_oid — the root spec for
  // a root-level step, or a (possibly nested) child spec for one materialized inside an active
  // WORKFLOW PROXY. Every step_instance row this engine ever creates stamps node_oid from a
  // context it just resolved the same way, so this always succeeds.
  const stepCtx = context.contextForNode(target.nodeOid);
  const stepDef = stepCtx.spec.steps.find(s => s.oid === target.stepOid);
  if (!stepDef) throw new Error(`step "${target.stepOid}" not found in spec "${stepCtx.spec.oid}"`);

  if (stepDef.resource_command_specifications?.length) {
    const granted = tryActivateResources(stepCtx, target.stepOid, stepDef.resource_command_specifications);
    if (!granted) {
      await stepCtx.recordTrace(tx, target.stepOid, 'WAITING');
      // I3 fix: an activation list can grant EARLIER commands before a LATER one blocks (e.g.
      // [Send(ok), Acquire(blocks)] — the Send already queued a grant for a waiting Receive
      // elsewhere in this instance). This step never reaches finishStep to trigger the normal
      // release-driven resumeGrantedSteps call, so without flushing here that grant strands
      // permanently — nothing else in this instance would ever call it. Cheap hardening: flush
      // right here, every time a step blocks, regardless of whether ITS OWN activation
      // produced anything (a no-op flushGranted is free).
      const { settled } = await resumeGrantedSteps(tx, context, deps);
      if (settled) return true; // an unrelated resumed step's SCRIPT failure settled the instance
      await context.persist(tx);
      return true; // did work: recorded the block
    }
  }

  const result = await runStepActivation(tx, stepCtx, target, stepDef, deps);
  if (result.settled) return true; // failStep/dispatchReturn already persisted + settled the instance terminal
  if (result.completed) {
    const cascadeSettled = await drainCascade(tx, stepCtx, [target.stepOid], deps);
    if (cascadeSettled) return true;
  }

  // Task 12: settleIfComplete folds the old isWorkflowComplete+settleTerminal tail into the
  // root case of a check that also recognizes "the CHILD that owns this step just finished",
  // recursing up through however many nested WORKFLOW PROXY levels are active.
  await settleIfComplete(tx, context, target.nodeOid, deps);
  await context.persist(tx);
  return true;
}
