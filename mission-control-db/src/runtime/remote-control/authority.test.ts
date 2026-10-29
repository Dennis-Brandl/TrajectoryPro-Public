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
import { loadCaller, authorize, assertCreationAllowed, MAX_LINEAGE_DEPTH, MAX_CREATED_PER_RUNTIME } from './authority.js';
import { RemoteError } from './codes.js';

const SPEC = {
  oid: 'root', local_id: 'Caller',
  steps: [{ oid: 'act', local_id: 'Make child', step_type: 'ACTION PROXY', action_proxy_config: { action_oid: 'act-oid-1', environment_oid: 'env-1', action_name: 'Create Runtime Workflow' } }],
};
const STARTED = new Date('2026-10-16T11:00:00.123Z');

async function codeOf(p: Promise<unknown>): Promise<number> {
  try { await p; return -1; } catch (e) { expect(e).toBeInstanceOf(RemoteError); return (e as RemoteError).code; }
}

async function world(db: any) {
  const [a] = await db.insert(workCenter).values({ name: 'A' }).returning();
  const [b] = await db.insert(workCenter).values({ name: 'B' }).returning();
  const [wfa] = await db.insert(workflow).values({ oid: 'root', name: 'Caller', workCenterId: a.id, specJsonb: SPEC }).returning();
  const [wfb] = await db.insert(workflow).values({ oid: 'x', name: 'X', workCenterId: b.id, specJsonb: {} }).returning();
  const [caller] = await db.insert(workflowInstance).values({
    workflowId: wfa.id, workCenterId: a.id, triggeredBy: 'manual', status: 'running', ...runtimeCols({ runtimeLabel: 'RW-1', specJsonb: SPEC }),
  }).returning();
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: caller.id, nodeOid: 'root', stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION',
    startedAt: STARTED, actionInvokedOid: 'act-oid-invoked',
  }).returning();
  const instIn = async (wcId: string, wfId: string, label: string, createdByInstanceId: string | null) => (await db.insert(workflowInstance).values({
    workflowId: wfId, workCenterId: wcId, triggeredBy: 'workflow', status: 'running', ...runtimeCols({ runtimeLabel: label }), createdByInstanceId,
  }).returning())[0];
  return { a, b, wfa, wfb, caller, step, instIn };
}

test('loadCaller: a real waiting ACTION PROXY step is accepted; anything else is code 3', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const c = await loadCaller(db, w.caller.id, w.step.id, 'act');
    expect(c).toMatchObject({ instanceId: w.caller.id, workCenterId: w.a.id, workCenterName: 'A', runtimeLabel: 'RW-1', actionName: 'Create Runtime Workflow' });
    // The activation and the action actually being called (final review findings 1 and 2).
    expect(c.stepStartedAt).toEqual(STARTED);
    expect(c.actionOid).toBe('act-oid-1');
    expect(c.actionInvokedOid).toBe('act-oid-invoked');
    expect(await codeOf(loadCaller(db, w.caller.id, w.step.id, 'other'))).toBe(3);
    expect(await codeOf(loadCaller(db, '00000000-0000-0000-0000-000000000000', w.step.id, 'act'))).toBe(3);
  } finally { await close(); }
});

test('authorize: same work center always; across work centers needs a grant; own scope limits commands to lineage', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const caller = await loadCaller(db, w.caller.id, w.step.id, 'act');
    const mine = await w.instIn(w.b.id, w.wfb.id, 'RW-1', w.caller.id);
    const grandchild = await w.instIn(w.b.id, w.wfb.id, 'RW-2', mine.id);
    const stranger = await w.instIn(w.b.id, w.wfb.id, 'RW-3', null);

    await authorize(db, caller, w.a.id, 'command', w.caller.id); // same work center
    expect(await codeOf(authorize(db, caller, w.b.id, 'create'))).toBe(3);
    await expect(authorize(db, caller, w.b.id, 'read')).rejects.toThrow('Work center "A" has no control grant for work center "B"');

    await setControlGrant(db, { sourceWorkCenterId: w.a.id, targetWorkCenterId: w.b.id, scope: 'own', userId: null });
    await authorize(db, caller, w.b.id, 'create');
    await authorize(db, caller, w.b.id, 'read', stranger.id);
    await authorize(db, caller, w.b.id, 'command', mine.id);
    await authorize(db, caller, w.b.id, 'command', grandchild.id);
    await expect(authorize(db, caller, w.b.id, 'command', stranger.id)).rejects.toThrow('was not created by this runtime');

    await setControlGrant(db, { sourceWorkCenterId: w.a.id, targetWorkCenterId: w.b.id, scope: 'any', userId: null });
    await authorize(db, caller, w.b.id, 'command', stranger.id);
  } finally { await close(); }
});

test('lineage survives the sweep through history rows', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const caller = await loadCaller(db, w.caller.id, w.step.id, 'act');
    await setControlGrant(db, { sourceWorkCenterId: w.a.id, targetWorkCenterId: w.b.id, scope: 'own', userId: null });
    const sweptChild = '66666666-6666-6666-6666-666666666666';
    await db.insert(runtimeHistory).values({
      workflowInstanceId: sweptChild, workCenterId: w.b.id, workCenterName: 'B', runtimeNumber: 50, runtimeLabel: 'RW-50',
      masterName: 'X', masterOid: 'x', masterVersion: '1.0.0', masterState: 'Draft', finalState: 'completed',
      finishedAt: new Date(), trace: [], createdByInstanceId: w.caller.id,
    });
    const grandchild = await w.instIn(w.b.id, w.wfb.id, 'RW-51', sweptChild);
    await authorize(db, caller, w.b.id, 'command', grandchild.id);
  } finally { await close(); }
});

test('assertCreationAllowed: depth cap', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    let parent: string | null = null;
    for (let i = 0; i < MAX_LINEAGE_DEPTH; i++) parent = (await w.instIn(w.a.id, w.wfa.id, `D-${i}`, parent)).id;
    await db.update(workflowInstance).set({ createdByInstanceId: parent }).where(eq(workflowInstance.id, w.caller.id));
    const caller = await loadCaller(db, w.caller.id, w.step.id, 'act');
    await expect(assertCreationAllowed(db, caller)).rejects.toThrow(`deeper than ${MAX_LINEAGE_DEPTH}`);
  } finally { await close(); }
});

test('loadCaller: action oids are null when the step carries none', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    await db.update(workflowInstance).set({ specJsonb: { oid: 'root', steps: [{ oid: 'act', step_type: 'ACTION PROXY', action_proxy_config: {} }] } })
      .where(eq(workflowInstance.id, w.caller.id));
    await db.update(stepInstance).set({ actionInvokedOid: null }).where(eq(stepInstance.id, w.step.id));
    const c = await loadCaller(db, w.caller.id, w.step.id, 'act');
    expect(c).toMatchObject({ actionOid: null, actionInvokedOid: null, actionName: null });
  } finally { await close(); }
});

test('loadCaller: a waiting step with no started_at is refused (no activation to key on)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    await db.update(stepInstance).set({ startedAt: null }).where(eq(stepInstance.id, w.step.id));
    expect(await codeOf(loadCaller(db, w.caller.id, w.step.id, 'act'))).toBe(3);
  } finally { await close(); }
});

test('loadCaller: step state and step type guards', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    await db.update(stepInstance).set({ state: 'COMPLETED' }).where(eq(stepInstance.id, w.step.id));
    expect(await codeOf(loadCaller(db, w.caller.id, w.step.id, 'act'))).toBe(3);
    await db.update(stepInstance).set({ state: 'WAITING_ACTION', stepType: 'WORKFLOW PROXY' }).where(eq(stepInstance.id, w.step.id));
    expect(await codeOf(loadCaller(db, w.caller.id, w.step.id, 'act'))).toBe(3);
  } finally { await close(); }
});

test('assertCreationAllowed: allows 7 ancestors', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    let parent: string | null = null;
    for (let i = 0; i < MAX_LINEAGE_DEPTH - 1; i++) parent = (await w.instIn(w.a.id, w.wfa.id, `D-${i}`, parent)).id;
    await db.update(workflowInstance).set({ createdByInstanceId: parent }).where(eq(workflowInstance.id, w.caller.id));
    const caller = await loadCaller(db, w.caller.id, w.step.id, 'act');
    await assertCreationAllowed(db, caller);
  } finally { await close(); }
});

test('assertCreationAllowed: creation cap counts live and history rows together', async () => {
  const { db, close } = await makeTestDb();
  try {
    const w = await world(db);
    const caller = await loadCaller(db, w.caller.id, w.step.id, 'act');
    const live = 60;
    for (let i = 0; i < live; i++) await w.instIn(w.b.id, w.wfb.id, `L-${i}`, w.caller.id);
    const hist = (n: number) => Array.from({ length: n }, (_, i) => ({
      workflowInstanceId: crypto.randomUUID(), workCenterId: w.b.id, workCenterName: 'B', runtimeNumber: 1000 + i, runtimeLabel: `H-${i}`,
      masterName: 'X', masterOid: 'x', masterVersion: '1.0.0', masterState: 'Draft', finalState: 'completed',
      finishedAt: new Date(), trace: [], createdByInstanceId: w.caller.id,
    }));
    await db.insert(runtimeHistory).values(hist(MAX_CREATED_PER_RUNTIME - live - 1));
    await assertCreationAllowed(db, caller); // 99
    await db.insert(runtimeHistory).values({ ...hist(1)[0], runtimeNumber: 5000, runtimeLabel: 'H-last' });
    expect(await codeOf(assertCreationAllowed(db, caller))).toBe(3); // 100
  } finally { await close(); }
});
