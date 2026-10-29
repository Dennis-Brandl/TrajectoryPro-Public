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
// Task 17: the retention sweeper (core/sweep.ts) + its loop.ts integration (own timer; loop no longer sweeps).
// `runSweep(db, now)` takes an explicit clock (a deliberate deviation from the brief's literal
// SQL, which used the database's own `now()` — see sweep.ts's own doc comment for why: the
// project-wide "always deps.now(), never a real wall-clock read" invariant, and a proven
// collision with the rest of the test suite's historical fake clocks otherwise) so these tests
// control retention-elapsed math directly and deterministically, independent of real wall time.
import { expect, test } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, runtimeHistory } from 'mission-control-db/src/db/schema/index';
import { deleteCompletedRuntimeWorkflow } from 'mission-control-db/src/runtime/engine-access';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { runSweep } from '../src/core/sweep.js';
import { runOnce } from '../src/loop.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const SIMPLE_SPEC = {
  local_id: 'wf', oid: 'wf-sweep', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('start', 'START'), step('end', 'END')],
  connections: [{ from_step_id: 'start', to_step_id: 'end' }],
};

async function seedQueued(
  db: any, spec: unknown, oid: string, retentionSecs?: number,
): Promise<{ id: string; workCenterId: string }> {
  const wcValues: Record<string, unknown> = { name: `wc-${oid}-${Math.random()}`, path: `p${Math.random()}` };
  if (retentionSecs !== undefined) wcValues.finishedRetentionSecs = retentionSecs;
  const [wc] = await db.insert(workCenter).values(wcValues).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

async function historyRowFor(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(runtimeHistory).where(eq(runtimeHistory.workflowInstanceId, instanceId));
  return row;
}

const T0 = new Date('2026-01-01T00:00:00.000Z');

test('retention window elapsed: the workflow_instance row is deleted, its runtime_history survives', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SIMPLE_SPEC, 'wf-sweep-a', 1); // 1s retention
  const deps = testDeps({ now: () => T0 });
  await pumpUntilQuiet(db, deps); // completes at completedAt = T0

  expect((await instanceRow(db, wi.id)).status).toBe('completed');
  const historyBefore = await historyRowFor(db, wi.id);
  expect(historyBefore).toBeDefined();

  const deleted = await runSweep(db, () => new Date(T0.getTime() + 2000)); // 2s later — past 1s retention
  expect(deleted).toBe(1);
  expect(await instanceRow(db, wi.id)).toBeUndefined();

  const historyAfter = await historyRowFor(db, wi.id);
  expect(historyAfter).toBeDefined();
  expect(historyAfter.id).toBe(historyBefore.id);
  expect(historyAfter.workflowInstanceId).toBe(wi.id); // soft link survives, no FK to clean up

  await close();
});

test('retention window NOT yet elapsed (default 3600s): a fresh terminal row survives a sweep pass', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SIMPLE_SPEC, 'wf-sweep-fresh'); // default retention (3600s)
  const deps = testDeps({ now: () => T0 });
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('completed');

  const deleted = await runSweep(db, () => T0); // same instant as completion — 0s elapsed
  expect(deleted).toBe(0);
  expect(await instanceRow(db, wi.id)).toBeDefined();

  await close();
});

test('a non-terminal instance is never swept, no matter how short the retention or how far "now" is pushed', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SIMPLE_SPEC, 'wf-sweep-running', 1); // 1s retention, but never pumped
  expect((await instanceRow(db, wi.id)).status).toBe('queued');

  const deleted = await runSweep(db, () => new Date('2099-01-01T00:00:00.000Z'));
  expect(deleted).toBe(0);
  expect(await instanceRow(db, wi.id)).toBeDefined();

  await close();
});

test('a manual deleteCompletedRuntimeWorkflow call (bypassing the sweeper entirely) still leaves history intact', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SIMPLE_SPEC, 'wf-sweep-manual');
  const deps = testDeps({ now: () => T0 });
  await pumpUntilQuiet(db, deps);

  const historyBefore = await historyRowFor(db, wi.id);
  expect(historyBefore).toBeDefined();

  // No sweep involved at all — retention is irrelevant to this path (deleteRuntimeWorkflow's
  // own status guard is the only gate, and 'completed' satisfies it immediately).
  await deleteCompletedRuntimeWorkflow(db, wi.id);
  expect(await instanceRow(db, wi.id)).toBeUndefined();

  const historyAfter = await historyRowFor(db, wi.id);
  expect(historyAfter).toBeDefined();
  expect(historyAfter.trace).toEqual(historyBefore.trace);

  await close();
});

// ── bulk seeding + batch behaviour ──

/** Bulk-insert `count` runs for one work center in a single statement (fast even on PGlite). */
async function seedRuns(
  db: any, workCenterId: string, workflowId: string, count: number, status: string, completedAt: Date | null,
  firstNumber = 1,
): Promise<void> {
  await db.execute(sql`
    insert into workflow_instance (
      workflow_id, work_center_id, triggered_by, status, queued_at, completed_at, spec_jsonb,
      runtime_number, runtime_label, master_name, master_oid, master_version, master_state
    )
    select ${workflowId}::uuid, ${workCenterId}::uuid, 'manual', ${status}, now(),
      ${completedAt ? completedAt.toISOString() : null}::timestamptz, '{}'::jsonb,
      n, 'RW-' || n, 'm', 'm', '1.0.0', 'Approved'
    from generate_series(${firstNumber}::int, ${firstNumber + count - 1}::int) as n
  `);
}

async function seedWorkCenter(db: any, retentionSecs: number): Promise<{ wcId: string; wfId: string }> {
  const [wc] = await db.insert(workCenter).values({
    name: `wc-${Math.random()}`, path: `p${Math.random()}`, finishedRetentionSecs: retentionSecs,
  }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: `wf-${Math.random()}`, name: 'bulk', version: '1.0.0', state: 'Approved', specJsonb: SIMPLE_SPEC,
  }).returning();
  return { wcId: wc.id, wfId: wf.id };
}

async function instanceCount(db: any): Promise<number> {
  const res = await db.execute(sql`select count(*)::int as n from workflow_instance`);
  return res.rows[0].n;
}

const HOUR_AGO = new Date(T0.getTime() - 3_600_000);

test('a backlog of 1,200 expired runs is cleared in one run', async () => {
  const { db, close } = await makeTestDb();
  const { wcId, wfId } = await seedWorkCenter(db, 60);
  await seedRuns(db, wcId, wfId, 1200, 'completed', HOUR_AGO);
  expect(await runSweep(db, () => T0)).toBe(1200);
  expect(await instanceCount(db)).toBe(0);
  await close();
});

test('stops after ten batches', async () => {
  const { db, close } = await makeTestDb();
  const { wcId, wfId } = await seedWorkCenter(db, 60);
  await seedRuns(db, wcId, wfId, 6000, 'completed', HOUR_AGO);
  expect(await runSweep(db, () => T0)).toBe(5000);
  expect(await instanceCount(db)).toBe(1000);
  await close();
});

test('two work centers over budget are both swept', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWorkCenter(db, 60);
  const b = await seedWorkCenter(db, 60);
  await seedRuns(db, a.wcId, a.wfId, 6000, 'completed', HOUR_AGO);
  await seedRuns(db, b.wcId, b.wfId, 6000, 'completed', HOUR_AGO);
  expect(await runSweep(db, () => T0, { batchSize: 500, maxBatches: 10 })).toBe(5000);
  const left = async (id: string) =>
    (await db.execute(sql`select count(*)::int as n from workflow_instance where work_center_id = ${id}`)).rows[0].n as number;
  const la = await left(a.wcId);
  const lb = await left(b.wcId);
  expect(la).toBeLessThan(6000);
  expect(lb).toBeLessThan(6000);
  expect(Math.abs(la - lb)).toBeLessThanOrEqual(500);
  await close();
});

test('unexpired and non-terminal runs are untouched', async () => {
  const { db, close } = await makeTestDb();
  const { wcId, wfId } = await seedWorkCenter(db, 3600);
  await seedRuns(db, wcId, wfId, 1, 'running', null, 1);
  await seedRuns(db, wcId, wfId, 1, 'paused', null, 2);
  await seedRuns(db, wcId, wfId, 1, 'completed', new Date(T0.getTime() - 60_000), 3); // inside retention
  await seedRuns(db, wcId, wfId, 1, 'errored', HOUR_AGO, 4); // exactly 1 h old is not yet past the cutoff
  await seedRuns(db, wcId, wfId, 1, 'errored', new Date(HOUR_AGO.getTime() - 1000), 5);
  expect(await runSweep(db, () => T0)).toBe(1);
  expect(await instanceCount(db)).toBe(4);
  await close();
});

test('each work center uses its own retention', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWorkCenter(db, 60);
  const b = await seedWorkCenter(db, 86_400);
  const twoHoursAgo = new Date(T0.getTime() - 7_200_000);
  await seedRuns(db, a.wcId, a.wfId, 3, 'completed', twoHoursAgo);
  await seedRuns(db, b.wcId, b.wfId, 3, 'completed', twoHoursAgo);
  expect(await runSweep(db, () => T0)).toBe(3);
  const left = await db.execute(sql`select distinct work_center_id from workflow_instance`);
  expect(left.rows.map((r: any) => r.work_center_id)).toEqual([b.wcId]);
  await close();
});

test('work centers with nothing due do not use up the batch budget', async () => {
  const { db, close } = await makeTestDb();
  for (let i = 0; i < 12; i++) await seedWorkCenter(db, 60); // idle, swept first or last
  const busy = await seedWorkCenter(db, 60);
  await seedRuns(db, busy.wcId, busy.wfId, 40, 'completed', HOUR_AGO);
  expect(await runSweep(db, () => T0)).toBe(40);
  await close();
});

test('the batch size and batch cap are configurable', async () => {
  const { db, close } = await makeTestDb();
  const { wcId, wfId } = await seedWorkCenter(db, 60);
  await seedRuns(db, wcId, wfId, 25, 'completed', HOUR_AGO);
  expect(await runSweep(db, () => T0, { batchSize: 10, maxBatches: 2 })).toBe(20);
  expect(await instanceCount(db)).toBe(5);
  await close();
});

test('history survives the sweep', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, SIMPLE_SPEC, 'wf-sweep-hist', 1);
  await pumpUntilQuiet(db, testDeps({ now: () => T0 }));
  const before = await historyRowFor(db, wi.id);
  expect(before).toBeDefined();
  expect(await runSweep(db, () => new Date(T0.getTime() + 5000))).toBe(1);
  expect((await historyRowFor(db, wi.id)).id).toBe(before.id);
  await close();
});

test('the loop no longer sweeps: runOnce on an idle engine deletes nothing', async () => {
  const { db, close } = await makeTestDb();
  const { wcId, wfId } = await seedWorkCenter(db, 60);
  await seedRuns(db, wcId, wfId, 3, 'completed', HOUR_AGO);
  expect(await runOnce(db, testDeps({ now: () => T0 }))).toBe(false);
  expect(await instanceCount(db)).toBe(3);
  await close();
});

test('workCenterIds (test-only) limits the sweep to those work centers', async () => {
  const { db, close } = await makeTestDb();
  const a = await seedWorkCenter(db, 60);
  const b = await seedWorkCenter(db, 60);
  await seedRuns(db, a.wcId, a.wfId, 4, 'completed', HOUR_AGO);
  await seedRuns(db, b.wcId, b.wfId, 3, 'completed', HOUR_AGO);
  expect(await runSweep(db, () => T0, { workCenterIds: [a.wcId] })).toBe(4);
  const left = await db.execute(sql`select work_center_id from workflow_instance`);
  expect(left.rows.map((r: any) => r.work_center_id)).toEqual([b.wcId, b.wcId, b.wcId]);
  await close();
});
