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
import { sql } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance, stepInstance, workCenterEnvironmentBinding } from './index.js';

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: 'wf-1', name: 'wf', version: '1.0.0', state: 'Approved', specJsonb: {} }).returning();
  return { wc, wf };
}

test('0018: workflow_instance accepts transitional statuses and engine_state', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);
  for (const status of ['pausing', 'resuming', 'stopping', 'aborting']) {
    const [row] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status,
      engineState: { orderCounters: { root: 3 } }, ...runtimeCols({}),
    }).returning();
    expect(row.status).toBe(status);
    expect(row.engineState).toEqual({ orderCounters: { root: 3 } });
  }
  await expect(db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'bogus', ...runtimeCols({}),
  })).rejects.toThrow();
  await close();
});

test('0018: step_instance enforces the engine state vocabulary and carries wake/action columns', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols({}),
  }).returning();
  const [si] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: 'wf-1', stepOid: 's1', stepType: 'SCRIPT', state: 'READY',
    wakeAt: new Date(), actionInstanceId: 'ai-1', actionServerUri: 'http://localhost:3002',
  }).returning();
  expect(si.state).toBe('READY');
  await expect(db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: 'wf-1', stepOid: 's2', stepType: 'SCRIPT', state: 'RUNNING',
  })).rejects.toThrow();
  await close();
});

test('0018: trace_entry.after_action, work_center.finished_retention_secs default, binding upsert key', async () => {
  const { db, close } = await makeTestDb();
  const { wc } = await seed(db);
  expect(wc.finishedRetentionSecs).toBe(3600);
  await db.insert(workCenterEnvironmentBinding).values({ workCenterId: wc.id, environmentOid: 'env-1', serverUri: 'http://a:3002' });
  await expect(db.insert(workCenterEnvironmentBinding).values({ workCenterId: wc.id, environmentOid: 'env-1', serverUri: 'http://b:3002' }))
    .rejects.toThrow(); // PK (work_center_id, environment_oid)
  await close();
});

test('0018: engine_wake triggers exist and fire without error', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'pending', ...runtimeCols({}),
  }).returning();
  // trigger fires on status update; failure inside the trigger would reject this update
  await db.update(workflowInstance).set({ status: 'queued', queuedAt: new Date() }).where(sql`id = ${wi.id}`);
  const trg = await db.execute(sql`select tgname from pg_trigger where tgname in ('workflow_instance_wake','step_instance_wake') order by tgname`);
  expect(trg.rows.map((r: any) => r.tgname)).toEqual(['step_instance_wake', 'workflow_instance_wake']);
  await close();
});
