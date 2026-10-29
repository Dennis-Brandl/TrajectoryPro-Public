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

import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { workflow, workCenter, workflowInstance, schedule, RUNTIME_FINAL_STATES, type Workflow } from '../db/schema/index.js';
import { DaoError, assertDispatchPolicy, pgErrorCode } from './errors.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export function listWorkflows(db: Db): Promise<Workflow[]> {
  return db.select().from(workflow);
}

/**
 * work_center_workflow is gone, so the remaining blockers are unfinished runtime workflows and
 * schedules: workflow_instance.workflow_id and schedule.workflow_id are both part of
 * RESTRICT composite FKs (spec §4.4). Each pre-check gives a friendly, named message; the
 * 23503 catch is the backstop for a concurrent insert in the gap (and would otherwise
 * surface as a bare 'WORKFLOW_IN_USE' with no message on the schedule path).
 *
 * A FINISHED runtime (completed/aborted/stopped/errored) does not block: its permanent record
 * is the runtime_history row settleTerminal wrote in the same transaction as the terminal
 * status, so its workflow_instance row is information only (the engine's sweep deletes it
 * after the retention window anyway). Those rows are deleted here, ahead of the workflow.
 * A pending runtime has not run and has no history, so it still blocks.
 */
export async function deleteWorkflow(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const unfinished = await tx.select({ id: workflowInstance.id }).from(workflowInstance)
      .where(and(
        eq(workflowInstance.workflowId, id),
        notInArray(workflowInstance.status, [...RUNTIME_FINAL_STATES]),
      )).limit(1);
    if (unfinished.length) {
      throw new DaoError('WORKFLOW_IN_USE', 'Workflow has runtime workflows that have not finished');
    }

    const schedules = await tx.select({ id: schedule.id }).from(schedule)
      .where(eq(schedule.workflowId, id)).limit(1);
    if (schedules.length) throw new DaoError('WORKFLOW_IN_USE', 'Workflow is referenced by one or more schedules');

    try {
      // Finished runtimes: their steps, trace and shared-state rows cascade; runtime_history
      // and step_signature are soft links and survive.
      await tx.delete(workflowInstance).where(and(
        eq(workflowInstance.workflowId, id),
        inArray(workflowInstance.status, [...RUNTIME_FINAL_STATES]),
      ));
      // nodes, ui steps, allowed roles, and env LINKS cascade. The environment rows
      // themselves belong to the work center and survive (spec §5).
      await tx.delete(workflow).where(eq(workflow.id, id));
    } catch (err) {
      if (pgErrorCode(err) === '23503') throw new DaoError('WORKFLOW_IN_USE');
      throw err;
    }
  });
}

/**
 * The successor to the deleted link DAO's setWorkflowDispatchPolicy (spec §14). M6 removed
 * work_center_workflow, so the override lives on the workflow row itself and a workflow
 * belongs to exactly one work center — workflow.id alone identifies the entry, and the old
 * (workCenterId, linkId) scoping has no successor because it has nothing left to disambiguate.
 *
 * `policy` is `string | null`, and null is a real value: workflow_dispatch_ck admits NULL to
 * mean "no override, inherit the work center's policy". There is deliberately no
 * leave-unchanged case — a single-field setter has no partial-update semantics.
 */
export async function setWorkflowDispatchPolicy(
  db: Db, workflowId: string, policy: string | null,
): Promise<void> {
  // Typed 400 ahead of the write, rather than letting workflow_dispatch_ck raise a raw 23514.
  assertDispatchPolicy(policy);
  // Confirm a row actually matched: a stale but well-formed uuid must raise WORKFLOW_NOT_FOUND
  // (→ route 404), never update nothing and report success. .returning() is the portable
  // affected-row signal across PGlite (tests) and node-postgres (prod).
  const updated = await db.update(workflow)
    .set({ dispatchPolicy: policy, updatedAt: new Date() })
    .where(eq(workflow.id, workflowId))
    .returning({ id: workflow.id });
  if (updated.length === 0) throw new DaoError('WORKFLOW_NOT_FOUND');
}

/** Auto-claim override (spec 2026-08-14 D4). null = inherit the work center's autoClaim.
 *  Same single-field-setter shape as setWorkflowDispatchPolicy above. */
export async function setWorkflowAutoClaim(
  db: Db, workflowId: string, value: boolean | null,
): Promise<void> {
  const updated = await db.update(workflow)
    .set({ autoClaim: value, updatedAt: new Date() })
    .where(eq(workflow.id, workflowId))
    .returning({ id: workflow.id });
  if (updated.length === 0) throw new DaoError('WORKFLOW_NOT_FOUND');
}

export type WorkflowSummary = {
  id: string; oid: string; name: string;
  typeName: string | null;
  workCenterId: string; workCenterName: string;
  version: string; state: string; effectiveFrom: Date | null;
  dispatchPolicy: string | null;
  autoClaim: boolean | null;
  sourceLibraryName: string | null; sourceLibraryOid: string | null;
};

export function listWorkflowSummaries(db: Db): Promise<WorkflowSummary[]> {
  return db.select({
    id: workflow.id, oid: workflow.oid, name: workflow.name,
    typeName: workflow.typeName,
    workCenterId: workflow.workCenterId, workCenterName: workCenter.name,
    version: workflow.version, state: workflow.state, effectiveFrom: workflow.effectiveFrom,
    dispatchPolicy: workflow.dispatchPolicy,
    autoClaim: workflow.autoClaim,
    sourceLibraryName: workflow.sourceLibraryName, sourceLibraryOid: workflow.sourceLibraryOid,
  }).from(workflow)
    .innerJoin(workCenter, eq(workCenter.id, workflow.workCenterId))
    .orderBy(asc(workCenter.name), asc(workflow.name), asc(workflow.version), asc(workflow.state));
}
