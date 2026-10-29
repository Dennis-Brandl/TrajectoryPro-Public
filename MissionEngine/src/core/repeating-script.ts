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
// Repeating SCRIPT, claim side (spec 2026-10-13 §6.2-§6.4): one due run of a WAITING_SCRIPT row
// inside the claiming transaction (gate.ts's processDueGateWork claims it, with the gate's
// locking protocol and its two-phase Action-Property fetch). Activation lives in transition.ts
// (activateRepeatingScript), next to activateGateStep.
import { eq } from 'drizzle-orm';
import { stepInstance } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { MasterWorkflowStep } from '../spec/types.js';
import type { WorkflowContext } from './context.js';
import {
  runRepeatingScript, commitScriptOutputs, scriptExpired, scriptOnTimeLimit, scriptRepeat,
  nextScriptWake, formatDuration, type ScriptOutputs,
} from './step-handlers.js';
import { failStep, settleIfComplete, completeWaitingStep, snapshotScriptOutputs } from './transition.js';
import { notifyWorkCenter } from './reconcile.js';

type ScriptRow = { id: string; stepOid: string; nodeOid: string };

/** Commit the outputs a repeating script has produced and complete the step — the single path
 *  for a run that returned true, a time limit set to 'complete', and force complete (§6.4).
 *  Outputs never set stay unset. Returns true iff the instance settled. */
export async function completeRepeatingScript(
  tx: Db, context: WorkflowContext, stepCtx: WorkflowContext, row: ScriptRow,
  stepDef: MasterWorkflowStep, deps: EngineDeps, outputs: ScriptOutputs,
): Promise<boolean> {
  commitScriptOutputs(stepDef, stepCtx.props, outputs);
  snapshotScriptOutputs(stepCtx, row.stepOid, stepDef);
  delete context.root.state.scriptRuns[row.stepOid];
  const settled = await completeWaitingStep(tx, context, stepCtx, { id: row.id, stepOid: row.stepOid }, stepDef, deps, row.nodeOid);
  await notifyWorkCenter(tx, context.workCenterId); // the Pilot's Waiting list drops the finished script
  return settled;
}

async function failRepeatingScript(
  tx: Db, context: WorkflowContext, stepCtx: WorkflowContext, row: ScriptRow, error: string | null, deps: EngineDeps,
): Promise<boolean> {
  const settled = await failStep(tx, stepCtx, { id: row.id, stepOid: row.stepOid }, 'ERROR', error, deps);
  if (!settled) {
    await settleIfComplete(tx, context, row.nodeOid, deps);
    await context.persist(tx);
  }
  await notifyWorkCenter(tx, context.workCenterId);
  return settled;
}

/** One due run (§6.2/§6.3). The time limit is checked FIRST: an expired script never runs again
 *  — 'error' fails the step, 'complete' completes it with its pending outputs. Otherwise inputs
 *  are re-resolved (Value Properties from the live store, bound Action Properties from
 *  `overlay`), the script runs with its saved state, and: true → complete; anything else → keep
 *  state + pending outputs and sleep to the next cycle (never past the limit). Returns true iff
 *  the instance settled. */
export async function evaluateScriptOnClaim(
  tx: Db, context: WorkflowContext, row: ScriptRow & { startedAt: Date | null },
  stepDef: MasterWorkflowStep, deps: EngineDeps, overlay?: Record<string, string>,
): Promise<boolean> {
  const stepCtx = context.contextForNode(row.nodeOid);
  const saved = context.root.state.scriptRuns[row.stepOid];
  if (scriptExpired(stepDef, deps.now(), row.startedAt)) {
    const limit = formatDuration(scriptRepeat(stepDef)?.time_limit_seconds ?? 0);
    if (scriptOnTimeLimit(stepDef) === 'complete') {
      await stepCtx.recordTrace(tx, row.stepOid, 'WARNING', undefined,
        `Script time limit (${limit}) reached — completed with its current outputs`);
      return await completeRepeatingScript(tx, context, stepCtx, row, stepDef, deps, saved?.pendingOutputs ?? {});
    }
    return await failRepeatingScript(tx, context, stepCtx, row, `Script time limit (${limit}) reached`, deps);
  }
  stepCtx.props.resolveInputParameters(stepDef.input_parameter_specifications);
  const inputs = { ...stepCtx.props.getInputParameters(), ...(overlay ?? {}) };
  stepCtx.state.stepSnapshots[row.stepOid] = { inputParameters: inputs };
  const run = runRepeatingScript(stepDef, inputs, saved?.state, deps.config.scriptTimeoutMs);
  if (!run.success) return await failRepeatingScript(tx, context, stepCtx, row, run.error ?? null, deps);
  if (run.done) return await completeRepeatingScript(tx, context, stepCtx, row, stepDef, deps, run.output);
  context.root.state.scriptRuns[row.stepOid] = { state: run.state, pendingOutputs: run.output };
  await tx.update(stepInstance).set({
    wakeAt: nextScriptWake(stepDef, deps.now(), row.startedAt), updatedAt: deps.now(),
  }).where(eq(stepInstance.id, row.id));
  await context.persist(tx);
  return false;
}
