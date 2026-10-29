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
// Spec 2026-10-27 §6: one step_run row per execution of a step, written inside the transaction
// that ends the run. `WorkflowContext.recordTrace` calls `recordStepRun` for every COMPLETED/
// ERRORED/ABORTED trace; the few places an ACTIVE step ends without one of those traces (a
// caught failure, a cancel, a stop) call it explicitly. Imports WorkflowContext as a type only,
// so context.ts -> step-run.ts creates no runtime cycle.
import { and, eq } from 'drizzle-orm';
import { appUser, stepInstance, workflowInstance } from 'mission-control-db/src/db/schema/index';
import type { StepRunKind, StepRunPathEntry, StepRunResult } from 'mission-control-db/src/db/schema/index';
import { countStepRuns, countStepRunsStartedBefore, insertStepRun } from 'mission-control-db/src/dao/step-runs';
import type { Db } from '../db.js';
import type { MasterWorkflowSpecification, MasterWorkflowStep } from '../spec/types.js';
import type { WorkflowContext } from './context.js';
import { canonicalStepType } from './step-handlers.js';

/** Every step_instance queue state that means "this step was actually doing something" — the
 *  one shared definition (control.ts's ABORT sweep, transition.ts's ABANDON/RESTART sweeps, and
 *  every explicit cancel/stop record below). GATE spec 2026-08-29 §5.7: a waiting gate is just
 *  as active as any other park; spec 2026-09-04 §5.4.5 the same for WAITING_PROPERTIES; spec
 *  2026-10-13 §6.5 for a waiting repeating SCRIPT. 'EXECUTING' is a parked WAIT ALL. READY is
 *  deliberately absent: a step that never started gets no step_run row. */
export const ACTIVE_ROW_STATES: ReadonlySet<string> = new Set([
  'EXECUTING', 'WAITING_ACTION', 'WAITING_USER', 'WAITING_GATE', 'WAITING_PROPERTIES', 'WAITING_SCRIPT', 'PAUSED',
]);

/** Who "performed" a step that no person submitted (spec §5.7). */
export function stepRunKind(stepType: string): StepRunKind {
  switch (canonicalStepType(stepType)) {
    case 'SCRIPT': case 'MATH': return 'script';
    case 'ACTION PROXY': return 'action';
    case 'GATE': return 'gate';
    case 'USER_INTERACTION': case 'YES_NO': return 'user';
    default: return 'system';
  }
}

/** Pure spec-tree search (no view materialization): the spec owning `stepOid` plus its def.
 *  Deliberately NOT `root.findStep` — that memoizes a view, and a view minted for a subtree that
 *  is being torn down would be re-serialized into state.childProperties by persist(). */
function findOwner(spec: MasterWorkflowSpecification, stepOid: string): [MasterWorkflowSpecification, MasterWorkflowStep] | undefined {
  const found = spec.steps.find(st => st.oid === stepOid);
  if (found) return [spec, found];
  for (const child of spec.children ?? []) {
    const nested = findOwner(child, stepOid);
    if (nested) return nested;
  }
  return undefined;
}

/** Pure spec-tree search for the spec whose own oid is `oid` (context.ts's findSpecByOid,
 *  kept local so this module needs nothing from context.ts at runtime). */
function findSpec(spec: MasterWorkflowSpecification, oid: string): MasterWorkflowSpecification | undefined {
  if (spec.oid === oid) return spec;
  for (const child of spec.children ?? []) {
    const found = findSpec(child, oid);
    if (found) return found;
  }
  return undefined;
}

/** Which run of `proxyOid` is the one currently active: its runs that started before the proxy
 *  row's CURRENT activation, plus one. Order-independent on purpose — an abort or give-up sweep
 *  can write the proxy's own (ending) run row before its children's in the same transaction, so a
 *  bare `count + 1` would number the children one run too high. Falls back to `count + 1` when
 *  the row or its start time is missing. */
async function activeProxyRun(tx: Db, root: WorkflowContext, proxyOid: string): Promise<number> {
  const [row] = await tx.select({ startedAt: stepInstance.startedAt }).from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, root.id), eq(stepInstance.stepOid, proxyOid)));
  if (!row?.startedAt) return (await countStepRuns(tx, root.id, proxyOid)) + 1;
  return (await countStepRunsStartedBefore(tx, root.id, proxyOid, row.startedAt)) + 1;
}

/** The sub-workflow path from the root down to `specOid`, outermost first. Each level is the
 *  WORKFLOW PROXY whose `childActive` entry points at that level's spec, with its active run. */
async function nodePathForSpec(tx: Db, root: WorkflowContext, specOid: string): Promise<StepRunPathEntry[]> {
  const path: StepRunPathEntry[] = [];
  let current = specOid;
  const seen = new Set<string>();
  while (current !== root.spec.oid && !seen.has(current)) {
    seen.add(current);
    const proxyOid = Object.entries(root.state.childActive).find(([, v]) => v === current)?.[0];
    const owner = proxyOid ? findOwner(root.spec, proxyOid) : undefined;
    const childSpec = findSpec(root.spec, current);
    if (!proxyOid || !owner || !childSpec) break; // defensive — link already gone
    path.unshift({
      proxyStepOid: proxyOid,
      proxyRun: await activeProxyRun(tx, root, proxyOid),
      workflowName: childSpec.local_id,
    });
    current = owner[0].oid;
  }
  return path;
}

/** The node path for steps owned by `ctx`'s own spec; the root gives `[]`. Async and takes the
 *  transaction because each level's proxy run is counted from step_run. */
export async function nodePathFor(tx: Db, ctx: WorkflowContext): Promise<StepRunPathEntry[]> {
  if (ctx.spec.oid === ctx.root.spec.oid) return [];
  return nodePathForSpec(tx, ctx.root, ctx.spec.oid);
}

/** runtime_label + work_center_id, read once per root context (one root per transaction). */
const instanceInfo = new WeakMap<WorkflowContext, { runtimeLabel: string; workCenterId: string | null }>();

/** Writes one step_run row for `stepOid` as it ends, inside the caller's transaction. */
export async function recordStepRun(
  tx: Db, ctx: WorkflowContext, stepOid: string, result: StepRunResult, error?: string | null,
): Promise<void> {
  const root = ctx.root;
  const [row] = await tx.select({ id: stepInstance.id, startedAt: stepInstance.startedAt })
    .from(stepInstance)
    .where(and(eq(stepInstance.workflowInstanceId, root.id), eq(stepInstance.stepOid, stepOid)));
  const owner = findOwner(root.spec, stepOid);
  const stepDef = owner?.[1];
  const stepType = canonicalStepType(stepDef?.step_type ?? 'UNKNOWN');

  let info = instanceInfo.get(root);
  if (!info) {
    const [wi] = await tx.select({ runtimeLabel: workflowInstance.runtimeLabel, workCenterId: workflowInstance.workCenterId })
      .from(workflowInstance).where(eq(workflowInstance.id, root.id));
    info = { runtimeLabel: wi?.runtimeLabel ?? '', workCenterId: wi?.workCenterId ?? root.workCenterId };
    instanceInfo.set(root, info);
  }

  let performedByUserId: string | null = null;
  let performedByLoginName: string | null = null;
  let performedByKind: StepRunKind = stepRunKind(stepType);
  const actor = root.stepRunActor;
  if (actor && actor.stepOid === stepOid) {
    performedByKind = 'user';
    performedByUserId = actor.userId;
    const [u] = await tx.select({ loginName: appUser.loginName }).from(appUser).where(eq(appUser.id, actor.userId));
    performedByLoginName = u?.loginName ?? null;
    root.stepRunActor = null; // credited once: a later run of this step in the same transaction is not theirs
  }

  const snapshot = root.state.stepSnapshots[stepOid];
  const finishedAt = ctx.now();
  // The step's owning spec decides its path, not `ctx.spec`: the teardown and give-up callers
  // pass the root for steps that live in a child.
  const ownerSpecOid = owner?.[0].oid ?? ctx.spec.oid;
  await insertStepRun(tx, {
    workflowInstanceId: root.id,
    runtimeLabel: info.runtimeLabel,
    workCenterId: info.workCenterId,
    stepInstanceId: row?.id ?? null,
    stepOid,
    stepName: typeof stepDef?.local_id === 'string' ? stepDef.local_id : stepOid,
    stepType,
    runNumber: (await countStepRuns(tx, root.id, stepOid)) + 1,
    // An auto-completing step never sets step_instance.started_at — it starts as it finishes.
    startedAt: row?.startedAt ?? finishedAt,
    finishedAt,
    result,
    error: error ?? null,
    inputParameters: snapshot ? { ...snapshot.inputParameters } : null,
    outputParameters: snapshot?.outputParameters ? { ...snapshot.outputParameters } : null,
    performedByUserId,
    performedByLoginName,
    performedByKind,
    nodePath: await nodePathForSpec(tx, root, ownerSpecOid),
  });
}

/** The engine's give-up paths (a start or control pass that kept throwing, a transition that
 *  poisoned the instance) force every non-terminal row ERRORED in one bulk UPDATE behind an
 *  instance-level (null step) trace, so the trace hook never sees those steps. Record a 'failed'
 *  run for each row that was actually active, just before that UPDATE. `settleTerminal` reuses
 *  it with result 'cancelled' for rows a settle leaves active (it records only, never changes state). */
export async function recordFailedActiveRuns(
  tx: Db, root: WorkflowContext, error: string | null, result: StepRunResult = 'failed',
): Promise<void> {
  const rows = await tx.select({ stepOid: stepInstance.stepOid, state: stepInstance.state })
    .from(stepInstance).where(eq(stepInstance.workflowInstanceId, root.id));
  // The root is enough: recordStepRun resolves each step's owning spec (and node path) itself,
  // so no child view is minted on a path that is about to settle the instance.
  for (const r of rows) {
    if (ACTIVE_ROW_STATES.has(r.state)) await recordStepRun(tx, root, r.stepOid, result, error);
  }
}
