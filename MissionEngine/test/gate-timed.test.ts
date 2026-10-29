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
//
// Timed GATE (spec 2026-10-13 §3.3-§3.5) through the real loop with a fake clock — the
// gate-execution.test.ts harness, copied (same not-imported convention as the other gate suites).
import { expect, test } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestPause, requestResume } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { runOnce } from '../src/loop.js';
import { submitUserAction } from '../src/core/submit.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function traceOf(db: any, instanceId: string): Promise<Array<[string | null, string, string | null | undefined]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.orderIndex));
  return rows.map((r: any) => [r.stepOid, r.state, r.error]);
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

function addSeconds(d: Date, secs: number): Date {
  return new Date(d.getTime() + secs * 1000);
}

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

/** START -> GATE(gate_config) -> END, with a Flag.Value property the condition modes read. */
function gateSpec(oid: string, gate_config: Record<string, unknown>) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
    value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
    steps: [
      step('s', 'START'),
      step('g', 'GATE', {
        gate_config,
        input_parameter_specifications: [{ id: 'f', default_value: 'Flag.Value', value_type: 'property' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
}

const gateTrace = async (db: any, id: string) => (await traceOf(db, id)).filter(([oid]) => oid === 'g');

test('timer: parks until the deadline, opens exactly at it, and records the cause', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const start = clock.now();
  const spec = gateSpec('wf-timer', { mode: 'timer', delay_seconds: 240 });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const parked = await stepRow(db, wi.id, 'g');
  expect(parked.state).toBe('WAITING_GATE');
  expect(new Date(parked.startedAt).getTime()).toBe(start.getTime());
  expect(new Date(parked.wakeAt).getTime()).toBe(addSeconds(start, 240).getTime());

  clock.advance(239);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');

  clock.advance(1);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(await gateTrace(db, wi.id)).toEqual([
    ['g', 'EXECUTING', null], ['g', 'OPENED', 'timer (4 min)'], ['g', 'COMPLETED', null],
  ]);
  await close();
});

test('condition_or_timer: re-checks on its cycle, never sleeps past the deadline, opens on the timer', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const start = clock.now();
  const spec = gateSpec('wf-cot-timer', { mode: 'condition_or_timer', delay_seconds: 5, cycle_seconds: 2, source: 'return f === "open";' });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect(new Date((await stepRow(db, wi.id, 'g')).wakeAt).getTime()).toBe(addSeconds(start, 2).getTime());

  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  expect(new Date((await stepRow(db, wi.id, 'g')).wakeAt).getTime()).toBe(addSeconds(start, 4).getTime());

  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  // min(now + 2 = start+6, deadline = start+5)
  expect(new Date((await stepRow(db, wi.id, 'g')).wakeAt).getTime()).toBe(addSeconds(start, 5).getTime());

  clock.advance(1);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(await gateTrace(db, wi.id)).toEqual([
    ['g', 'EXECUTING', null], ['g', 'OPENED', 'timer (5 s)'], ['g', 'COMPLETED', null],
  ]);
  await close();
});

test('condition_or_timer: the condition opens it before the deadline', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = gateSpec('wf-cot-cond', { mode: 'condition_or_timer', delay_seconds: 600, cycle_seconds: 2, source: 'return f === "open";' });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  await db.update(workflowInstance).set({ propertyStore: { 'Flag.Value': 'open' } }).where(eq(workflowInstance.id, wi.id));
  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect(await gateTrace(db, wi.id)).toEqual([
    ['g', 'EXECUTING', null], ['g', 'OPENED', 'condition'], ['g', 'COMPLETED', null],
  ]);
  await close();
});

test('condition_or_timer: a script error before the deadline still fails the step', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = gateSpec('wf-cot-err', { mode: 'condition_or_timer', delay_seconds: 600, source: 'throw new Error("boom");' });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  expect((await stepRow(db, wi.id, 'g')).state).toBe('ERRORED');
  await close();
});

test('a plain condition gate writes no OPENED row (unchanged trace)', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = gateSpec('wf-plain', { cycle_seconds: 2, source: 'return true;' });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect(await gateTrace(db, wi.id)).toEqual([['g', 'EXECUTING', null], ['g', 'COMPLETED', null]]);
  await close();
});

test('pause past the deadline: resume opens the timer gate', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = gateSpec('wf-pause-past', { mode: 'timer', delay_seconds: 10 });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  clock.advance(20);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused'); // gates never evaluate while paused
  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('pause short of the deadline: resume re-arms the timer to its deadline (wall clock)', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const start = clock.now();
  const spec = gateSpec('wf-pause-short', { mode: 'timer', delay_seconds: 100 });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  clock.advance(10);
  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, deps);
  const row = await stepRow(db, wi.id, 'g');
  expect(row.state).toBe('WAITING_GATE');
  expect(new Date(row.wakeAt).getTime()).toBe(addSeconds(start, 100).getTime());
  clock.advance(90);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('expired bound gate opens without fetching (no action client configured)', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  // testDeps uses nullActionInvoker: a property fetch here would FAIL the gate (fetch error =
  // evaluation error), so a completed instance proves the expired path skipped the fetch.
  const deps = testDeps({ now: clock.now });
  const spec = gateSpec('wf-bound-expired', {
    mode: 'condition_or_timer', delay_seconds: 3, cycle_seconds: 60, source: 'return false;',
    action_property_bindings: [{ parameter_id: 'f', environment_oid: 'env-x', property: 'P.V' }],
  });
  const wi = await seedQueued(db, spec, spec.oid);
  // A bound gate parks with wake_at = now, and its first due pickup WOULD fetch — and fail the
  // gate. runOnce does exactly one unit of work (loop.ts runOneUnit), so step one unit at a
  // time and stop the moment the gate parks, before any due pickup; then move started_at back
  // past the deadline.
  for (let i = 0; i < 50; i++) {
    if ((await stepRow(db, wi.id, 'g'))?.state === 'WAITING_GATE') break;
    await runOnce(db, deps);
  }
  const parked = await stepRow(db, wi.id, 'g');
  expect(parked.state).toBe('WAITING_GATE');
  await db.update(stepInstance).set({ startedAt: addSeconds(clock.now(), -10), wakeAt: clock.now() })
    .where(eq(stepInstance.id, parked.id));
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('loop re-entry (GOTO): the timer re-anchors to the new started_at and waits the full delay again', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = {
    local_id: 'wf', oid: 'wf-timer-loop', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
    environment_specifications: [{
      local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
      included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
    }],
    steps: [
      step('s', 'START'),
      step('g', 'GATE', { gate_config: { mode: 'timer', delay_seconds: 60 } }),
      step('t', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' }, try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      step('e', 'END'),
      step('c1', 'CATCH', { catch_id: 'C1' }),
      step('r1', 'RETURN', { return_config: { command: 'GOTO', goto_step_oid: 'g' } }),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 't' },
      { from_step_id: 't', to_step_id: 'e' }, { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const first = await stepRow(db, wi.id, 'g');
  expect(first.state).toBe('WAITING_GATE');

  clock.advance(60);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 't')).state).toBe('WAITING_ACTION'); // pass 1: the timer opened

  clock.advance(30); // re-enter 30 s later
  const reentry = clock.now();
  await submitUserAction(db, wi.id, { step_oid: 't', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  const again = await stepRow(db, wi.id, 'g');
  expect(again.state).toBe('WAITING_GATE'); // not opening immediately
  expect(new Date(again.startedAt).getTime()).toBe(reentry.getTime());
  expect(new Date(again.wakeAt).getTime()).toBe(addSeconds(reentry, 60).getTime());

  clock.advance(59);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');
  clock.advance(1);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('COMPLETED');
  await close();
});
