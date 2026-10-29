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
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, workflow } from '../db/schema/index.js';
import { schedule, scheduleRun } from '../db/schema/scheduling.js';
import { workflowInstance } from '../db/schema/execution.js';
import { fireDueTimeSchedules } from './firing.js';

test('a due one_time schedule fires: instance + schedule_run created, schedule disabled', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: { steps: [], children: [] } }).returning();
  const past = new Date(Date.parse('2026-01-01T00:00:00Z'));
  const [s] = await db.insert(schedule).values({ workCenterId: wc.id, workflowId: wf.id, name: 'Once', kind: 'one_time', runAt: past, nextFireAt: past }).returning();

  const res = await fireDueTimeSchedules(db, new Date(Date.parse('2026-02-01T00:00:00Z')));
  expect(res.fired).toEqual([s.id]);
  expect(await db.select().from(workflowInstance)).toHaveLength(1);
  expect(await db.select().from(scheduleRun).where(eq(scheduleRun.scheduleId, s.id))).toHaveLength(1);
  const [after] = await db.select().from(schedule).where(eq(schedule.id, s.id));
  expect(after.enabled).toBe(false);
  await close();
});
