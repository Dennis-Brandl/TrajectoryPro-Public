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
// Task 5: armed gates (spec 2026-08-29 §5.3/§6.4) — a GATE immediately following an
// ACTION PROXY ("Environment Action") arms CONCURRENTLY with it, rather than waiting for the
// action to complete before it is even materialized: TRUE opens the gate and sends the still-
// running action a best-effort STOP; a gate-initiated STOPPED terminal for that action routes as
// a normal completion (never through failure handling); predecessor failure tears the armed gate
// down. Driven through the SAME stub-action-server + httpActionInvoker + fake-clock harness as
// test/action-execution.test.ts; the GATE fixture itself follows test/gate-execution.test.ts's
// Flag-property convention.
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestPause, requestResume } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { submitUserAction } from '../src/core/submit.js';
import { closeMonitoring } from '../src/actions/monitor.js';
import { processDueGateWork, GATE_STOP_RETRY_MS } from '../src/core/gate.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };

/** START -> ACTION PROXY(act, env-1) -> GATE(cycle 2s, reads Flag.Value) -> END. The GATE's
 *  SINGLE incoming edge is the ACTION PROXY's own routed successor — exactly the shape that arms
 *  it (transition.ts's runStepActivation park branch) WHEN `control_previous_action` is true.
 *  `tryCatch` adds a TRY ERROR/CATCH/RETURN network on `act` with the given command ('ABANDON'
 *  for the predecessor-failure teardown test, 'RETRY' for the Critical-1 re-arm-after-CANCEL
 *  regression). `throwable` makes the gate's own script throw when Flag.Value is 'boom'
 *  (Important-2's resume-must-not-re-evaluate regression), otherwise it stays the plain
 *  open/closed boolean. `controlPreviousAction` (default `true`, this file's own armed-behavior
 *  baseline) sets `gate_config.control_previous_action`; pass `'omit'` to leave the field off the
 *  wire entirely (the absence-semantics tests below) or `false` to pin that explicit-false
 *  behaves identically to absence. Each call mints a fresh oid so multiple instances in the same
 *  test run never collide. */
function armedSpec(opts: {
  tryCatch?: 'ABANDON' | 'RETRY'; throwable?: boolean; controlPreviousAction?: boolean | 'omit';
  gateExtra?: Record<string, unknown>;
} = {}) {
  const controlPreviousAction = opts.controlPreviousAction ?? true;
  return {
    local_id: 'wf', oid: `wf-armed-${Math.random()}`, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
    steps: [
      step('start', 'START'),
      step('act', 'ACTION PROXY', {
        action_proxy_config: ACTION_CONFIG,
        output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }],
        ...(opts.tryCatch ? { try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] } : {}),
      }),
      step('gate', 'GATE', {
        gate_config: {
          cycle_seconds: 2,
          source: opts.throwable
            ? 'if (f === "boom") throw new Error("late"); return f === "open";'
            : 'return f === "open";',
          ...(controlPreviousAction === 'omit' ? {} : { control_previous_action: controlPreviousAction }),
          ...(opts.gateExtra ?? {}),
        },
        input_parameter_specifications: [{ id: 'f', default_value: 'Flag.Value', value_type: 'property' }],
      }),
      step('end', 'END'),
      ...(opts.tryCatch ? [
        step('c1', 'CATCH', { catch_id: 'C1' }),
        step('r1', 'RETURN', { return_config: { command: opts.tryCatch } }),
      ] : []),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'act' },
      { from_step_id: 'act', to_step_id: 'gate' },
      { from_step_id: 'gate', to_step_id: 'end' },
      ...(opts.tryCatch ? [{ from_step_id: 'c1', to_step_id: 'r1' }] : []),
    ],
  };
}

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
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(traceEntry.orderIndex);
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/** Wires a real ActionClient + httpActionInvoker at the given stub server — test/action-
 *  execution.test.ts's makeHttpDeps, EXCEPT scriptTimeoutMs: unlike that file, every test here
 *  actually runs a GATE script under this config (evaluateGateOnClaim), so the 200ms value that
 *  file uses is a real flake risk under full-suite contention (pump.ts's own testDeps doc
 *  comment: "a one-line script... blows a 200ms budget purely from waiting for a core" — measured
 *  239-286ms there) — a genuine full-suite run reproduced exactly that here, ERRORing a
 *  trivial-script gate mid-arming. testDeps' own 5000ms default is used instead. */
function makeHttpDeps(stub: StubActionServer, clock: { now: () => Date }): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const deps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, async () => stub.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { deps, client };
}

/** Merge-updates propertyStore rather than clobbering it — by the time some of these tests flip
 *  the Flag, the action's own COMPLETED mapping may already have written MyResult into it. */
async function setFlag(db: any, instanceId: string, value: string): Promise<void> {
  const before = await instanceRow(db, instanceId);
  await db.update(workflowInstance)
    .set({ propertyStore: { ...(before.propertyStore as Record<string, string> | null), 'Flag.Value': value } })
    .where(eq(workflowInstance.id, instanceId));
}

let stub: StubActionServer | undefined;
afterEach(async () => {
  // Reset to undefined after closing: the review-fix test below never assigns `stub` at all, so
  // without this a SECOND afterEach would try to re-close the PREVIOUS test's already-closed
  // server and throw "Server is not running."
  if (stub) {
    await stub.close();
    stub = undefined;
  }
});

// ── 1. Arming ──

test('arming: an ACTION PROXY park immediately materializes its GATE successor as WAITING_GATE, and armedGates records the pairing', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  expect(act.actionInstanceId).toBeTruthy();

  const gate = await stepRow(db, wi.id, 'gate');
  expect(gate.state).toBe('WAITING_GATE');

  const inst = await instanceRow(db, wi.id);
  expect(inst.engineState.armedGates).toEqual({
    gate: { predecessorOid: 'act', open: false, stopSent: false },
  });

  await close();
});

// ── 2. TRUE-then-terminal (STOP path) ──

test('TRUE-then-terminal: the gate opens and STOPs the running action; a gate-initiated STOPPED terminal completes both rows (and its outputs), never as a failure', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  const actionInstanceId = act.actionInstanceId;
  expect(actionInstanceId).toBeTruthy();
  await sleep(100); // let the SSE GET establish (Task 14 precedent) before we drive a terminal

  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  const gateOpened = await stepRow(db, wi.id, 'gate');
  expect(gateOpened.state).toBe('WAITING_GATE'); // still parked — only the ACTION side is done here
  expect(gateOpened.wakeAt).toBeNull();
  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, actionInstanceId, 'STOP');

  const armedMid = (await instanceRow(db, wi.id)).engineState.armedGates;
  expect(armedMid.gate).toMatchObject({ predecessorOid: 'act', open: true, stopSent: true });

  // Simulate the action server eventually reporting the gate-initiated stop.
  stub.control.advance(actionInstanceId, 'STOPPED', [{ name: 'Result', value: '42' }]);

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'act' && state === 'ERRORED')).toBe(false); // never a failure

  const actAfter = await stepRow(db, wi.id, 'act');
  expect(actAfter.wakeAt).toBeNull();
  const gateAfter = await stepRow(db, wi.id, 'gate');
  expect(gateAfter.state).toBe('COMPLETED');

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore).toMatchObject({ MyResult: '42' }); // outputs from the STOPPED instance mapped
  expect(inst.engineState.armedGates.gate).toBeUndefined();

  await close();
});

// ── 3. Terminal-then-TRUE (hold) ──

test('terminal-then-TRUE: the action completing while the gate is still CLOSED holds progress until a later TRUE', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  const actionInstanceId = act.actionInstanceId;
  await sleep(100);
  stub.control.advance(actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '7' }]);

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  // The gate is still CLOSED (Flag never flipped) — completion HOLDS rather than routing through.
  const gateHeld = await stepRow(db, wi.id, 'gate');
  expect(gateHeld.state).toBe('WAITING_GATE');
  const instMid = await instanceRow(db, wi.id);
  expect(instMid.status).toBe('running');
  expect(instMid.engineState.armedGates.gate).toMatchObject({ predecessorOid: 'act', open: false });

  // Flip the flag — the gate's own next due cycle finds the predecessor already COMPLETED.
  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  const gateAfter = await stepRow(db, wi.id, 'gate');
  expect(gateAfter.state).toBe('COMPLETED');
  const instFinal = await instanceRow(db, wi.id);
  expect(instFinal.status).toBe('completed');
  expect(instFinal.engineState.armedGates.gate).toBeUndefined();

  await close();
});

// ── 4. STOP unsupported (Ruling G4) ──

test('STOP unsupported (G4): the gate opens with a single WARNING trace and sends no command; the action still completes naturally through the open gate', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  // No STOP in the advertised capabilities — actionName must still match ENV_SPECS's 'DoThing'
  // for loose matching to resolve act-1 the same way the DEFAULT_CAPABILITIES fixture would.
  stub.control.setCapabilities('act-1', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT'], actionName: 'DoThing' });
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  const actionInstanceId = act.actionInstanceId;
  expect(actionInstanceId).toBeTruthy();
  await sleep(100);

  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  expect(sendCommandSpy).not.toHaveBeenCalled();
  const gateOpened = await stepRow(db, wi.id, 'gate');
  expect(gateOpened.wakeAt).toBeNull();

  const trace = await traceOf(db, wi.id);
  const gateWarnings = trace.filter(([oid, state]) => oid === 'gate' && state === 'WARNING');
  expect(gateWarnings).toHaveLength(1);
  expect(gateWarnings[0][2]).toContain('does not support STOP');

  // Natural completion — flows straight through the already-open gate.
  stub.control.advance(actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '5' }]);

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  const gateAfter = await stepRow(db, wi.id, 'gate');
  expect(gateAfter.state).toBe('COMPLETED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');

  await close();
});

// ── 5. Predecessor failure tears the gate down ──

test('action failure tears the armed gate down: an ERRORED terminal routes through TRY/CATCH and CANCELs the gate row, clearing armedGates', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = armedSpec({ tryCatch: 'ABANDON' });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  const actionInstanceId = act.actionInstanceId;
  expect(actionInstanceId).toBeTruthy();
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toBeDefined();

  await sleep(100);
  stub.control.advance(actionInstanceId, 'ERRORED');

  await vi.waitFor(async () => {
    const inst = await instanceRow(db, wi.id);
    expect(inst.status).toBe('aborted'); // RETURN ABANDON's own disposition
  }, { timeout: 2000, interval: 20 });

  const gateAfter = await stepRow(db, wi.id, 'gate');
  expect(gateAfter.state).toBe('CANCELLED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.engineState.armedGates.gate).toBeUndefined();

  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'act' && state === 'ERRORED')).toBe(false); // swallowed by the catch

  await close();
});

// ── Review fix: Task 4 wrote resetStepIfExists/clearStepScopedState's armedGates cleanup
// "blind" (no populated armedGates map existed yet to exercise it against — Task 5 is the first
// task that ever populates one). Hand-seeded directly (bypassing real arming/activation — the
// same style as gate-execution.test.ts's own "THE LANDMINE" tests): act1's own outgoing
// connection is deliberately left undeclared, so GOTO's re-activation of it can never immediately
// re-arm a fresh entry — which would otherwise mask whether the sweep below actually ran. ──

async function seedArmedCleanupInstance(db: any): Promise<{ id: string }> {
  const spec = {
    local_id: 'wf', oid: 'wf-armed-cleanup', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step('trigger1', 'ACTION PROXY', { try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      step('trigger2', 'ACTION PROXY', { try_specifications: [{ mode: 'ERROR', catch_id: 'C2' }] }),
      step('act1', 'ACTION PROXY'), // predecessor of gate1's HAND-ARMED entry; no outgoing edge
      step('gate2', 'GATE', { gate_config: { cycle_seconds: 100, source: 'return false;' } }),
      step('c1', 'CATCH', { catch_id: 'C1' }),
      step('r1', 'RETURN', { return_config: { command: 'GOTO', goto_step_oid: 'act1' } }),
      step('c2', 'CATCH', { catch_id: 'C2' }),
      step('r2', 'RETURN', { return_config: { command: 'GOTO', goto_step_oid: 'gate2' } }),
    ],
    connections: [
      { from_step_id: 'c1', to_step_id: 'r1' },
      { from_step_id: 'c2', to_step_id: 'r2' },
    ],
  };
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
    engineState: {
      armedGates: {
        // gate1 has no seeded row of its own — the point under test is the engine_state map,
        // not the row (resetStepIfExists's sweep only ever touches the map for a swept entry).
        gate1: { predecessorOid: 'act1', open: false, stopSent: false },
        gate2: { predecessorOid: 'act2', open: false, stopSent: false }, // unrelated — must survive
      },
    },
  }).returning();
  await db.insert(stepInstance).values([
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'trigger1', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', startedAt: new Date() },
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'trigger2', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', startedAt: new Date() },
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act1', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', startedAt: new Date() },
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'gate2', stepType: 'GATE', state: 'WAITING_GATE', startedAt: new Date(), wakeAt: new Date('2099-01-01T00:00:00.000Z') },
  ]);
  return { id: wi.id };
}

test('review fix: GOTO resets clear a populated armedGates map surgically — the predecessor-keyed sweep and the own-oid delete each fire without over- or under-deleting an unrelated armed pair', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const { id: instanceId } = await seedArmedCleanupInstance(db);

  const before = await instanceRow(db, instanceId);
  expect(before.engineState.armedGates).toEqual({
    gate1: { predecessorOid: 'act1', open: false, stopSent: false },
    gate2: { predecessorOid: 'act2', open: false, stopSent: false },
  });

  // Fail trigger1 -> CATCH C1 -> RETURN GOTO act1: resetStepIfExists('act1') must sweep gate1's
  // entry (predecessorOid === 'act1') while gate2's entirely unrelated entry survives untouched.
  await submitUserAction(db, instanceId, { step_oid: 'trigger1', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 0, deps);

  const afterSweep = await instanceRow(db, instanceId);
  expect(afterSweep.engineState.armedGates.gate1).toBeUndefined();
  expect(afterSweep.engineState.armedGates.gate2).toEqual({ predecessorOid: 'act2', open: false, stopSent: false });

  // act1 was reset + reactivated by the GOTO (its row is fresh again) but — since it declares no
  // outgoing connection in this fixture — nothing re-arms gate1: the deletion above is durable,
  // not merely masked by an immediate re-add.
  const act1After = await stepRow(db, instanceId, 'act1');
  expect(act1After.state).toBe('WAITING_ACTION');

  // Fail trigger2 -> CATCH C2 -> RETURN GOTO gate2: resetStepIfExists('gate2') deletes gate2's
  // OWN entry directly (own-oid delete) — a gate oid is never itself a predecessorOid value, so
  // the sweep half of that same function is a guaranteed no-op here; this is a clean, independent
  // probe of the other line.
  await submitUserAction(db, instanceId, { step_oid: 'trigger2', action: 'fail', failure_mode: 'ERROR', error: 'boom' }, 1, deps);

  const afterOwnDelete = await instanceRow(db, instanceId);
  expect(afterOwnDelete.engineState.armedGates).toEqual({});

  await close();
});

// ── Review fixes (second pass): Critical 1, Important 1/2/3, escalated validator finding ──

test('review fix (Critical 1): a predecessor failure CANCELs the armed gate row; a CATCH/RETURN RETRY that re-parks the SAME predecessor re-arms it cleanly instead of wedging the instance', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = armedSpec({ tryCatch: 'RETRY' });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const firstInvoke = await stepRow(db, wi.id, 'act');
  const firstInstanceId = firstInvoke.actionInstanceId;
  expect(firstInstanceId).toBeTruthy();
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');

  await sleep(100);
  stub.control.advance(firstInstanceId, 'ERRORED');

  // failStep's own teardown CANCELs the gate row, THEN the CATCH/RETURN RETRY re-parks 'act'
  // fresh — all inside ONE transaction, committed atomically: from outside, 'act' goes straight
  // from its first invoke to a fresh, uninvoked re-park; the gate's intermediate CANCELLED never
  // surfaces as an externally observable state on its own.
  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('WAITING_ACTION');
    expect(row.actionInstanceId).toBeNull();
  }, { timeout: 2000, interval: 20 });

  // Without the Critical-1 fix, armGateStep's guard sees the gate row still CANCELLED (a
  // terminal state, but not COMPLETED) and refuses to re-arm it — materializeAndActivate later
  // treats that CANCELLED row as "already active", and the instance wedges 'running' forever.
  const gateReArmed = await stepRow(db, wi.id, 'gate');
  expect(gateReArmed.state).toBe('WAITING_GATE');
  const armed = (await instanceRow(db, wi.id)).engineState.armedGates;
  expect(armed.gate).toEqual({ predecessorOid: 'act', open: false, stopSent: false });

  // Due-wake genuinely re-invokes the retried action.
  await pumpUntilQuiet(db, deps);
  const secondInvoke = await stepRow(db, wi.id, 'act');
  expect(secondInvoke.actionInstanceId).toBeTruthy();
  expect(secondInvoke.actionInstanceId).not.toBe(firstInstanceId);

  // Completing the retried action while the gate is still closed HOLDS (test 3's pattern) —
  // proves the re-armed pairing behaves like any other, not some half-wired leftover.
  await sleep(100);
  stub.control.advance(secondInvoke.actionInstanceId, 'COMPLETED');
  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Flip the flag — the gate's own next due cycle finds the (retried) predecessor COMPLETED,
  // and TRUE flows all the way through to a normal completion.
  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  expect((await stepRow(db, wi.id, 'gate')).state).toBe('COMPLETED');
  expect((await instanceRow(db, wi.id)).status).toBe('completed');

  await close();
});

test('review fix (Important 1): a GOTO from an UNRELATED sibling branch targeting the armed ACTION PROXY CANCELs the still-live gate row, which then re-arms fresh on the re-park (no double cascade)', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  // START -> PARALLEL -> [act -> gate -> wa] and [trigger (try ERROR -> CATCH -> RETURN GOTO
  // 'act')  -> wa]. 'trigger' shares nothing with the armed pair — its own failure exercises
  // resetStepIfExists's sweep (via GOTO), not failStep's own predecessor-failure teardown
  // (already covered by the "action failure tears the armed gate down" test above).
  const spec = {
    local_id: 'wf', oid: `wf-armed-sweep-${Math.random()}`, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'),
      step('p1', 'PARALLEL'),
      step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
      step('gate', 'GATE', { gate_config: { cycle_seconds: 100, source: 'return false;', control_previous_action: true } }),
      step('trigger', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      step('wa', 'WAIT ALL'),
      step('end', 'END'),
      step('c1', 'CATCH', { catch_id: 'C1' }),
      step('r1', 'RETURN', { return_config: { command: 'GOTO', goto_step_oid: 'act' } }),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'act' },
      { from_step_id: 'p1', to_step_id: 'trigger' },
      { from_step_id: 'act', to_step_id: 'gate' },
      { from_step_id: 'gate', to_step_id: 'wa' },
      { from_step_id: 'trigger', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'end' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  const trigger = await stepRow(db, wi.id, 'trigger');
  expect(trigger.actionInstanceId).toBeTruthy();
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toEqual({ predecessorOid: 'act', open: false, stopSent: false });

  // 'act' is about to be reset out from under its own still-open SSE subscription (the GOTO
  // below deletes its row without ever driving it to a terminal) — close that subscription
  // explicitly first, exactly as a genuine terminal would, so the stub server's connection
  // doesn't linger past this test (closeMonitoring is otherwise only ever called by
  // applyActionTerminal/loop.ts, never by a reset path — this is a test-harness-only stand-in).
  closeMonitoring(act.id);

  // Fail the UNRELATED sibling branch — its own CATCH/RETURN GOTOs back onto 'act', which is
  // still live and armed.
  await sleep(100);
  stub.control.advance(trigger.actionInstanceId, 'ERRORED');

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('WAITING_ACTION');
    expect(row.actionInstanceId).toBeNull(); // fresh re-park from the GOTO, not the pre-GOTO invoke
  }, { timeout: 2000, interval: 20 });

  // Without the Important-1 fix, the sweep would only delete the armedGates map entry and leave
  // the gate's row live (still WAITING_GATE) — a normal, un-armed gate from here on, able to open
  // and cascade downstream while 'act' keeps running, then complete a SECOND time once 'act's
  // real terminal later routes through.
  const gateAfter = await stepRow(db, wi.id, 'gate');
  expect(gateAfter.state).toBe('WAITING_GATE'); // CANCELLED, then re-armed fresh by armGateStep
  const armedAfter = (await instanceRow(db, wi.id)).engineState.armedGates;
  expect(armedAfter.gate).toEqual({ predecessorOid: 'act', open: false, stopSent: false });
  // 'wa' materializes EXECUTING as soon as the PARALLEL forks (join-arrival bookkeeping, not
  // first-arrival-triggered) — the thing under test is that it's still just that, and neither
  // an errant nor a doubled arrival has completed it out from under the still-unresolved branch.
  expect((await stepRow(db, wi.id, 'wa')).state).toBe('EXECUTING');

  await close();
});

test('review fix (Important 2): resume re-arms an OPEN gate\'s wake_at, but the short-circuit stops it from ever re-evaluating its script', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = armedSpec({ throwable: true });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  const actionInstanceId = act.actionInstanceId;
  expect(actionInstanceId).toBeTruthy();

  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  const gateOpen = await stepRow(db, wi.id, 'gate');
  expect(gateOpen.state).toBe('WAITING_GATE');
  expect(gateOpen.wakeAt).toBeNull();
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate.open).toBe(true);

  // Flip to the value that would make the NEXT script evaluation throw — this must never
  // actually run while the gate is open.
  await setFlag(db, wi.id, 'boom');

  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, deps);

  // Without the Important-2 fix, runResuming's unconditional WAITING_GATE re-arm makes the open
  // gate due again; evaluateGateOnClaim would re-run the script, throw, and (with no try on this
  // gate) error the whole instance.
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  const gateAfterResume = await stepRow(db, wi.id, 'gate');
  expect(gateAfterResume.state).toBe('WAITING_GATE');
  expect(gateAfterResume.wakeAt).toBeNull(); // reset back to null by the short-circuit itself
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'gate' && state === 'ERRORED')).toBe(false);

  // The terminal still completes normally via the (still) open gate.
  await sleep(100);
  stub.control.advance(actionInstanceId, 'STOPPED');
  await vi.waitFor(async () => {
    const inst = await instanceRow(db, wi.id);
    expect(inst.status).toBe('completed');
  }, { timeout: 2000, interval: 20 });

  await close();
});

test('review fix (Important 3): opening under a non-dispatching invoker (no action client at all) still burns the STOP marker but records a WARNING rather than going silent', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now }); // default nullActionInvoker: client is null, never dispatches

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  expect(act.actionInstanceId).toBeNull(); // never dispatched under nullActionInvoker
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');

  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  // Opened — no client exists at all, so there is nothing capable of sending a command in the
  // first place (this IS the "no command sent" assertion: no ActionClient means no sendCommand
  // call is even possible).
  const gateOpen = await stepRow(db, wi.id, 'gate');
  expect(gateOpen.wakeAt).toBeNull();

  const trace = await traceOf(db, wi.id);
  const gateWarnings = trace.filter(([oid, state]) => oid === 'gate' && state === 'WARNING');
  expect(gateWarnings).toHaveLength(1);
  expect(gateWarnings[0][2]).toContain('does not support STOP');

  const armed = (await instanceRow(db, wi.id)).engineState.armedGates;
  expect(armed.gate).toMatchObject({ open: true, stopSent: true }); // marker burned, never retried

  await close();
});

// ── Opt-in gating (spec 2026-08-29 §5.3, amended 2026-08-30): `control_previous_action` ──
//
// Armed behavior is now OPT-IN. Absent (or explicit `false`) means the GATE following an
// ACTION PROXY is an ordinary successor: no concurrent row at park time, no armedGates entry,
// no STOP ever sent — it is materialized only once the predecessor completes, exactly like a
// gate after any other step type (activateGateStep's plain path).

test('unarmed (flag absent): a GATE following an ACTION PROXY is NOT armed — no concurrent row at park, armedGates stays empty, no STOP is ever sent — then the ordinary cascade materializes and cycles it once the action completes', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = armedSpec({ controlPreviousAction: 'omit' });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  const actionInstanceId = act.actionInstanceId;
  expect(actionInstanceId).toBeTruthy();

  // No concurrent materialization at all — the ordinary cascade never runs for 'gate' until
  // 'act' completes, so there is no row (not merely a non-WAITING_GATE one).
  expect(await stepRow(db, wi.id, 'gate')).toBeUndefined();
  const instBefore = await instanceRow(db, wi.id);
  expect(instBefore.engineState.armedGates).toEqual({});

  await sleep(100); // let the SSE GET establish (Task 14 precedent) before we drive anything

  // Flip the flag to the value that WOULD open the gate and let a full cycle elapse — if this
  // gate were armed, that would now STOP the still-running action (test 2's own TRUE-then-
  // terminal path). It is not armed, so nothing whatsoever happens.
  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  expect(sendCommandSpy).not.toHaveBeenCalled();
  expect(await stepRow(db, wi.id, 'gate')).toBeUndefined();
  const actStillRunning = await stepRow(db, wi.id, 'act');
  expect(actStillRunning.state).toBe('WAITING_ACTION');
  expect(actStillRunning.actionInstanceId).toBe(actionInstanceId);
  expect((await instanceRow(db, wi.id)).engineState.armedGates).toEqual({});

  // Flip back closed so the gate's first (inline) evaluation on ordinary materialization parks
  // rather than auto-completing on the first shot — proving genuine cycling below, not a lucky
  // first evaluation.
  await setFlag(db, wi.id, 'closed');

  // Complete the action naturally on the stub — no STOP was ever sent, so this is the action's
  // own genuine terminal, not a gate-initiated one.
  stub.control.advance(actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '42' }]);

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  // NOW the ordinary cascade materializes 'gate' for the first time — closed on its first
  // evaluation, so it parks rather than completing immediately.
  const gateParked = await stepRow(db, wi.id, 'gate');
  expect(gateParked.state).toBe('WAITING_GATE');
  const instMid = await instanceRow(db, wi.id);
  expect(instMid.status).toBe('running');
  expect(instMid.engineState.armedGates).toEqual({}); // never armed — plain gate bookkeeping only

  // Cycle it TRUE — the ordinary due-wake path (activateGateStep re-entry via evaluateGateOnClaim).
  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  const gateAfter = await stepRow(db, wi.id, 'gate');
  expect(gateAfter.state).toBe('COMPLETED');
  const instFinal = await instanceRow(db, wi.id);
  expect(instFinal.status).toBe('completed');
  expect(instFinal.propertyStore).toMatchObject({ MyResult: '42' });
  expect(sendCommandSpy).not.toHaveBeenCalled(); // still never sent, start to finish

  await close();
});

test('control_previous_action: false behaves identically to absent — pins the absence semantics', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = armedSpec({ controlPreviousAction: false });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  expect(act.actionInstanceId).toBeTruthy();

  expect(await stepRow(db, wi.id, 'gate')).toBeUndefined();
  const inst = await instanceRow(db, wi.id);
  expect(inst.engineState.armedGates).toEqual({});

  await close();
});

test('timed armed gate (spec 2026-10-13 §3.6): the deadline opens the gate and STOPs the running action, exactly like TRUE', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = armedSpec({ gateExtra: { mode: 'timer', delay_seconds: 30 } });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  expect(act.actionInstanceId).toBeTruthy();
  await sleep(100);

  clock.advance(29);
  await pumpUntilQuiet(db, deps);
  expect(sendCommandSpy).not.toHaveBeenCalled();

  clock.advance(1);
  await pumpUntilQuiet(db, deps);
  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, act.actionInstanceId, 'STOP');
  const armed = (await instanceRow(db, wi.id)).engineState.armedGates;
  expect(armed.gate).toMatchObject({ open: true, stopSent: true });
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state, err]) => oid === 'gate' && state === 'OPENED' && err === 'timer (30 s)')).toBe(true);
  // Let the stopped action report its terminal so the stub's SSE stream closes (afterEach closes the stub).
  stub.control.advance(act.actionInstanceId, 'STOPPED', [{ name: 'Result', value: '42' }]);
  await vi.waitFor(async () => {
    expect((await instanceRow(db, wi.id)).status).toBe('completed');
  }, { timeout: 2000, interval: 20 });
  await close();
});

// ── Data safety round 2 (spec 2026-10-22 §2): the gate retries its STOP ──

test('an open gate retries its STOP while the action server is unreachable, then sends it once', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  expect(act.actionInstanceId).toBeTruthy();
  await sleep(100);

  // The server stops answering, and the dispatch-time cache entry is gone.
  stub.control.setCapabilitiesAvailable(false);
  client.invalidateCapabilities(stub.uri);
  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await processDueGateWork(db, deps);

  const stops = () => sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'STOP');
  expect(stops()).toHaveLength(0);
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: false });
  expect((await stepRow(db, wi.id, 'gate')).wakeAt?.getTime()).toBe(clock.now().getTime() + GATE_STOP_RETRY_MS);
  expect(GATE_STOP_RETRY_MS).toBe(5_000);
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'gate' && state === 'WARNING')).toBe(false);
  expect(errorSpy.mock.calls.some(([msg]) =>
    typeof msg === 'string' && msg.includes(`waiting to send STOP: action server ${stub!.uri} not reachable`))).toBe(true);

  // The server answers again; warm the cache directly (past the warm-up's 30 s back-off).
  stub.control.setCapabilitiesAvailable(true);
  await client.capabilities(stub.uri);
  clock.advance(5);
  await processDueGateWork(db, deps);
  expect(stops()).toEqual([[stub.uri, act.actionInstanceId, 'STOP']]);
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: true });
  expect((await stepRow(db, wi.id, 'gate')).wakeAt).toBeNull();

  // A further due pass sends nothing.
  clock.advance(5);
  await processDueGateWork(db, deps);
  expect(stops()).toHaveLength(1);

  stub.control.advance(act.actionInstanceId, 'STOPPED', [{ name: 'Result', value: '42' }]);
  await vi.waitFor(async () => {
    expect((await instanceRow(db, wi.id)).status).toBe('completed');
  }, { timeout: 2000, interval: 20 });
  errorSpy.mockRestore();
  await close();
});

test('a gate that opens before its predecessor is dispatched sends STOP once it is dispatched', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  const { actionInstanceId, actionServerUri } = act;
  expect(actionInstanceId).toBeTruthy();
  await sleep(100);

  // Simulate the invoke window: the predecessor row has no dispatch recorded yet (no wake, so
  // the due-action claim leaves it alone).
  await db.update(stepInstance).set({ actionInstanceId: null, actionServerUri: null, wakeAt: null })
    .where(eq(stepInstance.id, act.id));
  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await processDueGateWork(db, deps);

  const stops = () => sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'STOP');
  expect(stops()).toHaveLength(0);
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: false });
  expect((await stepRow(db, wi.id, 'gate')).wakeAt?.getTime()).toBe(clock.now().getTime() + GATE_STOP_RETRY_MS);
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'gate' && state === 'WARNING')).toBe(false);

  // The dispatch lands.
  await db.update(stepInstance).set({ actionInstanceId, actionServerUri }).where(eq(stepInstance.id, act.id));
  clock.advance(5);
  await processDueGateWork(db, deps);
  expect(stops()).toEqual([[stub.uri, actionInstanceId, 'STOP']]);
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: true });
  expect((await stepRow(db, wi.id, 'gate')).wakeAt).toBeNull();

  stub.control.advance(actionInstanceId, 'STOPPED', [{ name: 'Result', value: '42' }]);
  await vi.waitFor(async () => {
    expect((await instanceRow(db, wi.id)).status).toBe('completed');
  }, { timeout: 2000, interval: 20 });
  await close();
});

test('an unsupported STOP still warns once and is not retried', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setCapabilities('act-1', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT'], actionName: 'DoThing' });
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = armedSpec();
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  expect(act.actionInstanceId).toBeTruthy();
  await sleep(100);

  await setFlag(db, wi.id, 'open');
  clock.advance(2);
  await processDueGateWork(db, deps);
  expect(sendCommandSpy).not.toHaveBeenCalled();
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: true });
  expect((await stepRow(db, wi.id, 'gate')).wakeAt).toBeNull();

  clock.advance(5);
  await processDueGateWork(db, deps);
  expect(sendCommandSpy).not.toHaveBeenCalled();
  const trace = await traceOf(db, wi.id);
  const gateWarnings = trace.filter(([oid, state]) => oid === 'gate' && state === 'WARNING');
  expect(gateWarnings).toHaveLength(1);
  expect(gateWarnings[0][2]).toBe('gate opened but the running action does not support STOP — waiting for natural completion');

  stub.control.advance(act.actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '5' }]);
  await vi.waitFor(async () => {
    expect((await instanceRow(db, wi.id)).status).toBe('completed');
  }, { timeout: 2000, interval: 20 });
  await close();
});
