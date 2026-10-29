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

import { eq } from 'drizzle-orm';
import { workflow } from '../db/schema/index.js';
import { workflowInstance, stepInstance, traceEntry } from '../db/schema/execution.js';
import { UI_STEP_TYPES } from '../constants.js';
import { allocateRuntimeIdentity } from '../dao/work-centers.js';
import { getRuntimeIdTimezone } from '../dao/system-settings.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
type Db = PgDatabase<any, Schema>;

export async function startInstance(
  db: Db,
  args: { workflowId: string; triggeredBy: 'manual' | 'schedule' | 'event'; scheduleId?: string; createdBy?: string },
): Promise<{ instanceId: string }> {
  // The workflow's own work center, not a caller-supplied one — workflow_instance's composite
  // FK is (work_center_id, workflow_id) REFERENCES workflow (work_center_id, id), so a mismatched
  // pair would otherwise 500 with a raw 23503 instead of ever reaching this DAO.
  return db.transaction(async (tx) => {
    // FOR SHARE: serialises with a Draft reload's FOR UPDATE on the same row, so the snapshot
    // below never sees a spec whose removed node a reload is deleting (with its grants).
    const [wf] = await tx.select().from(workflow).where(eq(workflow.id, args.workflowId)).for('share');
    if (!wf) throw new Error('workflow not found');
    const workCenterId = wf.workCenterId;
    const timeZone = await getRuntimeIdTimezone(tx as unknown as Db);
    const { runtimeNumber, runtimeLabel } = await allocateRuntimeIdentity(
      tx as unknown as Db, wf.workCenterId, new Date(), timeZone,
    );
    const [inst] = await tx.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId, scheduleId: args.scheduleId,
      triggeredBy: args.triggeredBy, status: 'running', startedAt: new Date(), createdBy: args.createdBy,
      specJsonb: wf.specJsonb,   // prototype passthrough: real instantiation arrives with the engine phase
      runtimeNumber, runtimeLabel,
      masterName: wf.name, masterOid: wf.oid, masterVersion: wf.version, masterState: wf.state,
    }).returning();

    // Walk the spec tree materializing step rows (root + children). Assignment rows are no
    // longer created here — the reconcile mechanism (Task 4/5) is the sole writer of
    // instance_assignment; starting an instance only materializes steps and trace entries.
    let order = 0;
    const spec = wf.specJsonb as any;
    async function walk(node: any): Promise<void> {
      for (const step of node.steps ?? []) {
        const [si] = await tx.insert(stepInstance).values({
          workflowInstanceId: inst.id, nodeOid: node.oid, stepOid: step.oid, stepType: step.step_type,
          state: UI_STEP_TYPES.has(step.step_type) ? 'WAITING_USER' : 'READY', orderIndex: order,
        }).returning();
        await tx.insert(traceEntry).values({ workflowInstanceId: inst.id, stepOid: step.oid, state: si.state, orderIndex: order });
        order++;
      }
      for (const child of node.children ?? []) await walk(child);
    }
    await walk(spec);
    return { instanceId: inst.id };
  });
}
