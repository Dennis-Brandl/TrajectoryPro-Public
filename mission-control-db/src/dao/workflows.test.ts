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
import { runtimeCols } from '../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance, stepInstance, runtimeHistory, schedule, environmentSpec, workflowEnvironment } from '../db/schema/index.js';
import { deleteWorkflow, listWorkflowSummaries, setWorkflowDispatchPolicy, setWorkflowAutoClaim } from './workflows.js';

test('listWorkflowSummaries orders by work center, name, version, state', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [b] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
    const [a] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await db.insert(workflow).values([
      { oid: 'w', name: 'Bottle', workCenterId: b.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
      { oid: 'w', name: 'Bottle', workCenterId: a.id, version: '2.0.0', state: 'Draft', specJsonb: {} },
      { oid: 'w', name: 'Bottle', workCenterId: a.id, version: '1.0.0', state: 'Effective', specJsonb: {} },
      { oid: 'w', name: 'Bottle', workCenterId: a.id, version: '1.0.0', state: 'Draft', specJsonb: {} },
    ]);
    const rows = await listWorkflowSummaries(db);
    expect(rows.map((r) => `${r.workCenterName} ${r.version} ${r.state}`)).toEqual([
      'Line 1 1.0.0 Draft', 'Line 1 1.0.0 Effective', 'Line 1 2.0.0 Draft', 'Line 2 1.0.0 Draft',
    ]);
    expect(rows[0]).not.toHaveProperty('specJsonb'); // light projection — do not ship the spec blob to every tree render
  } finally { await close(); }
});

// Coverage debt from Tasks 4 and 5: sourceLibraryName/sourceLibraryOid are Designer provenance
// (spec D9) — display-only, never used to route or group — but they must still reach the
// caller through the summary projection, not just be typed on WorkflowSummary. Also covers
// workCenterId and dispatchPolicy, the other two fields the brief's interface names that
// nothing previously asserted round-trip.
test('listWorkflowSummaries carries Designer provenance, workCenterId, and dispatchPolicy through the projection', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    await db.insert(workflow).values({
      oid: 'w', name: 'Bottle', workCenterId: wc.id, specJsonb: {}, dispatchPolicy: 'manual',
      sourceLibraryName: 'Studio Recipes', sourceLibraryOid: 'studio-lib-42', typeName: 'Operation',
    });
    const [row] = await listWorkflowSummaries(db);
    expect(row.sourceLibraryName).toBe('Studio Recipes');
    expect(row.sourceLibraryOid).toBe('studio-lib-42');
    expect(row.workCenterId).toBe(wc.id);
    expect(row.dispatchPolicy).toBe('manual');
    expect(row.typeName).toBe('Operation');
  } finally { await close(); }
});

test('deleteWorkflow removes an entry that has no instances', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await deleteWorkflow(db, wf.id);
    expect(await db.select().from(workflow)).toHaveLength(0);
  } finally { await close(); }
});

test('deleteWorkflow is blocked by a pending runtime (it has not run, so it has no history)', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual',
      ...runtimeCols(),
    });
    await expect(deleteWorkflow(db, wf.id)).rejects.toMatchObject({
      code: 'WORKFLOW_IN_USE', message: 'Workflow has runtime workflows that have not finished',
    });
  } finally { await close(); }
});

test('deleteWorkflow is blocked by an active runtime, and deletes nothing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(workflowInstance).values([
      { workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'completed', ...runtimeCols() },
      { workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'paused', ...runtimeCols() },
    ]);
    await expect(deleteWorkflow(db, wf.id)).rejects.toMatchObject({ code: 'WORKFLOW_IN_USE' });
    expect(await db.select().from(workflow)).toHaveLength(1);
    expect(await db.select().from(workflowInstance)).toHaveLength(2); // the finished one too
  } finally { await close(); }
});

test('finished runtimes do not block deleteWorkflow: they are deleted with it and their history survives', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wf, other] = await db.insert(workflow).values([
      { oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {} },
      { oid: 'x', name: 'Other', workCenterId: wc.id, specJsonb: {} },
    ]).returning();
    const finished = await db.insert(workflowInstance).values(
      (['completed', 'aborted', 'stopped', 'errored'] as const).map((status) => ({
        workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual' as const, status, ...runtimeCols(),
      })),
    ).returning();
    const [kept] = await db.insert(workflowInstance).values({
      workflowId: other.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'completed', ...runtimeCols(),
    }).returning();
    await db.insert(stepInstance).values({ workflowInstanceId: finished[0].id, nodeOid: 'n1', stepOid: 's1', stepType: 'start', state: 'COMPLETED' });
    await db.insert(runtimeHistory).values({
      workflowInstanceId: finished[0].id, workCenterId: wc.id, workCenterName: 'Line 1',
      runtimeNumber: finished[0].runtimeNumber, runtimeLabel: finished[0].runtimeLabel,
      masterName: 'WF', masterOid: 'w', masterVersion: '1.0.0', masterState: 'Draft',
      finalState: 'completed', finishedAt: new Date(), trace: [],
    });

    await deleteWorkflow(db, wf.id);

    expect((await db.select().from(workflow)).map((r) => r.id)).toEqual([other.id]);
    expect((await db.select().from(workflowInstance)).map((r) => r.id)).toEqual([kept.id]);
    expect(await db.select().from(stepInstance)).toHaveLength(0);
    expect(await db.select().from(runtimeHistory)).toHaveLength(1);
  } finally { await close(); }
});

// schedule_wc_workflow_fk is RESTRICT (spec §4.4): a schedule with no instances yet would
// otherwise hit the bare 23503 catch and surface a message-less WORKFLOW_IN_USE as the 409 body.
test('deleteWorkflow is blocked when a schedule references it, even with no instances', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(schedule).values({
      workCenterId: wc.id, workflowId: wf.id, name: 'Nightly', kind: 'recurring',
    });
    await expect(deleteWorkflow(db, wf.id)).rejects.toMatchObject({
      code: 'WORKFLOW_IN_USE', message: expect.stringContaining('schedule'),
    });
    expect(await db.select().from(workflow)).toHaveLength(1); // not deleted
  } finally { await close(); }
});

test('deleting a workflow leaves a shared environment intact for its sibling', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [a] = await db.insert(workflow).values({ oid: 'a', name: 'A', workCenterId: wc.id, specJsonb: {} }).returning();
    const [b] = await db.insert(workflow).values({ oid: 'b', name: 'B', workCenterId: wc.id, specJsonb: {} }).returning();
    await db.insert(workflowEnvironment).values([
      { workflowId: a.id, environmentSpecId: env.id }, { workflowId: b.id, environmentSpecId: env.id },
    ]);
    await deleteWorkflow(db, a.id);
    expect(await db.select().from(environmentSpec)).toHaveLength(1);
    // B's link is still there, so this alone can't distinguish "the env survived because it's
    // work-center-owned" from "the env survived because B still references it" — see the next
    // test, which deletes the SOLE embedding workflow.
    expect(await db.select().from(workflowEnvironment)).toHaveLength(1);
  } finally { await close(); }
});

// The discriminating case: deleting the ONLY workflow that embeds an environment must still
// leave the environment row behind, because the environment is owned by the work center, not
// by whichever workflow happened to carry it in (spec §5). Without this, the test above alone
// could pass even if deleteWorkflow only survived because a sibling link kept the env "in use".
test('deleting the sole embedding workflow still leaves the environment owned by the work center', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [env] = await db.insert(environmentSpec).values({
      oid: 'e', name: 'Env', workCenterId: wc.id, specJsonb: {},
    }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'a', name: 'A', workCenterId: wc.id, specJsonb: {} }).returning();
    await db.insert(workflowEnvironment).values({ workflowId: wf.id, environmentSpecId: env.id });

    await deleteWorkflow(db, wf.id);
    expect(await db.select().from(environmentSpec)).toHaveLength(1);
    expect(await db.select().from(workflowEnvironment)).toHaveLength(0); // the link itself does cascade away
  } finally { await close(); }
});

// ── setWorkflowDispatchPolicy ────────────────────────────────────────────────
// M6 deleted the link DAO, taking `setWorkflowDispatchPolicy(workCenterId, linkId, policy)`
// with it and leaving workflow.dispatch_policy writable only by ingest carry-over (spec §14).
// The successor keys on the workflow row itself — in M6 a workflow is owned by exactly one
// work center, so workflow.id alone identifies the entry and no work-center scope is needed.

const seedWorkflow = async (db: any, wcName = 'Line 1', policy: string | null = null) => {
  const [wc] = await db.insert(workCenter).values({ name: wcName }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'w', name: 'Bottle', workCenterId: wc.id, specJsonb: {}, dispatchPolicy: policy,
  }).returning();
  return { wc, wf };
};

test('setWorkflowDispatchPolicy writes a valid policy onto the entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wf } = await seedWorkflow(db);
    await setWorkflowDispatchPolicy(db, wf.id, 'manual');
    const [row] = await db.select().from(workflow).where(eq(workflow.id, wf.id));
    expect(row.dispatchPolicy).toBe('manual');
  } finally { await close(); }
});

// null is a meaningful value, not "leave unchanged": workflow_dispatch_ck explicitly admits
// NULL, which means "no override — inherit the work center's policy". A writer that cannot
// clear would strand every workflow on the first policy anyone ever set.
test('setWorkflowDispatchPolicy clears an existing override when passed null', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wf } = await seedWorkflow(db, 'Line 1', 'manual');
    await setWorkflowDispatchPolicy(db, wf.id, null);
    const [row] = await db.select().from(workflow).where(eq(workflow.id, wf.id));
    expect(row.dispatchPolicy).toBeNull();
  } finally { await close(); }
});

// Typed 400 rather than the raw workflow_dispatch_ck violation the DB would otherwise raise.
test('setWorkflowDispatchPolicy rejects an unknown policy without writing', async () => {
  const { db, close } = await makeTestDb();
  try {
    const { wf } = await seedWorkflow(db, 'Line 1', 'manual');
    await expect(setWorkflowDispatchPolicy(db, wf.id, 'nope'))
      .rejects.toMatchObject({ code: 'INVALID_DISPATCH_POLICY' });
    const [row] = await db.select().from(workflow).where(eq(workflow.id, wf.id));
    expect(row.dispatchPolicy).toBe('manual'); // untouched
  } finally { await close(); }
});

// The affected-row check, inherited from the deleted link DAO: a stale but well-formed uuid
// must raise WORKFLOW_NOT_FOUND (→ route 404), never silently update nothing and report
// success. .returning() is the portable affected-row signal across PGlite and node-postgres.
test('setWorkflowDispatchPolicy raises WORKFLOW_NOT_FOUND for a stale workflow id', async () => {
  const { db, close } = await makeTestDb();
  try {
    await seedWorkflow(db);
    await expect(setWorkflowDispatchPolicy(db, '00000000-0000-0000-0000-000000000000', 'manual'))
      .rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
  } finally { await close(); }
});

// Mirrors updateWorkCenter, which stamps updatedAt on every patch. Without this the only
// record that an override ever changed is the value itself, so a steward auditing "what
// changed on this entry recently" would see a load-time timestamp and conclude nothing had.
// Seeded with a fixed past timestamp rather than comparing against now(), so the assertion
// cannot flake when the write lands inside the same millisecond as the insert.
test('setWorkflowDispatchPolicy stamps updatedAt', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const stale = new Date('2020-01-01T00:00:00.000Z');
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'Bottle', workCenterId: wc.id, specJsonb: {}, updatedAt: stale,
    }).returning();

    await setWorkflowDispatchPolicy(db, wf.id, 'manual');

    const [row] = await db.select().from(workflow).where(eq(workflow.id, wf.id));
    expect(row.updatedAt.getTime()).toBeGreaterThan(stale.getTime());
  } finally { await close(); }
});

// Guards a missing or over-broad WHERE: with a single row in the table every test above
// would still pass if the UPDATE hit every workflow.
test('setWorkflowDispatchPolicy touches only the targeted entry', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [target] = await db.insert(workflow).values({
      oid: 'w', name: 'Bottle', workCenterId: wc.id, version: '1.0.0', specJsonb: {},
    }).returning();
    const [sibling] = await db.insert(workflow).values({
      oid: 'w', name: 'Bottle', workCenterId: wc.id, version: '2.0.0', specJsonb: {},
    }).returning();

    await setWorkflowDispatchPolicy(db, target.id, 'round_robin');

    const [t] = await db.select().from(workflow).where(eq(workflow.id, target.id));
    const [s] = await db.select().from(workflow).where(eq(workflow.id, sibling.id));
    expect(t.dispatchPolicy).toBe('round_robin');
    expect(s.dispatchPolicy).toBeNull();
  } finally { await close(); }
});

// ── setWorkflowAutoClaim (spec 2026-08-14 D4) ────────────────────────────────

test('setWorkflowAutoClaim persists true, false, and null (inherit); 404s a stale id', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'AC-WF' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();

  for (const value of [true, false, null]) {
    await setWorkflowAutoClaim(db, wf.id, value);
    const [row] = await db.select({ a: workflow.autoClaim }).from(workflow).where(eq(workflow.id, wf.id));
    expect(row.a).toBe(value);
  }

  await expect(setWorkflowAutoClaim(db, '00000000-0000-0000-0000-000000000000', true))
    .rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
  await close();
});
