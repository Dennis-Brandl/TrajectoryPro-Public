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

// A work center with an enabled hourly Runtime Schedule, for the control and catch-up tests. Time
// is whatever each call is told: nothing reads the clock, so the spec's timelines can be replayed.

import { and, asc, eq } from 'drizzle-orm';
import { makeTestDb } from './db.js';
import {
  workCenter, workflow, workflowInstance, runtimeHistory, runtimeSchedule, runtimeScheduleItem,
  runtimeScheduleEvent, scheduleOccurrence, scheduleItemRun, type ScheduleItemRun,
} from '../../src/db/schema/index.js';
import { createMasterSchedule } from '../../src/scheduling/master-dao.js';
import { enableMasterSchedule } from '../../src/scheduling/enable.js';
import { runScheduleTick } from '../../src/scheduling/tick.js';

export const ENABLED_AT = new Date('2026-11-08T12:00:00Z');
export const at = (hhmm: string, day = '09') => new Date(`2026-11-${day}T${hhmm}:00Z`);
export const HOURLY = { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T01:00' };
export const person = { kind: 'api_client', clientId: 'e0000000-0000-4000-8000-000000000001', name: 'ERP' } as const;

const WORKFLOWS = ['Blend Batch', 'Move Material', 'Clean Equipment', 'Lab Test'];
const specOf = (name: string) => ({
  oid: `wf-${name}`, local_id: name,
  starting_parameter_specifications: [{ id: 'BatchId', value_type: 'literal', default_value: '' }],
  output_parameter_specifications: [{ id: 'Yield' }],
  steps: [{ local_id: 'Only', oid: `s-${name}`, step_type: 'START' }],
  connections: [],
});

/** §9.3: Blend Batch, chained to Move Material and Clean Equipment. */
export const TREE = [{
  workflow: { name: 'Blend Batch' },
  params: { BatchId: { from: 'occurrence.datetime' } },
  chain: [
    {
      workflow: { name: 'Move Material' }, triggerOn: ['completed'],
      params: { BatchId: { from: 'trigger.input', name: 'BatchId' } },
    },
    {
      workflow: { name: 'Clean Equipment' }, triggerOn: ['completed'],
      params: { BatchId: { from: 'trigger.input', name: 'BatchId' } },
    },
  ],
}];
export const BLEND_ONLY = [{ workflow: { name: 'Blend Batch' }, params: { BatchId: { from: 'occurrence.datetime' } } }];

export async function setupSchedules() {
  const t = await makeTestDb();
  const db = t.db as any;
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1', timeZone: 'UTC' }).returning();
  for (const name of WORKFLOWS) {
    await t.db.insert(workflow).values({
      oid: `wf-${name}`, name, workCenterId: wc!.id, version: '1.0.0', state: 'Effective', specJsonb: specOf(name),
    });
  }
  let n = 0;
  const enable = async (recurrence: unknown = HOURLY, items: unknown[] = TREE) => {
    const m = await createMasterSchedule(db, wc!.id, { name: `Sched ${++n}`, recurrence, items }, person);
    const { runtime } = await enableMasterSchedule(db, m.id, person, ENABLED_AT);
    return runtime.id;
  };
  const rowOf = async (id: string) =>
    (await t.db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, id)))[0]!;
  const setRuntime = (id: string, values: Partial<typeof runtimeSchedule.$inferInsert>) =>
    t.db.update(runtimeSchedule).set(values).where(eq(runtimeSchedule.id, id));
  const itemsOf = (id: string) => t.db.select().from(runtimeScheduleItem)
    .where(eq(runtimeScheduleItem.runtimeScheduleId, id));
  const itemNamed = async (id: string, name: string) => (await itemsOf(id)).find((i) => i.masterName === name)!;
  const occurrences = (id: string) => t.db.select().from(scheduleOccurrence)
    .where(eq(scheduleOccurrence.runtimeScheduleId, id)).orderBy(asc(scheduleOccurrence.scheduledAt));
  const slotTimes = async (id: string) => (await occurrences(id)).map((o) => o.scheduledAt.toISOString());
  /** The item runs of one occurrence of a Runtime, by workflow name. */
  const runs = async (id: string, occurrenceIndex = 0): Promise<Record<string, ScheduleItemRun>> => {
    const occ = (await occurrences(id))[occurrenceIndex]!;
    const items = await itemsOf(id);
    const rows = await t.db.select().from(scheduleItemRun).where(eq(scheduleItemRun.occurrenceId, occ.id));
    return Object.fromEntries(rows.map((r) => [items.find((i) => i.id === r.itemId)!.masterName, r]));
  };
  const statuses = async (id: string, occurrenceIndex = 0) =>
    Object.fromEntries(Object.entries(await runs(id, occurrenceIndex)).map(([k, r]) => [k, r.status]));
  const instanceOf = async (run: ScheduleItemRun) =>
    (await t.db.select().from(workflowInstance).where(eq(workflowInstance.id, run.workflowInstanceId!)))[0]!;
  /** Every run created, in the order it was queued. */
  const queue = () => t.db.select({
    name: workflowInstance.masterName, params: workflowInstance.startingParams, status: workflowInstance.status,
  }).from(workflowInstance).orderBy(asc(workflowInstance.queuedAt));
  /** What settleTerminal leaves behind: the history row is the proof of an ending. */
  const endRun = async (run: ScheduleItemRun, finishedAt: Date, finalState = 'completed') => {
    const i = await instanceOf(run);
    await t.db.insert(runtimeHistory).values({
      workflowInstanceId: i.id, workCenterId: wc!.id, workCenterName: 'Line 1',
      runtimeNumber: i.runtimeNumber, runtimeLabel: i.runtimeLabel,
      masterName: i.masterName, masterOid: i.masterOid, masterVersion: i.masterVersion, masterState: i.masterState,
      finalState, finishedAt, startingParams: i.startingParams, trace: [],
    });
  };
  const events = (id: string, action: string) => t.db.select().from(runtimeScheduleEvent)
    .where(and(eq(runtimeScheduleEvent.runtimeScheduleId, id), eq(runtimeScheduleEvent.action, action)));
  const tick = (now: Date) => runScheduleTick(db, now);
  return {
    ...t, db, rawDb: t.db, wc: wc!, enable, rowOf, setRuntime, itemsOf, itemNamed, occurrences, slotTimes, runs,
    statuses, instanceOf, queue, endRun, events, tick,
  };
}
export type Schedules = Awaited<ReturnType<typeof setupSchedules>>;
