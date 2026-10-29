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
import { workCenter, workCenterUser, workflow, workflowInstance, runtimeHistory } from './index.js';

const SPEC = { oid: 'wf-1', steps: [], connections: [] };

async function seedWcWf(db: Awaited<ReturnType<typeof makeTestDb>>['db']) {
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'wf-1', name: 'WF', workCenterId: wc.id, specJsonb: SPEC,
  }).returning();
  return { wc, wf };
}

function instCols(wcId: string, wfId: string, n: number) {
  return {
    workflowId: wfId, workCenterId: wcId, triggeredBy: 'manual' as const, status: 'pending',
    specJsonb: SPEC, runtimeNumber: n, runtimeLabel: `RW-${n}`,
    masterName: 'WF', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Draft',
  };
}

test('workflow_instance accepts queued; rejects unknown status', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seedWcWf(db);
  await db.insert(workflowInstance).values({ ...instCols(wc.id, wf.id, 1), status: 'queued' });
  await expect(
    db.insert(workflowInstance).values({ ...instCols(wc.id, wf.id, 2), status: 'bogus' }),
  ).rejects.toThrow();
  await close();
});

test('runtime_number unique per work center, independent across work centers', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWcWf(db);
  const b = await seedWcWf(db);
  await db.insert(workflowInstance).values(instCols(a.wc.id, a.wf.id, 1));
  await expect(db.insert(workflowInstance).values(instCols(a.wc.id, a.wf.id, 1))).rejects.toThrow();
  await db.insert(workflowInstance).values(instCols(b.wc.id, b.wf.id, 1)); // other WC: fine
  await close();
});

test('work_center_user.mission_system_commander defaults false; next_runtime_number defaults 1', async () => {
  const { db, close } = await makeTestDb();
  const { wc } = await seedWcWf(db);
  expect(wc.nextRuntimeNumber).toBe(1);
  const res = await db.execute(sql`select column_default from information_schema.columns
    where table_name = 'work_center_user' and column_name = 'mission_system_commander'`);
  expect(String((res.rows as { column_default: string }[])[0].column_default)).toContain('false');
  await close();
});

test('runtime_history: final_state CHECK; duplicate instance id rejected; NULL ids coexist', async () => {
  const { db, close } = await makeTestDb();
  const base = {
    workCenterName: 'WC', runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'WF', masterOid: 'wf-1',
    masterVersion: '1.0.0', masterState: 'Draft', finalState: 'completed',
    finishedAt: new Date(), trace: [],
  };
  await db.insert(runtimeHistory).values({ ...base });                      // NULL instance id
  await db.insert(runtimeHistory).values({ ...base });                      // second NULL: fine
  const iid = crypto.randomUUID();
  await db.insert(runtimeHistory).values({ ...base, workflowInstanceId: iid });
  await expect(db.insert(runtimeHistory).values({ ...base, workflowInstanceId: iid })).rejects.toThrow();
  await expect(db.insert(runtimeHistory).values({ ...base, finalState: 'running' })).rejects.toThrow();
  await close();
});
