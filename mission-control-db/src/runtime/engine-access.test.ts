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
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, workflow, workflowInstance, runtimeHistory } from '../db/schema/index.js';
import { createRuntimeWorkflow, requestStart, deleteRuntimeWorkflow } from '../dao/runtime-workflows.js';
import { createUser } from '../dao/users.js';
import { DaoError } from '../dao/errors.js';
import {
  acquireQueuedRuntimeWorkflows, writeRuntimeHistory, deleteCompletedRuntimeWorkflow,
  type RuntimeHistorySnapshot, type TraceEntry,
} from './engine-access.js';

const SPEC = {
  local_id: 'WF', oid: 'wf-1', version: '1.2.0', state: 'Effective',
  starting_parameter_specifications: [],
  steps: [{ local_id: 'Start', oid: 's-1', step_type: 'START' }],
  connections: [],
};

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'wf-1', name: 'WF', workCenterId: wc.id, version: '1.2.0', state: 'Effective', specJsonb: SPEC,
  }).returning();
  const user = await createUser(db, { email: `u-${Math.random()}@t.test`, displayName: 'Cmdr' });
  return { wc, wf, user };
}

async function expectDaoError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.fail(`expected DaoError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(DaoError);
    expect((err as DaoError).code).toBe(code);
  }
}

function snapshotFor(instanceId: string, wc: { id: string; name: string }, created: {
  runtimeNumber: number; masterName: string; masterOid: string; masterVersion: string; masterState: string;
}, overrides: Partial<RuntimeHistorySnapshot> = {}): RuntimeHistorySnapshot {
  const trace: TraceEntry[] = [
    { step_oid: 's-1', state: 'completed', order: 0, timestamp: Date.now() },
  ];
  return {
    workflowInstanceId: instanceId, workCenterId: wc.id, workCenterName: wc.name,
    runtimeNumber: created.runtimeNumber, runtimeLabel: `RW-${created.runtimeNumber}`,
    masterName: created.masterName, masterOid: created.masterOid,
    masterVersion: created.masterVersion, masterState: created.masterState,
    finalState: 'completed', startedAt: new Date(), finishedAt: new Date(),
    startingParams: null, trace, properties: null, stepParams: null,
    stepNames: { 's-1': 'Start' },
    createdByInstanceId: null, createdByLabel: null, outputs: null,
    ...overrides,
  };
}

test('acquire flips queued→running oldest-first and returns the recipe; pending rows are never acquired', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);

  const first = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await requestStart(db, first.id, user.id);
  await new Promise((r) => setTimeout(r, 2));

  const second = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await requestStart(db, second.id, user.id);
  await new Promise((r) => setTimeout(r, 2));

  const third = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await requestStart(db, third.id, user.id);

  // A 4th instance stays pending (never started) — must never be acquired.
  const pending = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });

  // UPDATE...RETURNING does not guarantee it preserves the subquery's ORDER BY, so assert
  // the SET of claimed rows (the two oldest), not the array order they come back in.
  const batch1 = await acquireQueuedRuntimeWorkflows(db, 2);
  expect(batch1.map((r) => r.runtimeNumber).sort()).toEqual([first.runtimeNumber, second.runtimeNumber].sort());
  for (const row of batch1) {
    expect((row.specJsonb as any).oid).toMatch(/^rt_/);
  }
  expect(batch1.every((r) => r.id !== pending.id)).toBe(true);

  const rows1 = await db.select().from(workflowInstance)
    .where(eq(workflowInstance.id, batch1[0].id));
  expect(rows1[0].status).toBe('running');
  expect(rows1[0].startedAt).toBeInstanceOf(Date);

  const batch2 = await acquireQueuedRuntimeWorkflows(db, 2);
  expect(batch2).toHaveLength(1);
  expect(batch2[0].runtimeNumber).toBe(third.runtimeNumber);
  expect(batch2[0].id).not.toBe(pending.id);

  const batch3 = await acquireQueuedRuntimeWorkflows(db, 2);
  expect(batch3).toEqual([]);

  // pending row is still pending, untouched by any acquire call
  const [pendingRow] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, pending.id));
  expect(pendingRow.status).toBe('pending');

  await close();
});

test('writeRuntimeHistory is idempotent per instance; soft-links to an already-deleted instance', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);

  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const snapshot = snapshotFor(created.id, wc, created);

  await writeRuntimeHistory(db, snapshot);
  await writeRuntimeHistory(db, snapshot);

  const rows = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, created.id));
  expect(rows).toHaveLength(1);

  // Now delete the instance (pending is deletable) and write a snapshot referencing its id —
  // soft link, no FK, so this must still insert cleanly.
  await deleteRuntimeWorkflow(db, created.id);
  const [afterDelete] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, created.id));
  expect(afterDelete).toBeUndefined();

  const staleSnapshot = snapshotFor(created.id, wc, created, { finalState: 'aborted' });
  // Different instance id needed to avoid colliding with the row inserted above under
  // the unique index — use a fresh (never-persisted) instance for the "already-deleted" case.
  const other = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await deleteRuntimeWorkflow(db, other.id);
  const staleSnapshot2 = snapshotFor(other.id, wc, other, { finalState: 'aborted' });
  await writeRuntimeHistory(db, staleSnapshot2);

  const rows2 = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, other.id));
  expect(rows2).toHaveLength(1);
  expect(rows2[0].finalState).toBe('aborted');

  await close();
});

test('history survives instance deletion, trace intact', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);

  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await requestStart(db, created.id, user.id);
  await acquireQueuedRuntimeWorkflows(db, 1);
  await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.id, created.id));

  const trace: TraceEntry[] = [
    { step_oid: 's-1', state: 'running', order: 0, timestamp: Date.now() },
    { step_oid: 's-1', state: 'completed', order: 1, timestamp: Date.now(), after_action: 1 },
  ];
  const snapshot = snapshotFor(created.id, wc, created, { trace });
  await writeRuntimeHistory(db, snapshot);

  await deleteCompletedRuntimeWorkflow(db, created.id);
  const [afterDelete] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, created.id));
  expect(afterDelete).toBeUndefined();

  const [historyRow] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, created.id));
  expect(historyRow).toBeDefined();
  expect(historyRow.trace).toEqual(trace);
  expect(historyRow.stepNames).toEqual({ 's-1': 'Start' });

  await close();
});

test('deleteCompletedRuntimeWorkflow re-exports Task 3 guards: running → RUNTIME_INVALID_STATE', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);

  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await requestStart(db, created.id, user.id);
  await acquireQueuedRuntimeWorkflows(db, 1);

  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, created.id));
  expect(row.status).toBe('running');

  await expectDaoError(deleteCompletedRuntimeWorkflow(db, created.id), 'RUNTIME_INVALID_STATE');

  await close();
});
