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
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance, runtimeHistory } from '../../db/schema/index.js';
import { resolveWorkCenter, resolveMasterWorkflow, resolveRuntime } from './resolve.js';
import { RemoteError } from './codes.js';

async function codeOf(p: Promise<unknown>): Promise<number> {
  try { await p; return -1; } catch (e) { expect(e).toBeInstanceOf(RemoteError); return (e as RemoteError).code; }
}

async function tree(db: any) {
  const [plant] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
  const [a] = await db.insert(workCenter).values({ name: 'Area A', parentWorkCenterId: plant.id }).returning();
  const [b] = await db.insert(workCenter).values({ name: 'Area B', parentWorkCenterId: plant.id }).returning();
  const [l1a] = await db.insert(workCenter).values({ name: 'Line 1', parentWorkCenterId: a.id }).returning();
  const [l1b] = await db.insert(workCenter).values({ name: 'Line 1', parentWorkCenterId: b.id }).returning();
  const [mix] = await db.insert(workCenter).values({ name: 'Mixing', parentWorkCenterId: a.id }).returning();
  return { plant, a, b, l1a, l1b, mix };
}

test('resolveWorkCenter: blank = caller; unique bare name; path; ambiguous name; unknown', async () => {
  const { db, close } = await makeTestDb();
  try {
    const t = await tree(db);
    expect((await resolveWorkCenter(db, '  ', t.mix.id)).id).toBe(t.mix.id);
    expect((await resolveWorkCenter(db, 'Mixing', t.l1a.id)).id).toBe(t.mix.id);
    expect((await resolveWorkCenter(db, 'Plant/Area B/Line 1', t.mix.id)).id).toBe(t.l1b.id);
    expect(await codeOf(resolveWorkCenter(db, 'Line 1', t.mix.id))).toBe(5);
    await expect(resolveWorkCenter(db, 'Line 1', t.mix.id)).rejects.toThrow('Work center "Line 1" is ambiguous; use its path, e.g. "Plant/Area A/Line 1"');
    expect(await codeOf(resolveWorkCenter(db, 'Nowhere', t.mix.id))).toBe(2);
    expect(await codeOf(resolveWorkCenter(db, 'Plant/Nowhere', t.mix.id))).toBe(2);
  } finally { await close(); }
});

test('resolveMasterWorkflow: in force, then Approved > InReview > InTest > Draft; newest version wins', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'L' }).returning();
    const now = new Date('2026-10-16T12:00:00Z');
    const ins = (version: string, state: string, effectiveFrom: Date | null = null) =>
      db.insert(workflow).values({ oid: `o-${version}-${state}`, name: 'Mix', workCenterId: wc.id, version, state, effectiveFrom, specJsonb: {} }).returning();
    const [draft2] = await ins('2.0.0', 'Draft');
    expect((await resolveMasterWorkflow(db, wc.id, 'Mix', now)).id).toBe(draft2.id);
    const [test1] = await ins('1.0.0', 'InTest');
    expect((await resolveMasterWorkflow(db, wc.id, 'Mix', now)).id).toBe(test1.id);
    const [rev] = await ins('1.1.0', 'InReview');
    expect((await resolveMasterWorkflow(db, wc.id, 'Mix', now)).id).toBe(rev.id);
    const [appr] = await ins('1.2.0', 'Approved');
    expect((await resolveMasterWorkflow(db, wc.id, 'Mix', now)).id).toBe(appr.id);
    await ins('9.0.0', 'Effective', new Date('2027-01-01T00:00:00Z')); // future-dated: not in force
    expect((await resolveMasterWorkflow(db, wc.id, 'Mix', now)).id).toBe(appr.id);
    const [eff1] = await ins('1.9.0', 'Effective');           // NULL effective_from = in force
    const [eff10] = await ins('1.10.0', 'Effective', new Date('2026-01-01T00:00:00Z'));
    expect((await resolveMasterWorkflow(db, wc.id, 'Mix', now)).id).toBe(eff10.id);
    expect(eff1.id).not.toBe(eff10.id);
    expect(await codeOf(resolveMasterWorkflow(db, wc.id, 'Nope', now))).toBe(2);
  } finally { await close(); }
});

test('resolveMasterWorkflow: only Superseded/Obsolete is not found', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'L' }).returning();
    await db.insert(workflow).values({ oid: 'o', name: 'Old', workCenterId: wc.id, state: 'Obsolete', specJsonb: {} });
    await expect(resolveMasterWorkflow(db, wc.id, 'Old', new Date())).rejects.toThrow('has no usable version');
  } finally { await close(); }
});

test('resolveRuntime: uuid, bare label, qualified label, history fallback, unknown', async () => {
  const { db, close } = await makeTestDb();
  try {
    const t = await tree(db);
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: t.mix.id, specJsonb: {} }).returning();
    const [live] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: t.mix.id, triggeredBy: 'manual', status: 'running', ...runtimeCols({ runtimeLabel: 'RW-5' }),
    }).returning();
    expect((await resolveRuntime(db, live.id, t.l1a.id)).live?.status).toBe('running');
    expect((await resolveRuntime(db, 'RW-5', t.mix.id)).id).toBe(live.id);
    expect((await resolveRuntime(db, 'Mixing/RW-5', t.l1a.id)).id).toBe(live.id);
    const gone = '44444444-4444-4444-4444-444444444444';
    await db.insert(runtimeHistory).values({
      workflowInstanceId: gone, workCenterId: t.mix.id, workCenterName: 'Mixing', runtimeNumber: 9, runtimeLabel: 'RW-9',
      masterName: 'W', masterOid: 'w', masterVersion: '1.0.0', masterState: 'Draft', finalState: 'stopped', finishedAt: new Date(), trace: [],
    });
    const swept = await resolveRuntime(db, 'Plant/Area A/Mixing/RW-9', t.l1a.id);
    expect(swept).toMatchObject({ id: gone, live: null, finalState: 'stopped', label: 'RW-9' });
    expect((await resolveRuntime(db, gone, t.l1a.id)).finalState).toBe('stopped');
    expect(await codeOf(resolveRuntime(db, 'RW-77', t.mix.id))).toBe(2);
    expect(await codeOf(resolveRuntime(db, '55555555-5555-5555-5555-555555555555', t.mix.id))).toBe(2);
  } finally { await close(); }
});

test('resolveWorkCenter: a name containing "/" is taken whole before it is read as a path', async () => {
  const { db, close } = await makeTestDb();
  try {
    const t = await tree(db);
    const [ab] = await db.insert(workCenter).values({ name: 'A/B', parentWorkCenterId: t.plant.id }).returning();
    expect((await resolveWorkCenter(db, 'A/B', t.mix.id)).id).toBe(ab.id);
    expect((await resolveWorkCenter(db, ' A/B ', t.mix.id)).id).toBe(ab.id);
    // A real path still resolves as a path.
    expect((await resolveWorkCenter(db, 'Plant/Area A/Mixing', t.l1a.id)).id).toBe(t.mix.id);
  } finally { await close(); }
});

test('resolveRuntime: a label containing "/" in the caller work center; a label in a work center named "A/B"', async () => {
  const { db, close } = await makeTestDb();
  try {
    const t = await tree(db);
    const [ab] = await db.insert(workCenter).values({ name: 'A/B', parentWorkCenterId: t.plant.id }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: t.mix.id, specJsonb: {} }).returning();
    const [wfab] = await db.insert(workflow).values({ oid: 'w2', name: 'W', workCenterId: ab.id, specJsonb: {} }).returning();
    const [batch] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: t.mix.id, triggeredBy: 'manual', status: 'running', ...runtimeCols({ runtimeLabel: 'Batch/5' }),
    }).returning();
    const [inAb] = await db.insert(workflowInstance).values({
      workflowId: wfab.id, workCenterId: ab.id, triggeredBy: 'manual', status: 'running', ...runtimeCols({ runtimeLabel: 'RW-5' }),
    }).returning();
    expect((await resolveRuntime(db, 'Batch/5', t.mix.id)).id).toBe(batch.id);
    expect((await resolveRuntime(db, 'A/B/RW-5', t.mix.id)).id).toBe(inAb.id);
    // A swept "Batch/7" in the caller's work center resolves through history.
    const gone = '66666666-6666-6666-6666-666666666666';
    await db.insert(runtimeHistory).values({
      workflowInstanceId: gone, workCenterId: t.mix.id, workCenterName: 'Mixing', runtimeNumber: 7, runtimeLabel: 'Batch/7',
      masterName: 'W', masterOid: 'w', masterVersion: '1.0.0', masterState: 'Draft', finalState: 'completed', finishedAt: new Date(), trace: [],
    });
    expect((await resolveRuntime(db, 'Batch/7', t.mix.id)).id).toBe(gone);
  } finally { await close(); }
});
