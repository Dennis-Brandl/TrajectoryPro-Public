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
import { eq, sql } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { workCenter } from './work-centers.js';
import {
  masterSchedule, masterScheduleItem, runtimeSchedule, runtimeScheduleItem,
  scheduleOccurrence, scheduleItemRun, runtimeScheduleEvent, apiClient,
  SCHEDULE_ENDINGS, RUNTIME_SCHEDULE_STATUSES, SCHEDULE_ITEM_RUN_STATUSES,
} from './schedules.js';

const REC = { kind: 'interval', every: 1, unit: 'day' };

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: 'WC', timeZone: 'America/Chicago' }).returning();
  const [m] = await db.insert(masterSchedule).values({
    workCenterId: wc.id, name: 'M1', recurrence: REC, source: 'commander',
  }).returning();
  return { wc, m };
}
const rsValues = (wcId: string, mId: string, over: Record<string, unknown> = {}) => ({
  workCenterId: wcId, workCenterName: 'WC', masterScheduleId: mId, runtimeNumber: 1, label: 'RS-1',
  name: 'M1', recurrence: REC, timeZone: 'UTC', masterRevision: 1, definitionHash: 'h', status: 'active', ...over,
});
const itemValues = (rsId: string) => ({
  runtimeScheduleId: rsId, position: 0, masterName: 'W', masterOid: 'o', masterVersion: '1', masterState: 'Draft',
});

test('vocabularies are exported', () => {
  expect(SCHEDULE_ENDINGS).toEqual(['completed', 'stopped', 'aborted', 'errored']);
  expect(RUNTIME_SCHEDULE_STATUSES).toEqual(['active', 'paused', 'cancelled', 'finished']);
  expect(SCHEDULE_ITEM_RUN_STATUSES).toContain('start_requested');
});

test('the rows the tick looks for each tick have a partial index', async () => {
  const { db, close } = await makeTestDb();
  const found = await db.execute(sql.raw(
    `select indexdef from pg_indexes where indexname = 'schedule_item_run_start_requested_idx'`,
  ));
  expect((found as any).rows).toHaveLength(1);
  expect((found as any).rows[0].indexdef).toMatch(/\(created_at\) WHERE \(status = 'start_requested'::text\)/);
  await close();
});

test('one active or paused Runtime per Master; a new one is fine after cancel', async () => {
  const { db, close } = await makeTestDb();
  const { wc, m } = await seed(db);
  const [first] = await db.insert(runtimeSchedule).values(rsValues(wc.id, m.id)).returning();
  await expect(db.insert(runtimeSchedule).values(rsValues(wc.id, m.id, { runtimeNumber: 2, label: 'RS-2' })))
    .rejects.toMatchObject({ cause: { code: '23505' } });
  await expect(db.insert(runtimeSchedule).values(rsValues(wc.id, m.id, { runtimeNumber: 2, label: 'RS-2', status: 'paused' })))
    .rejects.toMatchObject({ cause: { code: '23505' } });
  await db.update(runtimeSchedule).set({ status: 'cancelled' }).where(eq(runtimeSchedule.id, first.id));
  await db.insert(runtimeSchedule).values(rsValues(wc.id, m.id, { runtimeNumber: 2, label: 'RS-2' }));
  await close();
});

test('duplicate occurrence slot and duplicate item run both fail', async () => {
  const { db, close } = await makeTestDb();
  const { wc, m } = await seed(db);
  const [rs] = await db.insert(runtimeSchedule).values(rsValues(wc.id, m.id)).returning();
  const [item] = await db.insert(runtimeScheduleItem).values(itemValues(rs.id)).returning();
  const at = new Date('2026-11-09T10:00:00Z');
  const [occ] = await db.insert(scheduleOccurrence).values({ runtimeScheduleId: rs.id, number: 1, scheduledAt: at, origin: 'on_time' }).returning();
  await expect(db.insert(scheduleOccurrence).values({ runtimeScheduleId: rs.id, number: 2, scheduledAt: at, origin: 'on_time' }))
    .rejects.toMatchObject({ cause: { code: '23505' } });
  await db.insert(scheduleItemRun).values({ occurrenceId: occ.id, itemId: item.id, runtimeLabel: 'RW-1', status: 'started' });
  await expect(db.insert(scheduleItemRun).values({ occurrenceId: occ.id, itemId: item.id, runtimeLabel: 'RW-2', status: 'started' }))
    .rejects.toMatchObject({ cause: { code: '23505' } });
  await close();
});

test('external_key is unique per work center; many nulls allowed', async () => {
  const { db, close } = await makeTestDb();
  const { wc } = await seed(db);
  const v = (name: string, externalKey: string | null) => ({ workCenterId: wc.id, name, recurrence: REC, source: 'api', externalKey });
  await db.insert(masterSchedule).values([v('a', null), v('b', null)]);
  await db.insert(masterSchedule).values(v('c', 'k1'));
  await expect(db.insert(masterSchedule).values(v('d', 'k1'))).rejects.toMatchObject({ cause: { code: '23505' } });
  const [wc2] = await db.insert(workCenter).values({ name: 'WC2' }).returning();
  await db.insert(masterSchedule).values({ workCenterId: wc2.id, name: 'c', recurrence: REC, source: 'api', externalKey: 'k1' });
  // Name is unique within a work center too.
  await expect(db.insert(masterSchedule).values(v('c', null))).rejects.toMatchObject({ cause: { code: '23505' } });
  await close();
});

test('deleting a work center cascades Masters and nulls the Runtime link, keeping the name', async () => {
  const { db, close } = await makeTestDb();
  const { wc, m } = await seed(db);
  await db.insert(masterScheduleItem).values({ masterScheduleId: m.id, position: 0, workflowName: 'W' });
  const [rs] = await db.insert(runtimeSchedule).values(rsValues(wc.id, m.id)).returning();
  await db.delete(workCenter).where(eq(workCenter.id, wc.id));
  expect(await db.select().from(masterSchedule)).toHaveLength(0);
  expect(await db.select().from(masterScheduleItem)).toHaveLength(0);
  const [after] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, rs.id));
  expect(after.workCenterId).toBeNull();
  expect(after.masterScheduleId).toBeNull();
  expect(after.workCenterName).toBe('WC');
  await close();
});

test('values outside the vocabularies fail their check constraints', async () => {
  const { db, close } = await makeTestDb();
  const { wc, m } = await seed(db);
  await expect(db.insert(runtimeSchedule).values(rsValues(wc.id, m.id, { status: 'bogus' })))
    .rejects.toMatchObject({ cause: { code: '23514' } });
  const [rs] = await db.insert(runtimeSchedule).values(rsValues(wc.id, m.id)).returning();
  const [item] = await db.insert(runtimeScheduleItem).values(itemValues(rs.id)).returning();
  const [occ] = await db.insert(scheduleOccurrence).values({ runtimeScheduleId: rs.id, number: 1, scheduledAt: new Date(), origin: 'on_time' }).returning();
  await expect(db.insert(scheduleItemRun).values({ occurrenceId: occ.id, itemId: item.id, runtimeLabel: 'x', status: 'bogus' }))
    .rejects.toMatchObject({ cause: { code: '23514' } });
  await expect(db.insert(scheduleOccurrence).values({ runtimeScheduleId: rs.id, number: 2, scheduledAt: new Date(0), origin: 'bogus' }))
    .rejects.toMatchObject({ cause: { code: '23514' } });
  await close();
});

test('event and api client rows insert; the event keeps no FK to the runtime schedule', async () => {
  const { db, close } = await makeTestDb();
  await db.insert(runtimeScheduleEvent).values({
    actorKind: 'system', action: 'enabled', detail: { a: 1 },
    masterScheduleId: crypto.randomUUID(), runtimeScheduleId: crypto.randomUUID(),
  });
  await db.insert(apiClient).values({ name: 'c', tokenHash: 'h', tokenPrefix: 'mcx_abcd', scopes: ['schedules'], workCenterIds: [] });
  expect(await db.select().from(runtimeScheduleEvent)).toHaveLength(1);
  await close();
});

test('one live Runtime per external key in a work center, surviving the Master; null keys do not collide', async () => {
  const { db, close } = await makeTestDb();
  const { wc, m } = await seed(db);
  const on = (runtimeNumber: number, over: Record<string, unknown>) =>
    db.insert(runtimeSchedule).values(rsValues(wc.id, m.id, { runtimeNumber, label: `RS-${runtimeNumber}`, masterScheduleId: null, ...over }));
  await on(1, { externalKey: 'K', definitionHash: 'a' });
  await expect(on(2, { externalKey: 'K', definitionHash: 'b' })).rejects.toMatchObject({ cause: { code: '23505' } });
  await on(3, { externalKey: 'K', definitionHash: 'b', status: 'cancelled' });
  await on(4, { externalKey: 'L', definitionHash: 'b' });
  await on(5, { externalKey: null, definitionHash: 'c' });
  await on(6, { externalKey: null, definitionHash: 'c' });
  await close();
});

test('definition_hash is required', async () => {
  const { db, close } = await makeTestDb();
  const { wc, m } = await seed(db);
  await expect(db.insert(runtimeSchedule).values(rsValues(wc.id, m.id, { definitionHash: undefined })))
    .rejects.toMatchObject({ cause: { code: '23502' } });
  await close();
});
