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
// Spec 2026-09-04 §5.4.5: control-verb dispositions for a step parked WAITING_PROPERTIES —
// stop cancels it outright (nothing external to drain), abort flips it ABORTED with trace,
// pause leaves it parked (the claim is status-gated to 'running'), resume re-arms it due-now.
import { afterEach, expect, test } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestStop, requestAbort, requestPause, requestResume } from 'mission-control-db/src/dao/runtime-control';
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
const ENV_SPECS = [{ local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01', included_actions: [] }];

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

// START -> SCRIPT(level bound to Sensor.Value) -> END.
function boundScriptSpec(oid: string) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Out', entries: [{ name: 'Result', value: '' }] }],
    steps: [
      step('s', 'START'),
      step('sc', 'SCRIPT', {
        script_config: { source: 'output.Result = level;' },
        input_parameter_specifications: [{ id: 'level', default_value: 'Sensor.Value', value_type: 'property' }],
        output_parameter_specifications: [{ id: 'Result', target: 'Out.Result' }],
        action_property_bindings: [{ parameter_id: 'level', environment_oid: 'env-1', property: 'Sensor.Value' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'e' }],
  };
}

let stub: StubActionServer;
afterEach(async () => {
  if (stub) await stub.close();
});

/** One runOnce: acquire + start — START completes, the SCRIPT parks WAITING_PROPERTIES. */
async function parkOne(db: any, deps: EngineDeps, spec: any) {
  const wi = await seedQueued(db, spec, spec.oid);
  expect(await runOnce(db, deps)).toBe(true);
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('WAITING_PROPERTIES');
  return wi;
}

test('stop cancels a WAITING_PROPERTIES step outright — wake_at cleared, no trace, instance settles stopped', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const deps = makeHttpDeps(stub, makeClock());
  const wi = await parkOne(db, deps, boundScriptSpec('wf-ibc-stop'));

  await requestStop(db, wi.id);
  await pumpUntilQuiet(db, deps);

  const row = await stepRow(db, wi.id, 'sc');
  expect(row.state).toBe('CANCELLED');
  expect(row.wakeAt).toBeNull();
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped');
  expect((await traceOf(db, wi.id)).filter(([oid]) => oid === 'sc')).toEqual([]);
  await close();
});

test('abort flips a WAITING_PROPERTIES step ABORTED with trace, instance settles aborted', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const deps = makeHttpDeps(stub, makeClock());
  const wi = await parkOne(db, deps, boundScriptSpec('wf-ibc-abort'));

  await requestAbort(db, wi.id);
  await pumpUntilQuiet(db, deps);

  const row = await stepRow(db, wi.id, 'sc');
  expect(row.state).toBe('ABORTED');
  expect(row.wakeAt).toBeNull();
  expect(await traceOf(db, wi.id)).toContainEqual(['sc', 'ABORTED', null]);
  expect((await instanceRow(db, wi.id)).status).toBe('aborted');
  await close();
});

test('a paused instance never acquires; resume re-arms the parked step due-now and it completes', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const start = clock.now();
  const deps = makeHttpDeps(stub, clock);
  const wi = await parkOne(db, deps, boundScriptSpec('wf-ibc-pause'));

  // Pause before the acquisition claim runs: the control pass settles 'paused'; the
  // WAITING_PROPERTIES row is untouched (still due, still parked).
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('WAITING_PROPERTIES');

  // Register the property only now — proves nothing fetched while paused (a fetch would have
  // 404'd and errored the step).
  stub.control.setEnvProperty('env-1', 'Sensor', [{ name: 'Value', value: '9' }]);
  clock.advance(1);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  await requestResume(db, wi.id);
  expect(await runOnce(db, deps)).toBe(true); // the control pass: runResuming re-arms the parked row
  const rearmed = await stepRow(db, wi.id, 'sc');
  expect(rearmed.state).toBe('WAITING_PROPERTIES');
  // Discriminates the fix: the park-time wake_at was `start`; the clock advanced 1 s during the
  // pause, so only runResuming's `wake_at = now` re-arm can make it equal clock.now() here.
  expect(new Date(rearmed.wakeAt).getTime()).toBe(clock.now().getTime());
  expect(new Date(rearmed.wakeAt).getTime()).not.toBe(start.getTime());
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  await pumpUntilQuiet(db, deps);
  const after = await instanceRow(db, wi.id);
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Out.Result': '9' });
  await close();
});
