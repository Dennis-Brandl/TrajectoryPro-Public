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

import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, workflow, workflowInstance, stepInstance, instanceAssignment, operatorPresence, traceEntry, role, workCenterUserRole, workCenterUser, appUser, workflowNode, workflowAllowedRole, runtimeHistory } from '../db/schema/index.js';
import {
  createRuntimeWorkflow, listRuntimeWorkflowsPage, requestStart, deleteRuntimeWorkflow,
  getStartingParameterSpecs, workCenterIdForWorkflow, workCenterIdForInstance,
  getRuntimeWorkflowLive, workCenterIdForAssignment,
  listActiveRuntimeWorkflowsForOperator, getRuntimeWorkflowLiveStates, listActiveRuntimeLeaves,
  listAssignmentCandidates,
} from './runtime-workflows.js';
import { insertStepSignature } from './step-signatures.js';
import { createUser } from './users.js';
import { updateWorkCenter } from './work-centers.js';
import { setRuntimeIdTimezone } from './system-settings.js';
import { DaoError } from './errors.js';

const NIL = '00000000-0000-0000-0000-000000000000';
const SPEC = {
  local_id: 'WF', oid: 'wf-1', version: '1.2.0', state: 'Effective',
  starting_parameter_specifications: [{ id: 'BatchSize', default_value: '10', value_type: 'literal' }],
  steps: [{ local_id: 'Start', oid: 's-1', step_type: 'START' }],
  connections: [],
};

async function seed(db: any, opts: { name?: string } = {}) {
  const [wc] = await db.insert(workCenter).values({ name: opts.name ?? `WC-${Math.random()}` }).returning();
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

test('create → pending, sequential numbering, frozen recipe', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);

  const first = await createRuntimeWorkflow(db, { workflowId: wf.id, params: { BatchSize: '25' }, userId: user.id });
  const second = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });

  expect(first.runtimeNumber).toBe(1);
  expect(second.runtimeNumber).toBe(2);
  expect(first.status).toBe('pending');
  expect(first.masterName).toBe('WF');
  expect(first.masterVersion).toBe('1.2.0');
  expect(first.masterState).toBe('Effective');
  expect(first.createdByName).toBe('Cmdr');

  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, first.id));
  expect((row.specJsonb as any).oid).toMatch(/^rt_/);
  expect(row.startingParams).toEqual({ BatchSize: '25' });

  await close();
});

test('two work centers number independently', async () => {
  const { db, close } = await makeTestDb();
  const a = await seed(db);
  const b = await seed(db);

  const ra = await createRuntimeWorkflow(db, { workflowId: a.wf.id, params: {}, userId: a.user.id });
  const rb = await createRuntimeWorkflow(db, { workflowId: b.wf.id, params: {}, userId: b.user.id });

  expect(ra.runtimeNumber).toBe(1);
  expect(rb.runtimeNumber).toBe(1);

  await close();
});

test('unknown workflow → RUNTIME_MASTER_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  const { user } = await seed(db);

  await expectDaoError(
    createRuntimeWorkflow(db, { workflowId: NIL, params: {}, userId: user.id }),
    'RUNTIME_MASTER_NOT_FOUND',
  );

  await close();
});

test('bad param → RUNTIME_PARAM_INVALID and the transaction rolled back', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);

  await expectDaoError(
    createRuntimeWorkflow(db, { workflowId: wf.id, params: { NotAParam: 'x' }, userId: user.id }),
    'RUNTIME_PARAM_INVALID',
  );

  const [after] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
  expect(after.nextRuntimeNumber).toBe(1);
  const instances = await db.select().from(workflowInstance).where(eq(workflowInstance.workCenterId, wc.id));
  expect(instances).toHaveLength(0);

  await close();
});

test('requestStart: pending→queued sets queuedAt/startRequestedBy; second call → RUNTIME_INVALID_STATE; unknown id → RUNTIME_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });

  const started = await requestStart(db, created.id, user.id);
  expect(started.status).toBe('queued');
  expect(started.queuedAt).toBeInstanceOf(Date);

  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, created.id));
  expect(row.startRequestedBy).toBe(user.id);

  await expectDaoError(requestStart(db, created.id, user.id), 'RUNTIME_INVALID_STATE');
  await expectDaoError(requestStart(db, NIL, user.id), 'RUNTIME_NOT_FOUND');

  await close();
});

test('deleteRuntimeWorkflow: pending deletes (and cascades a seeded step_instance row); each of queued/running/paused → RUNTIME_INVALID_STATE; completed/aborted/stopped/errored delete', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);

  // pending delete, with cascade of a seeded step_instance row
  const pending = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.insert(stepInstance).values({
    workflowInstanceId: pending.id, nodeOid: 'n1', stepOid: 's-1', stepType: 'START', state: 'READY',
  });
  await deleteRuntimeWorkflow(db, pending.id);
  const [afterDelete] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, pending.id));
  expect(afterDelete).toBeUndefined();
  const remainingSteps = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, pending.id));
  expect(remainingSteps).toHaveLength(0);

  // non-deletable statuses
  for (const status of ['queued', 'running', 'paused']) {
    const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
    await db.update(workflowInstance).set({ status }).where(eq(workflowInstance.id, created.id));
    await expectDaoError(deleteRuntimeWorkflow(db, created.id), 'RUNTIME_INVALID_STATE');
  }

  // deletable terminal statuses
  for (const status of ['completed', 'aborted', 'stopped', 'errored']) {
    const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
    await db.update(workflowInstance).set({ status }).where(eq(workflowInstance.id, created.id));
    await deleteRuntimeWorkflow(db, created.id);
    const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, created.id));
    expect(after).toBeUndefined();
  }

  await expectDaoError(deleteRuntimeWorkflow(db, NIL), 'RUNTIME_NOT_FOUND');

  await close();
});

test('listRuntimeWorkflowsPage: only this WC, ordered runtimeNumber desc, and the summary carries no specJsonb key', async () => {
  const { db, close } = await makeTestDb();
  const a = await seed(db);
  const b = await seed(db);

  await createRuntimeWorkflow(db, { workflowId: a.wf.id, params: {}, userId: a.user.id });
  await createRuntimeWorkflow(db, { workflowId: a.wf.id, params: {}, userId: a.user.id });
  await createRuntimeWorkflow(db, { workflowId: b.wf.id, params: {}, userId: b.user.id });

  const { items } = await listRuntimeWorkflowsPage(db, a.wc.id, {});
  expect(items.map((r) => r.runtimeNumber)).toEqual([2, 1]);
  expect(items.every((r) => !('specJsonb' in r))).toBe(true);

  await close();
});

test('listRuntimeWorkflowsPage: filters, pages, and counts', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);

  const statuses = ['pending', 'running', 'paused', 'completed', 'errored'];
  for (const status of statuses) {
    const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
    await db.update(workflowInstance).set({ status }).where(eq(workflowInstance.id, created.id));
  }

  const all = await listRuntimeWorkflowsPage(db, wc.id, {});
  expect(all.total).toBe(5);
  expect(all.items.map((i) => i.runtimeNumber)).toEqual([5, 4, 3, 2, 1]); // newest first
  expect(all.page).toBe(1);
  expect(all.pageSize).toBe(24);
  expect(all.statusCounts).toEqual({ active: 2, pending: 1, finished: 2 });

  const active = await listRuntimeWorkflowsPage(db, wc.id, { filter: 'active' });
  expect(active.items.map((i) => i.status).sort()).toEqual(['paused', 'running']);
  expect(active.total).toBe(2);
  // Chip counts are whole-work-center, never narrowed by the current filter.
  expect(active.statusCounts).toEqual({ active: 2, pending: 1, finished: 2 });

  const pending = await listRuntimeWorkflowsPage(db, wc.id, { filter: 'pending' });
  expect(pending.items.map((i) => i.status)).toEqual(['pending']);

  const finished = await listRuntimeWorkflowsPage(db, wc.id, { filter: 'finished' });
  expect(finished.items.map((i) => i.status).sort()).toEqual(['completed', 'errored']);

  const page2 = await listRuntimeWorkflowsPage(db, wc.id, { page: 2, pageSize: 2 });
  expect(page2.items.map((i) => i.runtimeNumber)).toEqual([3, 2]);
  expect(page2.total).toBe(5);

  const capped = await listRuntimeWorkflowsPage(db, wc.id, { pageSize: 5000 });
  expect(capped.pageSize).toBe(100);

  const nanClamped = await listRuntimeWorkflowsPage(db, wc.id, { page: NaN, pageSize: NaN });
  expect(nanClamped.page).toBe(1);
  expect(nanClamped.pageSize).toBe(24);
  expect(nanClamped.items).toHaveLength(5);

  await close();
});

test('listRuntimeWorkflowsPage: live enrichment', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const op = await createUser(db, { email: `op-${Math.random()}@t.test`, displayName: 'Op One' });

  // Instance A: running, one WAITING_USER step s1 (nodeOid 'node-1'), claimed by "Op One"
  // who is 'away' at this work center.
  const aCreated = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const aSpec = { local_id: 'wf', oid: 'node-1', steps: [{ local_id: 'Fill Form', oid: 's1', step_type: 'USER_INTERACTION' }] };
  await db.update(workflowInstance).set({ status: 'running', specJsonb: aSpec }).where(eq(workflowInstance.id, aCreated.id));
  const [aStep] = await db.insert(stepInstance).values({
    workflowInstanceId: aCreated.id, nodeOid: 'node-1', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  await db.insert(operatorPresence).values({
    userId: op.id, attendingWorkCenterId: wc.id, sessionId: `sess-${Math.random()}`, status: 'away',
  });
  await db.insert(instanceAssignment).values({
    stepInstanceId: aStep.id, workCenterId: wc.id, assignedUserId: op.id, status: 'claimed', claimedAt: new Date(),
  });

  // Instance B: errored, one ERRORED step with error 'boom'.
  const bCreated = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.update(workflowInstance).set({ status: 'errored' }).where(eq(workflowInstance.id, bCreated.id));
  await db.insert(stepInstance).values({
    workflowInstanceId: bCreated.id, nodeOid: 'n', stepOid: 's-x', stepType: 'START', state: 'ERRORED', error: 'boom',
  });

  // Instance C: completed, no non-terminal steps.
  const cCreated = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.id, cCreated.id));

  const { items } = await listRuntimeWorkflowsPage(db, wc.id, {});
  const a = items.find((i) => i.id === aCreated.id)!;
  expect(a.activeSteps).toEqual([{
    stepOid: 's1', stepName: 'Fill Form', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
    claimant: { userId: op.id, name: 'Op One', presence: 'away' },
  }]);
  expect(a.errorText).toBeNull();
  const b = items.find((i) => i.id === bCreated.id)!;
  expect(b.activeSteps).toEqual([]);
  expect(b.errorText).toBe('boom');
  const c = items.find((i) => i.id === cCreated.id)!;
  expect(c.activeSteps).toEqual([]);
  expect(c.errorText).toBeNull();

  await close();
});

test('live enrichment: unclaimed step has null claimant; claimant with no presence row is offline', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const noPresenceUser = await createUser(db, { email: `np-${Math.random()}@t.test`, displayName: 'No Presence' });

  // Instance D: running, step s1 WAITING_USER with an 'offered' assignment -> claimant null.
  const dCreated = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.update(workflowInstance).set({ status: 'running' }).where(eq(workflowInstance.id, dCreated.id));
  const [dStep] = await db.insert(stepInstance).values({
    workflowInstanceId: dCreated.id, nodeOid: 'n', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  await db.insert(instanceAssignment).values({
    stepInstanceId: dStep.id, workCenterId: wc.id, status: 'offered',
  });

  // Instance E: running, step s1 claimed by a user with NO operator_presence row -> presence 'offline'.
  const eCreated = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.update(workflowInstance).set({ status: 'running' }).where(eq(workflowInstance.id, eCreated.id));
  const [eStep] = await db.insert(stepInstance).values({
    workflowInstanceId: eCreated.id, nodeOid: 'n', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  await db.insert(instanceAssignment).values({
    stepInstanceId: eStep.id, workCenterId: wc.id, assignedUserId: noPresenceUser.id, status: 'claimed',
  });

  const { items } = await listRuntimeWorkflowsPage(db, wc.id, {});
  expect(items.find((i) => i.id === dCreated.id)!.activeSteps[0].claimant).toBeNull();
  expect(items.find((i) => i.id === eCreated.id)!.activeSteps[0].claimant?.presence).toBe('offline');

  await close();
});

test('live enrichment: a WAITING_GATE step counts as active (GATE spec 2026-08-29 §6.1)', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);

  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const spec = { local_id: 'wf', oid: 'node-1', steps: [{ local_id: 'Gate', oid: 's1', step_type: 'GATE' }] };
  await db.update(workflowInstance).set({ status: 'running', specJsonb: spec }).where(eq(workflowInstance.id, created.id));
  await db.insert(stepInstance).values({
    workflowInstanceId: created.id, nodeOid: 'node-1', stepOid: 's1', stepType: 'GATE', state: 'WAITING_GATE',
  });

  const { items } = await listRuntimeWorkflowsPage(db, wc.id, {});
  const item = items.find((i) => i.id === created.id)!;
  expect(item.activeSteps).toEqual([{
    stepOid: 's1', stepName: 'Gate', stepType: 'GATE', state: 'WAITING_GATE', claimant: null,
  }]);

  await close();
});

test('getStartingParameterSpecs returns normalized specs; undefined for unknown workflow', async () => {
  const { db, close } = await makeTestDb();
  const { wf } = await seed(db);

  const result = await getStartingParameterSpecs(db, wf.id);
  expect(result).toEqual({
    workflowId: wf.id,
    parameters: [{ id: 'BatchSize', description: null, default_value: '10', value_type: 'literal' }],
  });

  expect(await getStartingParameterSpecs(db, NIL)).toBeUndefined();

  await close();
});

test('getRuntimeWorkflowLive: summary + named steps + assignments + trace tail', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const op = await createUser(db, { email: `op-${Math.random()}@t.test`, displayName: 'Op One' });

  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const spec = {
    local_id: 'wf', oid: 'node-1',
    steps: [
      { local_id: 'Fill Form', oid: 's1', step_type: 'USER_INTERACTION' },
      { local_id: 'Check', oid: 's2', step_type: 'SCRIPT' },
    ],
  };
  await db.update(workflowInstance).set({ status: 'running', specJsonb: spec }).where(eq(workflowInstance.id, created.id));

  const [s1] = await db.insert(stepInstance).values({
    workflowInstanceId: created.id, nodeOid: 'node-1', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER', orderIndex: 1,
  }).returning();
  const [s2] = await db.insert(stepInstance).values({
    workflowInstanceId: created.id, nodeOid: 'node-1', stepOid: 's2', stepType: 'SCRIPT', state: 'COMPLETED', orderIndex: 2,
  }).returning();

  await db.insert(operatorPresence).values({
    userId: op.id, attendingWorkCenterId: wc.id, sessionId: `sess-${Math.random()}`, status: 'online',
  });
  await db.insert(instanceAssignment).values({
    stepInstanceId: s1.id, workCenterId: wc.id, assignedUserId: op.id, status: 'claimed', claimedAt: new Date(),
  });

  await db.insert(traceEntry).values([
    { workflowInstanceId: created.id, stepOid: 's2', state: 'EXECUTING', orderIndex: 1 },
    { workflowInstanceId: created.id, stepOid: 's2', state: 'COMPLETED', orderIndex: 2 },
    { workflowInstanceId: created.id, stepOid: 's1', state: 'EXECUTING', orderIndex: 3 },
  ]);

  const detail = (await getRuntimeWorkflowLive(db, created.id))!;
  expect(detail.summary.id).toBe(created.id);
  expect(detail.steps.map((s) => [s.stepOid, s.stepName, s.state])).toEqual([
    ['s1', 'Fill Form', 'WAITING_USER'], ['s2', 'Check', 'COMPLETED'],
  ]);
  const s1Live = detail.steps.find((s) => s.stepOid === 's1')!;
  expect(s1Live.assignment).toMatchObject({ status: 'claimed', claimant: { name: 'Op One', presence: 'online' } });
  expect(detail.steps.find((s) => s.stepOid === 's2')!.assignment).toBeNull();
  expect(detail.trace.map((t) => [t.stepOid, t.stepName, t.state])).toEqual([
    ['s2', 'Check', 'EXECUTING'], ['s2', 'Check', 'COMPLETED'], ['s1', 'Fill Form', 'EXECUTING'],
  ]);
  expect(await getRuntimeWorkflowLive(db, NIL)).toBeUndefined();

  await close();
});

test('getRuntimeWorkflowLive: step projection carries only documented keys (no input_params/output_params leak)', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);

  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.insert(stepInstance).values({
    workflowInstanceId: created.id, nodeOid: 'n', stepOid: 's-1', stepType: 'START', state: 'READY',
    inputParams: { secret: 'do-not-ship' }, outputParams: { alsoSecret: 'do-not-ship' },
  });

  const detail = (await getRuntimeWorkflowLive(db, created.id))!;
  expect(detail.steps).toHaveLength(1);
  expect(Object.keys(detail.steps[0]).sort()).toEqual([
    'assignment', 'completedAt', 'error', 'gateTimer', 'id', 'startedAt', 'state', 'stepName', 'stepOid', 'stepType',
  ]);
  expect(detail.steps[0]).not.toHaveProperty('inputParams');
  expect(detail.steps[0]).not.toHaveProperty('outputParams');

  await close();
});

test('getRuntimeWorkflowLive: trace tail caps at 50 newest entries, oldest first', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });

  const rows = Array.from({ length: 60 }, (_, i) => ({
    workflowInstanceId: created.id, stepOid: null, state: `T${i + 1}`, orderIndex: i + 1,
  }));
  await db.insert(traceEntry).values(rows);

  const detail = (await getRuntimeWorkflowLive(db, created.id))!;
  expect(detail.trace).toHaveLength(50);
  expect(detail.trace[0].state).toBe('T11'); // entries 11..60 survive (state carries the marker)
  expect(detail.trace[49].state).toBe('T60');

  await close();
});

test('getRuntimeWorkflowLive carries the instance signatures, oldest first', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });

  await insertStepSignature(db, {
    workflowInstanceId: created.id, runtimeNumber: created.runtimeNumber, runtimeLabel: `RW-${created.runtimeNumber}`, workCenterId: wc.id, workCenterName: wc.name,
    stepInstanceId: null, stepOid: 's-1', stepName: 'Approve', signerUserId: null, signerLoginName: 'jane',
    signerDisplayName: 'Jane', roleId: null, roleName: 'QA Lead', operatorUserId: null, operatorLoginName: 'bob',
    meaning: null, decision: 'yes', outcome: 'signed', failureCode: null,
  });

  const live = (await getRuntimeWorkflowLive(db, created.id))!;
  expect(live.signatures).toHaveLength(1);
  expect(live.signatures[0]).toMatchObject({ stepName: 'Approve', roleName: 'QA Lead', decision: 'yes' });

  await close();
});

test('workCenterIdForAssignment resolves; null for unknown', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: created.id, nodeOid: 'n', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [assignment] = await db.insert(instanceAssignment).values({
    stepInstanceId: step.id, workCenterId: wc.id, status: 'offered',
  }).returning();

  expect(await workCenterIdForAssignment(db, assignment.id)).toBe(wc.id);
  expect(await workCenterIdForAssignment(db, NIL)).toBeNull();

  await close();
});

test('workCenterIdForWorkflow/workCenterIdForInstance return the id / null', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });

  expect(await workCenterIdForWorkflow(db, wf.id)).toBe(wc.id);
  expect(await workCenterIdForWorkflow(db, NIL)).toBeNull();

  expect(await workCenterIdForInstance(db, created.id)).toBe(wc.id);
  expect(await workCenterIdForInstance(db, NIL)).toBeNull();

  await close();
});

test('listActiveRuntimeWorkflowsForOperator: active bucket + mine flag (claimed and role-visible offer)', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const me = await createUser(db, { email: `me-${Math.random()}@t.test`, displayName: 'Me' });

  const running = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const mineClaimed = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const gatedOffer = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const finished = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  for (const [id, status] of [[running.id, 'running'], [mineClaimed.id, 'running'], [gatedOffer.id, 'paused'], [finished.id, 'completed']] as const) {
    await db.update(workflowInstance).set({ status }).where(eq(workflowInstance.id, id));
  }

  const [sClaim] = await db.insert(stepInstance).values({
    workflowInstanceId: mineClaimed.id, nodeOid: 'n', stepOid: 's-c', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  await db.insert(instanceAssignment).values({
    stepInstanceId: sClaim.id, workCenterId: wc.id, assignedUserId: me.id, status: 'claimed', claimedAt: new Date(),
  });

  const [r] = await db.insert(role).values({ name: `r-${Math.random()}` }).returning();
  const [sOffer] = await db.insert(stepInstance).values({
    workflowInstanceId: gatedOffer.id, nodeOid: 'n', stepOid: 's-o', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  await db.insert(instanceAssignment).values({
    stepInstanceId: sOffer.id, workCenterId: wc.id, status: 'offered', allowedRoleIds: [r.id],
  });

  // Without the role: only the claim is mine.
  let items = await listActiveRuntimeWorkflowsForOperator(db, wc.id, me.id);
  expect(items.map((i) => i.id).sort()).toEqual([gatedOffer.id, mineClaimed.id, running.id].sort()); // completed excluded
  expect(items.find((i) => i.id === mineClaimed.id)!.mine).toBe(true);
  expect(items.find((i) => i.id === gatedOffer.id)!.mine).toBe(false);
  expect(items.find((i) => i.id === running.id)!.mine).toBe(false);

  // With the role, the gated offer becomes mine.
  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: me.id });
  await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: me.id, roleId: r.id });
  items = await listActiveRuntimeWorkflowsForOperator(db, wc.id, me.id);
  expect(items.find((i) => i.id === gatedOffer.id)!.mine).toBe(true);
  await close();
});

test('getRuntimeWorkflowLiveStates: latest row per stepOid, assignment.mine, childActive, terminal instance still served', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const me = await createUser(db, { email: `me2-${Math.random()}@t.test`, displayName: 'Op Me' });

  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.update(workflowInstance).set({
    status: 'running',
    engineState: { childActive: { 'rt-proxy': 'rt-child-spec' } },
  }).where(eq(workflowInstance.id, created.id));

  // Looped step: two rows for 'loop' — the orderIndex-3 row must win.
  await db.insert(stepInstance).values([
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'loop', stepType: 'SCRIPT', state: 'COMPLETED', orderIndex: 1 },
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'loop', stepType: 'SCRIPT', state: 'EXECUTING', orderIndex: 3 },
  ]);
  const [sMine] = await db.insert(stepInstance).values({
    workflowInstanceId: created.id, nodeOid: 'child-n', stepOid: 'ask', stepType: 'USER_INTERACTION', state: 'WAITING_USER', orderIndex: 2,
  }).returning();
  await db.insert(instanceAssignment).values({
    stepInstanceId: sMine.id, workCenterId: wc.id, assignedUserId: me.id, status: 'claimed', claimedAt: new Date(),
  });

  const live = (await getRuntimeWorkflowLiveStates(db, created.id, me.id))!;
  expect(live.instanceId).toBe(created.id);
  expect(live.status).toBe('running');
  expect(live.steps['loop']).toMatchObject({ state: 'EXECUTING', nodeOid: 'n', assignment: null });
  expect(live.steps['ask']).toMatchObject({
    state: 'WAITING_USER', nodeOid: 'child-n',
    assignment: { status: 'claimed', claimant: { displayName: 'Op Me' }, mine: true },
  });
  expect(live.steps['never-reached']).toBeUndefined();
  expect(live.childActive).toEqual({ 'rt-proxy': 'rt-child-spec' });

  // Another operator: same claim is NOT mine.
  const other = await createUser(db, { email: `ot-${Math.random()}@t.test`, displayName: 'Other' });
  const otherView = (await getRuntimeWorkflowLiveStates(db, created.id, other.id))!;
  expect(otherView.steps['ask']!.assignment).toMatchObject({ mine: false, claimant: { displayName: 'Op Me' } });

  // Terminal instance still returns (a viewed diagram keeps working after completion).
  await db.update(workflowInstance).set({ status: 'completed' }).where(eq(workflowInstance.id, created.id));
  expect((await getRuntimeWorkflowLiveStates(db, created.id, me.id))!.status).toBe('completed');

  expect(await getRuntimeWorkflowLiveStates(db, NIL, me.id)).toBeUndefined();
  await close();
});

test('listActiveRuntimeLeaves: active statuses only, cross-WC, ordered, lean projection', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf } = await seed(db);
  const [wc2] = await db.insert(workCenter).values({ name: `WC2-${Math.random()}` }).returning();
  const [wf2] = await db.insert(workflow).values({
    oid: 'wf-2', name: 'WF2', workCenterId: wc2.id, version: '1.0.0', state: 'Effective', specJsonb: SPEC,
  }).returning();
  const mk = (wcId: string, wfId: string, runtimeNumber: number, status: string) =>
    db.insert(workflowInstance).values({
      workflowId: wfId, workCenterId: wcId, triggeredBy: 'manual', status,
      specJsonb: SPEC, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`, masterName: 'M', masterOid: 'o', masterVersion: '1', masterState: 'Effective',
    });
  await mk(wc.id, wf.id, 2, 'running');
  await mk(wc.id, wf.id, 1, 'paused');
  await mk(wc.id, wf.id, 3, 'pending');    // excluded: not active
  await mk(wc2.id, wf2.id, 1, 'stopping');
  await mk(wc2.id, wf2.id, 2, 'completed'); // excluded: terminal

  const leaves = await listActiveRuntimeLeaves(db);
  expect(leaves).toHaveLength(3);
  // Ordered (workCenterId, runtimeNumber) — within each WC, 1 before 2.
  const perWc = new Map<string, number[]>();
  for (const l of leaves) perWc.set(l.workCenterId, [...(perWc.get(l.workCenterId) ?? []), l.runtimeNumber]);
  expect(perWc.get(wc.id)).toEqual([1, 2]);
  expect(perWc.get(wc2.id)).toEqual([1]);
  // Lean projection: exactly these keys, nothing heavy.
  expect(Object.keys(leaves[0]!).sort()).toEqual(
    ['id', 'masterName', 'masterVersion', 'runtimeLabel', 'runtimeNumber', 'status', 'workCenterId'],
  );
  await close();
});

// ── CM Runtime pane: create-and-start + assignment candidates (spec 2026-08-27 §4.2/§4.6) ──

test('createRuntimeWorkflow start:true lands queued with queuedAt + startRequestedBy in one transaction', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const rw = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id, start: true });
  expect(rw.status).toBe('queued');
  expect(rw.queuedAt).not.toBeNull();
  const [row] = await db.select({ startRequestedBy: workflowInstance.startRequestedBy })
    .from(workflowInstance).where(eq(workflowInstance.id, rw.id));
  expect(row!.startRequestedBy).toBe(user.id);
  // Default path unchanged:
  const rw2 = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  expect(rw2.status).toBe('pending');
  await close();
});

test('listAssignmentCandidates: members with presence; role filter; stepName; 404 shape', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);
  const rw = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  // findStepDef resolves against the INSTANCE's own specJsonb, which createRuntimeWorkflow
  // stamps via instantiateSpec (root oid remapped to 'rt_1', not SPEC's raw 'wf-1'). Mirror
  // this file's other stepName-asserting tests (getRuntimeWorkflowLive, "live enrichment"):
  // overwrite specJsonb with the raw SPEC whose oids match what we seed on stepInstance below.
  await db.update(workflowInstance).set({ specJsonb: SPEC }).where(eq(workflowInstance.id, rw.id));
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: rw.id, nodeOid: SPEC.oid, stepOid: 's-1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [a] = await db.insert(instanceAssignment).values({
    stepInstanceId: step!.id, workCenterId: wc.id, status: 'offered',
  }).returning();

  const member = await createUser(db, { email: `m-${Math.random()}@t.test`, displayName: 'Alice' });
  const outsider = await createUser(db, { email: `o-${Math.random()}@t.test`, displayName: 'Zed' });
  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: member.id });
  // operator_presence has a UNIQUE(user_id, attending_work_center_id) index (drizzle/0007) —
  // a user can hold only one presence row per work center, so the "several sessions, best
  // presence wins" case the brief sketched can't be seeded as two rows here; one row proves
  // the presence pass-through (the byUser Map's max-rank fold in the DAO is defensive for a
  // join shape that, given today's schema, can never actually yield two rows per member).
  await db.insert(operatorPresence).values({
    sessionId: `s1-${Math.random()}`, userId: member.id, attendingWorkCenterId: wc.id, status: 'online',
  });

  const view = await listAssignmentCandidates(db, a!.id);
  expect(view).toBeDefined();
  expect(view!.assignmentId).toBe(a!.id);
  expect(view!.status).toBe('offered');
  expect(view!.stepName).toBe('Start'); // SPEC's s-1 local_id
  expect(view!.candidates).toEqual([{ userId: member.id, name: 'Alice', presence: 'online' }]);
  expect(view!.candidates.some((c) => c.userId === outsider.id)).toBe(false);

  expect(await listAssignmentCandidates(db, NIL)).toBeUndefined();
  await close();
});

test('listAssignmentCandidates: role-restricted step filters out a member without the allowed role, keeps a member with it', async () => {
  const { db, close } = await makeTestDb();
  const { wc, wf, user } = await seed(db);

  // Role-restriction idiom mirrored from runtime/assignments.test.ts's seedWorkflow: a
  // workflow_node row keyed by the master_oid the step's spec node carries, plus a
  // workflow_allowed_role row linking that node to a role — resolveStepAllowedRoles/
  // masterNodeOidFor walk exactly this shape (see runtime/assignments.ts).
  const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'M-root', name: 'root', depth: 0 }).returning();
  const [restrictedRole] = await db.insert(role).values({ name: `Restricted-${Math.random()}` }).returning();
  const [otherRole] = await db.insert(role).values({ name: `Other-${Math.random()}` }).returning();
  await db.insert(workflowAllowedRole).values({ workflowId: wf.id, workflowNodeId: node.id, roleId: restrictedRole.id });

  const rw = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  // Same technique as the test above: overwrite the instance's stamped specJsonb with a raw
  // spec whose top-level oid/master_oid match what we seed on stepInstance/workflow_node
  // below, sidestepping instantiateSpec's oid remapping entirely.
  const roleSpec = { ...SPEC, oid: 'wf-1', master_oid: 'M-root' };
  await db.update(workflowInstance).set({ specJsonb: roleSpec }).where(eq(workflowInstance.id, rw.id));
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: rw.id, nodeOid: roleSpec.oid, stepOid: 's-1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [a] = await db.insert(instanceAssignment).values({
    stepInstanceId: step!.id, workCenterId: wc.id, status: 'offered', allowedRoleIds: [restrictedRole.id],
  }).returning();

  const withRole = await createUser(db, { email: `wr-${Math.random()}@t.test`, displayName: 'WithRole' });
  const withoutRole = await createUser(db, { email: `nr-${Math.random()}@t.test`, displayName: 'NoRole' });
  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: withRole.id });
  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: withoutRole.id });
  await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: withRole.id, roleId: restrictedRole.id });
  // A DIFFERENT role held by the excluded member proves the filter checks role IDENTITY
  // against allowedRoleIds, not merely "holds some role".
  await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: withoutRole.id, roleId: otherRole.id });

  const view = await listAssignmentCandidates(db, a!.id);
  expect(view!.candidates.map((c) => c.userId)).toEqual([withRole.id]);
  expect(view!.candidates.some((c) => c.userId === withoutRole.id)).toBe(false);

  await close();
});

test('trace tail breaks an order_index tie by id — an operator row shares its neighbour\'s index (spec §12.5 item 19)', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  // Inserted in the order they must DISPLAY: the OPERATOR row was written from outside the
  // instance's transaction at max(order_index)+1, and the instance's own next entry then reused
  // that index. Only (order_index, id) orders them; order_index alone is a coin flip.
  await db.insert(traceEntry).values([
    { workflowInstanceId: created.id, stepOid: 's-1', state: 'COMPLETE', orderIndex: 1 },
    { workflowInstanceId: created.id, stepOid: 's-1', state: 'OPERATOR', orderIndex: 2, error: 'release-holder "Printer" [by u]' },
    { workflowInstanceId: created.id, stepOid: 's-2', state: 'READY', orderIndex: 2 },
  ]);
  const detail = (await getRuntimeWorkflowLive(db, created.id))!;
  expect(detail.trace.map((t) => t.state)).toEqual(['COMPLETE', 'OPERATOR', 'READY']);
  await close();
});

test('getRuntimeWorkflowLiveStates: an ARMED gate carries its engine_state.armedGates entry; every other step carries null (GATE follow-up 8c)', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.update(workflowInstance).set({
    status: 'running',
    engineState: { armedGates: { 'g-1': { predecessorOid: 'ap-1', open: true, stopSent: false } } },
  }).where(eq(workflowInstance.id, created.id));
  await db.insert(stepInstance).values([
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'ap-1', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', orderIndex: 1 },
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'g-1', stepType: 'GATE', state: 'WAITING_GATE', orderIndex: 2 },
  ]);
  const live = (await getRuntimeWorkflowLiveStates(db, created.id, user.id))!;
  expect(live.steps['g-1']!.armedGate).toEqual({ predecessorOid: 'ap-1', open: true, stopSent: false });
  expect(live.steps['ap-1']!.armedGate).toBeNull();
  await close();
});

test('getRuntimeWorkflowLiveStates: a WAITING_GATE timer gate carries gateTimer + stepInstanceId; other steps carry null (timed GATE spec 2026-10-13 §5.4)', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const started = new Date('2026-01-01T00:00:00.000Z');
  await db.update(workflowInstance).set({
    status: 'running',
    specJsonb: { oid: 'n', master_oid: 'M', connections: [], children: [], steps: [
      { oid: 'g-t', local_id: 'Cool', step_type: 'GATE', gate_config: { mode: 'timer', delay_seconds: 90 } },
      { oid: 'ap-1', local_id: 'AP', step_type: 'ACTION PROXY' },
    ] },
  }).where(eq(workflowInstance.id, created.id));
  const rows = await db.insert(stepInstance).values([
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'g-t', stepType: 'GATE', state: 'WAITING_GATE', orderIndex: 1, startedAt: started },
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'ap-1', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', orderIndex: 2, startedAt: started },
  ]).returning();
  const live = (await getRuntimeWorkflowLiveStates(db, created.id, user.id))!;
  expect(live.steps['g-t']!.gateTimer).toEqual({ mode: 'timer', deadline: '2026-01-01T00:01:30.000Z', cycleSeconds: null });
  expect(live.steps['g-t']!.stepInstanceId).toBe(rows.find((r: any) => r.stepOid === 'g-t')!.id);
  expect(live.steps['ap-1']!.gateTimer).toBeNull();

  // The dialog payload (no diagram) carries the same timer per step.
  const detail = (await getRuntimeWorkflowLive(db, created.id))!;
  expect(detail.steps.find((s) => s.stepOid === 'g-t')!.gateTimer)
    .toEqual({ mode: 'timer', deadline: '2026-01-01T00:01:30.000Z', cycleSeconds: null });
  expect(detail.steps.find((s) => s.stepOid === 'ap-1')!.gateTimer).toBeNull();
  await close();
});

test('an armed timed gate that has opened carries no gateTimer in either payload (it only waits for its action)', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  await db.update(workflowInstance).set({
    status: 'running',
    specJsonb: { oid: 'n', master_oid: 'M', connections: [], children: [], steps: [
      { oid: 'g-t', local_id: 'Cool', step_type: 'GATE', gate_config: { mode: 'timer', delay_seconds: 90, control_previous_action: true } },
    ] },
    engineState: { armedGates: { 'g-t': { predecessorOid: 'ap-1', open: true, stopSent: true } } },
  }).where(eq(workflowInstance.id, created.id));
  await db.insert(stepInstance).values([
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'g-t', stepType: 'GATE', state: 'WAITING_GATE', orderIndex: 1, startedAt: new Date() },
  ]);
  expect((await getRuntimeWorkflowLiveStates(db, created.id, user.id))!.steps['g-t']!.gateTimer).toBeNull();
  expect((await getRuntimeWorkflowLive(db, created.id))!.steps.find((s) => s.stepOid === 'g-t')!.gateTimer).toBeNull();
  await close();
});

test('a WAITING_SCRIPT repeating script carries a repeat_script gateTimer in both payloads (spec 2026-10-13 §6.7)', async () => {
  const { db, close } = await makeTestDb();
  const { wf, user } = await seed(db);
  const created = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: user.id });
  const started = new Date('2026-01-01T00:00:00.000Z');
  await db.update(workflowInstance).set({
    status: 'running',
    specJsonb: { oid: 'n', master_oid: 'M', connections: [], children: [], steps: [
      { oid: 'sc', local_id: 'Poll', step_type: 'SCRIPT', script_config: { source: 'return false;', repeat: { cycle_seconds: 2, time_limit_seconds: 90 } } },
    ] },
  }).where(eq(workflowInstance.id, created.id));
  await db.insert(stepInstance).values([
    { workflowInstanceId: created.id, nodeOid: 'n', stepOid: 'sc', stepType: 'SCRIPT', state: 'WAITING_SCRIPT', orderIndex: 1, startedAt: started },
  ]);
  const want = { mode: 'repeat_script', deadline: '2026-01-01T00:01:30.000Z', cycleSeconds: 2 };
  expect((await getRuntimeWorkflowLiveStates(db, created.id, user.id))!.steps['sc']!.gateTimer).toEqual(want);
  expect((await getRuntimeWorkflowLive(db, created.id))!.steps.find((s) => s.stepOid === 'sc')!.gateTimer).toEqual(want);
  await close();
});

// seed() is this file's existing seeding helper (brief calls it `seedWorkflow`; adapted here
// rather than renamed). It returns { wc, wf, user }, not { workflowId, workCenterId }.
describe('runtime label allocation (spec 2026-10-07 §6)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders RW-<n> for an unconfigured work center', async () => {
    const { db, close } = await makeTestDb();
    const { wf } = await seed(db);
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const b = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(a.runtimeLabel).toBe('RW-1');
    expect(b.runtimeLabel).toBe('RW-2');
    await close();
  });

  it('renders the configured template and restarts {SEQ} when the date rolls over', async () => {
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db, { name: 'Mixing Line #1' });
    await db.update(workCenter)
      .set({ runtimeIdTemplate: 'MIX-{YYYY}{MM}{DD}-{SEQ:3}' })
      .where(eq(workCenter.id, wc.id));
    await setRuntimeIdTimezone(db, 'UTC');

    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const b = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    const c = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });

    expect(a.runtimeLabel).toBe('MIX-20261007-001');
    expect(b.runtimeLabel).toBe('MIX-20261007-002');
    expect(c.runtimeLabel).toBe('MIX-20261008-001');   // {SEQ} restarted
    // …but runtime_number did NOT restart: it orders the list and the cross-WC poll (§4.3).
    expect([a.runtimeNumber, b.runtimeNumber, c.runtimeNumber]).toEqual([1, 2, 3]);
    await close();
  });

  it('probes for a free label when a restart returns to an already-used bucket (spec §6.1)', async () => {
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db);
    await setRuntimeIdTimezone(db, 'UTC');
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));

    // RW-1..RW-3 under the default (unconfigured) template, bucket ''.
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const b = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const c = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect([a.runtimeLabel, b.runtimeLabel, c.runtimeLabel]).toEqual(['RW-1', 'RW-2', 'RW-3']);

    // Switch to a dated template: the bucket changes, one run lands under it.
    await db.update(workCenter)
      .set({ runtimeIdTemplate: 'MIX-{YYYY}{MM}{DD}-{SEQ:3}' })
      .where(eq(workCenter.id, wc.id));
    const dated = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(dated.runtimeLabel).toBe('MIX-20261007-001');

    // Clear the template back to NULL: the bucket returns to '', which RW-1..RW-3 already used.
    // Comparing only the bucket string would restart at seq=1 and render RW-1 — already taken,
    // a 23505 on workflow_instance_wc_label_uq. The probe must skip ahead to the first free seq.
    await db.update(workCenter).set({ runtimeIdTemplate: null }).where(eq(workCenter.id, wc.id));
    const e = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(e.runtimeLabel).toBe('RW-4');

    await close();
  });

  it('renders {WC} from the name at creation, and a later rename does not rewrite it', async () => {
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db, { name: 'Blend A' });
    await db.update(workCenter).set({ runtimeIdTemplate: '{WC}-{SEQ}' }).where(eq(workCenter.id, wc.id));
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(a.runtimeLabel).toBe('BLEND-A-1');
    await updateWorkCenter(db, wc.id, { name: 'Blend B' });
    const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, a.id));
    expect(row!.runtimeLabel).toBe('BLEND-A-1');       // frozen (§3)
    await close();
  });

  it('falls back to RW-<n> and never throws when the stored template is unrenderable', async () => {
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db);
    // nextRuntimeNumber and runtimeSeqNext seeded to DIFFERENT values deliberately: a fresh work
    // center has both at 1, where 'RW-1' is the output of either the fallback branch (RW-<runtimeNumber>)
    // or a hypothetical regression that mistakenly took the success branch and used seq — so it
    // cannot prove the fallback actually ran. Setting runtimeNumber to 5 while seq stays at 1
    // makes the two branches render different strings.
    // Bypasses validation deliberately — simulates a row written before a rule tightened.
    await db.update(workCenter)
      .set({ runtimeIdTemplate: '{BOGUS}', nextRuntimeNumber: 5, runtimeSeqNext: 1 })
      .where(eq(workCenter.id, wc.id));
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(a.runtimeLabel).toBe('RW-5');
    expect(a.runtimeNumber).toBe(5);
    // Catch-branch counter fix (whole-branch review): nothing was consumed from the
    // per-template sequence on this call (it rendered RW-<runtime_number> instead), so
    // runtime_seq_next must be left exactly as found — not advanced to 2, as the pre-fix code
    // did despite zero sequences being used.
    const [wcRow] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
    expect(wcRow!.runtimeSeqNext).toBe(1);
    await close();
  });

  it('continues {SEQ} past pre-migration runs instead of colliding with a backfilled label', async () => {
    // The migration sets runtime_seq_next = next_runtime_number for existing work centers.
    // Without that, this create would render RW-1 and violate workflow_instance_wc_label_uq.
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db);
    await db.update(workCenter)
      .set({ nextRuntimeNumber: 11, runtimeSeqNext: 11, runtimeSeqBucket: '' })
      .where(eq(workCenter.id, wc.id));
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(a.runtimeLabel).toBe('RW-11');
    expect(a.runtimeNumber).toBe(11);
    await close();
  });

  // Replaces the old 'rolls the sequence back with the number when the create fails' test,
  // whose premise (a continuation trusts runtime_seq_next unprobed) IS the defect §6.2 fixes.
  // Pre-fix, resetting runtime_seq_next back to an already-used value collided at INSERT on
  // workflow_instance_wc_label_uq and threw. Post-fix, the continuation probes and skips past
  // the taken label instead.
  it('a continuation probes past a stored sequence whose label still exists, rather than colliding (spec §6.2)', async () => {
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db);
    await db.update(workCenter).set({ runtimeIdTemplate: 'X-{SEQ}' }).where(eq(workCenter.id, wc.id));
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(a.runtimeLabel).toBe('X-1');

    // Simulate the stored sequence drifting back to an already-used value — per §6.2, the
    // normal way this happens in production is the sweeper deleting a terminal instance and a
    // later bucket round-trip restarting the counter, but the drift itself is all that matters
    // here: X-1 still exists, and runtime_seq_next now (wrongly) points at it.
    await db.update(workCenter).set({ runtimeSeqNext: 1 }).where(eq(workCenter.id, wc.id));
    const b = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(b.runtimeLabel).toBe('X-2');

    const [wcRow] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
    expect(wcRow!.nextRuntimeNumber).toBe(3);
    expect(wcRow!.runtimeSeqNext).toBe(3);
    await close();
  });

  it('reproduces the sweep-then-template-cycle defect end to end: three more creates succeed without colliding (spec §6.2)', async () => {
    // The exact production repro from the design doc: RW-1..RW-3 are created, the sweeper
    // deletes the first two (completed and swept — a sparse TAIL, not a contiguous prefix), an
    // admin sets a dated template and clears it again, and three more creates must all succeed
    // with distinct labels. Pre-fix, this throws on the third create (23505 on
    // workflow_instance_wc_label_uq) and the work center is stuck failing identically forever,
    // because the failed transaction never advances runtime_seq_next past the collision.
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db);
    await setRuntimeIdTimezone(db, 'UTC');
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));

    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const b = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const c = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect([a.runtimeLabel, b.runtimeLabel, c.runtimeLabel]).toEqual(['RW-1', 'RW-2', 'RW-3']);

    // Simulate MissionEngine/src/core/sweep.ts deleting the first two terminal instances after
    // work_center.finished_retention_secs. c's row survives — the tail is sparse.
    await db.delete(workflowInstance).where(inArray(workflowInstance.id, [a.id, b.id]));

    // The two-click repro: set a dated template (consumes seq=1 of the new bucket), then clear
    // it again, returning to the '' bucket that RW-1..RW-3 already used.
    await db.update(workCenter)
      .set({ runtimeIdTemplate: 'MIX-{YYYY}{MM}{DD}-{SEQ:3}' })
      .where(eq(workCenter.id, wc.id));
    await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    await db.update(workCenter).set({ runtimeIdTemplate: null }).where(eq(workCenter.id, wc.id));

    const d = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const e = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    const f = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });

    const labels = [d.runtimeLabel, e.runtimeLabel, f.runtimeLabel];
    expect(new Set(labels).size).toBe(3); // no collision
    // RW-1 and RW-2 are free again (swept); RW-3 is still taken by c, so the probe skips to RW-4.
    expect(labels).toEqual(['RW-1', 'RW-2', 'RW-4']);
    await close();
  });

  it('does not re-issue a label that only survives in runtime_history (spec §6.2)', async () => {
    // The sweeper's normal path (not a corner case — it runs hourly by default): the engine
    // settles a run into a permanent runtime_history row, then the sweeper deletes the
    // now-terminal workflow_instance row. A probe that checks only workflow_instance would see
    // the label as free and re-issue it, aliasing two different runs under one identifier in
    // History — contradicting spec §2 ruling 1.
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db);
    const a = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(a.runtimeLabel).toBe('RW-1');

    await db.insert(runtimeHistory).values({
      workflowInstanceId: a.id, workCenterId: wc.id, workCenterName: wc.name,
      runtimeNumber: a.runtimeNumber, runtimeLabel: a.runtimeLabel,
      masterName: 'M', masterOid: 'o', masterVersion: '1', masterState: 'Effective',
      finalState: 'completed', finishedAt: new Date(), trace: [],
    });
    await db.delete(workflowInstance).where(eq(workflowInstance.id, a.id));

    // Force the allocator to re-probe RW-1: without the history check, no workflow_instance
    // row holds it any more, so it would look free.
    await db.update(workCenter).set({ runtimeSeqNext: 1 }).where(eq(workCenter.id, wc.id));
    const b = await createRuntimeWorkflow(db, { workflowId: wf.id, params: {}, userId: null });
    expect(b.runtimeLabel).toBe('RW-2');
    await close();
  });

  // §6.2 made a label collision unreachable, so the transactional-rollback guarantee this
  // DAO relies on ("the whole create fails, so the counters are never left half-advanced") is
  // now asserted by NOTHING — every surviving counter assertion in this file is either a
  // success path or a fresh work center's defaults. An FK violation is used here (rather than
  // a label collision) precisely BECAUSE the probe cannot see it coming: created_by references
  // app_user(id) ON DELETE SET NULL, so a well-formed but nonexistent user id passes every
  // check allocateRuntimeIdentity performs and fails only at the INSERT itself — forcing a
  // genuine post-allocation rollback with no mocks.
  it('rolls BOTH counters back when the insert fails after allocation (FK violation, a constraint the probe cannot see)', async () => {
    const { db, close } = await makeTestDb();
    const { wc, wf } = await seed(db);

    await expect(createRuntimeWorkflow(db, {
      workflowId: wf.id, params: {}, userId: crypto.randomUUID(),
    })).rejects.toThrow();

    const [wcRow] = await db.select().from(workCenter).where(eq(workCenter.id, wc.id));
    expect(wcRow!.nextRuntimeNumber).toBe(1);
    expect(wcRow!.runtimeSeqNext).toBe(1);
    const instances = await db.select().from(workflowInstance).where(eq(workflowInstance.workCenterId, wc.id));
    expect(instances).toHaveLength(0);
    await close();
  });
});
