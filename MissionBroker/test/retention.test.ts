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

import { afterEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { brokerActionInstance, runtimeHistory, workCenter, workflow, workflowInstance } from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { purgeOldRecords } from '../src/retention.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of closers.splice(0)) await c(); });

const now = new Date('2026-10-19T12:00:00Z');
const day = 86_400_000;
const ago = (d: number) => new Date(now.getTime() - d * day);

async function seed() {
  const t = await makeTestDb(); closers.push(t.close); const db = t.db;
  const [wc] = await db.insert(workCenter).values({ name: 'Line A' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [live] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', specJsonb: {},
    runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'W', masterOid: 'w', masterVersion: '1.0.0', masterState: 'Draft',
  }).returning();
  const hist = async (instanceId: string, finishedAt: Date) => { await db.insert(runtimeHistory).values({
    workflowInstanceId: instanceId, workCenterName: 'Line A', runtimeNumber: 2, runtimeLabel: 'RW-2', masterName: 'W',
    masterOid: 'w', masterVersion: '1.0.0', masterState: 'Draft', finalState: 'completed', finishedAt, trace: [],
  }); };
  const rec = async (callerId: string, updatedAt: Date) => (await db.insert(brokerActionInstance).values({
    actionKey: 'wait', workflowInstanceId: callerId, stepInstanceId: randomUUID(), updatedAt,
  }).returning())[0].id;
  const F = randomUUID(), F2 = randomUUID();
  await hist(F, ago(15)); await hist(F2, ago(13));
  const R = await rec(live.id, ago(30));
  const Fr = await rec(F, ago(1));
  const F2r = await rec(F2, ago(30));
  const O = await rec(randomUUID(), ago(15));
  const O2 = await rec(randomUUID(), ago(1));
  return { db, R, Fr, F2r, O, O2 };
}

async function remaining(db: Awaited<ReturnType<typeof seed>>['db']) {
  return (await db.select({ id: brokerActionInstance.id }).from(brokerActionInstance)).map((r) => r.id).sort();
}

test('deletes records 14 days after the calling runtime finished and orphans that old; keeps running and recent ones', async () => {
  const s = await seed();
  expect(await purgeOldRecords(s.db, now, 14)).toBe(2);
  expect(await remaining(s.db)).toEqual([s.R, s.F2r, s.O2].sort());
});

test('loops batches until done', async () => {
  const s = await seed();
  expect(await purgeOldRecords(s.db, now, 14, 1)).toBe(2);
  expect(await remaining(s.db)).toEqual([s.R, s.F2r, s.O2].sort());
});
