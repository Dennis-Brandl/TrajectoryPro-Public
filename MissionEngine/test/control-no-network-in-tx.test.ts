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
// Data-safety spec 2026-10-21 (Task 3): the control pass (pause/resume/stop) and a gate opening
// send their action-server commands only AFTER the locked transaction commits, and decide
// command support inside it from the in-memory capabilities cache alone. Setup runs on the plain
// db; the unit under test runs once on the tracked db, so any ActionClient call made inside its
// transaction throws.
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { trackTransactions, guardClient } from './helpers/no-network-in-tx.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { closeMonitoring } from '../src/actions/monitor.js';
import { runControlPass } from '../src/core/control.js';
import { processDueGateWork } from '../src/core/gate.js';
import { forceCompleteStep } from '../src/core/force-complete.js';
import { warmCapabilities } from '../src/core/capability-warmup.js';
import type { EngineDeps } from '../src/config.js';
import type { Db } from '../src/db.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };

const actionSpec = () => ({
  local_id: 'wf', oid: `wf-${Math.random()}`, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [step('start', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'act' }, { from_step_id: 'act', to_step_id: 'end' }],
});

/** START -> ACTION PROXY -> armed GATE (reads Flag.Value) -> END — test/gate-armed.test.ts's shape. */
const armedSpec = () => ({
  local_id: 'wf', oid: `wf-armed-${Math.random()}`, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
    step('gate', 'GATE', {
      gate_config: { cycle_seconds: 2, source: 'return f === "open";', control_previous_action: true },
      input_parameter_specifications: [{ id: 'f', default_value: 'Flag.Value', value_type: 'property' }],
    }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'gate' },
    { from_step_id: 'gate', to_step_id: 'end' },
  ],
});

async function seedInstance(
  db: any, spec: { oid: string }, status: string, engineState: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const oid = spec.oid;
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, queuedAt: new Date(),
    startedAt: status === 'queued' ? null : new Date(), specJsonb: spec, startingParams: null,
    runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
    engineState,
  }).returning();
  return { id: wi.id };
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

async function traceStates(db: any, instanceId: string, stepOid: string): Promise<string[]> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId));
  return rows.filter((r: any) => r.stepOid === stepOid).map((r: any) => r.state);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = new Date(now.getTime() + secs * 1000); } };
}

/** A fresh real ActionClient (empty capabilities cache) behind a guard keyed on the tracked db's
 *  open-transaction count; the invoker gets the guarded client too. */
function setup(db: Db, stubServer: { uri: string }, clock: { now: () => Date }, timeoutMs?: number) {
  const allowlist = [new URL(stubServer.uri).origin];
  const raw = new ActionClient(allowlist, fetch, { timeoutMs });
  const tracked = trackTransactions(db);
  const client = guardClient(raw, tracked.openCount);
  const deps: EngineDeps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, async () => stubServer.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { raw, client, deps, trackedDb: tracked.db };
}

/** A RUNNING (or PAUSED) instance on the stub, so the stub's own state machine accepts the command. */
async function liveServerInstance(raw: ActionClient, stubServer: StubActionServer, state: 'RUNNING' | 'PAUSED'): Promise<string> {
  const { instanceId } = await raw.invoke(stubServer.uri, 'act-1', {
    environment_oid: 'env-1', workflow_instance_id: 'wi', step_instance_id: 'si', step_oid: 'act', input_parameters: [],
  });
  stubServer.control.advance(instanceId, 'RUNNING');
  if (state === 'PAUSED') stubServer.control.advance(instanceId, 'PAUSED');
  return instanceId;
}

async function seedWithAction(
  db: any, raw: ActionClient, stubServer: StubActionServer, status: string, stepState: 'WAITING_ACTION' | 'PAUSED',
): Promise<{ id: string; actionInstanceId: string }> {
  const spec = actionSpec();
  const wi = await seedInstance(db, spec, status);
  const actionInstanceId = await liveServerInstance(raw, stubServer, stepState === 'PAUSED' ? 'PAUSED' : 'RUNNING');
  await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act', stepType: 'ACTION PROXY', state: stepState,
    actionInstanceId, actionServerUri: stubServer.uri, startedAt: new Date(),
  });
  return { id: wi.id, actionInstanceId };
}

function guardErrorsLogged(errors: ReturnType<typeof vi.spyOn>): boolean {
  return errors.mock.calls.some((c: unknown[]) => c.some(a => String(a).includes('inside a transaction')));
}

/** A server that accepts every connection and never answers — a blackholed action server. */
type Blackhole = { uri: string; connections(): number; close(): Promise<void> };
async function startBlackhole(): Promise<Blackhole> {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => { sockets.push(socket); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    uri: `http://127.0.0.1:${port}`,
    connections: () => sockets.length,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

/** A hand-seeded instance whose one action step runs on `uri` (no live server instance). */
async function seedOnServer(
  db: any, uri: string, status: string, stepState = 'WAITING_ACTION', engineState: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const spec = actionSpec();
  const wi = await seedInstance(db, spec, status, engineState);
  await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act', stepType: 'ACTION PROXY', state: stepState,
    actionInstanceId: `ai-${Math.random()}`, actionServerUri: uri, startedAt: new Date(),
  });
  return wi;
}

let stub: StubActionServer | undefined;
let blackhole: Blackhole | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (stub) {
    await stub.close();
    stub = undefined;
  }
  if (blackhole) {
    await blackhole.close();
    blackhole = undefined;
  }
});

test('pause sends PAUSE after commit and flips the step to PAUSED', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { raw, deps, trackedDb } = setup(db, stub, makeClock());
  const errors = vi.spyOn(console, 'error');
  const send = vi.spyOn(raw, 'sendCommand');
  const wi = await seedWithAction(db, raw, stub, 'pausing', 'WAITING_ACTION');

  expect(await runControlPass(trackedDb, deps)).toBe(true);

  expect(send).toHaveBeenCalledWith(stub.uri, wi.actionInstanceId, 'PAUSE');
  expect((await raw.getInstance(stub.uri, wi.actionInstanceId)).state).toBe('PAUSED');
  expect((await stepRow(db, wi.id, 'act')).state).toBe('PAUSED');
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  expect(guardErrorsLogged(errors)).toBe(false);
  await close();
});

test('resume sends RESUME after commit', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { raw, deps, trackedDb } = setup(db, stub, makeClock());
  const errors = vi.spyOn(console, 'error');
  const send = vi.spyOn(raw, 'sendCommand');
  const wi = await seedWithAction(db, raw, stub, 'resuming', 'PAUSED');

  expect(await runControlPass(trackedDb, deps)).toBe(true);

  expect(send).toHaveBeenCalledWith(stub.uri, wi.actionInstanceId, 'RESUME');
  expect((await raw.getInstance(stub.uri, wi.actionInstanceId)).state).toBe('RUNNING');
  expect((await stepRow(db, wi.id, 'act')).state).toBe('WAITING_ACTION');
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect(guardErrorsLogged(errors)).toBe(false);
  await close();
});

test('stop sends STOP after commit and wakes the step', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { raw, deps, trackedDb } = setup(db, stub, clock);
  const errors = vi.spyOn(console, 'error');
  const send = vi.spyOn(raw, 'sendCommand');
  const wi = await seedWithAction(db, raw, stub, 'stopping', 'WAITING_ACTION');

  expect(await runControlPass(trackedDb, deps)).toBe(true);

  expect(send).toHaveBeenCalledWith(stub.uri, wi.actionInstanceId, 'STOP');
  expect((await raw.getInstance(stub.uri, wi.actionInstanceId)).state).toBe('STOPPED');
  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION'); // the terminal arrives via poll/SSE
  expect(act.wakeAt).toEqual(clock.now());
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopping');
  expect(inst.engineState.stoppedActions).toEqual(['act']);
  expect(guardErrorsLogged(errors)).toBe(false);
  await close();
});

test('a gate opening sends STOP to its predecessor after commit', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { raw, deps, trackedDb } = setup(db, stub, clock);
  const errors = vi.spyOn(console, 'error');

  const wi = await seedInstance(db, armedSpec(), 'queued');
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');
  await sleep(100);
  closeMonitoring(act.id); // keep the STOPPED terminal off the plain-db SSE path
  stub.control.advance(act.actionInstanceId, 'RUNNING');

  const before = await instanceRow(db, wi.id);
  await db.update(workflowInstance)
    .set({ propertyStore: { ...(before.propertyStore as Record<string, string> | null), 'Flag.Value': 'open' } })
    .where(eq(workflowInstance.id, wi.id));
  clock.advance(2);
  raw.invalidateCapabilities(stub.uri); // only the warm-up may fill the cache
  const send = vi.spyOn(raw, 'sendCommand');

  expect(await processDueGateWork(trackedDb, deps)).toBe(true);

  expect(send).toHaveBeenCalledWith(stub.uri, act.actionInstanceId, 'STOP');
  expect((await raw.getInstance(stub.uri, act.actionInstanceId)).state).toBe('STOPPED');
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: true });
  expect((await stepRow(db, wi.id, 'act')).wakeAt).toEqual(clock.now());
  expect(await traceStates(db, wi.id, 'gate')).not.toContain('WARNING');
  expect(guardErrorsLogged(errors)).toBe(false);
  await close();
});

test('a forced gate open sends STOP to its predecessor after commit', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { raw, deps, trackedDb } = setup(db, stub, clock);

  const wi = await seedInstance(db, armedSpec(), 'queued');
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  const gate = await stepRow(db, wi.id, 'gate');
  expect(gate.state).toBe('WAITING_GATE');
  await sleep(100);
  closeMonitoring(act.id);
  stub.control.advance(act.actionInstanceId, 'RUNNING');
  raw.invalidateCapabilities(stub.uri);
  const send = vi.spyOn(raw, 'sendCommand');

  await forceCompleteStep(trackedDb, deps, null, {
    instanceId: wi.id, stepInstanceId: gate.id, actorUserId: 'u1', source: 'commander',
  });

  expect(send).toHaveBeenCalledWith(stub.uri, act.actionInstanceId, 'STOP');
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: true });
  expect(await traceStates(db, wi.id, 'gate')).not.toContain('WARNING');
  await close();
});

// Data safety round 2 (spec 2026-10-22 §2): unknown is not unsupported — the pause waits (up to
// PAUSE_UNKNOWN_LIMIT_MS; controls.test.ts covers the limit) instead of reporting Paused on a guess.
test('an unreachable action server during pause is waited on, not reported paused', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { raw, deps, trackedDb } = setup(db, stub, makeClock());
  const errors = vi.spyOn(console, 'error');
  const wi = await seedWithAction(db, raw, stub, 'pausing', 'WAITING_ACTION');
  await stub.close();
  stub = undefined;
  const send = vi.spyOn(raw, 'sendCommand');

  await expect(runControlPass(trackedDb, deps)).resolves.toBe(true);

  expect(send).not.toHaveBeenCalled();
  expect((await stepRow(db, wi.id, 'act')).state).toBe('WAITING_ACTION');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('pausing');
  expect(typeof inst.engineState.pausingSince).toBe('number');
  expect(inst.engineState.controlPassAttempts).toBe(0);
  expect(guardErrorsLogged(errors)).toBe(false);
  await close();
});

test('a pause right after restart still sends PAUSE', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const before = setup(db, stub, clock);
  await before.raw.capabilities(stub.uri); // the previous process had a warm cache
  const wi = await seedWithAction(db, before.raw, stub, 'pausing', 'WAITING_ACTION');

  const { raw, deps, trackedDb } = setup(db, stub, clock); // restart: a fresh, empty cache
  expect(raw.peekCapabilities(stub.uri)).toBeUndefined();
  const send = vi.spyOn(raw, 'sendCommand');

  expect(await runControlPass(trackedDb, deps)).toBe(true);

  expect(send).toHaveBeenCalledWith(stub.uri, wi.actionInstanceId, 'PAUSE');
  expect((await stepRow(db, wi.id, 'act')).state).toBe('PAUSED');
  await close();
});

// ── Fix round 1: the warm-up can never stall the loop on an unreachable server ──

const TIMEOUT_MS = 200;

test('a never-answering action server is fetched once per backoff window and never stalls a turn', async () => {
  const { db, close } = await makeTestDb();
  blackhole = await startBlackhole();
  // A clock ahead of the seeds' real-time updated_at, so each waiting pass rotates its instance
  // behind the others and the three turns claim three different instances.
  const { raw, deps, trackedDb } = setup(db, blackhole, makeClock(new Date(Date.now() + 3_600_000)), TIMEOUT_MS);
  const send = vi.spyOn(raw, 'sendCommand');
  const instances: Array<{ id: string }> = [];
  for (let i = 0; i < 3; i++) instances.push(await seedOnServer(db, blackhole.uri, 'pausing'));

  const turns: number[] = [];
  for (let i = 0; i < 3; i++) {
    const started = Date.now();
    expect(await runControlPass(trackedDb, deps)).toBe(true);
    turns.push(Date.now() - started);
  }

  expect(blackhole.connections()).toBe(1); // turns 2 and 3 fall inside the backoff window
  expect(Math.max(...turns)).toBeLessThan(TIMEOUT_MS * 4); // about one timeout, never a stack of them
  expect(send).not.toHaveBeenCalled();
  for (const wi of instances) {
    expect((await stepRow(db, wi.id, 'act')).state).toBe('WAITING_ACTION'); // unknown: no PAUSE flip
    expect((await instanceRow(db, wi.id)).status).toBe('pausing'); // waiting, not paused on a guess
  }
  await close();
});

test('concurrent warm-ups share one in-flight fetch per origin', async () => {
  const { db, close } = await makeTestDb();
  blackhole = await startBlackhole();
  const { client } = setup(db, blackhole, makeClock(), TIMEOUT_MS);
  await seedOnServer(db, blackhole.uri, 'pausing');

  await Promise.all([1, 2, 3].map(() => warmCapabilities(db, client, 'control')));

  expect(blackhole.connections()).toBe(1);
  await close();
});

test('the control warm-up skips resuming instances, already-stopped steps and fresh entries', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { raw, client } = setup(db, stub, makeClock());
  const caps = vi.spyOn(raw, 'capabilities');

  await seedOnServer(db, stub.uri, 'resuming', 'PAUSED');
  await seedOnServer(db, stub.uri, 'stopping', 'WAITING_ACTION', { stoppedActions: ['act'] });
  await warmCapabilities(db, client, 'control');
  expect(caps).not.toHaveBeenCalled();

  await seedOnServer(db, stub.uri, 'stopping', 'WAITING_ACTION');
  await warmCapabilities(db, client, 'control');
  expect(caps).toHaveBeenCalledTimes(1);

  await warmCapabilities(db, client, 'control'); // the entry is fresh now
  expect(caps).toHaveBeenCalledTimes(1);
  await close();
});

test('the gate warm-up fetches only for a due armed gate that has not sent its STOP', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { raw, client } = setup(db, stub, clock);
  const caps = vi.spyOn(raw, 'capabilities');

  const spec = armedSpec();
  const wi = await seedInstance(db, spec, 'running');
  await db.insert(stepInstance).values([
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
      actionInstanceId: 'ai-1', actionServerUri: stub.uri, startedAt: new Date() },
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'gate', stepType: 'GATE', state: 'WAITING_GATE',
      wakeAt: clock.now(), startedAt: new Date() },
  ]);
  const setArmed = (armedGates: Record<string, unknown>) =>
    db.update(workflowInstance).set({ engineState: { armedGates } }).where(eq(workflowInstance.id, wi.id));

  await warmCapabilities(db, client, 'gate', clock.now()); // a plain cycling gate: nothing to ask
  expect(caps).not.toHaveBeenCalled();

  await setArmed({ gate: { predecessorOid: 'act', open: false, stopSent: true } });
  await warmCapabilities(db, client, 'gate', clock.now());
  expect(caps).not.toHaveBeenCalled();

  await setArmed({ gate: { predecessorOid: 'act', open: false, stopSent: false } });
  await warmCapabilities(db, client, 'gate', new Date(clock.now().getTime() - 1000)); // not yet due
  expect(caps).not.toHaveBeenCalled();
  await warmCapabilities(db, client, 'gate', clock.now());
  expect(caps).toHaveBeenCalledTimes(1);
  await close();
});

test('the gate warm-up fetches for an open armed gate still retrying its STOP', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { raw, client } = setup(db, stub, clock); // a fresh client: no warm-up back-off state
  const caps = vi.spyOn(raw, 'capabilities');

  const spec = armedSpec();
  const wi = await seedInstance(db, spec, 'running', {
    armedGates: { gate: { predecessorOid: 'act', open: true, stopSent: false } },
  });
  await db.insert(stepInstance).values([
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
      actionInstanceId: 'ai-1', actionServerUri: stub.uri, startedAt: new Date() },
    { workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'gate', stepType: 'GATE', state: 'WAITING_GATE',
      wakeAt: clock.now(), startedAt: new Date() },
  ]);

  await warmCapabilities(db, client, 'gate', clock.now());
  expect(caps).toHaveBeenCalledTimes(1);
  expect(caps).toHaveBeenCalledWith(stub.uri);
  await close();
});
