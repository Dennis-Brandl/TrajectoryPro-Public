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
// Task 10: the operator API's claim / release / submit routes (src/api/app.ts) — status-guarded
// races, live role-eligibility re-check at claim time (spec §4.3), and submit's kind-shaped
// dispatch into submitUserAction (complete / submit / decision). Uses the same real-engine-pump
// seeding approach as offers.test.ts (a real spec run through pumpUntilQuiet so offers exist from
// ground truth) layered on Task 8/9's operator-API harness (test/helpers/api.ts).
import { expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  workCenter, workCenterUser, workflow, workflowNode, workflowAllowedRole, role, workCenterUserRole,
  workflowInstance, stepInstance, instanceAssignment,
} from 'mission-control-db/src/db/schema/index';
import { requestPause } from 'mission-control-db/src/dao/runtime-control';
import { makeApi, type ApiHarness } from './helpers/api.js';
import { pumpUntilQuiet } from './helpers/pump.js';

type TestDb = ApiHarness['db'];

const jsonHeaders = (cookie: string) => ({ cookie, 'content-type': 'application/json' });

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

// Unrestricted, single fieldless USER_INTERACTION step — used for claim races, release,
// submit-complete, and the submit guards.
const UI_SPEC = {
  local_id: 'wf', oid: 'wf-ui', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('start', 'START'), step('ui-1', 'USER_INTERACTION'), step('end', 'END')],
  connections: [
    { from_step_id: 'start', to_step_id: 'ui-1' },
    { from_step_id: 'ui-1', to_step_id: 'end' },
  ],
};

// YES_NO gate routing to two independent ENDs via source_handle_id 'yes'/'no' — the operator
// API's own decision literal ('yes'/'no') is used directly as the connection handle, so this
// spec's handles are named to match (see app.ts's submit route: button_output := body.value).
const YESNO_SPEC = {
  local_id: 'wf', oid: 'wf-yesno', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [
    step('start', 'START'),
    step('gate', 'YES_NO', { yes_no_config: { yes_value: 'yes', no_value: 'no' } }),
    step('end-yes', 'END'),
    step('end-no', 'END'),
  ],
  connections: [
    { from_step_id: 'start', to_step_id: 'gate' },
    { from_step_id: 'gate', to_step_id: 'end-yes', source_handle_id: 'yes' },
    { from_step_id: 'gate', to_step_id: 'end-no', source_handle_id: 'no' },
  ],
};

// A root-level spec stamped with its own master_oid (spec.oid === the root step's own nodeOid,
// per transition.ts's `nodeOid: context.spec.oid` for root-level activations) — lets
// resolveStepAllowedRoles find a matching workflow_node via masterNodeOidFor's direct root hit.
const RESTRICTED_SPEC = {
  local_id: 'wf', oid: 'wf-restricted', master_oid: 'M-root', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('start', 'START'), step('ui-1', 'USER_INTERACTION'), step('end', 'END')],
  connections: [
    { from_step_id: 'start', to_step_id: 'ui-1' },
    { from_step_id: 'ui-1', to_step_id: 'end' },
  ],
};

interface SeededInstance { id: string; workCenterId: string; }
interface SeededRestrictedInstance extends SeededInstance { roleId: string; }

async function seedQueued(db: TestDb, spec: unknown, oid: string): Promise<SeededInstance> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id };
}

/** Same shape as seedQueued, plus a workflow_node + workflow_allowed_role row restricting the
 *  root node to a fresh role (named roleName) — reused across the eligibility-guard cases. */
async function seedRestrictedQueued(db: TestDb, spec: typeof RESTRICTED_SPEC, oid: string, roleName: string): Promise<SeededRestrictedInstance> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: spec.master_oid, name: 'root', depth: 0 }).returning();
  const [roleRow] = await db.insert(role).values({ name: roleName }).returning();
  await db.insert(workflowAllowedRole).values({ workflowId: wf.id, workflowNodeId: node.id, roleId: roleRow.id });
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id, roleId: roleRow.id };
}

async function stepRow(db: TestDb, instanceId: string, stepOid: string): Promise<{ state: string } | undefined> {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r) => r.stepOid === stepOid);
}

async function instanceRow(db: TestDb, instanceId: string): Promise<{ status: string }> {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

/** The single 'offered' instance_assignment row for this instance (every spec here parks at
 *  most one step at a time). */
async function offeredAssignmentId(db: TestDb, instanceId: string): Promise<string> {
  const rows = await db.select({ id: instanceAssignment.id, status: instanceAssignment.status })
    .from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(eq(stepInstance.workflowInstanceId, instanceId));
  const offered = rows.find((r) => r.status === 'offered');
  if (!offered) throw new Error(`no offered assignment for instance ${instanceId}`);
  return offered.id;
}

async function assignmentRow(db: TestDb, id: string) {
  const [row] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, id));
  return row;
}

// ── 1. claim happy path + repeat claim ──

test('claim happy path: 200, row claimed with my resolvedRoleId; repeat claim -> 409', async () => {
  const { db, app, cookieFor, seedOperator, grantRoles, deps, close } = await makeApi();
  const wi = await seedRestrictedQueued(db, RESTRICTED_SPEC, 'wf-restricted-happy', 'Inspector');
  await pumpUntilQuiet(db, deps);
  const userId = await seedOperator('op-claim@example.com', wi.workCenterId);
  await grantRoles(userId, wi.workCenterId, [wi.roleId]);
  const cookie = await cookieFor('op-claim@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const res = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(200);
  const row = await assignmentRow(db, assignmentId);
  expect(row.status).toBe('claimed');
  expect(row.assignedUserId).toBe(userId);
  expect(row.claimedAt).not.toBeNull();
  expect(row.resolvedRoleId).toBe(wi.roleId);

  const res2 = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(res2.status).toBe(409);
  await close();
});

// ── 2. claim race: userA wins, userB loses ──

test('claim race: userA claims first; userB\'s claim on the same offer -> 409', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-race');
  await pumpUntilQuiet(db, deps);
  const userAId = await seedOperator('op-race-a@example.com', wi.workCenterId);
  await seedOperator('op-race-b@example.com', wi.workCenterId);
  const cookieA = await cookieFor('op-race-a@example.com');
  const cookieB = await cookieFor('op-race-b@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const resA = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie: cookieA } });
  expect(resA.status).toBe(200);
  const resB = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie: cookieB } });
  expect(resB.status).toBe(409);

  const row = await assignmentRow(db, assignmentId);
  expect(row.assignedUserId).toBe(userAId);
  await close();
});

// ── 3. claim eligibility: no matching role, and a role revoked between offer and claim ──

test('claim eligibility: WC member with no matching role -> 403', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedRestrictedQueued(db, RESTRICTED_SPEC, 'wf-restricted-norole', 'Inspector');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-norole@example.com', wi.workCenterId); // WC member, no matching role row
  const cookie = await cookieFor('op-norole@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const res = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(403);
  await close();
});

test('claim eligibility: role revoked after the offer -> 403 (live re-check, not the stale snapshot)', async () => {
  const { db, app, cookieFor, seedOperator, grantRoles, deps, close } = await makeApi();
  const wi = await seedRestrictedQueued(db, RESTRICTED_SPEC, 'wf-restricted-revoked', 'Inspector');
  await pumpUntilQuiet(db, deps);
  const userId = await seedOperator('op-revoked@example.com', wi.workCenterId);
  await grantRoles(userId, wi.workCenterId, [wi.roleId]);
  const cookie = await cookieFor('op-revoked@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  // Revoke the role AFTER the offer was made but BEFORE the claim attempt.
  await db.delete(workCenterUserRole).where(and(eq(workCenterUserRole.userId, userId), eq(workCenterUserRole.roleId, wi.roleId)));

  const res = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(403);
  await close();
});

test('claim eligibility: the role held in ANOTHER work center does not count here -> 403', async () => {
  const { db, app, cookieFor, seedOperator, grantRoles, deps, close } = await makeApi();
  const wi = await seedRestrictedQueued(db, RESTRICTED_SPEC, 'wf-restricted-elsewhere', 'Inspector');
  await pumpUntilQuiet(db, deps);
  const [otherWc] = await db.insert(workCenter).values({ name: `wc-other-${Math.random()}` }).returning();
  const userId = await seedOperator('op-elsewhere@example.com', wi.workCenterId);
  await db.insert(workCenterUser).values({ workCenterId: otherWc.id, userId });
  await grantRoles(userId, otherWc.id, [wi.roleId]);       // Inspector — but only over there
  const cookie = await cookieFor('op-elsewhere@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const res = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(403);
  await close();
});

// ── 4. release ──

test('release: unclaimed -> 409; non-claimant -> 409; claimant -> 200 with fields cleared', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-release');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-release-a@example.com', wi.workCenterId);
  await seedOperator('op-release-b@example.com', wi.workCenterId);
  const cookieA = await cookieFor('op-release-a@example.com');
  const cookieB = await cookieFor('op-release-b@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const resUnclaimed = await app.request(`/api/assignments/${assignmentId}/release`, { method: 'POST', headers: { cookie: cookieA } });
  expect(resUnclaimed.status).toBe(409);

  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie: cookieA } });
  expect(claimRes.status).toBe(200);

  const resWrongUser = await app.request(`/api/assignments/${assignmentId}/release`, { method: 'POST', headers: { cookie: cookieB } });
  expect(resWrongUser.status).toBe(409);
  let row = await assignmentRow(db, assignmentId);
  expect(row.status).toBe('claimed'); // untouched by the rejected release

  const resOk = await app.request(`/api/assignments/${assignmentId}/release`, { method: 'POST', headers: { cookie: cookieA } });
  expect(resOk.status).toBe(200);
  row = await assignmentRow(db, assignmentId);
  expect(row.status).toBe('offered');
  expect(row.assignedUserId).toBeNull();
  expect(row.claimedAt).toBeNull();
  expect(row.resolvedRoleId).toBeNull();
  await close();
});

// ── 5. submit complete ──

test('submit complete: claim a fieldless USER_INTERACTION step, submit {kind:"complete"} -> 200; step/assignment/instance complete', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-complete');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-complete@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-complete@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(claimRes.status).toBe(200);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'complete' }),
  });
  expect(res.status).toBe(200);

  const step = await stepRow(db, wi.id, 'ui-1');
  expect(step?.state).toBe('COMPLETED');
  const assignment = await assignmentRow(db, assignmentId);
  expect(assignment.status).toBe('completed');
  const instance = await instanceRow(db, wi.id);
  expect(instance.status).toBe('completed');
  await close();
});

// ── 6. submit decision ──

test('submit decision: YES_NO {kind:"decision", value:"yes"} routes the yes branch only', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, YESNO_SPEC, 'wf-decision');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-decision@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-decision@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(claimRes.status).toBe(200);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'decision', value: 'yes' }),
  });
  expect(res.status).toBe(200);

  const yesEnd = await stepRow(db, wi.id, 'end-yes');
  expect(yesEnd?.state).toBe('COMPLETED');
  const noEnd = await stepRow(db, wi.id, 'end-no');
  expect(noEnd).toBeUndefined(); // the no-branch never activated
  const instance = await instanceRow(db, wi.id);
  expect(instance.status).toBe('completed');
  await close();
});

// ── 6b. submit validation: decision value must be yes/no; kind<->step-type pairing ──
//
// Review fix (Important 1 + 2): the route used to trust `body.value`/`body.kind` verbatim.
// {kind:'decision', value:'fail'} would have reached submitCore as a raw `action:'fail'` (driving
// failStep against a running instance); {kind:'complete'|'submit'} against a YES_NO step mapped to
// action:'submit' with no button_output — the exact "every outgoing connection fires" bug the
// button_output fix (case 6, above) closes for the decision path, still reachable through the
// wrong kind.

test('submit validation: decision value other than yes/no -> 400; instance/step untouched', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, YESNO_SPEC, 'wf-decision-badvalue');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-decision-bad@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-decision-bad@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(claimRes.status).toBe(200);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'decision', value: 'fail' }),
  });
  expect(res.status).toBe(400);

  const instance = await instanceRow(db, wi.id);
  expect(instance.status).toBe('running'); // never reached submitUserAction
  const gate = await stepRow(db, wi.id, 'gate');
  expect(gate?.state).toBe('WAITING_USER'); // still parked, untouched
  await close();
});

test('submit validation: {kind:"complete"} against a YES_NO step -> 400; neither branch materializes', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, YESNO_SPEC, 'wf-decision-wrongkind');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-decision-wrongkind@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-decision-wrongkind@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(claimRes.status).toBe(200);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'complete' }),
  });
  expect(res.status).toBe(400);

  expect(await stepRow(db, wi.id, 'end-yes')).toBeUndefined();
  expect(await stepRow(db, wi.id, 'end-no')).toBeUndefined();
  const instance = await instanceRow(db, wi.id);
  expect(instance.status).toBe('running');
  await close();
});

test('submit validation: {kind:"decision"} against a non-YES_NO (USER_INTERACTION) step -> 400', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-decision-nonyesno');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-decision-nonyesno@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-decision-nonyesno@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(claimRes.status).toBe(200);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'decision', value: 'yes' }),
  });
  expect(res.status).toBe(400);
  const step = await stepRow(db, wi.id, 'ui-1');
  expect(step?.state).toBe('WAITING_USER');
  await close();
});

test('submit happy path: {kind:"submit", values} completes a fieldless USER_INTERACTION step', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-submit-values');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-submit-values@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-submit-values@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(claimRes.status).toBe(200);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'submit', values: { note: 'ok' } }),
  });
  expect(res.status).toBe(200);
  const step = await stepRow(db, wi.id, 'ui-1');
  expect(step?.state).toBe('COMPLETED');
  await close();
});

test('submit: an unrecognized kind -> 400', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-badkind');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-badkind@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-badkind@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'bogus' }),
  });
  expect(res.status).toBe(400);
  await close();
});

// ── 7. submit guards: NOT_CLAIMANT, NOT_RUNNING ──

test('submit guard: not my claim -> 409 { code: "NOT_CLAIMANT" }', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-guard-claimant');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-guard-a@example.com', wi.workCenterId);
  await seedOperator('op-guard-b@example.com', wi.workCenterId);
  const cookieA = await cookieFor('op-guard-a@example.com');
  const cookieB = await cookieFor('op-guard-b@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie: cookieA } });
  expect(claimRes.status).toBe(200);

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookieB), body: JSON.stringify({ kind: 'complete' }),
  });
  expect(res.status).toBe(409);
  const body = await res.json() as { code?: string };
  expect(body.code).toBe('NOT_CLAIMANT');
  await close();
});

test('submit guard: instance paused -> 409 { code: "NOT_RUNNING" }', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-guard-paused');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-guard-paused@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-guard-paused@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);
  const claimRes = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(claimRes.status).toBe(200);

  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');

  const res = await app.request(`/api/assignments/${assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ kind: 'complete' }),
  });
  expect(res.status).toBe(409);
  const body = await res.json() as { code?: string };
  expect(body.code).toBe('NOT_RUNNING');
  await close();
});

// ── 8. claim on a non-member work center ──

test('claim on a non-member work center -> 403', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-nonmember');
  await pumpUntilQuiet(db, deps);
  await seedOperator('op-nonmember-claim@example.com'); // deliberately no work_center_user row
  const cookie = await cookieFor('op-nonmember-claim@example.com');
  const assignmentId = await offeredAssignmentId(db, wi.id);

  const res = await app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } });
  expect(res.status).toBe(403);
  await close();
});

// ── released_from_user_id marker + sole-candidate bounce guard (spec 2026-08-17 D13) ──

test('release stamps released_from_user_id; a fresh claim clears it', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-marker');
  await pumpUntilQuiet(db, deps);
  const userId = await seedOperator('op-marker@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-marker@example.com');
  const id = await offeredAssignmentId(db, wi.id);
  expect((await app.request(`/api/assignments/${id}/claim`, { method: 'POST', headers: jsonHeaders(cookie) })).status).toBe(200);
  expect((await app.request(`/api/assignments/${id}/release`, { method: 'POST', headers: jsonHeaders(cookie) })).status).toBe(200);
  let row = await assignmentRow(db, id);
  expect(row.status).toBe('offered');
  expect(row.releasedFromUserId).toBe(userId);
  expect((await app.request(`/api/assignments/${id}/claim`, { method: 'POST', headers: jsonHeaders(cookie) })).status).toBe(200);
  row = await assignmentRow(db, id);
  expect(row.releasedFromUserId).toBeNull();
  await close();
});

test('a released step never bounces back to its sole online releaser — release sweep AND later presence transitions stay blocked', async () => {
  const { db, app, cookieFor, seedOperator, deps, close } = await makeApi();
  const wi = await seedQueued(db, UI_SPEC, 'wf-bounce');
  await db.update(workCenter).set({ autoClaim: true }).where(eq(workCenter.id, wi.workCenterId));
  await pumpUntilQuiet(db, deps);
  const userId = await seedOperator('op-bounce@example.com', wi.workCenterId);
  const cookie = await cookieFor('op-bounce@example.com');
  // Arrival sweep claims the parked offer to the sole operator.
  await app.request('/api/presence', { method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wi.workCenterId }) });
  const id = await offeredAssignmentId(db, wi.id).catch(async () => {
    // After the sweep there is no offered row; find the claimed one instead.
    const rows = await db.select({ id: instanceAssignment.id }).from(instanceAssignment)
      .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
      .where(eq(stepInstance.workflowInstanceId, wi.id));
    return rows[0].id;
  });
  let row = await assignmentRow(db, id);
  expect(row.status).toBe('claimed');
  expect(row.assignedUserId).toBe(userId);
  // Release: the route's own sweep runs with the marker set -> must NOT reclaim.
  expect((await app.request(`/api/assignments/${id}/release`, { method: 'POST', headers: jsonHeaders(cookie) })).status).toBe(200);
  row = await assignmentRow(db, id);
  expect(row.status).toBe('offered');
  expect(row.releasedFromUserId).toBe(userId);
  // A fresh presence transition (re-entering the WC) must stay blocked too.
  await app.request('/api/presence', { method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify({ workCenterId: wi.workCenterId }) });
  row = await assignmentRow(db, id);
  expect(row.status).toBe('offered');
  await close();
});
