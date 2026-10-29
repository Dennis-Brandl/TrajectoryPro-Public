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
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import { workCenter, workflow } from './index.js';
import { workflowInstance } from './execution.js';
import { schedule, triggerCondition } from './scheduling.js';

test('schedule enforces kind check and holds trigger conditions', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [s] = await db.insert(schedule).values({ workCenterId: wc.id, workflowId: wf.id, name: 'Nightly', kind: 'recurring', cronExpr: '0 2 * * *' }).returning();
  await db.insert(triggerCondition).values({ scheduleId: s.id, type: 'event', expression: { event: 'lot.released' } });
  await expect(db.insert(schedule).values({ workCenterId: wc.id, workflowId: wf.id, name: 'Bad', kind: 'bogus' as any })).rejects.toThrow();
  await close();
});

test('workflow_instance.schedule_id FK (added via custom ALTER migration) rejects unknown schedules', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w2', name: 'W2', workCenterId: wc.id, specJsonb: {} }).returning();
  const [s] = await db.insert(schedule).values({ workCenterId: wc.id, workflowId: wf.id, name: 'Nightly', kind: 'recurring', cronExpr: '0 2 * * *' }).returning();

  // Valid scheduleId succeeds.
  const [inst] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, scheduleId: s.id, triggeredBy: 'schedule',
    ...runtimeCols(),
  }).returning();
  expect(inst.scheduleId).toBe(s.id);

  // Non-existent scheduleId is rejected by the ALTER-added FK.
  await expect(db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, scheduleId: '00000000-0000-0000-0000-000000000000', triggeredBy: 'schedule',
    ...runtimeCols(),
  })).rejects.toThrow();
  await close();
});
