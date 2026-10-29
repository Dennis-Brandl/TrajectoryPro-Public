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
// Task 10: routing (getRoutedConnections' four branches), WAIT ALL joins + the pre-activation
// sweep, WAIT ANY re-entry, and generic cycle re-entry. submitUserAction is exercised here only
// as the vehicle to complete a parked step (YES_NO / USER_INTERACTION gate) — its own contract
// (park/park-again, non-EXECUTING throw, NOT_RUNNING throw, pause/resume, resource block+
// release) is covered by test/submit.test.ts.
import { expect, test } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
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

type TraceTuple = [string, string, number | null];

async function traceOf(db: any, instanceId: string): Promise<TraceTuple[]> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.orderIndex));
  return rows.map((r: any): TraceTuple => [r.stepOid, r.state, r.afterAction ?? null]);
}

async function stepRow(db: any, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

// ── YES_NO routing: source_handle_id ──

const YESNO_HANDLE_SPEC = {
  local_id: 'wf', oid: 'wf-yn-handle', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('yn', 'YES_NO', { yes_no_config: { yes_value: 'true', no_value: 'false' } }),
    step('end-yes', 'END'),
    step('end-no', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'yn' },
    { from_step_id: 'yn', to_step_id: 'end-yes', source_handle_id: 'true' },
    { from_step_id: 'yn', to_step_id: 'end-no', source_handle_id: 'false' },
  ],
};

test('YES_NO routes via source_handle_id — yes branch', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, YESNO_HANDLE_SPEC, 'wf-yn-handle-yes');
  await pumpUntilQuiet(db, testDeps());
  await submitUserAction(db, wi.id, { step_oid: 'yn', action: 'button_press', button_output: 'true' }, 0, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const end = await stepRow(db, wi.id, 'end-yes');
  expect(end.state).toBe('COMPLETED');
  const noEnd = await stepRow(db, wi.id, 'end-no');
  expect(noEnd).toBeUndefined();
  await close();
});

test('YES_NO routes via source_handle_id — no branch', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, YESNO_HANDLE_SPEC, 'wf-yn-handle-no');
  await pumpUntilQuiet(db, testDeps());
  await submitUserAction(db, wi.id, { step_oid: 'yn', action: 'button_press', button_output: 'false' }, 0, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const end = await stepRow(db, wi.id, 'end-no');
  expect(end.state).toBe('COMPLETED');
  await close();
});

// ── YES_NO routing: legacy condition "True"/"False" ──

const YESNO_LEGACY_SPEC = {
  local_id: 'wf', oid: 'wf-yn-legacy', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('yn', 'YES_NO', { yes_no_config: { yes_value: 'true', no_value: 'false' } }),
    step('end-yes', 'END'),
    step('end-no', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'yn' },
    { from_step_id: 'yn', to_step_id: 'end-yes', condition: 'True' },
    { from_step_id: 'yn', to_step_id: 'end-no', condition: 'False' },
  ],
};

test('YES_NO routes via legacy condition "True"/"False" with button_output:"true"', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, YESNO_LEGACY_SPEC, 'wf-yn-legacy');
  await pumpUntilQuiet(db, testDeps());
  await submitUserAction(db, wi.id, { step_oid: 'yn', action: 'button_press', button_output: 'true' }, 0, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const end = await stepRow(db, wi.id, 'end-yes');
  expect(end.state).toBe('COMPLETED');
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['yn', 'COMPLETED', 0]);
  await close();
});

// ── SELECT 1 routing: connection_id, property input ──

const SELECT1_SPEC = {
  local_id: 'wf', oid: 'wf-select1', version: '1.0.0', last_modified_date: '2026-01-01',
  // A property, not a starting/queued-row seed: instance.ts's startInstanceFromQueued always
  // constructs a fresh PropertyStore (propertyStore: null) and populates it from
  // value_property_specifications / starting_parameter_specifications — a pre-seeded
  // workflow_instance.property_store column at queued-insert time is never read.
  value_property_specifications: [{ name: 'Status', entries: [{ name: 'Value', value: 'closed' }] }],
  steps: [
    step('s1', 'START'),
    step('sel', 'SELECT_1', {
      select1_config: {
        input_name: 'Status.Value',
        input_value_type: 'property',
        options: [
          { id: 'opt-open', label: 'Open', operator: '==', value: 'open', value_type: 'literal', is_default: false },
          { id: 'opt-closed', label: 'Closed', operator: '==', value: 'closed', value_type: 'literal', is_default: false },
        ],
      },
    }),
    step('end-open', 'END'),
    step('end-closed', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'sel' },
    { from_step_id: 'sel', to_step_id: 'end-open', connection_id: 'opt-open' },
    { from_step_id: 'sel', to_step_id: 'end-closed', connection_id: 'opt-closed' },
  ],
};

test('SELECT 1 routes by connection_id, reading a property input', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SELECT1_SPEC, 'wf-select1');
  await pumpUntilQuiet(db, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const openEnd = await stepRow(db, wi.id, 'end-open');
  expect(openEnd).toBeUndefined();
  const closedEnd = await stepRow(db, wi.id, 'end-closed');
  expect(closedEnd.state).toBe('COMPLETED');
  await close();
});

// ── PARALLEL fan-out -> WAIT ALL (3-in), pre-activation path ──

function scriptStep(oid: string, propTarget: string): Record<string, unknown> {
  return step(oid, 'SCRIPT', {
    script_config: { source: `output.done = '${oid}';` },
    output_parameter_specifications: [{ id: 'done', target: propTarget }],
  });
}

const WAIT_ALL_3IN_SPEC = {
  local_id: 'wf', oid: 'wf-wait-all-3', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    scriptStep('b1', 'Result.B1'),
    scriptStep('b2', 'Result.B2'),
    scriptStep('b3', 'Result.B3'),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'b1' },
    { from_step_id: 'p1', to_step_id: 'b2' },
    { from_step_id: 'p1', to_step_id: 'b3' },
    { from_step_id: 'b1', to_step_id: 'wa' },
    { from_step_id: 'b2', to_step_id: 'wa' },
    { from_step_id: 'b3', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('PARALLEL fan-out (3 branches) joins at WAIT ALL exactly once, satisfied on first arrival', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, WAIT_ALL_3IN_SPEC, 'wf-wait-all-3');
  await pumpUntilQuiet(db, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');

  const waitAll = await stepRow(db, wi.id, 'wa');
  expect(waitAll.state).toBe('COMPLETED');

  // Task 13 fix (reference parity — see transition.ts's drainCascade doc comment): PARALLEL's
  // three SCRIPT siblings all auto-complete within the SAME BFS wave triggered by PARALLEL's
  // own completion (drainCascade eagerly activates every one of them before any of THEM gets
  // its own successor routing). By the time the first one (b1) routes to 'wa', b2 and b3 are
  // ALREADY COMPLETED in the DB — so 'wa's arrival is satisfied on its very FIRST touch and
  // skips the EXECUTING park entirely (reference engine.ts:1193-1195), exactly like
  // exec-parallel-002's vendored conformance fixture (two all-auto-complete SCRIPT siblings
  // under one PARALLEL never produce an EXECUTING trace for the join they feed — Task 13
  // post-review, M6: exec-parallel-003 is a DIFFERENT shape, three USER_INTERACTION siblings
  // that park, so its own WAIT ALL DOES get an EXECUTING trace; it does not support this
  // no-EXECUTING claim). A single COMPLETED entry — no double-fire regardless of which branch
  // happens to be first in declaration order.
  const trace = await traceOf(db, wi.id);
  const waTrace = trace.filter(([oid]) => oid === 'wa');
  expect(waTrace).toEqual([['wa', 'COMPLETED', null]]);

  for (const b of ['b1', 'b2', 'b3']) {
    const row = await stepRow(db, wi.id, b);
    expect(row.state).toBe('COMPLETED');
  }
  const end = await stepRow(db, wi.id, 'e1');
  expect(end.state).toBe('COMPLETED');
  await close();
});

// ── I1 (Important, proven by review): a WAIT ALL discovered already-satisfied BY THE SWEEP
// must still record EXECUTING before COMPLETED ──
//
// Getting the SWEEP (not arrival) to be the first-ever toucher of a wait-all AND find every
// incoming source already COMPLETED is trickier than it looks: activatePendingWaitAlls runs
// after literally every step's own routing, and its "allStarted" check only needs a ROW (any
// state), not completion — so almost any construction where one predecessor's completion
// creates the OTHER's row hits a PREMATURE sweep the instant that row merely exists (not yet
// completed). The one mechanism that resolves BOTH sides atomically, with no intermediate
// row-creation event, is a sync resource: y sends on Chan, z receives — `resources.ts`'s
// `send()`/`receive()` grant BOTH parties in the SAME call the instant the second one shows up
// (whichever of y/z is picked first simply blocks; the second one's activation attempt
// resolves the match synchronously and queues a grant for the first). y and z are both
// created directly from START (instance.ts's own routing never sweeps), and neither ever
// blocking calls routeSuccessors — so the FIRST sweep call in the whole trace is the one
// nested inside the LAST resumeGrantedSteps cascade, by which point both y and z already show
// 'COMPLETED' in the DB. Neither y nor z ever routes to wa directly (both are SELECT 1 with a
// single default option pointing elsewhere) — wa's only edges from them are unchosen.
const WAIT_ALL_SWEEP_SATISFIED_SPEC = {
  local_id: 'wf', oid: 'wf-wait-all-sweep-satisfied', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Chan', resource_type: 'sync' }],
  steps: [
    step('s1', 'START'),
    step('y', 'SELECT_1', {
      resource_command_specifications: [{ command_type: 'Send', resource_name: 'Chan' }],
      select1_config: { options: [{ id: 'y-elsewhere', label: 'Y', operator: '==', value: '', value_type: 'literal', is_default: true }] },
    }),
    step('z', 'SELECT_1', {
      resource_command_specifications: [{ command_type: 'Receive', resource_name: 'Chan', target: 'Result.Z' }],
      select1_config: { options: [{ id: 'z-elsewhere', label: 'Z', operator: '==', value: '', value_type: 'literal', is_default: true }] },
    }),
    step('ysink', 'MATH'),
    step('zsink', 'MATH'),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'y' },
    { from_step_id: 's1', to_step_id: 'z' },
    { from_step_id: 'y', to_step_id: 'ysink', connection_id: 'y-elsewhere' },
    { from_step_id: 'y', to_step_id: 'wa' },
    { from_step_id: 'z', to_step_id: 'zsink', connection_id: 'z-elsewhere' },
    { from_step_id: 'z', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('I1: a WAIT ALL discovered already-satisfied by the pre-activation sweep still records EXECUTING before COMPLETED', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, WAIT_ALL_SWEEP_SATISFIED_SPEC, 'wf-wait-all-sweep-satisfied');
  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');

  const y = await stepRow(db, wi.id, 'y');
  expect(y.state).toBe('COMPLETED');
  const z = await stepRow(db, wi.id, 'z');
  expect(z.state).toBe('COMPLETED');
  const ysink = await stepRow(db, wi.id, 'ysink');
  expect(ysink.state).toBe('COMPLETED'); // y's actual chosen route — never touched wa directly
  const zsink = await stepRow(db, wi.id, 'zsink');
  expect(zsink.state).toBe('COMPLETED'); // z's actual chosen route — never touched wa directly

  const trace = await traceOf(db, wi.id);
  const waTrace = trace.filter(([oid]) => oid === 'wa');
  expect(waTrace).toEqual([['wa', 'EXECUTING', null], ['wa', 'COMPLETED', null]]);

  const wa = await stepRow(db, wi.id, 'wa');
  expect(wa.state).toBe('COMPLETED');
  const end = await stepRow(db, wi.id, 'e1');
  expect(end.state).toBe('COMPLETED');
  await close();
});

// ── I2a (Important): WAIT ALL first-arrival seeding, exercised via staggered branch lengths ──
//
// The existing 3-in test above lets 'wa's arrival satisfy it on the FIRST touch (all 3 siblings
// auto-complete within the same BFS wave, so the last-completing sibling's own arrival already
// sees the other two done). Staggering 'a' (1 hop) against 'b' (3 hops via c1/c2) forces the
// UNSATISFIED-first-touch arrival path instead: 'wa's incoming set is {a, b}, and b's chain
// (c1 -> c2 -> b) is still mid-cascade by the time 'a' routes to 'wa' — drainCascade's queue
// only reaches 'wa' via 'a's own routing (dequeued right after 'a' and its PARALLEL sibling
// 'c1' both complete within PARALLEL's own BFS wave), long before the sweep ever gets a chance
// to run (that only happens once the ENTIRE queue — including c1/c2/b's whole chain — drains).
const WAIT_ALL_STAGGERED_SPEC = {
  local_id: 'wf', oid: 'wf-wait-all-staggered', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('p1', 'PARALLEL'),
    scriptStep('a', 'Result.A'),
    step('c1', 'MATH'),
    step('c2', 'MATH'),
    scriptStep('b', 'Result.B'),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'a' },
    { from_step_id: 'p1', to_step_id: 'c1' },
    { from_step_id: 'c1', to_step_id: 'c2' },
    { from_step_id: 'c2', to_step_id: 'b' },
    { from_step_id: 'a', to_step_id: 'wa' },
    { from_step_id: 'b', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('I2a: a WAIT ALL first touched via direct arrival (staggered branch lengths beat the sweep) parks EXECUTING then joins on the later arrival', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, WAIT_ALL_STAGGERED_SPEC, 'wf-wait-all-staggered');
  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');

  const trace = await traceOf(db, wi.id);
  const waTrace = trace.filter(([oid]) => oid === 'wa');
  expect(waTrace).toEqual([['wa', 'EXECUTING', null], ['wa', 'COMPLETED', null]]);

  // wa's EXECUTING park lands two entries after 'a' completes, not immediately after: PARALLEL
  // activates BOTH its siblings ('a' and 'c1') within the SAME BFS wave before either gets its
  // own successor routed (drainCascade is breadth-first, matching the reference's own
  // drainCompletionQueue — see transition.ts's doc comment) — so 'c1' COMPLETED lands between
  // 'a' COMPLETED and 'wa's own EXECUTING park (which only happens once 'a' itself is dequeued
  // and its outgoing connection to 'wa' is routed). What still proves ARRIVAL (not the sweep)
  // touched it first: 'wa' parks strictly BEFORE 'b' — the far end of the 3-hop chain — ever
  // completes, and strictly before the sweep could have run (the sweep only fires once the
  // WHOLE queue, including c1/c2/b's chain, drains — see the header comment above).
  const waExecutingIndex = trace.findIndex(([oid, state]) => oid === 'wa' && state === 'EXECUTING');
  const aCompletedIndex = trace.findIndex(([oid, state]) => oid === 'a' && state === 'COMPLETED');
  const c1CompletedIndex = trace.findIndex(([oid, state]) => oid === 'c1' && state === 'COMPLETED');
  const bCompletedIndex = trace.findIndex(([oid, state]) => oid === 'b' && state === 'COMPLETED');
  expect(c1CompletedIndex).toBe(aCompletedIndex + 1); // PARALLEL's two siblings, same BFS wave
  expect(waExecutingIndex).toBe(c1CompletedIndex + 1); // then 'a' is dequeued, routing to 'wa'
  expect(bCompletedIndex).toBeGreaterThan(waExecutingIndex);

  const wa = await stepRow(db, wi.id, 'wa');
  expect(wa.state).toBe('COMPLETED');
  await close();
});

// ── I2b (Important, proven by review): WAIT ALL first-arrival seeds an already-COMPLETED
// predecessor via priorCompleted ──
//
// q is a SELECT 1 whose CHOSEN route goes to qsink, never to wa — it only appears in wa's
// `expected` set via the raw, unchosen q->wa connection, and completes long before 'p' does.
// p's OWN completion has TWO outgoing edges fired in the SAME transaction: p->wa (declared
// first) and p->c1 (continuing a staggered chain toward 'r', declared second) — so p's arrival
// at wa is guaranteed to happen before the c1/c2 chain ever produces a row for 'r', making it
// deterministically the join's FIRST touch regardless of any q/p1 top-level tiebreak. At that
// moment q is ALREADY COMPLETED — proving the priorCompleted DB query (not just the arriving
// sourceOid itself) is what finds it: completed = {q via query} ∪ {p as sourceOid}.
const WAIT_ALL_PRIOR_COMPLETED_SPEC = {
  local_id: 'wf', oid: 'wf-wait-all-prior-completed', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('q', 'SELECT_1', {
      select1_config: { options: [{ id: 'q-elsewhere', label: 'Q', operator: '==', value: '', value_type: 'literal', is_default: true }] },
    }),
    step('p1', 'PARALLEL'),
    step('p', 'MATH'),
    step('c1', 'MATH'),
    step('c2', 'MATH'),
    scriptStep('r', 'Result.R'),
    step('qsink', 'MATH'),
    step('wa', 'WAIT ALL'),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'q' },
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'q', to_step_id: 'qsink', connection_id: 'q-elsewhere' },
    { from_step_id: 'q', to_step_id: 'wa' },
    { from_step_id: 'p1', to_step_id: 'p' },
    { from_step_id: 'p', to_step_id: 'wa' },
    { from_step_id: 'p', to_step_id: 'c1' },
    { from_step_id: 'c1', to_step_id: 'c2' },
    { from_step_id: 'c2', to_step_id: 'r' },
    { from_step_id: 'r', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'e1' },
  ],
};

test('I2b: WAIT ALL first-arrival seeds an already-COMPLETED predecessor via priorCompleted', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, WAIT_ALL_PRIOR_COMPLETED_SPEC, 'wf-wait-all-prior-completed');
  await pumpUntilQuiet(db, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');

  const q = await stepRow(db, wi.id, 'q');
  expect(q.state).toBe('COMPLETED');
  const qsink = await stepRow(db, wi.id, 'qsink');
  expect(qsink.state).toBe('COMPLETED'); // q's actual chosen route — never touched wa directly

  // wa's expected set is {q, p, r} — q's OWN routing never targets wa (its chosen route is
  // qsink), so the ONLY way wa can ever reach 3/3 and complete is if priorCompleted's DB query
  // found q as already-COMPLETED at p's first-arrival touch. If that query were broken (or
  // returned nothing), wa would sit at completed={p} forever (then {p,r}) and NEVER join —
  // this test would hang at 'running' instead of reaching 'completed'.
  const wa = await stepRow(db, wi.id, 'wa');
  expect(wa.state).toBe('COMPLETED');

  // Confirm it really was ARRIVAL (p's own completion) that first touched wa, not the sweep:
  // wa's EXECUTING park is the VERY NEXT trace entry after p completes, with r joining later.
  const trace = await traceOf(db, wi.id);
  const waTrace = trace.filter(([oid]) => oid === 'wa');
  expect(waTrace).toEqual([['wa', 'EXECUTING', null], ['wa', 'COMPLETED', null]]);
  const waExecutingIndex = trace.findIndex(([oid, state]) => oid === 'wa' && state === 'EXECUTING');
  const pCompletedIndex = trace.findIndex(([oid, state]) => oid === 'p' && state === 'COMPLETED');
  const rCompletedIndex = trace.findIndex(([oid, state]) => oid === 'r' && state === 'COMPLETED');
  expect(waExecutingIndex).toBe(pCompletedIndex + 1);
  expect(rCompletedIndex).toBeGreaterThan(waExecutingIndex);

  const end = await stepRow(db, wi.id, 'e1');
  expect(end.state).toBe('COMPLETED');
  await close();
});

// ── WAIT ANY re-entry: second arrival re-fires downstream ──
//
// WAIT ANY has no special join-tracking of its own (unlike WAIT ALL) — it is just another
// auto-completing pass-through step (reference isAutoCompleting), so its "re-entry" behavior
// falls entirely out of the SAME generic cycle re-entry logic activateSuccessorStep already
// applies to any step: routing into an existing COMPLETED row resets it to READY, which a
// later pump re-processes and re-routes. A YES_NO loop-back gate drives a clean, deterministic
// SECOND arrival at WAIT ANY (rather than racing two PARALLEL branches against pump ordering).
const WAIT_ANY_SPEC = {
  local_id: 'wf', oid: 'wf-wait-any', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('m1', 'MATH'),
    step('wany', 'WAIT ANY'),
    step('gate', 'YES_NO', { yes_no_config: { yes_value: 'true', no_value: 'false' } }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'm1' },
    { from_step_id: 'm1', to_step_id: 'wany' },
    { from_step_id: 'wany', to_step_id: 'gate' },
    { from_step_id: 'gate', to_step_id: 'e1', source_handle_id: 'true' },
    { from_step_id: 'gate', to_step_id: 'm1', source_handle_id: 'false' },
  ],
};

test('WAIT ANY auto-completes on arrival and re-fires its downstream on a second (cycle-re-entered) arrival', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, WAIT_ANY_SPEC, 'wf-wait-any');
  await pumpUntilQuiet(db, testDeps());

  let gate = await stepRow(db, wi.id, 'gate');
  expect(gate.state).toBe('WAITING_USER');

  // "no" loops back through m1 -> wany -> gate again: m1 and wany (both COMPLETED) get reset
  // READY by generic cycle re-entry and re-fire, and gate parks a second time.
  await submitUserAction(db, wi.id, { step_oid: 'gate', action: 'button_press', button_output: 'false' }, 0, testDeps());

  gate = await stepRow(db, wi.id, 'gate');
  expect(gate.state).toBe('WAITING_USER');
  const [running] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(running.status).toBe('running');

  const trace = await traceOf(db, wi.id);
  const wanyCompleted = trace.filter(([oid, state]) => oid === 'wany' && state === 'COMPLETED');
  const gateExecuting = trace.filter(([oid, state]) => oid === 'gate' && state === 'EXECUTING');
  expect(wanyCompleted.length).toBe(2); // first pass, then re-fired by the loop-back
  expect(gateExecuting.length).toBe(2); // parked, then re-parked downstream of the re-fire

  // "yes" exits the loop.
  await submitUserAction(db, wi.id, { step_oid: 'gate', action: 'button_press', button_output: 'true' }, 1, testDeps());
  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const end = await stepRow(db, wi.id, 'e1');
  expect(end.state).toBe('COMPLETED');
  await close();
});

// ── Generic cycle re-entry: COMPLETED -> READY, driven through a YES_NO loop gate ──

const CYCLE_SPEC = {
  local_id: 'wf', oid: 'wf-cycle', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('s1', 'START'),
    step('m1', 'MATH'),
    step('gate', 'YES_NO', { yes_no_config: { yes_value: 'true', no_value: 'false' } }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'm1' },
    { from_step_id: 'm1', to_step_id: 'gate' },
    { from_step_id: 'gate', to_step_id: 'e1', source_handle_id: 'true' },
    { from_step_id: 'gate', to_step_id: 'm1', source_handle_id: 'false' },
  ],
};

test('cycle re-entry resets a COMPLETED step (and a parked step) back through the loop', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, CYCLE_SPEC, 'wf-cycle');
  await pumpUntilQuiet(db, testDeps());

  let gate = await stepRow(db, wi.id, 'gate');
  expect(gate.state).toBe('WAITING_USER');

  // First loop: "no" routes back to m1 (COMPLETED -> READY reset), which re-completes and
  // routes back to gate (also COMPLETED -> READY reset), which parks again.
  await submitUserAction(db, wi.id, { step_oid: 'gate', action: 'button_press', button_output: 'false' }, 0, testDeps());
  gate = await stepRow(db, wi.id, 'gate');
  expect(gate.state).toBe('WAITING_USER');
  let m1 = await stepRow(db, wi.id, 'm1');
  expect(m1.state).toBe('COMPLETED');

  const trace = await traceOf(db, wi.id);
  const m1Completed = trace.filter(([oid, state]) => oid === 'm1' && state === 'COMPLETED');
  const gateExecuting = trace.filter(([oid, state]) => oid === 'gate' && state === 'EXECUTING');
  expect(m1Completed.length).toBe(2); // completed once at start, reset+recompleted on the loop
  expect(gateExecuting.length).toBe(2); // parked once at start, reset+re-parked on the loop

  let [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('running');

  // Second submit exits the loop.
  await submitUserAction(db, wi.id, { step_oid: 'gate', action: 'button_press', button_output: 'true' }, 1, testDeps());
  [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  const end = await stepRow(db, wi.id, 'e1');
  expect(end.state).toBe('COMPLETED');
  await close();
});
