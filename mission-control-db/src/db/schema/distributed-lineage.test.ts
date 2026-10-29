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

import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance, runtimeHistory, workCenterControlGrant } from './index.js';

async function seed(db: any) {
  const [a] = await db.insert(workCenter).values({ name: `A-${Math.random()}` }).returning();
  const [b] = await db.insert(workCenter).values({ name: `B-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'WF', workCenterId: a.id, specJsonb: {} }).returning();
  return { a, b, wf };
}

test('workflow_instance accepts triggered_by workflow and the lineage columns', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a, wf } = await seed(db);
    const stepId = '11111111-1111-1111-1111-111111111111';
    const t1 = new Date('2026-10-16T11:00:00.001Z');
    const [row] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: a.id, triggeredBy: 'workflow', ...runtimeCols(),
      createdByInstanceId: '22222222-2222-2222-2222-222222222222', createdByStepInstanceId: stepId,
      createdByStepStartedAt: t1, createdByLabel: 'Line 1/RW-7',
    }).returning();
    expect(row.createdByLabel).toBe('Line 1/RW-7');
    expect(row.createdByStepStartedAt).toEqual(t1);
    // One runtime per creating step ACTIVATION (idempotent create).
    await expect(db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: a.id, triggeredBy: 'workflow', ...runtimeCols(), createdByStepInstanceId: stepId,
      createdByStepStartedAt: t1,
    })).rejects.toThrow();
    // The same step re-activated by a loop (same id, new started_at) may create again.
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: a.id, triggeredBy: 'workflow', ...runtimeCols(), createdByStepInstanceId: stepId,
      createdByStepStartedAt: new Date('2026-10-16T11:05:00.002Z'),
    });
  } finally { await close(); }
});

test('workflow_instance: rows with no creating step coexist (the unique index is partial)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a, wf } = await seed(db);
    await db.insert(workflowInstance).values({ workflowId: wf.id, workCenterId: a.id, triggeredBy: 'manual', ...runtimeCols() });
    await db.insert(workflowInstance).values({ workflowId: wf.id, workCenterId: a.id, triggeredBy: 'manual', ...runtimeCols() });
    expect(await db.select().from(workflowInstance)).toHaveLength(2);
  } finally { await close(); }
});

test('runtime_history stores lineage and outputs', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [h] = await db.insert(runtimeHistory).values({
      workflowInstanceId: '33333333-3333-3333-3333-333333333333', workCenterName: 'L1', runtimeNumber: 1,
      runtimeLabel: 'RW-1', masterName: 'M', masterOid: 'm', masterVersion: '1.0.0', masterState: 'Draft',
      finalState: 'completed', finishedAt: new Date(), trace: [],
      createdByInstanceId: '22222222-2222-2222-2222-222222222222', createdByLabel: 'L0/RW-3',
      outputs: [{ name: 'Batch', value: 'B-1' }],
    }).returning();
    expect(h.outputs).toEqual([{ name: 'Batch', value: 'B-1' }]);
    expect(h.createdByLabel).toBe('L0/RW-3');
  } finally { await close(); }
});

test('work_center_control_grant: scope check, no self-grant, cascade on work-center delete', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { a, b } = await seed(db);
    await db.insert(workCenterControlGrant).values({ sourceWorkCenterId: b.id, targetWorkCenterId: a.id, scope: 'any' });
    await expect(db.insert(workCenterControlGrant).values({ sourceWorkCenterId: a.id, targetWorkCenterId: b.id, scope: 'all' }))
      .rejects.toThrow();
    await expect(db.insert(workCenterControlGrant).values({ sourceWorkCenterId: a.id, targetWorkCenterId: a.id }))
      .rejects.toThrow();
    const [g] = await db.insert(workCenterControlGrant).values({ sourceWorkCenterId: a.id, targetWorkCenterId: b.id }).returning();
    expect(g.scope).toBe('own');
    await db.delete(workCenter).where(eq(workCenter.id, b.id));
    expect(await db.select().from(workCenterControlGrant)).toHaveLength(0);
  } finally { await close(); }
});
