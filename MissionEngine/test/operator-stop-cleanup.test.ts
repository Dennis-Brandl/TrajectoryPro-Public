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
// Spec 2026-11-06 (Operator Stop / Operator Abort TRY modes) §5.1, Task 5: an Operator Stop with a
// matching root OPERATOR_STOP row halts the main flow exactly as today, then runs the cleanup
// CATCH network with running semantics, then settles `stopped` on any RETURN or once the network
// drains. With no row, nothing changes (C9 / anti-goal).
import { afterEach, expect, test, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { appUser, workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestPause, requestStop } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { runControlPass } from '../src/core/control.js';
import { submitUserAction } from '../src/core/submit.js';
import { __resetOrphanedActions } from '../src/core/operator-cleanup-flow.js';
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

type Step = ReturnType<typeof step>;
type Conn = { from_step_id: string; to_step_id: string; source_handle_id?: string };

/** START -> SCRIPT(wait, repeating) -> END, plus a cleanup network (default CATCH -> safe -> RETURN). */
function buildSpec(oid: string, opts: {
  row?: boolean; tries?: unknown[]; main?: { steps: Step[]; connections: Conn[] };
  cleanup?: { steps: Step[]; connections: Conn[] }; extra?: Record<string, unknown>;
} = {}) {
  const main = opts.main ?? {
    steps: [step('start', 'START'), step('wait', 'SCRIPT', WAIT_FOREVER), step('end', 'END')],
    connections: [{ from_step_id: 'start', to_step_id: 'wait' }, { from_step_id: 'wait', to_step_id: 'end' }],
  };
  const cleanup = opts.cleanup ?? {
    steps: [
      step('c', 'CATCH', { catch_id: 'cleanup' }),
      step('safe', 'SCRIPT', { script_config: { source: 'var x = 1;' } }),
      step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [{ from_step_id: 'c', to_step_id: 'safe' }, { from_step_id: 'safe', to_step_id: 'ret' }],
  };
  const tries = opts.tries ?? (opts.row === false ? undefined : [ROW]);
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    ...(tries ? { try_specifications: tries } : {}),
    steps: [...main.steps, ...cleanup.steps],
    connections: [...main.connections, ...cleanup.connections],
    ...(opts.extra ?? {}),
  };
}

// ── helpers (copied from controls.test.ts) ──

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

async function seedInstance(db: any, spec: any, status: string): Promise<{ id: string }> {
  const oid = spec.oid;
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, queuedAt: new Date(),
    startedAt: new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved', engineState: {},
  }).returning();
  return { id: wi.id };
}

async function insertStep(db: any, instanceId: string, nodeOid: string, stepOid: string, stepType: string, state: string): Promise<void> {
  await db.insert(stepInstance).values({ workflowInstanceId: instanceId, nodeOid, stepOid, stepType, state, startedAt: new Date() });
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

async function stepStates(db: any, instanceId: string): Promise<Array<[string, string]>> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.map((r: any): [string, string] => [r.stepOid, r.state]).sort((a: [string, string], b: [string, string]) => a[0].localeCompare(b[0]));
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

/** Records every status a workflow_instance row passes through (an AFTER UPDATE trigger), so a
 *  transient status that never survives a whole pump (all within one transaction) is visible. */
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

const TODAY_STOP_TRACE = [['start', 'COMPLETED', null], ['wait', 'EXECUTING', null]];

const STARTED_BY = (uid: string) => [null, 'OPERATOR', `Operator Stop cleanup started [by ${uid}]`];
const ENDED = (why: string) => [null, 'OPERATOR', `Operator Stop cleanup ended: ${why}`];

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

// ── C9 / anti-goal ──

test('no row: Stop settles stopped with today\'s trace', async () => {
  const { db, close } = await makeTestDb();
  const withoutRow = buildSpec('wf-norow', { row: false });
  const a = await runAndStop(db, withoutRow);

  const inst = await instanceRow(db, a.id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  const trace = await traceOf(db, a.id);
  expect(trace.some(([, state]) => state === 'OPERATOR')).toBe(false);
  expect(await stepStates(db, a.id)).toEqual([['wait', 'CANCELLED']]);
  // Today's trace, pinned: START completes, the script runs once and waits, the stop cancels it
  // with no trace of its own (runStopping's convention).
  expect(trace).toEqual(TODAY_STOP_TRACE);

  // Same spec with an unrelated (bottom-up) workflow row only — still no Operator row: identical.
  const otherRow = buildSpec('wf-norow-2', { tries: [{ mode: 'ERROR', catch_id: 'cleanup' }] });
  const b = await runAndStop(db, otherRow);
  expect((await instanceRow(db, b.id)).status).toBe('stopped');
  expect(await traceOf(db, b.id)).toEqual(trace);
  expect(await stepStates(db, b.id)).toEqual(await stepStates(db, a.id));
  await close();
});

// ── §5.1 happy path ──

test('with row: Stop halts main flow, runs cleanup, settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const statuses = await installStatusLog(db);
  const { id, uid } = await runAndStop(db, buildSpec('wf-row'));

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  expect(await statuses(id)).toEqual(['running', 'stopping', 'stopping_cleanup', 'stopped']);
  expect((await stepRow(db, id, 'safe')).state).toBe('COMPLETED');
  expect((await stepRow(db, id, 'wait')).state).toBe('CANCELLED');
  expect(await stepRow(db, id, 'end')).toBeUndefined(); // no main-flow successor ran
  const trace = await traceOf(db, id);
  expect(trace).toContainEqual(STARTED_BY(uid));
  expect(trace).toContainEqual(ENDED('RETURN reached'));
  // The halt itself is exactly today's (U2): everything before the cleanup marker matches the
  // no-row run's whole trace.
  expect(trace.slice(0, trace.findIndex(t => t[1] === 'OPERATOR'))).toEqual(TODAY_STOP_TRACE);
  expect(trace.findIndex(t => t[1] === 'OPERATOR')).toBeLessThan(trace.findIndex(t => t[0] === 'c'));
  expect(trace.some(([oid]) => oid === 'end')).toBe(false);
  await close();
});

test('CATCH outputs: Reason / Message / Step / StepID for an Operator Stop', async () => {
  const { db, close } = await makeTestDb();
  const spec = buildSpec('wf-outputs', {
    extra: { value_property_specifications: [{ name: 'Op', entries: ['r', 'm', 's', 'i'].map(n => ({ name: n, value: 'x' })) }] },
    cleanup: {
      steps: [
        step('c', 'CATCH', {
          catch_id: 'cleanup',
          output_parameter_specifications: [
            { id: 'Reason', target: 'Op.r' }, { id: 'Message', target: 'Op.m' },
            { id: 'Step', target: 'Op.s' }, { id: 'StepID', target: 'Op.i' },
          ],
        }),
        step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
      ],
      connections: [{ from_step_id: 'c', to_step_id: 'ret' }],
    },
  });
  const { id } = await runAndStop(db, spec);
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(inst.propertyStore).toMatchObject({
    'Op.r': 'OPERATOR_STOP', 'Op.m': 'Stopped by operator Jane Doe', 'Op.s': '', 'Op.i': '',
  });
  await close();
});

// ── C5: any RETURN ends the cleanup ──

test.each(['COMPLETE', 'RESTART', 'GOTO', 'RETRY'])('RETURN %s ends cleanup as stopped', async (command) => {
  const { db, close } = await makeTestDb();
  const rc: Record<string, unknown> = { command };
  if (command === 'GOTO') rc.goto_step_oid = 'end';
  if (command === 'RESTART') rc.restart_mode = 'KEEP';
  const spec = buildSpec(`wf-ret-${command}`, {
    cleanup: {
      steps: [
        step('c', 'CATCH', { catch_id: 'cleanup' }),
        step('safe', 'SCRIPT', { script_config: { source: 'var x = 1;' } }),
        step('ret', 'RETURN', { return_config: rc }),
      ],
      connections: [{ from_step_id: 'c', to_step_id: 'safe' }, { from_step_id: 'safe', to_step_id: 'ret' }],
    },
  });
  const { id } = await runAndStop(db, spec);
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  expect((await stepRow(db, id, 'wait')).state).toBe('CANCELLED'); // main flow never restarted
  expect(await stepRow(db, id, 'end')).toBeUndefined();
  const trace = await traceOf(db, id);
  expect(trace.filter(([oid]) => oid === 'start')).toHaveLength(1);
  expect(trace).toContainEqual(ENDED('RETURN reached'));
  await close();
});

test('cleanup without RETURN on a branch: drained ends stopped', async () => {
  const { db, close } = await makeTestDb();
  const spec = buildSpec('wf-drained', {
    cleanup: {
      steps: [
        step('c', 'CATCH', { catch_id: 'cleanup' }),
        step('q', 'YES_NO', { yes_no_config: { yes_value: 'yes', no_value: 'no' } }),
        step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
        step('done', 'SCRIPT', { script_config: { source: 'var x = 1;' } }),
      ],
      connections: [
        { from_step_id: 'c', to_step_id: 'q' },
        { from_step_id: 'q', to_step_id: 'ret', source_handle_id: 'yes' },
        { from_step_id: 'q', to_step_id: 'done', source_handle_id: 'no' },
      ],
    },
  });
  const deps = testDeps();
  const { id } = await runAndStop(db, spec, deps);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  expect((await stepRow(db, id, 'q')).state).toBe('WAITING_USER');

  await submitUserAction(db, id, { step_oid: 'q', action: 'button_press', button_output: 'no' }, 0, deps);
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect((await stepRow(db, id, 'done')).state).toBe('COMPLETED');
  expect(await stepRow(db, id, 'ret')).toBeUndefined();
  expect(await traceOf(db, id)).toContainEqual(ENDED('cleanup finished'));
  await close();
});

test('RETURN with a parallel live action tears it down', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const deleteSpy = vi.spyOn(client, 'deleteInstance');
  const spec = buildSpec('wf-live', {
    cleanup: {
      steps: [
        step('c', 'CATCH', { catch_id: 'cleanup' }),
        step('par', 'SCRIPT', { script_config: { source: 'var x = 1;' } }), // forks: every outgoing edge routes
        step('cact', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
        step('ack', 'USER_INTERACTION'),
        step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
      ],
      connections: [
        { from_step_id: 'c', to_step_id: 'par' },
        { from_step_id: 'par', to_step_id: 'cact' },
        { from_step_id: 'par', to_step_id: 'ack' },
        { from_step_id: 'ack', to_step_id: 'ret' },
      ],
    },
  });
  const { id } = await runAndStop(db, spec, deps);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  const live = await stepRow(db, id, 'cact');
  expect(live.state).toBe('WAITING_ACTION');
  expect(live.actionInstanceId).toBeTruthy();
  const aid = live.actionInstanceId as string;

  await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, deps);
  expect(sendSpy).not.toHaveBeenCalledWith(stub.uri, aid, 'ABORT'); // never inside the transaction
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, id)).status).toBe('stopped');
  expect(await stepRow(db, id, 'cact')).toBeUndefined(); // torn down like RETURN ABANDON does
  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'ABORT');
  expect(deleteSpy).toHaveBeenCalledWith(stub.uri, aid);
  const trace = await traceOf(db, id);
  expect(trace).toContainEqual(['cact', 'IDLE', null]);
  expect(trace).toContainEqual(ENDED('RETURN reached'));
  await close();
});

test('cleanup with a Pilot user step', async () => {
  const { db, close } = await makeTestDb();
  const spec = buildSpec('wf-pilot', {
    cleanup: {
      steps: [
        step('c', 'CATCH', { catch_id: 'cleanup' }),
        step('ack', 'USER_INTERACTION'),
        step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
      ],
      connections: [{ from_step_id: 'c', to_step_id: 'ack' }, { from_step_id: 'ack', to_step_id: 'ret' }],
    },
  });
  const deps = testDeps();
  const { id } = await runAndStop(db, spec, deps);
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  expect((await stepRow(db, id, 'ack')).state).toBe('WAITING_USER');

  await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, deps);
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, id)).status).toBe('stopped');
  expect((await stepRow(db, id, 'ack')).state).toBe('COMPLETED');
  expect((await stepRow(db, id, 'ret')).state).toBe('COMPLETED');
  await close();
});

test('Stop from paused with a row runs cleanup', async () => {
  const { db, close } = await makeTestDb();
  const spec = buildSpec('wf-paused', {
    main: {
      steps: [step('start', 'START'), step('ui', 'USER_INTERACTION'), step('end', 'END')],
      connections: [{ from_step_id: 'start', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'end' }],
    },
  });
  const deps = testDeps();
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  await requestStop(db, wi.id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);

  expect((await instanceRow(db, wi.id)).status).toBe('stopped');
  expect((await stepRow(db, wi.id, 'ui')).state).toBe('CANCELLED');
  expect((await stepRow(db, wi.id, 'safe')).state).toBe('COMPLETED');
  expect(await traceOf(db, wi.id)).toContainEqual(STARTED_BY(uid));
  await close();
});

// ── spec §7 halt-termination boundary ──

const WAIT_ALL_MAIN = {
  steps: [step('start', 'START'), step('wa', 'WAIT ALL'), step('end', 'END')],
  connections: [] as Conn[],
};

test('parked WAIT ALL with a row: halt finishes and cleanup runs', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = buildSpec('wf-wa-row', { main: WAIT_ALL_MAIN });
  const wi = await seedInstance(db, spec, 'stopping');
  await insertStep(db, wi.id, spec.oid, 'wa', 'WAIT ALL', 'EXECUTING');

  expect(await runControlPass(db, deps)).toBe(true);
  await pumpUntilQuiet(db, deps);

  expect((await stepRow(db, wi.id, 'wa')).state).toBe('CANCELLED');
  expect((await stepRow(db, wi.id, 'safe')).state).toBe('COMPLETED');
  expect((await instanceRow(db, wi.id)).status).toBe('stopped');
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual([null, 'OPERATOR', 'Operator Stop cleanup started (by system)']);
  expect(trace).toContainEqual(ENDED('RETURN reached'));
  await close();
});

test('parked WAIT ALL without a row: unchanged', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const spec = buildSpec('wf-wa-norow', { main: WAIT_ALL_MAIN, row: false });
  const wi = await seedInstance(db, spec, 'stopping');
  await insertStep(db, wi.id, spec.oid, 'wa', 'WAIT ALL', 'EXECUTING');
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(await runControlPass(db, deps)).toBe(false);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping');
  expect((await stepRow(db, wi.id, 'wa')).state).toBe('EXECUTING');
  expect(await traceOf(db, wi.id)).toEqual([]);
  errorSpy.mockRestore();
  await close();
});

// ── U1 / C3: only the root's rows fire ──

function childSpec(oid: string, childRow: boolean) {
  return {
    local_id: 'parent-wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('p-start', 'START'), { ...step('proxy', 'WORKFLOW PROXY'), local_id: 'ChildRef' }, step('p-end', 'END')],
    connections: [{ from_step_id: 'p-start', to_step_id: 'proxy' }, { from_step_id: 'proxy', to_step_id: 'p-end' }],
    children: [{
      local_id: 'ChildRef', oid: `${oid}-child`, version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      ...(childRow ? { try_specifications: [ROW] } : {}),
      steps: [
        step('c-start', 'START'), step('c-wait', 'SCRIPT', WAIT_FOREVER), step('c-end', 'END'),
        step('cc', 'CATCH', { catch_id: 'cleanup' }),
        step('c-safe', 'SCRIPT', { script_config: { source: 'var x = 1;' } }),
        step('c-ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-wait' }, { from_step_id: 'c-wait', to_step_id: 'c-end' },
        { from_step_id: 'cc', to_step_id: 'c-safe' }, { from_step_id: 'c-safe', to_step_id: 'c-ret' },
      ],
    }],
  };
}

test('child workflow\'s own OPERATOR_STOP row is ignored', async () => {
  const { db, close } = await makeTestDb();
  const a = await runAndStop(db, childSpec('wf-child-row', true));
  const b = await runAndStop(db, childSpec('wf-child-norow', false));
  expect((await instanceRow(db, a.id)).status).toBe('stopped');
  expect((await instanceRow(db, b.id)).status).toBe('stopped');
  expect(await stepRow(db, a.id, 'c-safe')).toBeUndefined();
  expect(await traceOf(db, a.id)).toEqual(await traceOf(db, b.id));
  expect(await stepStates(db, a.id)).toEqual(await stepStates(db, b.id));
  await close();
});

// ── U5: bottom-up ABORT never fires an OPERATOR_ABORT row ──

test('bottom-up ABORT never fires an OPERATOR_ABORT row', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const main = {
    steps: [step('start', 'START'), step('ui', 'USER_INTERACTION'), step('end', 'END')],
    connections: [{ from_step_id: 'start', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'end' }],
  };
  const results: Array<{ status: string; trace: unknown; states: unknown }> = [];
  for (const [oid, tries] of [['wf-u5-row', [{ mode: 'OPERATOR_ABORT', catch_id: 'cleanup' }]], ['wf-u5-norow', undefined]] as const) {
    const spec = buildSpec(oid, { main, ...(tries ? { tries: [...tries] } : { row: false }) });
    const wi = await seedQueued(db, spec);
    await pumpUntilQuiet(db, deps);
    await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'fail', failure_mode: 'ABORT', error: 'boom' }, 0, deps);
    await pumpUntilQuiet(db, deps);
    results.push({ status: (await instanceRow(db, wi.id)).status, trace: await traceOf(db, wi.id), states: await stepStates(db, wi.id) });
  }
  expect(results[0].status).toBe('errored');
  expect(results[0]).toEqual(results[1]);
  await close();
});
