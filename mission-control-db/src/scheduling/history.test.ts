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
import { runtimeHistory, scheduleHistory, workCenter } from '../db/schema/index.js';
import { at, person, setupSchedules, type Schedules } from '../../test/helpers/schedule-fixture.js';
import {
  countRuntimeHistoryBefore, deleteRuntimeHistory, listHistoryEntriesPage, purgeRuntimeHistory,
} from '../dao/runtime-history.js';
import { cancelRuntimeSchedule, pauseRuntimeSchedule, removeRuntimeSchedule } from './controls.js';
import { getScheduleHistoryDetail } from './history.js';

const passes = (s: Schedules) => s.rawDb.select().from(scheduleHistory);

/** Fires 01:00, ends Blend Batch as told, and lets the chains start. */
async function firstPass(s: Schedules, blendEnds = 'completed') {
  const id = await s.enable();
  await s.tick(at('01:00'));
  await s.endRun((await s.runs(id))['Blend Batch']!, at('01:20'), blendEnds);
  await s.tick(at('01:21'));
  return id;
}

test('a pass is recorded once, only after every workflow in it has ended, chains included', async () => {
  const s = await setupSchedules();
  try {
    const id = await firstPass(s);
    expect(await passes(s)).toHaveLength(0); // Move Material and Clean Equipment are running
    const { 'Move Material': move, 'Clean Equipment': clean } = await s.runs(id);
    await s.endRun(move!, at('01:40'));
    expect((await s.tick(at('01:41'))).recorded).toBe(0); // Clean Equipment still running
    await s.endRun(clean!, at('01:50'), 'aborted');
    expect((await s.tick(at('01:51'))).recorded).toBe(1);
    expect((await s.tick(at('01:52'))).recorded).toBe(0);

    const [row] = await passes(s);
    expect(row).toMatchObject({
      runtimeScheduleId: id, scheduleLabel: 'RS-1', scheduleName: 'Sched 1', occurrenceNumber: 1, runOnce: false,
      scheduledAt: at('01:00'), finishedAt: at('01:50'), workCenterName: 'Line 1', timeZone: 'UTC', origin: 'on_time',
    });
    expect(row!.workflows.map((w) => [w.name, w.status, w.finalState])).toEqual([
      ['Blend Batch', 'finished', 'completed'], ['Move Material', 'finished', 'completed'], ['Clean Equipment', 'finished', 'aborted'],
    ]);
    const [blend, moveRow] = row!.workflows;
    expect(moveRow!.parentRunId).toBe(blend!.runId);
    expect(blend!.parentRunId).toBeNull();
    expect(blend!.version).toBe('1.0.0');
    expect(blend!.runtimeLabel).toMatch(/^RW-/);
    expect(blend!.startingValues?.BatchId).toBeTruthy();
    expect(moveRow!.startingValues?.BatchId).toBe(blend!.startingValues?.BatchId);

    const detail = (await getScheduleHistoryDetail(s.db, row!.id))!;
    expect(detail.counts).toEqual({ ran: 3, completed: 2, problems: 1, notStarted: 0 });
    expect(detail.workflows.every((w) => w.historyId !== null)).toBe(true);
    const blendHistory = detail.workflows[0]!.historyId!;
    await deleteRuntimeHistory(s.db, blendHistory);
    expect((await getScheduleHistoryDetail(s.db, row!.id))!.workflows[0]!.historyId).toBeNull();
  } finally { await s.close(); }
});

test('a parent that does not complete records the chains it did not trigger', async () => {
  const s = await setupSchedules();
  try {
    await firstPass(s, 'aborted');
    const [row] = await passes(s);
    expect(row!.workflows.map((w) => [w.name, w.status])).toEqual([
      ['Blend Batch', 'finished'], ['Move Material', 'not_triggered'], ['Clean Equipment', 'not_triggered'],
    ]);
    expect(row!.workflows[1]!.startingValues).toBeNull();
    expect((await getScheduleHistoryDetail(s.db, row!.id))!.counts).toEqual({ ran: 1, completed: 0, problems: 1, notStarted: 2 });
  } finally { await s.close(); }
});

test('a held chain keeps the pass open until Cancel settles it', async () => {
  const s = await setupSchedules();
  try {
    const id = await s.enable();
    await s.tick(at('01:00'));
    await pauseRuntimeSchedule(s.db, id, person, at('01:10'));
    await s.endRun((await s.runs(id))['Blend Batch']!, at('01:20'));
    await s.tick(at('01:21'));
    expect(await s.statuses(id)).toMatchObject({ 'Move Material': 'held' });
    expect(await passes(s)).toHaveLength(0);
    await cancelRuntimeSchedule(s.db, id, 'Plan changed', person, at('01:30'));
    await s.tick(at('01:31'));
    const [row] = await passes(s);
    expect(row!.workflows.map((w) => w.status)).toEqual(['finished', 'cancelled', 'cancelled']);
  } finally { await s.close(); }
});

test('a pass outlives Remove, and the purge clears it for good', async () => {
  const s = await setupSchedules();
  try {
    const id = await firstPass(s, 'aborted');
    await cancelRuntimeSchedule(s.db, id, 'done', person, at('01:30'));
    await removeRuntimeSchedule(s.db, id, person, at('01:31'));
    expect(await passes(s)).toHaveLength(1);

    const cutoff = at('00:00', '20');
    expect(await countRuntimeHistoryBefore(s.db, { olderThan: cutoff })).toBe(2); // Blend's record and the pass
    expect(await purgeRuntimeHistory(s.db, { olderThan: cutoff })).toBe(2);
    expect(await passes(s)).toHaveLength(0);
    expect((await s.tick(at('02:30'))).recorded).toBe(0); // not written again
    expect(await passes(s)).toHaveLength(0);
  } finally { await s.close(); }
});

test('the History list mixes passes with workflow runs, newest first, paged together', async () => {
  const s = await setupSchedules();
  try {
    const id = await firstPass(s);
    const { 'Move Material': move, 'Clean Equipment': clean } = await s.runs(id);
    await s.endRun(move!, at('01:40'));
    await s.endRun(clean!, at('01:50'));
    await s.tick(at('01:51'));

    const all = await listHistoryEntriesPage(s.db, { workCenterId: s.wc.id });
    expect(all.total).toBe(4);
    // The pass finishes with its last run, a tie that lists the pass first.
    expect(all.items.map((i) => i.kind === 'schedule' ? `pass ${i.scheduleLabel}` : i.masterName)).toEqual([
      'pass RS-1', 'Clean Equipment', 'Move Material', 'Blend Batch',
    ]);
    const pass = all.items.find((i) => i.kind === 'schedule')!;
    expect(pass).toMatchObject({ kind: 'schedule', scheduleName: 'Sched 1', counts: { ran: 3, completed: 3, problems: 0, notStarted: 0 } });

    const page2 = await listHistoryEntriesPage(s.db, { workCenterId: s.wc.id, page: 2, pageSize: 3 });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.kind === 'workflow' && page2.items[0]!.masterName).toBe('Blend Batch');

    const completedOnly = await listHistoryEntriesPage(s.db, { workCenterId: s.wc.id, finalState: 'completed' });
    expect(completedOnly.total).toBe(3);
    expect(completedOnly.items.every((i) => i.kind === 'workflow')).toBe(true);

    const byWorkflow = await listHistoryEntriesPage(s.db, { workCenterId: s.wc.id, nameSearch: 'clean' });
    expect(byWorkflow.items.map((i) => i.kind)).toEqual(['schedule', 'workflow']);
    const bySchedule = await listHistoryEntriesPage(s.db, { workCenterId: s.wc.id, nameSearch: 'Sched 1' });
    expect(bySchedule.items.map((i) => i.kind)).toEqual(['schedule']);

    const [other] = await s.rawDb.insert(workCenter).values({ name: 'Line 2' }).returning();
    expect((await listHistoryEntriesPage(s.db, { workCenterId: other!.id })).total).toBe(0);
    expect((await listHistoryEntriesPage(s.db, { finishedFrom: at('01:45') })).items.map((i) => i.kind)).toEqual(['schedule', 'workflow']);
  } finally { await s.close(); }
});

test('a work center deleted later leaves the pass, orphaned like a workflow record', async () => {
  const s = await setupSchedules();
  try {
    await firstPass(s, 'aborted');
    await s.rawDb.delete(runtimeHistory);
    await s.rawDb.update(scheduleHistory).set({ workCenterId: null });
    const orphans = await listHistoryEntriesPage(s.db, { orphansOnly: true });
    expect(orphans.items.map((i) => i.kind)).toEqual(['schedule']);
    expect((await s.rawDb.select().from(scheduleHistory).where(eq(scheduleHistory.workCenterName, 'Line 1')))).toHaveLength(1);
  } finally { await s.close(); }
});

