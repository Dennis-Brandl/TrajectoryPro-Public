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
import { makeTestDb } from '../../test/helpers/db.js';
import { appUser, workCenter } from '../db/schema/index.js';
import type { DaoError } from '../dao/errors.js';
import type { ScheduleActor } from './events.js';
import {
  IMPORTED_FROM_PACKAGE, createMasterSchedule, deleteMasterSchedule, listMasterScheduleChanges, replaceMasterSchedule,
  upsertMasterScheduleByKey,
} from './master-dao.js';

const ONCE = { type: 'once', at: '2026-11-10T06:00' };
const def = (name = 'Nightly', at = '2026-11-10T06:00') => ({ name, recurrence: { ...ONCE, at }, items: [{ workflow: { name: 'Blend' } }] });
const errOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DaoError; } return undefined; };

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [u] = await t.db.insert(appUser).values({ email: 'una@x.io', displayName: 'Una', loginName: 'una' }).returning();
  const una: ScheduleActor = { kind: 'user', userId: u!.id, name: 'una' };
  return { ...t, wc: wc!, una };
}

test('each saved change makes the next version, and the history says when, who and why', async () => {
  const { db, close, wc, una } = await setup();
  try {
    const m = await createMasterSchedule(db, wc.id, def(), una, 'Initial version');
    expect(m.revision).toBe(1);
    const v2 = await replaceMasterSchedule(db, m.id, def('Nightly', '2026-11-11T06:00'), una, 'Moved a day later');
    expect(v2.revision).toBe(2);
    const same = await replaceMasterSchedule(db, m.id, def('Nightly', '2026-11-11T06:00'), una, 'Nothing really');
    expect(same.revision).toBe(2); // unchanged: no new version, no history line
    await replaceMasterSchedule(db, m.id, def('Nightly B', '2026-11-11T06:00'), una, '  Renamed  ');

    const changes = await listMasterScheduleChanges(db, m.id);
    expect(changes.map((c) => [c.version, c.actorKind, c.actorName, c.reason])).toEqual([
      [1, 'user', 'una', 'Initial version'],
      [2, 'user', 'una', 'Moved a day later'],
      [3, 'user', 'una', 'Renamed'],
    ]);
    expect(changes.every((c) => c.at instanceof Date)).toBe(true);
  } finally { await close(); }
});

test('a reason that cannot be stored is refused and nothing changes', async () => {
  const { db, close, wc, una } = await setup();
  try {
    const m = await createMasterSchedule(db, wc.id, def(), una, 'Initial version');
    for (const bad of ['   ', 'x'.repeat(2001), 'a\0b', '\ud800']) {
      expect((await errOf(replaceMasterSchedule(db, m.id, def('Other'), una, bad)))?.code).toBe('CONFIRMATION_REQUIRED');
    }
    expect(await listMasterScheduleChanges(db, m.id)).toHaveLength(1);
  } finally { await close(); }
});

test('sends through REST and package imports say where they came from', async () => {
  const { db, close, wc, una } = await setup();
  try {
    const client: ScheduleActor = { kind: 'api_client', clientId: 'e0000000-0000-4000-8000-000000000001', name: 'ERP' };
    const { master } = await upsertMasterScheduleByKey(db, wc.id, 'PO-1', def('Sent'), client);
    await upsertMasterScheduleByKey(db, wc.id, 'PO-1', def('Sent', '2026-11-12T06:00'), client);
    expect((await listMasterScheduleChanges(db, master.id)).map((c) => [c.version, c.actorName, c.reason])).toEqual([
      [1, 'ERP', 'Sent through the REST interface'], [2, 'ERP', 'Sent through the REST interface'],
    ]);
    const imported = await createMasterSchedule(db, wc.id, def('Imported'), una, IMPORTED_FROM_PACKAGE);
    expect((await listMasterScheduleChanges(db, imported.id))[0]!.reason).toBe('Imported from a work-center package');
  } finally { await close(); }
});

test('a save from before reasons were asked for reads as having none, and the history outlives a delete', async () => {
  const { db, close, wc, una } = await setup();
  try {
    const m = await createMasterSchedule(db, wc.id, def(), una);
    await replaceMasterSchedule(db, m.id, def('Nightly', '2026-11-11T06:00'), una);
    await deleteMasterSchedule(db, m.id, una);
    expect((await listMasterScheduleChanges(db, m.id)).map((c) => [c.version, c.reason])).toEqual([[1, null], [2, null]]);
  } finally { await close(); }
});
