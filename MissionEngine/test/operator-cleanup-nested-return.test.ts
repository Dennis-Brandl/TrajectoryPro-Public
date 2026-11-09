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
// Spec 2026-11-06 (Operator Stop / Operator Abort TRY modes), final review: a RETURN reached in a
// CATCH network nested inside the Operator cleanup (a cleanup step's own step-level TRY) must
// never bring the halted main flow back (§5.4 "nothing outside the cleanup network may
// activate"; C5). RESTART / ABANDON / a GOTO that leaves the cleanup end the cleanup; a GOTO that
// stays inside it, RETRY and COMPLETE keep their normal meaning. Also: settles that bypass
// endOperatorCleanup (engine errors, a malformed RETURN) still abort live cleanup actions on other
// branches and say why the cleanup ended.
import { afterEach, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { appUser, workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestAbort, requestStop } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';
import { submitUserAction } from '../src/core/submit.js';
import { openContext, settleTerminal } from '../src/core/context.js';
import { settleFailedInstance } from '../src/loop.js';
import { activateAndCascade, processReadyStep } from '../src/core/transition.js';
import { __resetOrphanedActions } from '../src/core/operator-cleanup-flow.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});
type Step = ReturnType<typeof step>;
type Conn = { from_step_id: string; to_step_id: string };
type Kind = 'stop' | 'abort';

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
}];
const ACTION_CONFIG = { action_oid: 'act-1', environment_oid: 'env-1' };
const THROW = { script_config: { source: 'throw new Error("boom");' } };
const MODE: Record<Kind, string> = { stop: 'OPERATOR_STOP', abort: 'OPERATOR_ABORT' };
const LABEL: Record<Kind, string> = { stop: 'Operator Stop', abort: 'Operator Abort' };
const FINAL: Record<Kind, string> = { stop: 'stopped', abort: 'aborted' };
const MAIN_OIDS = ['start', 'ui', 'end'];

const MAIN = {
  steps: [step('start', 'START'), step('ui', 'USER_INTERACTION'), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'end' }],
};

/** CATCH -> bad (throws; its own TRY ERROR -> c2) -> [ack ->] RETURN ABANDON; c2 -> RETURN <nested>. */
function nestedSpec(oid: string, kind: Kind, nested: Record<string, unknown>, opts: { ack?: boolean } = {}) {
  const steps: Step[] = [
    step('c', 'CATCH', { catch_id: 'cleanup' }),
    step('bad', 'SCRIPT', { ...THROW, try_specifications: [{ mode: 'ERROR', catch_id: 'c2' }] }),
    ...(opts.ack ? [step('ack', 'USER_INTERACTION')] : []),
    step('ret', 'RETURN', { return_config: { command: 'ABANDON' } }),
    step('c2', 'CATCH', { catch_id: 'c2' }),
    step('ret2', 'RETURN', { return_config: nested }),
  ];
  const chain = ['c', 'bad', ...(opts.ack ? ['ack'] : []), 'ret'];
  const connections: Conn[] = [
    ...chain.slice(1).map((s, i) => ({ from_step_id: chain[i], to_step_id: s })),
    { from_step_id: 'c2', to_step_id: 'ret2' },
  ];
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    try_specifications: [{ mode: MODE[kind], catch_id: 'cleanup' }],
    steps: [...MAIN.steps, ...steps],
    connections: [...MAIN.connections, ...connections],
  };
}

async function seedQueued(db: any, spec: any): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id };
}

async function seedUser(db: any): Promise<string> {
  const [u] = await db.insert(appUser).values({
    email: `jane-${Math.random()}@example.com`, loginName: `jane${Math.floor(Math.random() * 1e9)}`, displayName: 'Jane Doe',
  }).returning();
  return u.id;
}

async function traceOf(db: any, id: string): Promise<Array<[string | null, string, string | null | undefined]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, id)).orderBy(traceEntry.id);
  return rows.map((r: any) => [r.stepOid, r.state, r.error]);
}
const operatorTrace = async (db: any, id: string) =>
  (await traceOf(db, id)).filter(([, s]) => s === 'OPERATOR').map(([, , m]) => m);
async function instanceRow(db: any, id: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, id));
  return row;
}
async function stepRow(db: any, id: string, oid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, id));
  return rows.find((r: any) => r.stepOid === oid);
}

/** Trace entries for main-flow steps after the cleanup started: must be none. */
async function mainFlowAfterCleanupStart(db: any, id: string, kind: Kind) {
  const t = await traceOf(db, id);
  const at = t.findIndex(([, s, m]) => s === 'OPERATOR' && m?.startsWith(`${LABEL[kind]} cleanup started`));
  expect(at).toBeGreaterThanOrEqual(0);
  return t.slice(at).filter(([oid]) => oid !== null && MAIN_OIDS.includes(oid));
}

/** Start the instance, park on the main user step, then (optionally rewrite the spec and) send
 *  the Stop / Abort as Jane Doe and pump. */
async function runAndHalt(db: any, spec: any, kind: Kind, opts: { deps?: EngineDeps; patch?: (s: any) => void } = {}) {
  const deps = opts.deps ?? testDeps();
  const uid = await seedUser(db);
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  if (opts.patch) {
    // A shape the validator rejects at start (a GOTO into a catch network, an unknown RETURN
    // command): applied to the running instance's own spec copy to reach the engine's defences.
    const patched = structuredClone(spec);
    opts.patch(patched);
    await db.update(workflowInstance).set({ specJsonb: patched }).where(eq(workflowInstance.id, wi.id));
  }
  if (kind === 'stop') await requestStop(db, wi.id, { kind: 'user', userId: uid });
  else await requestAbort(db, wi.id, { kind: 'user', userId: uid });
  await pumpUntilQuiet(db, deps);
  return { id: wi.id, uid, deps };
}

let stub: StubActionServer | undefined;
afterEach(async () => {
  __resetOrphanedActions();
  if (stub) { await stub.close(); stub = undefined; }
});

// ── Critical 1: nested RETURN RESTART / GOTO must not re-activate the halted main flow ──

for (const kind of ['stop', 'abort'] as const) {
  test(`${kind}: nested RETURN RESTART ends the cleanup, main flow never re-activated`, async () => {
    const { db, close } = await makeTestDb();
    const { id } = await runAndHalt(db, nestedSpec(`wf-n-restart-${kind}`, kind, { command: 'RESTART', restart_mode: 'KEEP' }), kind);
    const inst = await instanceRow(db, id);
    expect(inst.status).toBe(FINAL[kind]);
    expect(inst.finalState).toBe(FINAL[kind]);
    expect(await mainFlowAfterCleanupStart(db, id, kind)).toEqual([]);
    expect((await traceOf(db, id)).filter(([oid, s]) => oid === 'start' && s === 'COMPLETED')).toHaveLength(1);
    expect(await operatorTrace(db, id)).toContain(`${LABEL[kind]} cleanup ended: RETURN reached`);
    await close();
  });

  test(`${kind}: nested RETURN GOTO to a main-flow step ends the cleanup`, async () => {
    const { db, close } = await makeTestDb();
    const { id } = await runAndHalt(db, nestedSpec(`wf-n-goto-main-${kind}`, kind, { command: 'GOTO', goto_step_oid: 'ui' }), kind);
    const inst = await instanceRow(db, id);
    expect(inst.status).toBe(FINAL[kind]);
    expect(await mainFlowAfterCleanupStart(db, id, kind)).toEqual([]);
    expect(await operatorTrace(db, id)).toContain(`${LABEL[kind]} cleanup ended: RETURN reached`);
    await close();
  });

  test(`${kind}: nested RETURN GOTO to a step inside the cleanup network is followed`, async () => {
    const { db, close } = await makeTestDb();
    const spec = nestedSpec(`wf-n-goto-in-${kind}`, kind, { command: 'GOTO', goto_step_oid: 'ui' }, { ack: true });
    const { id, deps } = await runAndHalt(db, spec, kind, {
      patch: (s) => { s.steps.find((x: any) => x.oid === 'ret2').return_config.goto_step_oid = 'ack'; },
    });
    expect((await instanceRow(db, id)).status).toBe(kind === 'stop' ? 'stopping_cleanup' : 'aborting_cleanup');
    expect((await stepRow(db, id, 'ack')).state).toBe('WAITING_USER');
    await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, deps);
    await pumpUntilQuiet(db, deps);
    expect((await instanceRow(db, id)).status).toBe(FINAL[kind]);
    expect(await traceOf(db, id)).toContainEqual(['ack', 'COMPLETED', null]);
    expect(await mainFlowAfterCleanupStart(db, id, kind)).toEqual([]);
    expect(await operatorTrace(db, id)).toContain(`${LABEL[kind]} cleanup ended: RETURN reached`);
    await close();
  });

  test(`${kind}: nested RETURN RETRY re-runs the cleanup step`, async () => {
    const { db, close } = await makeTestDb();
    const { id } = await runAndHalt(db, nestedSpec(`wf-n-retry-${kind}`, kind, { command: 'RETRY' }), kind);
    expect((await instanceRow(db, id)).status).toBe(FINAL[kind]);
    // bad ran twice: the first failure was caught by c2 (bad idled), the RETRY re-ran it and its
    // second failure is a re-entry of the still-active c2.
    const t = await traceOf(db, id);
    const retried = t.findIndex(([oid, s]) => oid === 'ret2' && s === 'COMPLETED');
    expect(t.findIndex(([oid, s]) => oid === 'bad' && s === 'IDLE')).toBeLessThan(retried);
    expect(t.slice(retried)).toContainEqual(['bad', 'ERRORED', 'CATCH_REENTRY on c2']);
    expect(await mainFlowAfterCleanupStart(db, id, kind)).toEqual([]);
    await close();
  });

  // ── Critical 2: nested RETURN ABANDON ends the cleanup (Abort used to stay aborting_cleanup) ──

  test(`${kind}: nested RETURN ABANDON ends the cleanup with ${FINAL[kind]}`, async () => {
    const { db, close } = await makeTestDb();
    const { id } = await runAndHalt(db, nestedSpec(`wf-n-abandon-${kind}`, kind, { command: 'ABANDON' }), kind);
    const inst = await instanceRow(db, id);
    expect(inst.status).toBe(FINAL[kind]);
    expect(inst.finalState).toBe(FINAL[kind]);
    expect(await operatorTrace(db, id)).toContain(`${LABEL[kind]} cleanup ended: RETURN reached`);
    await close();
  });
}

test('abort: an unhooked settle from running during the cleanup still settles aborted', async () => {
  const { db, close } = await makeTestDb();
  const spec = nestedSpec('wf-n-unhooked', 'abort', { command: 'ABANDON' }, { ack: true });
  // 'bad' must not throw here: the cleanup parks on ack.
  (spec.steps.find((s: any) => s.oid === 'bad') as any).script_config = { source: 'var x = 1;' };
  const { id } = await runAndHalt(db, spec, 'abort');
  expect((await instanceRow(db, id)).status).toBe('aborting_cleanup');
  await db.transaction(async (tx: any) => {
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, id));
    const ctx = await openContext(tx, row, testDeps());
    await settleTerminal(tx, ctx, 'aborted', 'aborted', () => new Date()); // default from 'running'
  });
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect((await operatorTrace(db, id)).some(m => m?.startsWith('Operator Abort cleanup ended:'))).toBe(true);
  await close();
});

// ── defence in depth: no root step outside the cleanup may activate while it runs ──

function parkedCleanupSpec(oid: string) {
  const spec = nestedSpec(oid, 'stop', { command: 'ABANDON' }, { ack: true });
  (spec.steps.find((s: any) => s.oid === 'bad') as any).script_config = { source: 'var x = 1;' };
  return spec;
}

test('an activation of a main-flow step during the cleanup is refused and ends the cleanup', async () => {
  const { db, close } = await makeTestDb();
  const { id, deps } = await runAndHalt(db, parkedCleanupSpec('wf-guard-activate'), 'stop');
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  let settled = false;
  await db.transaction(async (tx: any) => {
    const [row] = await tx.select().from(workflowInstance).where(eq(workflowInstance.id, id));
    const ctx = await openContext(tx, row, deps);
    settled = await activateAndCascade(tx, ctx, 'ui', 'ui', deps);
  });
  expect(settled).toBe(true);
  expect(errorSpy.mock.calls.some(a => String(a[0]).includes("step 'ui' is outside the Operator cleanup"))).toBe(true);
  errorSpy.mockRestore();
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(await mainFlowAfterCleanupStart(db, id, 'stop')).toEqual([]);
  expect(await operatorTrace(db, id)).toContain("Operator Stop cleanup ended: step failed: step 'ui' is outside the cleanup network");
  await close();
});

test('a stray READY main-flow row during the cleanup is refused by the ready-step pump', async () => {
  const { db, close } = await makeTestDb();
  const { id, deps } = await runAndHalt(db, parkedCleanupSpec('wf-guard-ready'), 'stop');
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  await db.delete(stepInstance).where(and(eq(stepInstance.workflowInstanceId, id), eq(stepInstance.stepOid, 'ui')));
  await db.insert(stepInstance).values({
    workflowInstanceId: id, nodeOid: 'wf-guard-ready', stepOid: 'ui', stepType: 'USER_INTERACTION', state: 'READY',
    createdAt: new Date(), updatedAt: new Date(),
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  await db.transaction(async (tx: any) => { await processReadyStep(tx, id, deps); });
  errorSpy.mockRestore();
  expect((await instanceRow(db, id)).status).toBe('stopped');
  expect((await stepRow(db, id, 'ui')).state).toBe('CANCELLED'); // never activated; the cleanup's end cancels it
  expect(await mainFlowAfterCleanupStart(db, id, 'stop')).toEqual([]);
  await close();
});

// ── Important 3 / 4: redirect-only settles abort live cleanup actions and say why ──

function makeHttpDeps(s: StubActionServer): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(s.uri).origin];
  const client = new ActionClient(allowlist);
  const deps = testDeps({
    invoker: httpActionInvoker(client, async () => s.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5, actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000, schedulerEnabled: true, scheduleTickMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { deps, client };
}

/** CATCH -> par (forks) -> {cact (live action), ack (user) -> ret}. */
function forkSpec(oid: string, retConfig: Record<string, unknown> = { command: 'ABANDON' }) {
  const cleanup: Step[] = [
    step('c', 'CATCH', { catch_id: 'cleanup' }),
    step('par', 'SCRIPT', { script_config: { source: 'var x = 1;' } }),
    step('cact', 'ACTION PROXY', { action_proxy_config: ACTION_CONFIG }),
    step('ack', 'USER_INTERACTION'),
    step('ret', 'RETURN', { return_config: retConfig }),
  ];
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    try_specifications: [{ mode: 'OPERATOR_STOP', catch_id: 'cleanup' }],
    steps: [...MAIN.steps, ...cleanup],
    connections: [
      ...MAIN.connections,
      { from_step_id: 'c', to_step_id: 'par' },
      { from_step_id: 'par', to_step_id: 'cact' }, { from_step_id: 'par', to_step_id: 'ack' },
      { from_step_id: 'ack', to_step_id: 'ret' },
    ],
  };
}

test('engine error during the cleanup: stopped, "engine error" trace, live cleanup action aborted after commit', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { deps, client } = makeHttpDeps(stub);
  const { id } = await runAndHalt(db, forkSpec('wf-engine-err'), 'stop', { deps });
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  const aid = (await stepRow(db, id, 'cact')).actionInstanceId as string;
  expect(aid).toBeTruthy();
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const deleteSpy = vi.spyOn(client, 'deleteInstance');

  await settleFailedInstance(db, id, new Error('kaboom'), deps);
  expect(sendSpy).not.toHaveBeenCalled(); // never inside the settling transaction
  const inst = await instanceRow(db, id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  expect(await operatorTrace(db, id)).toContain('Operator Stop cleanup ended: engine error: kaboom');
  expect(inst.engineState.operatorCleanup.pendingAborts).toEqual([
    expect.objectContaining({ actionInstanceId: aid, serverUri: stub.uri }),
  ]);

  await pumpUntilQuiet(db, deps);
  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'ABORT');
  expect(deleteSpy).toHaveBeenCalledWith(stub.uri, aid);
  await close();
});

test('malformed RETURN in the cleanup: stopped, "step failed" reason, live cleanup action aborted after commit', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const { deps, client } = makeHttpDeps(stub);
  const { id } = await runAndHalt(db, forkSpec('wf-bad-return'), 'stop', {
    deps, patch: (s) => { s.steps.find((x: any) => x.oid === 'ret').return_config = { command: 'BOGUS' }; },
  });
  expect((await instanceRow(db, id)).status).toBe('stopping_cleanup');
  const aid = (await stepRow(db, id, 'cact')).actionInstanceId as string;
  const sendSpy = vi.spyOn(client, 'sendCommand');
  const deleteSpy = vi.spyOn(client, 'deleteInstance');

  await submitUserAction(db, id, { step_oid: 'ack', action: 'submit' }, 0, deps);
  expect(sendSpy).not.toHaveBeenCalled();
  expect((await instanceRow(db, id)).status).toBe('stopped');
  expect(await operatorTrace(db, id)).toContain("Operator Stop cleanup ended: step failed: RETURN has unknown command 'BOGUS'");

  await pumpUntilQuiet(db, deps);
  expect(sendSpy).toHaveBeenCalledWith(stub.uri, aid, 'ABORT');
  expect(deleteSpy).toHaveBeenCalledWith(stub.uri, aid);
  await close();
});
