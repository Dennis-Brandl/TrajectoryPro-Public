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
// Task 15: action execution — invoke / SSE fast path / durable poll / timeout. Exercises the
// real ActionClient against test/stub-action-server.ts's real Hono server over loopback, driven
// through the SAME engine + fake-clock harness every other test file uses (test/helpers/pump.ts,
// test/helpers/db.ts) — only `deps.invoker` swaps from `nullActionInvoker` to a real
// `httpActionInvoker` wired at the stub's URI.
//
// Task 15 review fix note: the first invoke now happens PROMPTLY (wake_at = now at park, not
// now + invokeGraceSecs — Important 1), so a single `pumpUntilQuiet` after seeding already both
// parks AND invokes an ACTION PROXY step — no clock advance needed before the first dispatch.
// `invokeGraceSecs` is exercised ONLY by the grace-recovery test below, which simulates a lost
// in-flight invoke and needs the clock to actually cross that window.
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { applyActionTerminal, closeMonitoring } from '../src/actions/monitor.js';
import { runOnce } from '../src/loop.js';
import { submitUserAction } from '../src/core/submit.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };

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

/** Directly seeds a RUNNING instance with ONE hand-crafted step_instance row — bypasses the
 *  whole activation flow, for the "completion guard" unit-level test (applyActionTerminal must
 *  complete a step it finds PAUSED, set directly rather than via a real pause control pass —
 *  Task 16 territory, not yet built). */
async function seedRunningWithStep(
  db: any, spec: any, oid: string, stepState: string, extra: Record<string, unknown> = {},
): Promise<{ instanceId: string; stepInstanceId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  const actStep = spec.steps.find((s: any) => s.step_type === 'ACTION PROXY');
  const [si] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: actStep.oid, stepType: 'ACTION PROXY',
    state: stepState, startedAt: new Date(), ...extra,
  }).returning();
  return { instanceId: wi.id, stepInstanceId: si.id };
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

/** A mutable fake clock shared by `deps.now` and the test's own clock-advance calls. */
function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

/** Wires a real ActionClient + httpActionInvoker at the given stub server, with a short poll
 *  cadence so tests don't need large clock jumps, and dbLookup fixed to always resolve to the
 *  stub's own URI (unless overridden — the "missing binding" test passes null). */
function makeHttpDeps(
  stub: StubActionServer,
  clock: { now: () => Date },
  opts: { dbLookup?: () => Promise<string | null>; invokeGraceSecs?: number } = {},
): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const dbLookup = opts.dbLookup ?? (async () => stub.uri);
  const deps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, dbLookup),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 200,
      actionPollSecs: 5, invokeGraceSecs: opts.invokeGraceSecs ?? 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { deps, client };
}

const linearActionSpec = (extraStepFields: Record<string, unknown> = {}) => ({
  local_id: 'wf', oid: 'wf-1', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, ...extraStepFields }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'end' },
  ],
});

const tryCatchActionSpec = (mode: 'ERROR' | 'ABORT' | 'TIMEOUT', extraCfg: Record<string, unknown> = {}) => ({
  local_id: 'wf', oid: `wf-tc-${mode.toLowerCase()}`, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  value_property_specifications: [{ name: 'FailureContext', entries: [{ name: 'Mode', value: '' }] }],
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', {
      action_proxy_config: { ...ACTION_CONFIG, ...extraCfg },
      try_specifications: [{ mode, catch_id: 'C1' }],
    }),
    step('end', 'END'),
    step('c1', 'CATCH', { catch_id: 'C1', output_parameter_specifications: [{ id: 'Reason', target: 'FailureContext.Mode' }] }),
    step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'end' },
    { from_step_id: 'c1', to_step_id: 'r1' },
  ],
});

let stub: StubActionServer;
afterEach(async () => {
  if (stub) await stub.close();
});

// ── happy path: invoke -> SSE COMPLETED -> property written, successors ran ──

test('happy path: due-wake invokes promptly, SSE delivers COMPLETED, property written and successors routed', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = linearActionSpec({ output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }] });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps); // parks AND invokes in one go — wake_at is due immediately (Important 1)

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.state).toBe('WAITING_ACTION');
  expect(invoked.actionInstanceId).toBeTruthy();
  expect(invoked.actionServerUri).toBe(stub.uri);

  await sleep(100); // let the SSE GET establish (Task 14 precedent)
  stub.control.advance(invoked.actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '42' }]);

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore).toMatchObject({ MyResult: '42' });
  const endRow = await stepRow(db, wi.id, 'end');
  expect(endRow.state).toBe('COMPLETED');

  // Critical 1 coverage: a terminal step must never leave wake_at behind.
  const actAfter = await stepRow(db, wi.id, 'act');
  expect(actAfter.wakeAt).toBeNull();

  await close();
});

// ── Important 1: first invoke must not wait out invokeGraceSecs ──

test('first invoke happens promptly, without waiting out invokeGraceSecs', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock, { invokeGraceSecs: 3600 }); // one hour — must NOT gate the first attempt

  const wi = await seedQueued(db, linearActionSpec(), 'wf-1');
  await pumpUntilQuiet(db, deps); // no clock advance at all

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInstanceId).toBeTruthy();
  expect(invoked.actionServerUri).toBe(stub.uri);

  await close();
});

// ── missing binding ──

test('missing environment binding fails the step with the exact message', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock, { dbLookup: async () => null });

  const wi = await seedQueued(db, linearActionSpec(), 'wf-1');
  await pumpUntilQuiet(db, deps);

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['act', 'ERRORED', 'No action server is bound for environment "env" in this work center. Set it in Mission Commander under the work center\'s environment bindings.']);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('errored');

  await close();
});

// ── ABORTED -> TRY ABORT catch taken ──

test('ABORTED terminal routes through the matching TRY ABORT catch', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = tryCatchActionSpec('ABORT');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInstanceId).toBeTruthy();
  await sleep(100);
  stub.control.advance(invoked.actionInstanceId, 'ABORTED');

  await vi.waitFor(async () => {
    const inst = await instanceRow(db, wi.id);
    expect(inst.status).toBe('aborted');
  }, { timeout: 2000, interval: 20 });

  const inst = await instanceRow(db, wi.id);
  expect(inst.propertyStore).toMatchObject({ 'FailureContext.Mode': 'ABORT' });

  await close();
});

// ── timeout -> stub received ABORT command, TRY TIMEOUT catch taken ──

test('timeout past action_proxy_config.timeout_ms sends best-effort ABORT and routes through TRY TIMEOUT', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = tryCatchActionSpec('TIMEOUT', { timeout_ms: 10_000 });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps); // parks + invokes promptly

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInstanceId).toBeTruthy();
  // RUNNING is a state the stub's command table accepts ABORT from (IDLE does not).
  stub.control.advance(invoked.actionInstanceId, 'RUNNING');

  clock.advance(10); // past invokedAt + timeout_ms
  await pumpUntilQuiet(db, deps);

  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, invoked.actionInstanceId, 'ABORT');

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect(inst.propertyStore).toMatchObject({ 'FailureContext.Mode': 'TIMEOUT' });

  await close();
});

// ── instance-lost 404 ──

test('instance lost on server (404) errors the step with the exact message', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);

  const wi = await seedQueued(db, linearActionSpec(), 'wf-1');
  await pumpUntilQuiet(db, deps);

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInstanceId).toBeTruthy();

  // Simulate the action server having lost/expired the instance (e.g. it restarted).
  closeMonitoring(invoked.id); // stop the SSE fast path first — poll must carry this alone
  await client.deleteInstance(stub.uri, invoked.actionInstanceId);

  clock.advance(5); // past actionPollSecs -> due-wake polls
  await pumpUntilQuiet(db, deps);

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['act', 'ERRORED', 'Instance lost on server']);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('errored');

  await close();
});

// ── poll-carries-correctness: SSE dead, polling still completes the step ──

test('poll carries correctness when the SSE fast path is unavailable', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = linearActionSpec({ output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }] });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInstanceId).toBeTruthy();

  // Kill the SSE stream — polling is now the ONLY way this step can ever complete.
  closeMonitoring(invoked.id);

  stub.control.advance(invoked.actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '7' }]);
  clock.advance(5); // past actionPollSecs -> due-wake polls and observes COMPLETED
  await pumpUntilQuiet(db, deps);

  const after = await stepRow(db, wi.id, 'act');
  expect(after.state).toBe('COMPLETED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore).toMatchObject({ MyResult: '7' });

  await close();
});

// ── grace re-invoke: a lost in-flight record recovers with a fresh action instance ──

test('grace recovery re-invokes when action_instance_id is lost after a successful invoke', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const wi = await seedQueued(db, linearActionSpec(), 'wf-1');
  await pumpUntilQuiet(db, deps);

  const firstInvoke = await stepRow(db, wi.id, 'act');
  const firstInstanceId = firstInvoke.actionInstanceId;
  expect(firstInstanceId).toBeTruthy();

  // Simulate a crash losing the in-flight record: as far as this instance is concerned it never
  // heard back from the invoke, and its wake_at reverts to the pre-network-call grace window
  // claimDueActionStep itself would have set (see loop.ts's claimDueActionStep doc comment).
  closeMonitoring(firstInvoke.id);
  await db.update(stepInstance).set({
    actionInstanceId: null, actionServerUri: null, wakeAt: addSeconds(clock.now(), 5),
  }).where(eq(stepInstance.id, firstInvoke.id));

  clock.advance(5); // past invokeGraceSecs -> due-wake re-invokes
  await pumpUntilQuiet(db, deps);

  const secondInvoke = await stepRow(db, wi.id, 'act');
  expect(secondInvoke.actionInstanceId).toBeTruthy();
  expect(secondInvoke.actionInstanceId).not.toBe(firstInstanceId);

  await close();
});

// ── completion guard: a terminal applied while PAUSED still completes the step ──

test('applyActionTerminal completes a step even while it is PAUSED (unit-level)', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);

  const spec = linearActionSpec({ output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }] });
  const { instanceId, stepInstanceId } = await seedRunningWithStep(db, spec, spec.oid, 'PAUSED');

  const { instanceId: serverInstanceId } = await client.invoke(stub.uri, 'act-1', {
    environment_oid: 'env-1', workflow_instance_id: instanceId, step_instance_id: stepInstanceId,
    step_oid: 'act', input_parameters: [],
  });
  stub.control.advance(serverInstanceId, 'COMPLETED', [{ name: 'Result', value: '99' }]);
  await db.update(stepInstance).set({ actionInstanceId: serverInstanceId, actionServerUri: stub.uri })
    .where(eq(stepInstance.id, stepInstanceId));

  await applyActionTerminal(db, deps, client, stepInstanceId, { kind: 'COMPLETED' });

  const after = await stepRow(db, instanceId, 'act');
  expect(after.state).toBe('COMPLETED');
  const inst = await instanceRow(db, instanceId);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore).toMatchObject({ MyResult: '99' });

  await close();
});

// ── CRITICAL 1 coverage: a completed action step must not wedge the engine in a hot loop
// while its workflow instance is still running (waiting on unrelated, non-action work). ──

test('CRITICAL 1: a terminal action step clears wake_at and does not spin the engine while the instance stays running', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = {
    local_id: 'wf', oid: 'wf-c1', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'),
      step('p1', 'PARALLEL'),
      step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
      step('sibling', 'USER_INTERACTION'),
      step('wa', 'WAIT ALL'),
      step('end', 'END'),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'p1' },
      { from_step_id: 'p1', to_step_id: 'act' },
      { from_step_id: 'p1', to_step_id: 'sibling' },
      { from_step_id: 'act', to_step_id: 'wa' },
      { from_step_id: 'sibling', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'end' },
    ],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps); // parks + invokes ACT; parks SIBLING (WAITING_USER)

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInstanceId).toBeTruthy();

  await sleep(100);
  stub.control.advance(invoked.actionInstanceId, 'COMPLETED');

  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  const actAfter = await stepRow(db, wi.id, 'act');
  expect(actAfter.wakeAt).toBeNull(); // the actual fix

  // The instance stays RUNNING — `sibling` (a parked USER_INTERACTION) is still untouched —
  // proving there is genuinely nothing left for the completed action step to do, repeatedly.
  const instMid = await instanceRow(db, wi.id);
  expect(instMid.status).toBe('running');

  for (let i = 0; i < 5; i++) {
    const didWork = await runOnce(db, deps);
    expect(didWork).toBe(false);
  }

  // The workflow still finishes normally via the untouched sibling branch — proving this
  // instance was never head-of-line-blocked out of its own remaining work either.
  await submitUserAction(db, wi.id, { step_oid: 'sibling', action: 'submit' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  const instFinal = await instanceRow(db, wi.id);
  expect(instFinal.status).toBe('completed');

  await close();
});

// ── CRITICAL 2 coverage: cycling back onto a completed ACTION PROXY step re-invokes for real,
// rather than polling the previous (already-deleted) action instance. ──

const CYCLE_SPEC = {
  local_id: 'wf', oid: 'wf-c2', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
    step('gate', 'YES_NO', { yes_no_config: { yes_value: 'true', no_value: 'false' } }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'gate' },
    { from_step_id: 'gate', to_step_id: 'end', source_handle_id: 'true' },
    { from_step_id: 'gate', to_step_id: 'act', source_handle_id: 'false' },
  ],
};

test('CRITICAL 2: cycling back onto a completed ACTION PROXY step re-invokes rather than polling the dead prior instance', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const wi = await seedQueued(db, CYCLE_SPEC, CYCLE_SPEC.oid);
  await pumpUntilQuiet(db, deps);

  const firstInvoke = await stepRow(db, wi.id, 'act');
  const firstInstanceId = firstInvoke.actionInstanceId;
  expect(firstInstanceId).toBeTruthy();

  await sleep(100); // let the SSE GET establish (Task 14 precedent)
  stub.control.advance(firstInstanceId, 'COMPLETED');
  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  const gate = await stepRow(db, wi.id, 'gate');
  expect(gate.state).toBe('WAITING_USER');

  // Route back to ACT via the "no" branch — a genuine cycle re-entry (COMPLETED -> READY ->
  // re-parked WAITING_ACTION).
  await submitUserAction(db, wi.id, { step_oid: 'gate', action: 'button_press', button_output: 'false' }, 0, deps);
  await pumpUntilQuiet(db, deps); // re-parks ACT fresh, then due-wake invokes it again

  const secondInvoke = await stepRow(db, wi.id, 'act');
  expect(secondInvoke.state).toBe('WAITING_ACTION');
  expect(secondInvoke.actionInstanceId).toBeTruthy();
  // The critical assertion: a genuinely NEW action instance, never a poll against the first
  // (already best-effort deleted) one — which would otherwise surface as an immediate
  // "Instance lost on server" failure.
  expect(secondInvoke.actionInstanceId).not.toBe(firstInstanceId);

  const trace = await traceOf(db, wi.id);
  expect(trace.some(([oid, state]) => oid === 'act' && state === 'ERRORED')).toBe(false);
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  // Finish cleanly via the "yes" branch this time, proving the whole cycle round-trips.
  await sleep(100); // let the SECOND SSE subscription establish
  stub.control.advance(secondInvoke.actionInstanceId, 'COMPLETED');
  await vi.waitFor(async () => {
    const row = await stepRow(db, wi.id, 'act');
    expect(row.completedAt).not.toBeNull();
  }, { timeout: 2000, interval: 20 });
  await submitUserAction(db, wi.id, { step_oid: 'gate', action: 'button_press', button_output: 'true' }, 1, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');

  await close();
});

// ── spec 2026-10-15 §6.2: an output bound to a whole Value Property lands entry by entry ──

test('an output targeting a whole Value Property is written entry by entry; an entry target keeps the raw value', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = linearActionSpec({ output_parameter_specifications: [
    { id: 'Completion', target: 'Completion' },
    { id: 'Raw', target: 'Result.Raw' },
  ] });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const invoked = await stepRow(db, wi.id, 'act');
  await sleep(100);
  const group = JSON.stringify([{ name: 'Code', value: '0' }, { name: 'Text', value: '' }]);
  stub.control.advance(invoked.actionInstanceId, 'COMPLETED', [
    { name: 'Completion', value: group }, { name: 'Raw', value: group },
  ]);
  await vi.waitFor(async () => {
    expect((await instanceRow(db, wi.id)).status).toBe('completed');
  }, { timeout: 2000, interval: 20 });

  const store = (await instanceRow(db, wi.id)).propertyStore;
  expect(store['Completion.Code']).toBe('0');
  expect(store['Completion.Text']).toBe('');
  expect(store['Result.Raw']).toBe(group);
  expect(store['Result.Raw.Code']).toBeUndefined();
  await close();
});
