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
// Data safety round 3 (spec 2026-10-22-data-safety-3 §1): a STOP/PAUSE is recorded inside the
// locked pass and sent after commit (sendAfterCommit). When the send fails, this module decides
// what the failure means and, if it matters, changes the record in a short follow-up transaction:
//
//   unreachable (network error, timeout, 5xx) — undo the record, so the pass sends it again once
//                the server answers (the origin is also put into the warm-up's back-off);
//   refused     (other 4xx, auth rejection, not allowlisted) — keep the record, show a WARNING;
//   gone        (404, the server no longer knows the instance) — treated as delivered; the poll
//                path marks the step lost.
//
// The undo follows recoverFailedControlPass's pattern (claim, open context, change, persist) and
// makes no network call. Its claim is SKIP LOCKED, so it can find the instance busy; a busy undo
// waits in an in-memory queue that runControlPass retries every pass. An engine restart between
// the send and the undo can lose that one undo (accepted in the spec).
import { and, eq } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import {
  ActionCommandFailed, ActionServerNotAllowed, ActionsKeyRejected, BrokerTokenRejected,
} from '../actions/client.js';
import { openContext } from './context.js';
import { TERMINAL_STEP_STATES } from './transition.js';
import { claimInstanceById } from '../loop.js';
import { GATE_STOP_RETRY_MS } from './gate.js';
import { reconcileAndNotify } from './reconcile.js';
import { PAUSE_UNKNOWN_LIMIT_MS, UNREACHABLE_WARNING, type AfterCommitCommand } from './control.js';

/** Spec 2026-10-22-data-safety-3 §1: written at most once per step per pause request. */
export const PAUSE_RETRYING_WARNING = 'PAUSE could not be delivered — action server unreachable; retrying';

export type SendFailure = 'unreachable' | 'gone' | 'refused';

/** What a failed sendCommand means. Anything not known to be a refusal or a 404 is treated as
 *  unreachable — retrying is the safe default for a STOP/PAUSE the engine still owes. */
export function classifySendError(err: unknown): SendFailure {
  if (err instanceof ActionServerNotAllowed || err instanceof ActionsKeyRejected || err instanceof BrokerTokenRejected) {
    return 'refused';
  }
  if (err instanceof ActionCommandFailed) {
    if (err.status === 404) return 'gone';
    if (err.status >= 400 && err.status < 500) return 'refused';
    return 'unreachable';
  }
  return 'unreachable';
}

const REASON_MAX_LENGTH = 200;

/** A short, log- and trace-safe reason. The client's error text already passes through
 *  bodyOrRefusal, which never carries a credential. */
export function sendFailureReason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > REASON_MAX_LENGTH ? `${text.slice(0, REASON_MAX_LENGTH - 1)}…` : text;
}

type PendingItem = { cmd: AfterCommitCommand; failure: 'unreachable' | 'refused'; reason: string };

/** Undos whose claim found the instance busy, retried by processPendingSendFailures. */
const pending: PendingItem[] = [];

/** Queue an undo for the next pass — a busy claim, or an undo attempt that threw (a DB blip), so
 *  the undo is never silently skipped. */
export function queueSendFailure(cmd: AfterCommitCommand, failure: 'unreachable' | 'refused', reason: string): void {
  pending.push({ cmd, failure, reason });
}

/** Test-only: empty the queue between tests. */
export function __resetPendingSendFailures(): void {
  pending.length = 0;
}

type Outcome = 'applied' | 'stale' | 'busy';

/** Apply one send failure to the record it is about. 'busy' (the instance row is locked by
 *  another worker) queues it for the next pass; 'stale' means the record already moved on and
 *  nothing was changed. No network call. */
export async function applySendFailure(
  db: Db, cmd: AfterCommitCommand, failure: 'unreachable' | 'refused', deps: EngineDeps, reason: string,
): Promise<Outcome> {
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const claimedId = await claimInstanceById(tx, cmd.instanceId);
    if (!claimedId) {
      // SKIP LOCKED also answers no row when the row is gone (the run was deleted) — that is
      // stale, not busy, or it would be retried forever. Unlocked read, so a held lock is no bar.
      const [exists] = await tx.select({ id: workflowInstance.id }).from(workflowInstance)
        .where(eq(workflowInstance.id, cmd.instanceId));
      return exists ? 'busy' : 'stale';
    }
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, cmd.instanceId));
    if (!row) return 'stale';

    switch (cmd.kind) {
      case 'step-stop': {
        if (row.status !== 'stopping') return 'stale';
        const [step] = await tx.select().from(stepInstance).where(and(
          eq(stepInstance.id, cmd.stepRowId), eq(stepInstance.workflowInstanceId, cmd.instanceId),
        ));
        if (!step || step.actionInstanceId !== cmd.actionInstanceId || TERMINAL_STEP_STATES.has(step.state)) return 'stale';
        const context = await openContext(tx, row, deps);
        if (failure === 'unreachable') {
          const before = context.root.state.stoppedActions;
          if (!before.includes(cmd.stepOid)) return 'stale';
          context.root.state.stoppedActions = before.filter(oid => oid !== cmd.stepOid);
        } else {
          await context.contextForNode(step.nodeOid).recordTrace(
            tx, cmd.stepOid, 'WARNING', undefined, `STOP could not be delivered: ${reason}`,
          );
        }
        await context.persist(tx);
        await reconcileAndNotify(tx, cmd.instanceId, deps);
        return 'applied';
      }
      case 'gate-stop': {
        const gateOid = cmd.gateOid;
        if (!gateOid) return 'stale';
        const [pred] = await tx.select().from(stepInstance).where(and(
          eq(stepInstance.id, cmd.stepRowId), eq(stepInstance.workflowInstanceId, cmd.instanceId),
        ));
        if (!pred || pred.actionInstanceId !== cmd.actionInstanceId || TERMINAL_STEP_STATES.has(pred.state)) return 'stale';
        const [gateRow] = await tx.select().from(stepInstance).where(and(
          eq(stepInstance.workflowInstanceId, cmd.instanceId), eq(stepInstance.stepOid, gateOid),
        ));
        if (!gateRow || TERMINAL_STEP_STATES.has(gateRow.state)) return 'stale';
        const context = await openContext(tx, row, deps);
        const live = context.root.state.armedGates[gateOid];
        if (!live || !live.open || !live.stopSent) return 'stale';
        if (failure === 'unreachable') {
          live.stopSent = false;
          await tx.update(stepInstance).set({
            wakeAt: new Date(deps.now().getTime() + GATE_STOP_RETRY_MS), updatedAt: deps.now(),
          }).where(eq(stepInstance.id, gateRow.id));
        } else {
          await context.contextForNode(gateRow.nodeOid).recordTrace(
            tx, gateOid, 'WARNING', undefined, `STOP could not be delivered: ${reason}`,
          );
        }
        await context.persist(tx);
        await reconcileAndNotify(tx, cmd.instanceId, deps);
        return 'applied';
      }
      case 'pause': {
        if (row.status !== 'pausing' && row.status !== 'paused') return 'stale';
        const [step] = await tx.select().from(stepInstance).where(and(
          eq(stepInstance.id, cmd.stepRowId), eq(stepInstance.workflowInstanceId, cmd.instanceId),
        ));
        if (!step || step.state !== 'PAUSED' || step.actionInstanceId !== cmd.actionInstanceId) return 'stale';
        const context = await openContext(tx, row, deps);
        const state = context.root.state;
        // Only the pause request this PAUSE came from: after resume and re-pause the step has a
        // new pausedAt, and that later PAUSE must not be reverted.
        if (cmd.pausedAtMs === undefined || state.pausedAt[cmd.stepOid] !== cmd.pausedAtMs) return 'stale';
        const stepCtx = context.contextForNode(step.nodeOid);
        const nowMs = deps.now().getTime();

        // Both failures: the action was never paused, so the step goes back to running. The
        // PAUSED trace already written stays (the trace is a log); the WARNING explains it.
        await tx.update(stepInstance).set({ state: 'WAITING_ACTION', updatedAt: deps.now() })
          .where(eq(stepInstance.id, step.id));
        delete state.pausedAt[cmd.stepOid];

        if (failure === 'refused') {
          // Not retried: the pausing pass skips this step from now on, as for an action that
          // doesn't support PAUSE, so the run settles (or stays) paused.
          if (!state.pauseRefused.includes(cmd.stepOid)) {
            state.pauseRefused.push(cmd.stepOid);
            await stepCtx.recordTrace(tx, cmd.stepOid, 'WARNING', undefined, `PAUSE could not be delivered: ${reason}`);
          }
        } else if (state.pausingSince != null && nowMs - state.pausingSince >= PAUSE_UNKNOWN_LIMIT_MS) {
          // The limit is reached: end the cycle. The run stays as it is (a paused run stays paused).
          // Recorded as undelivered so resume sends RESUME (the PAUSE may have reached the server);
          // the unreachable WARNING is written once per step (the pausing pass may write it too).
          if (!state.pauseUndeliveredWarned.includes(cmd.stepOid)) state.pauseUndeliveredWarned.push(cmd.stepOid);
          if (!state.pauseUnreachableWarned.includes(cmd.stepOid)) {
            state.pauseUnreachableWarned.push(cmd.stepOid);
            await stepCtx.recordTrace(tx, cmd.stepOid, 'WARNING', undefined, UNREACHABLE_WARNING);
          }
        } else {
          state.pausingSince ??= nowMs;
          if (!state.pauseUndeliveredWarned.includes(cmd.stepOid)) {
            state.pauseUndeliveredWarned.push(cmd.stepOid);
            await stepCtx.recordTrace(tx, cmd.stepOid, 'WARNING', undefined, PAUSE_RETRYING_WARNING);
          }
          // Written the way runPausing writes its settle: a status-guarded update.
          await tx.update(workflowInstance).set({ status: 'pausing', updatedAt: deps.now() })
            .where(and(eq(workflowInstance.id, cmd.instanceId), eq(workflowInstance.status, 'paused')));
        }
        await context.persist(tx);
        await reconcileAndNotify(tx, cmd.instanceId, deps);
        return 'applied';
      }
      // A RESUME failure is only logged (sendAfterCommit).
      default:
        return 'stale';
    }
  });
  if (outcome === 'busy') queueSendFailure(cmd, failure, reason);
  return outcome;
}

/** Retry every queued busy undo once. One still busy goes back on the queue (applySendFailure
 *  re-queues it); 'applied' and 'stale' drop it. Returns whether any undo applied. Never throws. */
export async function processPendingSendFailures(db: Db, deps: EngineDeps): Promise<boolean> {
  if (pending.length === 0) return false;
  const items = pending.splice(0, pending.length);
  let applied = false;
  for (const item of items) {
    try {
      if (await applySendFailure(db, item.cmd, item.failure, deps, item.reason) === 'applied') applied = true;
    } catch (err) {
      // A DB blip: keep the item for the next pass rather than lose the undo.
      queueSendFailure(item.cmd, item.failure, item.reason);
      console.error(`[mission-engine] instance ${item.cmd.instanceId} undo of an undelivered ${item.cmd.command} failed: ${sendFailureReason(err)}`);
    }
  }
  return applied;
}
