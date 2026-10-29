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
// Repeating SCRIPT live Action-Property bindings (spec 2026-10-13 §6.2): the gate's two-phase fetch.
import { afterEach, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import type { EngineDeps } from '../src/config.js';
import { OPERATOR_CHANGE_CHANNEL } from '../src/core/reconcile.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

// Matches STUB_ENV in stub-action-server.ts (oid 'env-1') so the default properties route
// resolves without any extra environment-identity wiring.
const ENV_SPECS = [{ local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01', included_actions: [] }];

function addSeconds(d: Date, secs: number): Date {
  return new Date(d.getTime() + secs * 1000);
}

/** A mutable fake clock shared by `deps.now` and the test's own clock-advance calls — same
 *  pattern as test/gate-execution.test.ts's makeClock. */
function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

/** Wires a real ActionClient + httpActionInvoker at the given stub server — same shape as
 *  test/action-execution.test.ts's makeHttpDeps, minus the action-dispatch-only knobs this
 *  file doesn't need (invokeGraceSecs/actionPollSecs). */
function makeHttpDeps(stub: StubActionServer, clock: { now: () => Date }): EngineDeps {
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  return testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, async () => stub.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 20, invokeGraceSecs: 60,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
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

function propertyStoreKeys(row: any): string[] {
  return Object.keys((row.propertyStore as Record<string, string> | null) ?? {});
}

// START -> SCRIPT(repeat, reads Sensor.Value @ env-1 as `f`, cycle 2 s) -> END.
function boundSpec(oid: string, repeat: Record<string, unknown>) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Result', entries: [{ name: 'Seen', value: 'none' }] }],
    steps: [
      step('s', 'START'),
      step('sc', 'SCRIPT', {
        script_config: { source: 'output.seen = f; return Number(f) > 100;', repeat },
        action_property_bindings: [{ parameter_id: 'f', environment_oid: 'env-1', property: 'Sensor.Value' }],
        input_parameter_specifications: [{ id: 'f', default_value: '', value_type: 'literal' }],
        output_parameter_specifications: [{ id: 'seen', target: 'Result.Seen' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'e' }],
  };
}

let stub: StubActionServer;
afterEach(async () => { if (stub) await stub.close(); stub = undefined as never; });

test('every run re-reads the live server value; completes once it crosses the threshold', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
  const clock = makeClock();
  const deps = makeHttpDeps(stub, clock);
  const wi = await seedQueued(db, boundSpec('wf-rs-bind-1', { cycle_seconds: 2 }), 'wf-rs-bind-1');
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('WAITING_SCRIPT');
  expect((await instanceRow(db, wi.id)).engineState.scriptRuns.sc.pendingOutputs).toEqual({ seen: '50' });

  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore['Result.Seen']).toBe('150');
  await close();
});

test('expired bound script completes without fetching', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
  const clock = makeClock();
  const deps = makeHttpDeps(stub, clock);
  const wi = await seedQueued(db, boundSpec('wf-rs-bind-2', { cycle_seconds: 2, time_limit_seconds: 3, on_time_limit: 'complete' }), 'wf-rs-bind-2');
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('WAITING_SCRIPT');
  await stub.close(); // a fetch now would fail the step ERROR
  stub = undefined as never;
  clock.advance(5);
  await pumpUntilQuiet(db, deps);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore['Result.Seen']).toBe('50');
  await close();
});

test('a failed binding fetch fails the script ERROR and sends the work-center NOTIFY', async () => {
  const { db, client, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
  const clock = makeClock();
  const deps = makeHttpDeps(stub, clock);
  const wi = await seedQueued(db, boundSpec('wf-rs-bind-3', { cycle_seconds: 2 }), 'wf-rs-bind-3');
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('WAITING_SCRIPT');
  await stub.close(); // the next run's fetch fails
  stub = undefined as never;
  const received: string[] = [];
  await client.listen(OPERATOR_CHANGE_CHANNEL, (payload: string) => { received.push(payload); });
  clock.advance(2);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('ERRORED');
  await new Promise((r) => setTimeout(r, 50));
  expect(received).toContain(wi.workCenterId);
  await close();
});
