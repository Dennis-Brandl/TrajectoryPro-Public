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
//
// Task 16: the four control passes — pausing / resuming / stopping / aborting — driven by the
// transitional workflow_instance statuses migration 0018 (Task 1) added and mission-control-db's
// runtime-control DAOs (Task 2) write. Spec §7's own table:
//
//   request | legal from                          | transitional | settles to
//   pause   | running                              | pausing      | paused
//   resume  | paused                               | resuming     | running
//   stop    | running, paused, pausing             | stopping     | stopped
//   abort   | any active status except pending     | aborting     | aborted
//
// LOCKING PROTOCOL (project invariant, unchanged): claim the workflow_instance row FOR UPDATE
// SKIP LOCKED first (claimInstanceForWork, shared with loop.ts's other claim sites); step_instance
// rows are never independently locked. One control pass = one transaction, exactly like the
// transition transaction (§6). NO NETWORK INSIDE THE CLAIM TRANSACTION (data-safety spec
// 2026-10-21): a pass decides PAUSE/STOP support from the in-memory capabilities cache alone
// (commandSupportCached — capability-warmup.ts fills it before the lock is taken) and only
// COLLECTS its PAUSE/RESUME/STOP commands (AfterCommitCommand) and the ABORT pass's ABORT+DELETE
// pairs; runControlPass sends all of them after the transaction commits, so a slow or dead action
// server never holds the instance row (and a pooled connection) locked.
//
// MANDATORY (Task 12 ruling, carried into every pass below): a parked WORKFLOW PROXY row sits in
// WAITING_ACTION with `action_instance_id` NULL — every "is this an action step" check here tests
// `actionInstanceId` (and, for capability-gated commands, `actionServerUri`) before ever touching
// the action-command machinery. Pausing/stopping never send a command to such a row and never
// trace it (the instance-level status freeze alone already halts the child's own dispatch, since
// READY-step activation stays gated on status='running' regardless of nesting — see loop.ts);
// stopping cancels such a row once its child subtree has drained (post-merge ticket fix — see
// runStopping), and aborting DOES still flip such a row terminal (ABORTED) — the whole tree must
// quiesce — but neither ever attempts a network command against it.
import { eq, and, inArray } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import { WorkflowContext, openContext, settleTerminal } from './context.js';
import {
  drainCascade, failStep, settleIfComplete, settleStoppedIfDrained, NON_TERMINAL_STEP_STATES,
  STOP_ACTIVE_STEP_STATES,
} from './transition.js';
import { claimInstanceForWork, claimInstanceById } from '../loop.js';
import { closeMonitoring } from '../actions/monitor.js';
import type { ActionClient } from '../actions/client.js';
import { reconcileAndNotify } from './reconcile.js';
import { ACTIVE_ROW_STATES, recordStepRun, recordFailedActiveRuns } from './step-run.js';
import { warmCapabilities, markOriginUnreachable } from './capability-warmup.js';
import {
  applySendFailure, classifySendError, processPendingSendFailures, queueSendFailure, sendFailureReason,
} from './send-failure.js';

export const TRANSITIONAL_STATUSES = ['pausing', 'resuming', 'stopping', 'aborting'];

/** A command a locked pass decided to send; sent by its caller once the transaction commits.
 *  Data safety round 3 (spec 2026-10-22-data-safety-3 §1): it also names the record the pass
 *  wrote for it — the instance, the step row and oid it is about (for a gate STOP, the gate's
 *  predecessor, plus `gateOid`) — so a failed send can undo or annotate that record. */
export type AfterCommitCommand = {
  serverUri: string;
  actionInstanceId: string;
  command: 'PAUSE' | 'RESUME' | 'STOP';
  instanceId: string;
  kind: 'step-stop' | 'gate-stop' | 'pause' | 'resume';
  stepRowId: string;
  stepOid: string;
  gateOid?: string;
  /** kind 'pause' only: the `pausedAt[stepOid]` value the pass wrote with this PAUSE. It marks
   *  the pause request the command belongs to, so an undo that outlives a resume and re-pause
   *  never reverts the later, delivered PAUSE. */
  pausedAtMs?: number;
};

/** Send each collected command in order. Call only after the transaction commits. A failed send
 *  is classified (send-failure.ts): an unknown instance (404) counts as delivered; a refusal keeps
 *  the record and shows it; an unreachable server is put into back-off and the record undone, so
 *  the command is sent again once the server answers. A failed RESUME is only logged. Never
 *  throws — the pass it follows has already committed. */
export async function sendAfterCommit(
  db: Db, client: ActionClient | null, commands: AfterCommitCommand[], deps: EngineDeps,
): Promise<void> {
  if (!client) return;
  for (const cmd of commands) {
    try {
      await client.sendCommand(cmd.serverUri, cmd.actionInstanceId, cmd.command);
      continue;
    } catch (err) {
      const reason = sendFailureReason(err);
      if (cmd.kind === 'resume') {
        console.error(`[mission-engine] instance ${cmd.instanceId} RESUME to ${cmd.serverUri} failed: ${reason}`);
        continue;
      }
      const failure = classifySendError(err);
      if (failure === 'gone') continue;
      if (failure === 'unreachable') markOriginUnreachable(client, cmd.serverUri);
      console.error(`[mission-engine] instance ${cmd.instanceId} ${cmd.command} to ${cmd.serverUri} could not be delivered (${failure}): ${reason}`);
      try {
        await applySendFailure(db, cmd, failure, deps, reason);
      } catch (undoErr) {
        // Never silently skipped: a throwing first attempt waits on the queue like a busy one.
        queueSendFailure(cmd, failure, reason);
        console.error(`[mission-engine] instance ${cmd.instanceId} undo of an undelivered ${cmd.command} failed, will retry: ${sendFailureReason(undoErr)}`);
      }
    }
  }
}

/** Final-review Important 1 fix (I2): a stopping instance that's merely waiting on in-flight
 *  action terminals produces ZERO operator-visible signal for its entire stay — runStopping
 *  correctly returns `didWork=false` once there's nothing new to attempt (Task 16's own Critical
 *  2 fix, so the worker loop can idle instead of spinning), but that same correctness means a
 *  wedged or slow drain looks identical, from the logs, to a healthy idle engine. A low-frequency
 *  heartbeat closes that gap without reintroducing the spam Critical 2 fixed: rate-limited per
 *  instance (mirrors loop.ts's `lastCycleErrorLoggedAt` module-level-Map precedent — the simpler
 *  shape, since this is transient operator signal, not something that needs to survive a process
 *  restart or round-trip through `engine_state`/jsonb the way EngineState fields do), using
 *  `deps.now()` (never wall-clock) so tests can drive it via a fake clock exactly like every
 *  other timing decision in this engine. Cleared once the instance actually settles, so a
 *  long-lived process doesn't accumulate one stale entry per instance forever. */
const STOPPING_DRAIN_LOG_INTERVAL_MS = 5 * 60_000;
const lastStoppingDrainLogAt = new Map<string, number>();

function logStoppingDrainOnce(instanceId: string, activeStepCount: number, deps: EngineDeps): void {
  const nowMs = deps.now().getTime();
  const last = lastStoppingDrainLogAt.get(instanceId);
  if (last !== undefined && nowMs - last < STOPPING_DRAIN_LOG_INTERVAL_MS) return;
  lastStoppingDrainLogAt.set(instanceId, nowMs);
  console.error(`[mission-engine] instance ${instanceId} still draining (stopping): ${activeStepCount} active steps`);
}

/** Data safety round 2 (spec 2026-10-22 §2): how often a pass waiting to send a STOP or PAUSE to
 *  an action server it cannot reach says so. Same shape as the stopping-drain heartbeat above. */
export const WAITING_LOG_INTERVAL_MS = 5 * 60_000;
const lastWaitingLogAt = new Map<string, number>();

/** Logs that `instanceId` is waiting to send `command` because `serverUri`'s capabilities are not
 *  known yet — at most once per WAITING_LOG_INTERVAL_MS per (instance, command, uri). Round 2
 *  (spec 2026-10-23 goal 5): 'POLL' logs a failing action status check instead (loop.ts
 *  pollDueStep), with `detail` saying why (`HTTP 401`, a network error's message). */
export function logWaitingForServer(instanceId: string, command: 'STOP' | 'PAUSE' | 'POLL', serverUri: string, nowMs: number, detail?: string): void {
  const key = `${instanceId}\u0000${command}\u0000${serverUri}`;
  const last = lastWaitingLogAt.get(key);
  if (last !== undefined && nowMs - last < WAITING_LOG_INTERVAL_MS) return;
  lastWaitingLogAt.set(key, nowMs);
  if (command === 'POLL') {
    console.error(`[mission-engine] instance ${instanceId}: action server ${serverUri} not answering status checks${detail ? ` (${detail})` : ''}`);
    return;
  }
  console.error(`[mission-engine] instance ${instanceId} waiting to send ${command}: action server ${serverUri} not reachable`);
}

/** Drops an instance's waiting-log entries once it settles, so a long-lived process doesn't keep
 *  one stale entry per instance forever. With `command`, only that command's entries (a settled
 *  pause clears its PAUSE keys; a settled stop is terminal and clears them all). */
export function clearWaitingLog(instanceId: string, command?: 'STOP' | 'PAUSE' | 'POLL'): void {
  const prefix = command ? `${instanceId}\u0000${command}\u0000` : `${instanceId}\u0000`;
  for (const key of [...lastWaitingLogAt.keys()]) if (key.startsWith(prefix)) lastWaitingLogAt.delete(key);
}

// ABORT's "was actually doing something" set — regardless of whether it's a genuine action step
// or a WORKFLOW PROXY/WAIT-ALL park (the whole tree must quiesce on abort, not just the
// action-backed subset) — is ACTIVE_ROW_STATES, defined once in step-run.ts (spec 2026-10-27).

/** Task 16 review fix (Important 1): mirrors settleFailedInstance/recoverFailedStart's own
 *  precedent (loop.ts) — bounded, not unconditional, since a control-pass throw isn't
 *  necessarily a poisoned workflow the way a transition-logic throw is (a CascadeExceededError
 *  from a deferred-routing drain genuinely is one; a transient DB blip or a one-off
 *  contextForNode resolution failure might not be). */
export const MAX_CONTROL_PASS_ATTEMPTS = 3;

/** Best-effort capability check shared by pause (PAUSE) and stop (STOP) — RESUME never checks
 *  capabilities (spec §7: a step can only be PAUSED in the first place because PAUSE was already
 *  confirmed supported for that exact action, and the protocol's RESUME is the natural inverse of
 *  a supported PAUSE). Opaque actions accept ABORT only (spec §1.1) — the stub/reference server
 *  may not itself enforce that restriction, so it's enforced here regardless of what
 *  `supportedCommands` claims. A capabilities() failure (network error, allowlist, etc.) is
 *  treated as "unsupported" — best-effort per E3, never fatal to the whole pass. Makes a network
 *  call on a cache miss, so never call it inside a claim transaction — use commandSupportCached. */
export async function commandSupported(
  client: ActionClient, serverUri: string, actionOid: string, command: 'PAUSE' | 'STOP',
): Promise<boolean> {
  try {
    const cap = (await client.capabilities(serverUri)).byActionOid.get(actionOid);
    if (!cap || cap.opaque) return false;
    return cap.supportedCommands.includes(command);
  } catch {
    return false;
  }
}

/** Data safety round 2 (spec 2026-10-22 §2): a cache-only verdict has three answers, because
 *  "the server never told us" is not "the server said no" — the engine must never record a STOP
 *  as handled, or report Paused, on a guess. */
export type CommandSupport = 'supported' | 'unsupported' | 'unknown';

/** commandSupported's rules read from the capabilities cache only — the in-transaction form.
 *  No cache entry for the server (cold, or unreachable — warm-up evicts on a failed fetch) is
 *  'unknown'; a server that answered without the action, an opaque action, or a command the
 *  action doesn't list is 'unsupported'. */
export function commandSupportCached(
  client: ActionClient, serverUri: string, actionOid: string, command: 'PAUSE' | 'STOP',
): CommandSupport {
  const caps = client.peekCapabilities(serverUri);
  if (caps === undefined) return 'unknown';
  const cap = caps.byActionOid.get(actionOid);
  if (!cap || cap.opaque) return 'unsupported';
  return cap.supportedCommands.includes(command) ? 'supported' : 'unsupported';
}

/**
 * Pausing (spec §7 + E3): every WAITING_ACTION action step (`action_instance_id` set — the Task
 * 12 guard excludes WORKFLOW PROXY proxy rows) whose capabilities allow PAUSE gets a best-effort
 * `sendCommand(PAUSE)` and flips to PAUSED with a `PAUSED` trace entry; an unsupporting action is
 * left exactly as-is (still WAITING_ACTION, no trace — E3's "keep running" half). `wake_at` is
 * deliberately left untouched either way: PAUSED is already one of loop.ts's
 * `ACTIONABLE_STEP_STATES` / monitor.ts's `PARKED_STATES`, so due-wake polling and the SSE fast
 * path both keep observing a paused action exactly like a running one (spec: "observation
 * continues while paused"). Records `pausedAt` (epoch ms) for each step actually paused —
 * controller Ruling B: the resuming pass uses this to shift the step's timeout deadline forward
 * by exactly how long it sat paused, suspending its budget rather than letting the clock run out
 * underneath it. An unsupporting action just keeps running in the background.
 *
 * Data safety round 2 (spec 2026-10-22 §2): an action whose server's capabilities are UNKNOWN
 * (unreachable, cold cache) is neither — the engine must never report Paused on a guess. The pass
 * records `pausingSince` the first time it finds one and stays `pausing` while it waits; once
 * every row is known it settles `paused`. After PAUSE_UNKNOWN_LIMIT_MS it settles `paused`
 * anyway, leaving each still-unknown step WAITING_ACTION with a WARNING trace.
 *
 * Round 3 (spec 2026-10-22-data-safety-3 §1): `pausingSince` is no longer cleared when the run
 * settles — it lasts for the whole pause request (until resume), so a PAUSE whose send failed
 * and was undone (send-failure.ts) counts toward the same limit. A step whose PAUSE was refused
 * is skipped, like an unsupporting one.
 *
 * Returns whether the pass did observable work (a PAUSE, a first `pausingSince`, or a settle).
 * A pure waiting pass returns false so the loop can idle, but still persists — that bumps
 * `updated_at`, rotating this instance behind other transitional ones in the claim order.
 */
export const PAUSE_UNKNOWN_LIMIT_MS = 120_000;

export const UNREACHABLE_WARNING = 'action server unreachable — this action may still be running';

async function runPausing(
  tx: Db, context: WorkflowContext, client: ActionClient | null, deps: EngineDeps, out: AfterCommitCommand[],
): Promise<boolean> {
  let didWork = false;
  const nowMs = deps.now().getTime();
  const pending: Array<{ stepOid: string; nodeOid: string }> = [];
  const rows = await tx.select().from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, context.id),
    eq(stepInstance.state, 'WAITING_ACTION'),
  ));

  for (const row of rows) {
    if (!client || !row.actionInstanceId || !row.actionServerUri) continue; // proxy row or no dispatch — leave untouched

    const stepCtx = context.contextForNode(row.nodeOid);
    const stepDef = stepCtx.spec.steps.find(s => s.oid === row.stepOid);
    const cfg = stepDef?.action_proxy_config;
    if (!cfg) continue; // defensive — only ACTION PROXY steps ever carry an action_instance_id
    // Final-review fix: a step that already has the unreachable WARNING reached the limit — its
    // cycle is over for this pause request, so it is neither paused again nor warned again.
    if (context.root.state.pauseUnreachableWarned.includes(row.stepOid)) continue;

    // Spec 2026-08-20 §4.3: legality is a property of the action the CONTAINER is running, which
    // under loose matching is the name-resolved oid, not the workflow's own. `??` covers strict
    // dispatch and pre-migration rows, where the two are the same thing.
    const support = commandSupportCached(client, row.actionServerUri, row.actionInvokedOid ?? cfg.action_oid, 'PAUSE');
    if (support === 'unknown') {
      pending.push({ stepOid: row.stepOid, nodeOid: row.nodeOid });
      logWaitingForServer(context.id, 'PAUSE', row.actionServerUri, nowMs);
      continue;
    }
    if (support === 'unsupported') continue; // E3: unsupporting action keeps running, no trace
    // Round 3 (spec 2026-10-22-data-safety-3 §1): a refused PAUSE is never resent in this pause
    // request — the step is treated like one whose action doesn't support PAUSE.
    if (context.root.state.pauseRefused.includes(row.stepOid)) continue;

    out.push({
      serverUri: row.actionServerUri, actionInstanceId: row.actionInstanceId, command: 'PAUSE',
      instanceId: context.id, kind: 'pause', stepRowId: row.id, stepOid: row.stepOid, pausedAtMs: nowMs,
    });
    await stepCtx.recordTrace(tx, row.stepOid, 'PAUSED');
    await tx.update(stepInstance).set({ state: 'PAUSED', updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
    context.root.state.pausedAt[row.stepOid] = nowMs;
    didWork = true;
  }

  if (pending.length > 0) {
    if (context.root.state.pausingSince == null) {
      context.root.state.pausingSince = nowMs;
      didWork = true;
    }
    if (nowMs - context.root.state.pausingSince < PAUSE_UNKNOWN_LIMIT_MS) {
      await context.persist(tx); // always — rotates this instance in the claim order
      return didWork; // stay 'pausing'
    }
    for (const p of pending) {
      context.root.state.pauseUnreachableWarned.push(p.stepOid);
      await context.contextForNode(p.nodeOid).recordTrace(tx, p.stepOid, 'WARNING', undefined, UNREACHABLE_WARNING);
    }
  }

  await tx.update(workflowInstance).set({ status: 'paused', updatedAt: deps.now() })
    .where(and(eq(workflowInstance.id, context.id), eq(workflowInstance.status, 'pausing')));
  // Round 3 (spec 2026-10-22-data-safety-3 §1): pausingSince is kept when the run settles, so an
  // undelivered-PAUSE undo after this point still counts toward the same 2-minute limit. Only
  // the resuming pass clears it.
  clearWaitingLog(context.id, 'PAUSE');
  await context.persist(tx);
  return true;
}

/** Task 16 review fix (Critical 1 + Critical 3): drains BOTH deferred-work lists a paused/pausing
 *  instance may have accumulated while dispatch was frozen, then checks completion — mirroring
 *  monitor.ts's own normal (allowCascade) shape (drainCascade/failStep, THEN settleIfComplete)
 *  exactly, since a resumed instance is "running" by the time this runs and deserves the SAME
 *  tail every other completion/failure gets.
 *
 *  Failures are replayed FIRST, in the order they originally occurred — each one goes through the
 *  REAL `failStep` (verbatim mode/message), which owns catching (activates + cascades the catch
 *  network) or erroring the trigger exactly as if this had happened while running; a caught
 *  failure's own cascade can complete a context, so `settleIfComplete` runs after every single
 *  replay, not just once at the end. Successor routing is drained second, per completed step,
 *  same reasoning. Snapshots-then-clears each list FIRST (idempotent even if this were ever
 *  called twice) — routing evaluation is itself idempotent besides (materializeAndActivate no-ops
 *  on an already-active existing row).
 *
 *  Returns whether draining settled the WHOLE instance (an uncaught replayed failure, or a nested
 *  SCRIPT failure during routing) — same "settled" contract as drainCascade/failStep everywhere
 *  else; callers must stop immediately when this is true. */
async function drainDeferredWork(tx: Db, context: WorkflowContext, deps: EngineDeps): Promise<boolean> {
  const failures = [...context.state.deferredFailures];
  context.state.deferredFailures = [];
  for (const f of failures) {
    const [row] = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, f.stepOid),
    ));
    if (!row) continue; // defensive — the row is never touched between defer and replay
    const stepCtx = context.contextForNode(row.nodeOid);
    const settled = await failStep(tx, stepCtx, { id: row.id, stepOid: f.stepOid }, f.mode, f.message, deps);
    if (settled) return true;
    await settleIfComplete(tx, context.root, row.nodeOid, deps);
  }

  const oids = [...context.state.deferredRouting];
  context.state.deferredRouting = [];
  for (const oid of oids) {
    const found = context.findStep(oid);
    if (!found) continue; // defensive — every recorded oid belongs to a step this engine created
    const settled = await drainCascade(tx, found.context, [oid], deps);
    if (settled) return true;
    await settleIfComplete(tx, context.root, found.context.spec.oid, deps);
  }
  return false;
}

/**
 * Resuming (spec §7 + E3): every PAUSED action step gets a best-effort `sendCommand(RESUME)`
 * (no capability check — see commandSupported's doc comment); its `started_at` is shifted forward
 * by exactly how long it sat paused (controller Ruling B — `pausedAt` recorded by runPausing),
 * suspending its action-timeout budget for the paused duration rather than letting the deadline
 * run out underneath it, so it resumes with its REMAINING budget. The row then flips back to
 * WAITING_ACTION with an `EXECUTING` trace and is re-armed `wake_at = now` (due immediately,
 * matching Task 15's "prompt dispatch" precedent). Status flips to `running` BEFORE draining
 * deferred work (deliberate ordering — see the doc comment on drainDeferredWork's call site
 * below) and the DB's own NOTIFY trigger on the status write fires automatically (spec §4.6) —
 * nothing else to do here for that half of the brief's "Then status -> running, NOTIFY."
 */
async function runResuming(
  tx: Db, context: WorkflowContext, client: ActionClient | null, deps: EngineDeps, out: AfterCommitCommand[],
): Promise<void> {
  // Gates never reach PAUSED — runPausing only selects WAITING_ACTION action rows (spec
  // 2026-08-29 §5.7); the WAITING_GATE re-arm below is the whole resume story for gates.
  const rows = await tx.select().from(stepInstance).where(and(
    eq(stepInstance.workflowInstanceId, context.id),
    eq(stepInstance.state, 'PAUSED'),
  ));

  for (const row of rows) {
    if (client && row.actionInstanceId && row.actionServerUri) {
      out.push({
        serverUri: row.actionServerUri, actionInstanceId: row.actionInstanceId, command: 'RESUME',
        instanceId: context.id, kind: 'resume', stepRowId: row.id, stepOid: row.stepOid,
      });
    }
    const stepCtx = context.contextForNode(row.nodeOid);
    await stepCtx.recordTrace(tx, row.stepOid, 'EXECUTING');

    // Controller Ruling B: shift startedAt forward by the paused duration so the action-timeout
    // deadline (loop.ts's pollDueStep: startedAt + timeout_ms) reflects the REMAINING budget, not
    // the original one minus however long the operator happened to leave it paused.
    const pausedAtMs = context.root.state.pausedAt[row.stepOid];
    let startedAt = row.startedAt;
    if (pausedAtMs !== undefined && row.startedAt) {
      const pausedDurationMs = deps.now().getTime() - pausedAtMs;
      startedAt = new Date(row.startedAt.getTime() + Math.max(0, pausedDurationMs));
    }
    delete context.root.state.pausedAt[row.stepOid];

    await tx.update(stepInstance).set({
      state: 'WAITING_ACTION', updatedAt: deps.now(), wakeAt: deps.now(), startedAt,
    }).where(eq(stepInstance.id, row.id));
  }

  // Final-review fix: a PAUSE that timed out was undone (the step is WAITING_ACTION again), but
  // it may still have reached the server and paused the action. Send RESUME to each such step;
  // a running action answers 409, which sendCommand counts as delivered. The row is unchanged.
  const undelivered = context.state.pauseUndeliveredWarned;
  if (client && undelivered.length > 0) {
    const waiting = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id),
      eq(stepInstance.state, 'WAITING_ACTION'),
      inArray(stepInstance.stepOid, undelivered),
    ));
    for (const row of waiting) {
      if (!row.actionInstanceId || !row.actionServerUri) continue;
      out.push({
        serverUri: row.actionServerUri, actionInstanceId: row.actionInstanceId, command: 'RESUME',
        instanceId: context.id, kind: 'resume', stepRowId: row.id, stepOid: row.stepOid,
      });
    }
  }

  // GATE spec 2026-08-29 §5.7 (amended) + spec 2026-09-04 §5.4.5: gates and property-acquiring
  // steps, repeating scripts (spec 2026-10-13 §6.5) never flip to PAUSED — their claims are status-gated — but resume re-arms every parked
  // row due-now so the first re-evaluation / acquisition is immediate rather than waiting out
  // the cycle remainder or the grace interval.
  await tx.update(stepInstance).set({ wakeAt: deps.now(), updatedAt: deps.now() }).where(and(
    eq(stepInstance.workflowInstanceId, context.id),
    inArray(stepInstance.state, ['WAITING_GATE', 'WAITING_PROPERTIES', 'WAITING_SCRIPT']),
  ));

  // Flip to 'running' BEFORE draining deferred work: if that drain itself uncaught-fails (a
  // replayed deferred failure with no matching TRY, or a nested SCRIPT failure during routing),
  // its own settleTerminal('errored') call is guarded on status='running' (the default `from`) —
  // that guard must already be satisfied by the time it runs, or the settle would silently no-op
  // (wrong status match) and strand the instance in 'resuming' forever. Both orderings commit
  // atomically in the SAME transaction, so no external reader can ever observe the difference —
  // only the internal correctness of a same-transaction nested failure changes.
  await tx.update(workflowInstance).set({ status: 'running', updatedAt: deps.now() })
    .where(and(eq(workflowInstance.id, context.id), eq(workflowInstance.status, 'resuming')));

  await drainDeferredWork(tx, context, deps);

  // Spec 2026-10-22 §2 + round 3 §1: resume ends the pause request and its bookkeeping.
  context.state.pausingSince = null;
  context.state.pauseUndeliveredWarned = [];
  context.state.pauseUnreachableWarned = [];
  context.state.pauseRefused = [];
  await context.persist(tx);
}

/**
 * Stopping (spec §7 + E2): never-started READY steps and parked WAITING_USER steps are cancelled
 * outright (no trace — neither has a matching reference StepState for "cancelled"; matches the
 * established CANCELLED-is-queue-vocabulary-only convention elsewhere in this engine, e.g.
 * returnAbandon's READY sweep). WAITING_ACTION/PAUSED action steps get a best-effort
 * `sendCommand(STOP)` where capabilities allow it, exactly ONCE per drain (`stoppedActions`
 * dedupes across repeated passes — Task 16 review fix, Critical 2: without this, a stopping
 * instance re-claimed every idle-wait cycle would re-check capabilities and re-send STOP forever)
 * — state stays unchanged either way ("the terminal will arrive via poll/SSE"); a newly-commanded
 * step's `wake_at` is re-armed to `now` so the next due-wake cycle checks promptly rather than
 * waiting out its normal poll cadence. A WORKFLOW PROXY proxy row (WAITING_ACTION, no
 * action_instance_id) counts toward "active steps remain" while its child subtree still has
 * active rows; once the child has drained it is cancelled outright (post-merge ticket fix —
 * see the inline comment in the loop below), so stop-over-child settles instead of wedging. A
 * parked WAIT ALL (EXECUTING) is left completely untouched — no command to send, nothing that
 * drains it — and a stop over one can never settle on its own: that remains the documented
 * case where abort (legal from `stopping`) is the escape hatch. Settles to `stopped` the
 * instant nothing active remains; otherwise stays `stopping` for the next pass.
 *
 * Returns whether this pass did anything OBSERVABLE — a cancellation, a first-time STOP command,
 * or a settle (Task 16 review fix, Critical 2): a stopping instance that's re-claimed with
 * nothing new to do (every row already cancelled/commanded, still waiting on a terminal) must
 * report `false` so the caller (runControlPass -> loop.ts's runOnce) correctly reports "no work",
 * letting the worker loop's idle-wait actually engage instead of spinning at 100% CPU re-claiming
 * the same instance every iteration.
 *
 * Round-2 review fix (New-Critical-1 + New-Important-2, one root cause per the reviewer: "the
 * stop drain has no disposition for a row that is active but has no live action behind it"):
 *   - A row with an ALREADY-DEFERRED failure (monitor.ts's paused/pausing path leaves it sitting
 *     exactly as it was — still WAITING_ACTION/PAUSED, wake_at cleared — its server-side action,
 *     if it ever had one, was already best-effort deleted the moment the failure was deferred) is
 *     resolved FIRST, unconditionally: force ERRORED, no TRY/CATCH — the same rule stopDrain
 *     already applies to a freshly-arriving failure (spec §7: "stop means no new logic"). Without
 *     this, hasActiveSteps sees the row as active forever — nothing will ever poll or command it
 *     again, since it has no live counterpart on any server.
 *   - A genuine ACTION PROXY row (never a WORKFLOW PROXY proxy park — distinguished by
 *     `step_type`, not just `action_instance_id IS NULL`) that was never invoked has no live
 *     action anywhere to command or poll either; cancelled outright, same reasoning as a
 *     never-started READY step (no trace — same "no reference StepState for cancelled"
 *     convention).
 */
async function runStopping(
  tx: Db, context: WorkflowContext, client: ActionClient | null, deps: EngineDeps, out: AfterCommitCommand[],
): Promise<boolean> {
  let didWork = false;

  const deferredFailures = [...context.root.state.deferredFailures];
  context.root.state.deferredFailures = [];
  for (const f of deferredFailures) {
    const [row] = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id), eq(stepInstance.stepOid, f.stepOid),
    ));
    if (!row) continue; // defensive — the row is never touched between defer and this resolution
    const stepCtx = context.contextForNode(row.nodeOid);
    await stepCtx.recordTrace(tx, f.stepOid, 'ERRORED', undefined, f.message);
    await tx.update(stepInstance).set({
      state: 'ERRORED', error: f.message, completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
    }).where(eq(stepInstance.id, row.id));
    didWork = true;
  }

  const rows = await tx.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, context.id));

  for (const row of rows) {
    // GATE spec 2026-08-29 §5.7: a gate is a poller with nothing external to drain — cancel it
    // outright alongside a never-started READY step or a parked WAITING_USER row, rather than
    // leaving it to cycle forever with no live counterpart to wait on. `wake_at` is explicitly
    // cleared here (unlike the other two states in this branch, which never carry one) so a
    // cancelled gate never looks like it still has a pending due-work timer. …and a
    // WAITING_PROPERTIES row (spec 2026-09-04 §5.4.5) — nothing external to drain either —
    // and a WAITING_SCRIPT row (spec 2026-10-13 §6.5) — a poller, like a gate.
    if (row.state === 'READY' || row.state === 'WAITING_USER' || row.state === 'WAITING_GATE' || row.state === 'WAITING_PROPERTIES' || row.state === 'WAITING_SCRIPT') {
      // Spec 2026-10-27 §6.2: a stopped active step ends its run here; a READY one never started.
      if (row.state !== 'READY') await recordStepRun(tx, context.contextForNode(row.nodeOid), row.stepOid, 'stopped');
      await tx.update(stepInstance).set({ state: 'CANCELLED', wakeAt: null, updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
      didWork = true;
      continue;
    }
    if (row.state === 'WAITING_ACTION' || row.state === 'PAUSED') {
      if (row.stepType === 'ACTION PROXY' && row.actionInstanceId === null) {
        // New-Important-2 fix: never invoked (activation happened just before the freeze, or a
        // grace re-invoke was still pending) — no live action anywhere; cancel it outright.
        await recordStepRun(tx, context.contextForNode(row.nodeOid), row.stepOid, 'stopped');
        await tx.update(stepInstance).set({ state: 'CANCELLED', updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
        didWork = true;
        continue;
      }
      if (row.stepType === 'WORKFLOW PROXY' && row.actionInstanceId === null) {
        // Post-merge ticket fix (phase-3 final review #2): a proxy park only ever settles via
        // completeChildWorkflow, which requires the child's END to reach COMPLETED — but this
        // same pass cancels the child's parked steps, so once the child subtree has drained
        // there is nothing left that could EVER complete it: the proxy row would count as
        // active forever and the instance could never settle 'stopped' (abort was the only
        // exit). Disposition mirrors the never-invoked ACTION PROXY above — nothing live
        // behind it, cancel outright (no trace). Only the DIRECT child scope needs checking:
        // a still-running grandchild keeps the child's own proxy row WAITING_ACTION (see
        // isChildComplete's doc comment), so nested levels converge bottom-up — each
        // cancellation reports didWork, keeping the worker loop re-claiming until the
        // outermost proxy falls and settleStoppedIfDrained below finishes the job. A missing
        // childActive entry (defensive; activation always records it before parking) means no
        // child subtree can ever complete it either — same cancel.
        const childOid = context.root.state.childActive[row.stepOid];
        const childActiveRows = childOid === undefined ? [] : await tx.select({ id: stepInstance.id }).from(stepInstance).where(and(
          eq(stepInstance.workflowInstanceId, context.id),
          eq(stepInstance.nodeOid, childOid),
          inArray(stepInstance.state, STOP_ACTIVE_STEP_STATES),
        )).limit(1);
        if (childActiveRows.length === 0) {
          // Recorded before the childActive link goes, like every other proxy-run end.
          await recordStepRun(tx, context.contextForNode(row.nodeOid), row.stepOid, 'stopped');
          await tx.update(stepInstance).set({ state: 'CANCELLED', updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
          delete context.root.state.childActive[row.stepOid]; // mirror completeChildWorkflow's cleanup
          didWork = true;
        }
        continue;
      }
      if (client && row.actionInstanceId && row.actionServerUri) {
        if (context.root.state.stoppedActions.includes(row.stepOid)) continue; // already attempted this drain — nothing new
        const stepCtx = context.contextForNode(row.nodeOid);
        const stepDef = stepCtx.spec.steps.find(s => s.oid === row.stepOid);
        const cfg = stepDef?.action_proxy_config;
        if (!cfg) continue; // defensive
        // Spec 2026-08-20 §4.3 — see runPausing's identical note: the invoked oid is what the
        // container knows this instance by under loose matching.
        const support = commandSupportCached(client, row.actionServerUri, row.actionInvokedOid ?? cfg.action_oid, 'STOP');
        if (support === 'unknown') {
          // Spec 2026-10-22 §2: the server hasn't told us yet — never record the STOP as handled
          // on a guess. stoppedActions is left alone so a later pass retries once warm-up reaches
          // the server. Not didWork (the loop may idle); the persist below still bumps
          // updated_at, so this instance rotates behind other transitional ones in the claim
          // order instead of starving them.
          logWaitingForServer(context.id, 'STOP', row.actionServerUri, deps.now().getTime());
          continue;
        }
        context.root.state.stoppedActions.push(row.stepOid); // record the ATTEMPT — never re-check
        if (support === 'unsupported') continue; // drains naturally — left exactly as-is
        out.push({
          serverUri: row.actionServerUri, actionInstanceId: row.actionInstanceId, command: 'STOP',
          instanceId: context.id, kind: 'step-stop', stepRowId: row.id, stepOid: row.stepOid,
        });
        await tx.update(stepInstance).set({ wakeAt: deps.now(), updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
        didWork = true;
      }
    }
    // EXECUTING (parked WAIT ALL): left untouched, counted below.
  }

  const settled = await settleStoppedIfDrained(tx, context, deps);
  if (settled) {
    didWork = true;
    lastStoppingDrainLogAt.delete(context.id); // terminal — nothing left to heartbeat about
    clearWaitingLog(context.id);
  } else if (!didWork) {
    // Final-review Important 1 fix (I2): nothing NEW happened this pass (the same condition
    // that makes this function correctly report `didWork=false` to the caller) — emit a
    // rate-limited heartbeat so a wedged/slow drain is at least periodically visible in logs,
    // instead of producing zero signal for its entire stay.
    const activeRows = await tx.select({ id: stepInstance.id }).from(stepInstance).where(and(
      eq(stepInstance.workflowInstanceId, context.id),
      inArray(stepInstance.state, STOP_ACTIVE_STEP_STATES),
    ));
    logStoppingDrainOnce(context.id, activeRows.length, deps);
  }
  await context.persist(tx);
  return didWork;
}

/**
 * Aborting (spec §7): every currently-active row (WAITING_ACTION/WAITING_USER/PAUSED/EXECUTING —
 * regardless of node_oid, so a nested child's own rows are swept identically) flips to ABORTED
 * with an `ABORTED` trace; never-started READY rows are cancelled (no trace, same reasoning as
 * stop). A genuine action step among them (`action_instance_id` set) additionally gets a
 * best-effort `sendCommand(ABORT)` then `deleteInstance` — collected here and executed by the
 * caller AFTER this transaction commits, mirroring applyActionTerminal's own "always tries a
 * best-effort deleteInstance afterward" tail, so a slow/unreliable action server never holds the
 * instance row locked. Settles `aborted` unconditionally, in the SAME pass — abort never waits on
 * anything. Abort from `queued` (never started — no step_instance rows exist at all) falls out of
 * this same code path for free: the row scan finds nothing, the loop is a no-op, and the instance
 * settles immediately with an empty trace.
 */
async function runAborting(
  tx: Db, context: WorkflowContext, client: ActionClient | null, deps: EngineDeps,
): Promise<Array<{ serverUri: string; actionInstanceId: string }>> {
  const rows = await tx.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, context.id));
  const toFinalize: Array<{ serverUri: string; actionInstanceId: string }> = [];

  for (const row of rows) {
    if (row.state === 'READY') {
      await tx.update(stepInstance).set({ state: 'CANCELLED', updatedAt: deps.now() }).where(eq(stepInstance.id, row.id));
      continue;
    }
    if (!ACTIVE_ROW_STATES.has(row.state)) continue; // already terminal — untouched

    const stepCtx = context.contextForNode(row.nodeOid);
    await stepCtx.recordTrace(tx, row.stepOid, 'ABORTED');
    await tx.update(stepInstance).set({
      state: 'ABORTED', completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
    }).where(eq(stepInstance.id, row.id));

    if (client && row.actionInstanceId && row.actionServerUri) {
      closeMonitoring(row.id);
      toFinalize.push({ serverUri: row.actionServerUri, actionInstanceId: row.actionInstanceId });
    }
  }

  await settleTerminal(tx, context, 'aborted', 'aborted', deps.now, 'aborting');
  await context.persist(tx);
  return toFinalize;
}

/**
 * Task 16 review fix (Important 1): mirrors loop.ts's own C2 (settleFailedInstance)/I4
 * (recoverFailedStart) precedent — claimInstanceForWork orders by `updated_at ASC`, and a throw
 * inside runControlPass's transaction rolls the WHOLE thing back, including any `updated_at`
 * bump, so a deterministically-failing pass (a CascadeExceededError surfacing from
 * drainDeferredWork, a contextForNode resolution failure, a genuine DB blip) would sort FIRST
 * among every transitional-status instance forever, starving every OTHER pending pause/stop/
 * abort request behind it. Bounded (not unconditional, unlike settleFailedInstance): rotates
 * `updated_at` forward for MAX_CONTROL_PASS_ATTEMPTS attempts (tracked in
 * `engine_state.controlPassAttempts`, mirroring recoverFailedStart's own `startAttempts`), then
 * gives up and settles the instance 'errored'. Runs in its own follow-up transaction (the
 * original one already rolled back).
 *
 * Round-2 review fix (New-Important-4): giving up must not just flip the instance row — mirrors
 * `settleFailedInstance`'s own precedent (loop.ts): every non-terminal step_instance row is
 * force-ERRORED with `wake_at` cleared (a terminal instance must never leave a live wake_at
 * behind — the Task 15 Critical-1 invariant), and any live action-server instance among them is
 * best-effort ABORTed + deleted after the transaction commits, rather than leaked.
 */
export async function recoverFailedControlPass(db: Db, instanceId: string, err: unknown, deps: EngineDeps): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  let toFinalize: Array<{ serverUri: string; actionInstanceId: string }> = [];

  await db.transaction(async (tx) => {
    const claimedId = await claimInstanceById(tx, instanceId);
    if (!claimedId) return; // raced with another worker

    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!row) return;
    if (!TRANSITIONAL_STATUSES.includes(row.status)) return; // already resolved since the failed pass rolled back

    const context = await openContext(tx, row, deps);
    const attempts = context.state.controlPassAttempts + 1;

    if (attempts >= MAX_CONTROL_PASS_ATTEMPTS) {
      await context.recordTrace(tx, null, 'ERRORED', undefined, `${message} (after ${attempts} failed control-pass attempts)`);

      const nonTerminalRows = await tx.select().from(stepInstance).where(and(
        eq(stepInstance.workflowInstanceId, instanceId),
        inArray(stepInstance.state, NON_TERMINAL_STEP_STATES),
      ));
      await recordFailedActiveRuns(tx, context, message);
      await tx.update(stepInstance).set({
        state: 'ERRORED', error: message, completedAt: deps.now(), updatedAt: deps.now(), wakeAt: null,
      }).where(and(
        eq(stepInstance.workflowInstanceId, instanceId),
        inArray(stepInstance.state, NON_TERMINAL_STEP_STATES),
      ));
      for (const r of nonTerminalRows) {
        if (r.actionInstanceId && r.actionServerUri) {
          toFinalize.push({ serverUri: r.actionServerUri, actionInstanceId: r.actionInstanceId });
        }
      }

      await context.persist(tx);
      // `from: row.status` — this give-up settles from WHICHEVER transitional status the row was
      // claimed in (pausing/resuming/stopping/aborting), not settleTerminal's 'running' default;
      // safe to trust the value captured above (line 385) since this transaction holds the row's
      // FOR UPDATE lock for its entire duration and nothing else here writes `status` first.
      await settleTerminal(tx, context, 'errored', 'errored', deps.now, row.status);
      await reconcileAndNotify(tx, instanceId, deps);
      return;
    }

    context.state.controlPassAttempts = attempts;
    await context.persist(tx);
  });

  const client = deps.invoker.client;
  for (const { serverUri, actionInstanceId } of toFinalize) {
    await client?.sendCommand(serverUri, actionInstanceId, 'ABORT').catch(() => {});
    await client?.deleteInstance(serverUri, actionInstanceId).catch(() => {});
  }
}

/**
 * Claim ONE instance sitting in a transitional status (FOR UPDATE SKIP LOCKED, oldest first —
 * same claimInstanceForWork every other unit of work uses) and dispatch it to the matching pass,
 * entirely within one transaction. Returns whether it found (and did meaningful work on) an
 * instance — the loop's fourth (and, until Task 17's retention sweeper, last) unit of work; see
 * loop.ts's runOnce. A throw anywhere in the dispatched pass is recovered internally (Important 1
 * fix, above) rather than propagated — this function never throws for a per-instance reason,
 * exactly like processDueActionWork's own posture.
 */
export async function runControlPass(db: Db, deps: EngineDeps): Promise<boolean> {
  let toFinalize: Array<{ serverUri: string; actionInstanceId: string }> = [];
  let afterCommit: AfterCommitCommand[] = [];
  let claimedInstanceId: string | null = null;

  // Data safety round 3: first retry any undo of an undelivered command whose instance was busy.
  const undid = await processPendingSendFailures(db, deps);

  try {
    await warmCapabilities(db, deps.invoker.client, 'control', deps.now());
    const did = await db.transaction(async (tx) => {
      const instanceId = await claimInstanceForWork(tx, TRANSITIONAL_STATUSES);
      if (!instanceId) return false;
      claimedInstanceId = instanceId;
      const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
      if (!row) return false;

      const context = await openContext(tx, row, deps);
      // Round-2 review fix (New-Important-3): reset the bounded-retry counter on every pass
      // ATTEMPT, not just on a give-up. This only sticks if the pass below actually succeeds — a
      // throw anywhere in the switch rolls back this WHOLE transaction, reset included, so
      // recoverFailedControlPass still sees whatever count survived from before. Without this,
      // `controlPassAttempts` is a lifetime counter: three separate, non-consecutive transient
      // blips recovered across an instance's whole life (each its own successful pause/resume
      // cycle in between) would settle a perfectly healthy instance errored on the third one,
      // even though nothing was ever actually 2 failures deep at any single point in time.
      context.state.controlPassAttempts = 0;
      const client = deps.invoker.client;
      afterCommit = []; // only a committed pass's commands are ever sent

      let result: boolean;
      switch (row.status) {
        case 'pausing':  result = await runPausing(tx, context, client, deps, afterCommit); break;
        case 'resuming': await runResuming(tx, context, client, deps, afterCommit); result = true; break;
        case 'stopping': result = await runStopping(tx, context, client, deps, afterCommit); break;
        case 'aborting': toFinalize = await runAborting(tx, context, client, deps); result = true; break;
        default: return false; // defensive — the claim query's own status filter already excludes this
      }
      await reconcileAndNotify(tx, instanceId, deps);
      return result;
    });

    await sendAfterCommit(db, deps.invoker.client, afterCommit, deps);
    for (const { serverUri, actionInstanceId } of toFinalize) {
      await deps.invoker.client?.sendCommand(serverUri, actionInstanceId, 'ABORT').catch(() => {});
      await deps.invoker.client?.deleteInstance(serverUri, actionInstanceId).catch(() => {});
    }

    return did || undid;
  } catch (err) {
    if (!claimedInstanceId) throw err; // the claim itself failed — nothing instance-specific to recover
    await recoverFailedControlPass(db, claimedInstanceId, err, deps);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mission-engine] instance ${claimedInstanceId} control pass failed, recovery engaged: ${message}`);
    return true;
  }
}
