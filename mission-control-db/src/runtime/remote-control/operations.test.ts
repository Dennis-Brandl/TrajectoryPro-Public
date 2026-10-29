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

import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance, stepInstance, runtimeHistory } from '../../db/schema/index.js';
import { setControlGrant } from '../../dao/control-grants.js';
import { loadCaller, createRuntime, commandRuntime, getRuntimeState, getRuntimeOutputs, RemoteError } from './index.js';

const CALLER_SPEC = { oid: 'root', steps: [{ oid: 'act', step_type: 'ACTION PROXY', action_proxy_config: { action_name: 'Create Runtime Workflow' } }] };
const CHILD_SPEC = {
  oid: 'child', local_id: 'Mix', steps: [], connections: [],
  starting_parameter_specifications: [{ id: 'Batch', default_value: '' }, { id: 'Qty', default_value: '1' }],
  output_parameter_specifications: [{ id: 'Yield', target: 'Result.Yield' }],
};
const NOW = new Date('2026-10-16T12:00:00Z');

async function codeOf(p: Promise<unknown>): Promise<number> {
  try { await p; return -1; } catch (e) { expect(e).toBeInstanceOf(RemoteError); return (e as RemoteError).code; }
}

async function world(db: any) {
  // The caller row below is seeded as RW-1 directly, so Line A's allocator starts at 2.
  const [a] = await db.insert(workCenter).values({ name: 'Line A', nextRuntimeNumber: 2 }).returning();
  const [b] = await db.insert(workCenter).values({ name: 'Line B' }).returning();
  const [wfa] = await db.insert(workflow).values({ oid: 'root', name: 'Caller', workCenterId: a.id, specJsonb: CALLER_SPEC }).returning();
  await db.insert(workflow).values({ oid: 'child', name: 'Mix', workCenterId: a.id, state: 'Effective', specJsonb: CHILD_SPEC });
  await db.insert(workflow).values({ oid: 'child-b', name: 'Mix', workCenterId: b.id, state: 'Effective', specJsonb: CHILD_SPEC });
  const [ci] = await db.insert(workflowInstance).values({
    workflowId: wfa.id, workCenterId: a.id, triggeredBy: 'manual', status: 'running', ...runtimeCols({ runtimeNumber: 1, runtimeLabel: 'RW-1', specJsonb: CALLER_SPEC }),
  }).returning();
  const step = async () => (await db.insert(stepInstance).values({
    workflowInstanceId: ci.id, nodeOid: 'root', stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
    startedAt: new Date('2026-10-16T11:00:00Z'),
  }).returning())[0];
  const callerFor = async () => { const s = await step(); return loadCaller(db, ci.id, s.id, 'act'); };
  return { a, b, ci, callerFor };
}

test('create: in caller work center, params in all three forms, lineage recorded, Created state', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const r1 = await createRuntime(db, await w.callerFor(), { workCenter: '', workflow: 'Mix', startingParameters: 'Batch=B-1', start: false, now: NOW });
    expect(r1).toMatchObject({ label: 'RW-2', state: 'Created' });
    const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, r1.id));
    expect(row).toMatchObject({ triggeredBy: 'workflow', createdByInstanceId: w.ci.id, createdByLabel: 'Line A/RW-1', startingParams: { Batch: 'B-1' } });
    const r2 = await createRuntime(db, await w.callerFor(), {
      workCenter: '', workflow: 'Mix', start: true, now: NOW,
      startingParameters: JSON.stringify([{ name: 'Batch', value: 'B-2' }, { name: 'Description', value: 'x' }]),
    });
    expect(r2.state).toBe('Starting');
    const r3 = await createRuntime(db, await w.callerFor(), { workCenter: '', workflow: 'Mix', startingParameters: '{"Qty":"3"}', start: false, now: NOW });
    expect(r3.state).toBe('Created');
  } finally { await close(); }
});

test('create: retry from the same step returns the same runtime', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const caller = await w.callerFor();
    const first = await createRuntime(db, caller, { workCenter: '', workflow: 'Mix', startingParameters: '', start: false, now: NOW });
    const again = await createRuntime(db, caller, { workCenter: '', workflow: 'Mix', startingParameters: '', start: true, now: NOW });
    expect(again.id).toBe(first.id);
    expect(await db.select().from(workflowInstance)).toHaveLength(2); // caller + one child
  } finally { await close(); }
});

test('create: a loop re-entering the same step (same step_instance id, new activation) creates a SECOND runtime', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const [s] = await db.insert(stepInstance).values({
      workflowInstanceId: w.ci.id, nodeOid: 'root', stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
      startedAt: new Date('2026-10-16T11:00:00.001Z'),
    }).returning();
    const input = { workCenter: '', workflow: 'Mix', startingParameters: '', start: false, now: NOW };
    const first = await createRuntime(db, await loadCaller(db, w.ci.id, s.id, 'act'), input);
    // A retry within the same activation (engine grace re-invoke) still returns the first.
    const retry = await createRuntime(db, await loadCaller(db, w.ci.id, s.id, 'act'), input);
    expect(retry.id).toBe(first.id);
    // The engine completes the step, the loop re-enters it: the SAME row is reset to READY and
    // parked WAITING_ACTION again with a fresh started_at (transition.ts resetStepForReentry).
    await db.update(stepInstance).set({ state: 'COMPLETED', completedAt: NOW }).where(eq(stepInstance.id, s.id));
    await db.update(stepInstance).set({ state: 'READY', completedAt: null }).where(eq(stepInstance.id, s.id));
    await db.update(stepInstance).set({ state: 'WAITING_ACTION', startedAt: new Date('2026-10-16T11:05:00.002Z') }).where(eq(stepInstance.id, s.id));
    const second = await createRuntime(db, await loadCaller(db, w.ci.id, s.id, 'act'), input);
    expect(second.id).not.toBe(first.id);
    const again = await createRuntime(db, await loadCaller(db, w.ci.id, s.id, 'act'), input);
    expect(again.id).toBe(second.id);
    const rows = await db.select().from(workflowInstance).where(eq(workflowInstance.createdByStepInstanceId, s.id));
    expect(rows.map((r: any) => r.createdByStepStartedAt?.toISOString()).sort())
      .toEqual(['2026-10-16T11:00:00.001Z', '2026-10-16T11:05:00.002Z']);
  } finally { await close(); }
});

test('a re-entered step with a new started_at creates a second child (documented behaviour)', async () => {
  // Spec 2026-10-23 goal 4: a TRY that retries a timed-out Create re-enters the step with a new
  // activation, so a second child is created. The user chose to keep this and document it
  // (docs/DISTRIBUTED_WORKFLOW_LIBRARY.md); this test pins it.
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const [s] = await db.insert(stepInstance).values({
      workflowInstanceId: w.ci.id, nodeOid: 'root', stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
      startedAt: new Date('2026-10-16T11:00:00.000Z'),
    }).returning();
    const input = { workCenter: '', workflow: 'Mix', startingParameters: '', start: false, now: NOW };
    const first = await createRuntime(db, await loadCaller(db, w.ci.id, s.id, 'act'), input);
    await db.update(stepInstance).set({ startedAt: new Date('2026-10-16T11:00:30.000Z') }).where(eq(stepInstance.id, s.id));
    const second = await createRuntime(db, await loadCaller(db, w.ci.id, s.id, 'act'), input);
    expect(second.id).not.toBe(first.id);
    expect(await db.select().from(workflowInstance).where(eq(workflowInstance.createdByInstanceId, w.ci.id))).toHaveLength(2);
  } finally { await close(); }
});

test('create: unknown parameter is 5, unknown workflow 2, other work center without grant 3, with grant ok', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    expect(await codeOf(createRuntime(db, await w.callerFor(), { workCenter: '', workflow: 'Mix', startingParameters: 'Nope=1', start: false, now: NOW }))).toBe(5);
    expect(await codeOf(createRuntime(db, await w.callerFor(), { workCenter: '', workflow: 'Ghost', startingParameters: '', start: false, now: NOW }))).toBe(2);
    expect(await codeOf(createRuntime(db, await w.callerFor(), { workCenter: 'Line B', workflow: 'Mix', startingParameters: '', start: false, now: NOW }))).toBe(3);
    await setControlGrant(db, { sourceWorkCenterId: w.a.id, targetWorkCenterId: w.b.id, scope: 'own', userId: null });
    const r = await createRuntime(db, await w.callerFor(), { workCenter: 'Line B', workflow: 'Mix', startingParameters: '', start: false, now: NOW });
    expect(r.label).toBe('RW-1');
  } finally { await close(); }
});

test('commands follow ruling R6', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const caller = await w.callerFor();
    const mk = async () => createRuntime(db, await w.callerFor(), { workCenter: '', workflow: 'Mix', startingParameters: '', start: false, now: NOW });
    const setStatus = (id: string, status: string) => db.update(workflowInstance).set({ status }).where(eq(workflowInstance.id, id));

    const c1 = await mk();
    expect((await commandRuntime(db, caller, c1.id, 'start')).state).toBe('Starting');
    expect((await commandRuntime(db, caller, c1.id, 'start')).state).toBe('Starting'); // already started: 0
    expect(await codeOf(commandRuntime(db, caller, c1.id, 'suspend'))).toBe(4);       // queued
    await setStatus(c1.id, 'running');
    expect((await commandRuntime(db, caller, c1.id, 'suspend')).state).toBe('Suspending');
    await setStatus(c1.id, 'paused');
    expect((await commandRuntime(db, caller, c1.id, 'suspend')).state).toBe('Suspended');
    expect((await commandRuntime(db, caller, c1.id, 'unsuspend')).state).toBe('Unsuspending');
    await setStatus(c1.id, 'running');
    expect((await commandRuntime(db, caller, c1.id, 'unsuspend')).state).toBe('Running');
    expect((await commandRuntime(db, caller, c1.id, 'stop')).state).toBe('Stopping');
    expect((await commandRuntime(db, caller, c1.id, 'stop')).state).toBe('Stopping');
    expect((await commandRuntime(db, caller, c1.id, 'abort')).state).toBe('Aborting');
    await setStatus(c1.id, 'stopped');
    expect((await commandRuntime(db, caller, c1.id, 'stop')).state).toBe('Stopped');
    expect((await commandRuntime(db, caller, c1.id, 'abort')).state).toBe('Stopped');
    expect(await codeOf(commandRuntime(db, caller, c1.id, 'start'))).toBe(4);

    const c2 = await mk(); // Created
    expect((await commandRuntime(db, caller, c2.id, 'stop')).state).toBe('Stopped');
    expect(await db.select().from(workflowInstance).where(eq(workflowInstance.id, c2.id))).toHaveLength(0);
    const c3 = await mk();
    expect((await commandRuntime(db, caller, c3.id, 'abort')).state).toBe('Aborted');
    const c4 = await mk();
    await commandRuntime(db, caller, c4.id, 'start'); // queued
    expect((await commandRuntime(db, caller, c4.id, 'stop')).state).toBe('Aborting');
  } finally { await close(); }
});

test('a swept runtime: stop/abort 0, start/suspend/unsuspend 4, state from history', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const caller = await w.callerFor();
    const gone = '77777777-7777-7777-7777-777777777777';
    await db.insert(runtimeHistory).values({
      workflowInstanceId: gone, workCenterId: w.a.id, workCenterName: 'Line A', runtimeNumber: 40, runtimeLabel: 'RW-40',
      masterName: 'Mix', masterOid: 'child', masterVersion: '1.0.0', masterState: 'Effective', finalState: 'completed',
      finishedAt: NOW, trace: [], outputs: [{ name: 'Yield', value: '97' }],
    });
    expect((await commandRuntime(db, caller, 'RW-40', 'stop')).state).toBe('Completed');
    expect((await commandRuntime(db, caller, gone, 'abort')).state).toBe('Completed');
    for (const v of ['start', 'suspend', 'unsuspend'] as const) expect(await codeOf(commandRuntime(db, caller, gone, v))).toBe(4);
    expect(await getRuntimeState(db, caller, gone)).toMatchObject({ state: 'Completed', finished: true, label: 'RW-40' });
    expect((await getRuntimeOutputs(db, caller, gone)).outputs).toEqual([{ name: 'Yield', value: '97' }]);
  } finally { await close(); }
});

test('outputs of a live runtime come from its spec and property store; old history without outputs is 2', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const caller = await w.callerFor();
    const c = await createRuntime(db, caller, { workCenter: '', workflow: 'Mix', startingParameters: '', start: false, now: NOW });
    await db.update(workflowInstance).set({ propertyStore: { 'Result.Yield': '88' } }).where(eq(workflowInstance.id, c.id));
    expect((await getRuntimeOutputs(db, caller, c.id)).outputs).toEqual([{ name: 'Yield', value: '88' }]);
    const old = '88888888-8888-8888-8888-888888888888';
    await db.insert(runtimeHistory).values({
      workflowInstanceId: old, workCenterId: w.a.id, workCenterName: 'Line A', runtimeNumber: 41, runtimeLabel: 'RW-41',
      masterName: 'Mix', masterOid: 'child', masterVersion: '1.0.0', masterState: 'Effective', finalState: 'completed', finishedAt: NOW, trace: [],
    });
    await expect(getRuntimeOutputs(db, caller, old)).rejects.toThrow('outputs were not recorded');
    expect(await codeOf(getRuntimeState(db, caller, '99999999-9999-9999-9999-999999999999'))).toBe(2);
  } finally { await close(); }
});
