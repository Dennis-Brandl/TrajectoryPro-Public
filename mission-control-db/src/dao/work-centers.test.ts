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
import { eq, sql } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import {
  workCenter, workflow, workflowInstance, environmentSpec, schedule, stepInstance, instanceAssignment,
  RUNTIME_ACTIVE_STATUSES,
} from '../db/schema/index.js';
import {
  subtree, assignUserToWorkCenter, usersInWorkCenter, createWorkCenter, updateWorkCenter,
  deleteWorkCenter, workCenterDeleteImpact, listRootWorkCenters, removeUserFromWorkCenter,
  isMissionSystemCommander, missionSystemCommanderWorkCenters,
} from './work-centers.js';
import { createUser } from './users.js';

test('subtree returns descendants depth-ordered; work_center_user assigns with priority', async () => {
  const { db, close } = await makeTestDb();
  const [a] = await db.insert(workCenter).values({ name: 'A' }).returning();
  const [b] = await db.insert(workCenter).values({ name: 'B', parentWorkCenterId: a.id }).returning();
  await db.insert(workCenter).values({ name: 'C', parentWorkCenterId: b.id });
  const rows = await subtree(db, a.id);
  expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);

  const u = await createUser(db, { email: 'p@x.io', displayName: 'P' });
  await assignUserToWorkCenter(db, a.id, u.id, { priority: 7 });
  expect(await usersInWorkCenter(db, a.id)).toEqual([{ userId: u.id, priority: 7 }]);
  await close();
});

test('createWorkCenter creates a root then a child', async () => {
  const { db, close } = await makeTestDb();
  const root = await createWorkCenter(db, { name: 'Plant A' });
  expect(root.parentWorkCenterId).toBeNull();
  const child = await createWorkCenter(db, { name: 'Back Office', parentWorkCenterId: root.id });
  expect(child.parentWorkCenterId).toBe(root.id);
  await close();
});

test('createWorkCenter rejects a duplicate sibling name but allows reuse under a different parent', async () => {
  const { db, close } = await makeTestDb();
  const p1 = await createWorkCenter(db, { name: 'P1' });
  const p2 = await createWorkCenter(db, { name: 'P2' });
  await createWorkCenter(db, { name: 'Shared', parentWorkCenterId: p1.id });
  await expect(createWorkCenter(db, { name: 'Shared', parentWorkCenterId: p1.id }))
    .rejects.toMatchObject({ code: 'WORK_CENTER_NAME_CONFLICT' });
  const ok = await createWorkCenter(db, { name: 'Shared', parentWorkCenterId: p2.id });
  expect(ok.name).toBe('Shared');
  await close();
});

test('createWorkCenter rejects an unknown dispatch policy and a missing parent', async () => {
  const { db, close } = await makeTestDb();
  await expect(createWorkCenter(db, { name: 'X', dispatchPolicy: 'nope' }))
    .rejects.toMatchObject({ code: 'INVALID_DISPATCH_POLICY' });
  await expect(createWorkCenter(db, { name: 'Y', parentWorkCenterId: '00000000-0000-0000-0000-000000000000' }))
    .rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' });
  await close();
});

test('updateWorkCenter renames and reparents', async () => {
  const { db, close } = await makeTestDb();
  const a = await createWorkCenter(db, { name: 'A' });
  const b = await createWorkCenter(db, { name: 'B' });
  const c = await createWorkCenter(db, { name: 'C', parentWorkCenterId: a.id });
  const updated = await updateWorkCenter(db, c.id, { name: 'C2', parentWorkCenterId: b.id });
  expect(updated.name).toBe('C2');
  expect(updated.parentWorkCenterId).toBe(b.id);
  await close();
});

test('updateWorkCenter rejects a parent cycle (self or descendant)', async () => {
  const { db, close } = await makeTestDb();
  const a = await createWorkCenter(db, { name: 'A' });
  const b = await createWorkCenter(db, { name: 'B', parentWorkCenterId: a.id });
  await expect(updateWorkCenter(db, a.id, { parentWorkCenterId: a.id }))
    .rejects.toMatchObject({ code: 'WORK_CENTER_CYCLE' });
  await expect(updateWorkCenter(db, a.id, { parentWorkCenterId: b.id }))
    .rejects.toMatchObject({ code: 'WORK_CENTER_CYCLE' });
  await close();
});

test('updateWorkCenter rejects a duplicate sibling name', async () => {
  const { db, close } = await makeTestDb();
  await createWorkCenter(db, { name: 'A' });
  const b = await createWorkCenter(db, { name: 'B' });
  await expect(updateWorkCenter(db, b.id, { name: 'A' }))
    .rejects.toMatchObject({ code: 'WORK_CENTER_NAME_CONFLICT' });
  await close();
});

test('deleteWorkCenter removes a leaf work center', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'Solo' });
  await deleteWorkCenter(db, wc.id);
  expect(await db.select().from(workCenter)).toHaveLength(0);
  await close();
});

test('deleteWorkCenter is blocked while it has children', async () => {
  const { db, close } = await makeTestDb();
  const parent = await createWorkCenter(db, { name: 'P' });
  await createWorkCenter(db, { name: 'C', parentWorkCenterId: parent.id });
  await expect(deleteWorkCenter(db, parent.id)).rejects.toMatchObject({ code: 'WORK_CENTER_HAS_CHILDREN' });
  await close();
});

test('workCenterDeleteImpact counts what a confirmed delete would destroy', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(environmentSpec).values({ oid: 'e', name: 'E', workCenterId: wc.id, specJsonb: {} });
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual',
      ...runtimeCols(),
    });
    const impact = await workCenterDeleteImpact(db, wc.id);
    expect(impact).toMatchObject({ workflows: 1, environments: 1, instances: 1, hasChildren: false });
  } finally { await close(); }
});

test('an unconfirmed delete with instance history is refused', async () => {
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
    await expect(deleteWorkCenter(db, wc.id)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await db.select().from(workCenter)).toHaveLength(1);
  } finally { await close(); }
});

test('a CONFIRMED delete removes the work center, its artifacts, and its history', async () => {
  // The deterministic blocker a naive `DELETE FROM work_center` hits here is
  // workflow_instance.work_center_id: a direct, first-degree RESTRICT on work_center itself
  // that is never cascade-scheduled, so it fires regardless of cascade ordering elsewhere.
  // The schedule row is a defensive addition, not the load-bearing one on its own: its
  // schedule_wc_workflow_fk RESTRICT on workflow only trips a naive delete depending on the
  // (Postgres-unspecified) relative firing order of schedule's and workflow's independent
  // cascade paths off work_center — RESTRICT fires immediately rather than waiting for that
  // ordering to settle the way NO ACTION would. Only the hand-ordered delete survives both.
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();
    await db.insert(environmentSpec).values({ oid: 'e', name: 'E', workCenterId: wc.id, specJsonb: {} });
    await db.insert(schedule).values({
      workCenterId: wc.id, workflowId: wf.id, name: 'Nightly', kind: 'recurring',
    });
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'schedule',
      ...runtimeCols(),
    });
    await deleteWorkCenter(db, wc.id, { confirmed: true });
    expect(await db.select().from(workCenter)).toHaveLength(0);
    expect(await db.select().from(workflow)).toHaveLength(0);
    expect(await db.select().from(environmentSpec)).toHaveLength(0);
    expect(await db.select().from(workflowInstance)).toHaveLength(0);
    expect(await db.select().from(schedule)).toHaveLength(0);
  } finally { await close(); }
});

test('a work center with children is refused even when confirmed', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [parent] = await db.insert(workCenter).values({ name: 'Plant' }).returning();
    await db.insert(workCenter).values({ name: 'Line 1', parentWorkCenterId: parent.id });
    await expect(deleteWorkCenter(db, parent.id, { confirmed: true }))
      .rejects.toMatchObject({ code: 'WORK_CENTER_HAS_CHILDREN' });
  } finally { await close(); }
});

test('an empty work center deletes without confirmation', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Empty' }).returning();
    await deleteWorkCenter(db, wc.id);
    expect(await db.select().from(workCenter)).toHaveLength(0);
  } finally { await close(); }
});

test('listRootWorkCenters returns only roots, ordered by sortOrder then name', async () => {
  const { db, close } = await makeTestDb();
  // sortOrder ascending puts Zulu(1) first; within sortOrder=2 the name breaks the tie
  // (Alpha before Mike). This deliberately diverges from a pure alphabetical sort, so the
  // test fails if the sortOrder key is dropped or the name tie-break is missing.
  const zulu = await createWorkCenter(db, { name: 'Zulu', sortOrder: 1 });
  await createWorkCenter(db, { name: 'Mike', sortOrder: 2 });
  await createWorkCenter(db, { name: 'Alpha', sortOrder: 2 });
  await createWorkCenter(db, { name: 'child', parentWorkCenterId: zulu.id });
  const roots = await listRootWorkCenters(db);
  expect(roots.map((r) => r.name)).toEqual(['Zulu', 'Alpha', 'Mike']);
  await close();
});

test('deleteWorkCenter surfaces a friendly error for a RESTRICT ref the pre-checks miss (cross-WC instance_assignment)', async () => {
  const { db, close } = await makeTestDb();
  const home = await createWorkCenter(db, { name: 'Home' });
  const target = await createWorkCenter(db, { name: 'Target' });
  const [wf] = await db.insert(workflow).values({ oid: 'a1', name: 'WF', workCenterId: home.id, specJsonb: {} }).returning();
  const [inst] = await db.insert(workflowInstance)
    .values({ workflowId: wf.id, workCenterId: home.id, triggeredBy: 'manual', ...runtimeCols() }).returning();
  const [step] = await db.insert(stepInstance)
    .values({ workflowInstanceId: inst.id, nodeOid: 'n', stepOid: 's', stepType: 'USER_INTERACTION', state: 'WAITING_USER' }).returning();
  // instance_assignment.work_center_id (RESTRICT) points at `target`, which has NO workflow_instance
  // and NO children, so the pre-checks pass and the delete hits the FK — exercising the 23503 catch.
  await db.insert(instanceAssignment).values({ stepInstanceId: step.id, workCenterId: target.id });
  await expect(deleteWorkCenter(db, target.id)).rejects.toMatchObject({ code: 'WORK_CENTER_IN_USE' });
  await close();
});

test('assignUserToWorkCenter throws LINK_TARGET_NOT_FOUND for a well-formed but nonexistent userId', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'WC' });
  await expect(assignUserToWorkCenter(db, wc.id, '00000000-0000-0000-0000-000000000000'))
    .rejects.toMatchObject({ code: 'LINK_TARGET_NOT_FOUND' });
  await close();
});

test('removeUserFromWorkCenter removes only the targeted assignment', async () => {
  const { db, close } = await makeTestDb();
  const wc1 = await createWorkCenter(db, { name: 'WC1' });
  const wc2 = await createWorkCenter(db, { name: 'WC2' });
  const u1 = await createUser(db, { email: 'u1@x.io', displayName: 'U1' });
  const u2 = await createUser(db, { email: 'u2@x.io', displayName: 'U2' });
  await assignUserToWorkCenter(db, wc1.id, u1.id, { priority: 3 });
  await assignUserToWorkCenter(db, wc1.id, u2.id, { priority: 4 });
  await assignUserToWorkCenter(db, wc2.id, u1.id, { priority: 5 });

  await removeUserFromWorkCenter(db, wc1.id, u1.id);

  // Only (wc1, u1) is removed: u2 in wc1 and u1 in wc2 both survive — proving the delete
  // is scoped by BOTH work_center_id AND user_id, not just one of them.
  expect((await usersInWorkCenter(db, wc1.id)).map((r) => r.userId)).toEqual([u2.id]);
  expect((await usersInWorkCenter(db, wc2.id)).map((r) => r.userId)).toEqual([u1.id]);
  await close();
});

test('createWorkCenter rejects a name longer than 200 chars', async () => {
  const { db, close } = await makeTestDb();
  await expect(createWorkCenter(db, { name: 'x'.repeat(201), parentWorkCenterId: null }))
    .rejects.toMatchObject({ code: 'NAME_TOO_LONG' });
  const wc = await createWorkCenter(db, { name: 'x'.repeat(200), parentWorkCenterId: null }); // boundary: exactly 200 is allowed
  expect(wc.name).toHaveLength(200);
  await close();
});

test('updateWorkCenter rejects a name longer than 200 chars', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'WC' });
  await expect(updateWorkCenter(db, wc.id, { name: 'x'.repeat(201) }))
    .rejects.toMatchObject({ code: 'NAME_TOO_LONG' });
  const updated = await updateWorkCenter(db, wc.id, { name: 'x'.repeat(200) }); // boundary: exactly 200 is allowed
  expect(updated.name).toHaveLength(200);
  await close();
});

// `work_center.dispatch_params` was a free-form jsonb column that nothing in the repo ever
// read, and that only the package importer could write. Spec §12.1 flagged it as the one soft
// spot in D1 — export passed it through verbatim, so it was the single field through which a
// uuid could enter a portable package unnoticed — and required either a documented natural-key
// form or an explicit exclusion before any writer existed. User decision 2026-07-30: the column
// has no meaning in the current design or any planned one, so it is removed outright rather
// than given a form.
//
// Asserted against information_schema, not the Drizzle model: dropping the field from
// schema/work-centers.ts alone would make any model-level assertion vacuously true while the
// column sat in the database untouched. makeTestDb replays ./drizzle, so this fails until the
// migration itself drops it.
test('work_center has no dispatch_params column', async () => {
  const { db, close } = await makeTestDb();
  try {
    const result = await db.execute(sql`
      select column_name from information_schema.columns
      where table_name = 'work_center' and column_name = 'dispatch_params'
    `);
    expect(result.rows).toEqual([]);
  } finally { await close(); }
});

// Behavior change: `assignUserToWorkCenter`'s third argument is now a partial-upsert `opts`
// object rather than a positional priority. A bare re-assign (opts omitted/empty) therefore
// changes NOTHING — including priority — instead of resetting priority to 0 the way the old
// positional signature did.
test('assignUserToWorkCenter partial-upserts missionSystemCommander and priority independently', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'WC' });
  const u = await createUser(db, { email: 'mc@x.io', displayName: 'MC' });

  await assignUserToWorkCenter(db, wc.id, u.id, { missionSystemCommander: true });
  expect(await isMissionSystemCommander(db, wc.id, u.id)).toBe(true);

  // Re-assign with only priority set: missionSystemCommander (not named in opts) is left alone.
  await assignUserToWorkCenter(db, wc.id, u.id, { priority: 5 });
  expect(await isMissionSystemCommander(db, wc.id, u.id)).toBe(true);
  expect(await usersInWorkCenter(db, wc.id)).toEqual([{ userId: u.id, priority: 5 }]);

  // Bare re-assign (opts empty): onConflictDoNothing — nothing changes, priority stays 5.
  await assignUserToWorkCenter(db, wc.id, u.id);
  expect(await isMissionSystemCommander(db, wc.id, u.id)).toBe(true);
  expect(await usersInWorkCenter(db, wc.id)).toEqual([{ userId: u.id, priority: 5 }]);

  await close();
});

test('deleteWorkCenter rejects deletion while runtime workflows are in an active status', async () => {
  // Test each of the 7 RUNTIME_ACTIVE_STATUSES: the delete must fail regardless of confirmed flag
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Active' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();

    for (const status of RUNTIME_ACTIVE_STATUSES) {
      // Create an instance in this active status
      await db.insert(workflowInstance).values({
        workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status,
        ...runtimeCols(),
      });

      // Verify delete is rejected even with confirmed: true
      await expect(deleteWorkCenter(db, wc.id, { confirmed: true }))
        .rejects.toMatchObject({
          code: 'WORK_CENTER_HAS_ACTIVE_RUNTIME',
          message: expect.stringContaining('1 runtime workflows are active'),
        });

      // Clean up this instance for the next iteration
      await db.delete(workflowInstance).where(sql`status = ${status}`);
    }
  } finally { await close(); }
});

test('deleteWorkCenter succeeds when instances are only pending or completed', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Inactive' }).returning();
    const [wf] = await db.insert(workflow).values({
      oid: 'w', name: 'WF', workCenterId: wc.id, specJsonb: {},
    }).returning();

    // Create instances in non-active statuses
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'pending',
      ...runtimeCols(),
    });
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'completed',
      ...runtimeCols(),
    });

    // Confirmed delete should succeed and both instances should be removed
    await deleteWorkCenter(db, wc.id, { confirmed: true });
    expect(await db.select().from(workCenter)).toHaveLength(0);
    expect(await db.select().from(workflowInstance)).toHaveLength(0);
  } finally { await close(); }
});

test('missionSystemCommanderWorkCenters lists exactly the work centers where the user is flagged', async () => {
  const { db, close } = await makeTestDb();
  const wcA = await createWorkCenter(db, { name: 'A' });
  const wcB = await createWorkCenter(db, { name: 'B' });
  const wcC = await createWorkCenter(db, { name: 'C' });
  const u = await createUser(db, { email: 'mc2@x.io', displayName: 'MC2' });

  await assignUserToWorkCenter(db, wcA.id, u.id, { missionSystemCommander: true });
  await assignUserToWorkCenter(db, wcB.id, u.id); // assigned, not a commander
  await assignUserToWorkCenter(db, wcC.id, u.id, { missionSystemCommander: true });

  expect((await missionSystemCommanderWorkCenters(db, u.id)).sort()).toEqual([wcA.id, wcC.id].sort());
  await close();
});

test('unassigning a user clears their Mission System Commander status for that work center', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'WC' });
  const u = await createUser(db, { email: 'mc3@x.io', displayName: 'MC3' });

  await assignUserToWorkCenter(db, wc.id, u.id, { missionSystemCommander: true });
  expect(await isMissionSystemCommander(db, wc.id, u.id)).toBe(true);

  await removeUserFromWorkCenter(db, wc.id, u.id);
  expect(await isMissionSystemCommander(db, wc.id, u.id)).toBe(false);
  await close();
});

test('autoClaim: create defaults false, create/update honor explicit values, absent patch leaves it', async () => {
  const { db, close } = await makeTestDb();
  const plain = await createWorkCenter(db, { name: 'AC-plain' });
  expect(plain.autoClaim).toBe(false);
  const on = await createWorkCenter(db, { name: 'AC-on', autoClaim: true });
  expect(on.autoClaim).toBe(true);
  const updated = await updateWorkCenter(db, plain.id, { autoClaim: true });
  expect(updated.autoClaim).toBe(true);
  const untouched = await updateWorkCenter(db, plain.id, { description: 'x' });
  expect(untouched.autoClaim).toBe(true);
  await close();
});

test('new work centers start with no template and a sequence at 1 (spec 2026-10-07 §4.1)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'WC-A' });
  const [row] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
  expect(row!.runtimeIdTemplate).toBeNull();
  expect(row!.runtimeSeqBucket).toBeNull();
  expect(row!.runtimeSeqNext).toBe(1);
  expect(row!.nextRuntimeNumber).toBe(1);
  await close();
});

test('stores a valid template and normalises blank to NULL (spec 2026-10-07 §5.3)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'WC-T', runtimeIdTemplate: 'MIX-{YYYY}-{SEQ:3}' });
  const [a] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
  expect(a!.runtimeIdTemplate).toBe('MIX-{YYYY}-{SEQ:3}');
  await updateWorkCenter(db, wc.id, { runtimeIdTemplate: '   ' });
  const [b] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
  expect(b!.runtimeIdTemplate).toBeNull();
  await close();
});

test('rejects an invalid template on create and on update', async () => {
  const { db, close } = await makeTestDb();
  await expect(createWorkCenter(db, { name: 'WC-U', runtimeIdTemplate: 'NO-SEQ-HERE' }))
    .rejects.toMatchObject({ code: 'INVALID_RUNTIME_ID_TEMPLATE' });
  const wc = await createWorkCenter(db, { name: 'WC-V' });
  await expect(updateWorkCenter(db, wc.id, { runtimeIdTemplate: '{DDD}-{SEQ}' }))
    .rejects.toMatchObject({ code: 'INVALID_RUNTIME_ID_TEMPLATE' });
  await close();
});

test('validates a renamed work center against the NEW name', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'Short', runtimeIdTemplate: '{WC}{WC}{WC}{WC}-{SEQ}' });
  await expect(updateWorkCenter(db, wc.id, { name: 'X'.repeat(60) }))
    .rejects.toMatchObject({ code: 'INVALID_RUNTIME_ID_TEMPLATE' });
  await close();
});

// §7: an update that touches neither the template nor the name must NOT re-validate the
// stored template — otherwise a work center whose template predates a tightened rule could
// never have its description edited again without first fixing the (unrelated) template.
test('updateWorkCenter leaves a stale template untouched when neither it nor the name changes', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'Stays', runtimeIdTemplate: 'MIX-{SEQ:2}' });
  // Simulate a template that predates a tightened rule by writing one straight to the row,
  // bypassing DAO validation entirely.
  await db.update(workCenter).set({ runtimeIdTemplate: 'STALE-NO-SEQ' }).where(eq(workCenter.id, wc.id));
  const updated = await updateWorkCenter(db, wc.id, { description: 'new description' });
  expect(updated.description).toBe('new description');
  expect(updated.runtimeIdTemplate).toBe('STALE-NO-SEQ');
  await close();
});

test('typeName: create trims, update sets/clears, undefined leaves it, subtree carries it', async () => {
  const { db, close } = await makeTestDb();
  const wc = await createWorkCenter(db, { name: 'L1', typeName: ' Production Line ' });
  expect(wc.typeName).toBe('Production Line');
  expect((await subtree(db, wc.id))[0]!.typeName).toBe('Production Line');
  expect((await updateWorkCenter(db, wc.id, { description: 'd' })).typeName).toBe('Production Line');
  expect((await updateWorkCenter(db, wc.id, { typeName: '  ' })).typeName).toBeNull();
  await expect(updateWorkCenter(db, wc.id, { typeName: 'x'.repeat(51) }))
    .rejects.toMatchObject({ code: 'TYPE_NAME_TOO_LONG' });
  await close();
});

test('an unconfirmed delete with only a finished instance (run history) is refused', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'History' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'wh', name: 'WF', workCenterId: wc.id, specJsonb: {} }).returning();
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', ...runtimeCols(), status: 'completed',
    });
    // Remove the workflow so the instance is the ONLY thing left that could demand confirmation.
    await db.delete(workflow).where(eq(workflow.id, wf.id)).catch(() => undefined);
    await expect(deleteWorkCenter(db, wc.id)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(await db.select().from(workCenter)).toHaveLength(1);
  } finally { await close(); }
});

test('a delete is refused for an active instance even when confirmed, and a finished one does not block it', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [wc] = await db.insert(workCenter).values({ name: 'Active' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'wa', name: 'WF', workCenterId: wc.id, specJsonb: {} }).returning();
    await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', ...runtimeCols(), status: 'completed',
    });
    const [live] = await db.insert(workflowInstance).values({
      workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', ...runtimeCols(), status: 'running',
    }).returning();
    await expect(deleteWorkCenter(db, wc.id, { confirmed: true }))
      .rejects.toMatchObject({ code: 'WORK_CENTER_HAS_ACTIVE_RUNTIME' });
    expect(await db.select().from(workflowInstance)).toHaveLength(2);
    await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.id, live.id));
    await deleteWorkCenter(db, wc.id, { confirmed: true });
    expect(await db.select().from(workCenter)).toHaveLength(0);
  } finally { await close(); }
});
