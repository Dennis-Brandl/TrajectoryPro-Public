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
import { apiClient, appUser, workCenter, runtimeScheduleEvent, masterScheduleItem } from '../db/schema/index.js';
import type { DaoError } from '../dao/errors.js';
import type { ScheduleActor } from './events.js';
import {
  createMasterSchedule, replaceMasterSchedule, upsertMasterScheduleByKey,
  getMasterSchedule, listMasterSchedules, deleteMasterSchedule,
} from './master-dao.js';

let user: ScheduleActor;
const client: ScheduleActor = { kind: 'api_client', clientId: '00000000-0000-0000-0000-0000000000c1', name: 'ERP' };
const recurrence = { type: 'once', at: '2026-11-10T06:00' };
const body = (extra: Record<string, unknown> = {}) => ({
  name: 'Nightly',
  description: 'd',
  recurrence,
  items: [
    { workflow: { name: 'A' }, params: { P: { value: '1' } }, chain: [
      { workflow: { name: 'C1', version: '2.0' }, triggerOn: ['completed', 'errored'] },
      { workflow: { name: 'C2' }, triggerOn: ['aborted'], chain: [{ workflow: { name: 'D' }, triggerOn: ['stopped'] }] },
    ] },
    { workflow: { name: 'B' } },
  ],
  ...extra,
});
async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'WC' }).returning();
  const [u] = await t.db.insert(appUser).values({ email: 'una@example.com', displayName: 'Una', loginName: 'una' }).returning();
  user = { kind: 'user', userId: u.id, name: 'Una' };
  return { ...t, wcId: wc.id };
}
const errOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DaoError; } return undefined; };

test('create then read returns the same tree in input order', async () => {
  const { db, close, wcId } = await setup();
  const m = await createMasterSchedule(db, wcId, body(), { kind: 'system' });
  const got = await getMasterSchedule(db, m.id);
  expect(got).toBeDefined();
  expect(got!.items).toEqual(body().items);
  expect(got!.revision).toBe(1);
  expect(got!.source).toBe('commander');
  expect(got!.externalKey).toBeNull();
  expect(got!.recurrenceText).toBeTruthy();
  expect(await listMasterSchedules(db, wcId)).toHaveLength(1);
  await close();
});

test('reordering the start list shows the new order and bumps the revision', async () => {
  const { db, close, wcId } = await setup();
  const m = await createMasterSchedule(db, wcId, body(), user);
  const b = body();
  b.items.reverse();
  const r = await replaceMasterSchedule(db, m.id, b, user);
  expect(r.revision).toBe(2);
  expect((await getMasterSchedule(db, m.id))!.items.map((i) => i.workflow.name)).toEqual(['B', 'A']);
  await close();
});

test('an identical replace keeps the revision', async () => {
  const { db, close, wcId } = await setup();
  const m = await createMasterSchedule(db, wcId, body(), user);
  const r = await replaceMasterSchedule(db, m.id, body(), user);
  expect(r.revision).toBe(1);
  await close();
});

test('upsert creates as api, is idempotent, and a Commander edit keeps source and key', async () => {
  const { db, close, wcId } = await setup();
  const a = await upsertMasterScheduleByKey(db, wcId, 'k1', body(), client);
  expect(a).toMatchObject({ created: true, changed: true });
  expect(a.master.source).toBe('api');
  expect(a.master.externalKey).toBe('k1');
  const same = await upsertMasterScheduleByKey(db, wcId, 'k1', body(), client);
  expect(same).toMatchObject({ created: false, changed: false });
  expect(same.master.revision).toBe(1);
  const edited = await replaceMasterSchedule(db, a.master.id, body({ description: 'edited' }), user);
  expect(edited).toMatchObject({ source: 'api', externalKey: 'k1', revision: 2 });
  const again = await upsertMasterScheduleByKey(db, wcId, 'k1', body(), client);
  expect(again).toMatchObject({ created: false, changed: true });
  expect(again.master).toMatchObject({ source: 'api', revision: 3, description: 'd' });
  await close();
});

test('duplicate name and bad body give typed errors', async () => {
  const { db, close, wcId } = await setup();
  await createMasterSchedule(db, wcId, body(), user);
  expect((await errOf(createMasterSchedule(db, wcId, body(), user)))?.code).toBe('MASTER_SCHEDULE_NAME_CONFLICT');
  const bad = await errOf(createMasterSchedule(db, wcId, { name: '' }, user));
  expect(bad?.code).toBe('MASTER_SCHEDULE_INVALID');
  expect(Array.isArray(bad?.details)).toBe(true);
  await close();
});

test('delete works when workflow names do not exist, cascades items, and is audited', async () => {
  const { db, close, wcId } = await setup();
  const m = await createMasterSchedule(db, wcId, body(), client);
  await deleteMasterSchedule(db, m.id, client);
  expect(await getMasterSchedule(db, m.id)).toBeUndefined();
  expect(await db.select().from(masterScheduleItem).where(eq(masterScheduleItem.masterScheduleId, m.id))).toHaveLength(0);
  const ev = await db.select().from(runtimeScheduleEvent).where(eq(runtimeScheduleEvent.masterScheduleId, m.id));
  expect(ev.map((e) => e.action).sort()).toEqual(['master_created', 'master_deleted']);
  expect(ev[0]).toMatchObject({ runtimeScheduleId: null, actorKind: 'api_client', actorId: client.clientId, actorName: 'ERP' });
  expect((await errOf(deleteMasterSchedule(db, m.id, client)))?.code).toBe('MASTER_SCHEDULE_NOT_FOUND');
  await close();
});

test('managedBy names the API client that last wrote the Master, and is null for a Commander write', async () => {
  const { db, close, wcId } = await setup();
  await db.insert(apiClient).values({ id: (client as { clientId: string }).clientId, name: 'ERP Scheduler', tokenHash: 'h', tokenPrefix: 'p' });
  const sent = await createMasterSchedule(db, wcId, body(), client);
  expect((await getMasterSchedule(db, sent.id))!.managedBy).toBe('ERP Scheduler');
  expect((await listMasterSchedules(db, wcId))[0]!.managedBy).toBe('ERP Scheduler');
  const edited = await replaceMasterSchedule(db, sent.id, body({ description: 'edited here' }), user);
  expect(edited.managedBy).toBeNull();
  await close();
});
