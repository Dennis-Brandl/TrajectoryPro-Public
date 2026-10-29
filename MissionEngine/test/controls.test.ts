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
// Task 16: the four control passes — pausing / resuming / stopping / aborting (spec §7). Most
// scenarios hand-seed step_instance rows directly (mirroring action-execution.test.ts's
// seedRunningWithStep precedent) so each test can construct an exact, deterministic row-state
// scenario without fighting the full activation cascade — runControlPass reads raw rows
// regardless of how they got there. A handful of tests instead drive the real activation flow
// (seedQueued + pumpUntilQuiet) to prove the full request -> engine -> settle round trip through
// the Task 2 DAOs, and to exercise the Task 12 mandatory child-workflow guard for real.
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestPause, requestResume, requestStop, requestAbort } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker, type ActionInvoker, type ActionBeginResult } from '../src/actions/invoker.js';
import { applyActionTerminal } from '../src/actions/monitor.js';
import { runControlPass, type AfterCommitCommand } from '../src/core/control.js';
import {
  applySendFailure, processPendingSendFailures, queueSendFailure, __resetPendingSendFailures,
} from '../src/core/send-failure.js';
import { runOnce, processDueActionWork } from '../src/loop.js';
import { submitUserAction } from '../src/core/submit.js';
import type { EngineDeps } from '../src/config.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const ENV_SPECS = [{
  local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
  included_actions: [
    { action_oid: 'act-pause', action_name: 'Pausable', action_library: 'lib-1' },
    { action_oid: 'act-nopause', action_name: 'NotPausable', action_library: 'lib-1' },
  ],
}];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function addSeconds(d: Date, secs: number): Date {
  return new Date(d.getTime() + secs * 1000);
}

function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = addSeconds(now, secs); } };
}

function makeHttpDeps(
  stub: StubActionServer, clock: { now: () => Date },
): { deps: EngineDeps; client: ActionClient } {
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const deps = testDeps({
    now: clock.now,
    invoker: httpActionInvoker(client, async () => stub.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1,
      // 5000ms (the production default), NOT the old 200ms — this whole config object REPLACES
      // testDeps()'s own, so it would otherwise silently re-open the p7 flake window that
      // test/helpers/pump.ts's testDeps doc comment describes. This file really does execute
      // SCRIPT steps (e.g. 'tail-a'/'tail-b', `output.done = 'yes';`), and the vm timeout is
      // wall-clock (V8 watchdog thread), so a fork descheduled under full-suite contention could
      // trip it on a trivial script and settle the instance errored under a COMPLETED assertion.
      actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5,
      actionFetchTimeoutMs: 10_000,
      propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
      authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  return { deps, client };
}

// ── seeding helpers ──

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

/** Hand-seeds a workflow_instance row directly at `status` (bypassing the whole DAO/activation
 *  flow) — this task's own unit-level scenarios need exact, deterministic row states, matching
 *  action-execution.test.ts's seedRunningWithStep precedent. `engineState` lets a test pre-load
 *  `deferredRouting` without going through a real applyActionTerminal call first. */
async function seedInstance(
  db: any, spec: any, oid: string, status: string, engineState: Record<string, unknown> = {},
  opts: { neverStarted?: boolean } = {},
): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, queuedAt: new Date(),
    startedAt: opts.neverStarted ? null : new Date(), specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
    engineState,
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function insertStep(
  db: any, instanceId: string, nodeOid: string, stepOid: string, stepType: string, state: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  const [row] = await db.insert(stepInstance).values({
    workflowInstanceId: instanceId, nodeOid, stepOid, stepType, state, ...extra,
  }).returning();
  return row;
}

async function traceOf(db: any, instanceId: string): Promise<Array<[string | null, string, string | null | undefined]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(traceEntry.orderIndex);
  return rows.map((r: any) => [r.stepOid, r.state, r.error]);
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function stepRows(db: any, instanceId: string): Promise<any[]> {
  return db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

let stub: StubActionServer | undefined;
afterEach(async () => {
  if (stub) {
    await stub.close();
    stub = undefined;
  }
});

// ── PAUSE: supporting action gets PAUSE + PAUSED; unsupporting keeps running, no trace ──

const PAUSE_SPEC = {
  local_id: 'wf', oid: 'wf-pause', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('start', 'START'),
    step('act-a', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }),
    step('act-b', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' } }),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'act-a' },
    { from_step_id: 'start', to_step_id: 'act-b' },
  ],
};

test('pause: a supporting action gets PAUSE + PAUSED; an unsupporting one keeps running with no trace', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  stub.control.setCapabilities('act-nopause', { supportedCommands: ['ABORT', 'STOP'] });

  const wi = await seedInstance(db, PAUSE_SPEC, 'wf-pause', 'pausing');
  await insertStep(db, wi.id, 'wf-pause', 'act-a', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-a', actionServerUri: stub.uri, startedAt: new Date(),
  });
  await insertStep(db, wi.id, 'wf-pause', 'act-b', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-b', actionServerUri: stub.uri, startedAt: new Date(),
  });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  const actA = await stepRow(db, wi.id, 'act-a');
  expect(actA.state).toBe('PAUSED');
  const actB = await stepRow(db, wi.id, 'act-b');
  expect(actB.state).toBe('WAITING_ACTION'); // unsupported — kept running

  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, 'ai-a', 'PAUSE');
  expect(sendCommandSpy).not.toHaveBeenCalledWith(stub.uri, 'ai-b', 'PAUSE');

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['act-a', 'PAUSED', null]);
  expect(trace.some(([oid, state]) => oid === 'act-b' && state === 'PAUSED')).toBe(false);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('paused');

  await close();
});

// ── data safety round 2 (spec 2026-10-22 §2): a pause never reports Paused on a guess — an
// action server whose capabilities are unknown is waited on for up to 2 minutes, then the pause
// settles with a WARNING on each step it could not reach. ──

const UNREACHABLE_WARNING = 'action server unreachable — this action may still be running';

const pausingSinceOf = async (db: any, id: string) =>
  ((await instanceRow(db, id)).engineState as { pausingSince?: number | null }).pausingSince;

async function seedPausingWithAction(db: any, s: StubActionServer): Promise<{ id: string }> {
  const wi = await seedInstance(db, PAUSE_SPEC, 'wf-pause', 'pausing');
  await insertStep(db, wi.id, 'wf-pause', 'act-a', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-a', actionServerUri: s.uri, startedAt: new Date(),
  });
  return wi;
}

test('pause with an unreachable server stays Pausing, then settles Paused with a warning after 2 minutes', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  stub.control.setCapabilitiesAvailable(false);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const wi = await seedPausingWithAction(db, stub);

  expect(await runControlPass(db, deps)).toBe(true);
  expect((await instanceRow(db, wi.id)).status).toBe('pausing');
  expect(sendCommandSpy).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'PAUSE');
  expect(await pausingSinceOf(db, wi.id)).toBe(clock.now().getTime());
  expect(errorSpy.mock.calls.some(([msg]) =>
    typeof msg === 'string' && msg.includes(`waiting to send PAUSE: action server ${stub!.uri} not reachable`))).toBe(true);

  clock.advance(60);
  expect(await runControlPass(db, deps)).toBe(false);
  expect((await instanceRow(db, wi.id)).status).toBe('pausing');
  // The waiting pass still rotates to the back of the claim order.
  expect((await instanceRow(db, wi.id)).updatedAt.getTime()).toBe(clock.now().getTime());

  clock.advance(61);
  expect(await runControlPass(db, deps)).toBe(true);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  expect((await stepRow(db, wi.id, 'act-a')).state).toBe('WAITING_ACTION');
  expect(await traceOf(db, wi.id)).toContainEqual(['act-a', 'WARNING', UNREACHABLE_WARNING]);
  // Round 3 (spec 2026-10-22-data-safety-3 §1): pausingSince lasts until resume, not settle.
  expect(await pausingSinceOf(db, wi.id)).toBe(clock.now().getTime() - 121_000);
  expect(sendCommandSpy).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'PAUSE');

  errorSpy.mockRestore();
  await close();
});

test('the server answers before the limit: PAUSE is sent and no warning', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  stub.control.setCapabilitiesAvailable(false);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const wi = await seedPausingWithAction(db, stub);

  await runControlPass(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('pausing');

  stub.control.setCapabilitiesAvailable(true);
  await client.capabilities(stub.uri);
  clock.advance(10);
  await runControlPass(db, deps);
  const pauses = sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'PAUSE');
  expect(pauses).toEqual([[stub.uri, 'ai-a', 'PAUSE']]);
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['act-a', 'PAUSED', null]);
  expect(trace.some(([, state]) => state === 'WARNING')).toBe(false);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  // Round 3: still set — cleared only by resume.
  expect(await pausingSinceOf(db, wi.id)).toBe(clock.now().getTime() - 10_000);

  errorSpy.mockRestore();
  await close();
});

test('mixed pause: the reachable server is paused at once; the unreachable one gets a warning after the limit', async () => {
  const { db, close } = await makeTestDb();
  const stubA = startStubActionServer(0);
  const stubB = startStubActionServer(0);
  try {
    const clock = makeClock();
    const allowlist = [new URL(stubA.uri).origin, new URL(stubB.uri).origin];
    const client = new ActionClient(allowlist);
    const base = makeHttpDeps(stubA, clock).deps;
    const deps: EngineDeps = {
      ...base,
      invoker: httpActionInvoker(client, async () => stubA.uri),
      config: { ...base.config, actionServerAllowlist: allowlist },
    };
    stubA.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
    stubB.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
    stubB.control.setCapabilitiesAvailable(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendCommandSpy = vi.spyOn(client, 'sendCommand');

    // Both rows run act-pause (act-b via the invoked oid); one on each server.
    const wi = await seedInstance(db, PAUSE_SPEC, 'wf-pause', 'pausing');
    await insertStep(db, wi.id, 'wf-pause', 'act-a', 'ACTION PROXY', 'WAITING_ACTION', {
      actionInstanceId: 'ai-a', actionServerUri: stubA.uri, startedAt: new Date(),
    });
    await insertStep(db, wi.id, 'wf-pause', 'act-b', 'ACTION PROXY', 'WAITING_ACTION', {
      actionInstanceId: 'ai-b', actionServerUri: stubB.uri, startedAt: new Date(), actionInvokedOid: 'act-pause',
    });

    await runControlPass(db, deps);
    expect((await stepRow(db, wi.id, 'act-a')).state).toBe('PAUSED');
    expect((await stepRow(db, wi.id, 'act-b')).state).toBe('WAITING_ACTION');
    expect(sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'PAUSE')).toEqual([[stubA.uri, 'ai-a', 'PAUSE']]);
    expect((await instanceRow(db, wi.id)).status).toBe('pausing');

    clock.advance(121);
    await runControlPass(db, deps);
    expect((await instanceRow(db, wi.id)).status).toBe('paused');
    const warnings = (await traceOf(db, wi.id)).filter(([, state]) => state === 'WARNING');
    expect(warnings).toEqual([['act-b', 'WARNING', UNREACHABLE_WARNING]]);
    expect(sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'PAUSE')).toHaveLength(1);

    errorSpy.mockRestore();
  } finally {
    await stubA.close();
    await stubB.close();
    await close();
  }
});

test('resume clears pausingSince', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  stub.control.setCapabilitiesAvailable(false);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const wi = await seedPausingWithAction(db, stub);

  await runControlPass(db, deps);
  clock.advance(121);
  await runControlPass(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  expect(typeof await pausingSinceOf(db, wi.id)).toBe('number'); // round 3: kept until resume

  await requestResume(db, wi.id);
  await runControlPass(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect(await pausingSinceOf(db, wi.id)).toBeNull();

  errorSpy.mockRestore();
  await close();
});

// ── data safety round 3 (spec 2026-10-22-data-safety-3 §1): a PAUSE that could not be delivered
// is undone and retried, and the retries count toward round 2's 2-minute limit. ──

const RETRYING_WARNING = 'PAUSE could not be delivered — action server unreachable; retrying';

const warningsOf = async (db: any, id: string) =>
  (await traceOf(db, id)).filter(([, state]) => state === 'WARNING');

const engineStateOf = async (db: any, id: string) =>
  (await instanceRow(db, id)).engineState as {
    pausingSince?: number | null; pauseUndeliveredWarned?: string[]; pausedAt?: Record<string, number>;
  };

/** A pausing run with one WAITING_ACTION PAUSE-supporting step and a warm capabilities cache. */
async function pauseSendSetup(response: number | 'drop') {
  const t = await makeTestDb();
  stub = startStubActionServer(0);
  const s = stub;
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(s, clock);
  s.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  s.control.setCommandResponse(response);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const wi = await seedPausingWithAction(t.db, s);
  await client.capabilities(s.uri);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const pauses = () => sendCommandSpy.mock.calls.filter(([, , cmd]) => cmd === 'PAUSE').length;
  __resetPendingSendFailures();
  return { ...t, s, clock, deps, client, wi, errorSpy, sendCommandSpy, pauses };
}

const pauseCommand = (
  t: { s: StubActionServer; wi: { id: string } }, stepRowId: string, pausedAtMs: number,
): AfterCommitCommand => ({
  serverUri: t.s.uri, actionInstanceId: 'ai-a', command: 'PAUSE',
  instanceId: t.wi.id, kind: 'pause', stepRowId, stepOid: 'act-a', pausedAtMs,
});

test('an unreachable PAUSE is retried, then sent', async () => {
  const t = await pauseSendSetup(503);

  await runControlPass(t.db, t.deps);
  expect(t.pauses()).toBe(1);
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('pausing');
  expect((await engineStateOf(t.db, t.wi.id)).pausedAt?.['act-a']).toBeUndefined();
  expect(await warningsOf(t.db, t.wi.id)).toEqual([['act-a', 'WARNING', RETRYING_WARNING]]);

  t.s.control.setCommandResponse(200);
  await t.client.capabilities(t.s.uri);
  t.clock.advance(30);
  await runControlPass(t.db, t.deps);
  expect(t.pauses()).toBe(2);
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('PAUSED');
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect(await warningsOf(t.db, t.wi.id)).toEqual([['act-a', 'WARNING', RETRYING_WARNING]]);

  t.errorSpy.mockRestore();
  await t.close();
});

test('a PAUSE that keeps failing settles after the limit', async () => {
  const t = await pauseSendSetup(503);
  const statuses: string[] = [];
  for (let pass = 0; pass < 5; pass++) {
    if (pass > 0) t.clock.advance(30);
    await t.client.capabilities(t.s.uri);
    await runControlPass(t.db, t.deps);
    statuses.push((await instanceRow(t.db, t.wi.id)).status);
  }
  expect(t.pauses()).toBe(5);
  // Passes at 0, 30, 60 and 90 s go back to pausing; the pass at 120 s reaches the limit and stays paused.
  expect(statuses).toEqual(['pausing', 'pausing', 'pausing', 'pausing', 'paused']);
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');
  const w = await warningsOf(t.db, t.wi.id);
  expect(w.filter(([, , msg]) => msg === RETRYING_WARNING)).toHaveLength(1);
  expect(w).toContainEqual(['act-a', 'WARNING', UNREACHABLE_WARNING]);

  // A paused run is not a pausing one: later passes send nothing and never flip it back.
  for (let i = 0; i < 3; i++) {
    t.clock.advance(30);
    await t.client.capabilities(t.s.uri);
    await runControlPass(t.db, t.deps);
    expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  }
  expect(t.pauses()).toBe(5);

  t.errorSpy.mockRestore();
  await t.close();
});

test('an undo after the limit leaves an already-paused run paused', async () => {
  const t = await pauseSendSetup(503);
  await runControlPass(t.db, t.deps); // pausingSince = start, back to pausing
  const step = await stepRow(t.db, t.wi.id, 'act-a');
  // The step was paused again and the run settled, past the limit.
  t.clock.advance(150);
  const st = await engineStateOf(t.db, t.wi.id);
  await t.db.update(workflowInstance).set({
    status: 'paused', engineState: { ...st, pausedAt: { 'act-a': t.clock.now().getTime() } },
  }).where(eq(workflowInstance.id, t.wi.id));
  await t.db.update(stepInstance).set({ state: 'PAUSED' }).where(eq(stepInstance.id, step.id));

  expect(await applySendFailure(t.db, pauseCommand(t, step.id, t.clock.now().getTime()), 'unreachable', t.deps, 'fetch failed')).toBe('applied');
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');
  expect((await engineStateOf(t.db, t.wi.id)).pausedAt?.['act-a']).toBeUndefined();
  expect(await warningsOf(t.db, t.wi.id)).toContainEqual(['act-a', 'WARNING', UNREACHABLE_WARNING]);

  t.errorSpy.mockRestore();
  await t.close();
});

/** A pausing run past the limit whose step act-a has a PAUSE in flight: the state runPausing
 *  wrote just before the send, with pausingSince 150 s ago. Returns the PAUSE command. */
async function pausingPastLimitWithPauseInFlight(t: Awaited<ReturnType<typeof pauseSendSetup>>) {
  await runControlPass(t.db, t.deps); // pausingSince = start, back to pausing
  const step = await stepRow(t.db, t.wi.id, 'act-a');
  t.clock.advance(150);
  const st = await engineStateOf(t.db, t.wi.id);
  await t.db.update(workflowInstance).set({
    status: 'pausing', engineState: { ...st, pausedAt: { 'act-a': t.clock.now().getTime() } },
  }).where(eq(workflowInstance.id, t.wi.id));
  await t.db.update(stepInstance).set({ state: 'PAUSED' }).where(eq(stepInstance.id, step.id));
  return pauseCommand(t, step.id, t.clock.now().getTime());
}

const unreachableWarnings = async (db: any, id: string) =>
  (await warningsOf(db, id)).filter(([, , msg]) => msg === UNREACHABLE_WARNING);

test('an undo at the limit while still pausing writes the unreachable warning once (server still unknown)', async () => {
  const t = await pauseSendSetup(503);
  const cmd = await pausingPastLimitWithPauseInFlight(t);
  expect(await applySendFailure(t.db, cmd, 'unreachable', t.deps, 'fetch failed')).toBe('applied');
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('pausing');
  expect(await unreachableWarnings(t.db, t.wi.id)).toEqual([['act-a', 'WARNING', UNREACHABLE_WARNING]]);

  // The capabilities cache is cold (the failed send evicted it): the pausing pass reaches the limit.
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect(await unreachableWarnings(t.db, t.wi.id)).toEqual([['act-a', 'WARNING', UNREACHABLE_WARNING]]);

  t.errorSpy.mockRestore();
  await t.close();
});

test('an undo at the limit while still pausing: the step is not paused again, one warning (server answers again)', async () => {
  const t = await pauseSendSetup(503);
  const cmd = await pausingPastLimitWithPauseInFlight(t);
  expect(await applySendFailure(t.db, cmd, 'unreachable', t.deps, 'fetch failed')).toBe('applied');
  const pausesBefore = t.pauses();

  await t.client.capabilities(t.s.uri);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect(t.pauses()).toBe(pausesBefore);
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');
  expect(await unreachableWarnings(t.db, t.wi.id)).toEqual([['act-a', 'WARNING', UNREACHABLE_WARNING]]);

  t.errorSpy.mockRestore();
  await t.close();
});

test('resume sends RESUME to a step whose PAUSE was undelivered (it may have reached the server); not to other steps', async () => {
  const t = await pauseSendSetup(503);
  t.s.control.setCapabilities('act-nopause', { supportedCommands: ['ABORT', 'STOP'] });
  await insertStep(t.db, t.wi.id, 'wf-pause', 'act-b', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-b', actionServerUri: t.s.uri, startedAt: new Date(),
  });
  for (let pass = 0; pass < 5; pass++) {
    if (pass > 0) t.clock.advance(30);
    await t.client.capabilities(t.s.uri);
    await runControlPass(t.db, t.deps);
  }
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');

  t.s.control.setCommandResponse(200);
  await requestResume(t.db, t.wi.id);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('running');
  const resumes = t.sendCommandSpy.mock.calls.filter(([, , c]) => c === 'RESUME');
  expect(resumes).toEqual([[t.s.uri, 'ai-a', 'RESUME']]);
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');

  t.errorSpy.mockRestore();
  await t.close();
});

test('resume sends RESUME to a step whose first undelivered PAUSE came after the limit', async () => {
  const t = await pauseSendSetup(503);
  await runControlPass(t.db, t.deps);
  const step = await stepRow(t.db, t.wi.id, 'act-a');
  t.clock.advance(150);
  // pausingSince 150 s ago, the step never warned: its first PAUSE failure lands after the limit.
  const st = await engineStateOf(t.db, t.wi.id);
  await t.db.update(workflowInstance).set({
    status: 'paused', engineState: { ...st, pauseUndeliveredWarned: [], pausedAt: { 'act-a': t.clock.now().getTime() } },
  }).where(eq(workflowInstance.id, t.wi.id));
  await t.db.update(stepInstance).set({ state: 'PAUSED' }).where(eq(stepInstance.id, step.id));
  expect(await applySendFailure(t.db, pauseCommand(t, step.id, t.clock.now().getTime()), 'unreachable', t.deps, 'fetch failed')).toBe('applied');
  // Past the limit no retrying warning is written (only the first pass's one exists).
  expect((await warningsOf(t.db, t.wi.id)).filter(([, , msg]) => msg === RETRYING_WARNING)).toHaveLength(1);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');

  t.s.control.setCommandResponse(200);
  await requestResume(t.db, t.wi.id);
  await runControlPass(t.db, t.deps);
  expect(t.sendCommandSpy.mock.calls.filter(([, , c]) => c === 'RESUME')).toEqual([[t.s.uri, 'ai-a', 'RESUME']]);

  t.errorSpy.mockRestore();
  await t.close();
});

test('a refused PAUSE is shown once, not retried, and the run settles paused', async () => {
  const t = await pauseSendSetup(400);
  await runControlPass(t.db, t.deps);
  expect(t.pauses()).toBe(1);
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  const w = await warningsOf(t.db, t.wi.id);
  expect(w).toHaveLength(1);
  expect(w[0][0]).toBe('act-a');
  expect(w[0][2]).toMatch(/^PAUSE could not be delivered: /);
  expect(w[0][2]).toContain('400');
  for (let i = 0; i < 3; i++) { t.clock.advance(30); await runControlPass(t.db, t.deps); }
  expect(t.pauses()).toBe(1);
  expect(await warningsOf(t.db, t.wi.id)).toHaveLength(1);

  t.errorSpy.mockRestore();
  await t.close();
});

test('a refused PAUSE is not resent while the run still waits on another server', async () => {
  const { db, close } = await makeTestDb();
  const stubA = startStubActionServer(0);
  const stubB = startStubActionServer(0);
  try {
    const clock = makeClock();
    const allowlist = [new URL(stubA.uri).origin, new URL(stubB.uri).origin];
    const client = new ActionClient(allowlist);
    const base = makeHttpDeps(stubA, clock).deps;
    const deps: EngineDeps = {
      ...base,
      invoker: httpActionInvoker(client, async () => stubA.uri),
      config: { ...base.config, actionServerAllowlist: allowlist },
    };
    stubA.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
    stubA.control.setCommandResponse(400);
    stubB.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
    stubB.control.setCapabilitiesAvailable(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    __resetPendingSendFailures();
    const wi = await seedInstance(db, PAUSE_SPEC, 'wf-pause', 'pausing');
    await insertStep(db, wi.id, 'wf-pause', 'act-a', 'ACTION PROXY', 'WAITING_ACTION', {
      actionInstanceId: 'ai-a', actionServerUri: stubA.uri, startedAt: new Date(),
    });
    await insertStep(db, wi.id, 'wf-pause', 'act-b', 'ACTION PROXY', 'WAITING_ACTION', {
      actionInstanceId: 'ai-b', actionServerUri: stubB.uri, startedAt: new Date(), actionInvokedOid: 'act-pause',
    });
    await client.capabilities(stubA.uri);
    const sendCommandSpy = vi.spyOn(client, 'sendCommand');
    const pausesToA = () => sendCommandSpy.mock.calls.filter(([uri, , cmd]) => uri === stubA.uri && cmd === 'PAUSE').length;

    await runControlPass(db, deps);
    expect(pausesToA()).toBe(1);
    expect((await instanceRow(db, wi.id)).status).toBe('pausing'); // still waiting on stubB
    for (let i = 0; i < 2; i++) { clock.advance(30); await runControlPass(db, deps); }
    expect(pausesToA()).toBe(1);
    expect((await stepRow(db, wi.id, 'act-a')).state).toBe('WAITING_ACTION');
    const refusals = (await traceOf(db, wi.id)).filter(([oid, state, msg]) =>
      oid === 'act-a' && state === 'WARNING' && /^PAUSE could not be delivered: /.test(msg ?? ''));
    expect(refusals).toHaveLength(1);

    clock.advance(121);
    await runControlPass(db, deps);
    expect((await instanceRow(db, wi.id)).status).toBe('paused');
    expect(pausesToA()).toBe(1);
    errorSpy.mockRestore();
  } finally {
    await stubA.close();
    await stubB.close();
    await close();
  }
});

test('undo is skipped after resume', async () => {
  const t = await pauseSendSetup(200);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  const step = await stepRow(t.db, t.wi.id, 'act-a');
  const pausedAtMs = (await engineStateOf(t.db, t.wi.id)).pausedAt!['act-a'];
  await requestResume(t.db, t.wi.id);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('running');

  expect(await applySendFailure(t.db, pauseCommand(t, step.id, pausedAtMs), 'unreachable', t.deps, 'fetch failed')).toBe('stale');
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('running');
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('WAITING_ACTION');
  expect(await warningsOf(t.db, t.wi.id)).toEqual([]);

  t.errorSpy.mockRestore();
  await t.close();
});

test('a queued pause undo does not revert a later pause request', async () => {
  const t = await pauseSendSetup(200);
  await runControlPass(t.db, t.deps); // first pause request: delivered (the stub's 404 counts)
  const step = await stepRow(t.db, t.wi.id, 'act-a');
  const firstPausedAt = (await engineStateOf(t.db, t.wi.id)).pausedAt!['act-a'];
  // Resume, then pause again: the same step is PAUSED with the same action instance, but in a
  // new pause request with a new pausedAt.
  t.clock.advance(10);
  await requestResume(t.db, t.wi.id);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('running');
  t.clock.advance(10);
  await requestPause(t.db, t.wi.id);
  await t.client.capabilities(t.s.uri);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect((await engineStateOf(t.db, t.wi.id)).pausedAt!['act-a']).not.toBe(firstPausedAt);
  // An undo for the FIRST PAUSE kept finding the instance busy and is still on the queue (each
  // pass retries the queue, so it is queued here, after the passes above, to model that).
  queueSendFailure(pauseCommand(t, step.id, firstPausedAt), 'unreachable', 'fetch failed');

  const spy = vi.spyOn(t.db, 'transaction');
  expect(await processPendingSendFailures(t.db, t.deps)).toBe(false); // stale, dropped
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
  expect((await stepRow(t.db, t.wi.id, 'act-a')).state).toBe('PAUSED');
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect(await warningsOf(t.db, t.wi.id)).toEqual([]);
  expect(await processPendingSendFailures(t.db, t.deps)).toBe(false); // not re-queued

  t.errorSpy.mockRestore();
  await t.close();
});

test('resume clears the pause bookkeeping', async () => {
  const t = await pauseSendSetup(503);
  await runControlPass(t.db, t.deps); // undelivered: pausingSince set, step warned
  t.s.control.setCommandResponse(200);
  await t.client.capabilities(t.s.uri);
  t.clock.advance(30);
  await runControlPass(t.db, t.deps); // delivered: paused
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  expect(await engineStateOf(t.db, t.wi.id)).toMatchObject({ pauseUndeliveredWarned: ['act-a'] });

  await requestResume(t.db, t.wi.id);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('running');
  const st = await engineStateOf(t.db, t.wi.id);
  expect(st.pausingSince).toBeNull();
  expect(st.pauseUndeliveredWarned).toEqual([]);

  t.errorSpy.mockRestore();
  await t.close();
});

test('a failed RESUME is logged', async () => {
  const t = await pauseSendSetup(200);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('paused');
  t.s.control.setCommandResponse(503);
  await requestResume(t.db, t.wi.id);
  await runControlPass(t.db, t.deps);
  expect((await instanceRow(t.db, t.wi.id)).status).toBe('running');
  expect(t.errorSpy.mock.calls.some(([msg]) =>
    typeof msg === 'string' && msg.includes(`RESUME to ${t.s.uri} failed`))).toBe(true);

  t.errorSpy.mockRestore();
  await t.close();
});

// ── mid-pause completion: records outputs but no successors ──

test('mid-pause completion records outputs but never materializes successors', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);

  const spec = {
    local_id: 'wf', oid: 'wf-midpause', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'),
      step('act-b', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' },
        output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }],
      }),
      step('tail-b', 'SCRIPT', { script_config: { source: "output.done = 'yes';" }, output_parameter_specifications: [{ id: 'done', target: 'TailRan' }] }),
      step('end', 'END'),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'act-b' },
      { from_step_id: 'act-b', to_step_id: 'tail-b' },
      { from_step_id: 'tail-b', to_step_id: 'end' },
    ],
  };

  const wi = await seedInstance(db, spec, 'wf-midpause', 'paused');
  const { instanceId: serverInstanceId } = await client.invoke(stub.uri, 'act-nopause', {
    environment_oid: 'env-1', workflow_instance_id: wi.id, step_instance_id: 'placeholder',
    step_oid: 'act-b', input_parameters: [],
  });
  stub.control.advance(serverInstanceId, 'COMPLETED', [{ name: 'Result', value: '42' }]);
  await insertStep(db, wi.id, 'wf-midpause', 'act-b', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: serverInstanceId, actionServerUri: stub.uri, startedAt: new Date(),
  });

  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'act-b')).id, { kind: 'COMPLETED' });

  const actB = await stepRow(db, wi.id, 'act-b');
  expect(actB.state).toBe('COMPLETED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.propertyStore).toMatchObject({ MyResult: '42' });
  expect(inst.status).toBe('paused'); // unchanged — no premature settle
  expect(await stepRow(db, wi.id, 'tail-b')).toBeUndefined(); // successor never materialized

  const engineState = inst.engineState as { deferredRouting?: string[] };
  expect(engineState.deferredRouting).toEqual(['act-b']);

  await close();
});

// ── Controller Ruling A / review Critical 1 fix: a FAILURE terminal arriving mid-pause is
// DEFERRED (not discarded, not immediately routed) — left exactly as WAITING_ACTION/PAUSED with
// its outcome recorded for replay, then resolved through the REAL failStep (catch included) the
// instant resume runs. stopDrain's own "no TRY/CATCH" rule stays scoped to `stopping` only. ──

test('mid-pause failure is DEFERRED (not discarded), then replayed through the real TRY/CATCH on resume', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);

  const spec = {
    local_id: 'wf', oid: 'wf-midpause-fail', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Ctx', entries: [{ name: 'Mode', value: '' }] }],
    steps: [
      step('start', 'START'),
      step('act-b', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' },
        try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
      }),
      step('end', 'END'),
      step('c1', 'CATCH', { catch_id: 'C1', output_parameter_specifications: [{ id: 'Reason', target: 'Ctx.Mode' }] }),
      step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'act-b' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };

  const wi = await seedInstance(db, spec, 'wf-midpause-fail', 'paused');
  await insertStep(db, wi.id, 'wf-midpause-fail', 'act-b', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-b', actionServerUri: stub.uri, startedAt: new Date(), wakeAt: clock.now(),
  });

  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'act-b')).id, { kind: 'ERRORED', message: 'boom' });

  // Deferred, not resolved: the row is untouched (still WAITING_ACTION — never ERRORED), no
  // catch has run yet, and the instance stays 'paused' — proving the failure is neither
  // discarded nor immediately routed.
  const actBDeferred = await stepRow(db, wi.id, 'act-b');
  expect(actBDeferred.state).toBe('WAITING_ACTION');
  expect(actBDeferred.wakeAt).toBeNull(); // no reason to keep polling — the outcome is already known
  expect(await stepRow(db, wi.id, 'c1')).toBeUndefined();
  const trace1 = await traceOf(db, wi.id);
  expect(trace1.some(([oid]) => oid === 'act-b')).toBe(false);
  const midInst = await instanceRow(db, wi.id);
  expect(midInst.status).toBe('paused');
  const engineState = midInst.engineState as { deferredFailures?: Array<{ stepOid: string; mode: string; message: string }> };
  expect(engineState.deferredFailures).toEqual([{ stepOid: 'act-b', mode: 'ERROR', message: 'boom' }]);

  // Resume replays the deferred failure through the REAL failStep — caught by C1, RETURN ABANDON
  // settles the whole instance 'aborted'.
  await requestResume(db, wi.id);
  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  expect(await stepRow(db, wi.id, 'act-b')).toBeUndefined(); // caught: idled-and-deleted, not ERRORED
  const trace2 = await traceOf(db, wi.id);
  expect(trace2.some(([oid, state]) => oid === 'act-b' && state === 'ERRORED')).toBe(false);
  const finalInst = await instanceRow(db, wi.id);
  expect(finalInst.status).toBe('aborted'); // ABANDON's own settle
  expect(finalInst.propertyStore).toMatchObject({ 'Ctx.Mode': 'ERROR' }); // CATCH ran for real
  const finalEngineState = finalInst.engineState as { deferredFailures?: unknown[] };
  expect(finalEngineState.deferredFailures).toEqual([]);

  await close();
});

// ── review-required coverage: a deferred failure inside a CHILD context must fire the child's
// own catch and bubble correctly on resume. ──

test('deferred failure inside a child context replays through the child catch and bubbles up to the parent', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });

  const childSpec = {
    local_id: 'ChildRef', oid: 'child-deferred-fail', version: '1.0.0', last_modified_date: '2026-01-01',
    parentChildSpecId: null, state: 'Effective',
    value_property_specifications: [{ name: 'ChildCtx', entries: [{ name: 'Mode', value: '' }] }],
    steps: [
      step2('c-start', 'c-start', 'START'),
      step2('c-act', 'c-act', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' },
        try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
      }),
      step2('c-end', 'c-end', 'END'),
      step2('c1', 'c1', 'CATCH', { catch_id: 'C1', output_parameter_specifications: [{ id: 'Reason', target: 'ChildCtx.Mode' }] }),
      step2('r1', 'r1', 'RETURN', { return_config: { command: 'COMPLETE' } }),
    ],
    connections: [
      { from_step_id: 'c-start', to_step_id: 'c-act' },
      { from_step_id: 'c-act', to_step_id: 'c-end' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };
  const parentSpec = {
    local_id: 'parent-wf', oid: 'wf-child-deferred-fail', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step2('start', 'p-start', 'START'),
      step2('ChildRef', 'proxy', 'WORKFLOW PROXY'),
      step2('end', 'p-end', 'END'),
    ],
    connections: [
      { from_step_id: 'p-start', to_step_id: 'proxy' },
      { from_step_id: 'proxy', to_step_id: 'p-end' },
    ],
    children: [childSpec],
  };

  const wi = await seedInstance(db, parentSpec, 'wf-child-deferred-fail', 'paused', {
    childActive: { proxy: 'child-deferred-fail' },
  });
  await insertStep(db, wi.id, 'wf-child-deferred-fail', 'proxy', 'WORKFLOW PROXY', 'WAITING_ACTION', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(),
  });
  await insertStep(db, wi.id, 'child-deferred-fail', 'c-act', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-c-act', actionServerUri: 'http://fake-origin', startedAt: new Date(),
  });

  // Defer a failure on the CHILD's own action step while paused.
  const client = new ActionClient(['http://fake-origin']);
  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'c-act')).id, { kind: 'ERRORED', message: 'boom' });

  const midInst = await instanceRow(db, wi.id);
  expect((midInst.engineState as { deferredFailures?: unknown[] }).deferredFailures).toEqual([
    { stepOid: 'c-act', mode: 'ERROR', message: 'boom' },
  ]);
  expect(await stepRow(db, wi.id, 'c1')).toBeUndefined();

  await requestResume(db, wi.id);
  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  // The child's own catch fired for real: c1 activated and auto-completed (its row is then
  // idled-and-deleted by dispatchReturn's own cleanupCatchNetwork sweep — existing, correct
  // behavior for ANY RETURN command, so its trace is the proof, not its live row), c-act
  // force-completed by RETURN COMPLETE, its successor c-end materialized — the child is now
  // genuinely finished, which bubbles all the way up through the parent.
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['c1', 'COMPLETED', null]);
  expect(await stepRow(db, wi.id, 'c1')).toBeUndefined(); // cleaned up by cleanupCatchNetwork
  const cEnd = await stepRow(db, wi.id, 'c-end');
  expect(cEnd?.state).toBe('COMPLETED');
  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('COMPLETED');
  const pEnd = await stepRow(db, wi.id, 'p-end');
  expect(pEnd?.state).toBe('COMPLETED');

  const finalInst = await instanceRow(db, wi.id);
  expect(finalInst.status).toBe('completed');
  expect((finalInst.engineState as { deferredFailures?: unknown[] }).deferredFailures).toEqual([]);

  await close();
});

// ── review-required coverage: MULTIPLE simultaneous deferred failures must all replay correctly
// on one resume, not just the first one. ──

test('multiple simultaneous deferred failures all replay through their own real TRY/CATCH on one resume', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });

  const spec = {
    local_id: 'wf', oid: 'wf-multi-fail', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Ctx', entries: [{ name: 'X', value: '' }, { name: 'Y', value: '' }] }],
    steps: [
      step('start', 'START'),
      step('act-x', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' }, try_specifications: [{ mode: 'ERROR', catch_id: 'CX' }] }),
      step('act-y', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' }, try_specifications: [{ mode: 'ERROR', catch_id: 'CY' }] }),
      step('cx', 'CATCH', { catch_id: 'CX', output_parameter_specifications: [{ id: 'Reason', target: 'Ctx.X' }] }),
      step('rx', 'RETURN', { return_config: { command: 'COMPLETE' } }),
      step('cy', 'CATCH', { catch_id: 'CY', output_parameter_specifications: [{ id: 'Reason', target: 'Ctx.Y' }] }),
      step('ry', 'RETURN', { return_config: { command: 'COMPLETE' } }),
      step('tail-x', 'SCRIPT', { script_config: { source: '' } }),
      step('tail-y', 'SCRIPT', { script_config: { source: '' } }),
      step('end', 'END'),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'act-x' },
      { from_step_id: 'start', to_step_id: 'act-y' },
      { from_step_id: 'act-x', to_step_id: 'tail-x' },
      { from_step_id: 'act-y', to_step_id: 'tail-y' },
      { from_step_id: 'cx', to_step_id: 'rx' },
      { from_step_id: 'cy', to_step_id: 'ry' },
    ],
  };

  const wi = await seedInstance(db, spec, 'wf-multi-fail', 'paused');
  await insertStep(db, wi.id, 'wf-multi-fail', 'act-x', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-x', actionServerUri: 'http://fake-origin', startedAt: new Date(),
  });
  await insertStep(db, wi.id, 'wf-multi-fail', 'act-y', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-y', actionServerUri: 'http://fake-origin', startedAt: new Date(),
  });

  const client = new ActionClient(['http://fake-origin']);
  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'act-x')).id, { kind: 'ERRORED', message: 'boom-x' });
  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'act-y')).id, { kind: 'ERRORED', message: 'boom-y' });

  const midInst = await instanceRow(db, wi.id);
  const midDeferred = (midInst.engineState as { deferredFailures?: Array<{ stepOid: string }> }).deferredFailures ?? [];
  expect(midDeferred.map(f => f.stepOid).sort()).toEqual(['act-x', 'act-y']);

  await requestResume(db, wi.id);
  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  // BOTH catches fired for real — neither was skipped or short-circuited by the other. Each
  // CATCH's own row is idled-and-deleted afterward by dispatchReturn's cleanupCatchNetwork sweep
  // (existing, correct behavior for any RETURN command) — its trace is the proof, not its live row.
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['cx', 'COMPLETED', null]);
  expect(trace).toContainEqual(['cy', 'COMPLETED', null]);
  expect((await stepRow(db, wi.id, 'act-x'))?.state).toBe('COMPLETED');
  expect((await stepRow(db, wi.id, 'tail-x'))?.state).toBe('COMPLETED');
  expect((await stepRow(db, wi.id, 'act-y'))?.state).toBe('COMPLETED');
  expect((await stepRow(db, wi.id, 'tail-y'))?.state).toBe('COMPLETED');

  const finalInst = await instanceRow(db, wi.id);
  expect(finalInst.propertyStore).toMatchObject({ 'Ctx.X': 'ERROR', 'Ctx.Y': 'ERROR' });
  expect((finalInst.engineState as { deferredFailures?: unknown[] }).deferredFailures).toEqual([]);

  await close();
});

// ── RESUME: RESUME sent, deferred successors materialize exactly once ──

test('resume: RESUME sent to a paused action, deferred successors materialize exactly once', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = {
    local_id: 'wf', oid: 'wf-resume', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'),
      step('act-a', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }),
      step('tail-a', 'SCRIPT', { script_config: { source: "output.done = 'yes';" }, output_parameter_specifications: [{ id: 'done', target: 'TailRan' }] }),
      step('act-c', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }),
      step('end', 'END'),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'act-a' },
      { from_step_id: 'act-a', to_step_id: 'tail-a' },
      { from_step_id: 'start', to_step_id: 'act-c' },
    ],
  };

  // act-a already COMPLETED while paused (its own routing was deferred — see deferredRouting);
  // act-c is a genuinely still-paused action step that needs its RESUME command sent.
  const wi = await seedInstance(db, spec, 'wf-resume', 'resuming', { deferredRouting: ['act-a'] });
  await insertStep(db, wi.id, 'wf-resume', 'act-a', 'ACTION PROXY', 'COMPLETED', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(), completedAt: new Date(),
  });
  await insertStep(db, wi.id, 'wf-resume', 'act-c', 'ACTION PROXY', 'PAUSED', {
    actionInstanceId: 'ai-c', actionServerUri: stub.uri, startedAt: new Date(),
  });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, 'ai-c', 'RESUME');

  const actC = await stepRow(db, wi.id, 'act-c');
  expect(actC.state).toBe('WAITING_ACTION');
  expect(actC.wakeAt).not.toBeNull();

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['act-c', 'EXECUTING', null]);

  const allTailRows = (await stepRows(db, wi.id)).filter(r => r.stepOid === 'tail-a');
  expect(allTailRows).toHaveLength(1); // materialized exactly once
  expect(allTailRows[0].state).toBe('COMPLETED');

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('running');
  const engineState = inst.engineState as { deferredRouting?: string[] };
  expect(engineState.deferredRouting).toEqual([]);

  await close();
});

// ── review Critical 3 fix: resume's deferred-routing drain must run settleIfComplete after
// drainCascade (mirroring monitor.ts's own normal-path shape) — not just drainCascade alone,
// which would leave a fully-completed instance permanently stuck 'running' forever. ──

test('Critical 3 fix: resume drains a deferred completion all the way through settleIfComplete (START -> act -> END)', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });

  const spec = {
    local_id: 'wf', oid: 'wf-c3', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step('start', 'START'),
      step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' } }),
      step('end', 'END'),
    ],
    connections: [{ from_step_id: 'act', to_step_id: 'end' }],
  };
  // act already COMPLETED while paused — its own routing to 'end' was deferred, never evaluated.
  const wi = await seedInstance(db, spec, 'wf-c3', 'resuming', { deferredRouting: ['act'] });
  await insertStep(db, wi.id, 'wf-c3', 'act', 'ACTION PROXY', 'COMPLETED', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(), completedAt: new Date(),
  });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  const endRow = await stepRow(db, wi.id, 'end');
  expect(endRow).toBeDefined();
  expect(endRow.state).toBe('COMPLETED');

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed'); // NOT stuck 'running' forever
  expect(inst.finalState).toBe('completed');
  expect(inst.completedAt).not.toBeNull();

  // Zero further work available anywhere — the definitive "genuinely, fully resolved" proof.
  const cycles = await pumpUntilQuiet(db, deps, 5);
  expect(cycles).toBe(0);

  await close();
});

test('Critical 3 fix, child variant: a deferred child completion bubbles all the way up through completeChildWorkflow', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });

  const childSpec = {
    local_id: 'ChildRef', oid: 'child-c3', version: '1.0.0', last_modified_date: '2026-01-01',
    parentChildSpecId: null, state: 'Effective',
    steps: [
      step2('c-start', 'c-start', 'START'),
      step2('c-act', 'c-act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' } }),
      step2('c-end', 'c-end', 'END'),
    ],
    connections: [
      { from_step_id: 'c-start', to_step_id: 'c-act' },
      { from_step_id: 'c-act', to_step_id: 'c-end' },
    ],
  };
  const parentSpec = {
    local_id: 'parent-wf', oid: 'wf-c3-child', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step2('start', 'p-start', 'START'),
      step2('ChildRef', 'proxy', 'WORKFLOW PROXY'),
      step2('end', 'p-end', 'END'),
    ],
    connections: [
      { from_step_id: 'p-start', to_step_id: 'proxy' },
      { from_step_id: 'proxy', to_step_id: 'p-end' },
    ],
    children: [childSpec],
  };

  // proxy's child was already active (childActive) when the instance paused; the child's own
  // c-act completed while paused, its routing to c-end deferred and never evaluated.
  const wi = await seedInstance(db, parentSpec, 'wf-c3-child', 'resuming', {
    deferredRouting: ['c-act'], childActive: { proxy: 'child-c3' },
  });
  await insertStep(db, wi.id, 'wf-c3-child', 'proxy', 'WORKFLOW PROXY', 'WAITING_ACTION', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(),
  });
  await insertStep(db, wi.id, 'child-c3', 'c-act', 'ACTION PROXY', 'COMPLETED', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(), completedAt: new Date(),
  });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  const cEnd = await stepRow(db, wi.id, 'c-end');
  expect(cEnd?.state).toBe('COMPLETED');
  const proxyRow = await stepRow(db, wi.id, 'proxy');
  expect(proxyRow.state).toBe('COMPLETED'); // completeChildWorkflow ran — not stuck WAITING_ACTION
  const pEnd = await stepRow(db, wi.id, 'p-end');
  expect(pEnd?.state).toBe('COMPLETED');

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed'); // bubbled all the way to the whole instance
  const engineState = inst.engineState as { childActive?: Record<string, string> };
  expect(engineState.childActive ?? {}).toEqual({}); // completeChildWorkflow clears the link

  await close();
});

// ── STOP: READY+WAITING_USER cancelled, STOP sent where supported, drain -> stopped;
// COMPLETED-during-stop keeps outputs but no successors; failure-during-stop bypasses TRY/CATCH ──

test('stop: cancels never-started/parked steps, commands supporting actions, drains to stopped honoring outputs and bypassing catch', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  stub.control.setCapabilities('act-nopause', { supportedCommands: ['ABORT'] }); // no STOP

  const spec = {
    local_id: 'wf', oid: 'wf-stop', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    value_property_specifications: [{ name: 'Ctx', entries: [{ name: 'Mode', value: '' }] }],
    steps: [
      step('start', 'START'),
      step('ready-1', 'SCRIPT', { script_config: { source: '' } }),
      step('ui-1', 'USER_INTERACTION'),
      step('act-stop', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' },
        output_parameter_specifications: [{ id: 'Result', target: 'MyResult' }],
      }),
      step('tail-stop', 'SCRIPT', { script_config: { source: '' } }),
      step('act-nostop', 'ACTION PROXY', {
        action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' },
        try_specifications: [{ mode: 'ERROR', catch_id: 'C1' }],
      }),
      step('end', 'END'),
      step('c1', 'CATCH', { catch_id: 'C1', output_parameter_specifications: [{ id: 'Reason', target: 'Ctx.Mode' }] }),
      step('r1', 'RETURN', { return_config: { command: 'ABANDON' } }),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'act-stop' },
      { from_step_id: 'act-stop', to_step_id: 'tail-stop' },
      { from_step_id: 'c1', to_step_id: 'r1' },
    ],
  };

  const wi = await seedInstance(db, spec, 'wf-stop', 'stopping');
  await insertStep(db, wi.id, 'wf-stop', 'ready-1', 'SCRIPT', 'READY');
  await insertStep(db, wi.id, 'wf-stop', 'ui-1', 'USER_INTERACTION', 'WAITING_USER', { startedAt: new Date() });
  const { instanceId: actStopServerId } = await client.invoke(stub.uri, 'act-pause', {
    environment_oid: 'env-1', workflow_instance_id: wi.id, step_instance_id: 'placeholder',
    step_oid: 'act-stop', input_parameters: [],
  });
  await insertStep(db, wi.id, 'wf-stop', 'act-stop', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: actStopServerId, actionServerUri: stub.uri, startedAt: new Date(),
  });
  await insertStep(db, wi.id, 'wf-stop', 'act-nostop', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-nostop', actionServerUri: stub.uri, startedAt: new Date(),
  });

  // First pass: cancellations + STOP dispatch, but the instance stays 'stopping' — two action
  // steps are still active.
  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  expect((await stepRow(db, wi.id, 'ready-1')).state).toBe('CANCELLED');
  expect((await stepRow(db, wi.id, 'ui-1')).state).toBe('CANCELLED');
  const trace1 = await traceOf(db, wi.id);
  expect(trace1.some(([oid]) => oid === 'ready-1')).toBe(false); // no trace for a never-started step
  expect(trace1.some(([oid]) => oid === 'ui-1')).toBe(false);

  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, actStopServerId, 'STOP');
  expect(sendCommandSpy).not.toHaveBeenCalledWith(stub.uri, 'ai-nostop', 'STOP'); // unsupported

  expect((await instanceRow(db, wi.id)).status).toBe('stopping'); // still draining

  // act-stop's terminal arrives (COMPLETED) — outputs kept, no successor materialized.
  stub.control.advance(actStopServerId, 'COMPLETED', [{ name: 'Result', value: '7' }]);
  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'act-stop')).id, { kind: 'COMPLETED' });

  expect((await stepRow(db, wi.id, 'act-stop')).state).toBe('COMPLETED');
  expect((await instanceRow(db, wi.id)).propertyStore).toMatchObject({ MyResult: '7' });
  expect(await stepRow(db, wi.id, 'tail-stop')).toBeUndefined();
  expect((await instanceRow(db, wi.id)).status).toBe('stopping'); // act-nostop still active

  // act-nostop's terminal arrives as a failure — must NOT be caught by its matching TRY ERROR.
  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'act-nostop')).id, { kind: 'ERRORED', message: 'boom' });

  const actNostop = await stepRow(db, wi.id, 'act-nostop');
  expect(actNostop.state).toBe('ERRORED');
  const trace2 = await traceOf(db, wi.id);
  expect(trace2).toContainEqual(['act-nostop', 'ERRORED', 'boom']);
  expect(await stepRow(db, wi.id, 'c1')).toBeUndefined(); // never caught

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped'); // last active step drained
  expect(inst.finalState).toBe('stopped');
  expect(inst.completedAt).not.toBeNull();

  await close();
});

// ── round-2 review fix (New-Critical-1 + New-Important-2, one root cause per the reviewer: "the
// stop drain has no disposition for a row that is active but has no live action behind it") — a
// single runStopping sweep resolves BOTH: an already-deferred failure (its server-side action, if
// it ever had one, was already best-effort deleted the moment the failure was deferred — nothing
// will ever poll/command it again) is force-ERRORED (no TRY/CATCH, per the stop rule); a genuine
// ACTION PROXY row that was never invoked (no live action anywhere) is cancelled outright. ──

test('New-Critical-1 + New-Important-2 fix: stop resolves an already-deferred failure and cancels a never-invoked action row, instead of wedging forever', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const client = new ActionClient(['http://fake-origin']);

  const spec = {
    local_id: 'wf', oid: 'wf-stop-wedge', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'),
      step('act-deferred', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' } }),
      step('act-never-invoked', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' } }),
      step('end', 'END'),
    ],
    connections: [],
  };

  // New-Critical-1 scenario: a mid-pause failure was already deferred — the row was left exactly
  // WAITING_ACTION, wake_at cleared (its server-side action was already best-effort deleted the
  // moment the failure was deferred — see monitor.ts).
  const wi = await seedInstance(db, spec, 'wf-stop-wedge', 'paused');
  await insertStep(db, wi.id, 'wf-stop-wedge', 'act-deferred', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-deferred', actionServerUri: 'http://fake-origin', startedAt: new Date(),
  });
  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'act-deferred')).id, { kind: 'ERRORED', message: 'boom' });
  const midEngineState = (await instanceRow(db, wi.id)).engineState as { deferredFailures?: unknown[] };
  expect(midEngineState.deferredFailures).toEqual([{ stepOid: 'act-deferred', mode: 'ERROR', message: 'boom' }]);

  // New-Important-2 scenario: a genuine ACTION PROXY row that was never invoked (activated just
  // before the freeze, or awaiting a grace re-invoke) — action_instance_id null, but NOT a
  // WORKFLOW PROXY proxy park (distinguished by step_type).
  await insertStep(db, wi.id, 'wf-stop-wedge', 'act-never-invoked', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(),
  });

  await requestStop(db, wi.id);
  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  const deferredRow = await stepRow(db, wi.id, 'act-deferred');
  expect(deferredRow.state).toBe('ERRORED'); // resolved honestly, no TRY/CATCH re-entry
  expect(deferredRow.wakeAt).toBeNull();
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['act-deferred', 'ERRORED', 'boom']);

  const neverInvokedRow = await stepRow(db, wi.id, 'act-never-invoked');
  expect(neverInvokedRow.state).toBe('CANCELLED');

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped'); // settles — NOT wedged in 'stopping' forever
  expect(inst.finalState).toBe('stopped');
  const finalEngineState = inst.engineState as { deferredFailures?: unknown[] };
  expect(finalEngineState.deferredFailures).toEqual([]);

  await close();
});

// ── review Critical 2 fix: a stopping drain that has nothing NEW to do must report no work, so
// the worker loop actually idles instead of spinning at 100% CPU re-claiming the same instance
// (and re-running capabilities()+sendCommand() network calls) every single iteration. ──

test('Critical 2 fix: the loop goes idle once a stopping drain has nothing new to do (waiting on an action)', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });

  const spec = {
    local_id: 'wf', oid: 'wf-stop-idle', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [step('start', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }), step('end', 'END')],
    connections: [],
  };
  const wi = await seedInstance(db, spec, 'wf-stop-idle', 'stopping');
  const { instanceId: serverInstanceId } = await client.invoke(stub.uri, 'act-pause', {
    environment_oid: 'env-1', workflow_instance_id: wi.id, step_instance_id: 'placeholder',
    step_oid: 'act', input_parameters: [],
  });
  await insertStep(db, wi.id, 'wf-stop-idle', 'act', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: serverInstanceId, actionServerUri: stub.uri, startedAt: new Date(),
  });

  // First drain: genuine work happens (STOP dispatch, and — since due-wake's own claim is ALSO
  // widened to 'stopping' — one legitimate safety poll once wake_at comes due). Bounded well
  // below the runaway cap either way; the real proof is the SECOND call below.
  const cycles = await pumpUntilQuiet(db, deps, 5);
  expect(cycles).toBeLessThan(5);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping'); // still correctly waiting on the action

  // Second drain, same (unchanged) clock: nothing changed since — STOP was already attempted
  // (stoppedActions dedupes it), the safety poll already re-armed itself into the future, and the
  // action still hasn't terminaled. Pre-fix, runControlPass unconditionally returned `true`
  // whenever it claimed anything, so this would report a full 5 (the bound) here too, forever.
  const cyclesAgain = await pumpUntilQuiet(db, deps, 5);
  expect(cyclesAgain).toBe(0);

  await close();
});

// ── data safety round 2 (spec 2026-10-22 §2): an action server whose capabilities are not yet
// known (unreachable, cold cache) is "unknown", not "unsupported" — the STOP is retried, never
// recorded as handled on a guess. A server that answers without the action IS unsupported. ──

const STOP_UNKNOWN_SPEC = {
  local_id: 'wf', oid: 'wf-stop-unknown', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: ENV_SPECS,
  steps: [
    step('start', 'START'),
    step('act-stop', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }),
    step('end', 'END'),
  ],
  connections: [],
};

async function seedStoppingWithAction(
  db: any, client: ActionClient, s: StubActionServer,
): Promise<{ wi: { id: string }; serverInstanceId: string }> {
  const wi = await seedInstance(db, STOP_UNKNOWN_SPEC, 'wf-stop-unknown', 'stopping');
  const { instanceId: serverInstanceId } = await client.invoke(s.uri, 'act-pause', {
    environment_oid: 'env-1', workflow_instance_id: wi.id, step_instance_id: 'placeholder',
    step_oid: 'act-stop', input_parameters: [],
  });
  await insertStep(db, wi.id, 'wf-stop-unknown', 'act-stop', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: serverInstanceId, actionServerUri: s.uri, startedAt: new Date(),
  });
  return { wi, serverInstanceId };
}

test('stop with an unreachable action server: STOP is retried, then sent exactly once when it answers', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { wi, serverInstanceId } = await seedStoppingWithAction(db, client, stub);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const stoppedActions = async () => ((await instanceRow(db, wi.id)).engineState as { stoppedActions?: string[] }).stoppedActions ?? [];

  stub.control.setCapabilitiesAvailable(false);
  await runControlPass(db, deps);
  expect(sendCommandSpy).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'STOP');
  expect(await stoppedActions()).not.toContain('act-stop');
  expect(errorSpy.mock.calls.some(([msg]) =>
    typeof msg === 'string' && msg.includes(`waiting to send STOP: action server ${stub!.uri} not reachable`))).toBe(true);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping');

  // The server answers again; warm the cache directly (past the warm-up's 30 s back-off).
  stub.control.setCapabilitiesAvailable(true);
  await client.capabilities(stub.uri);
  await runControlPass(db, deps);
  expect(sendCommandSpy).toHaveBeenCalledTimes(1);
  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, serverInstanceId, 'STOP');
  expect(await stoppedActions()).toContain('act-stop');

  // A further pass sends nothing new.
  await runControlPass(db, deps);
  expect(sendCommandSpy).toHaveBeenCalledTimes(1);

  errorSpy.mockRestore();
  await close();
});

test('a server that answers without the action is unsupported, recorded once', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-nopause', { supportedCommands: ['ABORT'] }); // act-pause NOT registered
  const { wi } = await seedStoppingWithAction(db, client, stub);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  await runControlPass(db, deps);
  expect(sendCommandSpy).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'STOP');
  const state = (await instanceRow(db, wi.id)).engineState as { stoppedActions?: string[] };
  expect(state.stoppedActions).toEqual(['act-stop']);

  await close();
});

test('the loop goes idle while a STOP waits on an unknown server', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { wi } = await seedStoppingWithAction(db, client, stub);
  stub.control.setCapabilitiesAvailable(false);

  const did = await runControlPass(db, deps);
  expect(did).toBe(false);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping');

  errorSpy.mockRestore();
  await close();
});

test('a STOP waiting on an unknown server does not starve other transitional instances', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'] });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { wi: waiting } = await seedStoppingWithAction(db, client, stub);
  stub.control.setCapabilitiesAvailable(false);

  // A second stopping instance with a never-started READY step — real work for its pass.
  const other = await seedInstance(db, STOP_UNKNOWN_SPEC, 'wf-stop-other', 'stopping');
  await insertStep(db, other.id, 'wf-stop-other', 'act-stop', 'ACTION PROXY', 'READY');

  // The waiting instance is the oldest, so it is claimed first; both sort before the fake clock.
  await db.update(workflowInstance).set({ updatedAt: new Date('2025-12-01T00:00:00.000Z') }).where(eq(workflowInstance.id, waiting.id));
  await db.update(workflowInstance).set({ updatedAt: new Date('2025-12-02T00:00:00.000Z') }).where(eq(workflowInstance.id, other.id));

  expect(await runControlPass(db, deps)).toBe(false); // the waiting one — nothing it can do yet
  expect((await instanceRow(db, waiting.id)).updatedAt.getTime()).toBe(clock.now().getTime()); // rotated to the back
  expect(await runControlPass(db, deps)).toBe(true); // the other one is reached next, not starved
  expect((await stepRow(db, other.id, 'act-stop')).state).toBe('CANCELLED');

  errorSpy.mockRestore();
  await close();
});

// ── final-review Important 1 fix (I2): a stopping drain that's genuinely idle (didWork=false —
// exactly the Critical 2 condition above) must still emit a periodic operator-visible heartbeat
// instead of producing zero log signal for its entire stay. ──

test('I2 fix: an idle stopping drain logs a rate-limited heartbeat instead of staying silent forever', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const heartbeats = () =>
    errorSpy.mock.calls.filter(([msg]) => typeof msg === 'string' && msg.includes('still draining'));

  // A parked WAIT ALL (EXECUTING, no live action anywhere) never resolves on its own — the same
  // "abort is the documented escape hatch" scenario runStopping's own doc comment describes —
  // so every pass here is genuinely idle (didWork=false) with zero HTTP client needed.
  const spec = {
    local_id: 'wf', oid: 'wf-stop-heartbeat', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('start', 'START'), step('wa', 'WAIT ALL'), step('end', 'END')],
    connections: [],
  };
  const wi = await seedInstance(db, spec, 'wf-stop-heartbeat', 'stopping');
  await insertStep(db, wi.id, 'wf-stop-heartbeat', 'wa', 'WAIT ALL', 'EXECUTING', { startedAt: new Date() });

  const did1 = await runControlPass(db, deps);
  expect(did1).toBe(false); // nothing NEW to do — matches the Critical 2 contract exactly
  expect((await instanceRow(db, wi.id)).status).toBe('stopping');
  expect(heartbeats()).toHaveLength(1);
  expect(heartbeats()[0][0]).toBe(`[mission-engine] instance ${wi.id} still draining (stopping): 1 active steps`);

  // Immediately again, same clock — well under the 5-minute interval — no second heartbeat.
  const did2 = await runControlPass(db, deps);
  expect(did2).toBe(false);
  expect(heartbeats()).toHaveLength(1);

  // Advance past the interval — the heartbeat fires again.
  clock.advance(5 * 60 + 1);
  const did3 = await runControlPass(db, deps);
  expect(did3).toBe(false);
  expect(heartbeats()).toHaveLength(2);

  errorSpy.mockRestore();
  await close();
});

// ── ABORT: from each of queued|running|paused|stopping -> aborted with correct dispositions ──

test('abort from queued (never started) settles immediately with an empty trace', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });

  const spec = { local_id: 'wf', oid: 'wf-abort-q', version: '1.0.0', last_modified_date: '2026-01-01', steps: [step('start', 'START'), step('end', 'END')], connections: [] };
  const wi = await seedInstance(db, spec, 'wf-abort-q', 'aborting', {}, { neverStarted: true });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');
  expect(inst.startedAt).toBeNull();
  expect(await traceOf(db, wi.id)).toEqual([]);

  await close();
});

test('abort from running: READY cancelled, active steps ABORTED with commands sent, instance settles aborted', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const stubUri = stub.uri;
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const deleteInstanceSpy = vi.spyOn(client, 'deleteInstance');

  const spec = {
    local_id: 'wf', oid: 'wf-abort-r', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'), step('ready-1', 'SCRIPT'), step('ui-1', 'USER_INTERACTION'),
      step('act-1', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }),
      step('done-1', 'SCRIPT'), step('end', 'END'),
    ],
    connections: [],
  };
  const wi = await seedInstance(db, spec, 'wf-abort-r', 'aborting');
  await insertStep(db, wi.id, 'wf-abort-r', 'ready-1', 'SCRIPT', 'READY');
  await insertStep(db, wi.id, 'wf-abort-r', 'ui-1', 'USER_INTERACTION', 'WAITING_USER', { startedAt: new Date() });
  await insertStep(db, wi.id, 'wf-abort-r', 'act-1', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-1', actionServerUri: stub.uri, startedAt: new Date(),
  });
  await insertStep(db, wi.id, 'wf-abort-r', 'done-1', 'SCRIPT', 'COMPLETED', { startedAt: new Date(), completedAt: new Date() });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  expect((await stepRow(db, wi.id, 'ready-1')).state).toBe('CANCELLED');
  expect((await stepRow(db, wi.id, 'ui-1')).state).toBe('ABORTED');
  expect((await stepRow(db, wi.id, 'act-1')).state).toBe('ABORTED');
  expect((await stepRow(db, wi.id, 'done-1')).state).toBe('COMPLETED'); // untouched

  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['ui-1', 'ABORTED', null]);
  expect(trace).toContainEqual(['act-1', 'ABORTED', null]);
  expect(trace.some(([oid]) => oid === 'ready-1')).toBe(false); // no trace — never started

  await vi.waitFor(() => {
    expect(sendCommandSpy).toHaveBeenCalledWith(stubUri, 'ai-1', 'ABORT');
    expect(deleteInstanceSpy).toHaveBeenCalledWith(stubUri, 'ai-1');
  });

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect(inst.finalState).toBe('aborted');

  await close();
});

test('abort from paused: a paused action step is ABORTED with best-effort ABORT + delete', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const stubUri = stub.uri;
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = {
    local_id: 'wf', oid: 'wf-abort-p', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [step('start', 'START'), step('act-2', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }), step('end', 'END')],
    connections: [],
  };
  const wi = await seedInstance(db, spec, 'wf-abort-p', 'aborting');
  await insertStep(db, wi.id, 'wf-abort-p', 'act-2', 'ACTION PROXY', 'PAUSED', {
    actionInstanceId: 'ai-2', actionServerUri: stub.uri, startedAt: new Date(),
  });

  await runControlPass(db, deps);

  expect((await stepRow(db, wi.id, 'act-2')).state).toBe('ABORTED');
  await vi.waitFor(() => expect(sendCommandSpy).toHaveBeenCalledWith(stubUri, 'ai-2', 'ABORT'));
  expect((await instanceRow(db, wi.id)).status).toBe('aborted');

  await close();
});

test('abort from stopping: a parked WAIT ALL (EXECUTING, no action) is ABORTED with no network call', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });

  const spec = {
    local_id: 'wf', oid: 'wf-abort-s', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('start', 'START'), step('wa', 'WAIT ALL'), step('end', 'END')],
    connections: [],
  };
  const wi = await seedInstance(db, spec, 'wf-abort-s', 'aborting');
  await insertStep(db, wi.id, 'wf-abort-s', 'wa', 'WAIT ALL', 'EXECUTING', { startedAt: new Date() });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);

  const wa = await stepRow(db, wi.id, 'wa');
  expect(wa.state).toBe('ABORTED');
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['wa', 'ABORTED', null]);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');

  await close();
});

// ── Task 12 mandatory: control passes over an instance with an active child workflow ──

const CHILD_SPEC = {
  local_id: 'parent-wf', oid: 'wf-ctrl-child', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step2('start', 'p-start', 'START'),
    step2('ChildRef', 'proxy', 'WORKFLOW PROXY'),
    step2('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-ctrl', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step2('c-start', 'c-start', 'START'),
        step2('c-form', 'c-form', 'USER_INTERACTION'),
        step2('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-form' },
        { from_step_id: 'c-form', to_step_id: 'c-end' },
      ],
    },
  ],
};

function step2(localId: string, oid: string, stepType: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { local_id: localId, oid, step_type: stepType, version: '1.0.0', last_modified_date: '2026-01-01', ...extra };
}

async function seedActiveChild(db: any): Promise<{ id: string }> {
  const wi = await seedQueued(db, CHILD_SPEC, 'wf-ctrl-child');
  await pumpUntilQuiet(db, testDeps());
  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('WAITING_ACTION');
  expect(proxy.actionInstanceId).toBeNull(); // Task 12: proxy row, never an action step
  const cForm = await stepRow(db, wi.id, 'c-form');
  expect(cForm.state).toBe('WAITING_USER');
  return wi;
}

test('pause over an instance with an active child workflow: proxy row and child step both untouched, instance settles paused', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedActiveChild(db);
  await requestPause(db, wi.id);
  const deps = testDeps();

  await pumpUntilQuiet(db, deps);

  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('WAITING_ACTION'); // never treated as an action step — untouched
  const cForm = await stepRow(db, wi.id, 'c-form');
  expect(cForm.state).toBe('WAITING_USER'); // untouched
  expect((await instanceRow(db, wi.id)).status).toBe('paused'); // nothing to pause — settles immediately

  await close();
});

test('abort over an instance with an active child workflow: both the proxy row and the child step are ABORTED', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedActiveChild(db);
  await requestAbort(db, wi.id);
  const deps = testDeps();

  await pumpUntilQuiet(db, deps);

  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('ABORTED');
  const cForm = await stepRow(db, wi.id, 'c-form');
  expect(cForm.state).toBe('ABORTED');
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['proxy', 'ABORTED', null]);
  expect(trace).toContainEqual(['c-form', 'ABORTED', null]);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');

  await close();
});

// ── post-merge ticket fix (phase-3 final review #2): stop over an active WORKFLOW PROXY child.
// A stopping instance cancels the child's own parked steps, but the child then has no END that
// will ever COMPLETE — so completeChildWorkflow never fires and the proxy row (WAITING_ACTION,
// action_instance_id NULL) counted as active forever: the instance could never settle 'stopped'
// and abort was the only exit. The fix: a proxy row whose child subtree has no active rows left
// is cancelled outright, exactly like any other step with nothing live behind it. ──

test('stop over an instance with an active child workflow: child form cancelled, proxy row cancelled, instance settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedActiveChild(db);
  await requestStop(db, wi.id);
  const deps = testDeps();

  await pumpUntilQuiet(db, deps);

  const cForm = await stepRow(db, wi.id, 'c-form');
  expect(cForm.state).toBe('CANCELLED');
  const proxy = await stepRow(db, wi.id, 'proxy');
  expect(proxy.state).toBe('CANCELLED'); // nothing live behind it once the child is swept — never wedged

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped'); // NOT stuck 'stopping' with abort as the only exit
  expect(inst.finalState).toBe('stopped');
  expect(inst.completedAt).not.toBeNull();
  const engineState = inst.engineState as { childActive?: Record<string, string> };
  expect(engineState.childActive ?? {}).toEqual({}); // link cleared, mirroring completeChildWorkflow

  // Cancellation stays queue-vocabulary-only (no reference StepState for it) — no new traces.
  const trace = await traceOf(db, wi.id);
  expect(trace.some(([, state]) => state === 'CANCELLED')).toBe(false);

  await close();
});

const NESTED_STOP_SPEC = {
  local_id: 'parent-wf', oid: 'wf-stop-nested', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step2('start', 'p-start', 'START'),
    step2('ChildRef', 'proxy', 'WORKFLOW PROXY'),
    step2('end', 'p-end', 'END'),
  ],
  connections: [
    { from_step_id: 'p-start', to_step_id: 'proxy' },
    { from_step_id: 'proxy', to_step_id: 'p-end' },
  ],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-stop-nested', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step2('c-start', 'c-start', 'START'),
        step2('GrandRef', 'c-proxy', 'WORKFLOW PROXY'),
        step2('c-end', 'c-end', 'END'),
      ],
      connections: [
        { from_step_id: 'c-start', to_step_id: 'c-proxy' },
        { from_step_id: 'c-proxy', to_step_id: 'c-end' },
      ],
      children: [
        {
          local_id: 'GrandRef', oid: 'grand-stop-nested', version: '1.0.0', last_modified_date: '2026-01-01',
          parentChildSpecId: null, state: 'Effective',
          steps: [
            step2('g-start', 'g-start', 'START'),
            step2('g-form', 'g-form', 'USER_INTERACTION'),
            step2('g-end', 'g-end', 'END'),
          ],
          connections: [
            { from_step_id: 'g-start', to_step_id: 'g-form' },
            { from_step_id: 'g-form', to_step_id: 'g-end' },
          ],
        },
      ],
    },
  ],
};

test('stop over nested child workflows: proxy cancellation cascades bottom-up until the instance settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, NESTED_STOP_SPEC, 'wf-stop-nested');
  const deps = testDeps();
  await pumpUntilQuiet(db, deps);

  // Both nesting levels genuinely active before the stop.
  expect((await stepRow(db, wi.id, 'proxy')).state).toBe('WAITING_ACTION');
  expect((await stepRow(db, wi.id, 'c-proxy')).state).toBe('WAITING_ACTION');
  expect((await stepRow(db, wi.id, 'g-form')).state).toBe('WAITING_USER');

  await requestStop(db, wi.id);
  await pumpUntilQuiet(db, deps);

  expect((await stepRow(db, wi.id, 'g-form')).state).toBe('CANCELLED');
  expect((await stepRow(db, wi.id, 'c-proxy')).state).toBe('CANCELLED');
  expect((await stepRow(db, wi.id, 'proxy')).state).toBe('CANCELLED');

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  const engineState = inst.engineState as { childActive?: Record<string, string> };
  expect(engineState.childActive ?? {}).toEqual({});

  await close();
});

test('stop with a live child action: the proxy row waits for the child to drain, then cancels and settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const client = new ActionClient(['http://fake-origin']);

  const parentSpec = {
    local_id: 'parent-wf', oid: 'wf-stop-child-act', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step2('start', 'p-start', 'START'),
      step2('ChildRef', 'proxy', 'WORKFLOW PROXY'),
      step2('end', 'p-end', 'END'),
    ],
    connections: [
      { from_step_id: 'p-start', to_step_id: 'proxy' },
      { from_step_id: 'proxy', to_step_id: 'p-end' },
    ],
    children: [
      {
        local_id: 'ChildRef', oid: 'child-stop-act', version: '1.0.0', last_modified_date: '2026-01-01',
        parentChildSpecId: null, state: 'Effective',
        steps: [
          step2('c-start', 'c-start', 'START'),
          step2('c-act', 'c-act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-nopause', environment_oid: 'env-1' } }),
          step2('c-end', 'c-end', 'END'),
        ],
        connections: [
          { from_step_id: 'c-start', to_step_id: 'c-act' },
          { from_step_id: 'c-act', to_step_id: 'c-end' },
        ],
      },
    ],
  };

  const wi = await seedInstance(db, parentSpec, 'wf-stop-child-act', 'stopping', {
    childActive: { proxy: 'child-stop-act' },
  });
  await insertStep(db, wi.id, 'wf-stop-child-act', 'proxy', 'WORKFLOW PROXY', 'WAITING_ACTION', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(),
  });
  await insertStep(db, wi.id, 'child-stop-act', 'c-act', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-c-act', actionServerUri: 'http://fake-origin', startedAt: new Date(),
  });

  // While the child's action is still live, the proxy must NOT be cancelled — the stop keeps
  // draining exactly as before, and the pass reports no NEW work (Task 16 Critical-2 contract:
  // the worker loop must be able to idle, not spin, on this exact state).
  expect(await runControlPass(db, deps)).toBe(false);
  expect((await stepRow(db, wi.id, 'proxy')).state).toBe('WAITING_ACTION');
  expect((await instanceRow(db, wi.id)).status).toBe('stopping');

  // The child action's terminal arrives (a failure — force-ERRORED during stop, no TRY/CATCH);
  // the child subtree is now quiet, so the next pass cancels the proxy and settles.
  await applyActionTerminal(db, deps, client, (await stepRow(db, wi.id, 'c-act')).id, { kind: 'ERRORED', message: 'boom' });
  expect((await instanceRow(db, wi.id)).status).toBe('stopping'); // proxy still active at this instant

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);
  expect((await stepRow(db, wi.id, 'proxy')).state).toBe('CANCELLED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');

  await close();
});

test('stop over a proxy row with no childActive entry (defensive): cancelled outright, instance settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });

  // Activation always records childActive before parking, so this state should be unreachable —
  // but if it ever occurs, no child subtree can EVER complete the proxy, so the drain must
  // cancel it rather than wedge (same posture as the never-invoked ACTION PROXY row).
  const spec = {
    local_id: 'parent-wf', oid: 'wf-stop-no-link', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [
      step2('start', 'p-start', 'START'),
      step2('ChildRef', 'proxy', 'WORKFLOW PROXY'),
      step2('end', 'p-end', 'END'),
    ],
    connections: [
      { from_step_id: 'p-start', to_step_id: 'proxy' },
      { from_step_id: 'proxy', to_step_id: 'p-end' },
    ],
  };
  const wi = await seedInstance(db, spec, 'wf-stop-no-link', 'stopping');
  await insertStep(db, wi.id, 'wf-stop-no-link', 'proxy', 'WORKFLOW PROXY', 'WAITING_ACTION', {
    actionInstanceId: null, actionServerUri: null, startedAt: new Date(),
  });

  const did = await runControlPass(db, deps);
  expect(did).toBe(true);
  expect((await stepRow(db, wi.id, 'proxy')).state).toBe('CANCELLED');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');

  await close();
});

// ── full request -> settle round-trips through the Task 2 DAOs ──

const UI_ONLY_SPEC = {
  local_id: 'wf', oid: 'wf-roundtrip', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('start', 'START'), step('ui', 'USER_INTERACTION'), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'ui' }, { from_step_id: 'ui', to_step_id: 'end' }],
};

test('DAO round trip: pause then resume, instance stays completable', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, UI_ONLY_SPEC, 'wf-roundtrip-1');
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'ui')).state).toBe('WAITING_USER');

  await requestPause(db, wi.id);
  expect((await instanceRow(db, wi.id)).status).toBe('pausing');
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  await requestResume(db, wi.id);
  expect((await instanceRow(db, wi.id)).status).toBe('resuming');
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('running');

  await submitUserAction(db, wi.id, { step_oid: 'ui', action: 'submit' }, 0, deps);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');

  await close();
});

test('DAO round trip: stop cancels the parked step and settles stopped', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, UI_ONLY_SPEC, 'wf-roundtrip-2');
  await pumpUntilQuiet(db, deps);

  await requestStop(db, wi.id);
  expect((await instanceRow(db, wi.id)).status).toBe('stopping');
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('stopped');
  expect(inst.finalState).toBe('stopped');
  expect((await stepRow(db, wi.id, 'ui')).state).toBe('CANCELLED');

  await close();
});

test('DAO round trip: abort from running settles aborted', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, UI_ONLY_SPEC, 'wf-roundtrip-3');
  await pumpUntilQuiet(db, deps);

  await requestAbort(db, wi.id);
  expect((await instanceRow(db, wi.id)).status).toBe('aborting');
  await pumpUntilQuiet(db, deps);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted');
  expect((await stepRow(db, wi.id, 'ui')).state).toBe('ABORTED');

  await close();
});

// ── Task 15 review open finding (M2), now load-bearing for controls: the invoke-record
// conditional in loop.ts must guard on the row's queue state, not just action_instance_id, since
// a control pass can now commit WHILE deps.invoker.begin()'s network call is still in flight
// (begin() runs entirely outside any transaction, by design). Constructed deterministically —
// no real concurrency needed — via a fake invoker whose begin() itself runs the racing abort
// control pass (single-threaded JS: the abort's own transaction fully commits, including
// settling the instance, before begin() returns "success" to invokeDueStep) before that success
// ever reaches the record transaction. ──

test('M2 fix: an invoke racing a concurrent abort must not stamp the action id onto an already-ABORTED row', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const client = new ActionClient(['http://fake-origin']);
  const deleteInstanceSpy = vi.spyOn(client, 'deleteInstance');

  const spec = {
    local_id: 'wf', oid: 'wf-race', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [step('start', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }), step('end', 'END')],
    connections: [],
  };
  const wi = await seedInstance(db, spec, 'wf-race', 'running');
  await insertStep(db, wi.id, 'wf-race', 'act', 'ACTION PROXY', 'WAITING_ACTION', {
    wakeAt: clock.now(), startedAt: new Date(),
  });

  let deps!: EngineDeps;
  const racingInvoker: ActionInvoker = {
    dispatches: true,
    client,
    bindingLookup: null,
    async begin(): Promise<ActionBeginResult> {
      // Simulate the race: the control pass commits its ENTIRE abort — including settling the
      // instance — before this "network call" resolves back to invokeDueStep.
      await requestAbort(db, wi.id);
      await runControlPass(db, deps);
      return { ok: true, instanceId: 'server-instance-x', serverUri: 'http://fake-origin', invokedActionOid: 'act-pause' };
    },
  };
  deps = testDeps({ now: clock.now, invoker: racingInvoker });

  const didWork = await runOnce(db, deps);
  expect(didWork).toBe(true); // the invoke attempt itself is "work", even though it lost the race

  const actAfter = await stepRow(db, wi.id, 'act');
  expect(actAfter.state).toBe('ABORTED'); // NOT overwritten back toward WAITING_ACTION
  expect(actAfter.actionInstanceId).toBeNull(); // the successful invoke's id was never stamped

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('aborted'); // the abort's own settle stands, untouched

  // The orphaned server-side instance the "invoke" created is still best-effort cleaned up.
  expect(deleteInstanceSpy).toHaveBeenCalledWith('http://fake-origin', 'server-instance-x');

  await close();
});

// ── review Critical 4 fix: due-wake's own status widening (for polls/timeouts) must never let
// the INVOKE branch (first invoke, or a grace-recovery re-invoke) fire while dispatch is frozen —
// spec E2: "no new steps activate." ──

for (const status of ['paused', 'stopping'] as const) {
  test(`Critical 4 fix: no invoke fires for a never-yet-invoked action row while the instance is ${status}`, async () => {
    const { db, close } = await makeTestDb();
    stub = startStubActionServer(0);
    const clock = makeClock();
    const { deps, client } = makeHttpDeps(stub, clock);
    const invokeSpy = vi.spyOn(client, 'invoke');

    const spec = {
      local_id: 'wf', oid: `wf-c4-${status}`, version: '1.0.0', last_modified_date: '2026-01-01',
      environment_specifications: ENV_SPECS,
      steps: [step('start', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }), step('end', 'END')],
      connections: [],
    };
    const wi = await seedInstance(db, spec, `wf-c4-${status}`, status);
    await insertStep(db, wi.id, `wf-c4-${status}`, 'act', 'ACTION PROXY', 'WAITING_ACTION', {
      actionInstanceId: null, actionServerUri: null, startedAt: new Date(), wakeAt: clock.now(), // due right now
    });

    const didWork = await processDueActionWork(db, deps);
    expect(didWork).toBe(false); // claimed the row but correctly declined to act on it
    expect(invokeSpy).not.toHaveBeenCalled();

    const after = await stepRow(db, wi.id, 'act');
    expect(after.state).toBe('WAITING_ACTION');
    expect(after.actionInstanceId).toBeNull(); // never invoked

    await close();
  });
}

// ── review Important 1 fix: a throwing control pass must be recovered (bounded retry, then
// settle errored) rather than permanently wedging the claim order — proven by seeding a SECOND,
// healthy transitional instance that must still get serviced while the poisoned one retries. ──

test('Important 1 fix: a throwing control pass is bounded-retried then settled errored, without starving a healthy instance', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const poisonedSpec = {
    local_id: 'wf', oid: 'wf-poisoned', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [step('start', 'START'), step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }), step('end', 'END')],
    connections: [],
  };
  const poisoned = await seedInstance(db, poisonedSpec, 'wf-poisoned', 'pausing');
  // A row whose node_oid resolves to nothing in the spec tree — contextForNode throws the instant
  // runPausing tries to resolve it, deterministically forcing the control pass to fail.
  await insertStep(db, poisoned.id, 'BOGUS-NODE-OID', 'act', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-poison', actionServerUri: stub.uri, startedAt: new Date(),
  });
  // Stagger updated_at explicitly (defaultNow() timestamps from two inserts in rapid succession
  // can tie, making claim order ambiguous) — poisoned is the OLDEST, so it's claimed first.
  await db.update(workflowInstance).set({ updatedAt: new Date('2020-01-01') }).where(eq(workflowInstance.id, poisoned.id));

  const healthySpec = {
    local_id: 'wf', oid: 'wf-healthy', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('start', 'START'), step('ui', 'USER_INTERACTION'), step('end', 'END')],
    connections: [],
  };
  const healthy = await seedInstance(db, healthySpec, 'wf-healthy', 'pausing');
  // No action rows — its own pausing pass has nothing to iterate, settles 'paused' immediately.
  // Newer than poisoned's original updated_at but older than the fake clock's "now" (2026-01-01),
  // which is what poisoned's own recovery will bump ITS updated_at to.
  await db.update(workflowInstance).set({ updatedAt: new Date('2021-01-01') }).where(eq(workflowInstance.id, healthy.id));

  // Attempt 1: poisoned (oldest updated_at) is claimed, throws, is recovered — bounded retry
  // attempt 1/3, updated_at bumped forward to "now".
  const r1 = await runControlPass(db, deps);
  expect(r1).toBe(true);
  const afterR1 = await instanceRow(db, poisoned.id);
  expect(afterR1.status).toBe('pausing'); // still retrying, not stuck, not yet given up
  expect((afterR1.engineState as { controlPassAttempts?: number }).controlPassAttempts).toBe(1);

  // Attempt 2: healthy is now the OLDER of the two (poisoned's updated_at just advanced past it)
  // — proving the poisoned instance does NOT starve it out of the claim order.
  const r2 = await runControlPass(db, deps);
  expect(r2).toBe(true);
  expect((await instanceRow(db, healthy.id)).status).toBe('paused'); // serviced normally

  // Attempts 3 and 4: only poisoned is left transitional — retries to exhaustion (3 attempts
  // total), then gives up and settles the instance 'errored'.
  const r3 = await runControlPass(db, deps);
  expect(r3).toBe(true);
  const r4 = await runControlPass(db, deps);
  expect(r4).toBe(true);

  const final = await instanceRow(db, poisoned.id);
  expect(final.status).toBe('errored');
  expect(final.finalState).toBe('errored');
  const trace = await traceOf(db, poisoned.id);
  expect(trace.some(([oid, state]) => oid === null && state === 'ERRORED')).toBe(true);

  await close();
});

// ── round-2 review fix (New-Important-3): controlPassAttempts must reset on a successful pass —
// it is not a lifetime counter. Without the reset, three separate, non-consecutive transient
// blips recovered across an instance's whole life (each its own successful control-pass cycle in
// between) would settle a perfectly healthy instance errored on the third one. ──

test('New-Important-3 fix: controlPassAttempts resets on a successful pass — a later single blip is not treated as already-exhausted', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps } = makeHttpDeps(stub, clock);

  const spec = {
    local_id: 'wf', oid: 'wf-i3', version: '1.0.0', last_modified_date: '2026-01-01',
    steps: [step('start', 'START'), step('ui', 'USER_INTERACTION'), step('end', 'END')],
    connections: [],
  };
  // Seed with a STALE attempts=2 (simulating two earlier, non-consecutive recovered blips).
  const wi = await seedInstance(db, spec, 'wf-i3', 'pausing', { controlPassAttempts: 2 });

  const did = await runControlPass(db, deps); // healthy pass — nothing to touch, settles 'paused'
  expect(did).toBe(true);
  const afterPause = await instanceRow(db, wi.id);
  expect(afterPause.status).toBe('paused');
  expect((afterPause.engineState as { controlPassAttempts?: number }).controlPassAttempts).toBe(0);

  // Force ONE later, genuinely transient throw on a FRESH pausing pass — must be recovered as
  // attempt 1/3 (bounded retry), NOT immediately settled errored (which is what would happen if
  // the stale attempts=2 from before had survived the successful pass in between).
  await db.update(workflowInstance).set({ status: 'pausing', updatedAt: deps.now() }).where(eq(workflowInstance.id, wi.id));
  await insertStep(db, wi.id, 'BOGUS-NODE-OID', 'act', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-blip', actionServerUri: stub.uri, startedAt: new Date(),
  });

  const r = await runControlPass(db, deps);
  expect(r).toBe(true);
  const afterBlip = await instanceRow(db, wi.id);
  expect(afterBlip.status).toBe('pausing'); // recovering — NOT settled errored on the first blip
  expect((afterBlip.engineState as { controlPassAttempts?: number }).controlPassAttempts).toBe(1);

  await close();
});

// ── round-2 review fix (New-Important-4): giving up on a control pass must not just flip the
// instance row — mirrors settleFailedInstance's own precedent: every non-terminal step row is
// force-ERRORED with wake_at cleared (Task 15 Critical-1's "no wake_at once terminal" invariant),
// and any live action-server instance among them is best-effort cleaned up rather than leaked. ──

test('New-Important-4 fix: giving up on a control pass quiesces non-terminal step rows and cleans up any live actions', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock);
  const stubUri = stub.uri;
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const deleteInstanceSpy = vi.spyOn(client, 'deleteInstance');

  const poisonedSpec = {
    local_id: 'wf', oid: 'wf-i4', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'),
      step('act-bogus', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }),
      step('act-live', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1' } }),
      step('end', 'END'),
    ],
    connections: [],
  };
  const wi = await seedInstance(db, poisonedSpec, 'wf-i4', 'pausing');
  await insertStep(db, wi.id, 'BOGUS-NODE-OID', 'act-bogus', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: 'ai-poison', actionServerUri: stub.uri, startedAt: new Date(),
  });
  const { instanceId: liveServerId } = await client.invoke(stub.uri, 'act-pause', {
    environment_oid: 'env-1', workflow_instance_id: wi.id, step_instance_id: 'placeholder',
    step_oid: 'act-live', input_parameters: [],
  });
  await insertStep(db, wi.id, 'wf-i4', 'act-live', 'ACTION PROXY', 'WAITING_ACTION', {
    actionInstanceId: liveServerId, actionServerUri: stub.uri, startedAt: new Date(), wakeAt: clock.now(),
  });

  // Exhaust all 3 attempts — the bogus row's contextForNode failure throws every time.
  await runControlPass(db, deps);
  await runControlPass(db, deps);
  await runControlPass(db, deps);

  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('errored');

  const bogusRow = await stepRow(db, wi.id, 'act-bogus');
  expect(bogusRow.state).toBe('ERRORED');
  expect(bogusRow.wakeAt).toBeNull();

  const liveRow = await stepRow(db, wi.id, 'act-live');
  expect(liveRow.state).toBe('ERRORED');
  expect(liveRow.wakeAt).toBeNull(); // no wake_at survives on a terminal instance

  await vi.waitFor(() => {
    expect(sendCommandSpy).toHaveBeenCalledWith(stubUri, liveServerId, 'ABORT');
    expect(deleteInstanceSpy).toHaveBeenCalledWith(stubUri, liveServerId);
  });

  await close();
});

// ── controller Ruling B / review Important 2 fix: pausing suspends the action-timeout budget for
// a step that actually received PAUSE; it resumes with its REMAINING budget rather than the clock
// having run out underneath it while paused. ──

test('Important 2 fix: pause suspends the action timeout budget; a PAUSED step does not time out and resumes with its remaining budget', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const clock = makeClock();
  const { deps, client } = makeHttpDeps(stub, clock); // actionPollSecs: 5
  // `actionName` (spec 2026-08-20): this is the one test in this file that DISPATCHES for real
  // rather than hand-seeding its action row, so it goes through loose matching (the system
  // default) — the container must advertise `act-pause` under the name ENV_SPECS gives it, or
  // resolution fails and nothing is ever invoked. Every other setCapabilities call in this file
  // only feeds command-legality checks, which are still oid-keyed.
  stub.control.setCapabilities('act-pause', { supportedCommands: ['PAUSE', 'RESUME', 'ABORT', 'STOP'], actionName: 'Pausable' });
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');

  const spec = {
    local_id: 'wf', oid: 'wf-i2', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: ENV_SPECS,
    steps: [
      step('start', 'START'),
      step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-pause', environment_oid: 'env-1', timeout_ms: 10_000 } }),
      step('end', 'END'),
    ],
    connections: [
      { from_step_id: 'start', to_step_id: 'act' },
      { from_step_id: 'act', to_step_id: 'end' },
    ],
  };
  const wi = await seedQueued(db, spec, 'wf-i2');
  await pumpUntilQuiet(db, deps); // parks + invokes promptly — startedAt = t=0

  const invoked = await stepRow(db, wi.id, 'act');
  expect(invoked.actionInstanceId).toBeTruthy();

  clock.advance(2); // t=2s — 2s of the 10s budget already used
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps); // control pass: PAUSE sent (supported), step -> PAUSED

  expect((await stepRow(db, wi.id, 'act')).state).toBe('PAUSED');
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  sendCommandSpy.mockClear(); // isolate everything that happens from here

  clock.advance(20); // t=22s — WAY past the ORIGINAL (unshifted) 10s deadline
  await pumpUntilQuiet(db, deps); // observation continues (safety poll), but must NOT time out

  expect((await stepRow(db, wi.id, 'act')).state).toBe('PAUSED');
  expect(sendCommandSpy).not.toHaveBeenCalledWith(stub.uri, invoked.actionInstanceId, 'ABORT');

  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, deps); // control pass: RESUME sent, startedAt shifted by the 20s paused duration

  const resumed = await stepRow(db, wi.id, 'act');
  expect(resumed.state).toBe('WAITING_ACTION');
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  // Remaining budget preserved: 10s - 2s used-before-pause = 8s left, giving a new deadline of
  // t=30s (resume at t=22 + 8s remaining) — NOT a full fresh 10s, and not already expired. The
  // shifted startedAt that produces exactly that deadline is t=20s (0 + the 20s paused duration).
  expect(resumed.startedAt.getTime()).toBe(new Date('2026-01-01T00:00:20.000Z').getTime());

  clock.advance(7); // t=29s — still before the shifted deadline (t=30s)
  await pumpUntilQuiet(db, deps);
  expect((await stepRow(db, wi.id, 'act')).state).toBe('WAITING_ACTION'); // not timed out yet

  clock.advance(2); // t=31s — past the shifted deadline
  await pumpUntilQuiet(db, deps);

  expect(sendCommandSpy).toHaveBeenCalledWith(stub.uri, invoked.actionInstanceId, 'ABORT');
  const final = await stepRow(db, wi.id, 'act');
  expect(final.state).toBe('ERRORED'); // TIMEOUT, uncaught (no try_specifications declared)
  const trace = await traceOf(db, wi.id);
  expect(trace).toContainEqual(['act', 'ERRORED', 'action timed out']);
  expect((await instanceRow(db, wi.id)).status).toBe('errored');

  await close();
});
