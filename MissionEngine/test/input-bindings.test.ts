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
// Spec 2026-09-04 §5.4: a non-GATE step with step-level action_property_bindings parks
// WAITING_PROPERTIES, core/input-bindings.ts fetches the values outside any transaction, and the
// activation resumes with them overlaid on the step's inputs. Same harness as
// test/gate-bindings.test.ts (real ActionClient + httpActionInvoker against the stub server).
import { afterEach, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { runOnce } from '../src/loop.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

// Matches STUB_ENV in stub-action-server.ts (oid 'env-1').
const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const BIND_LEVEL = [{ parameter_id: 'level', environment_oid: 'env-1', property: 'Sensor.Value' }];
const INPUT_LEVEL = [{ id: 'level', default_value: 'Sensor.Value', value_type: 'property' }];

function addSeconds(d: Date, secs: number): Date {
  return new Date(d.getTime() + secs * 1000);
}

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

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

// START -> SCRIPT(level bound to Sensor.Value; writes Result) -> END.
const scriptSpec = (oid: string, extraStep: Record<string, unknown> = {}) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  value_property_specifications: [{ name: 'Out', entries: [{ name: 'Result', value: '' }] }],
  steps: [
    step('s', 'START'),
    step('sc', 'SCRIPT', {
      script_config: { source: 'output.Result = level;' },
      input_parameter_specifications: INPUT_LEVEL,
      output_parameter_specifications: [{ id: 'Result', target: 'Out.Result' }],
      action_property_bindings: BIND_LEVEL,
      ...extraStep,
    }),
    step('e', 'END'),
  ],
  connections: [{ from_step_id: 's', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'e' }],
});

let stub: StubActionServer | undefined;
afterEach(async () => {
  if (stub) await stub.close();
  stub = undefined; // the nullActionInvoker test starts no server — never re-close the previous one
});

test('a bound SCRIPT parks WAITING_PROPERTIES (wake_at = now, no trace), then completes with the live value — which never touches property_store', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }]);
  const clock = makeClock();
  const deps = makeHttpDeps(stub, clock);
  const start = clock.now();
  const spec = scriptSpec('wf-ib-script');
  const wi = await seedQueued(db, spec, spec.oid);

  // Cycle 1: acquire + start — START completes, SCRIPT activates and parks for its properties.
  expect(await runOnce(db, deps)).toBe(true);
  const parked = await stepRow(db, wi.id, 'sc');
  expect(parked.state).toBe('WAITING_PROPERTIES');
  expect(new Date(parked.wakeAt).getTime()).toBe(start.getTime());
  expect((await traceOf(db, wi.id)).some(([oid]) => oid === 'sc')).toBe(false); // no trace at park

  await pumpUntilQuiet(db, deps);
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Out.Result': '50' });
  expect(propertyStoreKeys(after).some(k => k.startsWith('Sensor'))).toBe(false); // D3
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('COMPLETED');
  await close();
});

test('a bare group binding delivers the entries as the resolvePropertyKey-style JSON array', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '50' }, { name: 'Description', value: 'ignored' }]);
  const deps = makeHttpDeps(stub, makeClock());
  const spec = scriptSpec('wf-ib-group', {
    input_parameter_specifications: [{ id: 'level', default_value: 'Sensor', value_type: 'property' }],
    action_property_bindings: [{ parameter_id: 'level', environment_oid: 'env-1', property: 'Sensor' }],
  });
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(after.propertyStore['Out.Result']).toBe(JSON.stringify([{ name: 'Value', value: '50' }]));
  await close();
});

test("a bound ACTION PROXY's invoke payload carries the live value (WAITING_PROPERTIES -> WAITING_ACTION -> invoke)", async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '77' }]);
  // Loose matching (spec 2026-08-20) requires the container to advertise every input the invoke
  // sends — the stub's DEFAULT_CAPABILITIES declares none, and this is the only fixture here
  // that actually dispatches its bound input to a real action.
  stub.control.setCapabilities('act-1', {
    supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'], actionName: 'DoThing',
    inputParameterNames: ['level'],
  });
  const deps = makeHttpDeps(stub, makeClock());
  const spec = {
    local_id: 'wf', oid: 'wf-ib-action', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('s', 'START'),
      step('act', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' },
        input_parameter_specifications: INPUT_LEVEL,
        action_property_bindings: BIND_LEVEL,
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'act' }, { from_step_id: 'act', to_step_id: 'e' }],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const row = await stepRow(db, wi.id, 'act');
  expect(row.state).toBe('WAITING_ACTION');
  expect(row.actionInstanceId).not.toBeNull();
  expect(stub.invokes).toHaveLength(1);
  expect((stub.invokes[0].body as { input_parameters: Array<{ name: string; value: string }> }).input_parameters)
    .toContainEqual({ name: 'level', value: '77' });
  await close();
});

test('a fetch failure (property not registered) fails the step ERROR, routed through TRY/CATCH', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0); // no setEnvProperty — the properties route 404s
  const deps = makeHttpDeps(stub, makeClock());
  const base = scriptSpec('wf-ib-fetch-fail', { try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }] });
  const spec = {
    ...base,
    steps: [...base.steps, step('c1', 'CATCH', { catch_id: 'C1' }), step('r1', 'RETURN', { return_config: { command: 'ABANDON' } })],
    connections: [...base.connections, { from_step_id: 'c1', to_step_id: 'r1' }],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('aborted'); // caught -> RETURN ABANDON
  expect((await traceOf(db, wi.id)).some(([oid, state]) => oid === 'sc' && state === 'ERRORED')).toBe(false);
  await close();
});

test('a missing entry fails the step with the input-binding error text (uncaught -> instance errored)', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Other', value: '1' }]);
  const deps = makeHttpDeps(stub, makeClock());
  const spec = scriptSpec('wf-ib-missing-entry');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  const row = await stepRow(db, wi.id, 'sc');
  expect(row.state).toBe('ERRORED');
  expect(row.error).toBe("input binding for 'level': property 'Sensor.Value' has no entry 'Value'");
  await close();
});

test('a non-dispatching invoker fails a bound step with the dispatching-invoker error', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps(); // nullActionInvoker
  const spec = scriptSpec('wf-ib-no-dispatch');
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');
  expect((await stepRow(db, wi.id, 'sc')).error).toBe('input bindings require a dispatching action invoker');
  await close();
});

test('a bound WORKFLOW PROXY input reaches the child as its starting parameter', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: 'from-server' }]);
  const deps = makeHttpDeps(stub, makeClock());
  const spec = {
    local_id: 'parent-wf', oid: 'wf-ib-child', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Output', entries: [{ name: 'Result', value: '' }] }],
    steps: [
      step('p-start', 'START'),
      { ...step('proxy', 'WORKFLOW PROXY', {
        input_parameter_specifications: [{ id: 'propParam', default_value: 'Sensor.Value', value_type: 'property' }],
        output_parameter_specifications: [{ id: 'result', target: 'Output.Result' }],
        action_property_bindings: [{ parameter_id: 'propParam', environment_oid: 'env-1', property: 'Sensor.Value' }],
      }), local_id: 'ChildRef' },
      step('p-end', 'END'),
    ],
    connections: [{ from_step_id: 'p-start', to_step_id: 'proxy' }, { from_step_id: 'proxy', to_step_id: 'p-end' }],
    children: [{
      local_id: 'ChildRef', oid: 'child-ib', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      starting_parameter_specifications: [{ id: 'propParam', default_value: '' }],
      output_parameter_specifications: [{ id: 'result', target: 'result' }],
      steps: [
        step('c-start', 'START'),
        step('c-script', 'SCRIPT', {
          script_config: { source: 'output.result = propParam;' },
          input_parameter_specifications: [{ id: 'propParam', default_value: 'propParam', value_type: 'property' }],
          output_parameter_specifications: [{ id: 'result', target: 'result' }],
        }),
        step('c-end', 'END'),
      ],
      connections: [{ from_step_id: 'c-start', to_step_id: 'c-script' }, { from_step_id: 'c-script', to_step_id: 'c-end' }],
    }],
  };
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Output.Result': 'from-server' });
  await close();
});

test('SELECT 1 branches on a bound input parameter', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: 'open' }]);
  const deps = makeHttpDeps(stub, makeClock());
  const spec = {
    local_id: 'wf', oid: 'wf-ib-select1', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('s1', 'START'),
      step('sel', 'SELECT_1', {
        input_parameter_specifications: INPUT_LEVEL,
        action_property_bindings: BIND_LEVEL,
        select1_config: {
          input_name: 'level', input_value_type: 'property',
          options: [
            { id: 'opt-open', label: 'Open', operator: '==', value: 'open', value_type: 'literal', is_default: false },
            { id: 'opt-closed', label: 'Closed', operator: '==', value: 'closed', value_type: 'literal', is_default: true },
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
  const wi = await seedQueued(db, spec, spec.oid);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  expect((await stepRow(db, wi.id, 'end-open')).state).toBe('COMPLETED');
  expect(await stepRow(db, wi.id, 'end-closed')).toBeUndefined();
  await close();
});

test('an unresolvable step def clears the timer instead of re-fetching forever (defensive branch)', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '1' }]);
  const clock = makeClock();
  const deps = makeHttpDeps(stub, clock);
  const spec = scriptSpec('wf-ib-unresolvable');
  const wi = await seedQueued(db, spec, spec.oid);
  expect(await runOnce(db, deps)).toBe(true); // parks WAITING_PROPERTIES
  // Corrupt the frozen recipe so findStep cannot resolve the parked row's step any more.
  const broken = { ...spec, steps: spec.steps.filter((s) => s.oid !== 'sc') };
  await db.update(workflowInstance).set({ specJsonb: broken }).where(eq(workflowInstance.id, wi.id));
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
  try {
    await pumpUntilQuiet(db, deps);
  } finally {
    console.error = orig;
  }
  const row = await stepRow(db, wi.id, 'sc');
  expect(row.state).toBe('WAITING_PROPERTIES');
  expect(row.wakeAt).toBeNull(); // never revisited
  expect(errors.some((e) => e.includes('has no resolvable step def'))).toBe(true);
  await close();
});
