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
// Spec 2026-11-06 (Operator Stop / Operator Abort TRY modes) §5.2, Task 7: an Operator Abort with
// a matching root OPERATOR_ABORT row halts the main flow (ABORT to live actions, active rows
// ABORTED), waits until every aborted action confirmed its terminal or
// OPERATOR_ABORT_CONFIRM_TIMEOUT_MS passed (C11), then runs the cleanup CATCH network and settles
// `aborted` (C2). With no row, the abort stays today's single pass (C9 / anti-goal). Also: Abort
// during a Stop cleanup (C4), Abort now (skip), queued runtimes (C12), cleanup failures (C6).
import { afterEach, expect, test, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { appUser, workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestAbort, requestSkipCleanup, requestStop } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { trackTransactions, guardClient } from './helpers/no-network-in-tx.js';
import { applyActionTerminal } from '../src/actions/monitor.js';
import { runControlPass } from '../src/core/control.js';
import { __resetOrphanedActions } from '../src/core/operator-cleanup-flow.js';
import { OPERATOR_ABORT_CONFIRM_TIMEOUT_MS } from '../src/core/operator-cleanup.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };

const ABORT_ROW = { mode: 'OPERATOR_ABORT', catch_id: 'cleanup' };
const STOP_ROW = { mode: 'OPERATOR_STOP', catch_id: 'scleanup' };

type Step = ReturnType<typeof step>;
type Conn = { from_step_id: string; to_step_id: string; source_handle_id?: string };
type Net = { steps: Step[]; connections: Conn[] };

/** START -> ACTION PROXY (act) -> END */
const ACTION_MAIN: Net = {
  steps: [step('start', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'act' }, { from_step_id: 'act', to_step_id: 'end' }],
};
/** START -> USER_INTERACTION (ui) -> END */
const USER_MAIN: Net = {
  steps: [step('start', 'START'), step('ui', 'USER_INTERACTION'), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'end' }],
};

/** CATCH(catchId) -> body... -> RETURN ABANDON */
function net(prefix: string, catchId: string, body: Step[], catchExtra: Record<string, unknown> = {}): Net {
  const c = step(`${prefix}c`, 'CATCH', { catch_id: catchId, ...catchExtra });
  const ret = step(`${prefix}ret`, 'RETURN', { return_config: { command: 'ABANDON' } });
  const chainSteps = [c, ...body, ret];
  const connections = chainSteps.slice(1).map((s, i) => ({ from_step_id: chainSteps[i].oid, to_step_id: s.oid }));
  return { steps: chainSteps, connections };
}

const SAFE = () => step('safe', 'SCRIPT', { script_config: { source: 'var x = 1;' } });
const OUTPUTS = {
  output_parameter_specifications: [
    { id: 'Reason', target: 'Op.r' }, { id: 'Message', target: 'Op.m' },
    { id: 'Step', target: 'Op.s' }, { id: 'StepID', target: 'Op.i' },
  ],
};

function buildSpec(oid: string, opts: { tries?: unknown[]; main?: Net; nets?: Net[] } = {}) {
  const main = opts.main ?? ACTION_MAIN;
  const nets = opts.nets ?? [net('', 'cleanup', [SAFE()], OUTPUTS)];
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Op', entries: ['r', 'm', 's', 'i'].map(n => ({ name: n, value: 'x' })) }],
    ...(opts.tries ? { try_specifications: opts.tries } : {}),
    steps: [...main.steps, ...nets.flatMap(n => n.steps)],
    connections: [...main.connections, ...nets.flatMap(n => n.connections)],
  };
}

// ── helpers (as in operator-stop-cleanup.test.ts) ──

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
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
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

async function operatorTrace(db: any, instanceId: string): Promise<Array<string | null | undefined>> {
  return (await traceOf(db, instanceId)).filter(t => t[1] === 'OPERATOR').map(t => t[2]);
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function stepStates(db: any, instanceId: string): Promise<Array<[string, string]>> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.map((r: any): [string, string] => [r.stepOid, r.state]).sort((a: [string, string], b: [string, string]) => a[0].localeCompare(b[0]));
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

async function installStatusLog(db: any): Promise<(id: string) => Promise<string[]>> {
  await db.execute(sql.raw('create table status_log (id serial primary key, instance_id uuid not null, status text not null)'));
  await db.execute(sql.raw(`create function log_status() returns trigger as $$
    begin
      if new.status is distinct from old.status then
        insert into status_log (instance_id, status) values (new.id, new.status);
      end if;
      return new;
    end $$ language plpgsql`));
  await db.execute(sql.raw('create trigger status_log_t after update on workflow_instance for each row execute function log_status()'));
  return async (id: string) => {
    const res: any = await db.execute(sql`select status from status_log where instance_id = ${id} order by id`);
    return (res.rows ?? res).map((r: any) => r.status);
  };
}

const STARTED = (label: 'Stop' | 'Abort', uid: string) => `Operator ${label} cleanup started [by ${uid}]`;

/** Start the instance and run it to its first park (the action is invoked: WAITING_ACTION). */
async function runToAction(db: any, spec: any, deps: EngineDeps): Promise<{ id: string; uid: string; aid: string }> {
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const act = await stepRow(db, wi.id, 'act');
  expect(act.state).toBe('WAITING_ACTION');
  expect(act.actionInstanceId).toBeTruthy();
  return { id: wi.id, uid, aid: act.actionInstanceId };
}

let stub: StubActionServer | undefined;
afterEach(async () => {
  __resetOrphanedActions();
  if (stub) { await stub.close(); stub = undefined; }
});

// ── C9 / anti-goal ──

test('no row: Abort is today\'s single pass', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const deleteSpy = vi.spyOn(client, 'deleteInstance');

  const results: Array<{ status: string; finalState: string; trace: unknown; states: unknown }> = [];
  // The same spec without any row, and with only an OPERATOR_STOP row (no OPERATOR_ABORT row).
  for (const [oid, tries] of [['wf-norow', undefined], ['wf-stoprow', [STOP_ROW]]] as const) {
    const spec = buildSpec(oid, {
      ...(tries ? { tries: [...tries] } : {}),
      nets: [net('', 'cleanup', [SAFE()]), net('s', 'scleanup', [step('ssafe', 'SCRIPT', { script_config: { source: 'var y = 1;' } })])],
    });
    const { id, uid, aid } = await runToAction(db, spec, deps);
    await requestAbort(db, id, { kind: 'user', userId: uid });
    // The action finished on the server just as the Abort came in, and its status check is due:
    // today the due-wake never looks at an aborting instance, so the abort pass alone decides
    // (the step ends ABORTED, never COMPLETED).
    stub.control.advance(aid, 'COMPLETED');
    clock.advance(6);
    await pumpUntilQuiet(db, deps);
    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(stub!.uri, aid, 'ABORT');
      expect(deleteSpy).toHaveBeenCalledWith(stub!.uri, aid);
    });
    const inst = await instanceRow(db, id);
    results.push({ status: inst.status, finalState: inst.finalState, trace: await traceOf(db, id), states: await stepStates(db, id) });
  }
  expect(results[0].status).toBe('aborted');
  expect(results[0].finalState).toBe('aborted');
  expect(results[0].states).toEqual([['act', 'ABORTED']]);
  expect((results[0].trace as unknown[]).some((t: any) => t[1] === 'OPERATOR')).toBe(false);
  expect((results[0].trace as unknown[]).at(-1)).toEqual(['act', 'ABORTED', null]);
  expect(results[1]).toEqual(results[0]);
  await close();
});

// ── §5.2 / C11 ──

test('with row: waits for ABORT confirmation, then runs cleanup, settles aborted', async () => {
  const { db, close } = await makeTestDb();
  const statuses = await installStatusLog(db);
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const deleteSpy = vi.spyOn(client, 'deleteInstance');
  const { id, uid, aid } = await runToAction(db, buildSpec('wf-confirm', { tries: [ABORT_ROW] }), deps);

  await requestAbort(db, id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  // ABORT sent after commit; the action has not confirmed yet (the stub leaves it as it was).
  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'ABORT');
  expect(deleteSpy).not.toHaveBeenCalledWith(stub.uri, aid);
  expect((await instanceRow(db, id)).status).toBe('aborting');
  expect((await stepRow(db, id, 'act')).state).toBe('WAITING_ACTION');
  expect(await stepRow(db, id, 'c')).toBeUndefined(); // the cleanup has not started
  expect(await operatorTrace(db, id)).toEqual([]);

  // A later pass with nothing confirmed and no timeout does nothing.
  clock.advance(10);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, id)).status).toBe('aborting');
  expect(await stepRow(db, id, 'c')).toBeUndefined();

  // The server reports the terminal: the row ends ABORTED (no routing, no TRY), then the cleanup.
  stub.control.advance(aid, 'ABORTED');
  clock.advance(6);
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect(await statuses(id)).toEqual(['running', 'aborting', 'aborting_cleanup', 'aborted']);
  expect((await stepRow(db, id, 'act')).state).toBe('ABORTED');
  expect(await stepRow(db, id, 'end')).toBeUndefined();
  expect((await stepRow(db, id, 'safe')).state).toBe('COMPLETED');
  const trace = await traceOf(db, id);
  // The act's ABORTED trace lands before the cleanup starts.
  const actAborted = trace.findIndex(t => t[0] === 'act' && t[1] === 'ABORTED');
  const started = trace.findIndex(t => t[1] === 'OPERATOR');
  expect(actAborted).toBeGreaterThanOrEqual(0);
  expect(actAborted).toBeLessThan(started);
  expect(trace.filter(t => t[0] === 'act' && t[1] === 'ABORTED')).toHaveLength(1);
  expect(await operatorTrace(db, id)).toEqual([STARTED('Abort', uid), 'Operator Abort cleanup ended: RETURN reached']);
  expect(inst.propertyStore).toMatchObject({
    'Op.r': 'OPERATOR_ABORT', 'Op.m': 'Aborted by operator Jane Doe', 'Op.s': '', 'Op.i': '',
  });
  await close();
});

test('confirm timeout starts cleanup', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const deleteSpy = vi.spyOn(client, 'deleteInstance');
  const { id, uid, aid } = await runToAction(db, buildSpec('wf-timeout', { tries: [ABORT_ROW] }), deps);

  await requestAbort(db, id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, id)).status).toBe('aborting');

  clock.advance(OPERATOR_ABORT_CONFIRM_TIMEOUT_MS / 1000 - 1);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, id)).status).toBe('aborting');
  expect(await stepRow(db, id, 'c')).toBeUndefined();

  clock.advance(1); // exactly 30 000 ms after the halt began
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('aborted');
  expect((await stepRow(db, id, 'act')).state).toBe('ABORTED');
  expect((await stepRow(db, id, 'safe')).state).toBe('COMPLETED');
  expect(sendSpy.mock.calls.filter(c => c[1] === aid && c[2] === 'ABORT').length).toBeGreaterThanOrEqual(2);
  expect(deleteSpy).toHaveBeenCalledWith(stub.uri, aid);
  expect(await operatorTrace(db, id)).toEqual([STARTED('Abort', uid), 'Operator Abort cleanup ended: RETURN reached']);
  await close();
});

// ── C4: Abort during a Stop cleanup ──

const ESCALATED = 'Operator Stop cleanup ended: escalated to Operator Abort';

function stopCleanupSpec(oid: string, tries: unknown[]) {
  return buildSpec(oid, {
    tries,
    main: USER_MAIN,
    nets: [
      net('s', 'scleanup', [step('sack', 'USER_INTERACTION')]),
      net('', 'cleanup', [SAFE()]),
    ],
  });
}

async function runIntoStopCleanup(db: any, spec: any, deps: EngineDeps): Promise<{ id: string; uid: string }> {
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await requestStop(db, wi.id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping_cleanup');
  expect((await stepRow(db, wi.id, 'sack')).state).toBe('WAITING_USER');
  return { id: wi.id, uid };
}

test('Abort during Stop cleanup with an OPERATOR_ABORT row runs the abort cleanup', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const { id, uid } = await runIntoStopCleanup(db, stopCleanupSpec('wf-esc-row', [STOP_ROW, ABORT_ROW]), deps);

  await requestAbort(db, id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect((await stepRow(db, id, 'sack')).state).toBe('ABORTED');
  expect((await stepRow(db, id, 'safe')).state).toBe('COMPLETED');
  expect(await operatorTrace(db, id)).toEqual([
    STARTED('Stop', uid), ESCALATED, STARTED('Abort', uid), 'Operator Abort cleanup ended: RETURN reached',
  ]);
  // The escalation is recorded before the abort halt.
  const trace = await traceOf(db, id);
  expect(trace.findIndex(t => t[2] === ESCALATED)).toBeLessThan(trace.findIndex(t => t[0] === 'sack' && t[1] === 'ABORTED'));
  await close();
});

test('Abort during Stop cleanup without an OPERATOR_ABORT row ends aborted at once', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const { id, uid } = await runIntoStopCleanup(db, stopCleanupSpec('wf-esc-norow', [STOP_ROW]), deps);

  await requestAbort(db, id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect((await stepRow(db, id, 'sack')).state).toBe('ABORTED');
  expect(await stepRow(db, id, 'safe')).toBeUndefined();
  expect(await operatorTrace(db, id)).toEqual([STARTED('Stop', uid), ESCALATED]);
  const trace = await traceOf(db, id);
  expect(trace.findIndex(t => t[2] === ESCALATED)).toBeLessThan(trace.findIndex(t => t[0] === 'sack' && t[1] === 'ABORTED'));
  await close();
});

// ── C4: Abort now (skip) ──

test('Abort now during abort cleanup ends aborted', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = buildSpec('wf-skip', { tries: [ABORT_ROW], main: USER_MAIN, nets: [net('', 'cleanup', [step('ack', 'USER_INTERACTION')])] });
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await requestAbort(db, wi.id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('aborting_cleanup');
  expect((await stepRow(db, wi.id, 'ack')).state).toBe('WAITING_USER');

  await requestSkipCleanup(db, wi.id, 'abort', { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect((await stepRow(db, wi.id, 'ack')).state).toBe('ABORTED');
  expect(await stepRow(db, wi.id, 'ret')).toBeUndefined();
  expect(await operatorTrace(db, wi.id)).toEqual([STARTED('Abort', uid), 'Operator Abort cleanup ended: skipped by operator']);
  await close();
});

test('Abort now during the abort halt skips the cleanup (C13)', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  const { id, uid } = await runToAction(db, buildSpec('wf-skip-halt', { tries: [ABORT_ROW] }), deps);
  await requestAbort(db, id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, id)).status).toBe('aborting');

  await requestSkipCleanup(db, id, 'abort', { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('aborted');
  expect((await stepRow(db, id, 'act')).state).toBe('ABORTED');
  expect(await stepRow(db, id, 'c')).toBeUndefined();
  expect(await operatorTrace(db, id)).toEqual([]);
  await close();
});

// ── C12 ──

test('queued runtime: Abort runs no cleanup', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, buildSpec('wf-queued', { tries: [ABORT_ROW], main: USER_MAIN }));
  await requestAbort(db, wi.id, { kind: 'system', label: 'test' });
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect(await stepStates(db, wi.id)).toEqual([]);
  expect(await traceOf(db, wi.id)).toEqual([]);
  await close();
});

// ── C6 ──

test('uncaught failure in abort cleanup ends aborted', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = buildSpec('wf-fail', {
    tries: [ABORT_ROW], main: USER_MAIN,
    nets: [net('', 'cleanup', [step('bad', 'SCRIPT', { script_config: { source: 'throw new Error("boom");' } })])],
  });
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await requestAbort(db, wi.id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect((await stepRow(db, wi.id, 'ui')).state).toBe('ABORTED');
  expect((await stepRow(db, wi.id, 'bad')).state).toBe('ERRORED');
  const ops = await operatorTrace(db, wi.id);
  expect(ops[0]).toBe(STARTED('Abort', uid));
  expect(ops.some(m => m?.startsWith('Operator Abort cleanup ended: step failed'))).toBe(true);
  await close();
});

// ── data safety: no network inside a transaction ──

test('confirmed abort sends its commands only after commit', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const allowlist = [new URL(stub.uri).origin];
  const raw = new ActionClient(allowlist);
  const tracked = trackTransactions(db);
  const client = guardClient(raw, tracked.openCount);
  const sendSpy = vi.spyOn(raw, 'sendCommand');
  const deleteSpy = vi.spyOn(raw, 'deleteInstance');
  const deps = testDeps({ now: clock.now, invoker: httpActionInvoker(client, async () => stub!.uri) });
  const errors = vi.spyOn(console, 'error');

  const spec = buildSpec('wf-guard', { tries: [ABORT_ROW] });
  const wi = await seedQueued(db, spec);
  await db.update(workflowInstance).set({ status: 'aborting', startedAt: new Date() }).where(eq(workflowInstance.id, wi.id));
  const { instanceId: aid } = await raw.invoke(stub.uri, 'act-1', {
    environment_oid: 'env-1', workflow_instance_id: 'wi', step_instance_id: 'si', step_oid: 'act', input_parameters: [],
  });
  stub.control.advance(aid, 'RUNNING');
  const [act] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
    actionInstanceId: aid, actionServerUri: stub.uri, startedAt: new Date(),
  }).returning();

  expect(await runControlPass(tracked.db, deps)).toBe(true);
  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'ABORT');
  expect((await stepRow(db, wi.id, 'act')).state).toBe('WAITING_ACTION');
  expect((await instanceRow(db, wi.id)).status).toBe('aborting');

  await applyActionTerminal(tracked.db, deps, client, act.id, { kind: 'ABORTED' });
  expect((await stepRow(db, wi.id, 'act')).state).toBe('ABORTED');
  expect(deleteSpy).toHaveBeenCalledWith(stub.uri, aid);

  expect(await runControlPass(tracked.db, deps)).toBe(true);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect((await stepRow(db, wi.id, 'safe')).state).toBe('COMPLETED');
  expect(errors.mock.calls.some(c => c.some(a => String(a).includes('inside a transaction')))).toBe(false);
  errors.mockRestore();
  await close();
});

test('a status check confirms the abort when no event stream is open', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const spec = buildSpec('wf-poll', { tries: [ABORT_ROW] });
  const wi = await seedQueued(db, spec);
  await db.update(workflowInstance).set({ status: 'aborting', startedAt: new Date() }).where(eq(workflowInstance.id, wi.id));
  const { instanceId: aid } = await client.invoke(stub.uri, 'act-1', {
    environment_oid: 'env-1', workflow_instance_id: 'wi', step_instance_id: 'si', step_oid: 'act', input_parameters: [],
  });
  stub.control.advance(aid, 'RUNNING'); // the stub moves RUNNING -> ABORTED on the ABORT command
  await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: spec.oid, stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
    actionInstanceId: aid, actionServerUri: stub.uri, startedAt: new Date(), wakeAt: new Date('2030-01-01T00:00:00.000Z'),
  });

  // No SSE subscription (hand-seeded row): only the due-wake status check can see the terminal.
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect((await stepRow(db, wi.id, 'act')).state).toBe('ABORTED');
  expect((await stepRow(db, wi.id, 'safe')).state).toBe('COMPLETED');
  await close();
});
