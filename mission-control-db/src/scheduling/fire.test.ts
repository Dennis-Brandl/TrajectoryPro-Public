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
import { makeTestDb } from '../../test/helpers/db.js';
import {
  workCenter, workflow, workflowInstance, runtimeSchedule, runtimeScheduleItem,
  runtimeScheduleEvent, scheduleOccurrence, scheduleItemRun, systemSettings,
} from '../db/schema/index.js';
import { getScheduleLateToleranceMinutes, setScheduleLateToleranceMinutes } from '../dao/system-settings.js';
import { createMasterSchedule } from './master-dao.js';
import { enableMasterSchedule } from './enable.js';
import { advancePastRecordedSlot, fireDueSlots, fireOneSlot, lockItemWorkflows } from './fire.js';
import { runScheduleTick } from './tick.js';

const ENABLED_AT = new Date('2026-11-08T12:00:00Z');
const at = (hhmm: string, day = '09') => new Date(`2026-11-${day}T${hhmm}:00Z`);
const plusSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const plusMinutes = (d: Date, m: number) => plusSeconds(d, m * 60);

// Slot numbers count from the range start: 2026-11-09 08:00 is the 9th daily slot.
const DAILY = { type: 'daily', every: 1, times: ['08:00'], range: { startDate: '2026-11-01', noEnd: true } };
const HOURLY = { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T08:00' };
const ONCE = { type: 'once', at: '2026-11-09T08:00' };
const actor = { kind: 'system' } as const;

const specOf = (name: string) => ({
  oid: `wf-${name}`, local_id: name,
  starting_parameter_specifications: [
    { id: 'BatchId', value_type: 'literal', default_value: '' },
    { id: 'Day', value_type: 'literal', default_value: '' },
    { id: 'Num', value_type: 'literal', default_value: '' },
  ],
  output_parameter_specifications: [],
  steps: [{ local_id: 'Only', oid: `s-${name}`, step_type: 'START' }],
  connections: [],
});

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1', timeZone: 'UTC' }).returning();
  for (const name of ['A', 'B', 'C']) {
    await t.db.insert(workflow).values({
      oid: `wf-${name}`, name, workCenterId: wc!.id, version: '1.0.0', state: 'Effective', specJsonb: specOf(name),
    });
  }
  let n = 0;
  const enable = async (recurrence: unknown = DAILY, items?: unknown[]) => {
    const m = await createMasterSchedule(t.db as any, wc!.id, {
      name: `Sched ${++n}`, recurrence,
      items: items ?? [{ workflow: { name: 'A' } }, { workflow: { name: 'B' } }, { workflow: { name: 'C' } }],
    }, actor);
    const { runtime } = await enableMasterSchedule(t.db as any, m.id, actor, ENABLED_AT);
    return runtime.id;
  };
  const rowOf = async (id: string) =>
    (await t.db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id)))[0]!;
  const itemsOf = (id: string) => t.db.select().from(runtimeScheduleItem)
    .where(eq(runtimeScheduleItem.runtimeScheduleId, id)).orderBy(asc(runtimeScheduleItem.position));
  const occurrences = (id: string) => t.db.select().from(scheduleOccurrence)
    .where(eq(scheduleOccurrence.runtimeScheduleId, id)).orderBy(asc(scheduleOccurrence.scheduledAt));
  const instances = () => t.db.select().from(workflowInstance).orderBy(asc(workflowInstance.queuedAt));
  /** Item runs of one occurrence, in the order of the start list. */
  const runsOf = async (occurrenceId: string, id: string) => {
    const items = await itemsOf(id);
    const runs = await t.db.select().from(scheduleItemRun).where(eq(scheduleItemRun.occurrenceId, occurrenceId));
    return items.flatMap((i) => runs.filter((r) => r.itemId === i.id));
  };
  const events = (id: string) => t.db.select().from(runtimeScheduleEvent)
    .where(eq(runtimeScheduleEvent.runtimeScheduleId, id));
  return { ...t, wc: wc!, enable, rowOf, itemsOf, occurrences, instances, runsOf, events };
}

afterEach(() => vi.restoreAllMocks());

test('a due slot creates one occurrence and runs in list order, advances next_fire_at, and fires only once', async () => {
  const { db, close, enable, rowOf, occurrences, instances, runsOf, events } = await setup();
  try {
    const id = await enable();
    const now = plusSeconds(at('08:00'), 3);

    expect(await fireDueSlots(db as any, now)).toBe(1);

    const occ = await occurrences(id);
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ number: 9, scheduledAt: at('08:00'), origin: 'on_time' });
    expect(occ[0]!.firedAt).not.toBeNull();

    const live = await instances();
    expect(live.map((i) => i.masterName)).toEqual(['A', 'B', 'C']);
    for (const i of live) {
      expect(i).toMatchObject({
        status: 'queued', triggeredBy: 'schedule', createdBy: null, scheduleLabel: 'RS-1 / occurrence 9',
      });
    }
    const runs = await runsOf(occ[0]!.id, id);
    expect(runs.map((r) => r.status)).toEqual(['started', 'started', 'started']);
    for (const [k, r] of runs.entries()) {
      expect(r.workflowInstanceId).toBe(live[k]!.id);
      expect(r.runtimeLabel).toBe(live[k]!.runtimeLabel);
      expect(live[k]!.scheduleItemRunId).toBe(r.id);
    }

    expect((await rowOf(id)).nextFireAt).toEqual(at('08:00', '10'));
    const audit = (await events(id)).filter((e) => e.action === 'slot_fired');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorKind: 'system',
      detail: { number: 9, scheduledAt: at('08:00').toISOString(), origin: 'on_time', started: 3, failed: 0, skipped: 0 },
    });

    expect(await fireDueSlots(db as any, plusSeconds(now, 5))).toBe(0);
    expect(await occurrences(id)).toHaveLength(1);
    expect(await instances()).toHaveLength(3);
  } finally { await close(); }
});

test('a slot not yet due fires nothing', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const id = await enable();
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), -1))).toBe(0);
    expect(await occurrences(id)).toHaveLength(0);
    expect((await rowOf(id)).nextFireAt).toEqual(at('08:00'));
  } finally { await close(); }
});

test.each(['paused', 'cancelled'])('a %s Runtime fires nothing and next_fire_at stays put', async (status) => {
  const { db, close, enable, rowOf, occurrences, instances } = await setup();
  try {
    const id = await enable();
    await db.update(runtimeSchedule).set({ status }).where(eq(runtimeSchedule.id, id));
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 3))).toBe(0);
    expect(await occurrences(id)).toHaveLength(0);
    expect(await instances()).toHaveLength(0);
    expect((await rowOf(id)).nextFireAt).toEqual(at('08:00'));
  } finally { await close(); }
});

test('an active Runtime with no next_fire_at fires nothing and is not finished here', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const id = await enable(ONCE);
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 3))).toBe(1);
    const after = await rowOf(id);
    expect(after.nextFireAt).toBeNull();
    expect(after.status).toBe('active');

    expect(await fireDueSlots(db as any, plusMinutes(at('08:00'), 60))).toBe(0);
    expect(await occurrences(id)).toHaveLength(1);
    expect((await rowOf(id)).status).toBe('active');
  } finally { await close(); }
});

test('a disabled start-list item records skipped_disabled and starts no run', async () => {
  const { db, close, enable, itemsOf, occurrences, instances, runsOf, events } = await setup();
  try {
    const id = await enable();
    const items = await itemsOf(id);
    await db.update(runtimeScheduleItem).set({ disabled: true }).where(eq(runtimeScheduleItem.id, items[1]!.id));

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);

    const [occ] = await occurrences(id);
    const runs = await runsOf(occ!.id, id);
    expect(runs.map((r) => r.status)).toEqual(['started', 'skipped_disabled', 'started']);
    expect(runs[1]!.workflowInstanceId).toBeNull();
    expect((await instances()).map((i) => i.masterName)).toEqual(['A', 'C']);
    expect((await events(id)).find((e) => e.action === 'slot_fired')!.detail).toMatchObject({ started: 2, skipped: 1, failed: 0 });
  } finally { await close(); }
});

test('an item failing validation records failed_to_start with the reason; the others still start', async () => {
  const { db, close, enable, itemsOf, occurrences, instances, runsOf, events } = await setup();
  try {
    const id = await enable();
    const items = await itemsOf(id);
    await db.update(runtimeScheduleItem).set({ params: { Nope: { value: 'x' } } }).where(eq(runtimeScheduleItem.id, items[1]!.id));

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);

    const [occ] = await occurrences(id);
    const runs = await runsOf(occ!.id, id);
    expect(runs.map((r) => r.status)).toEqual(['started', 'failed_to_start', 'started']);
    expect(runs[1]!.detail).toBe('unknown parameter: Nope');
    expect(runs[1]!.workflowInstanceId).toBeNull();
    // The savepoint rolled back: no orphan run, and no row points at the failed item run.
    const live = await instances();
    expect(live.map((i) => i.masterName)).toEqual(['A', 'C']);
    expect(live.some((i) => i.scheduleItemRunId === runs[1]!.id)).toBe(false);
    expect((await events(id)).find((e) => e.action === 'slot_fired')!.detail).toMatchObject({ started: 2, failed: 1 });
  } finally { await close(); }
});

test('a value that cannot be resolved records failed_to_start with the reason', async () => {
  const { db, close, enable, itemsOf, occurrences, instances, runsOf } = await setup();
  try {
    const id = await enable();
    const items = await itemsOf(id);
    await db.update(runtimeScheduleItem)
      .set({ params: { BatchId: { from: 'trigger.output', name: 'Yield' } } })
      .where(eq(runtimeScheduleItem.id, items[0]!.id));

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);

    const [occ] = await occurrences(id);
    const runs = await runsOf(occ!.id, id);
    expect(runs.map((r) => r.status)).toEqual(['failed_to_start', 'started', 'started']);
    expect(runs[0]!.detail).toBe('Yield has no value from the triggering run');
    expect((await instances()).map((i) => i.masterName)).toEqual(['B', 'C']);
  } finally { await close(); }
});

test('an item with no workflow row records failed_to_start; the others still start', async () => {
  const { db, close, enable, itemsOf, occurrences, runsOf } = await setup();
  try {
    const id = await enable();
    const items = await itemsOf(id);
    await db.update(runtimeScheduleItem).set({ workflowId: null }).where(eq(runtimeScheduleItem.id, items[2]!.id));

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);

    const [occ] = await occurrences(id);
    const runs = await runsOf(occ!.id, id);
    expect(runs.map((r) => r.status)).toEqual(['started', 'started', 'failed_to_start']);
    expect(runs[2]!.detail).toBe('This schedule item has no workflow');
  } finally { await close(); }
});

test('the start list is not held back by earlier runs still going', async () => {
  const { db, close, enable, instances } = await setup();
  try {
    await enable();
    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);
    // All three are live together: no item waits for the one before it to end.
    const live = await instances();
    expect(live.map((i) => i.status)).toEqual(['queued', 'queued', 'queued']);
    // Read queued_at as text: a JS Date keeps only milliseconds.
    const stamps = await db.select({ q: sql<string>`${workflowInstance.queuedAt}::text` }).from(workflowInstance)
      .orderBy(asc(workflowInstance.queuedAt));
    expect(new Set(stamps.map((s) => s.q)).size).toBe(3);
  } finally { await close(); }
});

test('the 09:00 slot fires while the 08:00 run is running', async () => {
  const { db, close, enable, occurrences, instances } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);
    await db.update(workflowInstance).set({ status: 'running' });

    expect(await fireDueSlots(db as any, at('09:00'))).toBe(1);

    expect((await occurrences(id)).map((o) => o.number)).toEqual([1, 2]);
    expect((await instances()).map((i) => i.status).sort()).toEqual(['queued', 'running']);
  } finally { await close(); }
});

test('late within tolerance fires with origin late; a normal tick delay stays on_time', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 60))).toBe(1);
    expect(await fireDueSlots(db as any, plusMinutes(at('09:00'), 10))).toBe(1);
    expect(await fireDueSlots(db as any, plusMinutes(at('10:00'), 15))).toBe(1);
    expect((await occurrences(id)).map((o) => [o.number, o.origin])).toEqual([[1, 'on_time'], [2, 'late'], [3, 'late']]);
    const after = await rowOf(id);
    expect(after.missedFrom).toBeNull();
    expect(after.missedTo).toBeNull();
  } finally { await close(); }
});

test('late beyond tolerance: no occurrence, window set, next_fire_at past now, and the next due slot still fires', async () => {
  const { db, close, enable, rowOf, occurrences, instances, events } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    const now = plusMinutes(at('08:00'), 20);

    expect(await fireDueSlots(db as any, now)).toBe(0);

    expect(await occurrences(id)).toHaveLength(0);
    expect(await instances()).toHaveLength(0);
    const after = await rowOf(id);
    expect(after.missedFrom).toEqual(at('08:00'));
    expect(after.missedTo).toEqual(now);
    expect(after.nextFireAt).toEqual(at('09:00'));
    expect(after.status).toBe('active');
    const audit = (await events(id)).find((e) => e.action === 'slots_missed');
    expect(audit).toMatchObject({ actorKind: 'system', detail: { from: at('08:00').toISOString(), to: now.toISOString() } });

    expect(await fireDueSlots(db as any, at('09:00'))).toBe(1);
    const occ = await occurrences(id);
    expect(occ.map((o) => [o.number, o.origin])).toEqual([[2, 'on_time']]);
    const fired = await rowOf(id);
    expect(fired.missedFrom).toEqual(at('08:00'));
    expect(fired.missedTo).toEqual(now);
    expect(fired.nextFireAt).toEqual(at('10:00'));
  } finally { await close(); }
});

test('the window takes every slot up to now', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    // 08:00 is too late. 09:00 and 10:00 are in the window too, though 10:00 is only 5 minutes old.
    const now = plusMinutes(at('10:00'), 5);
    expect(await fireDueSlots(db as any, now)).toBe(0);
    expect(await occurrences(id)).toHaveLength(0);
    const after = await rowOf(id);
    expect(after.missedFrom).toEqual(at('08:00'));
    expect(after.missedTo).toEqual(now);
    expect(after.nextFireAt).toEqual(at('11:00'));
  } finally { await close(); }
});

test('one second past tolerance misses the last slot: next_fire_at null, the window waiting for a decision', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const id = await enable(ONCE);
    expect(await fireDueSlots(db as any, plusSeconds(plusMinutes(at('08:00'), 15), 1))).toBe(0);
    expect(await occurrences(id)).toHaveLength(0);
    const after = await rowOf(id);
    expect(after.nextFireAt).toBeNull();
    expect(after.missedFrom).toEqual(at('08:00'));
    expect(after.status).toBe('active');
  } finally { await close(); }
});

test('a second outage before a decision extends missed_to and keeps missed_from', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    await fireDueSlots(db as any, plusMinutes(at('08:00'), 20));
    expect(await fireDueSlots(db as any, at('09:00'))).toBe(1);

    const second = plusMinutes(at('12:00'), 30);
    expect(await fireDueSlots(db as any, second)).toBe(0);

    const after = await rowOf(id);
    expect(after.missedFrom).toEqual(at('08:00'));
    expect(after.missedTo).toEqual(second);
    expect(after.nextFireAt).toEqual(at('13:00'));
    // The slot that fired in between keeps its occurrence, so it is not counted as undecided.
    expect((await occurrences(id)).map((o) => o.number)).toEqual([2]);
  } finally { await close(); }
});

test('the tolerance comes from the system setting', async () => {
  const { db, close, enable, occurrences } = await setup();
  try {
    await setScheduleLateToleranceMinutes(db as any, 30);
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    expect(await fireDueSlots(db as any, plusMinutes(at('08:00'), 20))).toBe(1);
    expect((await occurrences(id)).map((o) => o.origin)).toEqual(['late']);
  } finally { await close(); }
});

test('occurrence values reach starting_params', async () => {
  const { db, close, enable, instances } = await setup();
  try {
    await enable(DAILY, [{
      workflow: { name: 'A' },
      params: {
        Num: { from: 'occurrence.number' },
        Day: { from: 'occurrence.date' },
        BatchId: { template: 'B-{occurrence.date}-{occurrence.number}' },
      },
    }]);
    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);
    const [run] = await instances();
    expect(run!.startingParams).toEqual({ Num: '9', Day: '2026-11-09', BatchId: 'B-2026-11-09-9' });
  } finally { await close(); }
});

test('a slot already recorded does not leave next_fire_at stuck', async () => {
  const { db, close, enable, rowOf, occurrences, instances, events } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    await db.insert(scheduleOccurrence).values({ runtimeScheduleId: id, number: 1, scheduledAt: at('08:00'), origin: 'on_time' });

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(0);

    expect(await occurrences(id)).toHaveLength(1);
    expect(await instances()).toHaveLength(0);
    expect((await rowOf(id)).nextFireAt).toEqual(at('09:00'));
    expect((await events(id)).map((e) => e.action)).toContain('slot_already_recorded');

    expect(await fireDueSlots(db as any, at('09:00'))).toBe(1);
    expect((await occurrences(id)).map((o) => o.number)).toEqual([1, 2]);
  } finally { await close(); }
});

test('an exception outside the items rolls back the whole slot, which stays due and fires on a later tick', async () => {
  const { db, close, enable, rowOf, occurrences, instances } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    await db.execute(sql.raw(`create function fail_slot_fired() returns trigger language plpgsql as $$
      begin if new.action = 'slot_fired' then raise exception 'audit is down'; end if; return new; end $$`));
    await db.execute(sql.raw(`create trigger fail_slot_fired before insert on runtime_schedule_event
      for each row execute function fail_slot_fired()`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(0);

    // The audit is the slot's last write: everything before it was undone.
    expect(await occurrences(id)).toHaveLength(0);
    expect(await instances()).toHaveLength(0);
    expect(await db.select().from(scheduleItemRun)).toHaveLength(0);
    expect((await rowOf(id)).nextFireAt).toEqual(at('08:00'));
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain(id);
    expect(String(log.mock.calls[0]![0])).toContain('audit is down');

    await db.execute(sql.raw('drop trigger fail_slot_fired on runtime_schedule_event'));
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 5))).toBe(1);
    expect(await occurrences(id)).toHaveLength(1);
    expect(await instances()).toHaveLength(1);
    expect((await rowOf(id)).nextFireAt).toEqual(at('09:00'));
  } finally { await close(); }
});

test('a bad Runtime does not stop the others, and is logged once per message', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const bad = await enable();
    const good = await enable();
    // Moved a second earlier, so the bad one is always reached first.
    await db.update(runtimeSchedule).set({ timeZone: 'Not/AZone', nextFireAt: plusSeconds(at('08:00'), -1) })
      .where(eq(runtimeSchedule.id, bad));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);
    expect(await occurrences(good)).toHaveLength(1);
    expect(await occurrences(bad)).toHaveLength(0);
    expect((await rowOf(bad)).nextFireAt).toEqual(plusSeconds(at('08:00'), -1));
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain(bad);
    expect(String(log.mock.calls[0]![0])).toContain('Not/AZone');

    // Still bad on the next tick: still tried, not logged again.
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 5))).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);

    // A different message for the same id is logged.
    await db.update(runtimeSchedule).set({ timeZone: 'Also/Bad' }).where(eq(runtimeSchedule.id, bad));
    await fireDueSlots(db as any, plusSeconds(at('08:00'), 10));
    expect(log).toHaveBeenCalledTimes(2);
  } finally { await close(); }
});

test('at most 20 rows fire in one call; the rest fire on the next', async () => {
  const { db, close, enable } = await setup();
  try {
    for (let i = 0; i < 21; i++) await enable(DAILY, [{ workflow: { name: 'A' } }]);
    expect(await fireDueSlots(db as any, at('08:00'))).toBe(20);
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 5))).toBe(1);
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 10))).toBe(0);
  } finally { await close(); }
});

test('Runtimes that throw do not use up the 20 rows', async () => {
  const { db, close, enable, occurrences } = await setup();
  try {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad: string[] = [];
    for (let i = 0; i < 20; i++) bad.push(await enable(DAILY, [{ workflow: { name: 'A' } }]));
    const good = await enable(DAILY, [{ workflow: { name: 'A' } }]);
    for (const id of bad) {
      await db.update(runtimeSchedule).set({ timeZone: 'Not/AZone', nextFireAt: plusSeconds(at('08:00'), -1) })
        .where(eq(runtimeSchedule.id, id));
    }
    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);
    expect(await occurrences(good)).toHaveLength(1);
  } finally { await close(); }
});

test('one call fires one slot per Runtime; the next tick takes the next slot', async () => {
  const { db, close, enable, occurrences } = await setup();
  try {
    const id = await enable({ type: 'interval', every: 1, unit: 'minutes', startAt: '2026-11-09T08:00' }, [{ workflow: { name: 'A' } }]);
    const now = plusMinutes(at('08:00'), 2);
    expect(await fireDueSlots(db as any, now)).toBe(1);
    expect((await occurrences(id)).map((o) => o.number)).toEqual([1]);
    expect(await fireDueSlots(db as any, now)).toBe(1);
    expect((await occurrences(id)).map((o) => o.number)).toEqual([1, 2]);
  } finally { await close(); }
});

test('next_fire_at off the pattern moves to the next slot without firing', async () => {
  const { db, close, enable, rowOf, occurrences } = await setup();
  try {
    const id = await enable();
    await db.update(runtimeSchedule).set({ nextFireAt: at('08:30') }).where(eq(runtimeSchedule.id, id));
    expect(await fireDueSlots(db as any, at('08:31'))).toBe(0);
    expect(await occurrences(id)).toHaveLength(0);
    expect((await rowOf(id)).nextFireAt).toEqual(at('08:00', '10'));
  } finally { await close(); }
});

test('fireOneSlot records the given origin and leaves next_fire_at to the caller', async () => {
  const { db, close, enable, rowOf, occurrences, runsOf } = await setup();
  try {
    const id = await enable();
    const row = await rowOf(id);
    await db.transaction(async (tx) => {
      await fireOneSlot(tx as any, row, { at: at('08:00', '08'), number: 8 }, 'resume');
    });
    const occ = await occurrences(id);
    expect(occ.map((o) => [o.number, o.origin])).toEqual([[8, 'resume']]);
    expect((await runsOf(occ[0]!.id, id)).map((r) => r.status)).toEqual(['started', 'started', 'started']);
    expect((await rowOf(id)).nextFireAt).toEqual(row.nextFireAt);
  } finally { await close(); }
});

test('runScheduleTick reports the slots fired', async () => {
  const { db, close, enable } = await setup();
  try {
    await enable();
    expect(await runScheduleTick(db as any, at('08:00'))).toEqual({ chains: 0, catchup: 0, fired: 1, lost: 0, finished: 0, recorded: 0 });
    expect(await runScheduleTick(db as any, plusSeconds(at('08:00'), 5))).toEqual({ chains: 0, catchup: 0, fired: 0, lost: 0, finished: 0, recorded: 0 });
  } finally { await close(); }
});

test('the tolerance setting defaults to 15, ignores unusable stored values, and refuses bad input', async () => {
  const { db, close } = await setup();
  try {
    expect(await getScheduleLateToleranceMinutes(db as any)).toBe(15);
    await setScheduleLateToleranceMinutes(db as any, 40);
    expect(await getScheduleLateToleranceMinutes(db as any)).toBe(40);
    for (const value of ['0', '-5', '1.5', 'soon', '']) {
      await db.update(systemSettings).set({ value }).where(eq(systemSettings.key, 'schedule_late_tolerance_minutes'));
      expect(await getScheduleLateToleranceMinutes(db as any)).toBe(15);
    }
    await expect(setScheduleLateToleranceMinutes(db as any, 0)).rejects.toThrow('whole number');
    await expect(setScheduleLateToleranceMinutes(db as any, 1.5)).rejects.toThrow('whole number');
  } finally { await close(); }
});

test('fireOneSlot locks the workflows of every item about to start before the first run, and no others', async () => {
  const { db, close, enable, itemsOf, instances } = await setup();
  try {
    const id = await enable();
    const items = await itemsOf(id);
    await db.update(runtimeScheduleItem).set({ disabled: true }).where(eq(runtimeScheduleItem.id, items[1]!.id));
    // Snapshot, as the first run is inserted, of which workflow rows this transaction has locked.
    await db.execute(sql.raw('create table lock_seen (name text primary key, locked boolean)'));
    await db.execute(sql.raw(`create function see_locks() returns trigger language plpgsql as $$
      begin
        insert into lock_seen select name, xmax::text = txid_current()::text from workflow on conflict do nothing;
        return new;
      end $$`));
    await db.execute(sql.raw(`create trigger see_locks before insert on workflow_instance
      for each row execute function see_locks()`));

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);

    expect((await instances()).map((i) => i.masterName)).toEqual(['A', 'C']);
    const seen = await db.execute(sql.raw('select name, locked from lock_seen order by name'));
    expect(seen.rows).toEqual([
      { name: 'A', locked: true }, { name: 'B', locked: false }, { name: 'C', locked: true },
    ]);
  } finally { await close(); }
});

test('lockItemWorkflows takes share locks on the named rows, and does nothing for an empty list', async () => {
  const { db, close, wc } = await setup();
  try {
    const rows = await db.select().from(workflow).where(eq(workflow.workCenterId, wc.id));
    const lockedNames = async (tx: any) => (await tx.execute(sql.raw(
      `select name from workflow where xmax::text = txid_current()::text order by name`,
    ))).rows.map((r: any) => r.name);
    await db.transaction(async (tx) => {
      await lockItemWorkflows(tx as any, []);
      expect(await lockedNames(tx)).toEqual([]);
      const a = rows.find((r) => r.name === 'A')!.id;
      const c = rows.find((r) => r.name === 'C')!.id;
      await lockItemWorkflows(tx as any, [c, a, c]);
      expect(await lockedNames(tx)).toEqual(['A', 'C']);
    });
  } finally { await close(); }
});

const raiseOnRun = async (db: any, code: string) => {
  await db.execute(sql.raw(`create function fail_run() returns trigger language plpgsql as $$
    begin raise exception 'raised on purpose' using errcode = '${code}'; end $$`));
  await db.execute(sql.raw(`create trigger fail_run before insert on workflow_instance
    for each row execute function fail_run()`));
};

test.each(['40P01', '40001', '55P03'])('a transient %s from an item rolls back the whole slot, which fires once it clears', async (code) => {
  const { db, close, enable, rowOf, occurrences, instances } = await setup();
  try {
    const id = await enable();
    await raiseOnRun(db, code);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(0);

    expect(await occurrences(id)).toHaveLength(0);
    expect(await db.select().from(scheduleItemRun)).toHaveLength(0);
    expect((await rowOf(id)).nextFireAt).toEqual(at('08:00'));
    expect(log).toHaveBeenCalledTimes(1);

    await db.execute(sql.raw('drop trigger fail_run on workflow_instance'));
    expect(await fireDueSlots(db as any, plusSeconds(at('08:00'), 5))).toBe(1);
    expect(await occurrences(id)).toHaveLength(1);
    expect(await instances()).toHaveLength(3);
  } finally { await close(); }
});

test('any other database error from an item stays that item\'s failed_to_start', async () => {
  const { db, close, enable, occurrences, runsOf } = await setup();
  try {
    const id = await enable();
    await raiseOnRun(db, 'P0001');

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(1);

    const [occ] = await occurrences(id);
    const runs = await runsOf(occ!.id, id);
    expect(runs.map((r) => r.status)).toEqual(['failed_to_start', 'failed_to_start', 'failed_to_start']);
    expect(runs[0]!.detail).toBe('raised on purpose');
  } finally { await close(); }
});

test('moving next_fire_at back onto the pattern is audited with the old and new values', async () => {
  const { db, close, enable, events } = await setup();
  try {
    const id = await enable();
    await db.update(runtimeSchedule).set({ nextFireAt: at('08:30') }).where(eq(runtimeSchedule.id, id));
    await fireDueSlots(db as any, at('08:31'));
    const audit = (await events(id)).filter((e) => e.action === 'next_fire_realigned');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorKind: 'system', detail: { from: at('08:30').toISOString(), to: at('08:00', '10').toISOString() },
    });
  } finally { await close(); }
});

test('next_fire_at past the last slot becomes null, audited', async () => {
  const { db, close, enable, rowOf, events, occurrences } = await setup();
  try {
    const id = await enable(ONCE);
    await db.update(runtimeSchedule).set({ nextFireAt: at('08:30') }).where(eq(runtimeSchedule.id, id));
    expect(await fireDueSlots(db as any, at('08:31'))).toBe(0);
    expect((await rowOf(id)).nextFireAt).toBeNull();
    expect(await occurrences(id)).toHaveLength(0);
    expect((await events(id)).find((e) => e.action === 'next_fire_realigned')!.detail)
      .toEqual({ from: at('08:30').toISOString(), to: null });
  } finally { await close(); }
});

test('one call makes at most 100 attempts, however many rows are broken', async () => {
  const { db, close } = await setup();
  try {
    const broken = Array.from({ length: 105 }, (_, i) => ({
      workCenterName: 'Line 1', runtimeNumber: i + 1, label: `RS-${i + 1}`, name: `Broken ${i + 1}`,
      recurrence: DAILY, timeZone: 'Not/AZone', masterRevision: 1, definitionHash: 'h', status: 'active', nextFireAt: at('08:00'),
    }));
    await db.insert(runtimeSchedule).values(broken);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await fireDueSlots(db as any, at('08:00'))).toBe(0);

    // Every id is distinct, so each attempt logs exactly one line.
    expect(log).toHaveBeenCalledTimes(100);
  } finally { await close(); }
});

test.each(['paused', 'moved on'])('advancing past a recorded slot changes nothing when the row was %s', async (how) => {
  const { db, close, enable, rowOf, events } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'A' } }]);
    const seen = await rowOf(id);
    const change = how === 'paused' ? { status: 'paused' } : { nextFireAt: at('11:00') };
    await db.update(runtimeSchedule).set(change).where(eq(runtimeSchedule.id, id));
    const before = await rowOf(id);

    await advancePastRecordedSlot(db as any, seen, { at: at('08:00'), number: 1 });

    expect(await rowOf(id)).toEqual(before);
    expect((await events(id)).map((e) => e.action)).not.toContain('slot_already_recorded');
  } finally { await close(); }
});
