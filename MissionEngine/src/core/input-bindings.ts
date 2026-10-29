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
// Input-binding due-work (spec 2026-09-04 §5.4.4): claim ONE 'running' instance with a due
// WAITING_PROPERTIES row, fetch that step's bound Action Properties OUTSIDE any transaction
// (GATE spec §6.2's rule), then resume the step's activation in a fresh transaction with the
// fetched values overlaid on its input parameters. Same locking protocol as every other unit
// (claim the workflow_instance row FOR UPDATE SKIP LOCKED; step rows never independently
// locked). The claim keys on STATE alone: the action claim selects WAITING_ACTION/PAUSED, the
// gate claim WAITING_GATE — the three wake_at consumers are disjoint by construction.
import { eq, and, isNotNull, lte, inArray } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import { openContext } from './context.js';
import { failStep, drainCascade, settleIfComplete, runStepActivation } from './transition.js';
import { claimInstanceForWork, claimInstanceById, settleFailedInstance, logInstanceSettledError } from '../loop.js';
import { reconcileAndNotify } from './reconcile.js';
import { fetchPropertyOverlay } from './property-overlay.js';

function addSecondsTo(d: Date, secs: number): Date {
  return new Date(d.getTime() + secs * 1000);
}

/** What the claiming transaction hands off to the outside-any-transaction fetch, and back to
 *  the fresh re-claim transaction that resumes the activation. */
interface PendingInputFetch {
  instanceId: string; stepInstanceId: string; stepOid: string; nodeOid: string; workCenterId: string;
}

/** Unit of work in runOnce between due-gate work and the control pass. Returns true iff it
 *  claimed something (even a raced-away row counts — the claim itself bumped updated_at). */
export async function processDueInputBindingWork(db: Db, deps: EngineDeps): Promise<boolean> {
  let claimedInstanceId: string | null = null;
  let pending: PendingInputFetch | null = null;
  try {
    const didWork = await db.transaction(async (tx) => {
      const asOf = deps.now();
      const dueCandidates = await tx.select({ workflowInstanceId: stepInstance.workflowInstanceId })
        .from(stepInstance)
        .where(and(
          eq(stepInstance.state, 'WAITING_PROPERTIES'),
          isNotNull(stepInstance.wakeAt), lte(stepInstance.wakeAt, asOf),
        ));
      if (dueCandidates.length === 0) return false;
      const candidateIds = [...new Set(dueCandidates.map(r => r.workflowInstanceId))];
      const instanceId = await claimInstanceForWork(tx, ['running'], inArray(workflowInstance.id, candidateIds));
      if (!instanceId) return false;
      claimedInstanceId = instanceId;
      const [wfRow] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
      if (!wfRow) return false;
      const dueRows = await tx.select().from(stepInstance).where(and(
        eq(stepInstance.workflowInstanceId, instanceId),
        eq(stepInstance.state, 'WAITING_PROPERTIES'),
        isNotNull(stepInstance.wakeAt), lte(stepInstance.wakeAt, asOf),
      )).orderBy(stepInstance.wakeAt, stepInstance.id);
      const target = dueRows[0];
      if (!target) {
        // Raced — bump updated_at so claim ordering doesn't head-of-line block (the
        // claimDueActionStep precedent).
        await tx.update(workflowInstance).set({ updatedAt: deps.now() }).where(eq(workflowInstance.id, instanceId));
        return false;
      }
      // Never fetch over the network while holding the instance lock (§6.2). Re-arm one grace
      // interval ahead as the crash guard (claimDueActionStep's own invokeGraceSecs meaning),
      // commit, fetch, then resume in a FRESH transaction.
      await tx.update(stepInstance).set({
        wakeAt: addSecondsTo(deps.now(), deps.config.invokeGraceSecs), updatedAt: deps.now(),
      }).where(eq(stepInstance.id, target.id));
      pending = {
        instanceId, stepInstanceId: target.id, stepOid: target.stepOid,
        nodeOid: target.nodeOid, workCenterId: wfRow.workCenterId,
      };
      return true;
    });
    if (!pending) return didWork;
    // Local const: `pending` is a `let` reassigned inside the transaction closure above, so TS
    // won't carry the null-check narrowing into the nested closures below.
    const inputFetch: PendingInputFetch = pending;
    const fetched = await fetchPropertyOverlay(
      db, deps, inputFetch, s => s.action_property_bindings ?? [], 'input binding'); // outside any transaction
    await db.transaction(async (tx) => {
      const claimedId = await claimInstanceById(tx, inputFetch.instanceId);
      if (!claimedId) return;
      const [wfRow] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, claimedId));
      if (!wfRow || wfRow.status !== 'running') return;
      const [current] = await tx.select().from(stepInstance).where(eq(stepInstance.id, inputFetch.stepInstanceId));
      if (!current || current.state !== 'WAITING_PROPERTIES') return; // resolved/cancelled in the gap
      const context = await openContext(tx, wfRow, deps);
      const found = context.findStep(inputFetch.stepOid);
      if (!found) {
        // Defensive: unresolvable def — clear the timer so the row is never revisited (the
        // processDueGateWork precedent), and say so: without this line the operator would see
        // "Reading action properties" forever with no log.
        await tx.update(stepInstance).set({ wakeAt: null, updatedAt: deps.now() }).where(eq(stepInstance.id, current.id));
        console.error(`[mission-engine] instance ${claimedId}: WAITING_PROPERTIES row for step ${inputFetch.stepOid} has no resolvable step def — timer cleared`);
        return;
      }
      const { context: stepCtx, stepDef } = found;
      const target = { id: current.id, stepOid: current.stepOid };
      if (!fetched.ok) {
        // §5.4 / D4: a fetch failure fails the step (mode ERROR, TRY-routable) — GATE's G3 posture.
        const settled = await failStep(tx, stepCtx, target, 'ERROR', fetched.error, deps);
        if (!settled) await settleIfComplete(tx, context, current.nodeOid, deps);
        await context.persist(tx);
      } else {
        const r = await runStepActivation(tx, stepCtx, target, stepDef, deps, fetched.overlay);
        if (!r.settled) {
          // completeGate's tail: cascade the step's successors, then settle-if-complete.
          const cascadeSettled = r.completed ? await drainCascade(tx, stepCtx, [target.stepOid], deps) : false;
          if (!cascadeSettled) {
            await settleIfComplete(tx, context, current.nodeOid, deps);
            await context.persist(tx);
          }
        }
      }
      await reconcileAndNotify(tx, claimedId, deps);
    });
    return true;
  } catch (err) {
    // C2 posture (loop.ts / core/gate.ts): a deterministic per-instance failure must not
    // head-of-line block the claim set — settle that instance errored and keep the loop alive.
    if (!claimedInstanceId) throw err;
    await settleFailedInstance(db, claimedInstanceId, err, deps);
    logInstanceSettledError(claimedInstanceId, err);
    return true;
  }
}
