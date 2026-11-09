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
import {
  appUser, scheduleItemRun, scheduleOccurrence, workflowInstance,
} from '../db/schema/index.js';
import { runtimeControlEvent } from '../db/schema/execution.js';
import {
  BLEND_ONLY, HOURLY, at, person, setupSchedules, type Schedules,
} from '../../test/helpers/schedule-fixture.js';
import { loadRuntimeScheduleView } from './runtime-dao.js';
import { runCatchup } from './catchup.js';
import { fireDueSlots } from './fire.js';
import {
  acknowledgeRuntimeItems, cancelRuntimeSchedule, getResumePreview, pauseRuntimeSchedule,
  removeRuntimeSchedule, resumeRuntimeSchedule, setRuntimeItemDisabled,
} from './controls.js';

const iso = (hhmm: string, day = '09') => at(hhmm, day).toISOString();
const code = (e: unknown) => (e as { code?: string }).code;
const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000';

/** Blend Batch fired at 01:00, Pause, then it ended: its two chains are held, and 02:00 and 03:00 are missed. */
async function pausedWithHeld(s: Schedules) {
  const id = await s.enable();
  await s.tick(at('01:00'));
  await pauseRuntimeSchedule(s.db, id, person, at('01:30'));
  await s.endRun((await s.runs(id))['Blend Batch']!, at('02:30'));
  await s.tick(at('02:30'));
  const { 'Move Material': move, 'Clean Equipment': clean } = await s.runs(id);
  expect(move!.status).toBe('held');
  expect(clean!.status).toBe('held');
  return { id, move: move!, clean: clean! };
}

test('Remove waits for a cancelled schedule\'s running run to end', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.tick(at('01:00'));
    const run = (await s.runs(id))['Blend Batch']!;
    expect(run.status).toBe('started');
    await cancelRuntimeSchedule(s.db, id, 'Plan changed', person, at('01:10'));
    const refused = await removeRuntimeSchedule(s.db, id, person, at('01:20')).catch((e) => e);
    expect(code(refused)).toBe('RUNTIME_SCHEDULE_STATE');
    expect(refused.message).toContain('still has runs going');
    expect((await s.rowOf(id)).removedAt).toBeNull();

    await s.endRun(run, at('01:30'));
    await s.tick(at('01:30'));
    await removeRuntimeSchedule(s.db, id, person, at('01:40'));
    expect((await s.rowOf(id)).removedAt).toEqual(at('01:40'));
  } finally { await s.close(); }
});

// ------------------------------------------------------------------------------- the §9.3 timeline

test('§9.3: held chains start first, then the 02:00 slot, then 03:00, then the newly due one', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    expect(await s.tick(at('01:00'))).toMatchObject({ fired: 1 });

    await pauseRuntimeSchedule(s.db, id, person, at('02:00'));
    expect(await s.rowOf(id)).toMatchObject({ status: 'paused', pausedAt: at('02:00'), nextFireAt: at('02:00') });
    expect(await s.tick(at('02:00'))).toMatchObject({ fired: 0 });

    await s.endRun((await s.runs(id))['Blend Batch']!, at('03:00'));
    expect(await s.tick(at('03:00'))).toMatchObject({ chains: 1, fired: 0 });
    expect(await s.statuses(id)).toEqual({
      'Blend Batch': 'finished', 'Move Material': 'held', 'Clean Equipment': 'held',
    });

    const preview = await getResumePreview(s.db, id, at('03:59'));
    expect(preview).toMatchObject({
      missedCount: 2, missedMore: false, missedFirst: at('02:00'), missedLast: at('03:00'), startAllAllowed: true,
    });
    const blendLabel = (await s.runs(id))['Blend Batch']!.runtimeLabel;
    expect(preview.held.map((h) => h.name).sort()).toEqual(['Clean Equipment', 'Move Material']);
    expect(preview.held[0]).toMatchObject({
      fromRunLabel: blendLabel, fromFinalState: 'completed', fromFinishedAt: at('03:00'), disabled: false,
    });

    expect(await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:59'))).toEqual({
      startedSlots: 2, startedChains: 2, skippedSlots: 0, skippedChains: 0, missedMore: false,
    });
    expect(await s.rowOf(id)).toMatchObject({
      status: 'active', pausedAt: null, missedFrom: null, missedTo: null, nextFireAt: at('04:00'),
      catchupMode: 'all', catchupCursor: at('02:00'), catchupTo: at('03:59'),
    });
    // The control only wrote down the decision: the tick creates the runs.
    expect((await s.queue())).toHaveLength(1);
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'start_requested', 'Clean Equipment': 'start_requested' });

    expect(await s.tick(at('04:00'))).toMatchObject({ catchup: 4, fired: 1 });

    const queue = await s.queue();
    expect(queue.map((q) => q.name)).toEqual([
      'Blend Batch', 'Move Material', 'Clean Equipment', 'Blend Batch', 'Blend Batch', 'Blend Batch',
    ]);
    expect(queue.map((q) => (q.params as { BatchId: string }).BatchId)).toEqual([
      '2026-11-09T01:00', '2026-11-09T01:00', '2026-11-09T01:00',
      '2026-11-09T02:00', '2026-11-09T03:00', '2026-11-09T04:00',
    ]);
    const occ = await s.occurrences(id);
    expect(occ.map((o) => [o.number, o.origin])).toEqual([[1, 'on_time'], [2, 'resume'], [3, 'resume'], [4, 'on_time']]);
    expect(await s.rowOf(id)).toMatchObject({ catchupMode: null, catchupCursor: null, catchupTo: null, nextFireAt: at('05:00') });
  } finally { await s.close(); }
});

// --------------------------------------------------------------------------------- the three choices

test('latest starts only the last missed slot, with that slot\'s own time', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    expect(await resumeRuntimeSchedule(s.db, id, { missed: 'latest' }, person, at('04:30'))).toEqual({
      startedSlots: 1, startedChains: 2, skippedSlots: 2, skippedChains: 0, missedMore: false,
    });
    expect(await s.rowOf(id)).toMatchObject({ catchupMode: 'latest', catchupCursor: at('04:00'), catchupTo: at('04:00') });
    await s.tick(at('04:30'));
    expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('04:00')]);
    const [, latest] = await s.occurrences(id);
    expect(latest).toMatchObject({ number: 4, origin: 'resume' });
    expect((await s.queue()).at(-1)!.params).toEqual({ BatchId: '2026-11-09T04:00' });
    expect((await s.rowOf(id)).catchupMode).toBeNull();
  } finally { await s.close(); }
});

test('skip starts none and writes one event with the count and the window', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    expect(await resumeRuntimeSchedule(s.db, id, { missed: 'skip', heldChains: 'skip' }, person, at('04:30'))).toEqual({
      startedSlots: 0, startedChains: 0, skippedSlots: 3, skippedChains: 2, missedMore: false,
    });
    expect(await s.rowOf(id)).toMatchObject({ status: 'active', catchupMode: null, catchupCursor: null, nextFireAt: at('05:00') });
    await s.tick(at('04:30'));
    expect(await s.slotTimes(id)).toEqual([iso('01:00')]);

    const events = await s.events(id, 'resumed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorKind: 'api_client', actorId: person.clientId, actorName: 'ERP' });
    expect(events[0]!.detail).toMatchObject({
      missed: 'skip', heldChains: 'skip', missedCount: 3,
      window: { from: iso('02:00'), to: iso('04:30') },
      startedSlots: 0, skippedSlots: 3, startedChains: 0, skippedChains: 2,
    });
  } finally { await s.close(); }
});

test('skip does not extend endAfter: the Runtime finishes when its numbered slots have passed', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable({ ...HOURLY, range: { endAfter: 3 } }, BLEND_ONLY);
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:30'));
    await s.endRun((await s.runs(id))['Blend Batch']!, at('01:40'));
    expect((await getResumePreview(s.db, id, at('05:00'))).missedCount).toBe(2);

    await resumeRuntimeSchedule(s.db, id, { missed: 'skip' }, person, at('05:00'));

    expect((await s.rowOf(id)).nextFireAt).toBeNull();
    expect(await s.tick(at('05:01'))).toMatchObject({ fired: 0, finished: 1 });
    expect((await s.rowOf(id)).status).toBe('finished');
    expect(await s.occurrences(id)).toHaveLength(1);
  } finally { await s.close(); }
});

test('no next slot, but a window waiting: Resume still resolves it and then the Runtime finishes', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable({ ...HOURLY, range: { endAfter: 2 } }, BLEND_ONLY);
    await s.tick(at('03:30')); // 01:00 is over the tolerance, so the whole window waits
    expect(await s.rowOf(id)).toMatchObject({ missedFrom: at('01:00'), nextFireAt: null, status: 'active' });
    await s.tick(at('03:31'));
    expect((await s.rowOf(id)).status).toBe('active');

    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:40'));
    expect((await s.rowOf(id)).catchupMode).toBe('all');
    await s.tick(at('03:41'));
    expect((await s.occurrences(id)).map((o) => o.origin)).toEqual(['resume', 'resume']);
    expect((await s.rowOf(id)).status).toBe('active'); // the two runs are still going

    await s.endRun((await s.runs(id, 0))['Blend Batch']!, at('03:50'));
    await s.endRun((await s.runs(id, 1))['Blend Batch']!, at('03:50'));
    await s.tick(at('03:51'));
    expect((await s.rowOf(id)).status).toBe('finished');
  } finally { await s.close(); }
});

test('nothing missed and nothing held: Resume needs no choice and writes no catch-up', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:10'));
    const preview = await getResumePreview(s.db, id, at('01:20'));
    expect(preview).toEqual({
      missedCount: 0, missedMore: false, missedFirst: null, missedLast: null, startAllAllowed: true, held: [], pausedAt: at('01:10'), pausedBy: 'ERP',
    });
    expect(await resumeRuntimeSchedule(s.db, id, {}, person, at('01:20'))).toEqual({
      startedSlots: 0, startedChains: 0, skippedSlots: 0, skippedChains: 0, missedMore: false,
    });
    expect(await s.rowOf(id)).toMatchObject({ status: 'active', catchupMode: null, nextFireAt: at('02:00') });
  } finally { await s.close(); }
});

test('missed left out when any were missed is RESUME_CHOICE_REQUIRED, and nothing changes', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    const err = await resumeRuntimeSchedule(s.db, id, {}, person, at('03:30')).catch((e) => e);
    expect(code(err)).toBe('RESUME_CHOICE_REQUIRED');
    expect(await s.rowOf(id)).toMatchObject({ status: 'paused' });
    expect(await s.events(id, 'resumed')).toHaveLength(0);
    expect((await s.statuses(id))['Move Material']).toBe('held');
  } finally { await s.close(); }
});

test('expectedMissedCount: a count that differs refuses before changing anything; a matching one resumes', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    // The dialog showed 2 (02:00, 03:00); by confirm time 04:00 has been missed too.
    const err = await resumeRuntimeSchedule(s.db, id, { missed: 'all', expectedMissedCount: 2 }, person, at('04:30')).catch((e) => e);
    expect(code(err)).toBe('RESUME_CHOICE_REQUIRED');
    expect(err.message).toBe('The number of missed starts changed: 3 now.');
    expect(await s.rowOf(id)).toMatchObject({ status: 'paused', catchupMode: null });
    expect(await s.events(id, 'resumed')).toHaveLength(0);
    expect((await s.statuses(id))['Move Material']).toBe('held');
    expect(await resumeRuntimeSchedule(s.db, id, { missed: 'all', expectedMissedCount: 3 }, person, at('04:30')))
      .toMatchObject({ startedSlots: 3 });
  } finally { await s.close(); }
});

test('the preview says when it was paused and by whom', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    expect(await getResumePreview(s.db, id, at('03:30'))).toMatchObject({ pausedAt: at('01:30'), pausedBy: 'ERP' });
    await resumeRuntimeSchedule(s.db, id, { missed: 'skip' }, person, at('03:30'));
    expect(await getResumePreview(s.db, id, at('03:31'))).toMatchObject({ pausedAt: null, pausedBy: null });
  } finally { await s.close(); }
});

// -------------------------------------------------------------------------------- per-chain choices

test('per chain: an unticked chain becomes skipped_on_resume and a ticked one starts', async () => {
  const s = await setupSchedules();
  try {
    const { id, move, clean } = await pausedWithHeld(s);
    const result = await resumeRuntimeSchedule(
      s.db, id, { missed: 'skip', heldChains: { start: [move.id], skip: [clean.id] } }, person, at('03:30'),
    );
    expect(result).toMatchObject({ startedChains: 1, skippedChains: 1 });
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'start_requested', 'Clean Equipment': 'skipped_on_resume' });

    await s.tick(at('03:31'));

    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'started', 'Clean Equipment': 'skipped_on_resume' });
    const after = await s.runs(id);
    expect(after['Move Material']!.id).toBe(move.id);
    expect((await s.instanceOf(after['Move Material']!)).startingParams).toEqual({ BatchId: '2026-11-09T01:00' });
    expect((await s.events(id, 'resumed'))[0]!.detail).toMatchObject({
      heldChains: { start: [move.id], skip: [clean.id] },
    });
  } finally { await s.close(); }
});

test('a held row named nowhere defaults to start', async () => {
  const s = await setupSchedules();
  try {
    const { id, clean } = await pausedWithHeld(s);
    await resumeRuntimeSchedule(s.db, id, { missed: 'skip', heldChains: { start: [], skip: [clean.id] } }, person, at('03:30'));
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'start_requested', 'Clean Equipment': 'skipped_on_resume' });
  } finally { await s.close(); }
});

test.each([
  ['unknown', (_m: string) => ({ start: [NO_SUCH_ID], skip: [] })],
  ['named twice', (m: string) => ({ start: [m], skip: [m] })],
])('a held id that is %s is RUNTIME_SCHEDULE_STATE and nothing changes', async (_name, heldChains) => {
  const s = await setupSchedules();
  try {
    const { id, move } = await pausedWithHeld(s);
    const err = await resumeRuntimeSchedule(s.db, id, { missed: 'skip', heldChains: heldChains(move.id) }, person, at('03:30'))
      .catch((e) => e);
    expect(code(err)).toBe('RUNTIME_SCHEDULE_STATE');
    expect((await s.rowOf(id)).status).toBe('paused');
    expect((await s.statuses(id))['Move Material']).toBe('held');
  } finally { await s.close(); }
});

test.each([
  ['named to start', (clean: string) => ({ start: [clean], skip: [] })],
  ['named to skip', (clean: string) => ({ start: [], skip: [clean] })],
])('a held chain disabled before Resume becomes skipped_disabled when %s', async (_name, heldChains) => {
  const s = await setupSchedules();
  try {
    const { id, clean } = await pausedWithHeld(s);
    await setRuntimeItemDisabled(s.db, clean.itemId, true, person, at('02:45'));
    expect((await getResumePreview(s.db, id, at('03:30'))).held.find((h) => h.id === clean.id)!.disabled).toBe(true);

    const result = await resumeRuntimeSchedule(s.db, id, { missed: 'skip', heldChains: heldChains(clean.id) }, person, at('03:30'));

    expect(result.skippedChains).toBe(1);
    expect((await s.statuses(id))['Clean Equipment']).toBe('skipped_disabled');
    await s.tick(at('03:31'));
    expect((await s.statuses(id))['Clean Equipment']).toBe('skipped_disabled');
    expect((await s.runs(id))['Clean Equipment']!.workflowInstanceId).toBeNull();
  } finally { await s.close(); }
});

// ----------------------------------------------------------------------------------- outage windows

/** Fired at 01:00; an outage swallowed 02:00 and 03:00; 04:00 fired on time. */
async function outage(s: Schedules) {
  const id = await s.enable(HOURLY, BLEND_ONLY);
  await s.tick(at('01:00'));
  await s.tick(at('03:30'));
  expect(await s.rowOf(id)).toMatchObject({ status: 'active', missedFrom: at('02:00'), nextFireAt: at('04:00') });
  await s.tick(at('04:00'));
  expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('04:00')]);
  return id;
}

test('a slot that fired inside an outage window is not counted and not fired again', async () => {
  const s = await setupSchedules();
  try {
    const id = await outage(s);
    expect(await getResumePreview(s.db, id, at('04:30'))).toMatchObject({
      missedCount: 2, missedFirst: at('02:00'), missedLast: at('03:00'),
    });
    expect(await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('04:30'))).toMatchObject({ startedSlots: 2 });
    expect(await s.rowOf(id)).toMatchObject({ status: 'active', missedFrom: null, missedTo: null, nextFireAt: at('05:00') });

    expect((await s.tick(at('04:31'))).catchup).toBe(2);

    expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('02:00'), iso('03:00'), iso('04:00')]);
    expect((await s.occurrences(id)).map((o) => o.origin)).toEqual(['on_time', 'resume', 'resume', 'on_time']);
    expect((await s.rowOf(id)).catchupMode).toBeNull();
  } finally { await s.close(); }
});

test('latest in an outage window picks the last slot with no occurrence, not the one that fired', async () => {
  const s = await setupSchedules();
  try {
    const id = await outage(s);
    await resumeRuntimeSchedule(s.db, id, { missed: 'latest' }, person, at('04:30'));
    await s.tick(at('04:31'));
    expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('03:00'), iso('04:00')]);
  } finally { await s.close(); }
});

test('an outage window can also be skipped, and clears Needs attention', async () => {
  const s = await setupSchedules();
  try {
    const id = await outage(s);
    expect((await loadRuntimeScheduleView(s.db, id))!.needsAttention.missedWindow).toBe(true);
    expect(await resumeRuntimeSchedule(s.db, id, { missed: 'skip' }, person, at('04:30'))).toMatchObject({ skippedSlots: 2 });
    expect((await loadRuntimeScheduleView(s.db, id))!.needsAttention.missedWindow).toBe(false);
    expect((await s.occurrences(id))).toHaveLength(2);
  } finally { await s.close(); }
});

test('a window whose slots mostly fired still counts only what is undecided, however far back it began', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable({ type: 'interval', every: 1, unit: 'minutes', startAt: '2026-11-09T01:00' }, BLEND_ONLY);
    // 01:00 and 01:01 undecided; the next 600 minutes all fired.
    const start = at('01:00').getTime();
    await s.rawDb.insert(scheduleOccurrence).values(Array.from({ length: 600 }, (_, k) => ({
      runtimeScheduleId: id, number: k + 3, scheduledAt: new Date(start + (k + 2) * 60_000), origin: 'on_time',
    })));
    const now = new Date(start + 601 * 60_000);
    await s.setRuntime(id, { missedFrom: at('01:00'), missedTo: at('01:01'), nextFireAt: new Date(now.getTime() + 60_000) });

    expect(await getResumePreview(s.db, id, now)).toMatchObject({
      missedCount: 2, missedMore: false, missedFirst: at('01:00'), missedLast: at('01:01'), startAllAllowed: true,
    });
  } finally { await s.close(); }
});

test('Resume on active with no window waiting is RUNTIME_SCHEDULE_STATE', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    await s.tick(at('01:00'));
    const err = await resumeRuntimeSchedule(s.db, id, {}, person, at('01:30')).catch((e) => e);
    expect(code(err)).toBe('RUNTIME_SCHEDULE_STATE');
    expect((await getResumePreview(s.db, id, at('01:30'))).missedCount).toBe(0);
  } finally { await s.close(); }
});

test('Pause during an outage window merges with it: Resume\'s window starts at missed_from', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.tick(at('01:00'));
    await s.tick(at('03:30'));

    await pauseRuntimeSchedule(s.db, id, person, at('03:40'));
    expect(await s.rowOf(id)).toMatchObject({ status: 'paused', missedFrom: at('02:00'), nextFireAt: at('04:00') });

    expect(await getResumePreview(s.db, id, at('04:40'))).toMatchObject({
      missedCount: 3, missedFirst: at('02:00'), missedLast: at('04:00'),
    });
    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('04:40'));
    await s.tick(at('04:41'));
    expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('02:00'), iso('03:00'), iso('04:00')]);
  } finally { await s.close(); }
});

test('a window waiting during a running catch-up: all merges into one range', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.setRuntime(id, {
      catchupMode: 'all', catchupCursor: at('02:00'), catchupTo: at('03:30'),
      missedFrom: at('05:00'), missedTo: at('06:00'), nextFireAt: at('07:00'),
    });
    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('06:30'));
    expect(await s.rowOf(id)).toMatchObject({
      catchupMode: 'all', catchupCursor: at('02:00'), catchupTo: at('06:30'), missedFrom: null,
    });
  } finally { await s.close(); }
});

// Declining slots leaves no rows, so a later range or Pause over them would start them after all.
test.each(['skip', 'latest'] as const)('a window waiting during a running catch-up: %s is refused and nothing changes', async (missed) => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.setRuntime(id, {
      catchupMode: 'all', catchupCursor: at('02:00'), catchupTo: at('03:30'),
      missedFrom: at('05:00'), missedTo: at('06:00'), nextFireAt: at('07:00'),
    });
    const err = await resumeRuntimeSchedule(s.db, id, { missed }, person, at('06:30')).catch((e) => e);
    expect(code(err)).toBe('RUNTIME_SCHEDULE_STATE');
    expect(await s.rowOf(id)).toMatchObject({
      catchupMode: 'all', catchupCursor: at('02:00'), catchupTo: at('03:30'), missedFrom: at('05:00'), nextFireAt: at('07:00'),
    });
    expect(await s.events(id, 'resumed')).toHaveLength(0);
  } finally { await s.close(); }
});

test('catch-up, outage, all, Pause, Resume: no slot starts twice and no declined slot starts', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.tick(at('01:00'));
    // 02:00 and 03:00 are declined.
    await pauseRuntimeSchedule(s.db, id, person, at('01:10'));
    await resumeRuntimeSchedule(s.db, id, { missed: 'skip' }, person, at('03:30'));
    expect((await s.rowOf(id)).nextFireAt).toEqual(at('04:00'));

    // A day's pause, all chosen, and the first 20 of its 24 slots started.
    await pauseRuntimeSchedule(s.db, id, person, at('03:40'));
    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:30', '10'));
    expect(await runCatchup(s.db, at('03:30', '10'))).toBe(20);
    expect((await s.rowOf(id)).catchupCursor).toEqual(at('00:00', '10'));

    // An outage while that is going: 04:00 and 05:00 wait for a decision.
    await fireDueSlots(s.db, at('05:30', '10'));
    expect((await s.rowOf(id)).missedFrom).toEqual(at('04:00', '10'));

    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('05:40', '10'));
    await pauseRuntimeSchedule(s.db, id, person, at('05:40', '10'));
    expect((await s.rowOf(id)).missedFrom).toEqual(at('00:00', '10'));
    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('05:40', '10'));
    expect(await runCatchup(s.db, at('05:40', '10'))).toBe(6);

    const hours = (from: number, to: number, day: string) =>
      Array.from({ length: to - from + 1 }, (_, k) => iso(`${String(from + k).padStart(2, '0')}:00`, day));
    const expected = [iso('01:00'), ...hours(4, 23, '09'), ...hours(0, 5, '10')];
    expect(await s.slotTimes(id)).toEqual(expected);
    expect(await s.queue()).toHaveLength(expected.length);
    expect((await s.rowOf(id)).catchupMode).toBeNull();
  } finally { await s.close(); }
});

// ---------------------------------------------------------------------------- pause during catch-up

test('Pause during catch-up: the tick stops, missed_from becomes the cursor, the preview shows the remainder', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:10'));
    const resumeAt = at('01:30', '10'); // 24 slots missed, 02:00 today to 01:00 tomorrow
    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, resumeAt);
    expect(await runCatchup(s.db, resumeAt)).toBe(20);
    const cursor = at('22:00');
    expect((await s.rowOf(id)).catchupCursor).toEqual(cursor);

    await pauseRuntimeSchedule(s.db, id, person, resumeAt);

    expect(await s.rowOf(id)).toMatchObject({
      status: 'paused', missedFrom: cursor, catchupMode: null, catchupCursor: null, catchupTo: null,
    });
    expect(await runCatchup(s.db, resumeAt)).toBe(0);
    expect(await s.occurrences(id)).toHaveLength(21);
    expect(await getResumePreview(s.db, id, resumeAt)).toMatchObject({
      missedCount: 4, missedFirst: cursor, missedLast: at('01:00', '10'),
    });
    expect((await s.events(id, 'paused')).at(-1)!.detail).toMatchObject({ catchupReturnedFrom: cursor.toISOString() });

    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, resumeAt);
    expect(await runCatchup(s.db, resumeAt)).toBe(4);
    expect(await s.occurrences(id)).toHaveLength(25);
    expect((await s.rowOf(id)).catchupMode).toBeNull();
  } finally { await s.close(); }
});

test('Pause turns start_requested back into held, and the next Resume asks about them again', async () => {
  const s = await setupSchedules();
  try {
    const { id, move } = await pausedWithHeld(s);
    await resumeRuntimeSchedule(s.db, id, { missed: 'skip' }, person, at('03:30'));
    await pauseRuntimeSchedule(s.db, id, person, at('03:31'));
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'held', 'Clean Equipment': 'held' });
    expect(await runCatchup(s.db, at('03:32'))).toBe(0);
    expect((await getResumePreview(s.db, id, at('03:32'))).held.map((h) => h.id)).toContain(move.id);
  } finally { await s.close(); }
});

// --------------------------------------------------------------------------- start all and its limit

test('a 1-minute interval paused for a year: the preview is fast and reports more than 500', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable({ type: 'interval', every: 1, unit: 'minutes', startAt: '2026-11-09T01:00' }, BLEND_ONLY);
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:00'));
    const now = new Date('2027-11-09T01:00:30Z');

    const started = performance.now();
    const preview = await getResumePreview(s.db, id, now);
    const elapsed = performance.now() - started;

    expect(preview).toMatchObject({
      missedCount: 500, missedMore: true, startAllAllowed: false,
      missedFirst: at('01:01'), missedLast: new Date('2027-11-09T01:00:00Z'),
    });
    expect(elapsed).toBeLessThan(500);

    const err = await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, now).catch((e) => e);
    expect(code(err)).toBe('RESUME_CHOICE_REQUIRED');
    expect((err as Error).message).toContain('500');
    expect((await s.rowOf(id)).status).toBe('paused');

    const result = await resumeRuntimeSchedule(s.db, id, { missed: 'latest' }, person, now);
    // The skipped count stops at the limit, and says so.
    expect(result).toMatchObject({ startedSlots: 1, skippedSlots: 499, missedMore: true });
    await runCatchup(s.db, now);
    expect(await s.slotTimes(id)).toEqual([iso('01:00'), '2027-11-09T01:00:00.000Z']);
    expect((await s.occurrences(id))[1]!.origin).toBe('resume');
  } finally { await s.close(); }
});

test('latest on a window over the limit walks back past a last slot that already has an occurrence', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable({ type: 'interval', every: 1, unit: 'minutes', startAt: '2026-11-09T01:00' }, BLEND_ONLY);
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:00'));
    const now = new Date('2027-11-09T01:00:30Z');
    await s.rawDb.insert(scheduleOccurrence).values({
      runtimeScheduleId: id, number: 999_999, scheduledAt: new Date('2027-11-09T01:00:00Z'), origin: 'on_time',
    });
    expect((await getResumePreview(s.db, id, now)).missedLast).toEqual(new Date('2027-11-09T00:59:00Z'));
  } finally { await s.close(); }
});

test('exactly 500 can all start; 501 cannot', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable({ type: 'interval', every: 1, unit: 'minutes', startAt: '2026-11-09T01:00' }, BLEND_ONLY);
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:00'));
    const after = (n: number) => new Date(at('01:00').getTime() + n * 60_000);

    expect(await getResumePreview(s.db, id, after(500))).toMatchObject({
      missedCount: 500, missedMore: false, startAllAllowed: true, missedLast: after(500),
    });
    expect(await getResumePreview(s.db, id, after(501))).toMatchObject({
      missedCount: 500, missedMore: true, startAllAllowed: false, missedLast: after(501),
    });
    expect(await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, after(500))).toMatchObject({ startedSlots: 500 });
  } finally { await s.close(); }
});

// ------------------------------------------------------------------------------------------- cancel

test('Cancel: held become cancelled, ended_at set, specs dropped, and a running run is untouched', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    await s.tick(at('01:00'));
    await s.tick(at('02:00'));
    const running = (await s.runs(id, 1))['Blend Batch']!;
    await s.rawDb.update(workflowInstance).set({ status: 'running' }).where(eq(workflowInstance.id, running.workflowInstanceId!));
    await pauseRuntimeSchedule(s.db, id, person, at('02:10'));
    await s.endRun((await s.runs(id, 0))['Blend Batch']!, at('02:20'));
    await s.tick(at('02:20'));
    expect((await s.statuses(id, 0))['Move Material']).toBe('held');

    await cancelRuntimeSchedule(s.db, id, 'Line down for the week', person, at('02:30'));

    expect(await s.rowOf(id)).toMatchObject({
      status: 'cancelled', endedAt: at('02:30'), nextFireAt: null, missedFrom: null, missedTo: null, catchupMode: null,
    });
    expect(await s.statuses(id, 0)).toMatchObject({ 'Move Material': 'cancelled', 'Clean Equipment': 'cancelled' });
    for (const i of await s.itemsOf(id)) expect(i.specJsonb).toBeNull();

    expect((await s.instanceOf(running)).status).toBe('running');
    expect((await s.statuses(id, 1))['Blend Batch']).toBe('started');
    expect(await s.rawDb.select().from(runtimeControlEvent)).toHaveLength(0);

    const [event] = await s.events(id, 'cancelled');
    expect(event).toMatchObject({ actorKind: 'api_client', actorName: 'ERP' });
    expect(event!.detail).toMatchObject({ reason: 'Line down for the week', cancelledChains: 2 });

    await s.tick(at('09:00'));
    expect(await s.occurrences(id)).toHaveLength(2);
  } finally { await s.close(); }
});

test('§9.4: a run ending after Cancel records its chains as cancelled, and nothing else happens', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    await s.tick(at('01:00'));
    await cancelRuntimeSchedule(s.db, id, 'Not needed', person, at('02:00'));
    await s.endRun((await s.runs(id))['Blend Batch']!, at('03:00'));
    await s.tick(at('03:00'));
    expect(await s.statuses(id)).toEqual({
      'Blend Batch': 'finished', 'Move Material': 'cancelled', 'Clean Equipment': 'cancelled',
    });
    expect(await s.queue()).toHaveLength(1);
  } finally { await s.close(); }
});

test('Cancel during catch-up clears it and cancels what was waiting to start', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    await resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:30'));
    await cancelRuntimeSchedule(s.db, id, 'Stop', person, at('03:31'));

    expect(await s.rowOf(id)).toMatchObject({ status: 'cancelled', catchupMode: null, catchupCursor: null, catchupTo: null });
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'cancelled', 'Clean Equipment': 'cancelled' });
    expect(await runCatchup(s.db, at('03:32'))).toBe(0);
    expect(await s.queue()).toHaveLength(1);
  } finally { await s.close(); }
});

test.each(['', '   '])('Cancel with the reason %j is refused and nothing changes', async (reason) => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    const err = await cancelRuntimeSchedule(s.db, id, reason, person, at('01:00')).catch((e) => e);
    expect(code(err)).toBe('CONFIRMATION_REQUIRED');
    expect((await s.rowOf(id)).status).toBe('active');
  } finally { await s.close(); }
});

// -------------------------------------------------------------------------------- disable, re-enable

test('§9.5: Disable leaves a running run alone, the item records skipped_disabled, and re-enabling back-fills nothing', async () => {
  const s = await setupSchedules();
  try {
    const [u] = await s.rawDb.insert(appUser).values({ email: 'js@x.io', displayName: 'J Smith' }).returning();
    const actor = { kind: 'user', userId: u!.id, name: 'jsmith' } as const;
    const id = await s.enable();
    await s.tick(at('01:00'));
    const blend = await s.itemNamed(id, 'Blend Batch');
    const clean = await s.itemNamed(id, 'Clean Equipment');

    await setRuntimeItemDisabled(s.db, blend.id, true, actor, at('01:10'));
    expect((await s.instanceOf((await s.runs(id))['Blend Batch']!)).status).toBe('queued');
    expect((await s.statuses(id))['Blend Batch']).toBe('started');
    expect(await s.itemNamed(id, 'Blend Batch')).toMatchObject({ disabled: true, disabledAt: at('01:10'), disabledBy: u!.id });
    await setRuntimeItemDisabled(s.db, blend.id, false, actor, at('01:11'));
    expect(await s.itemNamed(id, 'Blend Batch')).toMatchObject({ disabled: false, disabledAt: null, disabledBy: null });

    await setRuntimeItemDisabled(s.db, clean.id, true, actor, at('01:20'));
    await s.endRun((await s.runs(id))['Blend Batch']!, at('01:30'));
    await s.tick(at('01:30'));
    expect(await s.statuses(id)).toEqual({
      'Blend Batch': 'finished', 'Move Material': 'started', 'Clean Equipment': 'skipped_disabled',
    });

    await setRuntimeItemDisabled(s.db, clean.id, false, actor, at('01:40'));
    await s.tick(at('01:41'));
    expect((await s.statuses(id))['Clean Equipment']).toBe('skipped_disabled');

    const [off] = (await s.events(id, 'item_disabled')).slice(-1);
    expect(off).toMatchObject({ actorKind: 'user', actorId: u!.id, actorName: 'jsmith' });
    expect(off!.detail).toMatchObject({ itemId: clean.id, name: 'Clean Equipment' });
    expect(await s.events(id, 'item_enabled')).toHaveLength(2);
  } finally { await s.close(); }
});

test('a Disable that changes nothing writes no event; a missing item or ended Runtime is refused', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    const clean = await s.itemNamed(id, 'Clean Equipment');
    await setRuntimeItemDisabled(s.db, clean.id, false, person, at('01:00'));
    expect(await s.events(id, 'item_enabled')).toHaveLength(0);

    const missing = await setRuntimeItemDisabled(s.db, NO_SUCH_ID, true, person, at('01:00')).catch((e) => e);
    expect(code(missing)).toBe('RUNTIME_SCHEDULE_NOT_FOUND');

    await cancelRuntimeSchedule(s.db, id, 'Done', person, at('01:00'));
    const ended = await setRuntimeItemDisabled(s.db, clean.id, true, person, at('01:00')).catch((e) => e);
    expect(code(ended)).toBe('RUNTIME_SCHEDULE_STATE');
    expect((await s.itemNamed(id, 'Clean Equipment')).disabled).toBe(false);
  } finally { await s.close(); }
});

// --------------------------------------------------------------------------------------- acknowledge

test('acknowledge clears needsAttention, only for failed and lost rows of this Runtime, and logs the actor', async () => {
  const s = await setupSchedules();
  try {
    const [u] = await s.rawDb.insert(appUser).values({ email: 'js@x.io', displayName: 'J Smith' }).returning();
    const actor = { kind: 'user', userId: u!.id, name: 'jsmith' } as const;
    const id = await s.enable(HOURLY, [
      { workflow: { name: 'Blend Batch' } }, { workflow: { name: 'Move Material' } }, { workflow: { name: 'Clean Equipment' } },
    ]);
    const other = await s.enable(HOURLY, BLEND_ONLY);
    await s.tick(at('01:00'));
    const { 'Blend Batch': failed, 'Move Material': lost, 'Clean Equipment': going } = await s.runs(id);
    const otherRun = (await s.runs(other))['Blend Batch']!;
    await s.rawDb.update(scheduleItemRun).set({ status: 'failed_to_start' }).where(eq(scheduleItemRun.id, failed!.id));
    await s.rawDb.update(scheduleItemRun).set({ status: 'lost' }).where(eq(scheduleItemRun.id, lost!.id));
    await s.rawDb.update(scheduleItemRun).set({ status: 'failed_to_start' }).where(eq(scheduleItemRun.id, otherRun.id));
    expect((await loadRuntimeScheduleView(s.db, id))!.needsAttention).toMatchObject({ failed: 1, lost: 1 });

    // A started row and another Runtime's row are not dismissed, however they are named.
    expect(await acknowledgeRuntimeItems(s.db, id, [going!.id, otherRun.id, NO_SUCH_ID], actor, at('02:00'))).toBe(0);
    expect(await s.events(id, 'items_acknowledged')).toHaveLength(0);

    expect(await acknowledgeRuntimeItems(s.db, id, [failed!.id], actor, at('02:00'))).toBe(1);
    expect((await loadRuntimeScheduleView(s.db, id))!.needsAttention).toMatchObject({ failed: 0, lost: 1 });
    expect((await s.runs(id))['Blend Batch']).toMatchObject({ acknowledgedAt: at('02:00'), acknowledgedBy: u!.id });

    expect(await acknowledgeRuntimeItems(s.db, id, 'all', actor, at('02:05'))).toBe(1);
    expect((await loadRuntimeScheduleView(s.db, id))!.needsAttention).toMatchObject({ failed: 0, lost: 0 });
    expect(await acknowledgeRuntimeItems(s.db, id, 'all', actor, at('02:06'))).toBe(0);
    expect(await acknowledgeRuntimeItems(s.db, id, [], actor, at('02:06'))).toBe(0);

    const events = await s.events(id, 'items_acknowledged');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actorKind: 'user', actorId: u!.id, actorName: 'jsmith' });
    expect(events[0]!.detail).toMatchObject({ count: 1, runIds: [failed!.id] });
    expect((await s.runs(id))['Clean Equipment']!.acknowledgedAt).toBeNull();
    expect((await loadRuntimeScheduleView(s.db, other))!.needsAttention.failed).toBe(1);
  } finally { await s.close(); }
});

test('acknowledge works on a Runtime that has ended, and a missing one is refused', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable(HOURLY, BLEND_ONLY);
    await s.tick(at('01:00'));
    await s.rawDb.update(scheduleItemRun).set({ status: 'lost' }).where(eq(scheduleItemRun.id, (await s.runs(id))['Blend Batch']!.id));
    await cancelRuntimeSchedule(s.db, id, 'Done', person, at('01:30'));
    expect(await acknowledgeRuntimeItems(s.db, id, 'all', person, at('02:00'))).toBe(1);
    const err = await acknowledgeRuntimeItems(s.db, NO_SUCH_ID, 'all', person, at('02:00')).catch((e) => e);
    expect(code(err)).toBe('RUNTIME_SCHEDULE_NOT_FOUND');
  } finally { await s.close(); }
});

// ----------------------------------------------------------------------------------- state and races

test('every control refuses a Runtime in the wrong state, and a missing one is RUNTIME_SCHEDULE_NOT_FOUND', async () => {
  const s = await setupSchedules();
  try {
    const paused = await s.enable();
    await pauseRuntimeSchedule(s.db, paused, person, at('01:00'));
    expect(code(await pauseRuntimeSchedule(s.db, paused, person, at('01:00')).catch((e) => e))).toBe('RUNTIME_SCHEDULE_STATE');

    for (const status of ['cancelled', 'finished']) {
      const id = await s.enable();
      await s.setRuntime(id, { status });
      for (const call of [
        pauseRuntimeSchedule(s.db, id, person, at('01:00')),
        resumeRuntimeSchedule(s.db, id, {}, person, at('01:00')),
        cancelRuntimeSchedule(s.db, id, 'x', person, at('01:00')),
        getResumePreview(s.db, id, at('01:00')),
      ]) {
        expect(code(await (call as Promise<unknown>).catch((e) => e))).toBe('RUNTIME_SCHEDULE_STATE');
      }
    }

    for (const call of [
      pauseRuntimeSchedule(s.db, NO_SUCH_ID, person, at('01:00')),
      resumeRuntimeSchedule(s.db, NO_SUCH_ID, {}, person, at('01:00')),
      cancelRuntimeSchedule(s.db, NO_SUCH_ID, 'x', person, at('01:00')),
      getResumePreview(s.db, NO_SUCH_ID, at('01:00')),
    ]) {
      expect(code(await (call as Promise<unknown>).catch((e) => e))).toBe('RUNTIME_SCHEDULE_NOT_FOUND');
    }
  } finally { await s.close(); }
});

test('two Resumes at once: one fulfils, the other is RUNTIME_SCHEDULE_STATE, and each slot starts once', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    const results = await Promise.allSettled([
      resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:30')),
      resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:30')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(code(rejected.reason)).toBe('RUNTIME_SCHEDULE_STATE');

    await Promise.all([s.tick(at('03:31')), s.tick(at('03:31'))]);
    expect(await s.slotTimes(id)).toEqual([iso('01:00'), iso('02:00'), iso('03:00')]);
    expect(await s.queue()).toHaveLength(5);
    expect(await s.events(id, 'resumed')).toHaveLength(1);
  } finally { await s.close(); }
});

test('Cancel winning the race: Resume is RUNTIME_SCHEDULE_STATE and nothing starts', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    const [cancel, resume] = await Promise.allSettled([
      cancelRuntimeSchedule(s.db, id, 'Stop', person, at('03:30')),
      resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:30')),
    ]);
    expect(cancel.status).toBe('fulfilled');
    expect(code((resume as PromiseRejectedResult).reason)).toBe('RUNTIME_SCHEDULE_STATE');

    await s.tick(at('03:31'));
    expect(await s.slotTimes(id)).toEqual([iso('01:00')]);
    expect(await s.queue()).toHaveLength(1);
  } finally { await s.close(); }
});

test('Resume winning the race: Cancel of the now active Runtime is still valid, and nothing starts', async () => {
  const s = await setupSchedules();
  try {
    const { id } = await pausedWithHeld(s);
    const [resume, cancel] = await Promise.allSettled([
      resumeRuntimeSchedule(s.db, id, { missed: 'all' }, person, at('03:30')),
      cancelRuntimeSchedule(s.db, id, 'Stop', person, at('03:30')),
    ]);
    expect([resume.status, cancel.status]).toEqual(['fulfilled', 'fulfilled']);

    await s.tick(at('03:31'));
    expect((await s.rowOf(id)).status).toBe('cancelled');
    expect(await s.slotTimes(id)).toEqual([iso('01:00')]);
    expect(await s.queue()).toHaveLength(1);
  } finally { await s.close(); }
});
