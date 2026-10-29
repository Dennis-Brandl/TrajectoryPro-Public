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
// Force complete (spec 2026-10-13 §5): the engine verb, the commander's internal route and the
// Pilot's session route.
import { afterEach, expect, test, vi } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry, appUser } from 'mission-control-db/src/db/schema/index';
import { requestPause } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { makeApi } from './helpers/api.js';
import { createInternalApp } from '../src/api/internal.js';
import { loadConfig } from '../src/config.js';
import { forceCompleteStep } from '../src/core/force-complete.js';
import { startStubActionServer, type StubActionServer } from './stub-action-server.js';
import { ActionClient } from '../src/actions/client.js';
import { httpActionInvoker } from '../src/actions/invoker.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});
const gateSpec = (oid: string, gate_config: Record<string, unknown>) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
  steps: [step('s', 'START'), step('g', 'GATE', { gate_config }), step('e', 'END')],
  connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
});
const TIMER = { mode: 'timer', delay_seconds: 600 };
const CONDITION = { cycle_seconds: 5, source: 'return false;' };

let rnSeq = 0;
async function seedQueued(db: any, spec: any, wcId?: string): Promise<{ id: string; workCenterId: string }> {
  const rn = ++rnSeq;
  const workCenterId = wcId ?? (await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning())[0].id;
  const [wf] = await db.insert(workflow).values({ workCenterId, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: rn, runtimeLabel: `RW-${rn}`,
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId };
}
async function gateRow(db: any, instanceId: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === 'g');
}
async function statusOf(db: any, id: string): Promise<string> {
  return (await db.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0].status;
}
async function seedUser(db: any): Promise<string> {
  const [u] = await db.insert(appUser).values({ email: `u-${Math.random()}@t.test`, displayName: 'U' }).returning();
  return u.id;
}
const errCode = async (p: Promise<unknown>) => p.then(() => 'resolved', (e: any) => e.code);

test('commander forces a timer gate: it completes, the workflow continues, and the trace names who and why', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, gateSpec('wf-fc-1', TIMER));
  await pumpUntilQuiet(db, deps);
  const g = await gateRow(db, wi.id);
  const actor = await seedUser(db);
  const r = await forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: actor, reason: ' line clear ', source: 'commander' });
  expect(r).toEqual({ ok: true, summary: 'Forced complete: line clear' });
  expect(await statusOf(db, wi.id)).toBe('completed');
  const trace = (await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id)).orderBy(asc(traceEntry.orderIndex)))
    .filter((t: any) => t.stepOid === 'g').map((t: any) => [t.state, t.error]);
  expect(trace).toEqual([['EXECUTING', null], ['OPERATOR', `Forced complete: line clear [by ${actor}]`], ['COMPLETED', null]]);
  await close();
});

test('commander may force a plain condition gate; pilot may not (NOT_FORCEABLE)', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const actor = await seedUser(db);
  const a = await seedQueued(db, gateSpec('wf-fc-2a', CONDITION));
  await pumpUntilQuiet(db, deps);
  const ga = await gateRow(db, a.id);
  expect(await errCode(forceCompleteStep(db, deps, null, { instanceId: a.id, stepInstanceId: ga.id, actorUserId: actor, source: 'pilot' }))).toBe('NOT_FORCEABLE');
  expect((await gateRow(db, a.id)).state).toBe('WAITING_GATE');
  await forceCompleteStep(db, deps, null, { instanceId: a.id, stepInstanceId: ga.id, actorUserId: actor, reason: 'override', source: 'commander' });
  expect(await statusOf(db, a.id)).toBe('completed');
  await close();
});

test('paused → INSTANCE_PAUSED, checked before the step is even looked up', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const actor = await seedUser(db);
  const wi = await seedQueued(db, gateSpec('wf-fc-3', TIMER));
  await pumpUntilQuiet(db, deps);
  const g = await gateRow(db, wi.id);
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect(await errCode(forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: actor, source: 'pilot' }))).toBe('INSTANCE_PAUSED');
  expect(await errCode(forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: '00000000-0000-4000-8000-000000000009', actorUserId: actor, source: 'commander' }))).toBe('INSTANCE_PAUSED');
  await close();
});

test('force after the timer already opened the gate: RUNTIME_INVALID_STATE (instance finished)', async () => {
  const { db, close } = await makeTestDb();
  let now = new Date('2026-01-01T00:00:00.000Z');
  const deps = testDeps({ now: () => now });
  const actor = await seedUser(db);
  const wi = await seedQueued(db, gateSpec('wf-fc-4', { mode: 'timer', delay_seconds: 5 }));
  await pumpUntilQuiet(db, deps);
  const g = await gateRow(db, wi.id);
  now = new Date(now.getTime() + 5000);
  await pumpUntilQuiet(db, deps); // the timer wins
  expect(await statusOf(db, wi.id)).toBe('completed');
  expect(await errCode(forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: actor, source: 'pilot' }))).toBe('RUNTIME_INVALID_STATE');
  await close();
});

test('a step that left WAITING_GATE on a still-running instance → ALREADY_COMPLETED; unknown step → STEP_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const actor = await seedUser(db);
  // Two parallel-free gates in sequence: force the first, then try the first again while the
  // second keeps the instance running.
  const spec = {
    local_id: 'wf', oid: 'wf-fc-5', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
    steps: [step('s', 'START'), step('g', 'GATE', { gate_config: TIMER }), step('g2', 'GATE', { gate_config: TIMER }), step('e', 'END')],
    connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'g2' }, { from_step_id: 'g2', to_step_id: 'e' }],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const g = await gateRow(db, wi.id);
  await forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: actor, source: 'pilot' });
  expect(await statusOf(db, wi.id)).toBe('running');
  expect(await errCode(forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: actor, source: 'pilot' }))).toBe('ALREADY_COMPLETED');
  expect(await errCode(forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: '00000000-0000-4000-8000-000000000009', actorUserId: actor, source: 'pilot' }))).toBe('STEP_NOT_FOUND');
  await close();
});

test('internal route: token-gated; actor required; status mapping', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps({ config: loadConfig({ DATABASE_URL: 'unused', SCRIPT_TIMEOUT_MS: '5000', ENGINE_INTERNAL_TOKEN: 'secret-1' } as any) });
  const app = createInternalApp(db, deps, null);
  const actor = await seedUser(db);
  const wi = await seedQueued(db, gateSpec('wf-fc-6', TIMER));
  await pumpUntilQuiet(db, deps);
  const g = await gateRow(db, wi.id);
  const post = (path: string, body: unknown, token = 'secret-1') => app.request(path, {
    method: 'POST', headers: { 'x-internal-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const path = `/internal/instances/${wi.id}/steps/${g.id}/force-complete`;
  expect((await post(path, { actorUserId: actor }, 'wrong')).status).toBe(401);
  expect((await post(path, {})).status).toBe(400);
  const ok = await post(path, { actorUserId: actor, reason: 'stuck sensor' });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true, summary: 'Forced complete: stuck sensor' });
  const again = await post(path, { actorUserId: actor });
  expect(again.status).toBe(409);
  expect(((await again.json()) as any).error.code).toBe('RUNTIME_INVALID_STATE');
  expect((await post(`/internal/instances/not-a-uuid/steps/${g.id}/force-complete`, { actorUserId: actor })).status).toBe(404);
  await close();
});

test('Pilot continue route: member continues a timed gate; non-member 403; condition gate 403', async () => {
  const h = await makeApi();
  const [wc] = await h.db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  await h.seedOperator('op-fc@example.com', wc.id);
  await h.seedOperator('op-out-fc@example.com');
  const timed = await seedQueued(h.db, gateSpec('wf-fc-7a', TIMER), wc.id);
  const plain = await seedQueued(h.db, gateSpec('wf-fc-7b', CONDITION), wc.id);
  await pumpUntilQuiet(h.db as any, h.deps);
  const gt = await gateRow(h.db, timed.id);
  const gp = await gateRow(h.db, plain.id);
  const member = await h.cookieFor('op-fc@example.com');
  const outsider = await h.cookieFor('op-out-fc@example.com');
  const post = (cookie: string, id: string, stepId: string) => h.app.request(`/api/runtime-workflows/${id}/steps/${stepId}/continue`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'ready early' }),
  });
  expect((await post(outsider, timed.id, gt.id)).status).toBe(403);
  const forbidden = await post(member, plain.id, gp.id);
  expect(forbidden.status).toBe(403);
  expect(((await forbidden.json()) as any).code).toBe('NOT_FORCEABLE');
  const ok = await post(member, timed.id, gt.id);
  expect(ok.status).toBe(200);
  expect(await statusOf(h.db, timed.id)).toBe('completed');
  expect((await h.app.request(`/api/runtime-workflows/${timed.id}/steps/${gt.id}/continue`, { method: 'POST' })).status).toBe(401);
  await h.close();
});

// ── armed gate (control_previous_action) ──
let stub: StubActionServer | undefined;
afterEach(async () => { if (stub) { await stub.close(); stub = undefined; } });

test('force an ARMED gate while its action runs: gate stays open-waiting, STOP sent once, second force is ALREADY_OPEN', async () => {
  const { db, close } = await makeTestDb();
  stub = startStubActionServer(0);
  const allowlist = [new URL(stub.uri).origin];
  const client = new ActionClient(allowlist);
  const sendCommandSpy = vi.spyOn(client, 'sendCommand');
  const deps = testDeps({
    invoker: httpActionInvoker(client, async () => stub!.uri),
    config: {
      databaseUrl: 'unused', port: 3006, workerConcurrency: 1, actionServerAllowlist: allowlist, scriptTimeoutMs: 5000,
      actionPollSecs: 5, invokeGraceSecs: 5, actionFetchTimeoutMs: 10_000, propertyWatchEnabled: true,
      propertyWatchReconcileMs: 5000, authSecret: 'test-secret', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    },
  });
  const spec = {
    local_id: 'wf', oid: 'wf-fc-armed', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [{
      local_id: 'env', oid: 'env-1', version: '1.0.0', last_modified_date: '2026-01-01',
      included_actions: [{ action_oid: 'act-1', action_name: 'DoThing', action_library: 'lib-1' }],
    }],
    steps: [
      step('s', 'START'),
      step('act', 'ACTION PROXY', { action_proxy_config: { action_oid: 'act-1', environment_oid: 'env-1' } }),
      step('g', 'GATE', { gate_config: { mode: 'timer', delay_seconds: 600, control_previous_action: true } }),
      step('e', 'END'),
    ],
    connections: [
      { from_step_id: 's', to_step_id: 'act' }, { from_step_id: 'act', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' },
    ],
  };
  const wi = await seedQueued(db, spec);
  await pumpUntilQuiet(db, deps);
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  const actionInstanceId = rows.find((r: any) => r.stepOid === 'act')!.actionInstanceId as string;
  expect(actionInstanceId).toBeTruthy();
  await new Promise((r) => setTimeout(r, 100)); // let the SSE GET establish
  const g = await gateRow(db, wi.id);
  const actor = await seedUser(db);
  const force = () => forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: g.id, actorUserId: actor, reason: 'go', source: 'commander' });
  await force();
  expect((await gateRow(db, wi.id)).state).toBe('WAITING_GATE');
  const [inst] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect((inst.engineState as any).armedGates.g).toMatchObject({ open: true, stopSent: true });
  expect(sendCommandSpy.mock.calls.filter((c: any[]) => c[2] === 'STOP')).toHaveLength(1);
  expect(await errCode(force())).toBe('ALREADY_OPEN');
  expect(sendCommandSpy.mock.calls.filter((c: any[]) => c[2] === 'STOP')).toHaveLength(1);
  stub!.control.advance(actionInstanceId, 'STOPPED', []);
  await vi.waitFor(async () => { expect(await statusOf(db, wi.id)).toBe('completed'); }, { timeout: 3000, interval: 20 });
  await close();
});

// ── Repeating SCRIPT (spec 2026-10-13 §6.4) ──
const repeatSpec = (oid: string, source: string) => ({
  local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
  value_property_specifications: [{ name: 'Result', entries: [{ name: 'Runs', value: 'none' }] }],
  steps: [
    step('s', 'START'),
    step('g', 'SCRIPT', {
      script_config: { source, repeat: { cycle_seconds: 600 } },
      output_parameter_specifications: [{ id: 'runs', target: 'Result.Runs' }],
    }),
    step('e', 'END'),
  ],
  connections: [{ from_step_id: 's', to_step_id: 'g' }, { from_step_id: 'g', to_step_id: 'e' }],
});

test('commander and pilot may force a waiting repeating script; it completes with its pending outputs', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const actor = await seedUser(db);
  const a = await seedQueued(db, repeatSpec('wf-fc-rs-1', 'state.n = (state.n || 0) + 1; output.runs = state.n; return false;'));
  const b = await seedQueued(db, repeatSpec('wf-fc-rs-2', 'state.n = (state.n || 0) + 1; output.runs = state.n; return false;'));
  await pumpUntilQuiet(db, deps);
  const ga = await gateRow(db, a.id);
  expect(ga.state).toBe('WAITING_SCRIPT');
  await forceCompleteStep(db, deps, null, { instanceId: a.id, stepInstanceId: ga.id, actorUserId: actor, reason: 'enough', source: 'commander' });
  await forceCompleteStep(db, deps, null, { instanceId: b.id, stepInstanceId: (await gateRow(db, b.id)).id, actorUserId: actor, source: 'pilot' });
  for (const id of [a.id, b.id]) {
    const inst = (await db.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0];
    expect(inst.status).toBe('completed');
    expect((inst.propertyStore as Record<string, string>)['Result.Runs']).toBe('1');
    expect((inst.engineState as any).scriptRuns.g).toBeUndefined();
  }
  const trace = (await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, a.id)).orderBy(asc(traceEntry.orderIndex)))
    .filter((t: any) => t.stepOid === 'g').map((t: any) => [t.state, t.error]);
  expect(trace).toEqual([['EXECUTING', null], ['OPERATOR', `Forced complete: enough [by ${actor}]`], ['COMPLETED', null]]);
  await close();
});

test('force with no pending outputs: completes and leaves the output target untouched', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const actor = await seedUser(db);
  const wi = await seedQueued(db, repeatSpec('wf-fc-rs-3', 'state.seen = true; return false;'));
  await pumpUntilQuiet(db, deps);
  await forceCompleteStep(db, deps, null, { instanceId: wi.id, stepInstanceId: (await gateRow(db, wi.id)).id, actorUserId: actor, reason: 'skip', source: 'commander' });
  const inst = (await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id)))[0];
  expect(inst.status).toBe('completed');
  expect(['none', undefined]).toContain((inst.propertyStore as Record<string, string> | null)?.['Result.Runs']);
  await close();
});
