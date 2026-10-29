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
// Force complete (spec 2026-10-13 §5.1): an operator opens a waiting GATE now — or completes a waiting repeating SCRIPT with its pending outputs (§6.4). One transaction,
// the instance lock first (loop.ts LOCKING PROTOCOL), then the SAME open path a TRUE evaluation
// or an expired timer takes (gate.ts openGateOnClaim) — so an armed gate STOPs its action
// exactly as it would on TRUE. The step must still be WAITING_GATE / WAITING_SCRIPT under the lock: whoever loses
// a race with the timer gets ALREADY_COMPLETED (or RUNTIME_INVALID_STATE once the whole
// instance has finished), never a second completion.
import { eq, and } from 'drizzle-orm';
import { workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { OperatorEventHub } from '../api/events.js';
import { claimInstanceById } from '../loop.js';
import { openContext } from './context.js';
import { openGateOnClaim } from './gate.js';
import { sendAfterCommit, type AfterCommitCommand } from './control.js';
import { warmCapabilitiesForInstance } from './capability-warmup.js';
import { gateMode } from './step-handlers.js';
import { reconcileAndNotify, notifyWorkCenter } from './reconcile.js';
import { completeRepeatingScript } from './repeating-script.js';
import { VerbError } from './registry-verbs.js';

export type ForceCompleteInput = {
  instanceId: string; stepInstanceId: string; actorUserId: string;
  reason?: string | null;
  /** 'pilot' may only force TIMED gates (spec §5.1 eligibility table). */
  source: 'commander' | 'pilot';
};

function refuseUnlessRunning(status: string): void {
  if (status === 'paused' || status === 'pausing') throw new VerbError('INSTANCE_PAUSED', 'Resume the workflow first');
  if (status !== 'running') throw new VerbError('RUNTIME_INVALID_STATE', `runtime workflow is ${status}`);
}

export async function forceCompleteStep(
  db: Db, deps: EngineDeps, hub: OperatorEventHub | null, input: ForceCompleteInput,
): Promise<{ ok: true; summary: string }> {
  // No network inside the claim transaction: warm the capabilities cache first, send an armed
  // gate's STOP after commit.
  await warmCapabilitiesForInstance(db, deps.invoker.client, input.instanceId);
  let afterCommit: AfterCommitCommand[] = [];
  const out = await db.transaction(async (tx) => {
    afterCommit = [];
    const [head] = await tx.select({ workCenterId: workflowInstance.workCenterId, status: workflowInstance.status })
      .from(workflowInstance).where(eq(workflowInstance.id, input.instanceId));
    if (!head) throw new VerbError('RUNTIME_NOT_FOUND', 'runtime workflow not found');
    refuseUnlessRunning(head.status);
    if (!(await claimInstanceById(tx, input.instanceId))) {
      throw new VerbError('INSTANCE_BUSY', 'the engine is working this runtime workflow — try again');
    }
    const [wfRow] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, input.instanceId));
    refuseUnlessRunning(wfRow.status); // re-checked under the lock
    const [row] = await tx.select().from(stepInstance).where(and(
      eq(stepInstance.id, input.stepInstanceId), eq(stepInstance.workflowInstanceId, input.instanceId),
    ));
    if (!row) throw new VerbError('STEP_NOT_FOUND', 'step not found on this runtime workflow');
    const waitingScript = row.state === 'WAITING_SCRIPT';
    if (row.state !== 'WAITING_GATE' && !waitingScript) throw new VerbError('ALREADY_COMPLETED', 'This step is no longer waiting');
    const context = await openContext(tx, wfRow, deps);
    const stepDef = context.findStep(row.stepOid)?.stepDef;
    if (!stepDef) throw new VerbError('STEP_NOT_FOUND', 'step not found in this runtime workflow\'s recipe');
    // §5.1: the Pilot may continue timed gates and repeating scripts, never a condition gate.
    if (!waitingScript && input.source === 'pilot' && gateMode(stepDef) === 'condition') {
      throw new VerbError('NOT_FORCEABLE', 'Only timed gates can be continued from the Pilot');
    }
    if (!waitingScript && context.root.state.armedGates[row.stepOid]?.open) {
      throw new VerbError('ALREADY_OPEN', 'The gate is already open — it is waiting for the action it controls to finish');
    }
    const stepCtx = context.contextForNode(row.nodeOid);
    const reason = input.reason?.trim();
    const summary = `Forced complete${reason ? `: ${reason}` : ''}`;
    await stepCtx.recordTrace(tx, row.stepOid, 'OPERATOR', undefined, `${summary} [by ${input.actorUserId}]`);
    // Spec 2026-10-27 §6.3: the operator is who performed this run (read by step-run.ts).
    context.root.stepRunActor = { stepOid: row.stepOid, userId: input.actorUserId };
    if (waitingScript) {
      await completeRepeatingScript(tx, context, stepCtx, row, stepDef, deps,
        context.root.state.scriptRuns[row.stepOid]?.pendingOutputs ?? {});
    } else {
      await openGateOnClaim(tx, context, stepCtx, row, stepDef, deps, afterCommit);
    }
    await reconcileAndNotify(tx, input.instanceId, deps);
    await notifyWorkCenter(tx, head.workCenterId);
    return { summary, workCenterId: head.workCenterId };
  });
  await sendAfterCommit(db, deps.invoker.client, afterCommit, deps);
  hub?.notifyWorkCenter(out.workCenterId);
  return { ok: true, summary: out.summary };
}
