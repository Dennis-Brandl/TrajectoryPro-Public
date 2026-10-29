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
import { randomUUID } from 'node:crypto';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance, runtimeHistory } from '../db/schema/index.js';
import { listCreatedRuntimes } from './runtime-children.js';

async function seed() {
  const { db, close } = await makeTestDb();
  const [plant] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
  const [line1] = await db.insert(workCenter).values({ name: 'Line 1', parentWorkCenterId: plant.id }).returning();
  const [wfPlant] = await db.insert(workflow).values({ oid: 'wf-p', name: 'WF-P', workCenterId: plant.id, specJsonb: {} }).returning();
  const [wfLine] = await db.insert(workflow).values({ oid: 'wf-l', name: 'WF-L', workCenterId: line1.id, specJsonb: {} }).returning();
  return { db, close, plant, line1, wfPlant, wfLine };
}

async function inst(db: any, wf: { id: string }, wc: { id: string }, o: Record<string, unknown> = {}, cols: Record<string, unknown> = {}) {
  const [row] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running',
    ...o, ...runtimeCols(cols),
  }).returning();
  return row;
}

async function hist(db: any, o: Record<string, unknown> = {}) {
  const [row] = await db.insert(runtimeHistory).values({
    workCenterName: 'WC', runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: 'WF', masterOid: 'wf-1', masterVersion: '1.0.0', masterState: 'Effective',
    finalState: 'completed', finishedAt: new Date(), trace: [],
    ...o,
  }).returning();
  return row;
}

test('lists live and finished children newest first with path, workflow, state and open target', async () => {
  const { db, close, plant, line1, wfPlant, wfLine } = await seed();
  const P = await inst(db, wfPlant, plant);
  const L = await inst(db, wfLine, line1,
    { createdByInstanceId: P.id, createdAt: new Date('2026-10-01T10:00:00Z') },
    { runtimeLabel: 'RW-7', masterName: 'Mix', masterVersion: '1.2.0', masterState: 'Effective' });
  const H = await hist(db, {
    workflowInstanceId: randomUUID(), workCenterId: plant.id, workCenterName: 'Plant', runtimeLabel: 'RW-3',
    masterName: 'Clean', masterVersion: '2.0.0', masterState: 'Effective', finalState: 'completed',
    startedAt: new Date('2026-10-01T09:00:00Z'), createdByInstanceId: P.id,
  });
  expect(await listCreatedRuntimes(db, P.id)).toEqual({ total: 2, items: [
    { runtimeLabel: 'RW-7', workCenterPath: 'Plant/Line 1', workflowName: 'Mix', workflowVersion: '1.2.0', workflowState: 'Effective',
      createdAt: new Date('2026-10-01T10:00:00Z'), state: 'running', open: { kind: 'live', id: L.id } },
    { runtimeLabel: 'RW-3', workCenterPath: 'Plant', workflowName: 'Clean', workflowVersion: '2.0.0', workflowState: 'Effective',
      createdAt: new Date('2026-10-01T09:00:00Z'), state: 'completed', open: { kind: 'history', id: H.id } },
  ] });
  await close();
});

test('the live row wins over its own history row', async () => {
  const { db, close, plant, wfPlant } = await seed();
  const P = await inst(db, wfPlant, plant);
  const C = await inst(db, wfPlant, plant, { createdByInstanceId: P.id, status: 'completed' });
  await hist(db, { workflowInstanceId: C.id, workCenterId: plant.id, createdByInstanceId: P.id });
  const page = await listCreatedRuntimes(db, P.id);
  expect(page.items).toHaveLength(1);
  expect(page.items[0].open).toEqual({ kind: 'live', id: C.id });
  expect(page.total).toBe(1);
  await close();
});

test('a deleted work center shows the frozen name and still opens history', async () => {
  const { db, close, plant, wfPlant } = await seed();
  const P = await inst(db, wfPlant, plant);
  const H = await hist(db, { workflowInstanceId: randomUUID(), workCenterId: null, workCenterName: 'Old Line', createdByInstanceId: P.id });
  const page = await listCreatedRuntimes(db, P.id);
  expect(page.items[0].workCenterPath).toBe('Old Line');
  expect(page.items[0].open).toEqual({ kind: 'history', id: H.id });
  await close();
});

test('lists only direct children', async () => {
  const { db, close, plant, line1, wfPlant, wfLine } = await seed();
  const P = await inst(db, wfPlant, plant);
  const Q = await inst(db, wfPlant, plant);
  const L = await inst(db, wfLine, line1, { createdByInstanceId: P.id });
  await inst(db, wfLine, line1, { createdByInstanceId: L.id });
  await inst(db, wfLine, line1, { createdByInstanceId: Q.id });
  const page = await listCreatedRuntimes(db, P.id);
  expect(page.total).toBe(1);
  expect(page.items.map((i) => i.open?.id)).toEqual([L.id]);
  await close();
});

test('a work center the viewer may not see leaves only the Runtime ID', async () => {
  const { db, close, plant, line1, wfPlant, wfLine } = await seed();
  const P = await inst(db, wfPlant, plant);
  await inst(db, wfLine, line1, { createdByInstanceId: P.id }, { runtimeLabel: 'RW-7' });
  const page = await listCreatedRuntimes(db, P.id, { canSee: (wc) => wc !== line1.id });
  expect(page.items[0]).toEqual({ runtimeLabel: 'RW-7', workCenterPath: null, workflowName: null, workflowVersion: null,
    workflowState: null, createdAt: null, state: null, open: null });
  await close();
});

test('caps at the limit and reports the total', async () => {
  const { db, close, plant, wfPlant } = await seed();
  const P = await inst(db, wfPlant, plant);
  const a = await inst(db, wfPlant, plant, { createdByInstanceId: P.id, createdAt: new Date('2026-10-01T01:00:00Z') });
  const b = await inst(db, wfPlant, plant, { createdByInstanceId: P.id, createdAt: new Date('2026-10-01T02:00:00Z') });
  const c = await inst(db, wfPlant, plant, { createdByInstanceId: P.id, createdAt: new Date('2026-10-01T03:00:00Z') });
  const page = await listCreatedRuntimes(db, P.id, { limit: 2 });
  expect(page.total).toBe(3);
  expect(page.items.map((i) => i.open?.id)).toEqual([c.id, b.id]);
  void a;
  await close();
});

test('an unknown parent has no children', async () => {
  const { db, close } = await seed();
  expect(await listCreatedRuntimes(db, randomUUID())).toEqual({ items: [], total: 0 });
  await close();
});
