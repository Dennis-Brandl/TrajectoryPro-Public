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
import { expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  workCenter, workflow, workflowInstance, instanceAssignment, stepInstance, appUser, workCenterUser,
  workflowNode, workflowAllowedRole, role, workCenterUserRole, wcResource, wcValueProperty,
} from 'mission-control-db/src/db/schema/index';
import { makeTestDb } from './helpers/db.js';
import { testDeps } from './helpers/pump.js';
import { createInternalApp } from '../src/api/internal.js';
import { loadConfig } from '../src/config.js';
import { OPERATOR_CHANGE_CHANNEL } from '../src/core/reconcile.js';

const SPEC = { local_id: 'wf', oid: 'wf-int', version: '1.0.0', last_modified_date: '2026-01-01', steps: [], connections: [] };

async function seed(db: any, status: string): Promise<string> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: 'wf-int', name: 'wf-int', version: '1.0.0', state: 'Approved', specJsonb: SPEC }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status,
    specJsonb: SPEC, runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'wf-int', masterOid: 'wf-int',
    masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi.id;
}

function makeApp(db: any, token: string | undefined) {
  const deps = testDeps({ config: loadConfig({ DATABASE_URL: 'unused', SCRIPT_TIMEOUT_MS: '200', ...(token !== undefined ? { ENGINE_INTERNAL_TOKEN: token } : {}) } as any) });
  return createInternalApp(db, deps, null);
}
const post = (app: any, path: string, token?: string) =>
  app.request(path, { method: 'POST', headers: token ? { 'x-internal-token': token } : {} });

test('fail-closed: unset token -> 401 even with a header; wrong token -> 401', async () => {
  const { db, close } = await makeTestDb();
  const id = await seed(db, 'running');
  const closed = makeApp(db, undefined);
  const closedRes = await post(closed, `/internal/instances/${id}/pause`, 'anything');
  expect(closedRes.status).toBe(401);
  expect(((await closedRes.json()) as any).error.code).toBe('UNAUTHORIZED');
  const open = makeApp(db, 'secret-1');
  expect((await post(open, `/internal/instances/${id}/pause`, 'wrong')).status).toBe(401);
  expect((await post(open, `/internal/instances/${id}/pause`)).status).toBe(401);
  // 401 must short-circuit BEFORE any state change:
  const [row] = await db.select({ status: workflowInstance.status }).from(workflowInstance).where(eq(workflowInstance.id, id));
  expect(row.status).toBe('running');
  await close();
});

test('four controls: happy path writes the transitional status', async () => {
  const { db, close } = await makeTestDb();
  const app = makeApp(db, 'secret-1');
  for (const [verb, from, to] of [
    ['pause', 'running', 'pausing'], ['resume', 'paused', 'resuming'],
    ['stop', 'running', 'stopping'], ['abort', 'running', 'aborting'],
  ] as const) {
    const id = await seed(db, from);
    const res = await post(app, `/internal/instances/${id}/${verb}`, 'secret-1');
    expect(res.status).toBe(200);
    const [row] = await db.select({ status: workflowInstance.status }).from(workflowInstance).where(eq(workflowInstance.id, id));
    expect(row.status).toBe(to);
  }
  await close();
});

test('illegal state -> 409 with RUNTIME_INVALID_STATE; unknown/malformed id -> 404', async () => {
  const { db, close } = await makeTestDb();
  const app = makeApp(db, 'secret-1');
  const id = await seed(db, 'completed');
  const res = await post(app, `/internal/instances/${id}/pause`, 'secret-1');
  expect(res.status).toBe(409);
  expect(((await res.json()) as any).error.code).toBe('RUNTIME_INVALID_STATE');
  expect((await post(app, '/internal/instances/00000000-0000-0000-0000-000000000000/pause', 'secret-1')).status).toBe(404);
  expect((await post(app, '/internal/instances/not-a-uuid/pause', 'secret-1')).status).toBe(404);
  await close();
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function seedClaimedAssignment(db: any, instId: string, wcId: string, userId: string) {
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: instId, nodeOid: 'wf-int', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [a] = await db.insert(instanceAssignment).values({
    stepInstanceId: step.id, workCenterId: wcId, status: 'claimed',
    assignedUserId: userId, claimedAt: new Date(),
  }).returning();
  return a.id;
}

test('force-release: claimed -> offered, claimant cleared, hub notified; 409 when not claimed; 404 unknown', async () => {
  const { db, client, close } = await makeTestDb();
  // seed() from Task 4 returns the instance id; re-select its workCenterId for the assignment.
  const id = await seed(db, 'running');
  const [wi] = await db.select({ wcId: workflowInstance.workCenterId }).from(workflowInstance).where(eq(workflowInstance.id, id));
  const [user] = await db.insert(appUser).values({ email: `op-${Math.random()}@x.dev`, displayName: 'Op' }).returning();
  const aId = await seedClaimedAssignment(db, id, wi.wcId, user.id);

  // Real PGlite LISTEN (mirrors api-events.test.ts's Task-5-review pin): proves the
  // pg_notify(OPERATOR_CHANGE_CHANNEL, workCenterId) half of the notify pair actually fires
  // with the work-center id as payload, not just that the fake hub was called.
  const received: string[] = [];
  await client.listen(OPERATOR_CHANGE_CHANNEL, (payload: string) => { received.push(payload); });

  const notified: string[] = [];
  const hub = { notifyWorkCenter: (wcId: string) => notified.push(wcId) } as any;
  const deps = testDeps({ config: loadConfig({ DATABASE_URL: 'unused', SCRIPT_TIMEOUT_MS: '200', ENGINE_INTERNAL_TOKEN: 'secret-1' } as any) });
  const app = createInternalApp(db, deps, hub);

  const res = await post(app, `/internal/assignments/${aId}/force-release`, 'secret-1');
  expect(res.status).toBe(200);
  const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, aId));
  expect(a.status).toBe('offered');
  expect(a.assignedUserId).toBeNull();
  expect(a.claimedAt).toBeNull();
  expect(a.resolvedRoleId).toBeNull();
  expect(notified).toEqual([wi.wcId]);

  await waitFor(() => received.length > 0);
  expect(received).toEqual([wi.wcId]);

  // Second call: no longer claimed -> 409, and no duplicate hub notify or NOTIFY.
  expect((await post(app, `/internal/assignments/${aId}/force-release`, 'secret-1')).status).toBe(409);
  expect(notified).toHaveLength(1);
  // Settle tick: prove no second NOTIFY landed, rather than merely not-yet-delivered —
  // without this, an undelivered notification would pass the same assertion.
  await new Promise((r) => setTimeout(r, 50));
  expect(received).toEqual([wi.wcId]);
  const unknownRes = await post(app, '/internal/assignments/00000000-0000-0000-0000-000000000000/force-release', 'secret-1');
  expect(unknownRes.status).toBe(404);
  expect(((await unknownRes.json()) as any).error.code).toBe('ASSIGNMENT_NOT_FOUND');
  await close();
});

test('force-release stamps released_from_user_id with the evicted claimant', async () => {
  const { db, close } = await makeTestDb();
  const app = makeApp(db, 'secret-1');
  const id = await seed(db, 'running');
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: id, nodeOid: 'rt_1', stepOid: 'ui-1', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [wi] = await db.select({ wcId: workflowInstance.workCenterId }).from(workflowInstance).where(eq(workflowInstance.id, id));
  const [victim] = await db.insert(appUser).values({ email: `victim-${Math.random()}@t.test`, displayName: 'V' }).returning();
  const [a] = await db.insert(instanceAssignment).values({
    stepInstanceId: step.id, workCenterId: wi.wcId, status: 'claimed', assignedUserId: victim.id, claimedAt: new Date(),
  }).returning();
  const res = await post(app, `/internal/assignments/${a.id}/force-release`, 'secret-1');
  expect(res.status).toBe(200);
  const [row] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, a.id));
  expect(row.status).toBe('offered');
  expect(row.assignedUserId).toBeNull();
  expect(row.releasedFromUserId).toBe(victim.id);
  await close();
});

const postJson = (app: any, path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-internal-token': token } : {}) },
    body: JSON.stringify(body),
  });

async function seedOffer(db: any): Promise<{ aId: string; wcId: string; memberId: string; outsiderId: string }> {
  const wiId = await seed(db, 'running');
  const [wi] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wiId));
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: wiId, nodeOid: SPEC.oid, stepOid: 's-ui', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [member] = await db.insert(appUser).values({ email: `op-${Math.random()}@t.test`, displayName: 'Op' }).returning();
  const [outsider] = await db.insert(appUser).values({ email: `x-${Math.random()}@t.test`, displayName: 'X' }).returning();
  await db.insert(workCenterUser).values({ workCenterId: wi.workCenterId, userId: member.id });
  const [a] = await db.insert(instanceAssignment).values({
    stepInstanceId: step.id, workCenterId: wi.workCenterId, status: 'offered',
  }).returning();
  return { aId: a.id, wcId: wi.workCenterId, memberId: member.id, outsiderId: outsider.id };
}

test('assign: offered -> claimed for a member; audit + marker cleared; notify fires', async () => {
  const { db, client, close } = await makeTestDb();
  const { aId, memberId, wcId } = await seedOffer(db);
  // Pre-stamp the D13 marker to prove assign clears it.
  await db.update(instanceAssignment).set({ releasedFromUserId: memberId }).where(eq(instanceAssignment.id, aId));

  // Real PGlite LISTEN (mirrors the force-release test above): proves the
  // pg_notify(OPERATOR_CHANGE_CHANNEL, workCenterId) half of the notify pair actually fires
  // with the work-center id as payload, not just that the fake hub was called.
  const received: string[] = [];
  await client.listen(OPERATOR_CHANGE_CHANNEL, (payload: string) => { received.push(payload); });

  const notified: string[] = [];
  const hub = { notifyWorkCenter: (id: string) => notified.push(id) } as any;
  const deps = testDeps({ config: loadConfig({ DATABASE_URL: 'unused', SCRIPT_TIMEOUT_MS: '200', ENGINE_INTERNAL_TOKEN: 'secret-1' } as any) });
  const app = createInternalApp(db, deps, hub);

  const res = await postJson(app, `/internal/assignments/${aId}/assign`, { userId: memberId }, 'secret-1');
  expect(res.status).toBe(200);
  const [row] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, aId));
  expect(row.status).toBe('claimed');
  expect(row.assignedUserId).toBe(memberId);
  expect(row.claimedAt).not.toBeNull();
  expect(row.releasedFromUserId).toBeNull();
  expect(row.dispatchReason).toBe('commander_assign');
  expect(notified).toEqual([wcId]);

  await waitFor(() => received.length > 0);
  expect(received).toEqual([wcId]);
  await close();
});

test('assign guards: non-member 409 USER_NOT_ELIGIBLE; claimed 409 ASSIGNMENT_NOT_OFFERED; 404; 400', async () => {
  const { db, close } = await makeTestDb();
  const { aId, memberId, outsiderId } = await seedOffer(db);
  const app = makeApp(db, 'secret-1');

  const nonMember = await postJson(app, `/internal/assignments/${aId}/assign`, { userId: outsiderId }, 'secret-1');
  expect(nonMember.status).toBe(409);
  expect(((await nonMember.json()) as any).error.code).toBe('USER_NOT_ELIGIBLE');

  expect((await postJson(app, `/internal/assignments/${aId}/assign`, { userId: memberId }, 'secret-1')).status).toBe(200);
  const again = await postJson(app, `/internal/assignments/${aId}/assign`, { userId: memberId }, 'secret-1');
  expect(again.status).toBe(409);
  expect(((await again.json()) as any).error.code).toBe('ASSIGNMENT_NOT_OFFERED');

  expect((await postJson(app, '/internal/assignments/00000000-0000-0000-0000-000000000000/assign', { userId: memberId }, 'secret-1')).status).toBe(404);
  expect((await postJson(app, `/internal/assignments/${aId}/assign`, { userId: 'not-a-uuid' }, 'secret-1')).status).toBe(400);
  expect((await postJson(app, `/internal/assignments/${aId}/assign`, { userId: memberId })).status).toBe(401); // token gate
  await close();
});

async function seedRoleRestrictedOffer(db: any): Promise<{
  aId: string; wcId: string; roleId: string; memberWithRoleId: string; memberWithoutRoleId: string;
}> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  // Role-restriction idiom mirrored from mission-control-db's runtime/assignments.test.ts
  // seedWorkflow: the step's spec node carries a master_oid, a workflow_node row is keyed
  // by that master_oid, and a workflow_allowed_role row links the node to a role —
  // resolveStepAllowedRoles/masterNodeOidFor (mission-control-db/src/runtime/assignments.ts)
  // walk exactly this shape.
  const roleSpec = { local_id: 'wf', oid: 'rt_1', master_oid: 'M-root', version: '1.0.0', last_modified_date: '2026-01-01', steps: [], connections: [] };
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: 'wf-role', name: 'wf-role', version: '1.0.0', state: 'Approved', specJsonb: roleSpec }).returning();
  const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'M-root', name: 'root', depth: 0 }).returning();
  const [r] = await db.insert(role).values({ name: `role-${Math.random()}` }).returning();
  await db.insert(workflowAllowedRole).values({ workflowId: wf.id, workflowNodeId: node.id, roleId: r.id });
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running',
    specJsonb: roleSpec, runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'wf-role', masterOid: 'wf-role',
    masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: wi.id, nodeOid: roleSpec.oid, stepOid: 's-role', stepType: 'USER_INTERACTION', state: 'WAITING_USER',
  }).returning();
  const [withRole] = await db.insert(appUser).values({ email: `wr-${Math.random()}@t.test`, displayName: 'WithRole' }).returning();
  const [withoutRole] = await db.insert(appUser).values({ email: `nr-${Math.random()}@t.test`, displayName: 'NoRole' }).returning();
  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: withRole.id });
  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: withoutRole.id });
  await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: withRole.id, roleId: r.id });
  const [a] = await db.insert(instanceAssignment).values({
    stepInstanceId: step.id, workCenterId: wc.id, status: 'offered', allowedRoleIds: [r.id],
  }).returning();
  return { aId: a.id, wcId: wc.id, roleId: r.id, memberWithRoleId: withRole.id, memberWithoutRoleId: withoutRole.id };
}

test('assign: role-restricted step — non-role member 409 USER_NOT_ELIGIBLE; role holder 200 with resolvedRoleId set', async () => {
  const { db, close } = await makeTestDb();
  const { aId, roleId, memberWithRoleId, memberWithoutRoleId } = await seedRoleRestrictedOffer(db);
  const app = makeApp(db, 'secret-1');

  const denied = await postJson(app, `/internal/assignments/${aId}/assign`, { userId: memberWithoutRoleId }, 'secret-1');
  expect(denied.status).toBe(409);
  expect(((await denied.json()) as any).error.code).toBe('USER_NOT_ELIGIBLE');
  // Still offered — the role guard short-circuits before the claiming transaction runs.
  const [afterDenied] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, aId));
  expect(afterDenied.status).toBe('offered');

  const granted = await postJson(app, `/internal/assignments/${aId}/assign`, { userId: memberWithRoleId }, 'secret-1');
  expect(granted.status).toBe(200);
  const [row] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, aId));
  expect(row.status).toBe('claimed');
  expect(row.assignedUserId).toBe(memberWithRoleId);
  expect(row.resolvedRoleId).toBe(roleId);

  await close();
});

/** Mirrors the operator-API test harness's grantRoles (test/helpers/api.ts) — this file seeds
 *  its own raw db rather than going through that harness's better-auth/app stack. */
async function grantRoles(db: any, userId: string, wcId: string, roleIds: string[]): Promise<void> {
  await db.insert(workCenterUserRole).values(roleIds.map((roleId) => ({ workCenterId: wcId, userId, roleId })));
}

test('assign: role-restricted step — a member who holds the role only in ANOTHER work center is not eligible (role check is scoped, spec 2026-09-06)', async () => {
  const { db, close } = await makeTestDb();
  const { aId, wcId, roleId } = await seedRoleRestrictedOffer(db);
  const [otherWc] = await db.insert(workCenter).values({ name: `wc-other-${Math.random()}` }).returning();
  const [user] = await db.insert(appUser).values({ email: `elsewhere-${Math.random()}@t.test`, displayName: 'Elsewhere' }).returning();
  await db.insert(workCenterUser).values({ workCenterId: wcId, userId: user.id });        // member of the offer's own WC
  await db.insert(workCenterUser).values({ workCenterId: otherWc.id, userId: user.id });  // AND of the other WC
  await grantRoles(db, user.id, otherWc.id, [roleId]);                                    // role held only over there
  const app = makeApp(db, 'secret-1');

  const res = await postJson(app, `/internal/assignments/${aId}/assign`, { userId: user.id }, 'secret-1');
  expect(res.status).toBe(409);
  expect(((await res.json()) as any).error.code).toBe('USER_NOT_ELIGIBLE');
  const [row] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, aId));
  expect(row.status).toBe('offered');

  await close();
});

async function seedWc(db: any): Promise<string> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  return wc.id as string;
}
const ACTOR = '99999999-9999-4999-8999-999999999999';

test('operator verbs: fail closed like every /internal route; malformed ids 404; missing actor 400', async () => {
  const { db, close } = await makeTestDb();
  const wc = await seedWc(db);
  expect((await postJson(makeApp(db, undefined), `/internal/work-centers/${wc}/resources/release`, { name: 'R', actorUserId: ACTOR }, 'x')).status).toBe(401);
  const app = makeApp(db, 'secret-1');
  expect((await postJson(app, '/internal/work-centers/not-a-uuid/resources/release', { name: 'R', actorUserId: ACTOR }, 'secret-1')).status).toBe(404);
  const r400 = await postJson(app, `/internal/work-centers/${wc}/resources/release`, { name: 'R' }, 'secret-1');
  expect(r400.status).toBe(400);
  expect(((await r400.json()) as any).error.code).toBe('VALIDATION');
  expect((await postJson(app, `/internal/work-centers/${wc}/resources/explode`, { name: 'R', actorUserId: ACTOR }, 'secret-1')).status).toBe(404); // unknown verb = no route
  await close();
});

test('work-center release on a wedged row → 200 and in_use 0; unknown resource 404; nothing to release 409', async () => {
  const { db, close } = await makeTestDb();
  const wc = await seedWc(db);
  await db.insert(wcResource).values({ workCenterId: wc, name: 'Wedged', resourceType: 'binary exclusive use', inUse: 1, poolNames: [], availableNames: [] });
  const app = makeApp(db, 'secret-1');
  const ok = await postJson(app, `/internal/work-centers/${wc}/resources/release`, { name: 'Wedged', actorUserId: ACTOR }, 'secret-1');
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as any).summary).toMatch(/untracked/);
  const [row] = await db.select({ inUse: wcResource.inUse }).from(wcResource).where(eq(wcResource.workCenterId, wc));
  expect(row.inUse).toBe(0);
  const miss = await postJson(app, `/internal/work-centers/${wc}/resources/reset`, { name: 'Nope', actorUserId: ACTOR }, 'secret-1');
  expect([miss.status, ((await miss.json()) as any).error.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
  const again = await postJson(app, `/internal/work-centers/${wc}/resources/release`, { name: 'Wedged', actorUserId: ACTOR }, 'secret-1');
  expect([again.status, ((await again.json()) as any).error.code]).toEqual([409, 'NOTHING_TO_RELEASE']);
  await close();
});

test('value properties: work-center edit stamps updated_by; unknown pair 404; instance route 404 on an unknown id', async () => {
  const { db, close } = await makeTestDb();
  const wc = await seedWc(db);
  const [user] = await db.insert(appUser).values({ email: `op-${Math.random()}@x.dev`, displayName: 'Op' }).returning();
  await db.insert(wcValueProperty).values({ workCenterId: wc, propertyName: 'Env', entryName: 'Limit', value: '10' });
  const app = makeApp(db, 'secret-1');
  expect((await postJson(app, `/internal/work-centers/${wc}/value-properties`, { propertyName: 'Env', entryName: 'Limit', value: '11', actorUserId: user.id }, 'secret-1')).status).toBe(200);
  const [row] = await db.select().from(wcValueProperty).where(eq(wcValueProperty.workCenterId, wc));
  expect([row.value, row.updatedBy]).toEqual(['11', user.id]);
  expect((await postJson(app, `/internal/work-centers/${wc}/value-properties`, { propertyName: 'Env', entryName: 'Nope', value: '1', actorUserId: user.id }, 'secret-1')).status).toBe(404);
  expect((await postJson(app, `/internal/work-centers/${wc}/value-properties`, { propertyName: 'Env', entryName: 'Limit', actorUserId: user.id }, 'secret-1')).status).toBe(400); // value missing
  const r = await postJson(app, '/internal/instances/00000000-0000-4000-8000-000000000001/value-properties', { key: 'A.B', value: '1', actorUserId: user.id }, 'secret-1');
  expect([r.status, ((await r.json()) as any).error.code]).toEqual([404, 'RUNTIME_NOT_FOUND']);
  await close();
});
