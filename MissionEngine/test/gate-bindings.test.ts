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
// Task 6: live Action-Property bindings for GATE steps — the two-phase (fetch-outside-any-
// transaction) evaluation path in core/gate.ts's processDueGateWork. Driven through a real
// ActionClient + httpActionInvoker against test/stub-action-server.ts's real Hono server, same
// harness shape as test/action-execution.test.ts's makeHttpDeps.
import { afterEach, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import type { EngineDeps } from '../src/config.js';

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

// START -> GATE(reads Sensor.Value @ env-1 as `f`, cycle 2s) -> END.
const GATE_SPEC = {
  local_id: 'wf', oid: 'wf-gate-bindings', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('s', 'START'),
    step('g', 'GATE', {
      gate_config: {
        cycle_seconds: 2,
        source: 'return Number(f) > 100;',
        action_property_bindings: [{ parameter_id: 'f', environment_oid: 'env-1', property: 'Sensor.Value' }],
      },
      input_parameter_specifications: [{ id: 'f', default_value: '', value_type: 'literal' }],
    }),
    step('e', 'END'),
  ],
  connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
};

let stub: StubActionServer;

afterEach(async () => {
  if (stub) await stub.close();
});

test('a gate with bindings never inline-evaluates: it parks on the two-phase path, cycles FALSE off the live server value, then completes once the server value crosses the threshold — the property never touches property_store', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
  const clock = makeClock();
  const deps = makeHttpDeps(stub, clock);
  const start = clock.now();

  const wi = await seedQueued(db, GATE_SPEC, GATE_SPEC.oid);
  await pumpUntilQuiet(db, deps);

  // The gate's activation (hasBindings=true) parks WAITING_GATE with wake_at = now — due
  // immediately — so the SAME pumpUntilQuiet call above already drove the first two-phase
  // evaluation: fetch (50), script FALSE, re-arm 2s ahead. No inline eval at activation.
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  const gateAfterFirstFetch = await stepRow(db, wi.id, 'g');
  expect(gateAfterFirstFetch.state).toBe('WAITING_GATE');
  expect(new Date(gateAfterFirstFetch.wakeAt).getTime()).toBe(addSeconds(start, 2).getTime());
  // The live value came from the server, never from the instance's own property store.
  expect(propertyStoreKeys(await instanceRow(db, wi.id)).some(k => k.startsWith('Sensor'))).toBe(false);

  // Flip the SERVER's value (not the instance) and let the next due cycle observe it.
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  clock.advance(2);
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  const gate = await stepRow(db, wi.id, 'g');
  expect(gate.state).toBe('COMPLETED');
  // Still never persisted into property_store, even after completion.
  expect(propertyStoreKeys(after).some(k => k.startsWith('Sensor'))).toBe(false);
  await close();
});

test('a property fetch failure (nothing registered on the server) fails the gate step ERROR, routed through TRY/CATCH', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0); // no setEnvProperty — the properties route 404s
  const deps = makeHttpDeps(stub, makeClock());
  const spec = {
    local_id: 'wf', oid: 'wf-gate-bindings-fetch-fail', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('s', 'START'),
      step('g', 'GATE', {
        gate_config: {
          cycle_seconds: 2,
          source: 'return Number(f) > 100;',
          action_property_bindings: [{ parameter_id: 'f', environment_oid: 'env-1', property: 'Sensor.Value' }],
        },
        input_parameter_specifications: [{ id: 'f', default_value: '', value_type: 'literal' }],
        try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
      }),
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
  expect(after.status).toBe('aborted'); // caught -> RETURN ABANDON
  const trace = await traceOf(db, wi.id);
  // Caught, never traced ERRORED — same convention as the uncaught-vs-caught gate script tests.
  expect(trace.some(([oid, state]) => oid === 'g' && state === 'ERRORED')).toBe(false);
  await close();
});

test('overlay never persists: after a gate-with-bindings completes, workflow_instance.property_store carries no Sensor.* keys', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  // Already-true value: the gate completes on its very first (activation-triggered) due cycle.
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '150' }]);
  const deps = makeHttpDeps(stub, makeClock());

  const wi = await seedQueued(db, GATE_SPEC, GATE_SPEC.oid);
  await pumpUntilQuiet(db, deps);

  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(propertyStoreKeys(after)).toEqual([]);
  await close();
});
