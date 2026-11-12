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
// Fixed button row (spec 2026-11-11): Back. The claimant of a waiting screen T whose step allows
// Back sets T aside (its run recorded 'went_back') and reopens the screen S the cascade carried
// to it (EngineState.backFrom[T]) — prefilled with what was submitted on S, its old signature
// superseded — and the reopened S goes straight back to the same operator when they may hold it.
// One transaction, the instance lock first (loop.ts LOCKING PROTOCOL), like submitUserAction.
import { eq, and } from 'drizzle-orm';
import { workflowInstance, stepInstance, instanceAssignment } from 'mission-control-db/src/db/schema/index';
import { markSignaturesSuperseded } from 'mission-control-db/src/dao/step-signatures';
import { claimStepForUser } from 'mission-control-db/src/runtime/assignments';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { MasterWorkflowStep } from '../spec/types.js';
import { claimInstanceById } from '../loop.js';
import { openContext } from './context.js';
import { EngineError } from './submit.js';
import { canonicalStepType } from './step-handlers.js';
import { isScreenType } from './back-target.js';
import { resetStepIfExists, activateAndCascade } from './transition.js';
import { reconcileAndNotify, notifyWorkCenter } from './reconcile.js';

/** A screen with the fixed bar and Back switched on — legacy steps never offer Back. */
function offersBack(def: MasterWorkflowStep | undefined): boolean {
  return !!def && isScreenType(canonicalStepType(def.step_type)) && def.button_bar?.format === 'fixed' && def.allow_back === true;
}

export async function goBack(
  db: Db, instanceId: string, input: { assignmentId: string; userId: string }, deps: EngineDeps,
): Promise<{ targetStepOid: string }> {
  const out = await db.transaction(async (tx) => {
    if (!(await claimInstanceById(tx, instanceId))) {
      throw new EngineError('NOT_RUNNING', `workflow_instance ${instanceId} is locked by another worker`);
    }
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
    if (!row || row.status !== 'running') {
      throw new EngineError('NOT_RUNNING', `workflow_instance ${instanceId} is not running`);
    }

    // Same row lock as submitCore's claim guard: serializes against the claim/release routes.
    const [a] = await tx.select().from(instanceAssignment).where(eq(instanceAssignment.id, input.assignmentId)).for('update');
    const [target] = a
      ? await tx.select().from(stepInstance).where(and(eq(stepInstance.id, a.stepInstanceId), eq(stepInstance.workflowInstanceId, instanceId)))
      : [];
    if (!a || !target || a.status !== 'claimed' || a.assignedUserId !== input.userId) {
      throw new EngineError('NOT_CLAIMANT', `assignment ${input.assignmentId} is not held by the caller`);
    }
    if (target.state !== 'WAITING_USER') {
      throw new EngineError('STEP_NOT_WAITING', `step ${target.stepOid} is not waiting for an operator`);
    }

    const context = await openContext(tx, row, deps);
    const stepCtx = context.contextForNode(target.nodeOid);
    const tOid = target.stepOid;
    const tDef = stepCtx.spec.steps.find(s => s.oid === tOid);
    // backFrom also carries entries for automated steps — the target must itself be a screen.
    const sOid = stepCtx.state.backFrom[tOid];
    const sDef = sOid ? stepCtx.spec.steps.find(s => s.oid === sOid) : undefined;
    const [sRow] = sOid
      ? await tx.select().from(stepInstance).where(and(eq(stepInstance.workflowInstanceId, instanceId), eq(stepInstance.stepOid, sOid)))
      : [];
    if (!offersBack(tDef) || !sOid || !sDef || !isScreenType(canonicalStepType(sDef.step_type)) || sRow?.state !== 'COMPLETED') {
      throw new EngineError('BACK_NOT_ALLOWED', `step ${tOid} does not allow Back`);
    }

    // 1. T is set aside; its run is the operator's, recorded 'went_back'.
    context.root.stepRunActor = { stepOid: tOid, userId: input.userId };
    await resetStepIfExists(tx, stepCtx, tOid, deps, 'went_back');
    const sName = typeof sDef.local_id === 'string' ? sDef.local_id : sOid;
    await stepCtx.recordTrace(tx, tOid, 'OPERATOR', undefined, `went back to «${sName}» [by ${input.userId}]`);

    // 2. S is reset but keeps its own back target, and reopens prefilled with its last submit.
    const keep = stepCtx.state.backFrom[sOid];
    const prefill = stepCtx.state.lastFormValues[sOid] ?? {};
    await resetStepIfExists(tx, stepCtx, sOid, deps);
    if (keep !== undefined) stepCtx.state.backFrom[sOid] = keep;
    stepCtx.state.backPrefill[sOid] = prefill;
    await markSignaturesSuperseded(tx, { workflowInstanceId: instanceId, stepOid: sOid, at: deps.now() });

    // 3. Reopen S.
    await activateAndCascade(tx, stepCtx, sOid, tOid, deps);
    await context.persist(tx);
    await reconcileAndNotify(tx, instanceId, deps);
    return { targetStepOid: sOid, workCenterId: row.workCenterId };
  });

  // After commit, like the claim route: the reopened screen goes to the operator who pressed Back.
  // Back has already happened, so a failed claim is logged, never reported: the reopened screen
  // stays offered in the inbox and the operator can claim it there.
  try {
    const claimed = await claimStepForUser(db, { instanceId, stepOid: out.targetStepOid, userId: input.userId, now: deps.now });
    if (claimed) await notifyWorkCenter(db, out.workCenterId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[mission-engine] instance ${instanceId} back to ${out.targetStepOid}: claim for the operator failed, left offered: ${reason}`);
  }
  return { targetStepOid: out.targetStepOid };
}
