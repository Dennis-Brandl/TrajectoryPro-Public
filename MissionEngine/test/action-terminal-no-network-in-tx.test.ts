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
// Data-safety spec 2026-10-21 (Task 2): applyActionTerminal fetches the action instance BEFORE it
// locks the workflow instance, never inside the locked transaction. The pump runs on the plain db
// (the guard stays inert there); each terminal is then applied through the tracked db, so any
// ActionClient call made inside its transaction throws.
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { trackTransactions, guardClient } from './helpers/no-network-in-tx.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { applyActionTerminal, closeMonitoring, startActionMonitoring } from '../src/actions/monitor.js';
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
const OUTPUTS = [{ id: 'Result', target: 'MyResult' }];

const linearSpec = () => ({
  local_id: 'wf', oid: `wf-${Math.random()}`, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, output_parameter_specifications: OUTPUTS }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'end' },
  ],
});

/** START -> ACTION PROXY -> armed GATE (reads Flag.Value) -> END — test/gate-armed.test.ts's shape. */
const armedSpec = () => ({
  local_id: 'wf', oid: `wf-armed-${Math.random()}`, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG, output_parameter_specifications: OUTPUTS }),
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

async function seedQueued(db: any, spec: { oid: string }): Promise<{ id: string }> {
  const oid = spec.oid;
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = new Date(now.getTime() + secs * 1000); } };
}

/** The real ActionClient behind a guard keyed on the tracked db's open-transaction count; the
 *  invoker gets the guarded client too, so every engine path that reaches the client is covered. */
function setup(db: Db, stubServer: StubActionServer, clock: { now: () => Date }) {
  const allowlist = [new URL(stubServer.uri).origin];
  const raw = new ActionClient(allowlist);
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

let stub: StubActionServer | undefined;
afterEach(async () => {
  if (stub) {
    await stub.close();
    stub = undefined;
  }
});

test('a COMPLETED terminal maps outputs without calling the server inside a transaction', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { client, deps, trackedDb } = setup(db, stub, makeClock());

  const spec = linearSpec();
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  closeMonitoring(act.id); // the loop's own SSE subscription must not win the race

  stub.control.advance(act.actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '42' }]);
  await applyActionTerminal(trackedDb, deps, client, act.id, { kind: 'COMPLETED' });

  expect((await stepRow(db, wi.id, 'act')).state).toBe('COMPLETED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore).toMatchObject({ MyResult: '42' });
  await close();
});

test('an SSE-delivered COMPLETED terminal also fetches outside the transaction', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { client, deps, trackedDb } = setup(db, stub, makeClock());
  const errors = vi.spyOn(console, 'error');

  const spec = linearSpec();
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  await sleep(100);
  // Replaces the loop's subscription (plain db) with one whose callback runs on the tracked db.
  await startActionMonitoring(trackedDb, deps, client, act.id, act.actionServerUri, act.actionInstanceId);
  await sleep(100); // let the SSE GET establish

  stub.control.advance(act.actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '42' }]);
  await vi.waitFor(async () => {
    expect((await stepRow(db, wi.id, 'act')).state).toBe('COMPLETED');
  }, { timeout: 2000, interval: 20 });

  expect((await instanceRow(db, wi.id)).propertyStore).toMatchObject({ MyResult: '42' });
  expect(errors.mock.calls.some(c => String(c[0]).includes('inside a transaction'))).toBe(false);
  errors.mockRestore();
  await close();
});

test('a STOPPED terminal whose gate is open still completes with the prefetched outputs', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { client, deps, trackedDb } = setup(db, stub, clock);

  const spec = armedSpec();
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('WAITING_GATE');
  await sleep(100);
  closeMonitoring(act.id); // the gate's STOP would otherwise deliver STOPPED over the plain-db SSE path

  const before = await instanceRow(db, wi.id);
  await db.update(workflowInstance)
    .set({ propertyStore: { ...(before.propertyStore as Record<string, string> | null), 'Flag.Value': 'open' } })
    .where(eq(workflowInstance.id, wi.id));
  clock.advance(2);
  await pumpUntilQuiet(db, deps); // gate opens, sends STOP
  expect((await instanceRow(db, wi.id)).engineState.armedGates.gate).toMatchObject({ open: true, stopSent: true });

  stub.control.advance(act.actionInstanceId, 'STOPPED', [{ name: 'Result', value: '42' }]);
  await applyActionTerminal(trackedDb, deps, client, act.id, { kind: 'STOPPED' });

  expect((await stepRow(db, wi.id, 'act')).state).toBe('COMPLETED');
  expect((await stepRow(db, wi.id, 'gate')).state).toBe('COMPLETED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore).toMatchObject({ MyResult: '42' });
  await close();
});

test('a terminal whose action instance changed before the lock is discarded', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { raw, client, deps, trackedDb } = setup(db, stub, makeClock());
  const deleteSpy = vi.spyOn(raw, 'deleteInstance');

  const spec = linearSpec();
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  closeMonitoring(act.id);
  stub.control.advance(act.actionInstanceId, 'COMPLETED', [{ name: 'Result', value: '42' }]);

  // The snapshot is fetched for instance A; by the time the lock is taken the row names B.
  const racing = new Proxy(client, {
    get(target, prop) {
      if (prop === 'getInstance') {
        return async (serverUri: string, instanceId: string) => {
          const snapshot = await target.getInstance(serverUri, instanceId);
          await db.update(stepInstance).set({ actionInstanceId: 'instance-B' }).where(eq(stepInstance.id, act.id));
          return snapshot;
        };
      }
      return Reflect.get(target, prop, target);
    },
  });
  await applyActionTerminal(trackedDb, deps, racing, act.id, { kind: 'COMPLETED' });

  const after = await stepRow(db, wi.id, 'act');
  expect(after.state).toBe('WAITING_ACTION');
  expect(after.actionInstanceId).toBe('instance-B');
  expect(after.wakeAt).toEqual(act.wakeAt);
  expect(after.updatedAt).toEqual(act.updatedAt);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('running');
  expect(inst.propertyStore?.MyResult).toBeUndefined();
  expect(deleteSpy).not.toHaveBeenCalled();
  await close();
});
