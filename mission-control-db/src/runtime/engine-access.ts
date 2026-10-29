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

import { sql } from 'drizzle-orm';
import { runtimeHistory } from '../db/schema/index.js';
import { deleteRuntimeWorkflow } from '../dao/runtime-workflows.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export type AcquiredRuntimeWorkflow = {
  id: string; workCenterId: string; runtimeNumber: number;
  specJsonb: unknown; startingParams: Record<string, string> | null;
  masterName: string; masterOid: string; masterVersion: string; masterState: string;
};
// timestamp: epoch-ms (Date#getTime()) — matches the engine's own reference-vocabulary
// TraceEntry shape (MissionEngine's spec/types.ts, produced by
// core/trace-assembly.ts's assembleReferenceTrace), the only real caller of writeRuntimeHistory
// (Task 17). Originally declared as an ISO string before that caller existed; corrected here —
// see this package's own engine-access.test.ts for the matching numeric fixtures.
export type TraceEntry = { step_oid: string; state: string; order: number; timestamp: number; after_action?: number; error?: string };
export type RuntimeHistorySnapshot = {
  workflowInstanceId: string; workCenterId: string | null; workCenterName: string;
  // Spec 2026-10-07 §4.1: frozen copy, as workCenterName already is.
  runtimeNumber: number; runtimeLabel: string; masterName: string; masterOid: string; masterVersion: string; masterState: string;
  finalState: 'completed' | 'aborted' | 'stopped' | 'errored';
  startedAt: Date | null; finishedAt: Date;
  startingParams: Record<string, string> | null;
  trace: TraceEntry[]; properties: Record<string, string> | null; stepParams: unknown | null;
  stepNames: Record<string, string> | null;
  // Spec 2026-10-15 §2/§6.2 (distributed workflow actions).
  createdByInstanceId: string | null; createdByLabel: string | null;
  outputs: Array<{ name: string; value: string }> | null;
  // Spec 2026-10-27: who started the run. Optional so older callers keep typechecking.
  startedByUserId?: string | null; startedByLoginName?: string | null;
};

/**
 * Engine work-claim (D1/D4): SKIP LOCKED so N engine replicas never double-claim.
 * One statement = one implicit transaction; a crashed claimer's rows revert with it.
 */
export async function acquireQueuedRuntimeWorkflows(db: Db, limit = 1): Promise<AcquiredRuntimeWorkflow[]> {
  const res = await db.execute(sql`
    update workflow_instance
    set status = 'running', started_at = now(), updated_at = now()
    where id in (
      select id from workflow_instance
      where status = 'queued'
      order by queued_at
      limit ${limit}
      for update skip locked
    )
    returning id, work_center_id, runtime_number, spec_jsonb, starting_params,
              master_name, master_oid, master_version, master_state
  `);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, workCenterId: r.work_center_id as string,
    runtimeNumber: Number(r.runtime_number),
    specJsonb: r.spec_jsonb, startingParams: r.starting_params as Record<string, string> | null,
    masterName: r.master_name as string, masterOid: r.master_oid as string,
    masterVersion: r.master_version as string, masterState: r.master_state as string,
  }));
}

/** Terminal-state log write (spec §5.2). Idempotent per instance via the plain unique
 *  index on workflow_instance_id (NULLs are distinct, so unlinked rows still coexist). */
export async function writeRuntimeHistory(db: Db, snapshot: RuntimeHistorySnapshot): Promise<void> {
  await db.insert(runtimeHistory).values({
    workflowInstanceId: snapshot.workflowInstanceId,
    workCenterId: snapshot.workCenterId, workCenterName: snapshot.workCenterName,
    runtimeNumber: snapshot.runtimeNumber, runtimeLabel: snapshot.runtimeLabel,
    masterName: snapshot.masterName, masterOid: snapshot.masterOid,
    masterVersion: snapshot.masterVersion, masterState: snapshot.masterState,
    finalState: snapshot.finalState,
    startedAt: snapshot.startedAt, finishedAt: snapshot.finishedAt,
    startingParams: snapshot.startingParams,
    trace: snapshot.trace, properties: snapshot.properties, stepParams: snapshot.stepParams,
    stepNames: snapshot.stepNames,
    createdByInstanceId: snapshot.createdByInstanceId, createdByLabel: snapshot.createdByLabel,
    outputs: snapshot.outputs,
    startedByUserId: snapshot.startedByUserId ?? null, startedByLoginName: snapshot.startedByLoginName ?? null,
  }).onConflictDoNothing({ target: runtimeHistory.workflowInstanceId });
}

/** Same status guard as the CM-facing delete — the engine's contract name for it. */
export { deleteRuntimeWorkflow as deleteCompletedRuntimeWorkflow };
