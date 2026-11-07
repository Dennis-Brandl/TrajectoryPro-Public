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
// Task 4 (spec 2026-11-06 section 5.4): the running-like gates admit stopping_cleanup /
// aborting_cleanup. Instances are seeded directly in the cleanup status; the transitions into
// them are later tasks.
import { afterEach, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { appUser, workCenter, workflow, workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import { requestPause } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { submitUserAction } from '../src/core/submit.js';
import { forceCompleteStep } from '../src/core/force-complete.js';
import { RUNNING_LIKE_STATUSES, isRunningLike } from '../src/core/operator-cleanup.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];

async function seedInstance(db: any, spec: any, status: string): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id };
}

async function insertStep(db: any, instanceId: string, nodeOid: string, stepOid: string, stepType: string, state: string, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(stepInstance).values({ workflowInstanceId: instanceId, nodeOid, stepOid, stepType, state, ...extra }).returning();
  return row;
}
async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}
async function setStatus(db: any, id: string, status: string) {
  await db.update(workflowInstance).set({ status }).where(eq(workflowInstance.id, id));
}

let stub: StubActionServer | undefined;
afterEach(async () => {
  if (stub) { await stub.close(); stub = undefined; }
});

const SCRIPT_SPEC = {
  local_id: 'wf', oid: 'wf-oc-script', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s', 'START'), step('sc', 'SCRIPT', { script_config: { source: '' } }), step('e', 'END')],
  connections: [{ from_step_id: 's', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'e' }],
};

test('constants: running-like is running + both cleanup statuses only', () => {
  expect([...RUNNING_LIKE_STATUSES]).toEqual(['running', 'stopping_cleanup', 'aborting_cleanup']);
  for (const s of ['stopping', 'aborting', 'paused', 'pausing', 'resuming', 'stopped']) expect(isRunningLike(s)).toBe(false);
});

test('READY step activates in stopping_cleanup', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedInstance(db, SCRIPT_SPEC, 'stopping_cleanup');
  await insertStep(db, wi.id, 'wf-oc-script', 'sc', 'SCRIPT', 'READY');
  await pumpUntilQuiet(db, testDeps());
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('COMPLETED');
  await close();
});

test('stopping instance still does not activate READY rows', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedInstance(db, SCRIPT_SPEC, 'stopping');
  await insertStep(db, wi.id, 'wf-oc-script', 'sc', 'SCRIPT', 'READY');
  await pumpUntilQuiet(db, testDeps());
  // The control pass cancels READY rows of a stopping instance; they are never activated.
  expect((await stepRow(db, wi.id, 'sc')).state).toBe('CANCELLED');
  await close();
});

test('action is invoked in aborting_cleanup', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const deps = testDeps({
    invoker: httpActionInvoker(client, async () => stub!.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1, actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5, actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  const spec = {
    local_id: 'wf', oid: 'wf-oc-act', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [step('s', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' } }), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'act' }, { from_step_id: 'act', to_step_id: 'e' }],
  };
  const wi = await seedInstance(db, spec, 'aborting_cleanup');
  await insertStep(db, wi.id, 'wf-oc-act', 'act', 'ACTION PROXY', 'WAITING_ACTION', { startedAt: new Date(), wakeAt: new Date('2000-01-01T00:00:00.000Z') });
  await pumpUntilQuiet(db, deps);
  expect(stub.invokes.length).toBe(1);
  expect((await stepRow(db, wi.id, 'act')).actionInstanceId).toBeTruthy();
  await close();
});

test('Pilot submit is accepted in stopping_cleanup', async () => {
  const { db, close } = await makeTestDb();
  const spec = {
    local_id: 'wf', oid: 'wf-oc-ui', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('s', 'START'), step('ui', 'USER_INTERACTION'), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'e' }],
  };
  const wi = await seedInstance(db, spec, 'stopping_cleanup');
  await insertStep(db, wi.id, 'wf-oc-ui', 'ui', 'USER_INTERACTION', 'WAITING_USER', { startedAt: new Date() });
  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'button_press', button_output: 'done' }, 0, testDeps());
  expect((await stepRow(db, wi.id, 'ui')).state).toBe('COMPLETED');
  await close();
});

const TIMER_SPEC = {
  local_id: 'wf', oid: 'wf-oc-gate', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
  steps: [step('s', 'START'), step('g', 'GATE', { gate_config: { mode: 'timer', delay_seconds: 5 } }), step('e', 'END')],
  connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
};

async function parkedTimerGate(db: any, deps: any) {
  const wi = await seedInstance(db, TIMER_SPEC, 'running');
  await insertStep(db, wi.id, 'wf-oc-gate', 'g', 'GATE', 'READY');
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('WAITING_GATE');
  return wi;
}

test('gate polls in stopping_cleanup', async () => {
  const { db, close } = await makeTestDb();
  let now = new Date('2026-01-01T00:00:00.000Z');
  const deps = testDeps({ now: () => now });
  const wi = await parkedTimerGate(db, deps);
  await setStatus(db, wi.id, 'stopping_cleanup');
  now = new Date(now.getTime() + 6000);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('COMPLETED');
  await close();
});

test('force-complete is accepted in stopping_cleanup', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await parkedTimerGate(db, deps);
  await setStatus(db, wi.id, 'stopping_cleanup');
  const g = await stepRow(db, wi.id, 'g');
  const [u] = await db.insert(appUser).values({ email: `u-${Math.random()}@t.test`, displayName: 'U' }).returning();
  const r = await forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: u.id, source: 'commander' });
  expect(r.ok).toBe(true);
  expect((await stepRow(db, wi.id, 'g')).state).toBe('COMPLETED');
  await close();
});

test('pause is refused from stopping_cleanup', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedInstance(db, SCRIPT_SPEC, 'stopping_cleanup');
  const code = await requestPause(db, wi.id).then(() => 'resolved', (e: any) => e.code);
  expect(code).toBe('RUNTIME_INVALID_STATE');
  await close();
});
