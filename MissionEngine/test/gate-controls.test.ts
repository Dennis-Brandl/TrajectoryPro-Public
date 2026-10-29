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
// Task 4: control-verb and reset dispositions for gates (spec 2026-08-29 §5.7) — stop cancels a
// waiting gate outright (a poller with nothing external to drain, same convention as a
// never-started READY step or a parked WAITING_USER row), abort flips it ABORTED with trace like
// any other active row, pause freezes evaluation (a gate can NEVER itself reach PAUSED — see
// control.ts's runResuming invariant comment; runPausing only ever selects WAITING_ACTION action
// rows) with resume re-arming every parked gate due-now so the first re-evaluation is immediate,
// and RETURN ABANDON's active-row sweep idles a waiting gate exactly like any other active step.
// Driven via the real mission-control-db runtime-control DAOs (controls.test.ts's own pattern)
// rather than hand-seeded transitional statuses, since these are end-to-end verb round trips.
import { expect, test } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestStop, requestAbort, requestPause, requestResume } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
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

/** Same mutable fake-clock pattern as gate-execution.test.ts's own makeClock. */
function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

// START -> GATE(reads Flag.Value on a 2s cycle) -> END — same shape as gate-execution.test.ts's
// own GATE_SPEC: parked CLOSED (Flag.Value = 'closed') until the property flips to 'open'.
function gateSpec(oid: string) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    schemaVersion: '5.0',
    value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
    steps: [
      step('s', 'START'),
      step('g', 'GATE', {
        gate_config: { cycle_seconds: 2, source: 'return f === "open";' },
        input_parameter_specifications: [{ id: 'f', default_value: 'Flag.Value', value_type: 'property' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
}

// ── STOP: cancels a waiting gate outright, no trace, wake_at cleared ──

test('stop cancels a waiting gate outright — no trace row, wake_at cleared, instance settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = gateSpec('wf-gate-stop');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');

  await requestStop(db, wi.id);
  await pumpUntilQuiet(db, deps);

  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('CANCELLED');
  expect(gate.wakeAt).toBeNull();
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');

  // CANCELLED is queue-vocabulary-only (no reference StepState for it) — only the original park
  // trace (EXECUTING) exists for 'g', nothing new was recorded for the cancellation itself.
  const gateTrace = (await traceOf(db, wi.id)).filter(([oid]) => oid === 'g');
  expect(gateTrace).toEqual([['g', 'EXECUTING', null]]);
  await close();
});

// ── ABORT: flips a waiting gate ABORTED with trace ──

test('abort flips a waiting gate ABORTED with trace, instance settles aborted', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = gateSpec('wf-gate-abort');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');

  await requestAbort(db, wi.id);
  await pumpUntilQuiet(db, deps);

  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('ABORTED');
  expect(gate.wakeAt).toBeNull();
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['g', 'ABORTED', null]);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  await close();
});

// ── PAUSE/RESUME: the Task 3 deferred test — a paused instance never evaluates; resume is
// immediate. A gate can never itself reach PAUSED (runPausing only ever selects WAITING_ACTION
// action rows — control.ts's runResuming invariant comment), so with no action steps in this
// spec the pausing pass has nothing to do and settles 'paused' immediately, leaving the gate row
// exactly as it was. ──

test('paused instance never evaluates a due gate; resume re-arms it for IMMEDIATE re-evaluation', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const start = clock.now();
  const spec = gateSpec('wf-gate-pause');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const parked = await stepRow(db, wi.id, 'g');
  expect(parked.state).toBe('WAITING_GATE');
  expect(new Date(parked.wakeAt).getTime()).toBe(addSeconds(start, 2).getTime());

  // requestPause + pump (control pass): nothing to pause (no WAITING_ACTION rows) — the instance
  // settles 'paused' immediately, and the gate row is left completely untouched (wake_at still
  // 2s out — pausing never touches a gate's own timer; only resuming does).
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  const stillParked = await stepRow(db, wi.id, 'g');
  expect(stillParked.state).toBe('WAITING_GATE');
  expect(new Date(stillParked.wakeAt).getTime()).toBe(addSeconds(start, 2).getTime());

  // Flip the input property mid-pause, then advance the clock by LESS than the remaining cycle
  // (1s of the 2s) — deliberately NOT past the original wake_at. Advancing past it would make the
  // row's own wake_at already due by resume time regardless of any fix, which would fail to
  // distinguish "resume re-arms wake_at=now" from "the original timer simply came due on its
  // own" — test/gate-execution.test.ts's own §6.2 status-filter test already covers the
  // separate "still overdue while paused" half of this story (processDueGateWork returns false
  // on a paused instance); this test's job is the immediate-on-resume half.
  await db.update(workflowInstance).set({ propertyStore: { 'Flag.Value': 'open' } }).where(eq(workflowInstance.id, wi.id));
  clock.advance(1);
  await pumpUntilQuiet(db, deps);

  // Paused instance never evaluates, even once the property would make it open.
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');

  // Resume WITHOUT advancing the clock any further — the original wake_at (t+2s) is still ONE
  // full second in the future (now sits at t+1s). Only runResuming's own `wake_at = now` re-arm
  // can make the very next pump evaluate the gate immediately; absent it, the gate would sit
  // WAITING_GATE for another full second (out to the original cycle boundary) before anything
  // would ever re-evaluate it.
  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('COMPLETED');
  await close();
});

// ── RETURN ABANDON: sweeps a waiting gate exactly like any other active row ──
//
// Same PARALLEL-into-TRY-wrapped-trigger + independent-sibling shape as try-catch.test.ts's own
// branchSpec('ABANDON') test, swapping the USER_INTERACTION sibling for a GATE (closed forever)
// so the returnAbandon active-row sweep (transition.ts) is exercised against a WAITING_GATE row.

const ABANDON_ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];

const ABANDON_SPEC = {
  local_id: 'wf', oid: 'wf-gate-abandon', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ABANDON_ENV_SPECS,
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    step('trigger', 'ACTION PROXY', {
      action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' },
      try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
    }),
    step('g', 'GATE', { gate_config: { cycle_seconds: 2, source: 'return false;' } }),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
    step('c1', 'CATCH', { catch_id: 'C1' }),
    step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'trigger' },
    { from_step_id: 'p1', to_step_id: 'g' },
    { from_step_id: 'trigger', to_step_id: 'wa' },
    { from_step_id: 'g', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
    { from_step_id: 'c1', to_step_id: 'r1' },
  ],
};

test('RETURN ABANDON sweeps a waiting gate: row deleted, traced IDLE, instance aborted', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, ABANDON_SPEC, ABANDON_SPEC.oid);
  await pumpUntilQuiet(db, deps);

  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');

  await submitUserAction(db, wi.id, { step_oid: 'trigger', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  const gate = await stepRow(db, wi.id, 'g');
  expect(gate).toBeUndefined(); // idled = row deleted (lazy materialization — no IDLE row state)
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['g', 'IDLE', null]);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');
  await close();
});
