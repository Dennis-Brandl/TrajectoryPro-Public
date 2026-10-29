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
// Round 2 (spec 2026-10-23 goal 5): a failing action status check (pollDueStep) is never
// swallowed silently. Each failure is logged (rate-limited), and once the checks have failed for
// PAUSE_UNKNOWN_LIMIT_MS the step gets ONE WARNING trace. The step itself is never failed here:
// its own timeout_ms still decides. Driven through the real ActionClient against the stub action
// server, with the same fake-clock harness as action-execution.test.ts.
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { closeMonitoring } from '../src/actions/monitor.js';
import { loadEngineState } from '../src/core/engine-state.js';
import { PAUSE_UNKNOWN_LIMIT_MS } from '../src/core/control.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };

const SPEC = {
  local_id: 'wf', oid: 'wf-1', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act' },
    { from_step_id: 'act', to_step_id: 'end' },
  ],
};

const POLL_SECS = 5;
const WARNING_401 = 'action server not answering status checks (HTTP 401) — this action may still be running';

let stub: StubActionServer | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (stub) await stub.close();
  stub = null;
});

async function seedQueued(db: any): Promise<string> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: SPEC.oid, name: SPEC.oid, version: '1.0.0', state: 'Approved', specJsonb: SPEC }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: SPEC, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: SPEC.oid, masterOid: SPEC.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi.id;
}

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = new Date(now.getTime() + secs * 1000); } };
}

function makeHttpDeps(s: StubActionServer, clock: { now: () => Date }): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(s.uri).origin];
  const client = new ActionClient(allowlist);
  const deps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, async () => s.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 200,
      actionPollSecs: POLL_SECS, invokeGraceSecs: 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { deps, client };
}

async function warningsOf(db: any, instanceId: string): Promise<Array<[string | null, string | null]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(traceEntry.orderIndex);
  return rows.filter((r: any) => r.state === 'WARNING').map((r: any) => [r.stepOid, r.error]);
}

async function traceOf(db: any, instanceId: string): Promise<Array<[string | null, string, string | null]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(traceEntry.orderIndex);
  return rows.map((r: any) => [r.stepOid, r.state, r.error]);
}

async function actStep(db: any, instanceId: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === 'act');
}

async function stateOf(db: any, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return { status: row.status as string, state: loadEngineState(row.engineState) };
}

/** Advances the clock one poll interval at a time for `secs` seconds, pumping after each. */
async function pollFor(db: any, deps: EngineDeps, clock: ReturnType<typeof makeClock>, secs: number): Promise<void> {
  for (let t = 0; t < secs; t += POLL_SECS) {
    clock.advance(POLL_SECS);
    await pumpUntilQuiet(db, deps);
  }
}

/** Seeds and invokes the action, then closes the SSE fast path so only polling sees the server. */
async function startInvoked(db: any, deps: EngineDeps): Promise<string> {
  const wi = await seedQueued(db);
  await pumpUntilQuiet(db, deps);
  const invoked = await actStep(db, wi);
  expect(invoked.actionInstanceId).toBeTruthy();
  expect(invoked.state).toBe('WAITING_ACTION');
  closeMonitoring(invoked.id);
  return wi;
}

const LIMIT_SECS = PAUSE_UNKNOWN_LIMIT_MS / 1000;

test('a poll answering 401 for over 2 minutes writes one WARNING trace', async () => {
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const wi = await startInvoked(db, deps);

  stub.control.setInstanceResponse(401);
  // Just under the limit: failures are logged, but no warning yet.
  await pollFor(db, deps, clock, LIMIT_SECS - POLL_SECS);
  expect(await warningsOf(db, wi)).toEqual([]);
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('not answering status checks'))).toBe(true);

  // Well past it, over several more polls: exactly one warning.
  await pollFor(db, deps, clock, 60);
  expect(await warningsOf(db, wi)).toEqual([['act', WARNING_401]]);

  const after = await actStep(db, wi);
  expect(after.state).toBe('WAITING_ACTION');
  const { status, state } = await stateOf(db, wi);
  expect(status).toBe('running');
  expect(state.pollWarned).toEqual(['act']);
  expect(state.pollFailingSince.act).toBeTypeOf('number');

  await close();
});

test('a successful poll clears the failure state', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const wi = await startInvoked(db, deps);

  stub.control.setInstanceResponse(401);
  await pollFor(db, deps, clock, LIMIT_SECS + 20);
  expect(await warningsOf(db, wi)).toHaveLength(1);

  // One good answer (still RUNNING) clears both entries.
  stub.control.setInstanceResponse(200);
  await pollFor(db, deps, clock, POLL_SECS);
  const cleared = (await stateOf(db, wi)).state;
  expect(cleared.pollFailingSince).not.toHaveProperty('act');
  expect(cleared.pollWarned).not.toContain('act');
  expect((await actStep(db, wi)).state).toBe('WAITING_ACTION');

  // A later outage gets a fresh clock and warns again, once.
  stub.control.setInstanceResponse(401);
  await pollFor(db, deps, clock, LIMIT_SECS - POLL_SECS);
  expect(await warningsOf(db, wi)).toHaveLength(1);
  await pollFor(db, deps, clock, 40);
  expect(await warningsOf(db, wi)).toEqual([['act', WARNING_401], ['act', WARNING_401]]);

  await close();
});

test('mixed poll errors keep one failure clock', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const wi = await startInvoked(db, deps);

  stub.control.setInstanceResponse(401);
  await pollFor(db, deps, clock, 60);
  const since = (await stateOf(db, wi)).state.pollFailingSince.act;
  expect(since).toBeTypeOf('number');

  // The server now drops the connection (a network error): the same clock keeps running.
  stub.control.setInstanceResponse('drop');
  await pollFor(db, deps, clock, 50);
  expect((await stateOf(db, wi)).state.pollFailingSince.act).toBe(since);
  expect(await warningsOf(db, wi)).toEqual([]);
  await pollFor(db, deps, clock, 40);

  const warnings = await warningsOf(db, wi);
  expect(warnings).toHaveLength(1);
  // The detail is the network error's message (no HTTP status), in the same sentence.
  expect(warnings[0][1]).toMatch(/^action server not answering status checks \(.+\) — this action may still be running$/);
  expect(warnings[0][1]).not.toBe(WARNING_401);
  expect((await actStep(db, wi)).state).toBe('WAITING_ACTION');

  await close();
});

test('ActionInstanceLost still errors the step', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const wi = await startInvoked(db, deps);

  // A failing streak first, then the server answers 404 for the instance.
  stub.control.setInstanceResponse(401);
  await pollFor(db, deps, clock, 30);
  expect((await stateOf(db, wi)).state.pollFailingSince.act).toBeTypeOf('number');
  stub.control.setInstanceResponse(200);
  const invoked = await actStep(db, wi);
  await client.deleteInstance(stub.uri, invoked.actionInstanceId);
  await pollFor(db, deps, clock, POLL_SECS);

  expect(await traceOf(db, wi)).toContainEqual(['act', 'ERRORED', 'Instance lost on server']);
  const { status, state } = await stateOf(db, wi);
  expect(status).toBe('errored');
  expect(await warningsOf(db, wi)).toEqual([]);
  expect(state.pollWarned).toEqual([]);
  // The terminal ends the failure run: no stale clock is left for a later run of this step.
  expect(state.pollFailingSince).not.toHaveProperty('act');

  await close();
});

test('state rows written before this change still load', () => {
  const old = {
    orderCounters: { 'wf-1': 3 }, pausingSince: null,
    pauseUndeliveredWarned: [], pauseUnreachableWarned: [], pauseRefused: [],
  };
  const state = loadEngineState(old);
  expect(state.pollFailingSince).toEqual({});
  expect(state.pollWarned).toEqual([]);
  expect(state.orderCounters).toEqual({ 'wf-1': 3 });
});
