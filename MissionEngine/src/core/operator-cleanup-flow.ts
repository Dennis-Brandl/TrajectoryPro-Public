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
// Spec 2026-11-06 §5.1 (Operator Stop) — the transactional half of the Operator cleanup: what the
// halt pass does at its "drained" point (afterHaltDrained), how the cleanup CATCH network starts
// (startOperatorCleanup) and how it ends (endOperatorCleanup). The pure constants and the row
// lookup live in operator-cleanup.ts (see its header for why the split).
//
// Live actions still running in a cleanup network when it ends (a RETURN on one branch while an
// action runs on another) are ABORTed and DELETEd after commit: endOperatorCleanup records them
// in the root's engine_state (operatorCleanup.pendingAborts) in the ending transaction, and the
// loop sends the commands (finalizeOrphanedActions), never inside the transaction. Durable, so an
// engine restart between the commit and the send still aborts them. An entry is only acted on
// once no live step row still names that action instance.
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { workflowInstance, stepInstance, RUNTIME_FINAL_STATES } from 'mission-control-db/src/db/schema/index';
import { latestControlEvent } from 'mission-control-db/src/dao/control-events';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { PendingCleanupAbort } from './engine-state.js';
import {
  settleTerminal, knownStepOids, envSweepTokens, captureEnvReservations, releaseEnvReservations,
  type WorkflowContext,
} from './context.js';
import {
  activateAndCascade, settleIfComplete, tearDownForOperatorEnd, catchNetworkOids, NON_TERMINAL_STEP_STATES,
} from './transition.js';
import { closeMonitoring } from '../actions/monitor.js';
import {
  CLEANUP_STATUS, FINAL_STATUS, HALT_STATUS, OPERATOR_MODE, operatorRowFor, envHoldKey, type CleanupKind,
  pendingAbortScan, queueCleanupAborts,
} from './operator-cleanup.js';

export { notePendingAbortsQueued } from './operator-cleanup.js';
import { canonicalStepType } from './step-handlers.js';

const LABEL: Record<CleanupKind, string> = { stop: 'Operator Stop', abort: 'Operator Abort' };

/**
 * Called at the halt pass's "drained" point (today's settle point). Settles exactly as today —
 * `FINAL_STATUS[kind]` from `HALT_STATUS[kind]` — when the root has no row for this kind, the
 * row's CATCH is missing, the operator asked to skip (`cleanup_skip === kind`), or a cleanup of
 * this kind already ran (this halt is the skip's re-halt; that one ends with its own end trace).
 * Otherwise starts the cleanup. Returns true when the instance settled.
 */
export async function afterHaltDrained(tx: Db, root: WorkflowContext, kind: CleanupKind, deps: EngineDeps): Promise<boolean> {
  const row = operatorRowFor(root.spec, kind);
  const catchStep = row ? findCatch(root, row.catch_id) : undefined;
  const oc = root.state.operatorCleanup;
  const alreadyRan = oc?.kind === kind && oc.phase === 'cleanup';
  let skip = false;
  if (alreadyRan || (row && catchStep)) {
    const [inst] = await tx.select({ cleanupSkip: workflowInstance.cleanupSkip }).from(workflowInstance)
      .where(eq(workflowInstance.id, root.id));
    skip = inst?.cleanupSkip === kind;
  }
  if (alreadyRan) {
    if (!skip) {
      // Only the operator's skip request moves a running cleanup back to the halt; anything else
      // reaching here is a broken invariant. Never end a live cleanup as "skipped" on a guess:
      // leave the status as it is and say so loudly.
      console.error(
        `[mission-engine] instance ${root.id}: ${LABEL[kind]} halt drained after its cleanup ` +
        `started, but cleanup_skip is not '${kind}' — leaving the instance as it is`,
      );
      return false;
    }
    await endOperatorCleanup(tx, root, deps, { kind: 'skipped' });
    return true;
  }
  if (!row || !catchStep || skip) {
    // No cleanup ever started: nothing new is written (C9 — byte for byte today's settle).
    await settleTerminal(tx, root, FINAL_STATUS[kind], FINAL_STATUS[kind], deps.now, HALT_STATUS[kind]);
    return true;
  }
  await startOperatorCleanup(tx, root, kind, deps);
  return false;
}

export async function startOperatorCleanup(tx: Db, root: WorkflowContext, kind: CleanupKind, deps: EngineDeps): Promise<void> {
  const row = operatorRowFor(root.spec, kind);
  const catchStep = row ? findCatch(root, row.catch_id) : undefined;
  if (!row || !catchStep) throw new Error(`startOperatorCleanup: no ${OPERATOR_MODE[kind]} row with a CATCH on ${root.id}`);
  const catchOid = catchStep.oid;
  const nowIso = deps.now().toISOString();

  // 1. Who sent it (U8 / C7).
  const actor = await latestControlEvent(tx, root.id, kind);
  const name = actor?.actorName || 'system';

  // 2. The halted main flow's queued resource waiters are dropped; the cleanup network's own
  //    steps are left alone.
  const network = catchNetworkOids(root, row.catch_id);
  const others = new Set([...knownStepOids(root)].filter(oid => !network.has(oid)));
  root.resources?.cancelQueuedWaiters(others);
  if (root.envResources) {
    // Same capture-before-cancel, release-after-cancel give-back as every other env sweep
    // (captureEnvReservations' own doc comment).
    const envOthers = envSweepTokens(root.id, others);
    const reservations = captureEnvReservations(root, envOthers);
    root.envResources.cancelQueuedWaiters(envOthers);
    releaseEnvReservations(root, reservations);
  }

  // 3. The persisted cleanup phase (an engine restart resumes it). U6: every unit the workflow
  //    holds right now stays held, and a cleanup step's Acquire on it is granted at once.
  const inheritedHolds = new Set<string>();
  for (const e of root.resources?.getSnapshot() ?? []) {
    if (e.inUse > 0) inheritedHolds.add(e.name);
  }
  for (const h of root.state.envHolds) inheritedHolds.add(envHoldKey(h.name));
  const prev = root.state.operatorCleanup;
  root.state.operatorCleanup = {
    kind, phase: 'cleanup', catchOid,
    haltStartedAt: prev?.haltStartedAt ?? actor?.at ?? nowIso,
    cleanupStartedAt: nowIso,
    inheritedHolds: [...inheritedHolds], inheritedUse: {}, abortPending: [],
    pendingAborts: prev?.pendingAborts ?? [],
  };

  // 4. The CATCH's trigger info (C7): there is no trigger step.
  root.state.activeCatches[catchOid] = {
    catch_oid: catchOid,
    trigger_step_oid: '',
    trigger_step_name: '',
    trigger_reason: OPERATOR_MODE[kind],
    error_message: `${kind === 'stop' ? 'Stopped' : 'Aborted'} by operator ${name}`,
    activated_at: nowIso,
  };

  // 5. History marker. A person is recorded by id (History resolves the name: the existing
  //    `[by <uuid>]` OPERATOR convention); anything else by its label.
  const by = actor?.actorKind === 'user' && actor.actorUserId ? `[by ${actor.actorUserId}]` : `(by ${name})`;
  await root.recordTrace(tx, null, 'OPERATOR', undefined, `${LABEL[kind]} cleanup started ${by}`);

  // 6. Still visibly stopping/aborting, but running-like for dispatch.
  const moved = await tx.update(workflowInstance)
    .set({ status: CLEANUP_STATUS[kind], updatedAt: deps.now() })
    .where(and(eq(workflowInstance.id, root.id), eq(workflowInstance.status, HALT_STATUS[kind])))
    .returning({ id: workflowInstance.id });
  if (moved.length === 0) throw new Error(`startOperatorCleanup: ${root.id} is not '${HALT_STATUS[kind]}'`);

  // 7. Run the network. A CATCH has no predecessor; its own oid is passed as the source (only a
  //    WAIT ALL target ever reads it) — failStep passes the trigger step there.
  const settled = await activateAndCascade(tx, root, catchOid, catchOid, deps);
  // A network that ran to its end inline without reaching a RETURN has drained.
  if (!settled) await settleIfComplete(tx, root, root.spec.oid, deps);

  // 8.
  await root.persist(tx);
}

export type OperatorCleanupEnd =
  | { kind: 'return' } | { kind: 'drained' } | { kind: 'failure'; message: string } | { kind: 'skipped' };

/**
 * Ends the cleanup and settles `FINAL_STATUS[kind]` (U3 / C2 — never errored). Settles from
 * whichever of `CLEANUP_STATUS[kind]` (the cleanup ran to its end) or `HALT_STATUS[kind]` (the
 * skip's re-halt) the instance is in. On an instance in neither (already settled) it is a no-op,
 * so a second end in the same transaction writes nothing.
 */
export async function endOperatorCleanup(tx: Db, root: WorkflowContext, deps: EngineDeps, reason: OperatorCleanupEnd): Promise<void> {
  const oc = root.state.operatorCleanup;
  if (!oc) return;
  const [inst] = await tx.select({ status: workflowInstance.status }).from(workflowInstance)
    .where(eq(workflowInstance.id, root.id));
  const from = inst?.status === CLEANUP_STATUS[oc.kind] ? CLEANUP_STATUS[oc.kind]
    : inst?.status === HALT_STATUS[oc.kind] ? HALT_STATUS[oc.kind] : null;
  if (!from) return;

  // 1. Tear down whatever the network still has running; live actions are aborted after commit.
  //    They are recorded in engine_state in this same transaction (persisted below), so the
  //    abort survives an engine restart between this commit and the loop's next unit.
  const live = await tearDownForOperatorEnd(tx, root, deps);
  queueCleanupAborts(root, live);

  // 2.
  const why = reason.kind === 'return' ? 'RETURN reached'
    : reason.kind === 'drained' ? 'cleanup finished'
      : reason.kind === 'failure' ? `step failed: ${reason.message}`
        : 'skipped by operator';
  await root.recordTrace(tx, null, 'OPERATOR', undefined, `${LABEL[oc.kind]} cleanup ended: ${why}`);

  // 3-5.
  delete root.state.activeCatches[oc.catchOid];
  await root.persist(tx);
  await settleTerminal(tx, root, FINAL_STATUS[oc.kind], FINAL_STATUS[oc.kind], deps.now, from);
}

function findCatch(root: WorkflowContext, catchId: string) {
  return root.spec.steps.find(s => canonicalStepType(s.step_type) === 'CATCH' && s.catch_id === catchId);
}

// ── live actions torn down with the cleanup network: ABORT + DELETE after commit ──

export interface LiveActionRef { stepRowId: string; serverUri: string; actionInstanceId: string }

/** How long a queued entry is kept while it cannot be sent — a live row still names its action
 *  (only possible if the action id was reused), or the ABORT itself failed — before it is
 *  dropped. Every entry is attempted at least once, however old it is (an engine restart). */
const ORPHAN_KEEP_MS = 60_000;
/** Minimum gap between scans while the only entries left are ones waiting to be retried. */
const RETRY_SCAN_MS = 2_000;

// Per-process scan state (pendingAbortScan, in operator-cleanup.ts): `pendingMaybe` is true at
// start-up (a fresh process scans once, picking up whatever a previous one left), set again
// whenever a cleanup end queues live actions, cleared by a scan that finds none. Keeps the loop
// from querying for them on every unit.
//
// The flag is set while the ending transaction is still open, so a scan by another loop slot can
// run before that commit and see nothing. Such an empty scan never clears the flag within
// QUEUE_SETTLE_MS of the last queuing: it schedules another scan instead, so a queued entry can
// never be stranded until the next cleanup or restart.
let draining = false;
/** How long after the last queuing an empty scan keeps looking (covers the ending transaction's
 *  commit; a transaction that rolled back simply leaves nothing to find). */
const QUEUE_SETTLE_MS = 10_000;
/** Gap between those follow-up scans. */
const SETTLE_SCAN_MS = 250;

/** Test-only: the per-process state of a freshly started engine (the durable queue is untouched). */
export function __resetOrphanedActions(): void {
  pendingAbortScan.pendingMaybe = true;
  pendingAbortScan.nextScanAt = 0;
  pendingAbortScan.lastQueuedAt = 0;
  draining = false;
}

const PENDING_PATH = sql`${workflowInstance.engineState} #> '{operatorCleanup,pendingAborts}'`;

/** Best-effort ABORT + DELETE for every pending cleanup abort recorded in any instance's
 *  engine_state (settled rows included) whose action no live step row still names. Called by
 *  the loop outside any transaction; each entry is cleared once its ABORT was sent. Returns
 *  whether it sent anything. */
export async function finalizeOrphanedActions(db: Db, deps: EngineDeps): Promise<boolean> {
  if (!pendingAbortScan.pendingMaybe || draining || Date.now() < pendingAbortScan.nextScanAt) return false;
  draining = true;
  try {
    let rows: Array<{ id: string; pending: unknown }>;
    try {
      rows = await db.select({ id: workflowInstance.id, pending: PENDING_PATH })
        .from(workflowInstance)
        .where(sql`${PENDING_PATH} is not null and ${PENDING_PATH} <> '[]'::jsonb`);
    } catch {
      return false; // a DB blip: the flag stays set, retried next unit
    }
    if (rows.length === 0) {
      if (Date.now() - pendingAbortScan.lastQueuedAt < QUEUE_SETTLE_MS) {
        pendingAbortScan.nextScanAt = Date.now() + SETTLE_SCAN_MS; // the queuing transaction may not have committed yet
      } else {
        pendingAbortScan.pendingMaybe = false;
      }
      return false;
    }
    const client = deps.invoker.client;
    let sent = false;
    let left = false;
    for (const row of rows) {
      const entries = Array.isArray(row.pending) ? (row.pending as PendingCleanupAbort[]) : [];
      const done: PendingCleanupAbort[] = [];
      for (const entry of entries) {
        const age = Date.now() - Date.parse(entry.queuedAt);
        let owned: unknown[];
        try {
          // A row of a settled instance owns nothing: a settle that ended the cleanup without
          // tearing its rows down (the settleTerminal redirect) leaves them non-terminal.
          owned = await db.select({ id: stepInstance.id }).from(stepInstance)
            .innerJoin(workflowInstance, eq(workflowInstance.id, stepInstance.workflowInstanceId))
            .where(and(
              eq(stepInstance.actionInstanceId, entry.actionInstanceId),
              inArray(stepInstance.state, NON_TERMINAL_STEP_STATES),
              notInArray(workflowInstance.status, [...RUNTIME_FINAL_STATES]),
            )).limit(1);
        } catch {
          left = true; // a DB blip: never silently lose the abort — retried later
          continue;
        }
        if (owned.length > 0) {
          // Some live row still names this action: the engine owns it — never abort it.
          if (age < ORPHAN_KEEP_MS) { left = true; } else { done.push(entry); }
          continue;
        }
        closeMonitoring(entry.stepRowId);
        if (!client) { done.push(entry); continue; }
        try {
          await client.sendCommand(entry.serverUri, entry.actionInstanceId, 'ABORT');
        } catch (err) {
          if (age < ORPHAN_KEEP_MS) { left = true; continue; }
          console.warn(
            `[mission-engine] instance ${row.id}: giving up the Operator cleanup ABORT of action ` +
            `${entry.actionInstanceId} on ${entry.serverUri}: ${(err as Error)?.message ?? err}`,
          );
          done.push(entry);
          continue;
        }
        await client.deleteInstance(entry.serverUri, entry.actionInstanceId).catch(() => {});
        sent = true;
        done.push(entry);
      }
      if (done.length > 0) {
        try {
          await clearPendingAborts(db, row.id, done);
        } catch {
          left = true; // cleared next time (a repeat ABORT is answered 409 and is harmless)
        }
      }
    }
    if (left) pendingAbortScan.nextScanAt = Date.now() + RETRY_SCAN_MS;
    return sent;
  } finally {
    draining = false;
  }
}

/** Removes `done` from the instance's pending list, under the row lock, keeping anything added
 *  since the scan read it. */
async function clearPendingAborts(db: Db, instanceId: string, done: PendingCleanupAbort[]): Promise<void> {
  const key = (e: PendingCleanupAbort) => `${e.stepRowId}|${e.actionInstanceId}`;
  const gone = new Set(done.map(key));
  await db.transaction(async (tx) => {
    const [r] = await tx.select({ pending: PENDING_PATH }).from(workflowInstance)
      .where(eq(workflowInstance.id, instanceId)).for('update');
    if (!r || !Array.isArray(r.pending)) return;
    const remaining = (r.pending as PendingCleanupAbort[]).filter(e => !gone.has(key(e)));
    await tx.update(workflowInstance).set({
      engineState: sql`jsonb_set(${workflowInstance.engineState}, '{operatorCleanup,pendingAborts}', ${JSON.stringify(remaining)}::jsonb)`,
    }).where(eq(workflowInstance.id, instanceId));
  });
}
