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
// Spec 2026-11-06 (Operator Stop / Operator Abort TRY modes), Task 6: the edges of an Operator
// Stop cleanup — failures inside the cleanup network (C6, U3), skip (C4, C13), equipment the
// workflow already holds (U6), and an engine restart mid-cleanup (§5.4).
import { afterEach, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { appUser, workCenter, workflow, workflowInstance, stepInstance, stepRun, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestSkipCleanup, requestStop } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { applyActionTerminal } from '../src/actions/monitor.js';
import { runControlPass } from '../src/core/control.js';
import { submitUserAction } from '../src/core/submit.js';
import { InMemoryResourceManager } from '../src/core/resources.js';
import { __resetOrphanedActions, finalizeOrphanedActions, notePendingAbortsQueued } from '../src/core/operator-cleanup-flow.js';
import { openContext, settleTerminal } from '../src/core/context.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };
const WAIT_FOREVER = { script_config: { source: 'return false;', repeat: { cycle_seconds: 600 } } };
const ROW = { mode: 'OPERATOR_STOP', catch_id: 'cleanup' };
const THROW = { script_config: { source: 'throw new Error("boom");' } };

type Step = ReturnType<typeof step>;
type Conn = { from_step_id: string; to_step_id: string; source_handle_id?: string };
type Net = { steps: Step[]; connections: Conn[] };

const MAIN_WAIT: Net = {
  steps: [step('start', 'START'), step('wait', 'SCRIPT', WAIT_FOREVER), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'wait' }, { from_step_id: 'wait', to_step_id: 'end' }],
};

function buildSpec(oid: string, cleanup: Net, opts: { main?: Net; tries?: unknown[]; extra?: Record<string, unknown> } = {}) {
  const main = opts.main ?? MAIN_WAIT;
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    try_specifications: opts.tries ?? [ROW],
    steps: [...main.steps, ...cleanup.steps],
    connections: [...main.connections, ...cleanup.connections],
    ...(opts.extra ?? {}),
  };
}

/** CATCH -> <middle...> -> RETURN ABANDON, chained. */
function chain(...middle: Step[]): Net {
  const steps = [step('c', 'CATCH', { catch_id: 'cleanup' }), ...middle, step('ret', 'RETURN', { return_config: { command: 'ABANDON' } })];
  const connections = steps.slice(1).map((s, i) => ({ from_step_id: steps[i].oid, to_step_id: s.oid }));
  return { steps, connections };
}

// ── helpers (as in operator-stop-cleanup.test.ts) ──

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = new Date(now.getTime() + secs * 1000); } };
}

function makeHttpDeps(stub: StubActionServer, clock: { now: () => Date }): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const deps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, async () => stub.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000, schedulerEnabled: true, scheduleTickMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { deps, client };
}

async function seedQueued(db: any, spec: any): Promise<{ id: string }> {
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

async function seedInstance(db: any, spec: any, status: string, engineState: unknown): Promise<{ id: string }> {
  const oid = spec.oid;
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved', engineState,
  }).returning();
  return { id: wi.id };
}

async function seedUser(db: any): Promise<string> {
  const [u] = await db.insert(appUser).values({
    email: `jane-${Math.random()}@example.com`, loginName: `jane${Math.floor(Math.random() * 1e9)}`, displayName: 'Jane Doe',
  }).returning();
  return u.id;
}

async function traceOf(db: any, instanceId: string): Promise<Array<[string | null, string, string | null | undefined]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(traceEntry.id);
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

const operatorTrace = async (db: any, id: string) =>
  (await traceOf(db, id)).filter(([, state]) => state === 'OPERATOR').map(([, , msg]) => msg);

/** Run the instance to its first park, Stop it as Jane Doe, pump. */
async function runAndStop(db: any, spec: any, deps: EngineDeps = testDeps()): Promise<{ id: string; uid: string }> {
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  await requestStop(db, wi.id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  return { id: wi.id, uid };
}

let stub: StubActionServer | undefined;
afterEach(async () => {
  __resetOrphanedActions();
  if (stub) { await stub.close(); stub = undefined; }
});

// ── C6 / U3: failures inside the cleanup network ──

test('uncaught failure in cleanup ends stopped, never errored', async () => {
  const { db, close } = await makeTestDb();
  const { id } = await runAndStop(db, buildSpec('wf-fail', chain(step('bad', 'SCRIPT', THROW))));
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  expect((await stepRow(db, id, 'bad')).state).toBe('ERRORED');
  const ops = await operatorTrace(db, id);
  expect(ops.some(m => m?.startsWith('Operator Stop cleanup ended: step failed'))).toBe(true);
  await close();
});

test('step-level TRY inside cleanup still catches', async () => {
  const { db, close } = await makeTestDb();
  const cleanup = chain(step('bad', 'SCRIPT', { ...THROW, try_specifications: [{ mode: 'ERROR', catch_id: 'c2' }] }));
  cleanup.steps.push(
    step('c2', 'CATCH', { catch_id: 'c2' }),
    step('mark2', 'SCRIPT', { script_config: { source: 'var y = 1;' } }),
    step('ret2', 'RETURN', { return_config: { command: 'COMPLETE' } }),
  );
  cleanup.connections.push({ from_step_id: 'c2', to_step_id: 'mark2' }, { from_step_id: 'mark2', to_step_id: 'ret2' });
  const { id } = await runAndStop(db, buildSpec('wf-step-try', cleanup));
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(await traceOf(db, id)).toContainEqual(['mark2', 'COMPLETED', null]); // CATCH2 ran
  expect(await operatorTrace(db, id)).toContain('Operator Stop cleanup ended: RETURN reached');
  const ops = await operatorTrace(db, id);
  expect(ops.some(m => m?.includes('step failed'))).toBe(false);
  await close();
});

test('a nested RETURN ABANDON inside the cleanup ends stopped, not aborted', async () => {
  const { db, close } = await makeTestDb();
  const cleanup = chain(step('bad', 'SCRIPT', { ...THROW, try_specifications: [{ mode: 'ERROR', catch_id: 'c2' }] }));
  cleanup.steps.push(step('c2', 'CATCH', { catch_id: 'c2' }), step('ret2', 'RETURN', { return_config: { command: 'ABANDON' } }));
  cleanup.connections.push({ from_step_id: 'c2', to_step_id: 'ret2' });
  const { id } = await runAndStop(db, buildSpec('wf-redirect', cleanup));
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  // Final review: a nested ABANDON ends the cleanup like the Operator RETURN itself (C5).
  expect(await operatorTrace(db, id)).toContain('Operator Stop cleanup ended: RETURN reached');
  await close();
});

test('workflow-level ERROR row does not catch a cleanup failure', async () => {
  const { db, close } = await makeTestDb();
  const cleanup = chain(step('bad', 'SCRIPT', THROW));
  cleanup.steps.push(
    step('ce', 'CATCH', { catch_id: 'catchE' }),
    step('markE', 'SCRIPT', { script_config: { source: 'var y = 1;' } }),
    step('retE', 'RETURN', { return_config: { command: 'ABANDON' } }),
  );
  cleanup.connections.push({ from_step_id: 'ce', to_step_id: 'markE' }, { from_step_id: 'markE', to_step_id: 'retE' });
  const spec = buildSpec('wf-wf-try', cleanup, { tries: [{ mode: 'ERROR', catch_id: 'catchE' }, ROW] });
  const { id } = await runAndStop(db, spec);
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(await stepRow(db, id, 'markE')).toBeUndefined();
  expect((await traceOf(db, id)).some(([oid]) => oid === 'ce' || oid === 'markE')).toBe(false);
  const ops = await operatorTrace(db, id);
  expect(ops.some(m => m?.startsWith('Operator Stop cleanup ended: step failed'))).toBe(true);
  await close();
});

// ── C4 / C13: skip ──

test('skip during cleanup: Stop now ends stopped and halts the cleanup', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const spec = buildSpec('wf-skip-cleanup', chain(step('cact', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG })));
  const { id, uid } = await runAndStop(db, spec, deps);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  const live = await stepRow(db, id, 'cact');
  expect(live.state).toBe('WAITING_ACTION');
  const aid = live.actionInstanceId as string;

  await requestSkipCleanup(db, id, 'stop', { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'STOP');
  const row = await stepRow(db, id, 'cact');
  if (row && row.state === 'WAITING_ACTION') {
    await applyActionTerminal(db, deps, client, row.id, { kind: 'STOPPED' });
    await pumpUntilQuiet(db, deps);
  }

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(await stepRow(db, id, 'ret')).toBeUndefined();
  expect(await operatorTrace(db, id)).toContain('Operator Stop cleanup ended: skipped by operator');
  await close();
});

test('second Stop during halting skips cleanup', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const main: Net = {
    steps: [step('start', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }), step('end', 'END')],
    connections: [{ from_step_id: 'start', to_step_id: 'act' }, { from_step_id: 'act', to_step_id: 'end' }],
  };
  const spec = buildSpec('wf-skip-halt', chain(step('safe', 'SCRIPT', { script_config: { source: 'var x = 1;' } })), { main });
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'act')).state).toBe('WAITING_ACTION');

  await requestStop(db, wi.id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping'); // still draining the live action
  await requestSkipCleanup(db, wi.id, 'stop', { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  const row = await stepRow(db, wi.id, 'act');
  if (row.state === 'WAITING_ACTION') {
    await applyActionTerminal(db, deps, client, row.id, { kind: 'STOPPED' });
    await pumpUntilQuiet(db, deps);
  }

  expect((await instanceRow(db, wi.id)).status).toBe('stopped');
  expect(await stepRow(db, wi.id, 'safe')).toBeUndefined();
  expect((await traceOf(db, wi.id)).some(([oid]) => oid === 'c')).toBe(false); // the CATCH never activated
  expect(await operatorTrace(db, wi.id)).toEqual([]);
  await close();
});

test('skip with a parked WAIT ALL in the cleanup network still settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const cleanup: Net = {
    steps: [
      step('c', 'CATCH', { catch_id: 'cleanup' }),
      step('par', 'SCRIPT', { script_config: { source: 'var x = 1;' } }), // forks
      step('quick', 'SCRIPT', { script_config: { source: 'var y = 1;' } }),
      step('ack', 'USER_INTERACTION'),
      step('wa', 'WAIT ALL'),
      step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 'c', to_step_id: 'par' },
      { from_step_id: 'par', to_step_id: 'quick' }, { from_step_id: 'par', to_step_id: 'ack' },
      { from_step_id: 'quick', to_step_id: 'wa' }, { from_step_id: 'ack', to_step_id: 'wa' },
      { from_step_id: 'wa', to_step_id: 'ret' },
    ],
  };
  const { id, uid } = await runAndStop(db, buildSpec('wf-skip-wa', cleanup), deps);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  const wa = await stepRow(db, id, 'wa');
  expect(wa.state).toBe('EXECUTING');
  expect(wa.actionInstanceId).toBeNull();

  await requestSkipCleanup(db, id, 'stop', { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, id)).status).toBe('stopped');
  expect(await operatorTrace(db, id)).toContain('Operator Stop cleanup ended: skipped by operator');
  await close();
});

test('a cleanup already ran but no skip was asked: the halt does not end it as skipped', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = buildSpec('wf-noskip', chain(step('safe', 'SCRIPT', { script_config: { source: 'var x = 1;' } })));
  const wi = await seedInstance(db, spec, 'stopping', {
    operatorCleanup: {
      kind: 'stop', phase: 'cleanup', catchOid: 'c', haltStartedAt: '2026-01-01T00:00:00.000Z',
      cleanupStartedAt: '2026-01-01T00:00:00.000Z', inheritedHolds: [], inheritedUse: {}, abortPending: [],
    },
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runControlPass(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping');
  expect(await operatorTrace(db, wi.id)).toEqual([]);
  expect(errorSpy.mock.calls.some(args => String(args[0]).includes('cleanup_skip'))).toBe(true);
  errorSpy.mockRestore();
  await close();
});

test('errored settle from stopping during a skip of a running cleanup ends stopped', async () => {
  const { db, close } = await makeTestDb();
  const { id, uid } = await runAndStop(db, buildSpec('wf-halt-redirect', chain(step('ack', 'USER_INTERACTION'))));
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  await requestSkipCleanup(db, id, 'stop', { kind: 'user', userId: uid });
  expect((await instanceRow(db, id)).status).toBe('stopping');

  // A give-up (control.ts) or recovery settle from the skip's re-halt, before it drains.
  await db.transaction(async (tx: any) => {
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, id));
    const ctx = await openContext(tx, row, testDeps());
    await settleTerminal(tx, ctx, 'errored', 'errored', () => new Date(), 'stopping');
  });

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  expect(await operatorTrace(db, id)).toContain('Operator Stop cleanup ended: step failed');
  await close();
});

// ── U6: equipment stays held through cleanup ──

test('cleanup reuses a held resource', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const main: Net = {
    steps: [
      step('start', 'START'),
      step('hold', 'USER_INTERACTION', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Valve' }] }),
      step('end', 'END'),
    ],
    connections: [{ from_step_id: 'start', to_step_id: 'hold' }, { from_step_id: 'hold', to_step_id: 'end' }],
  };
  const cleanup = chain(
    step('use', 'SCRIPT', {
      script_config: { source: 'var x = 1;' },
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Valve' }, { command_type: 'Release', resource_name: 'Valve' },
      ],
    }),
    step('ack', 'USER_INTERACTION'),
  );
  const spec = buildSpec('wf-held', cleanup, {
    main, extra: { resource_property_specifications: [{ name: 'Valve', resource_type: 'binary exclusive use' }] },
  });
  const { id } = await runAndStop(db, spec, deps);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  expect((await stepRow(db, id, 'use')).state).toBe('COMPLETED'); // activated at once, not WAITING
  expect((await stepRow(db, id, 'ack')).state).toBe('WAITING_USER');
  const mgr = InMemoryResourceManager.fromJSON((await instanceRow(db, id)).engineState.resources);
  const valve = mgr.getSnapshot().find(e => e.resourceName === 'Valve')!;
  expect(valve.inUse).toBe(1); // still the main flow's hold: the cleanup's Release was a no-op

  await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, id)).status).toBe('stopped');
  await close();
});

test('a real Release in the cleanup gives the inherited hold back: a later Acquire goes through the manager', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const main: Net = {
    steps: [
      step('start', 'START'),
      step('hold', 'USER_INTERACTION', { resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Valve' }] }),
      step('end', 'END'),
    ],
    connections: [{ from_step_id: 'start', to_step_id: 'hold' }, { from_step_id: 'hold', to_step_id: 'end' }],
  };
  const cleanup = chain(
    step('rel', 'SCRIPT', {
      script_config: { source: 'var x = 1;' },
      resource_command_specifications: [{ command_type: 'Release', resource_name: 'Valve' }],
    }),
    step('use', 'SCRIPT', {
      script_config: { source: 'var x = 1;' },
      resource_command_specifications: [{ command_type: 'Acquire', resource_name: 'Valve' }],
    }),
    step('ack', 'USER_INTERACTION'),
  );
  const spec = buildSpec('wf-held-released', cleanup, {
    main, extra: { resource_property_specifications: [{ name: 'Valve', resource_type: 'binary exclusive use' }] },
  });
  const { id } = await runAndStop(db, spec, deps);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  expect((await stepRow(db, id, 'use')).state).toBe('COMPLETED');
  expect((await stepRow(db, id, 'ack')).state).toBe('WAITING_USER');
  const es = (await instanceRow(db, id)).engineState;
  expect(es.operatorCleanup.inheritedHolds).toEqual([]);
  expect(es.operatorCleanup.inheritedUse).toEqual({});
  const valve = InMemoryResourceManager.fromJSON(es.resources).getSnapshot().find(e => e.resourceName === 'Valve')!;
  expect(valve.inUse).toBe(1); // released (0), then really acquired again through the manager (1)

  await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, id)).status).toBe('stopped');
  await close();
});

// ── §5.4: restart mid-cleanup ──

test('restart mid-cleanup continues without re-activating the CATCH', async () => {
  const { db, close } = await makeTestDb();
  const spec = buildSpec('wf-restart', chain(step('ack', 'USER_INTERACTION')));
  const { id } = await runAndStop(db, spec, testDeps());
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');

  // A fresh engine process: new deps, no in-memory state; every context is opened from the row.
  __resetOrphanedActions();
  const fresh = testDeps();
  await pumpUntilQuiet(db, fresh);
  await runControlPass(db, fresh);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, fresh);
  await pumpUntilQuiet(db, fresh);

  expect((await instanceRow(db, id)).status).toBe('stopped');
  const catchRuns = await db.select().from(stepRun).where(and(eq(stepRun.workflowInstanceId, id), eq(stepRun.stepOid, 'c')));
  expect(catchRuns).toHaveLength(1);
  expect((await traceOf(db, id)).filter(([oid, state]) => oid === 'c' && state === 'COMPLETED')).toHaveLength(1);
  expect((await operatorTrace(db, id)).filter(m => m?.includes('cleanup started'))).toHaveLength(1);
  expect(await operatorTrace(db, id)).toContain('Operator Stop cleanup ended: RETURN reached');
  await close();
});

test('pending cleanup aborts survive a restart', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const first = makeHttpDeps(stub, clock);
  const cleanup: Net = {
    steps: [
      step('c', 'CATCH', { catch_id: 'cleanup' }),
      step('par', 'SCRIPT', { script_config: { source: 'var x = 1;' } }), // forks
      step('cact', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
      step('ack', 'USER_INTERACTION'),
      step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 'c', to_step_id: 'par' },
      { from_step_id: 'par', to_step_id: 'cact' }, { from_step_id: 'par', to_step_id: 'ack' },
      { from_step_id: 'ack', to_step_id: 'ret' },
    ],
  };
  const { id } = await runAndStop(db, buildSpec('wf-durable-abort', cleanup), first.deps);
  const aid = (await stepRow(db, id, 'cact')).actionInstanceId as string;
  expect(aid).toBeTruthy();

  // The RETURN commits the teardown; the engine "crashes" before its next loop unit.
  await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, first.deps);
  expect((await instanceRow(db, id)).status).toBe('stopped');
  expect((await instanceRow(db, id)).engineState.operatorCleanup.pendingAborts).toEqual([
    expect.objectContaining({ actionInstanceId: aid, serverUri: stub.uri }),
  ]);

  __resetOrphanedActions(); // a fresh process: nothing in memory
  const second = makeHttpDeps(stub, clock);
  const sendSpy = vi.spyOn(second.client, 'sendCommand');
  const deleteSpy = vi.spyOn(second.client, 'deleteInstance');
  await pumpUntilQuiet(db, second.deps);

  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'ABORT');
  expect(deleteSpy).toHaveBeenCalledWith(stub.uri, aid);
  expect((await instanceRow(db, id)).engineState.operatorCleanup.pendingAborts).toEqual([]);
  // Sent once: a further pump does not repeat it.
  await pumpUntilQuiet(db, second.deps);
  expect(sendSpy.mock.calls.filter(c => c[2] === 'ABORT')).toHaveLength(1);
  await close();
});

test('a scan before the ending transaction commits does not strand the abort', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { deps, client } = makeHttpDeps(stub, makeClock());
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const spec = buildSpec('wf-flag-race', chain());
  const wi = await seedInstance(db, spec, 'stopped', {
    operatorCleanup: {
      kind: 'stop', phase: 'cleanup', catchOid: 'c', haltStartedAt: '2026-01-01T00:00:00.000Z',
      cleanupStartedAt: '2026-01-01T00:00:00.000Z', inheritedHolds: [], inheritedUse: {}, abortPending: [],
      pendingAborts: [],
    },
  });
  const { instanceId: aid } = await client.invoke(stub.uri, 'act-1', {
    environment_oid: 'env-1', workflow_instance_id: wi.id, step_instance_id: 'placeholder', step_oid: 'cact', input_parameters: [],
  });

  __resetOrphanedActions();
  expect(await finalizeOrphanedActions(db, deps)).toBe(false); // start-up scan: nothing anywhere
  notePendingAbortsQueued(); // endOperatorCleanup, inside its still-open transaction
  expect(await finalizeOrphanedActions(db, deps)).toBe(false); // another slot scans before the commit
  // ...and now the ending transaction commits.
  await db.update(workflowInstance).set({
    engineState: { ...(await instanceRow(db, wi.id)).engineState, operatorCleanup: {
      ...(await instanceRow(db, wi.id)).engineState.operatorCleanup,
      pendingAborts: [{ stepRowId: '00000000-0000-0000-0000-000000000000', serverUri: stub.uri, actionInstanceId: aid, queuedAt: new Date().toISOString() }],
    } },
  }).where(eq(workflowInstance.id, wi.id));

  const deadline = Date.now() + 5000;
  while (!sendSpy.mock.calls.some(c => c[2] === 'ABORT') && Date.now() < deadline) {
    await finalizeOrphanedActions(db, deps);
    await new Promise(r => setTimeout(r, 50));
  }
  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'ABORT');
  expect((await instanceRow(db, wi.id)).engineState.operatorCleanup.pendingAborts).toEqual([]);
  await close();
});
