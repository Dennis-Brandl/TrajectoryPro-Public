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

import { describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { appUser, masterSchedule, runtimeSchedule, scheduleOccurrence, workCenter, workflow } from '../db/schema/index.js';
import type { DaoError } from '../dao/errors.js';
import { setRuntimeIdTimezone } from '../dao/system-settings.js';
import { enableMasterSchedule, previewEnable, previewRunOnce, runMasterScheduleOnce } from './enable.js';
import type { ScheduleActor } from './events.js';
import { fireDueSlots } from './fire.js';
import { createMasterSchedule } from './master-dao.js';
import { describeRecurrence, nextOccurrence, parseRecurrence, previousOccurrence } from './recurrence.js';
import { cancelRuntimeSchedule, pauseRuntimeSchedule, removeRuntimeSchedule } from './controls.js';
import { getRuntimeSchedule, listRuntimeSchedules, scheduleClock, listRuntimeScheduleEvents } from './runtime-dao.js';

const NOW = new Date('2026-11-09T14:46:00Z'); // 08:46 in America/Chicago
const MANUAL = { type: 'manual' };
const DAILY = { type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-11-01', noEnd: true } };
const SPEC = { starting_parameter_specifications: [{ id: 'Zone', value_type: 'literal', default_value: 'A' }] };

async function setup(timeZone: string | null = 'America/Chicago') {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Plant', timeZone }).returning();
  const [u] = await t.db.insert(appUser).values({ email: 'una@example.com', displayName: 'Una', loginName: 'una' }).returning();
  const actor: ScheduleActor = { kind: 'user', userId: u!.id, name: 'Una' };
  await t.db.insert(workflow).values({ oid: 'o-1', name: 'Evacuate', workCenterId: wc!.id, version: '1.0.0', state: 'Effective', specJsonb: SPEC });
  const master = (recurrence: unknown = MANUAL, name = 'Fire alarm') =>
    createMasterSchedule(t.db, wc!.id, { name, recurrence, items: [{ workflow: { name: 'Evacuate' } }] }, actor);
  return { ...t, wc: wc!, actor, master };
}
const errOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DaoError; } return undefined; };

describe('the manual pattern', () => {
  test('parses, with no other fields allowed, and never has a slot', () => {
    expect(parseRecurrence(MANUAL)).toEqual({ ok: true, value: { type: 'manual' } });
    expect(parseRecurrence({ type: 'manual', at: '2026-11-10T06:00' }).ok).toBe(false);
    expect(nextOccurrence({ type: 'manual' }, 'UTC', NOW)).toBeNull();
    expect(previousOccurrence({ type: 'manual' }, 'UTC', NOW)).toBeNull();
    expect(describeRecurrence({ type: 'manual' })).toBe('Manual, starts only with Run Once');
  });

  test('a client cannot send the internal runOnce pattern', () => {
    expect(parseRecurrence({ type: 'runOnce', at: NOW.toISOString() }).ok).toBe(false);
  });

  test('a manual Master saves, and Enable Recurrence is refused with a plain reason', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      expect(m.recurrenceText).toBe('Manual, starts only with Run Once');
      const preview = await previewEnable(db, m.id, NOW);
      expect(preview.problems.map((p) => p.code)).toEqual(['MANUAL_ONLY']);
      const err = await errOf(enableMasterSchedule(db, m.id, actor, NOW));
      expect(err?.code).toBe('ENABLE_INVALID');
    } finally { await close(); }
  });
});

describe('Run Once', () => {
  test('now: the next tick starts it once, then it finishes with nothing left to fire', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const { runtime } = await runMasterScheduleOnce(db, m.id, actor, NOW);
      expect(runtime.status).toBe('active');
      expect(runtime.runOnce).toBe(true);
      expect((await getRuntimeSchedule(db, runtime.id))!.recurrenceText).toBe('Run Once');
      const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, runtime.id));
      expect(row!.nextFireAt).toEqual(NOW);
      expect(row!.runOnce).toBe(true);

      expect(await fireDueSlots(db, new Date(NOW.getTime() + 5000))).toBe(1);
      const occurrences = await db.select().from(scheduleOccurrence).where(eq(scheduleOccurrence.runtimeScheduleId, runtime.id));
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0]!.origin).toBe('on_time');
      const [after] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, runtime.id));
      expect(after!.nextFireAt).toBeNull();
      expect(await fireDueSlots(db, new Date(NOW.getTime() + 10000))).toBe(0);
    } finally { await close(); }
  });

  test('at a chosen time: read in the work center zone, and not started before then', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const { runtime } = await runMasterScheduleOnce(db, m.id, actor, NOW, '2026-11-09T09:50');
      const due = new Date('2026-11-09T15:50:00Z'); // 09:50 in Chicago
      const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, runtime.id));
      expect(row!.nextFireAt).toEqual(due);
      expect(await fireDueSlots(db, new Date(due.getTime() - 1000))).toBe(0);
      expect(await fireDueSlots(db, due)).toBe(1);
    } finally { await close(); }
  });

  test('a chosen time already past says which clock it was read on', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const err = await errOf(runMasterScheduleOnce(db, m.id, actor, NOW, '2026-11-09T08:30'));
      expect(err?.code).toBe('ENABLE_INVALID');
      const problems = err?.details as { path: string; code: string; message: string }[];
      expect(problems[0]!.code).toBe('RUN_ONCE_TIME_PASSED');
      expect(problems[0]!.path).toBe('at');
      expect(problems[0]!.message).toContain('America/Chicago');
      expect(await db.select().from(runtimeSchedule)).toHaveLength(0);
    } finally { await close(); }
  });

  test('runs overlap: two alarms make two Runtimes with their own labels', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const a = await runMasterScheduleOnce(db, m.id, actor, NOW);
      const b = await runMasterScheduleOnce(db, m.id, actor, NOW);
      expect([a.runtime.label, b.runtime.label]).toEqual(['RS-1', 'RS-2']);
      expect(await fireDueSlots(db, new Date(NOW.getTime() + 5000))).toBe(2);
    } finally { await close(); }
  });

  test('works beside an enabled recurrence, in both orders, and Enable still allows only one', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master(DAILY, 'Daily');
      const first = await runMasterScheduleOnce(db, m.id, actor, NOW);
      const recurring = await enableMasterSchedule(db, m.id, actor, NOW);
      const third = await runMasterScheduleOnce(db, m.id, actor, NOW);
      expect(new Set([first.runtime.id, recurring.runtime.id, third.runtime.id]).size).toBe(3);
      expect((await errOf(enableMasterSchedule(db, m.id, actor, NOW)))?.code).toBe('RUNTIME_ACTIVE');
    } finally { await close(); }
  });

  test('a Master from a higher-level system keeps its re-send record apart', async () => {
    const { db, close, wc, actor } = await setup();
    try {
      const m = await createMasterSchedule(db, wc.id, {
        name: 'Sent', recurrence: DAILY, items: [{ workflow: { name: 'Evacuate' } }],
      }, actor);
      await db.update(masterSchedule).set({ externalKey: 'erp-1', source: 'api' }).where(eq(masterSchedule.id, m.id));
      const { runtime } = await runMasterScheduleOnce(db, m.id, actor, NOW);
      const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, runtime.id));
      expect(row!.externalKey).toBeNull();
    } finally { await close(); }
  });

  test('a repeated requestId answers with the first run and starts nothing; a new one starts another', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const first = await runMasterScheduleOnce(db, m.id, actor, NOW, undefined, 'alarm-1');
      expect(first.repeated).toBe(false);
      const retry = await runMasterScheduleOnce(db, m.id, actor, NOW, '2020-01-01T00:00', 'alarm-1');
      expect(retry.repeated).toBe(true);
      expect(retry.runtime.id).toBe(first.runtime.id);
      const second = await runMasterScheduleOnce(db, m.id, actor, NOW, undefined, 'alarm-2');
      expect(second.repeated).toBe(false);
      expect(second.runtime.id).not.toBe(first.runtime.id);
      expect(await db.select().from(runtimeSchedule)).toHaveLength(2);
      expect(await fireDueSlots(db, new Date(NOW.getTime() + 5000))).toBe(2);
    } finally { await close(); }
  });

  test('a requestId belongs to one Master, and is still honored after the run has ended', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const a = await master(MANUAL, 'A');
      const b = await master(MANUAL, 'B');
      const onA = await runMasterScheduleOnce(db, a.id, actor, NOW, undefined, 'same');
      const onB = await runMasterScheduleOnce(db, b.id, actor, NOW, undefined, 'same');
      expect(onB.repeated).toBe(false);
      await cancelRuntimeSchedule(db, onA.runtime.id, 'done', actor, NOW);
      const again = await runMasterScheduleOnce(db, a.id, actor, NOW, undefined, 'same');
      expect(again.repeated).toBe(true);
      expect(again.runtime.status).toBe('cancelled');
    } finally { await close(); }
  });

  test('records who started it, and Pause and Cancel work on it', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const { runtime } = await runMasterScheduleOnce(db, m.id, actor, NOW, '2026-11-09T09:50');
      const events = await listRuntimeScheduleEvents(db, runtime.id, { limit: 10, offset: 0 });
      expect(events.rows.map((r) => r.action)).toEqual(['run_once']);
      expect(events.rows[0]!.actorName).toBe('Una');
      await pauseRuntimeSchedule(db, runtime.id, actor, NOW);
      await cancelRuntimeSchedule(db, runtime.id, 'False alarm', actor, NOW);
      expect(await fireDueSlots(db, new Date('2026-11-09T16:00:00Z'))).toBe(0);
    } finally { await close(); }
  });

  test('a workflow it cannot start is refused before anything exists, and the preview says so', async () => {
    const { db, close, wc, actor } = await setup();
    try {
      const m = await createMasterSchedule(db, wc.id, { name: 'Bad', recurrence: MANUAL, items: [{ workflow: { name: 'Nope' } }] }, actor);
      expect((await previewRunOnce(db, m.id, NOW)).problems.map((p) => p.code)).toEqual(['WORKFLOW_NOT_FOUND']);
      expect((await errOf(runMasterScheduleOnce(db, m.id, actor, NOW)))?.code).toBe('ENABLE_INVALID');
      expect(await db.select().from(runtimeSchedule)).toHaveLength(0);
    } finally { await close(); }
  });

  test('a recurring pattern whose times have all passed can still Run Once', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master({ type: 'once', at: '2020-01-01T00:00' }, 'Old');
      expect((await previewRunOnce(db, m.id, NOW)).problems).toEqual([]);
      await runMasterScheduleOnce(db, m.id, actor, NOW);
    } finally { await close(); }
  });
});

describe('Remove from the list', () => {
  const codeOf = async (p: Promise<unknown>) => (await errOf(p))?.code;

  test('an ended one leaves the list and stays readable, with who removed it in the log', async () => {
    const { db, close, master, actor, wc } = await setup();
    try {
      const m = await master();
      const { runtime } = await runMasterScheduleOnce(db, m.id, actor, NOW, '2026-11-09T09:50');
      await cancelRuntimeSchedule(db, runtime.id, 'False alarm', actor, NOW);
      await removeRuntimeSchedule(db, runtime.id, actor, NOW);
      expect(await listRuntimeSchedules(db, wc.id)).toEqual([]);
      expect(await listRuntimeSchedules(db, wc.id, 'cancelled')).toEqual([]);
      expect((await getRuntimeSchedule(db, runtime.id))?.label).toBe('RS-1');
      const events = await listRuntimeScheduleEvents(db, runtime.id, { limit: 10, offset: 0 });
      expect(events.rows[0]).toMatchObject({ action: 'removed', actorName: 'Una' });
    } finally { await close(); }
  });

  test('a live one is refused, active or paused, and stays listed', async () => {
    const { db, close, master, actor, wc } = await setup();
    try {
      const m = await master();
      const { runtime } = await runMasterScheduleOnce(db, m.id, actor, NOW, '2026-11-09T09:50');
      expect(await codeOf(removeRuntimeSchedule(db, runtime.id, actor, NOW))).toBe('RUNTIME_SCHEDULE_STATE');
      await pauseRuntimeSchedule(db, runtime.id, actor, NOW);
      expect(await codeOf(removeRuntimeSchedule(db, runtime.id, actor, NOW))).toBe('RUNTIME_SCHEDULE_STATE');
      expect(await listRuntimeSchedules(db, wc.id)).toHaveLength(1);
    } finally { await close(); }
  });

  test('a second Remove logs nothing, and an unknown id is not found', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const { runtime } = await runMasterScheduleOnce(db, m.id, actor, NOW, '2026-11-09T09:50');
      await cancelRuntimeSchedule(db, runtime.id, 'x', actor, NOW);
      await removeRuntimeSchedule(db, runtime.id, actor, NOW);
      await removeRuntimeSchedule(db, runtime.id, actor, NOW);
      const events = await listRuntimeScheduleEvents(db, runtime.id, { limit: 10, offset: 0 });
      expect(events.rows.filter((r) => r.action === 'removed')).toHaveLength(1);
      expect(await codeOf(removeRuntimeSchedule(db, '00000000-0000-4000-8000-000000000000', actor, NOW))).toBe('RUNTIME_SCHEDULE_NOT_FOUND');
    } finally { await close(); }
  });

  test('the record still does its work: labels are not reused, and a repeated requestId finds the run', async () => {
    const { db, close, master, actor } = await setup();
    try {
      const m = await master();
      const first = await runMasterScheduleOnce(db, m.id, actor, NOW, '2026-11-09T09:50', 'alarm-1');
      await cancelRuntimeSchedule(db, first.runtime.id, 'x', actor, NOW);
      await removeRuntimeSchedule(db, first.runtime.id, actor, NOW);
      const retry = await runMasterScheduleOnce(db, m.id, actor, NOW, undefined, 'alarm-1');
      expect(retry.repeated).toBe(true);
      expect(retry.runtime.id).toBe(first.runtime.id);
      expect((await runMasterScheduleOnce(db, m.id, actor, NOW)).runtime.label).toBe('RS-2');
    } finally { await close(); }
  });
});

describe('the schedule clock', () => {
  test('says when a work center has its own zone, and when it falls back', async () => {
    const set = await setup('America/Chicago');
    const unset = await setup(null);
    try {
      expect(await scheduleClock(set.db, set.wc.id)).toEqual({ timeZone: 'America/Chicago', workCenterZoneSet: true });
      await setRuntimeIdTimezone(unset.db, 'UTC');
      expect(await scheduleClock(unset.db, unset.wc.id)).toEqual({ timeZone: 'UTC', workCenterZoneSet: false });
    } finally { await set.close(); await unset.close(); }
  });

  test('a past time names the zone and its current time in the refusal', async () => {
    const { db, close, master } = await setup(null);
    try {
      await setRuntimeIdTimezone(db, 'UTC');
      const m = await master({ type: 'once', at: '2026-11-09T09:50' }, 'Lunch Precook');
      const preview = await previewEnable(db, m.id, NOW);
      const message = preview.problems.find((p) => p.code === 'NO_FUTURE_START')?.message;
      expect(message).toContain('UTC');
      expect(message).toContain('14:46');
    } finally { await close(); }
  });
});
