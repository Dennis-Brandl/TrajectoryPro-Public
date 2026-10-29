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
// Task 5: reconcileAndNotify wired at the tail of every instance-claiming transaction (loop.ts
// runOnce x2, settleFailedInstance/recoverFailedStart, control.ts's runControlPass/
// recoverFailedControlPass, monitor.ts's applyActionTerminal) materializes/closes
// instance_assignment offers purely from ground truth — this file proves the OFFER side of
// that lifecycle (spec §4.1/§4.3) end to end through the real engine, reusing controls.test.ts's
// seeding/pump approach with a USER_INTERACTION step added.
import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, instanceAssignment } from 'mission-control-db/src/db/schema/index';
import { requestPause, requestResume, requestStop, requestAbort } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { submitUserAction } from '../src/core/submit.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

const UI_SPEC = {
  local_id: 'wf', oid: 'wf-offers', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'START'),
    step('ui-1', 'USER_INTERACTION'),
    step('end', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'ui-1' },
    { from_step_id: 'ui-1', to_step_id: 'end' },
  ],
};

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string; workCenterId: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

async function stepRow(db: any, instanceId: string, stepOid: string): Promise<any> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r: any) => r.stepOid === stepOid);
}

async function instanceRow(db: any, instanceId: string): Promise<any> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

/** Every instance_assignment row for this instance, joined through its step rows — mirrors
 *  reconcileAssignments' own live-assignment query shape (mission-control-db/src/runtime/
 *  assignments.ts), but unfiltered by status so a test can see cancelled/completed rows too. */
async function assignmentsFor(db: any, instanceId: string): Promise<any[]> {
  return db.select({
    id: instanceAssignment.id,
    status: instanceAssignment.status,
    stepInstanceId: instanceAssignment.stepInstanceId,
    allowedRoleIds: instanceAssignment.allowedRoleIds,
  }).from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(eq(stepInstance.workflowInstanceId, instanceId));
}

// ── Scenario A: park -> offer ──

test('park -> offer: a parked USER_INTERACTION step gets exactly one unrestricted offered assignment', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-offers-a');
  await pumpUntilQuiet(db, testDeps());

  const ui = await stepRow(db, wi.id, 'ui-1');
  expect(ui.state).toBe('WAITING_USER');

  const rows = await assignmentsFor(db, wi.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('offered');
  expect(rows[0].stepInstanceId).toBe(ui.id);
  // The test spec's steps carry no master_oid stamp (never went through instantiateSpec against
  // a real workflow_node tree) -> resolveStepAllowedRoles' masterNodeOidFor lookup misses ->
  // treated as unrestricted (any work-center member).
  expect(rows[0].allowedRoleIds).toEqual([]);

  await close();
});

// ── Scenario B: stop cancels the offer ──

test('stop cancels the offer: assignment -> cancelled, instance -> stopped', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-offers-b');
  await pumpUntilQuiet(db, testDeps());
  expect((await assignmentsFor(db, wi.id))[0].status).toBe('offered');

  await requestStop(db, wi.id);
  await pumpUntilQuiet(db, testDeps());

  const rows = await assignmentsFor(db, wi.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('cancelled');
  expect((await instanceRow(db, wi.id)).status).toBe('stopped');

  await close();
});

// ── Scenario C: abort cancels the offer ──

test('abort cancels the offer: assignment -> cancelled, instance -> aborted', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-offers-c');
  await pumpUntilQuiet(db, testDeps());
  expect((await assignmentsFor(db, wi.id))[0].status).toBe('offered');

  await requestAbort(db, wi.id);
  await pumpUntilQuiet(db, testDeps());

  const rows = await assignmentsFor(db, wi.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('cancelled');
  expect((await instanceRow(db, wi.id)).status).toBe('aborted');

  await close();
});

// ── Scenario D: pause keeps the offer live; resume keeps it live ──
//
// runPausing/runResuming only ever touch WAITING_ACTION/PAUSED action-step rows (see control.ts's
// own doc comments) — a parked WAITING_USER row is untouched through a whole pause/resume round
// trip, so reconcileAssignments' close-loop never fires for it (state stays WAITING_USER, one of
// the two states it treats as still-live) and the SAME assignment row survives both passes.

test('pause keeps the offer live (untouched row); resume keeps it live and the step is still WAITING_USER', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-offers-d');
  await pumpUntilQuiet(db, testDeps());
  const before = await assignmentsFor(db, wi.id);
  expect(before).toHaveLength(1);
  const offerId = before[0].id;

  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, testDeps());

  let rows = await assignmentsFor(db, wi.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(offerId); // same row, untouched
  expect(rows[0].status).toBe('offered');
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, testDeps());

  rows = await assignmentsFor(db, wi.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(offerId); // still the same row
  expect(rows[0].status).toBe('offered');
  expect((await instanceRow(db, wi.id)).status).toBe('running');
  expect((await stepRow(db, wi.id, 'ui-1')).state).toBe('WAITING_USER');

  await close();
});

// ── Scenario E: submit completes the offer ──
//
// Task 6 wired reconcileAndNotify (Task 5) into submitUserAction's OWN transaction (submit.ts's
// claim-guard restructure, which also widened actionIndex to accept 'auto') — so submit itself
// now closes the assignment; no separate explicit reconcileAndNotify call is needed anymore.
// This scenario proves reconcileAndNotify's OWN behavior on a step that left WAITING_USER via
// COMPLETED (as opposed to Scenarios B/C's CANCELLED/ABORTED): the close-loop maps a COMPLETED
// step's live assignment to 'completed', not 'cancelled'.

test('submit itself closes the offer: assignment -> completed, instance -> completed', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC, 'wf-offers-e');
  await pumpUntilQuiet(db, testDeps());
  const deps = testDeps();

  await submitUserAction(db, wi.id, { step_oid: 'ui-1', action: 'submit', form_values: {} }, 0, deps);

  const rows = await assignmentsFor(db, wi.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('completed');
  expect((await instanceRow(db, wi.id)).status).toBe('completed');

  await close();
});
