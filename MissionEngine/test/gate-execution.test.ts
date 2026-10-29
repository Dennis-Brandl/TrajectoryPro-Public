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
// Task 3: GATE execution — activation/park (transition.ts's activateGateStep), the sixth unit
// of work (core/gate.ts's processDueGateWork), and the claim-discrimination landmine (loop.ts's
// ne(stepType, 'GATE') on the due-action claim). Driven through the SAME fake-clock harness as
// test/action-execution.test.ts (makeClock) since GATE re-evaluation, like ACTION PROXY
// invoke/poll, is wake_at-driven.
import { expect, test, vi } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { processDueActionWork } from '../src/loop.js';
import { processDueGateWork } from '../src/core/gate.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { WorkflowContext } from '../src/core/context.js';

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

/** A mutable fake clock shared by `deps.now` and the test's own clock-advance calls — same
 *  pattern as test/action-execution.test.ts's makeClock. */
function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

// START -> GATE(reads Flag.Value on a 2s cycle) -> END, driven by a fake clock.
const GATE_SPEC = {
  local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
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

test('FALSE cycles then TRUE: a parked gate re-evaluates on its due cycle and completes once the property flips, with no extra trace rows for the idle wait', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const start = clock.now();

  const wi = await seedQueued(db, GATE_SPEC, GATE_SPEC.oid);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('running');
  const gateAfterPark = await stepRow(db, wi.id, 'g');
  expect(gateAfterPark.state).toBe('WAITING_GATE');
  expect(new Date(gateAfterPark.wakeAt).getTime()).toBe(addSeconds(start, 2).getTime());

  // First due cycle: the property is still 'closed' — evaluateGateOnClaim (core/gate.ts) must
  // re-evaluate FALSE, re-arm wake_at another 2s forward, and add NO new trace row.
  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  const gateAfterFalseCycle = await stepRow(db, wi.id, 'g');
  expect(gateAfterFalseCycle.state).toBe('WAITING_GATE');
  expect(new Date(gateAfterFalseCycle.wakeAt).getTime()).toBe(addSeconds(start, 4).getTime());

  // Flip the property directly (bypassing the engine) — the NEXT due evaluation must re-read it.
  await db.update(workflowInstance).set({ propertyStore: { 'Flag.Value': 'open' } }).where(eq(workflowInstance.id, wi.id));
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  const gateAfterOpen = await stepRow(db, wi.id, 'g');
  expect(gateAfterOpen.state).toBe('COMPLETED');

  // Exactly ONE EXECUTING (the initial park) and ONE COMPLETED — the intervening FALSE due
  // cycle above added no trace row of its own.
  const trace = await traceOf(db, wi.id);
  const gateTrace = trace.filter(([oid]) => oid === 'g');
  expect(gateTrace).toEqual([['g', 'EXECUTING', null], ['g', 'COMPLETED', null]]);
  await close();
});

test('immediate TRUE completes inline at activation — the gate never parks', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = {
    local_id: 'wf', oid: 'wf-immediate', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s', 'START'), step('g', 'GATE', { gate_config: { source: 'return true;' } }), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('COMPLETED');

  const trace = (await traceOf(db, wi.id)).filter(([oid]) => oid === 'g');
  expect(trace).toEqual([['g', 'EXECUTING', null], ['g', 'COMPLETED', null]]);
  await close();
});

test('no gate_config at all = pass-through TRUE (spec §4 optionality)', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-no-config', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s', 'START'), step('g', 'GATE'), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('a throwing gate script routes through TRY/CATCH like any other engine-originated failure', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-gate-catch', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step('s', 'START'),
      step('g', 'GATE', { gate_config: { source: 'throw new Error("boom");' }, try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      step('e', 'END'),
      step('c1', 'CATCH', { catch_id: 'C1' }),
      step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'g' },
      { from_step_id: 'g', to_step_id: 'e' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted');
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'g' && state === 'ERRORED')).toBe(false); // swallowed by the catch, never traced ERRORED
  await close();
});

test('a throwing gate script with no matching TRY errors the workflow and the gate row itself', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-gate-uncaught', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s', 'START'), step('g', 'GATE', { gate_config: { source: 'throw new Error("boom");' } }), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('errored');
  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('ERRORED');
  expect(gate.error).toContain('boom');
  await close();
});

test('a waiting gate blocks completion even after the sibling branch reaches END (spec §5.7)', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  // p1's SCRIPT branch is routed through a single-incoming WAIT ALL (trivially satisfied on
  // its own first — and only — arrival, per waitAllArrival above) purely to satisfy the
  // validator's UNMATCHED_PARALLEL rule (every PARALLEL must reach a WAIT ALL along SOME path);
  // it joins nothing else and behaves exactly like a passthrough to e1. The GATE branch is the
  // one actually under test: it never reaches wa/e1 at all.
  const spec = {
    local_id: 'wf', oid: 'wf-parallel-gate', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step('s', 'START'),
      step('p1', 'PARALLEL'),
      step('sc', 'SCRIPT'),
      step('wa', 'WAIT ALL'),
      step('e1', 'END'),
      step('g', 'GATE', { gate_config: { cycle_seconds: 2, source: 'return false;' } }),
      step('e2', 'END'),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'sc' },
      { from_step_id: 'p1', to_step_id: 'g' },
      { from_step_id: 'sc', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'e1' },
      { from_step_id: 'g', to_step_id: 'e2' },
    ],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const e1 = await stepRow(db, wi.id, 'e1');
  expect(e1.state).toBe('COMPLETED');
  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('WAITING_GATE');
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  await close();
});

// ── THE LANDMINE (spec §6.3): claim discrimination ──
//
// GATE spec 2026-08-29 §5.7 (amended, Task 4): gates never flip to PAUSED — a WAITING_GATE row
// stays WAITING_GATE for the whole pause, frozen by processDueGateWork's own status-gated claim
// (claimInstanceForWork(['running'])) rather than by a per-row state flip (contrast with
// WAITING_ACTION, which DOES move to PAUSED — control.ts's runPausing only ever selects action
// rows). The combination hand-crafted below (state PAUSED, step_type GATE, a due wake_at) is
// therefore never reachable in practice — it exists purely as a defensive probe: even if some
// future change DID somehow produce a PAUSED row of step_type GATE, this proves loop.ts's
// ne(stepType, 'GATE') guard on claimDueActionStep would still keep it from ever being selected.
//
// claimDueActionStep carries TWO independent copies of the guard — one on the dueCandidates
// (instance-selection) query, one on the dueRows (target-selection) query — and a single-row
// test pins them only JOINTLY: removing either one alone still leaves the OTHER to mask the
// bug (review finding, Important 1). The two tests below each isolate ONE guard.
async function seedPausedGateRow(db: any, wakeAt: Date): Promise<{ instanceId: string; stepInstanceId: string }> {
  const spec = {
    local_id: 'wf', oid: 'wf-paused-gate', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s', 'START'), step('g', 'GATE', { gate_config: { cycle_seconds: 2 } }), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'paused', queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  const [si] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'g', stepType: 'GATE',
    state: 'PAUSED', startedAt: new Date(), wakeAt,
  }).returning();
  return { instanceId: wi.id, stepInstanceId: si.id };
}

test('dueCandidates guard: an instance whose ONLY due row is a PAUSED gate row is never even claimed — updated_at stays untouched', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const { instanceId } = await seedPausedGateRow(db, new Date('2000-01-01T00:00:00.000Z')); // long overdue
  const before = await instanceRow(db, instanceId);

  const didActionWork = await processDueActionWork(db, deps);
  expect(didActionWork).toBe(false);

  // WITHOUT the dueCandidates guard, this GATE-only instance would still be selected as a
  // candidate (ACTIONABLE_STEP_STATES includes 'PAUSED', and 'paused' is a DUE_WORK_STATUSES
  // instance status) and CLAIMED — the still-guarded dueRows query would then find zero
  // actionable rows and hit the "raced" branch, which bumps updated_at (so claim ordering
  // doesn't head-of-line block) purely as a side effect of a claim that should never have
  // happened at all. A merely-non-null wake_at check on the step row would never catch this,
  // since the step row itself isn't touched by this particular guard's absence — only the
  // instance's own updated_at is.
  const after = await instanceRow(db, instanceId);
  expect(new Date(after.updatedAt).getTime()).toBe(new Date(before.updatedAt).getTime());
  await close();
});

/** Seeds ONE 'running' instance with two due, actionable rows on the SAME instance: a genuine
 *  WAITING_ACTION step (no action_proxy_config, so whichever row invokeDueStep resolves to
 *  hits its `!cfg` defensive branch and gets its wake_at nulled — deliberately, so the test
 *  needs no real action-server stub) and a synthetic PAUSED gate row with an OLDER wake_at than
 *  the action row's. Since both rows share one instance, the dueCandidates (instance-selection)
 *  guard makes no difference to which instance gets claimed here — the action row alone already
 *  qualifies it — so this scenario is sensitive ONLY to the dueRows (target-selection) guard. */
async function seedRacedActionAndGateRows(
  db: any, gateWakeAt: Date, actionWakeAt: Date,
): Promise<{ instanceId: string; actionRowId: string; gateRowId: string }> {
  const spec = {
    local_id: 'wf', oid: 'wf-race', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s', 'START'), step('act', 'ACTION PROXY'), step('g', 'GATE', { gate_config: { cycle_seconds: 2 } }), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'act' }, { from_step_id: 'act', to_step_id: 'e' }],
  };
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  const [actionRow] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act', stepType: 'ACTION PROXY',
    state: 'WAITING_ACTION', actionInstanceId: null, startedAt: new Date(), wakeAt: actionWakeAt,
  }).returning();
  const [gateRow] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'g', stepType: 'GATE',
    state: 'PAUSED', startedAt: new Date(), wakeAt: gateWakeAt,
  }).returning();
  return { instanceId: wi.id, actionRowId: actionRow.id, gateRowId: gateRow.id };
}

test('dueRows guard: with a due WAITING_ACTION row and an older-wake_at PAUSED gate row on the same instance, the action row is claimed — not the gate', async () => {
  const { db, close } = await makeTestDb();
  // A real ActionClient is required so deps.invoker.client is truthy (invokeDueStep's own
  // `if (!client) return` guard would otherwise short-circuit before reaching the `!cfg` branch
  // this test relies on) — but neither the client nor dbLookup is ever actually exercised: the
  // spec's ACTION PROXY step deliberately carries no action_proxy_config, so whichever row is
  // selected as the claim target hits the `!cfg` defensive branch and returns before any network
  // call or dbLookup would run.
  const client = new ActionClient(['http://127.0.0.1:1']);
  const deps = testDeps({ invoker: httpActionInvoker(client, async () => null) });
  const gateWakeAt = new Date('2000-01-01T00:00:00.000Z');
  const actionWakeAt = new Date('2000-01-01T00:05:00.000Z'); // later than the gate's
  const { actionRowId, gateRowId } = await seedRacedActionAndGateRows(db, gateWakeAt, actionWakeAt);

  const didWork = await processDueActionWork(db, deps);
  expect(didWork).toBe(true);

  const [actionRow] = await db.select().from(stepInstance).where(eq(stepInstance.id, actionRowId));
  const [gateRow] = await db.select().from(stepInstance).where(eq(stepInstance.id, gateRowId));

  // The action row was selected and processed — invokeDueStep's defensive `!cfg` branch nulled
  // its wake_at (proving it was picked as the claim target).
  expect(actionRow.wakeAt).toBeNull();
  // The gate row was NEVER selected — untouched, byte-for-byte. WITHOUT the dueRows guard,
  // orderBy(wakeAt) ASC would pick the OLDER gate row first instead, and THIS assertion is what
  // would catch it: the gate's wake_at would be null (processed by the same !cfg branch) rather
  // than surviving unchanged.
  expect(gateRow.wakeAt).not.toBeNull();
  expect(new Date(gateRow.wakeAt!).getTime()).toBe(gateWakeAt.getTime());
  await close();
});

test('processDueGateWork\'s own WAITING_GATE state predicate excludes a PAUSED gate row before claimInstanceForWork ever runs', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const { stepInstanceId } = await seedPausedGateRow(db, new Date('2000-01-01T00:00:00.000Z'));

  // A PAUSED-state row never even reaches processDueGateWork's dueCandidates query (it filters
  // on state === 'WAITING_GATE', not step_type alone) — this is a DIFFERENT guard than the
  // claimDueActionStep landmine above, and a different guard than the §6.2 status filter test
  // below: this one proves the STEP-level state predicate, not the INSTANCE-level status filter.
  const didGateWork = await processDueGateWork(db, deps);
  expect(didGateWork).toBe(false);

  const [row] = await db.select().from(stepInstance).where(eq(stepInstance.id, stepInstanceId));
  expect(row.state).toBe('PAUSED');
  expect(row.wakeAt).not.toBeNull();
  await close();
});

test('processDueGateWork §6.2 status filter: a due WAITING_GATE row under a non-running (paused) instance is never claimed', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = {
    local_id: 'wf', oid: 'wf-paused-instance-waiting-gate', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s', 'START'), step('g', 'GATE', { gate_config: { cycle_seconds: 2 } }), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'paused', queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  const overdue = new Date('2000-01-01T00:00:00.000Z');
  const [si] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'g', stepType: 'GATE',
    state: 'WAITING_GATE', startedAt: new Date(), wakeAt: overdue,
  }).returning();

  // This row PASSES processDueGateWork's own dueCandidates predicate (stepType GATE, state
  // WAITING_GATE, wake_at due) — the thing standing between it and evaluation is exclusively
  // `claimInstanceForWork(tx, ['running'], ...)`, the §6.2 status filter. Without it, this row
  // would be evaluated while paused, in direct violation of spec §5.7 ("observation does NOT
  // continue for gates while paused" — the opposite convention from action steps).
  const didGateWork = await processDueGateWork(db, deps);
  expect(didGateWork).toBe(false);

  const [row] = await db.select().from(stepInstance).where(eq(stepInstance.id, si.id));
  expect(row.state).toBe('WAITING_GATE');
  expect(new Date(row.wakeAt!).getTime()).toBe(overdue.getTime());
  const [afterInstance] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(new Date(afterInstance.updatedAt).getTime()).toBe(new Date(wi.updatedAt).getTime());
  await close();
});

// ── Mid-cycle GATE script failures (review Important 2): evaluateGateOnClaim's own failure
// branch (core/gate.ts) has different callers/context than activateGateStep's inline failure
// path exercised above — both existing error tests throw AT ACTIVATION (before the gate ever
// parks). These two throw on a LATER due-loop evaluation instead, so the gate parks CLOSED
// first, then a later cycle's script throws. ──

test('a gate script that throws MID-CYCLE (not at activation), with no matching TRY, errors the workflow via evaluateGateOnClaim\'s failure branch', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = {
    local_id: 'wf', oid: 'wf-gate-late-fail', version: '1.0.0', last_modified_date: '2026-01-01',
    value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
    steps: [
      step('s', 'START'),
      step('g', 'GATE', {
        gate_config: { cycle_seconds: 2, source: 'if (f === "boom") throw new Error("late"); return false;' },
        input_parameter_specifications: [{ id: 'f', default_value: 'Flag.Value', value_type: 'property' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  // Parked CLOSED at activation — f = 'closed', no throw yet.
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');

  // Flip to the value that makes the NEXT (due-loop) evaluation throw.
  await db.update(workflowInstance).set({ propertyStore: { 'Flag.Value': 'boom' } }).where(eq(workflowInstance.id, wi.id));
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('errored');
  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('ERRORED');
  expect(gate.error).toContain('late');
  await close();
});

test('a gate script that throws MID-CYCLE with a matching TRY ERROR routes through CATCH/RETURN(COMPLETE), covering the !settled -> settleIfComplete leg', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const spec = {
    local_id: 'wf', oid: 'wf-gate-late-catch', version: '1.0.0', last_modified_date: '2026-01-01',
    value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
    steps: [
      step('s', 'START'),
      step('g', 'GATE', {
        gate_config: { cycle_seconds: 2, source: 'if (f === "boom") throw new Error("late"); return false;' },
        input_parameter_specifications: [{ id: 'f', default_value: 'Flag.Value', value_type: 'property' }],
        try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
      }),
      step('e', 'END'),
      step('c1', 'CATCH', { catch_id: 'C1' }),
      // COMPLETE (not ABANDON): failStep's own cascade does NOT itself settle the instance
      // terminal for a simple COMPLETE-then-reach-END chain (dispatchReturn's settledTerminal
      // stays false), so evaluateGateOnClaim's `settled` comes back false and its own
      // `if (!settled) await settleIfComplete(...)` call is what actually detects completion —
      // exactly the leg this test is written to cover. ABANDON would settle inside failStep's
      // own cascade instead (settled=true), skipping that leg entirely.
      step('r1', 'RETURN', { return_config: { command: 'COMPLETE' } }),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'g' },
      { from_step_id: 'g', to_step_id: 'e' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');

  await db.update(workflowInstance).set({ propertyStore: { 'Flag.Value': 'boom' } }).where(eq(workflowInstance.id, wi.id));
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  // The catch path ran: 'g' is force-completed (RETURN COMPLETE re-inserts its row), routed to
  // 'e', and the whole instance completes via settleIfComplete's !settled leg — NOT aborted
  // (which is what an uncaught failure, or an ABANDON return, would have produced instead).
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('COMPLETED');
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['g', 'IDLE', null]); // caught, not traced ERRORED
  expect(trace.some(([oid, state]) => oid === 'g' && state === 'ERRORED')).toBe(false);
  await close();
});

// ── nested GATE inside a WORKFLOW PROXY child (review Important I-1): no existing test drove a
// GATE step living INSIDE a child spec rather than at the root. A child-scoped GATE reads its
// OWN context's property store (engineState.childProperties[childOid] — see
// core/engine-state.ts's childProperties doc comment — NOT workflow_instance.property_store,
// which only ever holds the ROOT's flat map), so re-evaluation here is driven by mutating that
// nested home directly, mirroring the FALSE-then-TRUE root-level test at the top of this file. ──

const CHILD_GATE_SPEC = {
  local_id: 'wf', oid: 'wf-child-gate', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('ps', 'START'),
    step('proxy', 'WORKFLOW PROXY'),
    step('pe', 'END'),
  ],
  connections: [
    { from_step_id: 'ps', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'pe' },
  ],
  children: [
    {
      local_id: 'proxy', oid: 'child-gate', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
      steps: [
        step('cs', 'START'),
        step('cg', 'GATE', {
          gate_config: { cycle_seconds: 2, source: 'return f === "open";' },
          input_parameter_specifications: [{ id: 'f', default_value: 'Flag.Value', value_type: 'property' }],
        }),
        step('ce', 'END'),
      ],
      connections: [
        { from_step_id: 'cs', to_step_id: 'cg' },
        { from_step_id: 'cg', to_step_id: 'ce' },
      ],
    },
  ],
};

/** Flip a key in the CHILD's own property-store home (engineState.childProperties[childOid]) —
 *  the child-scoped analogue of this file's own top-level tests, which flip
 *  workflow_instance.property_store directly since their gate lives at the root (activation
 *  seeds this home from the child spec's value_property_specifications — transition.ts's
 *  activateWorkflowProxy — so 'child-gate' already holds {'Flag.Value':'closed'} by the time
 *  the test's first pumpUntilQuiet returns). */
async function setChildProperty(db: any, instanceId: string, childOid: string, key: string, value: string): Promise<void> {
  const row = await instanceRow(db, instanceId);
  const engineState = row.engineState as { childProperties?: Record<string, Record<string, string>> };
  const childProperties = {
    ...engineState.childProperties,
    [childOid]: { ...engineState.childProperties?.[childOid], [key]: value },
  };
  await db.update(workflowInstance).set({ engineState: { ...engineState, childProperties } }).where(eq(workflowInstance.id, instanceId));
}

test('a GATE nested inside a WORKFLOW PROXY child parks WAITING_GATE under the CHILD spec oid, blocks the parent proxy and the whole instance, and completes once its child-scoped property flips (review Important I-1)', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const start = clock.now();

  const wi = await seedQueued(db, CHILD_GATE_SPEC, CHILD_GATE_SPEC.oid);
  await pumpUntilQuiet(db, deps);

  // Parked: the child's GATE evaluated FALSE ('closed', from its OWN value_property_specifications)
  // and parked WAITING_GATE, carrying the CHILD spec's own oid as node_oid — not the root's.
  const gateAfterPark = await stepRow(db, wi.id, 'cg');
  expect(gateAfterPark.state).toBe('WAITING_GATE');
  expect(gateAfterPark.nodeOid).toBe('child-gate');
  expect(new Date(gateAfterPark.wakeAt).getTime()).toBe(addSeconds(start, 2).getTime());

  // The parent's own WORKFLOW PROXY step is parked waiting on its active child.
  const proxyAfterPark = await stepRow(db, wi.id, 'proxy');
  expect(proxyAfterPark.state).toBe('WAITING_ACTION');

  // The instance must NOT settle while the nested gate waits.
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Flip the CHILD-scoped property (bypassing the engine) and advance the clock past the cycle.
  await setChildProperty(db, wi.id, 'child-gate', 'Flag.Value', 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  const gateAfterOpen = await stepRow(db, wi.id, 'cg');
  expect(gateAfterOpen.state).toBe('COMPLETED');
  const childEnd = await stepRow(db, wi.id, 'ce');
  expect(childEnd.state).toBe('COMPLETED');
  const proxyAfterOpen = await stepRow(db, wi.id, 'proxy');
  expect(proxyAfterOpen.state).toBe('COMPLETED');
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  await close();
});

test('a failure escaping the due-gate transaction settles the instance errored AND logs it (C2, GATE follow-up item 7)', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, GATE_SPEC, GATE_SPEC.oid);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE'); // parked, FALSE on 'closed'

  // Poison persist for THIS instance only, AFTER the park: the next due cycle's
  // evaluateGateOnClaim calls context.persist(tx) on every branch, so the throw escapes the
  // whole db.transaction into processDueGateWork's catch — the C2 path loop.ts logs for the
  // action side but gate.ts never did.
  //
  // settleFailedInstance ALSO persists through the context inside its recovery transaction
  // (loop.ts:187), so the poison must fire exactly once — on the due cycle's evaluation
  // inside evaluateGateOnClaim — and let the recovery persist through. One fault, one settle,
  // one log line: exactly the C2 contract.
  let armed = true;
  const originalPersist = WorkflowContext.prototype.persist;
  WorkflowContext.prototype.persist = async function (this: WorkflowContext, ...args: unknown[]) {
    if (armed && this.id === wi.id) {
      armed = false;
      throw new Error('injected persist failure for the gate C2 test');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalPersist as any).apply(this, args);
  };
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    clock.advance(2);
    await pumpUntilQuiet(db, deps);
    expect((await instanceRow(db, wi.id)).status).toBe('errored');
    const logged = errorSpy.mock.calls.map(([msg]) => String(msg));
    expect(logged.some((m) => m.includes(`instance ${wi.id} settled errored after a transition failure`) && m.includes('injected persist failure'))).toBe(true);
  } finally {
    WorkflowContext.prototype.persist = originalPersist;
    errorSpy.mockRestore();
  }
  await close();
});
