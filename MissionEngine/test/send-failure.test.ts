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
// Data safety round 3 (spec 2026-10-22-data-safety-3 §1): a STOP the engine recorded but could
// not deliver is classified. Unreachable (network error, timeout, 5xx) undoes the record so the
// stop pass sends it again once the server answers; refused (other 4xx, auth, allowlist) keeps it
// and shows a WARNING; gone (404) counts as delivered.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { processDueGateWork, GATE_STOP_RETRY_MS } from '../src/core/gate.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import {
  ActionClient, ActionCommandFailed, ActionServerNotAllowed, ActionsKeyRejected, BrokerTokenRejected,
} from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { randomUUID } from 'node:crypto';
import { runControlPass, sendAfterCommit, type AfterCommitCommand } from '../src/core/control.js';
import {
  applySendFailure, classifySendError, processPendingSendFailures, queueSendFailure, __resetPendingSendFailures,
} from '../src/core/send-failure.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const SPEC = {
  local_id: 'wf', oid: 'wf-send-failure', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [{
    local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
    included_actions: [{ action_oid: 'act-stop', action_name: 'Stoppable', action_library: 'lib-1' }],
  }],
  steps: [
    step('start', 'START'),
    step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-stop', environment_oid: 'env-1' } }),
    step('end', 'END'),
  ],
  connections: [],
};

function makeHttpDeps(s: StubActionServer): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(s.uri).origin];
  const client = new ActionClient(allowlist);
  const now = new Date('2026-01-01T00:00:00.000Z');
  const deps = testDeps({
    now: () => now,
    invoker: httpActionInvoker(client, async () => s.uri),
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

async function seedStopping(db: any, client: ActionClient, s: StubActionServer) {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: SPEC.oid, name: SPEC.oid, version: '1.0.0', state: 'Approved', specJsonb: SPEC,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'stopping', queuedAt: new Date(),
    startedAt: new Date(), specJsonb: SPEC, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: SPEC.oid, masterOid: SPEC.oid, masterVersion: '1.0.0', masterState: 'Approved', engineState: {},
  }).returning();
  const { instanceId: serverInstanceId } = await client.invoke(s.uri, 'act-stop', {
    environment_oid: 'env-1', workflow_instance_id: wi.id, step_instance_id: 'placeholder',
    step_oid: 'act', input_parameters: [],
  });
  const [row] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: SPEC.oid, stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
    actionInstanceId: serverInstanceId, actionServerUri: s.uri, startedAt: new Date(),
  }).returning();
  return { instanceId: wi.id as string, stepRowId: row.id as string, serverInstanceId };
}

async function stoppedActions(db: any, id: string): Promise<string[]> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, id));
  return (row.engineState as { stoppedActions?: string[] }).stoppedActions ?? [];
}

async function warnings(db: any, id: string): Promise<Array<[string | null, string, string | null]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, id)).orderBy(traceEntry.orderIndex);
  return rows.filter((r: any) => r.state === 'WARNING').map((r: any) => [r.stepOid, r.state, r.error]);
}

let stub: StubActionServer | undefined;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetPendingSendFailures();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  errorSpy.mockRestore();
  if (stub) {
    await stub.close();
    stub = undefined;
  }
});

/** Shared setup: a stopping run with one live STOP-supporting action, a warm cache. */
async function setup() {
  const t = await makeTestDb();
  stub = startStubActionServer(0);
  stub.control.setCapabilities('act-stop', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  const { deps, client } = makeHttpDeps(stub);
  const seeded = await seedStopping(t.db, client, stub);
  await client.capabilities(stub.uri);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const stops = () => sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'STOP').length;
  return { ...t, s: stub, deps, client, ...seeded, sendCommandSpy, stops };
}

test('classifySendError maps each failure', () => {
  expect(classifySendError(new ActionServerNotAllowed('http://x'))).toBe('refused');
  expect(classifySendError(new ActionsKeyRejected())).toBe('refused');
  expect(classifySendError(new BrokerTokenRejected())).toBe('refused');
  expect(classifySendError(new ActionCommandFailed(400, 'action command failed (400): bad'))).toBe('refused');
  expect(classifySendError(new ActionCommandFailed(403, 'action command failed (403): no'))).toBe('refused');
  expect(classifySendError(new ActionCommandFailed(404, 'action command failed (404): gone'))).toBe('gone');
  expect(classifySendError(new ActionCommandFailed(500, 'action command failed (500): boom'))).toBe('unreachable');
  expect(classifySendError(new ActionCommandFailed(503, 'action command failed (503): down'))).toBe('unreachable');
  expect(classifySendError(new TypeError('fetch failed'))).toBe('unreachable');
  expect(classifySendError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('unreachable');
  expect(classifySendError('something odd')).toBe('unreachable');
});

for (const [label, response] of [['a 503', 503], ['a dropped connection', 'drop']] as const) {
  test(`an unreachable STOP is retried once the server answers (${label})`, async () => {
    const t = await setup();
    t.s.control.setCommandResponse(response);
    await runControlPass(t.db, t.deps);
    expect(t.stops()).toBe(1);
    expect(await stoppedActions(t.db, t.instanceId)).not.toContain('act');
    expect(t.client.peekCapabilities(t.s.uri)).toBeUndefined(); // the origin is in back-off
    expect(await warnings(t.db, t.instanceId)).toEqual([]);

    t.s.control.setCommandResponse(200);
    await t.client.capabilities(t.s.uri);
    await runControlPass(t.db, t.deps);
    expect(t.stops()).toBe(2);
    expect(t.sendCommandSpy).toHaveBeenLastCalledWith(t.s.uri, t.serverInstanceId, 'STOP');
    expect(await stoppedActions(t.db, t.instanceId)).toContain('act');
    await t.close();
  });
}

test('no resend inside the back-off', async () => {
  const t = await setup();
  t.s.control.setCommandResponse(503);
  await runControlPass(t.db, t.deps);
  expect(t.stops()).toBe(1);
  for (let i = 0; i < 3; i++) await runControlPass(t.db, t.deps);
  expect(t.stops()).toBe(1);
  expect(await stoppedActions(t.db, t.instanceId)).not.toContain('act');
  await t.close();
});

test('a refused STOP is not retried and is shown', async () => {
  const t = await setup();
  t.s.control.setCommandResponse(400);
  await runControlPass(t.db, t.deps);
  expect(t.stops()).toBe(1);
  expect(await stoppedActions(t.db, t.instanceId)).toContain('act');
  const w = await warnings(t.db, t.instanceId);
  expect(w).toHaveLength(1);
  expect(w[0][0]).toBe('act');
  expect(w[0][1]).toBe('WARNING');
  expect(w[0][2]).toMatch(/^STOP could not be delivered: /);
  expect(w[0][2]).toContain('400');
  expect(t.client.peekCapabilities(t.s.uri)).toBeDefined(); // refused is not unreachable

  for (let i = 0; i < 3; i++) await runControlPass(t.db, t.deps);
  expect(t.stops()).toBe(1);
  await t.close();
});

test('a gone instance is treated as delivered', async () => {
  const t = await setup();
  t.s.control.setCommandResponse(404);
  await runControlPass(t.db, t.deps);
  expect(t.stops()).toBe(1);
  expect(await stoppedActions(t.db, t.instanceId)).toContain('act');
  expect(await warnings(t.db, t.instanceId)).toEqual([]);
  expect(t.client.peekCapabilities(t.s.uri)).toBeDefined();
  await t.close();
});

function stopCommand(t: { s: StubActionServer; serverInstanceId: string; instanceId: string; stepRowId: string }): AfterCommitCommand {
  return {
    serverUri: t.s.uri, actionInstanceId: t.serverInstanceId, command: 'STOP',
    instanceId: t.instanceId, kind: 'step-stop', stepRowId: t.stepRowId, stepOid: 'act',
  };
}

test('undo is skipped when the run is no longer stopping', async () => {
  const t = await setup();
  await t.db.update(workflowInstance).set({ status: 'aborting', engineState: { stoppedActions: ['act'] } })
    .where(eq(workflowInstance.id, t.instanceId));
  expect(await applySendFailure(t.db, stopCommand(t), 'unreachable', t.deps, 'fetch failed')).toBe('stale');
  expect(await stoppedActions(t.db, t.instanceId)).toEqual(['act']);
  await t.close();
});

test('undo is skipped when the step has a different action instance', async () => {
  const t = await setup();
  await t.db.update(workflowInstance).set({ engineState: { stoppedActions: ['act'] } })
    .where(eq(workflowInstance.id, t.instanceId));
  const cmd = { ...stopCommand(t), actionInstanceId: 'some-other-instance' };
  expect(await applySendFailure(t.db, cmd, 'unreachable', t.deps, 'fetch failed')).toBe('stale');
  expect(await stoppedActions(t.db, t.instanceId)).toEqual(['act']);
  await t.close();
});

test('a busy undo is retried on the next pass', async () => {
  const t = await setup();
  await t.db.update(workflowInstance).set({ engineState: { stoppedActions: ['act'] } })
    .where(eq(workflowInstance.id, t.instanceId));

  // PGlite has one connection, so a second open transaction cannot hold the row lock while
  // applySendFailure runs (it would wait for it). Instead, for exactly one transaction, the claim
  // (`select … for update skip locked`, the transaction's first execute) answers as a locked
  // row does: no row. The real-PG suite holds a genuine lock.
  const realTransaction = t.db.transaction.bind(t.db);
  const spy = vi.spyOn(t.db, 'transaction').mockImplementationOnce(((fn: (tx: any) => Promise<unknown>) =>
    realTransaction(async (tx: any) => {
      let first = true;
      const locked = new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (prop === 'execute') {
            return async (...args: unknown[]) => {
              if (first) { first = false; return { rows: [] }; }
              return value.apply(target, args);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return fn(locked);
    })) as any);

  expect(await applySendFailure(t.db, stopCommand(t), 'unreachable', t.deps, 'fetch failed')).toBe('busy');
  expect(await stoppedActions(t.db, t.instanceId)).toEqual(['act']);
  spy.mockRestore();

  expect(await processPendingSendFailures(t.db, t.deps)).toBe(true);
  expect(await stoppedActions(t.db, t.instanceId)).toEqual([]);
  // Applied once — the queue is now empty.
  expect(await processPendingSendFailures(t.db, t.deps)).toBe(false);
  await t.close();
});

test('an undo whose first attempt throws is queued and applied on the next pass', async () => {
  const t = await setup();
  await t.db.update(workflowInstance).set({ engineState: { stoppedActions: ['act'] } })
    .where(eq(workflowInstance.id, t.instanceId));
  t.s.control.setCommandResponse(503);
  const spy = vi.spyOn(t.db, 'transaction').mockRejectedValueOnce(new Error('db blip'));

  await sendAfterCommit(t.db, t.client, [stopCommand(t)], t.deps); // never throws
  expect(t.stops()).toBe(1);
  expect(await stoppedActions(t.db, t.instanceId)).toEqual(['act']); // the undo did not run yet
  spy.mockRestore();

  expect(await processPendingSendFailures(t.db, t.deps)).toBe(true);
  expect(await stoppedActions(t.db, t.instanceId)).toEqual([]);
  await t.close();
});

test('a queued undo for a deleted instance is dropped as stale', async () => {
  const t = await setup();
  const gone = { ...stopCommand(t), instanceId: randomUUID() };
  expect(await applySendFailure(t.db, gone, 'unreachable', t.deps, 'fetch failed')).toBe('stale');

  queueSendFailure(gone, 'unreachable', 'fetch failed');
  const spy = vi.spyOn(t.db, 'transaction');
  expect(await processPendingSendFailures(t.db, t.deps)).toBe(false);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(await processPendingSendFailures(t.db, t.deps)).toBe(false);
  expect(spy).toHaveBeenCalledTimes(1); // dropped, not re-queued
  spy.mockRestore();
  await t.close();
});

// ── Gate STOP (spec §1): an undelivered gate STOP is retried; a refused one warns once ──

function gateSpec() {
  return {
    local_id: 'wf', oid: `wf-gate-stop-${Math.random()}`, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [{
      local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
      included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
    }],
    value_property_specifications: [{ name: 'Flag', entries: [{ name: 'Value', value: 'closed' }] }],
    steps: [
      step('start', 'START'),
      step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' } }),
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
  };
}

/** An armed gate over a live STOP-supporting action; the gate is driven open with a warm cache. */
async function gateSetup(response: number) {
  const t = await makeTestDb();
  const db: any = t.db;
  stub = startStubActionServer(0);
  stub.control.setCommandResponse(response);
  let now = new Date('2026-01-01T00:00:00.000Z');
  const { deps, client } = makeHttpDeps(stub);
  deps.now = () => now;
  const spec = gateSpec();
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  await pumpUntilQuiet(t.db, deps);
  await client.capabilities(stub.uri);
  const rows = (): Promise<any[]> => db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  const act = (await rows()).find((r: any) => r.stepOid === 'act');
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const stops = () => sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'STOP').length;
  const [before] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  await db.update(workflowInstance).set({
    propertyStore: { ...(before.propertyStore as Record<string, string> | null), 'Flag.Value': 'open' },
  }).where(eq(workflowInstance.id, wi.id));
  const armed = async () => {
    const [r] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
    return (r.engineState as any).armedGates.gate;
  };
  const gateRow = async () => (await rows()).find((r: any) => r.stepOid === 'gate');
  return {
    ...t, db, s: stub, deps, client, instanceId: wi.id as string, act: act as any, stops, armed, gateRow,
    advance: (secs: number) => { now = new Date(now.getTime() + secs * 1000); },
    now: () => now,
  };
}

test('an unreachable gate STOP is retried', async () => {
  const t = await gateSetup(503);
  t.advance(2);
  await processDueGateWork(t.db, t.deps);
  expect(t.stops()).toBe(1);
  expect(await t.armed()).toMatchObject({ open: true, stopSent: false });
  expect((await t.gateRow()).wakeAt?.getTime()).toBe(t.now().getTime() + GATE_STOP_RETRY_MS);
  expect(await warnings(t.db, t.instanceId)).toEqual([]);

  t.s.control.setCommandResponse(200);
  await t.client.capabilities(t.s.uri);
  t.advance(5);
  await processDueGateWork(t.db, t.deps);
  expect(t.stops()).toBe(2);
  expect(await t.armed()).toMatchObject({ open: true, stopSent: true });
  t.s.control.advance(t.act.actionInstanceId, 'STOPPED', []);
  await t.close();
});

test('a refused gate STOP warns once', async () => {
  const t = await gateSetup(400);
  t.advance(2);
  await processDueGateWork(t.db, t.deps);
  expect(t.stops()).toBe(1);
  expect(await t.armed()).toMatchObject({ open: true, stopSent: true });
  const w = await warnings(t.db, t.instanceId);
  expect(w).toHaveLength(1);
  expect(w[0][0]).toBe('gate');
  expect(w[0][2]).toMatch(/^STOP could not be delivered: /);
  for (let i = 0; i < 3; i++) { t.advance(5); await processDueGateWork(t.db, t.deps); }
  expect(t.stops()).toBe(1);
  expect(await warnings(t.db, t.instanceId)).toHaveLength(1);
  t.s.control.advance(t.act.actionInstanceId, 'STOPPED', []);
  await t.close();
});
