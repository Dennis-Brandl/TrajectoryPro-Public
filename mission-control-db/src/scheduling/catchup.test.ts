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

import { afterEach, expect, test, vi } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { runtimeScheduleItem, scheduleItemRun, scheduleOccurrence, workflowInstance } from '../db/schema/index.js';
import {
  BLEND_ONLY, HOURLY, TREE, at, person, setupSchedules, type Schedules,
} from '../../test/helpers/schedule-fixture.js';
import { runCatchup } from './catchup.js';
import { pauseRuntimeSchedule, resumeRuntimeSchedule, setRuntimeItemDisabled } from './controls.js';

const iso = (hhmm: string, day = '09') => at(hhmm, day).toISOString();

afterEach(() => vi.restoreAllMocks());

/** Blend Batch's two chains, held and then asked to start. */
async function requested(s: Schedules) {
  const id = await s.enable();
  await s.tick(at('01:00'));
  await pauseRuntimeSchedule(s.db, id, person, at('01:30'));
  await s.endRun((await s.runs(id))['Blend Batch']!, at('01:40'));
  await s.tick(at('01:40'));
  await resumeRuntimeSchedule(s.db, id, {}, person, at('01:50'));
  return id;
}

test('one tick fires at most 20 slots, oldest first, and the catch-up clears when they are done', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.setRuntime(id, { catchupMode: 'all', catchupCursor: at('01:00'), catchupTo: at('01:00', '11'), nextFireAt: at('02:00', '11') });
    // 49 slots from the 9th at 01:00 to the 11th at 01:00.

    expect(await runCatchup(s.db, at('01:30', '11'))).toBe(20);
    expect((await s.rowOf(id)).catchupCursor).toEqual(at('21:00'));
    const occurrences = await s.occurrences(id);
    expect(occurrences[0]).toMatchObject({ number: 1, scheduledAt: at('01:00'), origin: 'resume' });
    expect(occurrences[19]).toMatchObject({ number: 20, scheduledAt: at('20:00'), origin: 'resume' });

    expect(await runCatchup(s.db, at('01:31', '11'))).toBe(20);
    expect(await runCatchup(s.db, at('01:32', '11'))).toBe(9);
    expect(await s.rowOf(id)).toMatchObject({ catchupMode: null, catchupCursor: null, catchupTo: null, nextFireAt: at('02:00', '11') });
    expect(await s.occurrences(id)).toHaveLength(49);
    expect(await runCatchup(s.db, at('01:33', '11'))).toBe(0);

    const labels = await s.rawDb.select({ label: workflowInstance.scheduleLabel }).from(workflowInstance)
      .orderBy(asc(workflowInstance.queuedAt));
    expect(labels[0]!.label).toBe('RS-1 / occurrence 1');
    expect(labels[48]!.label).toBe('RS-1 / occurrence 49');
  } finally { await s.close(); }
});

test('a window whose remaining slots all have occurrences just clears', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.rawDb.insert(scheduleOccurrence).values({
      runtimeScheduleId: id, number: 1, scheduledAt: at('01:00'), origin: 'on_time',
    });
    await s.setRuntime(id, { catchupMode: 'all', catchupCursor: at('01:00'), catchupTo: at('01:30'), nextFireAt: at('02:00') });
    expect(await runCatchup(s.db, at('01:40'))).toBe(0);
    expect(await s.rowOf(id)).toMatchObject({ catchupMode: null, catchupCursor: null, catchupTo: null });
    expect(await s.occurrences(id)).toHaveLength(1);
  } finally { await s.close(); }
});

test('a slot recorded by someone else in a race is skipped, and the cursor moves on', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.setRuntime(id, { catchupMode: 'all', catchupCursor: at('01:00'), catchupTo: at('03:00'), nextFireAt: at('04:00') });
    await s.db.execute(sql.raw(`create function race() returns trigger language plpgsql as $$
      begin
        if new.number = 2 then
          raise unique_violation using message = 'duplicate key value violates unique constraint "schedule_occurrence_slot_uq"';
        end if;
        return new;
      end $$`));
    await s.db.execute(sql.raw('create trigger race before insert on schedule_occurrence for each row execute function race()'));

    expect(await runCatchup(s.db, at('03:30'))).toBe(2);

    expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('03:00')]);
    expect((await s.rowOf(id)).catchupMode).toBeNull();
    expect(await s.events(id, 'slot_already_recorded')).toHaveLength(1);
  } finally { await s.close(); }
});

test('a transient error rolls the slot back, leaves the cursor, and a later tick carries it out once', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    const other = await s.enable(HOURLY, BLEND_ONLY);
    await s.setRuntime(id, { catchupMode: 'all', catchupCursor: at('01:00'), catchupTo: at('02:00'), nextFireAt: at('03:00') });
    await s.setRuntime(other, { catchupMode: 'all', catchupCursor: at('01:30'), catchupTo: at('02:00'), nextFireAt: at('03:00') });
    await s.db.execute(sql.raw(`create function fail_run() returns trigger language plpgsql as $$
      begin
        if new.schedule_label like 'RS-1 %' then raise exception 'raised on purpose' using errcode = '40P01'; end if;
        return new;
      end $$`));
    await s.db.execute(sql.raw('create trigger fail_run before insert on workflow_instance for each row execute function fail_run()'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A broken Runtime does not hold up the others.
    expect(await runCatchup(s.db, at('02:30'))).toBe(1);
    expect(await s.occurrences(id)).toHaveLength(0);
    expect((await s.rowOf(id)).catchupCursor).toEqual(at('01:00'));
    expect(await s.occurrences(other)).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(1);

    await s.db.execute(sql.raw('drop trigger fail_run on workflow_instance'));
    expect(await runCatchup(s.db, at('02:31'))).toBe(2);
    expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('02:00')]);
    expect(await s.queue()).toHaveLength(3);
  } finally { await s.close(); }
});

test('a Runtime no longer active is passed over, slots and start_requested rows alike', async () => {
  const s = await setupSchedules();
  try {
    const id = await requested(s);
    await s.setRuntime(id, { status: 'paused', catchupMode: 'all', catchupCursor: at('02:00'), catchupTo: at('02:30') });
    expect(await runCatchup(s.db, at('03:00'))).toBe(0);
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'start_requested', 'Clean Equipment': 'start_requested' });
    expect(await s.slotTimes(id)).toEqual([iso('01:00')]);

    await s.setRuntime(id, { status: 'active' });
    expect(await runCatchup(s.db, at('03:00'))).toBe(3);
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'started', 'Clean Equipment': 'started' });
  } finally { await s.close(); }
});

test('an item disabled after Resume does not start: skipped_disabled', async () => {
  const s = await setupSchedules();
  try {
    const id = await requested(s);
    await setRuntimeItemDisabled(s.db, (await s.itemNamed(id, 'Clean Equipment')).id, true, person, at('01:55'));
    expect(await runCatchup(s.db, at('02:00'))).toBe(2);
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'started', 'Clean Equipment': 'skipped_disabled' });
    expect((await s.runs(id))['Clean Equipment']!.workflowInstanceId).toBeNull();
  } finally { await s.close(); }
});

/**
 * The db a Disable reaches at the worst moment: within each transaction, just as the second query,
 * the Runtime lock, is issued, and so after the item was first read. PGlite runs one transaction at
 * a time, so the change is made inside this one, as it would look had another committed.
 */
function disablingBeforeRuntimeLock(s: Schedules, itemId: string) {
  return new Proxy(s.db, {
    get(target, prop) {
      if (prop !== 'transaction') return Reflect.get(target, prop);
      return (work: (tx: unknown) => Promise<unknown>) => target.transaction((tx: any) => {
        let selects = 0;
        return work(new Proxy(tx, {
          get(t, p) {
            const value = Reflect.get(t, p);
            if (p !== 'select') return typeof value === 'function' ? value.bind(t) : value;
            return (...args: unknown[]) => {
              if (++selects === 2) {
                void t.update(runtimeScheduleItem).set({ disabled: true }).where(eq(runtimeScheduleItem.id, itemId))
                  .then(() => {});
              }
              return t.select(...args);
            };
          },
        }));
      });
    },
  });
}

test('a Disable committed just before the Runtime lock is seen: the chain does not start', async () => {
  const s = await setupSchedules();
  try {
    const id = await requested(s);
    const move = await s.itemNamed(id, 'Move Material');
    const before = (await s.queue()).length;

    await runCatchup(disablingBeforeRuntimeLock(s, move.id), at('02:00'));

    expect((await s.statuses(id))['Move Material']).toBe('skipped_disabled');
    expect((await s.runs(id))['Move Material']!.workflowInstanceId).toBeNull();
    expect(await s.queue()).toHaveLength(before + 1); // Clean Equipment alone
  } finally { await s.close(); }
});

test('a chain whose value is missing records failed_to_start and the rest go on', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, [{
      workflow: { name: 'Blend Batch' },
      chain: [
        { workflow: { name: 'Lab Test' }, triggerOn: ['completed'], params: { BatchId: { from: 'trigger.output', name: 'Yield' } } },
        { workflow: { name: 'Move Material' }, triggerOn: ['completed'] },
      ],
    }]);
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:30'));
    const blend = (await s.runs(id))['Blend Batch']!;
    await s.endRun(blend, at('01:40'));
    await s.tick(at('01:40'));
    await resumeRuntimeSchedule(s.db, id, {}, person, at('01:50'));

    expect(await runCatchup(s.db, at('01:51'))).toBe(2);

    expect(await s.statuses(id)).toMatchObject({ 'Lab Test': 'failed_to_start', 'Move Material': 'started' });
    expect((await s.runs(id))['Lab Test']!.detail).toBe(`Yield has no value from ${blend.runtimeLabel}`);
  } finally { await s.close(); }
});

/** `count` occurrences of a Runtime, each with a finished Blend Batch and its Move Material asked to start. */
async function manyRequested(s: Schedules, id: string, count: number) {
  const blend = await s.itemNamed(id, 'Blend Batch');
  const move = await s.itemNamed(id, 'Move Material');
  for (let k = 1; k <= count; k++) {
    const [occ] = await s.rawDb.insert(scheduleOccurrence).values({
      runtimeScheduleId: id, number: k, scheduledAt: new Date(at('00:00', '20').getTime() + k * 60_000), origin: 'on_time',
    }).returning();
    const [parent] = await s.rawDb.insert(scheduleItemRun).values({
      occurrenceId: occ!.id, itemId: blend.id, status: 'finished', finalState: 'completed',
      triggerValues: { inputs: { BatchId: `B-${k}` }, outputs: {} },
    }).returning();
    await s.rawDb.insert(scheduleItemRun).values({
      occurrenceId: occ!.id, itemId: move.id, parentRunId: parent!.id, status: 'start_requested',
      // Newest first on insert, so the order can only come from created_at.
      createdAt: new Date(at('00:00', '20').getTime() - k * 60_000),
    });
  }
}

test('one tick starts at most 50 held chains, oldest first, and that Runtime\'s slots wait for all of them', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, TREE);
    await manyRequested(s, id, 51);
    await s.setRuntime(id, { catchupMode: 'all', catchupCursor: at('01:00'), catchupTo: at('01:00'), nextFireAt: at('02:00') });

    expect(await runCatchup(s.db, at('01:30'))).toBe(50);

    const params = (await s.queue()).map((q) => (q.params as { BatchId: string }).BatchId);
    expect(params[0]).toBe('B-51');
    expect(params[49]).toBe('B-2');
    expect((await s.rowOf(id)).catchupMode).toBe('all');
    expect(await s.slotTimes(id)).not.toContain(iso('01:00'));

    expect(await runCatchup(s.db, at('01:31'))).toBe(2);
    expect((await s.queue()).map((q) => (q.params as { BatchId: string }).BatchId)[50]).toBe('B-1');
    expect(await s.slotTimes(id)).toContain(iso('01:00'));
    expect((await s.rowOf(id)).catchupMode).toBeNull();
  } finally { await s.close(); }
});

test('another Runtime\'s waiting chains do not hold up this one\'s slots', async () => {
  const s = await setupSchedules();
  try {
    const waiting = await requested(s);
    const other = await s.enable(HOURLY, BLEND_ONLY);
    await s.setRuntime(other, { catchupMode: 'all', catchupCursor: at('01:00'), catchupTo: at('01:00'), nextFireAt: at('02:00') });
    expect(await runCatchup(s.db, at('01:55'))).toBe(3);
    expect(await s.statuses(waiting)).toMatchObject({ 'Move Material': 'started' });
    expect(await s.slotTimes(other)).toEqual([iso('01:00')]);
  } finally { await s.close(); }
});

test('a chain that throws is logged, stays start_requested for a later tick, and keeps its Runtime\'s slots back', async () => {
  const s = await setupSchedules();
  try {
    const id = await requested(s);
    await s.setRuntime(id, { catchupMode: 'all', catchupCursor: at('01:00'), catchupTo: at('01:00') });
    await s.db.execute(sql.raw(`create function fail_run() returns trigger language plpgsql as $$
      begin raise exception 'raised on purpose' using errcode = '40P01'; end $$`));
    await s.db.execute(sql.raw('create trigger fail_run before insert on workflow_instance for each row execute function fail_run()'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = (await s.queue()).length;

    expect(await runCatchup(s.db, at('02:00'))).toBe(0);
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'start_requested', 'Clean Equipment': 'start_requested' });
    expect(await s.queue()).toHaveLength(before);
    expect((await s.rowOf(id)).catchupMode).toBe('all');

    await s.db.execute(sql.raw('drop trigger fail_run on workflow_instance'));
    expect(await runCatchup(s.db, at('02:01'))).toBe(2);
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'started', 'Clean Equipment': 'started' });
  } finally { await s.close(); }
});

test('the workflows a held chain needs are locked before its run, along with the Runtime', async () => {
  const s = await setupSchedules();
  try {
    await requested(s);
    await s.db.execute(sql.raw('create table lock_seen (name text primary key, locked boolean)'));
    await s.db.execute(sql.raw(`create function see_locks() returns trigger language plpgsql as $$
      begin
        insert into lock_seen select name, xmax::text = txid_current()::text from workflow on conflict do nothing;
        insert into lock_seen select 'the Runtime', xmax::text = txid_current()::text from runtime_schedule on conflict do nothing;
        return new;
      end $$`));
    await s.db.execute(sql.raw('create trigger see_locks before insert on workflow_instance for each row execute function see_locks()'));

    await runCatchup(s.db, at('02:00'));

    const seen = await s.db.execute(sql.raw('select name from lock_seen where locked'));
    expect(seen.rows.map((r: { name: string }) => r.name).sort()).toEqual(['Move Material', 'the Runtime']);
    expect(await s.rawDb.select().from(scheduleItemRun).where(eq(scheduleItemRun.status, 'start_requested'))).toHaveLength(0);
  } finally { await s.close(); }
});
