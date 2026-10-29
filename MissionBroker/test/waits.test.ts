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

import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { insertInstance, getInstance } from '../src/store.js';
import { checkWaits } from '../src/waits.js';
import { EventHub } from '../src/events.js';

// A target id whose lookup fails with an unexpected (non-RemoteError) error, e.g. a dropped connection.
const boom = vi.hoisted(() => ({ id: '' }));
vi.mock('mission-control-db/src/runtime/remote-control/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('mission-control-db/src/runtime/remote-control/index')>();
  return { ...real, resolveRuntime: (db: Parameters<typeof real.resolveRuntime>[0], ref: string, wc: string) =>
    (boom.id !== '' && ref === boom.id ? Promise.reject(new Error('connection reset')) : real.resolveRuntime(db, ref, wc)) };
});

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { boom.id = ''; for (const c of closers.splice(0)) await c(); });

async function world() {
  const t = await makeTestDb(); closers.push(t.close); const db = t.db;
  const [wc] = await db.insert(workCenter).values({ name: 'Line A' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const mk = async (label: string, status: string, n: number) => (await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status, specJsonb: {},
    runtimeNumber: n, runtimeLabel: label, masterName: 'W', masterOid: 'w', masterVersion: '1.0.0', masterState: 'Draft',
  }).returning())[0];
  const caller = await mk('RW-1', 'running', 1);
  const target = await mk('RW-2', 'running', 2);
  const [step] = await db.insert(stepInstance).values({ workflowInstanceId: caller.id, nodeOid: 'w', stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', startedAt: new Date() }).returning();
  const waitId = (await insertInstance(db, { actionKey: 'wait', workflowInstanceId: caller.id, stepInstanceId: step.id, stepStartedAt: step.startedAt!, targetInstanceId: target.id, state: 'RUNNING', outputs: [] }))!.id;
  return { db, caller, target, step, waitId };
}

test('a wait completes when its target finishes, with the final state — including after a restart', async () => {
  const { db, target, waitId } = await world();
  const hub = new EventHub();
  expect(await checkWaits(db, hub)).toBe(0);
  await db.update(workflowInstance).set({ status: 'stopped' }).where(eq(workflowInstance.id, target.id));
  // A fresh hub models a restarted service: the row alone carries the wait.
  expect(await checkWaits(db, new EventHub())).toBe(1);
  const row = await getInstance(db, waitId);
  expect(row?.state).toBe('COMPLETED');
  expect(row?.outputs).toContainEqual({ name: 'Runtime', value: JSON.stringify([{ name: 'State', value: 'Stopped' }]) });
  expect(row?.outputs).toContainEqual({ name: 'Completion', value: JSON.stringify([{ name: 'Code', value: '0' }]) });
});

test('a vanished target completes with code 2; a caller that stopped waiting aborts the wait', async () => {
  const { db, target, waitId } = await world();
  await db.delete(workflowInstance).where(eq(workflowInstance.id, target.id));
  await checkWaits(db, new EventHub());
  expect((await getInstance(db, waitId))?.outputs).toContainEqual({ name: 'Completion', value: JSON.stringify([{ name: 'Code', value: '2' }]) });

  const second = await world();
  await second.db.update(stepInstance).set({ state: 'ABORTED' }).where(eq(stepInstance.id, second.step.id));
  await checkWaits(second.db, new EventHub());
  expect((await getInstance(second.db, second.waitId))?.state).toBe('ABORTED');
});

test('a stopping caller completes the wait with code 4; an aborting caller aborts it', async () => {
  const stopping = await world();
  await stopping.db.update(workflowInstance).set({ status: 'stopping' }).where(eq(workflowInstance.id, stopping.caller.id));
  expect(await checkWaits(stopping.db, new EventHub())).toBe(1);
  const row = await getInstance(stopping.db, stopping.waitId);
  expect(row?.state).toBe('COMPLETED');
  expect(row?.outputs).toContainEqual({ name: 'Completion', value: JSON.stringify([{ name: 'Code', value: '4' }]) });

  const aborting = await world();
  await aborting.db.update(workflowInstance).set({ status: 'aborting' }).where(eq(workflowInstance.id, aborting.caller.id));
  await checkWaits(aborting.db, new EventHub());
  expect((await getInstance(aborting.db, aborting.waitId))?.state).toBe('ABORTED');
});

test('an unexpected error on one wait is logged and the pass continues to the next wait', async () => {
  const { db, caller, step, target, waitId } = await world();
  const [other] = await db.insert(workflowInstance).values({
    workflowId: caller.workflowId, workCenterId: caller.workCenterId, triggeredBy: 'manual', status: 'completed', specJsonb: {},
    runtimeNumber: 3, runtimeLabel: 'RW-3', masterName: 'W', masterOid: 'w', masterVersion: '1.0.0', masterState: 'Draft',
  }).returning();
  // A second activation of the same step (one row per activation).
  const okId = (await insertInstance(db, { actionKey: 'wait', workflowInstanceId: caller.id, stepInstanceId: step.id, stepStartedAt: new Date(step.startedAt!.getTime() + 1), targetInstanceId: other.id, state: 'RUNNING', outputs: [] }))!.id;
  boom.id = target.id;
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await checkWaits(db, new EventHub())).toBe(1);
    expect((await getInstance(db, okId))?.state).toBe('COMPLETED');
    expect((await getInstance(db, waitId))?.state).toBe('RUNNING');
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(waitId), expect.any(Error));
  } finally { logged.mockRestore(); }
});
