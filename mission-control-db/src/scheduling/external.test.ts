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
import { makeTestDb } from '../../test/helpers/db.js';
import {
  masterSchedule, runtimeSchedule, runtimeScheduleEvent, runtimeScheduleItem, scheduleItemRun, scheduleOccurrence,
  workCenter, workflow,
} from '../db/schema/index.js';
import { DaoError } from '../dao/errors.js';
import type { ScheduleActor } from './events.js';
import { listOccurrencesWithEndings, sendMasterSchedule } from './external.js';

const NOW = new Date('2026-11-08T12:00:00Z');
const actor: ScheduleActor = { kind: 'api_client', clientId: '00000000-0000-4000-8000-0000000000aa', name: 'ERP Scheduler' };
const spec = { starting_parameter_specifications: [], output_parameter_specifications: [{ id: 'Yield' }] };
const body = (at = '2026-11-10T06:00', workflowName = 'Blend') => ({
  name: 'PO-1', recurrence: { type: 'once', at }, items: [{ workflow: { name: workflowName } }],
});
const ENABLE = { enable: true, replaceActive: false };
const REPLACE = { enable: true, replaceActive: true };

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1', timeZone: 'America/Chicago' }).returning();
  await t.db.insert(workflow).values({ oid: 'o-Blend', name: 'Blend', workCenterId: wc!.id, version: '1.0.0', state: 'Effective', specJsonb: spec });
  return { ...t, wc: wc!.id };
}

const code = (err: unknown) => (err as DaoError).code;

test('walks the re-send table: enable, reuse, refuse, replace', async () => {
  const { db, wc, close } = await setup();
  const first = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  expect(first).toMatchObject({ created: true, changed: true, outcome: 'enabled', replaced: null });
  expect(first.runtime?.label).toBe('RS-1');

  const retry = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  expect(retry).toMatchObject({ created: false, changed: false, outcome: 'already_live' });
  expect(retry.runtime?.id).toBe(first.runtime?.id);

  await expect(sendMasterSchedule(db, wc, 'K', body('2026-11-10T08:00'), ENABLE, actor, NOW))
    .rejects.toSatisfy((e) => e instanceof DaoError && e.code === 'RUNTIME_ACTIVE');

  const replaced = await sendMasterSchedule(db, wc, 'K', body('2026-11-10T08:00'), REPLACE, actor, NOW);
  expect(replaced).toMatchObject({ outcome: 'enabled', changed: false });
  expect(replaced.runtime?.nextFireAt?.toISOString()).toBe('2026-11-10T14:00:00.000Z');
  expect(replaced.replaced).toEqual({ id: first.runtime?.id, label: 'RS-1', status: 'cancelled', runsStillGoing: 0, chainsCancelled: 0 });
  await close();
});

test('a failed Enable under replaceActive undoes the cancel but keeps the saved Master', async () => {
  const { db, wc, close } = await setup();
  const first = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  const err = await sendMasterSchedule(db, wc, 'K', body('2026-11-10T08:00', 'Missing'), REPLACE, actor, NOW).catch((e) => e);
  expect(code(err)).toBe('ENABLE_INVALID');

  const [old] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, first.runtime!.id));
  expect(old).toMatchObject({ status: 'active', endedAt: null });
  const items = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, old!.id));
  expect(items[0]!.specJsonb).not.toBeNull();
  const events = await db.select().from(runtimeScheduleEvent).where(eq(runtimeScheduleEvent.runtimeScheduleId, old!.id));
  expect(events.map((e) => e.action)).toEqual(['enabled']);

  const [m] = await db.select().from(masterSchedule).where(eq(masterSchedule.id, first.master.id));
  expect(m!.revision).toBe(2);
  await close();
});

test('the same revision is decided by revision alone, whichever attempt this is', async () => {
  const { db, wc, close } = await setup();
  const first = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  await db.update(runtimeSchedule).set({ status: 'cancelled', nextFireAt: null }).where(eq(runtimeSchedule.id, first.runtime!.id));
  for (let i = 0; i < 2; i++) {
    const again = await sendMasterSchedule(db, wc, 'K', body(), REPLACE, actor, NOW);
    expect(again.outcome).toBe('already_ended');
    expect(again.runtime?.id).toBe(first.runtime?.id);
  }
  expect(await db.select().from(runtimeSchedule)).toHaveLength(1);
  await close();
});

test('a retry reports the warnings Enable gave', async () => {
  const { db, wc, close } = await setup();
  await db.update(workflow).set({ state: 'Draft' }).where(eq(workflow.workCenterId, wc));
  const first = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  expect(first.warnings).toHaveLength(1);
  const retry = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  expect(retry.warnings).toEqual(first.warnings);
  await close();
});

test('without enable it only saves', async () => {
  const { db, wc, close } = await setup();
  const r = await sendMasterSchedule(db, wc, 'K', body(), { enable: false, replaceActive: false }, actor, NOW);
  expect(r).toMatchObject({ created: true, outcome: 'saved', runtime: null, replaced: null, warnings: [] });
  expect(await db.select().from(runtimeSchedule)).toHaveLength(0);
  await close();
});

test('occurrences carry the ending and, once ended, the outputs', async () => {
  const { db, wc, close } = await setup();
  const { runtime } = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  const [item] = await db.select().from(runtimeScheduleItem).where(eq(runtimeScheduleItem.runtimeScheduleId, runtime!.id));
  const [occ] = await db.insert(scheduleOccurrence).values({ runtimeScheduleId: runtime!.id, number: 1, scheduledAt: NOW }).returning();
  const [done] = await db.insert(scheduleItemRun).values({
    occurrenceId: occ!.id, itemId: item!.id, status: 'finished', finalState: 'stopped', runtimeLabel: 'RW-9', finishedAt: NOW,
    triggerValues: { inputs: { A: '1' }, outputs: { Yield: '9' } },
  }).returning();
  const page = await listOccurrencesWithEndings(db, runtime!.id, { limit: 10, offset: 0 });
  expect(page.total).toBe(1);
  expect(page.rows[0]!.runs).toEqual([{
    id: done!.id, itemId: item!.id, workflowName: 'Blend', parentRunId: null, runtimeLabel: 'RW-9', status: 'finished',
    ending: 'stopped', finishedAt: NOW, detail: null, acknowledgedAt: null, outputs: { Yield: '9' },
  }]);

  await db.update(scheduleItemRun).set({ status: 'started', finalState: null, finishedAt: null }).where(eq(scheduleItemRun.id, done!.id));
  const going = await listOccurrencesWithEndings(db, runtime!.id, { limit: 10, offset: 0 });
  expect(going.rows[0]!.runs[0]).not.toHaveProperty('outputs');
  await close();
});

test('a Master deleted while running: the key still finds its Runtime', async () => {
  const { db, wc, close } = await setup();
  const first = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  await db.delete(masterSchedule).where(eq(masterSchedule.id, first.master.id));
  const again = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  expect(again).toMatchObject({ created: true, outcome: 'already_live' });
  expect(again.master.id).not.toBe(first.master.id);
  expect(again.runtime?.id).toBe(first.runtime?.id);
  expect(await db.select().from(runtimeSchedule)).toHaveLength(1);
  await close();
});

test('a retry is compared by what was stored, even when storing changed the text', async () => {
  const { db, wc, close } = await setup();
  await db.execute(sql.raw(`create function test_normalize_name() returns trigger language plpgsql as $$
    begin new.name := replace(new.name, 'X', 'Y'); return new; end $$`));
  await db.execute(sql.raw(`create trigger test_normalize_name before insert or update on master_schedule
    for each row execute function test_normalize_name()`));
  const sent = { ...body(), name: 'PO-X' };
  const first = await sendMasterSchedule(db, wc, 'K', sent, ENABLE, actor, NOW);
  expect(first.master.name).toBe('PO-Y');
  const retry = await sendMasterSchedule(db, wc, 'K', sent, ENABLE, actor, NOW);
  expect(retry.outcome).toBe('already_live');
  expect(retry.runtime?.id).toBe(first.runtime?.id);
  await close();
});

test('a name with spaces around it retries as the same content', async () => {
  const { db, wc, close } = await setup();
  const sent = { ...body(), name: '  PO-1  ' };
  const first = await sendMasterSchedule(db, wc, 'K', sent, ENABLE, actor, NOW);
  expect(first.master.name).toBe('PO-1');
  const retry = await sendMasterSchedule(db, wc, 'K', sent, ENABLE, actor, NOW);
  expect(retry).toMatchObject({ changed: false, outcome: 'already_live' });
  await close();
});

test('A, B without enable, A: the live Runtime still matches', async () => {
  const { db, wc, close } = await setup();
  const first = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  await sendMasterSchedule(db, wc, 'K', body('2026-11-10T08:00'), { enable: false, replaceActive: false }, actor, NOW);
  const again = await sendMasterSchedule(db, wc, 'K', body(), ENABLE, actor, NOW);
  expect(again.outcome).toBe('already_live');
  expect(again.runtime?.id).toBe(first.runtime?.id);
  expect(again.master.revision).toBe(3);
  await close();
});
