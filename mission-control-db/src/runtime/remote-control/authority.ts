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

import { eq, sql } from 'drizzle-orm';
import { workCenter, workflowInstance, stepInstance, runtimeHistory } from '../../db/schema/index.js';
import { getControlGrantScope } from '../../dao/control-grants.js';
import { findStepDef } from '../inbox.js';
import { REMOTE_CODES, RemoteError } from './codes.js';
import type { Db } from './resolve.js';

export const MAX_CREATED_PER_RUNTIME = 100;
export const MAX_LINEAGE_DEPTH = 8;

export type Caller = {
  instanceId: string; stepInstanceId: string; workCenterId: string; workCenterName: string;
  runtimeLabel: string; actionName: string | null;
  /** step_instance.started_at — the step's current ACTIVATION. The engine reuses the row when a
   *  loop re-enters the step (fresh started_at, same id), so exactly-once keys on both. */
  stepStartedAt: Date;
  /** The step's configured action (action_proxy_config.action_oid) and the action the engine
   *  actually invoked (step_instance.action_invoked_oid; differs under loose matching). Phase 1
   *  only exposes them. The broker compares the URL action with the step's CONFIGURED action
   *  (actionOid / actionName), because the engine writes action_invoked_oid only after the invoke
   *  returns (MissionEngine/src/loop.ts ~443). */
  actionOid: string | null;
  actionInvokedOid: string | null;
};

const refuse = (message: string) => new RemoteError(REMOTE_CODES.NOT_PERMITTED, message);

/** The invoke body names the calling runtime and step (MissionEngine actions/client.ts). Nothing
 *  authenticates the engine to an action server, so the claim is checked against the database:
 *  the step must really be an ACTION PROXY step of that runtime, waiting on its action now. */
export async function loadCaller(db: Db, workflowInstanceId: string, stepInstanceId: string, stepOid: string): Promise<Caller> {
  const [row] = await db.select({
    instanceId: workflowInstance.id, workCenterId: workflowInstance.workCenterId, runtimeLabel: workflowInstance.runtimeLabel,
    specJsonb: workflowInstance.specJsonb, workCenterName: workCenter.name,
    stepWorkflow: stepInstance.workflowInstanceId, stepOid: stepInstance.stepOid, nodeOid: stepInstance.nodeOid,
    stepType: stepInstance.stepType, stepState: stepInstance.state,
    stepStartedAt: stepInstance.startedAt, actionInvokedOid: stepInstance.actionInvokedOid,
  }).from(stepInstance)
    .innerJoin(workflowInstance, eq(workflowInstance.id, stepInstance.workflowInstanceId))
    .innerJoin(workCenter, eq(workCenter.id, workflowInstance.workCenterId))
    .where(eq(stepInstance.id, stepInstanceId));
  if (!row || row.stepWorkflow !== workflowInstanceId || row.stepOid !== stepOid
      || row.stepType !== 'ACTION PROXY' || row.stepState !== 'WAITING_ACTION' || !row.stepStartedAt) {
    throw refuse('The calling step is not a waiting action step of that runtime');
  }
  const def = findStepDef(row.specJsonb, row.nodeOid, row.stepOid);
  const cfg = (def?.action_proxy_config ?? null) as { action_name?: unknown; action_oid?: unknown } | null;
  return {
    instanceId: row.instanceId, stepInstanceId, workCenterId: row.workCenterId, workCenterName: row.workCenterName,
    runtimeLabel: row.runtimeLabel, actionName: typeof cfg?.action_name === 'string' ? cfg.action_name : null,
    stepStartedAt: row.stepStartedAt,
    actionOid: typeof cfg?.action_oid === 'string' && cfg.action_oid !== '' ? cfg.action_oid : null,
    actionInvokedOid: row.actionInvokedOid ?? null,
  };
}

/** The runtime that created `id`, from the live row or (after the sweep) the history row. */
async function creatorOf(db: Db, id: string): Promise<string | null> {
  const [live] = await db.select({ by: workflowInstance.createdByInstanceId }).from(workflowInstance).where(eq(workflowInstance.id, id));
  if (live) return live.by;
  const [h] = await db.select({ by: runtimeHistory.createdByInstanceId }).from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, id));
  return h?.by ?? null;
}

async function isInLineage(db: Db, targetId: string, callerId: string): Promise<boolean> {
  let cur: string | null = targetId;
  for (let hop = 0; cur && hop <= MAX_LINEAGE_DEPTH; hop++) {
    cur = await creatorOf(db, cur);
    if (cur === callerId) return true;
  }
  return false;
}

export type ControlVerb = 'create' | 'read' | 'command';

/** Ruling R7 (spec §2.2, A1). */
export async function authorize(db: Db, caller: Caller, targetWorkCenterId: string, verb: ControlVerb, targetInstanceId?: string): Promise<void> {
  if (targetWorkCenterId === caller.workCenterId) return;
  const scope = await getControlGrantScope(db, caller.workCenterId, targetWorkCenterId);
  if (!scope) {
    const [t] = await db.select({ name: workCenter.name }).from(workCenter).where(eq(workCenter.id, targetWorkCenterId));
    throw refuse(`Work center "${caller.workCenterName}" has no control grant for work center "${t?.name ?? targetWorkCenterId}"`);
  }
  if (verb !== 'command' || scope === 'any') return;
  if (!targetInstanceId || !(await isInLineage(db, targetInstanceId, caller.instanceId))) {
    throw refuse('That runtime was not created by this runtime (the grant covers only its own runtimes)');
  }
}

/** Runaway guards (spec §2): a per-runtime creation cap and a lineage depth cap. */
export async function assertCreationAllowed(db: Db, caller: Caller): Promise<void> {
  let depth = 0;
  for (let cur = await creatorOf(db, caller.instanceId); cur; cur = await creatorOf(db, cur)) {
    depth++;
    if (depth >= MAX_LINEAGE_DEPTH) {
      throw refuse(`Runtime creation refused: the chain of runtimes creating runtimes would be deeper than ${MAX_LINEAGE_DEPTH}`);
    }
  }
  const res = await db.execute(sql`
    select count(*)::int as n from (
      select id from workflow_instance where created_by_instance_id = ${caller.instanceId}
      union
      select workflow_instance_id from runtime_history where created_by_instance_id = ${caller.instanceId}
    ) created`);
  const n = Number((res.rows[0] as { n: number }).n);
  if (n >= MAX_CREATED_PER_RUNTIME) {
    throw refuse(`Runtime creation refused: this runtime has already created ${MAX_CREATED_PER_RUNTIME} runtimes`);
  }
}
