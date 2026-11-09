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
import { and, asc, eq, sql } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import {
  workCenter, workflow, workflowInstance, runtimeHistory, runtimeSchedule, runtimeScheduleItem,
  runtimeScheduleEvent, scheduleOccurrence, scheduleItemRun, type ScheduleItemRun,
} from '../db/schema/index.js';
import { runtimeControlEvent } from '../db/schema/execution.js';
import { DaoError } from '../dao/errors.js';
import { countRuntimeHistoryBefore, deleteRuntimeHistory, purgeRuntimeHistory } from '../dao/runtime-history.js';
import { createMasterSchedule } from './master-dao.js';
import { enableMasterSchedule } from './enable.js';
import { fireDueSlots } from './fire.js';
import { chainContext, finishCompletedSchedules, markLostRuns, processEndedRuns, startChainItem } from './chain.js';
import { runScheduleTick } from './tick.js';

const ENABLED_AT = new Date('2026-11-08T12:00:00Z');
const at = (hhmm: string, day = '09') => new Date(`2026-11-${day}T${hhmm}:00Z`);
const plusSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
const NOW = at('12:00');

const ONCE = { type: 'once', at: '2026-11-09T08:00' };
const HOURLY = { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T08:00' };
const actor = { kind: 'system' } as const;

const WORKFLOWS = ['Blend Batch', 'Move Material', 'Lab Test', 'Release Batch', 'Clean Equipment'];
const specOf = (name: string) => ({
  oid: `wf-${name}`, local_id: name,
  starting_parameter_specifications: ['BatchId', 'Size', 'Yield', 'LabResult', 'Reason'].map((id) => (
    { id, value_type: 'literal', default_value: '' }
  )),
  output_parameter_specifications: [{ id: 'Yield' }, { id: 'Result' }],
  steps: [{ local_id: 'Only', oid: `s-${name}`, step_type: 'START' }],
  connections: [],
});

// The tree of spec §8.4.
const TREE = [{
  workflow: { name: 'Blend Batch' },
  params: { BatchId: { value: 'B-88123' }, Size: { value: '2500' } },
  chain: [
    {
      workflow: { name: 'Move Material' }, triggerOn: ['completed'],
      params: { BatchId: { from: 'trigger.input', name: 'BatchId' } },
    },
    {
      workflow: { name: 'Lab Test' }, triggerOn: ['completed'],
      params: {
        BatchId: { from: 'trigger.input', name: 'BatchId' },
        Yield: { from: 'trigger.output', name: 'Yield', fallback: 'unknown' },
      },
      chain: [{
        workflow: { name: 'Release Batch' }, triggerOn: ['completed'],
        params: { LabResult: { from: 'trigger.output', name: 'Result' } },
      }],
    },
    {
      workflow: { name: 'Clean Equipment' }, triggerOn: ['completed', 'stopped', 'aborted', 'errored'],
      params: { Reason: { value: 'Post-batch clean' } },
    },
  ],
}];

type Ending = 'completed' | 'stopped' | 'aborted' | 'errored';

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1', timeZone: 'UTC' }).returning();
  for (const name of WORKFLOWS) {
    await t.db.insert(workflow).values({
      oid: `wf-${name}`, name, workCenterId: wc!.id, version: '1.0.0', state: 'Effective', specJsonb: specOf(name),
    });
  }
  let n = 0;
  const enable = async (recurrence: unknown = ONCE, items: unknown[] = TREE) => {
    const m = await createMasterSchedule(t.db as any, wc!.id, { name: `Sched ${++n}`, recurrence, items }, actor);
    const { runtime } = await enableMasterSchedule(t.db as any, m.id, actor, ENABLED_AT);
    return runtime.id;
  };
  const fire = (now = at('08:00')) => fireDueSlots(t.db as any, now);
  const rowOf = async (id: string) =>
    (await t.db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id)))[0]!;
  const setRuntime = (id: string, values: Partial<typeof runtimeSchedule.$inferInsert>) =>
    t.db.update(runtimeSchedule).set(values).where(eq(runtimeSchedule.id, id));
  const itemsOf = (id: string) => t.db.select().from(runtimeScheduleItem)
    .where(eq(runtimeScheduleItem.runtimeScheduleId, id));
  const setDisabled = async (id: string, name: string) => {
    const item = (await itemsOf(id)).find((i) => i.masterName === name)!;
    await t.db.update(runtimeScheduleItem).set({ disabled: true }).where(eq(runtimeScheduleItem.id, item.id));
  };
  const occurrences = (id: string) => t.db.select().from(scheduleOccurrence)
    .where(eq(scheduleOccurrence.runtimeScheduleId, id)).orderBy(asc(scheduleOccurrence.scheduledAt));
  /** The item runs of one Runtime (of its first occurrence unless told otherwise), by workflow name. */
  const runs = async (id: string, occurrenceNumber = 0): Promise<Record<string, ScheduleItemRun>> => {
    const occ = (await occurrences(id))[occurrenceNumber]!;
    const items = await itemsOf(id);
    const rows = await t.db.select().from(scheduleItemRun).where(eq(scheduleItemRun.occurrenceId, occ.id));
    return Object.fromEntries(rows.map((r) => [items.find((i) => i.id === r.itemId)!.masterName, r]));
  };
  const statuses = async (id: string, occurrenceNumber = 0) =>
    Object.fromEntries(Object.entries(await runs(id, occurrenceNumber)).map(([k, r]) => [k, r.status]));
  const instanceOf = async (run: ScheduleItemRun) =>
    (await t.db.select().from(workflowInstance).where(eq(workflowInstance.id, run.workflowInstanceId!)))[0]!;
  const instanceCount = async () => (await t.db.select().from(workflowInstance)).length;
  /** What settleTerminal leaves behind: the history row is the proof of an ending. */
  const endRun = async (run: ScheduleItemRun, finalState: Ending, outputs: unknown = null, finishedAt = NOW) => {
    const i = await instanceOf(run);
    const [row] = await t.db.insert(runtimeHistory).values({
      workflowInstanceId: i.id, workCenterId: wc!.id, workCenterName: 'Line 1',
      runtimeNumber: i.runtimeNumber, runtimeLabel: i.runtimeLabel,
      masterName: i.masterName, masterOid: i.masterOid, masterVersion: i.masterVersion, masterState: i.masterState,
      finalState, finishedAt, startingParams: i.startingParams, trace: [], outputs,
    }).returning();
    return row!;
  };
  const process = () => processEndedRuns(t.db as any, NOW);
  return {
    ...t, wc: wc!, enable, fire, rowOf, setRuntime, itemsOf, setDisabled, occurrences, runs, statuses,
    instanceOf, instanceCount, endRun, process,
  };
}

afterEach(() => vi.restoreAllMocks());

test.each<[Ending, Record<string, string>]>([
  ['completed', { 'Move Material': 'started', 'Lab Test': 'started', 'Clean Equipment': 'started' }],
  ['stopped', { 'Move Material': 'not_triggered', 'Lab Test': 'not_triggered', 'Clean Equipment': 'started' }],
  ['aborted', { 'Move Material': 'not_triggered', 'Lab Test': 'not_triggered', 'Clean Equipment': 'started' }],
  ['errored', { 'Move Material': 'not_triggered', 'Lab Test': 'not_triggered', 'Clean Equipment': 'started' }],
])('§9.1: Blend Batch ending %s decides each child, and Release Batch is not yet considered', async (ending, expected) => {
  const { close, enable, fire, runs, statuses, instanceCount, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    const blend = (await runs(id))['Blend Batch']!;
    const history = await endRun(blend, ending);

    expect(await process()).toBe(1);

    expect(await statuses(id)).toEqual({ 'Blend Batch': 'finished', ...expected });
    const after = await runs(id);
    expect(after['Blend Batch']).toMatchObject({ finalState: ending, finishedAt: history.finishedAt });
    for (const name of Object.keys(expected)) expect(after[name]!.parentRunId).toBe(blend.id);
    const started = Object.values(expected).filter((s) => s === 'started').length;
    expect(await instanceCount()).toBe(1 + started);
  } finally { await close(); }
});

test('trigger values reach the children, are stored on the parent, and the run is labelled like a start-list run', async () => {
  const { close, enable, fire, runs, instanceOf, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed', [{ name: 'Yield', value: '98.5' }]);
    await process();

    const after = await runs(id);
    expect(after['Blend Batch']!.triggerValues).toEqual({
      inputs: { BatchId: 'B-88123', Size: '2500' }, outputs: { Yield: '98.5' },
    });
    const lab = await instanceOf(after['Lab Test']!);
    expect(lab.startingParams).toEqual({ BatchId: 'B-88123', Yield: '98.5' });
    expect((await instanceOf(after['Move Material']!)).startingParams).toEqual({ BatchId: 'B-88123' });
    expect((await instanceOf(after['Clean Equipment']!)).startingParams).toEqual({ Reason: 'Post-batch clean' });
    expect(lab).toMatchObject({
      status: 'queued', triggeredBy: 'schedule', createdBy: null, scheduleLabel: 'RS-1 / occurrence 1',
      scheduleItemRunId: after['Lab Test']!.id,
    });
    expect(after['Lab Test']!.runtimeLabel).toBe(lab.runtimeLabel);
  } finally { await close(); }
});

test('history with outputs null counts as empty: a fallback applies and trigger_values holds an empty map', async () => {
  const { close, enable, fire, runs, instanceOf, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed', null);
    await process();

    const after = await runs(id);
    expect(after['Blend Batch']!.triggerValues).toEqual({
      inputs: { BatchId: 'B-88123', Size: '2500' }, outputs: {},
    });
    expect((await instanceOf(after['Lab Test']!)).startingParams).toEqual({ BatchId: 'B-88123', Yield: 'unknown' });
  } finally { await close(); }
});

test('a grandchild starts only after its own parent ends, reading that parent\'s output', async () => {
  const { close, enable, fire, runs, statuses, instanceOf, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed');
    await process();
    expect((await runs(id))['Release Batch']).toBeUndefined();

    // A sibling ending does nothing for it.
    await endRun((await runs(id))['Move Material']!, 'completed');
    await process();
    expect((await runs(id))['Release Batch']).toBeUndefined();

    const lab = (await runs(id))['Lab Test']!;
    await endRun(lab, 'completed', [{ name: 'Result', value: 'pass' }]);
    await process();

    const after = await runs(id);
    expect(after['Release Batch']).toMatchObject({ status: 'started', parentRunId: lab.id });
    expect((await instanceOf(after['Release Batch']!)).startingParams).toEqual({ LabResult: 'pass' });
    expect((await statuses(id))['Lab Test']).toBe('finished');
  } finally { await close(); }
});

test('§9.2: two overlapping occurrences each read their own parent and their own slot', async () => {
  const { close, enable, fire, runs, instanceOf, endRun, process } = await setup();
  try {
    const id = await enable(HOURLY, [{
      workflow: { name: 'Blend Batch' },
      params: { BatchId: { from: 'occurrence.datetime' } },
      chain: [{
        workflow: { name: 'Lab Test' }, triggerOn: ['completed'],
        params: {
          BatchId: { from: 'trigger.input', name: 'BatchId' },
          Yield: { from: 'trigger.output', name: 'Yield' },
          Reason: { template: 'slot {occurrence.number} at {occurrence.datetime}' },
        },
      }],
    }]);
    await fire(at('08:00'));
    await fire(at('09:00'));
    // The later one ends first, and the earlier one's values must still be its own.
    await endRun((await runs(id, 1))['Blend Batch']!, 'completed', [{ name: 'Yield', value: 'second' }]);
    await process();
    expect((await runs(id, 0))['Lab Test']).toBeUndefined();
    await endRun((await runs(id, 0))['Blend Batch']!, 'completed', [{ name: 'Yield', value: 'first' }]);
    await process();

    expect((await instanceOf((await runs(id, 0))['Lab Test']!))).toMatchObject({
      startingParams: { BatchId: '2026-11-09T08:00', Yield: 'first', Reason: 'slot 1 at 2026-11-09T08:00' },
      scheduleLabel: 'RS-1 / occurrence 1',
    });
    expect((await instanceOf((await runs(id, 1))['Lab Test']!))).toMatchObject({
      startingParams: { BatchId: '2026-11-09T09:00', Yield: 'second', Reason: 'slot 2 at 2026-11-09T09:00' },
      scheduleLabel: 'RS-1 / occurrence 2',
    });
  } finally { await close(); }
});

test('paused: children that would start become held, nothing is created, and not_triggered still comes first', async () => {
  const { close, enable, fire, setRuntime, runs, statuses, instanceCount, endRun, process } = await setup();
  try {
    const completed = await enable();
    const stopped = await enable();
    await fire();
    const blend = (await runs(completed))['Blend Batch']!;
    await endRun(blend, 'completed', [{ name: 'Yield', value: '9' }]);
    await endRun((await runs(stopped))['Blend Batch']!, 'stopped');
    await setRuntime(completed, { status: 'paused' });
    await setRuntime(stopped, { status: 'paused' });

    expect(await process()).toBe(2);

    expect(await statuses(completed)).toEqual({
      'Blend Batch': 'finished', 'Move Material': 'held', 'Lab Test': 'held', 'Clean Equipment': 'held',
    });
    expect(await statuses(stopped)).toEqual({
      'Blend Batch': 'finished', 'Move Material': 'not_triggered', 'Lab Test': 'not_triggered', 'Clean Equipment': 'held',
    });
    const after = await runs(completed);
    expect(after['Lab Test']).toMatchObject({ parentRunId: blend.id, workflowInstanceId: null });
    // Held chains do not depend on the history row staying.
    expect(after['Blend Batch']!.triggerValues).toMatchObject({ outputs: { Yield: '9' } });
    expect(await instanceCount()).toBe(2);
  } finally { await close(); }
});

test('§9.4 cancelled: children record cancelled, nothing is created', async () => {
  const { close, enable, fire, setRuntime, runs, statuses, instanceCount, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed');
    await setRuntime(id, { status: 'cancelled' });

    await process();

    expect(await statuses(id)).toEqual({
      'Blend Batch': 'finished', 'Move Material': 'cancelled', 'Lab Test': 'cancelled', 'Clean Equipment': 'cancelled',
    });
    expect((await runs(id))['Move Material']!.parentRunId).toBe((await runs(id))['Blend Batch']!.id);
    expect(await instanceCount()).toBe(1);
  } finally { await close(); }
});

test('§9.5 disabled: skipped_disabled, siblings start, and nothing is created below it', async () => {
  const { close, enable, fire, setDisabled, runs, statuses, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await setDisabled(id, 'Lab Test');
    await endRun((await runs(id))['Blend Batch']!, 'completed');

    await process();
    expect(await process()).toBe(0);

    expect(await statuses(id)).toEqual({
      'Blend Batch': 'finished', 'Move Material': 'started', 'Lab Test': 'skipped_disabled', 'Clean Equipment': 'started',
    });
    expect((await runs(id))['Lab Test']!.workflowInstanceId).toBeNull();
  } finally { await close(); }
});

test('the checks run in the table\'s order: not triggered, then disabled, then cancelled or paused', async () => {
  const { close, enable, fire, setDisabled, setRuntime, runs, statuses, endRun, process } = await setup();
  try {
    const cancelled = await enable();
    const paused = await enable();
    await fire();
    for (const id of [cancelled, paused]) {
      await setDisabled(id, 'Clean Equipment');
      await setDisabled(id, 'Move Material');
      await endRun((await runs(id))['Blend Batch']!, 'stopped');
    }
    await setRuntime(cancelled, { status: 'cancelled' });
    await setRuntime(paused, { status: 'paused' });
    await process();
    for (const id of [cancelled, paused]) {
      expect(await statuses(id)).toEqual({
        'Blend Batch': 'finished', 'Move Material': 'not_triggered', 'Lab Test': 'not_triggered', 'Clean Equipment': 'skipped_disabled',
      });
    }
  } finally { await close(); }
});

const NO_FALLBACK = [{
  workflow: { name: 'Blend Batch' },
  chain: [
    {
      workflow: { name: 'Lab Test' }, triggerOn: ['completed'],
      params: { Yield: { from: 'trigger.output', name: 'Yield' } },
      chain: [{ workflow: { name: 'Release Batch' }, triggerOn: ['completed', 'stopped', 'aborted', 'errored'] }],
    },
    { workflow: { name: 'Move Material' }, triggerOn: ['completed'] },
  ],
}];

test.each([
  ['no outputs at all', null],
  ['an output recorded as empty', [{ name: 'Yield', value: '' }]],
])('%s with no fallback: failed_to_start naming the parent run, its sibling still starts, nothing below', async (_name, outputs) => {
  const { close, enable, fire, runs, statuses, instanceCount, endRun, process } = await setup();
  try {
    const id = await enable(ONCE, NO_FALLBACK);
    await fire();
    const blend = (await runs(id))['Blend Batch']!;
    await endRun(blend, 'completed', outputs);

    await process();
    expect(await process()).toBe(0);

    const after = await runs(id);
    expect(after['Lab Test']).toMatchObject({
      status: 'failed_to_start', parentRunId: blend.id, workflowInstanceId: null,
      detail: `Yield has no value from ${blend.runtimeLabel}`,
    });
    expect(await statuses(id)).toEqual({
      'Blend Batch': 'finished', 'Lab Test': 'failed_to_start', 'Move Material': 'started',
    });
    expect(await instanceCount()).toBe(2);
  } finally { await close(); }
});

test('a resolved value over 10,000 characters: that child records failed_to_start, siblings start', async () => {
  const { close, enable, fire, runs, instanceOf, statuses, endRun, process } = await setup();
  try {
    const id = await enable(ONCE, NO_FALLBACK);
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed', [{ name: 'Yield', value: 'x'.repeat(10_001) }]);

    await process();

    const after = await runs(id);
    expect(after['Lab Test']).toMatchObject({ status: 'failed_to_start', workflowInstanceId: null });
    expect(after['Lab Test']!.detail).toContain('Yield exceeds length cap');
    expect(await statuses(id)).toMatchObject({ 'Move Material': 'started' });
    expect((await instanceOf(after['Move Material']!)).status).toBe('queued');
  } finally { await close(); }
});

test('a value of exactly 10,000 characters starts', async () => {
  const { close, enable, fire, statuses, runs, endRun, process } = await setup();
  try {
    const id = await enable(ONCE, NO_FALLBACK);
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed', [{ name: 'Yield', value: 'x'.repeat(10_000) }]);
    await process();
    expect((await statuses(id))['Lab Test']).toBe('started');
  } finally { await close(); }
});

test('running processEndedRuns twice creates no second run', async () => {
  const { close, enable, fire, runs, instanceCount, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed');
    expect(await process()).toBe(1);
    const count = await instanceCount();
    expect(await process()).toBe(0);
    expect(await instanceCount()).toBe(count);
  } finally { await close(); }
});

test('a run still going is left alone', async () => {
  const { close, enable, fire, statuses, process } = await setup();
  try {
    const id = await enable();
    await fire();
    expect(await process()).toBe(0);
    expect(await statuses(id)).toEqual({ 'Blend Batch': 'started' });
  } finally { await close(); }
});

test('a run that throws does not stop the others, stays started, and goes through once the fault clears', async () => {
  const { db, close, enable, fire, runs, statuses, endRun, process } = await setup();
  try {
    const bad = await enable();
    const good = await enable();
    await fire();
    const badRun = (await runs(bad))['Blend Batch']!;
    await endRun(badRun, 'completed');
    await endRun((await runs(good))['Blend Batch']!, 'completed');
    await db.execute(sql.raw(`create function fail_end() returns trigger language plpgsql as $$
      begin if new.id = '${badRun.id}' then raise exception 'cannot record this'; end if; return new; end $$`));
    await db.execute(sql.raw(`create trigger fail_end before update on schedule_item_run
      for each row execute function fail_end()`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await process()).toBe(1);
    expect(await statuses(bad)).toEqual({ 'Blend Batch': 'started' });
    expect((await statuses(good))['Blend Batch']).toBe('finished');

    expect(await process()).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);

    await db.execute(sql.raw('drop trigger fail_end on schedule_item_run'));
    expect(await process()).toBe(1);
    expect((await statuses(bad))['Blend Batch']).toBe('finished');
  } finally { await close(); }
});

test('a transient error on a child rolls the whole ending back, and a later tick carries it out once', async () => {
  const { db, close, enable, fire, runs, statuses, instanceCount, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await endRun((await runs(id))['Blend Batch']!, 'completed');
    await db.execute(sql.raw(`create function fail_run() returns trigger language plpgsql as $$
      begin raise exception 'raised on purpose' using errcode = '40P01'; end $$`));
    await db.execute(sql.raw(`create trigger fail_run before insert on workflow_instance
      for each row execute function fail_run()`));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await process()).toBe(0);
    expect(await statuses(id)).toEqual({ 'Blend Batch': 'started' });
    expect(await instanceCount()).toBe(1);

    await db.execute(sql.raw('drop trigger fail_run on workflow_instance'));
    expect(await process()).toBe(1);
    expect((await statuses(id))['Move Material']).toBe('started');
    expect(await instanceCount()).toBe(4);
  } finally { await close(); }
});

test('the Runtime row and the workflows of children about to start are locked before the first run, and no others', async () => {
  const { db, close, enable, fire, setDisabled, runs, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    await setDisabled(id, 'Move Material');
    await endRun((await runs(id))['Blend Batch']!, 'completed');
    await db.execute(sql.raw('create table lock_seen (name text primary key, locked boolean)'));
    await db.execute(sql.raw(`create function see_locks() returns trigger language plpgsql as $$
      begin
        insert into lock_seen select name, xmax::text = txid_current()::text from workflow on conflict do nothing;
        insert into lock_seen select 'the Runtime', xmax::text = txid_current()::text from runtime_schedule on conflict do nothing;
        return new;
      end $$`));
    await db.execute(sql.raw(`create trigger see_locks before insert on workflow_instance
      for each row execute function see_locks()`));

    await process();

    const seen = await db.execute(sql.raw('select name from lock_seen where locked'));
    expect((seen as any).rows.map((r: any) => r.name).sort()).toEqual(['Clean Equipment', 'Lab Test', 'the Runtime']);
  } finally { await close(); }
});

test('processEndedRuns takes at most 50 endings per call, oldest first', async () => {
  const { db, close, enable, fire, runs, itemsOf, occurrences, wc, process } = await setup();
  try {
    const id = await enable(HOURLY, [{ workflow: { name: 'Blend Batch' } }]);
    await fire();
    const [item] = await itemsOf(id);
    const { runtimeLabel } = (await runs(id))['Blend Batch']!;
    for (let k = 1; k <= 51; k++) {
      const [occ] = await db.insert(scheduleOccurrence).values({
        runtimeScheduleId: id, number: 1000 + k, scheduledAt: new Date(at('12:00', '20').getTime() + k * 60_000),
      }).returning();
      const workflowInstanceId = crypto.randomUUID();
      await db.insert(scheduleItemRun).values({
        occurrenceId: occ!.id, itemId: item!.id, status: 'started', workflowInstanceId, runtimeLabel,
      });
      await db.insert(runtimeHistory).values({
        workflowInstanceId, workCenterId: wc.id, workCenterName: 'Line 1', runtimeNumber: k, runtimeLabel: `R-${k}`,
        masterName: 'Blend Batch', masterOid: 'x', masterVersion: '1', masterState: 'Effective',
        finalState: 'completed', finishedAt: new Date(NOW.getTime() - k * 60_000), trace: [],
      });
    }
    expect(await occurrences(id)).toHaveLength(52);

    expect(await process()).toBe(50);
    // The newest ending, k = 1, waits for the next call.
    const [left] = await db.select({ number: scheduleOccurrence.number }).from(scheduleItemRun)
      .innerJoin(scheduleOccurrence, eq(scheduleOccurrence.id, scheduleItemRun.occurrenceId))
      .where(and(eq(scheduleItemRun.status, 'started'), eq(scheduleOccurrence.number, 1001)));
    expect(left).toEqual({ number: 1001 });
    expect(await process()).toBe(1);
  } finally { await close(); }
});

// ---------------------------------------------------------------- startChainItem, for held rows

/** A paused Blend Batch's Lab Test row, held; returns what catch-up would have in hand. */
async function heldLab(s: Awaited<ReturnType<typeof setup>>, outputs: unknown) {
  const id = await s.enable();
  await s.fire();
  await s.setRuntime(id, { status: 'paused' });
  await s.endRun((await s.runs(id))['Blend Batch']!, 'completed', outputs);
  await s.process();
  await s.setRuntime(id, { status: 'active' });
  const after = await s.runs(id);
  const runtime = await s.rowOf(id);
  const [occurrence] = await s.occurrences(id);
  const item = (await s.itemsOf(id)).find((i) => i.masterName === 'Lab Test')!;
  return { id, parent: after['Blend Batch']!, held: after['Lab Test']!, runtime, occurrence: occurrence!, item };
}

test('startChainItem starts a held row in place, keeping its id and parent, from the stored trigger values', async () => {
  const s = await setup();
  try {
    const { id, parent, held, runtime, occurrence, item } = await heldLab(s, [{ name: 'Yield', value: '77' }]);
    // The history row may be gone by the time of Resume.
    await s.db.delete(runtimeHistory);

    const status = await s.db.transaction((tx) =>
      startChainItem(tx as any, parent, item, chainContext(parent, runtime, occurrence)));

    expect(status).toBe('started');
    const row = (await s.runs(id))['Lab Test']!;
    expect(row).toMatchObject({ id: held.id, status: 'started', parentRunId: parent.id });
    const instance = await s.instanceOf(row);
    expect(row.runtimeLabel).toBe(instance.runtimeLabel);
    expect(instance).toMatchObject({
      scheduleItemRunId: held.id, scheduleLabel: 'RS-1 / occurrence 1',
      startingParams: { BatchId: 'B-88123', Yield: '77' },
    });
  } finally { await s.close(); }
});

test('startChainItem records failed_to_start on a held row, with the parent run\'s label', async () => {
  const s = await setup();
  try {
    const { id, parent, held, runtime, occurrence, item } = await heldLab(s, null);
    const failing = { ...item, params: { Yield: { from: 'trigger.output', name: 'Yield' } } };

    const status = await s.db.transaction((tx) =>
      startChainItem(tx as any, parent, failing, chainContext(parent, runtime, occurrence)));

    expect(status).toBe('failed_to_start');
    expect((await s.runs(id))['Lab Test']).toMatchObject({
      id: held.id, status: 'failed_to_start', workflowInstanceId: null,
      detail: `Yield has no value from ${parent.runtimeLabel}`,
    });
  } finally { await s.close(); }
});

test('startChainItem does not start a row that has moved on', async () => {
  const s = await setup();
  try {
    const { id, parent, held, runtime, occurrence, item } = await heldLab(s, null);
    await s.db.update(scheduleItemRun).set({ status: 'skipped_on_resume' }).where(eq(scheduleItemRun.id, held.id));
    const before = await s.instanceCount();

    const status = await s.db.transaction((tx) =>
      startChainItem(tx as any, parent, item, chainContext(parent, runtime, occurrence)));

    expect(status).toBe('skipped_on_resume');
    expect(await s.instanceCount()).toBe(before);
    expect((await s.statuses(id))['Lab Test']).toBe('skipped_on_resume');
  } finally { await s.close(); }
});

// ----------------------------------------------------------------------------------- lost runs

test('lost: a started row with no instance and no history is marked on the second look, not the first', async () => {
  const { db, close, enable, fire, runs, process } = await setup();
  try {
    const id = await enable();
    await fire();
    const blend = (await runs(id))['Blend Batch']!;
    await db.delete(workflowInstance).where(eq(workflowInstance.id, blend.workflowInstanceId!));

    expect(await markLostRuns(db as any, plusSeconds(blend.createdAt, 30))).toBe(0);
    expect((await runs(id))['Blend Batch']!.status).toBe('started');

    expect(await markLostRuns(db as any, plusSeconds(blend.createdAt, 61))).toBe(1);
    const after = (await runs(id))['Blend Batch']!;
    expect(after.status).toBe('lost');
    expect(after.detail).toBeTruthy();
    expect(after.finishedAt).toEqual(plusSeconds(blend.createdAt, 61));

    // Its chain does not fire, and it is not marked twice.
    expect(await process()).toBe(0);
    expect(Object.keys(await runs(id))).toEqual(['Blend Batch']);
    expect(await markLostRuns(db as any, plusSeconds(blend.createdAt, 200))).toBe(0);
  } finally { await close(); }
});

test('lost: a live instance, or a history row with its instance gone, is not lost', async () => {
  const { db, close, enable, fire, runs, statuses, endRun, process } = await setup();
  try {
    const id = await enable(ONCE, [{ workflow: { name: 'Blend Batch' } }, { workflow: { name: 'Move Material' } }]);
    await fire();
    const { 'Blend Batch': blend, 'Move Material': move } = await runs(id);
    await endRun(blend!, 'completed');
    await db.delete(workflowInstance).where(eq(workflowInstance.id, blend!.workflowInstanceId!));

    expect(await markLostRuns(db as any, plusSeconds(move!.createdAt, 120))).toBe(0);
    expect(await statuses(id)).toEqual({ 'Blend Batch': 'started', 'Move Material': 'started' });

    // Swept instance or not, the ending is still processed.
    expect(await process()).toBe(1);
    expect((await statuses(id))['Blend Batch']).toBe('finished');
  } finally { await close(); }
});

test('the tick looks for lost runs at most once a minute', async () => {
  const { db, close, enable, fire, runs, statuses } = await setup();
  try {
    const id = await enable(ONCE, [{ workflow: { name: 'Blend Batch' } }]);
    await fire();
    const blend = (await runs(id))['Blend Batch']!;
    await db.update(scheduleItemRun).set({ createdAt: at('08:00') }).where(eq(scheduleItemRun.id, blend.id));
    const t = at('10:00', '25');

    expect(await runScheduleTick(db as any, t)).toMatchObject({ lost: 0 });
    await db.delete(workflowInstance).where(eq(workflowInstance.id, blend.workflowInstanceId!));

    expect(await runScheduleTick(db as any, plusSeconds(t, 59))).toMatchObject({ lost: 0 });
    expect((await statuses(id))['Blend Batch']).toBe('started');

    expect(await runScheduleTick(db as any, plusSeconds(t, 60))).toMatchObject({ lost: 1 });
    expect((await statuses(id))['Blend Batch']).toBe('lost');
  } finally { await close(); }
});

// ----------------------------------------------------------------------------------- finishing

test('a once schedule stays active until the whole tree has ended, then finishes and drops its specs', async () => {
  const { db, close, enable, fire, rowOf, runs, itemsOf, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    const finish = () => finishCompletedSchedules(db as any, NOW);

    expect((await rowOf(id)).nextFireAt).toBeNull();
    expect(await finish()).toBe(0);

    await endRun((await runs(id))['Blend Batch']!, 'completed');
    await process();
    expect(await finish()).toBe(0);

    const r1 = await runs(id);
    await endRun(r1['Move Material']!, 'completed');
    await endRun(r1['Clean Equipment']!, 'completed');
    await process();
    expect(await finish()).toBe(0);

    await endRun(r1['Lab Test']!, 'completed', [{ name: 'Result', value: 'pass' }]);
    // Ended, but the ending is not processed yet: still open.
    expect(await finish()).toBe(0);
    await process();
    expect(await finish()).toBe(0);
    expect((await rowOf(id)).status).toBe('active');
    for (const i of await itemsOf(id)) expect(i.specJsonb).not.toBeNull();

    await endRun((await runs(id))['Release Batch']!, 'errored');
    await process();
    expect(await finish()).toBe(1);

    expect(await rowOf(id)).toMatchObject({ status: 'finished', endedAt: NOW });
    for (const i of await itemsOf(id)) expect(i.specJsonb).toBeNull();
    const events = await db.select().from(runtimeScheduleEvent).where(and(
      eq(runtimeScheduleEvent.runtimeScheduleId, id), eq(runtimeScheduleEvent.action, 'finished'),
    ));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorKind: 'system', actorId: null });

    expect(await finish()).toBe(0);
    // Frozen names stay for display.
    expect((await itemsOf(id)).map((i) => i.masterName).sort()).toEqual([...WORKFLOWS].sort());
  } finally { await close(); }
});

/** A once schedule whose only run has ended and been processed. */
async function endedOnce(s: Awaited<ReturnType<typeof setup>>) {
  const id = await s.enable(ONCE, [{ workflow: { name: 'Blend Batch' } }]);
  await s.fire();
  await s.endRun((await s.runs(id))['Blend Batch']!, 'completed');
  await s.process();
  return id;
}

test.each<[string, Partial<typeof runtimeSchedule.$inferInsert>, Partial<typeof runtimeSchedule.$inferInsert>]>([
  ['a pending missed window', { missedFrom: at('07:00'), missedTo: at('08:00') }, { missedFrom: null, missedTo: null }],
  ['a catch-up being carried out', { catchupMode: 'all' }, { catchupMode: null }],
  ['a slot still to come', { nextFireAt: at('08:00', '20') }, { nextFireAt: null }],
])('%s keeps a schedule open', async (_name, open, closed) => {
  const s = await setup();
  try {
    const id = await endedOnce(s);
    await s.setRuntime(id, open);
    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(0);
    expect((await s.rowOf(id)).status).toBe('active');
    await s.setRuntime(id, closed);
    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(1);
    expect((await s.rowOf(id)).status).toBe('finished');
  } finally { await s.close(); }
});

test.each(['held', 'start_requested'])('a %s row keeps a schedule open', async (status) => {
  const s = await setup();
  try {
    const id = await s.enable(ONCE, [{
      workflow: { name: 'Blend Batch' },
      chain: [{ workflow: { name: 'Move Material' }, triggerOn: ['completed'] }],
    }]);
    await s.fire();
    await s.setRuntime(id, { status: 'paused' });
    await s.endRun((await s.runs(id))['Blend Batch']!, 'completed');
    await s.process();
    const held = (await s.runs(id))['Move Material']!;
    expect(held.status).toBe('held');

    // Paused cannot go straight to finished (§6.5's table), held row or not.
    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(0);
    await s.db.update(scheduleItemRun).set({ status: 'skipped_on_resume' }).where(eq(scheduleItemRun.id, held.id));
    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(0);
    expect((await s.rowOf(id)).status).toBe('paused');

    await s.db.update(scheduleItemRun).set({ status }).where(eq(scheduleItemRun.id, held.id));
    await s.setRuntime(id, { status: 'active' });
    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(0);

    await s.db.update(scheduleItemRun).set({ status: 'skipped_on_resume' }).where(eq(scheduleItemRun.id, held.id));
    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(1);
  } finally { await s.close(); }
});

test('disabled and failed rows do not hold a schedule open, and a cancelled one is left alone', async () => {
  const s = await setup();
  try {
    const id = await s.enable(ONCE, NO_FALLBACK);
    const cancelled = await endedOnce(s);
    await s.setRuntime(cancelled, { status: 'cancelled' });
    await s.setDisabled(id, 'Move Material');
    await s.fire();
    await s.endRun((await s.runs(id))['Blend Batch']!, 'completed');
    await s.process();
    expect(await s.statuses(id)).toEqual({
      'Blend Batch': 'finished', 'Lab Test': 'failed_to_start', 'Move Material': 'skipped_disabled',
    });

    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(1);
    expect((await s.rowOf(id)).status).toBe('finished');
    expect(await s.rowOf(cancelled)).toMatchObject({ status: 'cancelled', endedAt: null });
  } finally { await s.close(); }
});

test('a finish that throws is logged and does not stop the others', async () => {
  const s = await setup();
  try {
    const bad = await endedOnce(s);
    const good = await s.enable(ONCE, [{ workflow: { name: 'Move Material' } }]);
    await s.fire();
    await s.endRun((await s.runs(good))['Move Material']!, 'completed');
    await s.process();
    await s.db.execute(sql.raw(`create function fail_finish() returns trigger language plpgsql as $$
      begin if new.id = '${bad}' then raise exception 'cannot finish this'; end if; return new; end $$`));
    await s.db.execute(sql.raw(`create trigger fail_finish before update on runtime_schedule
      for each row execute function fail_finish()`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await finishCompletedSchedules(s.db as any, NOW)).toBe(1);

    expect((await s.rowOf(good)).status).toBe('finished');
    expect((await s.rowOf(bad)).status).toBe('active');
    expect(log).toHaveBeenCalledTimes(1);
  } finally { await s.close(); }
});

test('the tick processes endings before firing and finishes after, reporting each', async () => {
  const { db, close, enable, fire, rowOf, runs, endRun } = await setup();
  try {
    const once = await enable(ONCE, [{ workflow: { name: 'Blend Batch' } }]);
    await fire();
    const hourly = await enable(HOURLY, [{ workflow: { name: 'Lab Test' } }]);
    await endRun((await runs(once))['Blend Batch']!, 'completed');
    const t = at('08:00');

    expect(await runScheduleTick(db as any, t)).toMatchObject({ chains: 1, catchup: 0, fired: 1, finished: 1 });

    expect((await rowOf(once)).status).toBe('finished');
    expect((await rowOf(hourly)).status).toBe('active');
  } finally { await close(); }
});

// ------------------------------------------------------------------------------- history record

test('deleteRuntimeHistory refuses a run whose ending is unprocessed, and works afterwards', async () => {
  const { db, close, enable, fire, runs, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    const history = await endRun((await runs(id))['Blend Batch']!, 'completed', [{ name: 'Yield', value: '5' }]);

    const err = await deleteRuntimeHistory(db as any, history.id).catch((e) => e);
    expect(err).toBeInstanceOf(DaoError);
    expect((err as DaoError).code).toBe('HISTORY_RUN_PENDING');
    expect(await db.select().from(runtimeHistory)).toHaveLength(1);

    await process();
    await deleteRuntimeHistory(db as any, history.id);
    expect(await db.select().from(runtimeHistory)).toHaveLength(0);
    expect((await runs(id))['Blend Batch']!.triggerValues).toMatchObject({ outputs: { Yield: '5' } });
  } finally { await close(); }
});

test('bulk purge skips a record whose ending is unprocessed, deletes the others, and counts only what it deleted', async () => {
  const { db, close, enable, fire, runs, wc, endRun, process } = await setup();
  try {
    const id = await enable();
    await fire();
    const pending = await endRun((await runs(id))['Blend Batch']!, 'completed', null, new Date('2026-01-01'));
    const plain = {
      workCenterId: wc.id, workCenterName: 'Line 1', runtimeNumber: 9, masterName: 'X', masterOid: 'x',
      masterVersion: '1', masterState: 'Effective', finalState: 'completed', trace: [],
    };
    const otherId = crypto.randomUUID();
    await db.insert(runtimeHistory).values([
      { ...plain, runtimeLabel: 'R-1', workflowInstanceId: otherId, finishedAt: new Date('2026-01-02') },
      // A record with no instance link at all still purges.
      { ...plain, runtimeLabel: 'R-2', workflowInstanceId: null, finishedAt: new Date('2026-01-03') },
    ]);
    const event = (workflowInstanceId: string) => ({
      workflowInstanceId, verb: 'stop', effect: 'request', fromStatus: 'running', toStatus: 'stopping',
      actorKind: 'system', actorLabel: 'test',
    });
    await db.insert(runtimeControlEvent).values([event(pending.workflowInstanceId!), event(otherId)]);
    const cutoff = { olderThan: new Date('2026-06-01') };

    expect(await countRuntimeHistoryBefore(db as any, cutoff)).toBe(2);
    expect(await countRuntimeHistoryBefore(db as any, { ...cutoff, workCenterId: wc.id })).toBe(2);
    expect(await purgeRuntimeHistory(db as any, cutoff)).toBe(2);

    expect((await db.select().from(runtimeHistory)).map((h) => h.id)).toEqual([pending.id]);
    // What belongs to the skipped record stays with it.
    const left = await db.select().from(runtimeControlEvent);
    expect(left.map((e) => e.workflowInstanceId)).toEqual([pending.workflowInstanceId]);

    await process();
    expect(await countRuntimeHistoryBefore(db as any, cutoff)).toBe(1);
    expect(await purgeRuntimeHistory(db as any, cutoff)).toBe(1);
    expect(await db.select().from(runtimeHistory)).toHaveLength(0);
  } finally { await close(); }
});
