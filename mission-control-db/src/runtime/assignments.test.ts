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

import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import {
  workCenter, workflow, workflowNode, workflowAllowedRole, role, appUser, workCenterUserRole, workCenterUser,
  workflowInstance, stepInstance, instanceAssignment, operatorPresence,
} from '../db/schema/index.js';
import { reconcileAssignments, masterNodeOidFor, resolveStepAllowedRoles, sweepSoleCandidateClaims } from './assignments.js';

// Frozen recipe used by most cases: root spec node 'rt_1' (master_oid 'M-root', unrestricted —
// no allowed-role row on the root workflow_node) and a child spec node 'rt_2' (master_oid
// 'M-child', restricted to roleR via a workflow_allowed_role row on the child workflow_node).
const SPEC_WITH_MASTER = {
  oid: 'rt_1', master_oid: 'M-root', steps: [], connections: [],
  children: [{ oid: 'rt_2', master_oid: 'M-child', steps: [], connections: [] }],
};

// Three levels deep: root -> child -> grandchild, each spec-stamped, for masterNodeOidFor's
// recursive-descent coverage.
const NESTED_SPEC = {
  oid: 'rt_1', master_oid: 'M-root', steps: [], connections: [],
  children: [{
    oid: 'rt_2', master_oid: 'M-child', steps: [], connections: [],
    children: [{ oid: 'rt_3', master_oid: 'M-grand', steps: [], connections: [] }],
  }],
};

// A matched node with no master_oid stamp at all (unstamped legacy child under a stamped root).
const PARTIALLY_UNSTAMPED_SPEC = {
  oid: 'rt_1', master_oid: 'M-root', steps: [], connections: [],
  children: [{ oid: 'rt_2', steps: [], connections: [] }],
};

async function seedWorkflow(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [root] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'M-root', name: 'root', depth: 0 }).returning();
  const [child] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'M-child', parentNodeId: root.id, name: 'child', depth: 1 }).returning();
  const [roleR] = await db.insert(role).values({ name: 'RoleR' }).returning();
  await db.insert(workflowAllowedRole).values({ workflowId: wf.id, workflowNodeId: child.id, roleId: roleR.id });
  return { wc, wf, root, child, roleR };
}

async function seedInstance(db: any, s: { wc: { id: string }; wf: { id: string } }, specJsonb: unknown) {
  const [inst] = await db.insert(workflowInstance).values({
    workflowId: s.wf.id, workCenterId: s.wc.id, triggeredBy: 'manual', status: 'running',
    ...runtimeCols({ specJsonb }),
  }).returning();
  return inst;
}

async function seedStep(db: any, instanceId: string, overrides: Record<string, unknown> = {}) {
  const [step] = await db.insert(stepInstance).values({
    workflowInstanceId: instanceId, nodeOid: 'rt_1', stepOid: `s-${Math.random()}`,
    stepType: 'USER_INTERACTION', state: 'WAITING_USER',
    ...overrides,
  }).returning();
  return step;
}

describe('reconcileAssignments', () => {
  it('creates an offer for a WAITING_USER step with the ancestor-resolved role snapshot', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'rt_2-s1' });

    const T = new Date('2030-01-01T00:00:00Z');
    const res = await reconcileAssignments(db, inst.id, () => T);
    expect(res).toEqual({ changed: true, workCenterId: s.wc.id });

    const rows = await db.select().from(instanceAssignment);
    expect(rows).toHaveLength(1);
    const [a] = rows;
    expect(a.status).toBe('offered');
    expect(a.allowedRoleIds).toEqual([s.roleR.id]);
    expect(a.resolvedRoleId).toBeNull();
    expect(a.dispatchPolicy).toBe('least_queued_steps');
    // Proves the injected clock is actually threaded through, not just `new Date()` inline.
    expect(a.assignedAt).toEqual(T);

    await close();
  });

  it('is idempotent — second call changes nothing', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'rt_2-s1' });

    await reconcileAssignments(db, inst.id, () => new Date());
    const res2 = await reconcileAssignments(db, inst.id, () => new Date());
    expect(res2!.changed).toBe(false);
    expect((await db.select().from(instanceAssignment)).length).toBe(1);

    await close();
  });

  it('treats a missing master_oid (legacy recipe) as unrestricted', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const legacySpec = { oid: 'rt_1', steps: [], connections: [] }; // no master_oid keys anywhere
    const inst = await seedInstance(db, s, legacySpec);
    await seedStep(db, inst.id, { nodeOid: 'rt_1' });

    await reconcileAssignments(db, inst.id, () => new Date());
    const [a] = await db.select().from(instanceAssignment);
    expect(a.allowedRoleIds).toEqual([]);
    expect(a.dispatchReason).toBe('unrestricted: pull-based claim');

    await close();
  });

  it('closes assignments whose steps left the parked states', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    const stepA = await seedStep(db, inst.id, { stepOid: 'a' });
    const stepB = await seedStep(db, inst.id, { stepOid: 'b' });
    const stepC = await seedStep(db, inst.id, { stepOid: 'c' });

    const [aAssign] = await db.insert(instanceAssignment)
      .values({ stepInstanceId: stepA.id, workCenterId: s.wc.id, status: 'offered' }).returning();
    const [bAssign] = await db.insert(instanceAssignment)
      .values({ stepInstanceId: stepB.id, workCenterId: s.wc.id, status: 'claimed' }).returning();
    const [cAssign] = await db.insert(instanceAssignment)
      .values({ stepInstanceId: stepC.id, workCenterId: s.wc.id, status: 'claimed' }).returning();

    await db.update(stepInstance).set({ state: 'COMPLETED' }).where(eq(stepInstance.id, stepA.id));
    await db.update(stepInstance).set({ state: 'CANCELLED' }).where(eq(stepInstance.id, stepB.id));
    // stepC stays WAITING_USER, untouched

    const T = new Date('2030-01-01T00:00:00Z');
    const res = await reconcileAssignments(db, inst.id, () => T);
    expect(res!.changed).toBe(true);

    const [aRow] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, aAssign.id));
    expect(aRow.status).toBe('completed');
    // Proves the injected clock is actually threaded through, not just `new Date()` inline.
    expect(aRow.completedAt).toEqual(T);

    const [bRow] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, bAssign.id));
    expect(bRow.status).toBe('cancelled');
    expect(bRow.completedAt).toEqual(T);

    const [cRow] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, cAssign.id));
    expect(cRow.status).toBe('claimed');
    expect(cRow.completedAt).toBeNull();

    // No new offer was created for the still-live, still-WAITING_USER step C.
    expect((await db.select().from(instanceAssignment)).length).toBe(3);

    await close();
  });

  it('keeps assignments for PAUSED steps (claims and offers survive pause)', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    const step = await seedStep(db, inst.id, { stepOid: 'p' });
    const [assign] = await db.insert(instanceAssignment)
      .values({ stepInstanceId: step.id, workCenterId: s.wc.id, status: 'claimed' }).returning();

    await db.update(stepInstance).set({ state: 'PAUSED' }).where(eq(stepInstance.id, step.id));

    const res = await reconcileAssignments(db, inst.id, () => new Date());
    expect(res!.changed).toBe(false);

    const [row] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, assign.id));
    expect(row.status).toBe('claimed');
    expect(row.completedAt).toBeNull();

    await close();
  });

  it('re-offers a step that cycled: old assignment closed, fresh offer allowed', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    const step = await seedStep(db, inst.id, { stepOid: 'cyc' });
    await db.insert(instanceAssignment)
      .values({ stepInstanceId: step.id, workCenterId: s.wc.id, status: 'claimed' });

    await db.update(stepInstance).set({ state: 'CANCELLED' }).where(eq(stepInstance.id, step.id));
    const res1 = await reconcileAssignments(db, inst.id, () => new Date());
    expect(res1!.changed).toBe(true);

    // Cycle re-entry: the step comes back around to WAITING_USER.
    await db.update(stepInstance).set({ state: 'WAITING_USER' }).where(eq(stepInstance.id, step.id));
    const res2 = await reconcileAssignments(db, inst.id, () => new Date());
    expect(res2!.changed).toBe(true);

    const rows = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r: { status: string }) => r.status === 'cancelled')).toHaveLength(1);
    expect(rows.filter((r: { status: string }) => r.status === 'offered')).toHaveLength(1);

    await close();
  });

  it('records the dispatch suggestion on the offer', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'rt_2-s1' });

    const [user] = await db.insert(appUser).values({ email: `u-${Math.random()}@t.test`, displayName: 'U' }).returning();
    await db.insert(workCenterUser).values({ workCenterId: s.wc.id, userId: user.id, priority: 0 });
    await db.insert(workCenterUserRole).values({ workCenterId: s.wc.id, userId: user.id, roleId: s.roleR.id });
    await db.insert(operatorPresence).values({
      userId: user.id, attendingWorkCenterId: s.wc.id, sessionId: `sess-${Math.random()}`, status: 'online',
    });

    await reconcileAssignments(db, inst.id, () => new Date());
    const [a] = await db.select().from(instanceAssignment);
    expect(a.preferredUserId).toBe(user.id);

    await close();
  });
});

describe('masterNodeOidFor', () => {
  it('finds a stamp two levels deep (root -> child -> grandchild)', () => {
    expect(masterNodeOidFor(NESTED_SPEC, 'rt_3')).toBe('M-grand');
  });

  it('returns null for a matched node with no master_oid stamp (unstamped legacy child)', () => {
    expect(masterNodeOidFor(PARTIALLY_UNSTAMPED_SPEC, 'rt_2')).toBeNull();
  });

  it('returns null for non-object/array input', () => {
    expect(masterNodeOidFor(null, 'rt_1')).toBeNull();
    expect(masterNodeOidFor(42, 'rt_1')).toBeNull();
    expect(masterNodeOidFor([], 'rt_1')).toBeNull();
  });
});

describe('resolveStepAllowedRoles', () => {
  it('fails open to unrestricted when the stamped master_oid has no matching workflow_node (ghost node)', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db); // only 'M-root' and 'M-child' workflow_node rows exist
    const ghostSpec = { oid: 'rt_9', master_oid: 'M-ghost', steps: [], connections: [] };

    const allowed = await resolveStepAllowedRoles(db, {
      workflowId: s.wf.id, specJsonb: ghostSpec, recipeNodeOid: 'rt_9',
    });
    expect(allowed).toEqual([]);

    await close();
  });
});

// ── Auto-claim chains (spec 2026-08-14) ──────────────────────────────────────────────────

async function seedOperator(
  db: any, wcId: string, roleId?: string, presence: 'online' | 'away' | 'none' = 'online',
) {
  const [user] = await db.insert(appUser).values({ email: `u-${Math.random()}@t.test`, displayName: 'U' }).returning();
  await db.insert(workCenterUser).values({ workCenterId: wcId, userId: user.id, priority: 0 });
  if (roleId) await db.insert(workCenterUserRole).values({ workCenterId: wcId, userId: user.id, roleId });
  if (presence !== 'none') {
    await db.insert(operatorPresence).values({
      userId: user.id, attendingWorkCenterId: wcId, sessionId: `sess-${Math.random()}`, status: presence,
    });
  }
  return user;
}

/** A completed prior step in `nodeOid` scope with a completed assignment by `userId` —
 *  the chain-memory seed for most cases below. */
async function seedPriorClaim(db: any, inst: any, wcId: string, userId: string, nodeOid: string) {
  const prior = await seedStep(db, inst.id, { nodeOid, stepOid: `done-${Math.random()}`, state: 'COMPLETED' });
  await db.insert(instanceAssignment).values({
    stepInstanceId: prior.id, workCenterId: wcId, status: 'completed',
    assignedUserId: userId, claimedAt: new Date('2030-01-01T00:00:00Z'),
    completedAt: new Date('2030-01-01T00:05:00Z'),
  });
  return prior;
}

describe('reconcileAssignments auto-claim chains', () => {
  const T = new Date('2030-02-01T00:00:00Z');

  async function chainSetup(autoClaim = true) {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    await db.update(workCenter).set({ autoClaim }).where(eq(workCenter.id, s.wc.id));
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    return { db, close, s, inst };
  }

  it('chain forms: a completed claim in scope auto-claims the next step for the same user', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'next' });

    const res = await reconcileAssignments(db, inst.id, () => T);
    expect(res!.changed).toBe(true);

    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(userA.id);
    expect(a.preferredUserId).toBe(userA.id);
    expect(a.claimedAt).toEqual(T);
    expect(a.assignedAt).toEqual(T);
    expect(a.dispatchPolicy).toBe('auto_claim');
    expect(a.dispatchReason).toBe('auto_claim_chain');
    expect(a.resolvedRoleId).toBeNull(); // rt_1 is unrestricted
    await close();
  });

  it('a still-held (claimed, not completed) step seeds the chain too', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id);
    const held = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'held' });
    await db.insert(instanceAssignment).values({
      stepInstanceId: held.id, workCenterId: s.wc.id, status: 'claimed',
      assignedUserId: userA.id, claimedAt: new Date('2030-01-01T00:00:00Z'),
    });
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(userA.id);
    await close();
  });

  it('child scope isolation: a chain in rt_1 never claims a new rt_2 step', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id, s.roleR.id);
    // A second online role-holder keeps the roleR pool contested (2026-08-17 D11), so this
    // proves chain-scope isolation specifically and isn't masked by the sole-candidate rule.
    await seedOperator(db, s.wc.id, s.roleR.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    const childStep = await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'child-first' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, childStep.id));
    expect(a.status).toBe('offered');
    expect(a.assignedUserId).toBeNull();
    await close();
  });

  it('parallel fan-out: every new step in the scope auto-claims to the chain user (D3)', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    const b1 = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'branch-1' });
    const b2 = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'branch-2' });

    await reconcileAssignments(db, inst.id, () => T);
    for (const step of [b1, b2]) {
      const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
      expect(a.status).toBe('claimed');
      expect(a.assignedUserId).toBe(userA.id);
    }
    await close();
  });

  it('presence guard: an away chain user falls back to a normal offer (D2)', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id, undefined, 'away');
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('offered');
    expect(a.assignedUserId).toBeNull();
    expect(a.dispatchReason).toBe('unrestricted: pull-based claim');
    await close();
  });

  it('presence guard: no presence row at all falls back to a normal offer', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id, undefined, 'none');
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('offered');
    await close();
  });

  it('role guard: a chain user without the scope role falls back to a normal offer', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id); // no roleR
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_2');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('offered');
    await close();
  });

  it('membership guard: a chain user removed from the work center falls back to a normal offer', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    await db.delete(workCenterUser).where(eq(workCenterUser.userId, userA.id));
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('offered');
    await close();
  });

  it('a released offer is never re-stolen: existing offered rows stay untouched (D5)', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    // Simulates the release route's row: back to offered with the claimant nulled and the
    // released_from_user_id marker stamped (spec 2026-08-17 D13). userA is the sole online
    // candidate here, so this now also exercises the sole-candidate third pass's marker
    // guard: without the marker the third pass would legitimately reclaim this row (D11).
    const released = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'released' });
    const [releasedAssign] = await db.insert(instanceAssignment).values({
      stepInstanceId: released.id, workCenterId: s.wc.id, status: 'offered', releasedFromUserId: userA.id,
    }).returning();

    const res = await reconcileAssignments(db, inst.id, () => T);
    expect(res!.changed).toBe(false);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, releasedAssign.id));
    expect(a.status).toBe('offered');
    expect(a.assignedUserId).toBeNull();
    await close();
  });

  it('flag off: identical seed yields a plain offer (regression pin)', async () => {
    const { db, close, s, inst } = await chainSetup(false);
    const userA = await seedOperator(db, s.wc.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('offered');
    await close();
  });

  it('workflow-level override true enables the chain when the work center is off', async () => {
    const { db, close, s, inst } = await chainSetup(false);
    await db.update(workflow).set({ autoClaim: true }).where(eq(workflow.id, s.wf.id));
    const userA = await seedOperator(db, s.wc.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_1');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(userA.id);
    await close();
  });

  it('re-executed scope: a completed assignment whose step was reset to READY is dead memory (review fix)', async () => {
    // Simulates a loop/GOTO re-entering a child workflow: the engine resets the COMPLETED
    // child rows to READY but the run-1 'completed' assignments survive. The child's first
    // run-2 step must be OFFERED (role boundary), not pre-claimed for the run-1 operator.
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id, s.roleR.id);
    // A second online role-holder keeps the roleR pool contested (2026-08-17 D11), so this
    // proves dead chain memory specifically and isn't masked by the sole-candidate rule.
    await seedOperator(db, s.wc.id, s.roleR.id);
    const prior = await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_2');
    await db.update(stepInstance).set({ state: 'READY' }).where(eq(stepInstance.id, prior.id));
    const rerun = await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'rerun-first' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, rerun.id));
    expect(a.status).toBe('offered');
    expect(a.assignedUserId).toBeNull();
    await close();
  });

  it('restricted scope resolves the chain user first matching role into resolvedRoleId', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id, s.roleR.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_2');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(userA.id);
    expect(a.resolvedRoleId).toBe(s.roleR.id);
    expect(a.allowedRoleIds).toEqual([s.roleR.id]);
    await close();
  });

  it('restricted scope: the chain user still auto-claims via their OWN scoped role when a second online role-holder makes the pool contested (D11 cannot fire)', async () => {
    const { db, close, s, inst } = await chainSetup();
    const userA = await seedOperator(db, s.wc.id, s.roleR.id);
    // A second online role-holder keeps the roleR pool contested (2026-08-17 D11), so a pass
    // here proves resolveChainRole itself resolved userA's role — not the sole-candidate path.
    await seedOperator(db, s.wc.id, s.roleR.id);
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_2');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(userA.id);
    expect(a.resolvedRoleId).toBe(s.roleR.id);
    expect(a.dispatchReason).toBe('auto_claim_chain');
    await close();
  });

  it('restricted scope: a chain user who holds the role only in ANOTHER work center is not eligible (role check is scoped, spec 2026-09-06)', async () => {
    const { db, close, s, inst } = await chainSetup();
    const [otherWc] = await db.insert(workCenter).values({ name: `WC-other-${Math.random()}` }).returning();
    const userA = await seedOperator(db, s.wc.id); // member + online in s.wc, but holds no role there
    await db.insert(workCenterUser).values({ workCenterId: otherWc.id, userId: userA.id, priority: 0 });
    await db.insert(workCenterUserRole).values({ workCenterId: otherWc.id, userId: userA.id, roleId: s.roleR.id });
    await seedPriorClaim(db, inst, s.wc.id, userA.id, 'rt_2');
    const next = await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'next' });

    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, next.id));
    expect(a.status).toBe('offered');
    expect(a.assignedUserId).toBeNull();
    await close();
  });
});

// ── Sole-candidate auto-claim (spec 2026-08-17 D11-D17) ─────────────────────────────────

describe('reconcileAssignments sole-candidate auto-claim', () => {
  const T = new Date('2030-03-01T00:00:00Z');

  async function soleSetup(autoClaim = true) {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    await db.update(workCenter).set({ autoClaim }).where(eq(workCenter.id, s.wc.id));
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    return { db, close, s, inst };
  }

  it('insert path: no chain memory + one online member -> claimed with sole-candidate audit', async () => {
    const { db, close, s, inst } = await soleSetup();
    const solo = await seedOperator(db, s.wc.id);            // unrestricted rt_1, online member
    const step = await seedStep(db, inst.id, { stepOid: 'first' });
    const res = await reconcileAssignments(db, inst.id, () => T);
    expect(res!.changed).toBe(true);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(solo.id);
    expect(a.preferredUserId).toBe(solo.id);
    expect(a.claimedAt).toEqual(T);
    expect(a.dispatchPolicy).toBe('auto_claim');
    expect(a.dispatchReason).toBe('auto_claim_sole_candidate');
    expect(a.resolvedRoleId).toBeNull();                     // unrestricted
    await close();
  });

  it('two online members -> plain offer (contested pool)', async () => {
    const { db, close, s, inst } = await soleSetup();
    await seedOperator(db, s.wc.id);
    await seedOperator(db, s.wc.id);
    const step = await seedStep(db, inst.id, { stepOid: 'contested' });
    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
    expect(a.status).toBe('offered');
    expect(a.assignedUserId).toBeNull();
    await close();
  });

  it('an away second member does not contest — the online one is sole and claims', async () => {
    const { db, close, s, inst } = await soleSetup();
    const online = await seedOperator(db, s.wc.id);
    await seedOperator(db, s.wc.id, undefined, 'away');
    const step = await seedStep(db, inst.id, { stepOid: 'away-case' });
    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(online.id);
    await close();
  });

  it('child boundary claims to the sole holder of the child role (RW-15 child case)', async () => {
    const { db, close, s, inst } = await soleSetup();
    const holder = await seedOperator(db, s.wc.id, s.roleR.id);   // holds the child role
    await seedOperator(db, s.wc.id);                              // online member WITHOUT the role
    const step = await seedStep(db, inst.id, { nodeOid: 'rt_2', stepOid: 'child-first' });
    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(holder.id);
    expect(a.resolvedRoleId).toBe(s.roleR.id);
    await close();
  });

  it('chain memory wins over the sole rule and survives a contested pool (D12)', async () => {
    const { db, close, s, inst } = await soleSetup();
    const chainUser = await seedOperator(db, s.wc.id);
    await seedOperator(db, s.wc.id);                              // second online member: no sole candidate
    await seedPriorClaim(db, inst, s.wc.id, chainUser.id, 'rt_1');
    const step = await seedStep(db, inst.id, { nodeOid: 'rt_1', stepOid: 'chained' });
    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(chainUser.id);
    expect(a.dispatchReason).toBe('auto_claim_chain');            // the chain claimed, not the sole rule
    await close();
  });

  it('flag off -> plain offer even for a lone online member', async () => {
    const { db, close, s, inst } = await soleSetup(false);
    await seedOperator(db, s.wc.id);
    const step = await seedStep(db, inst.id, { stepOid: 'flag-off' });
    await reconcileAssignments(db, inst.id, () => T);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.stepInstanceId, step.id));
    expect(a.status).toBe('offered');
    await close();
  });

  it('third pass: an EXISTING offer claims in place when a sole candidate exists', async () => {
    const { db, close, s, inst } = await soleSetup();
    const step = await seedStep(db, inst.id, { stepOid: 'existing' });
    const [offer] = await db.insert(instanceAssignment).values({
      stepInstanceId: step.id, workCenterId: s.wc.id, status: 'offered',
      dispatchPolicy: 'least_queued_steps', dispatchReason: 'no candidate',
    }).returning();
    const solo = await seedOperator(db, s.wc.id);                 // arrives AFTER the offer was born
    const res = await reconcileAssignments(db, inst.id, () => T);
    expect(res!.changed).toBe(true);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, offer.id));
    expect(a.status).toBe('claimed');                              // same row, updated in place
    expect(a.assignedUserId).toBe(solo.id);
    expect(a.dispatchReason).toBe('auto_claim_sole_candidate');
    expect(a.claimedAt).toEqual(T);
    await close();
  });

  it('third pass: a released row never claims back to its releaser; a DIFFERENT sole candidate takes it and the marker clears (D13)', async () => {
    const { db, close, s, inst } = await soleSetup();
    const releaser = await seedOperator(db, s.wc.id);
    const step = await seedStep(db, inst.id, { stepOid: 'released' });
    const [offer] = await db.insert(instanceAssignment).values({
      stepInstanceId: step.id, workCenterId: s.wc.id, status: 'offered', releasedFromUserId: releaser.id,
    }).returning();
    await reconcileAssignments(db, inst.id, () => T);
    let [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, offer.id));
    expect(a.status).toBe('offered');                              // sole candidate IS the releaser -> blocked
    // The releaser leaves; another operator arrives as the new sole candidate.
    await db.delete(operatorPresence).where(eq(operatorPresence.userId, releaser.id));
    const other = await seedOperator(db, s.wc.id);
    await reconcileAssignments(db, inst.id, () => T);
    [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, offer.id));
    expect(a.status).toBe('claimed');
    expect(a.assignedUserId).toBe(other.id);
    expect(a.releasedFromUserId).toBeNull();                       // claiming clears the marker
    await close();
  });

  it('third pass: a PAUSED step\'s offer is never swept (D15)', async () => {
    const { db, close, s, inst } = await soleSetup();
    const step = await seedStep(db, inst.id, { stepOid: 'paused', state: 'PAUSED' });
    const [offer] = await db.insert(instanceAssignment).values({
      stepInstanceId: step.id, workCenterId: s.wc.id, status: 'offered',
    }).returning();
    await seedOperator(db, s.wc.id);
    const res = await reconcileAssignments(db, inst.id, () => T);
    expect(res!.changed).toBe(false);
    const [a] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, offer.id));
    expect(a.status).toBe('offered');
    await close();
  });
});

describe('sweepSoleCandidateClaims', () => {
  const T = new Date('2030-03-02T00:00:00Z');

  it('claims every eligible open offer in the WC, honors per-workflow flag, and is idempotent', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    await db.update(workCenter).set({ autoClaim: true }).where(eq(workCenter.id, s.wc.id));
    // A second workflow in the SAME work center that opts OUT at workflow level.
    const [wfOff] = await db.insert(workflow).values({ oid: 'w-off', name: 'W-off', workCenterId: s.wc.id, specJsonb: {}, autoClaim: false }).returning();
    const instOn = await seedInstance(db, s, SPEC_WITH_MASTER);
    const instOff = await seedInstance(db, { wc: s.wc, wf: wfOff }, SPEC_WITH_MASTER);
    const stepOn = await seedStep(db, instOn.id, { stepOid: 'on' });
    const stepOff = await seedStep(db, instOff.id, { stepOid: 'off' });
    const [offerOn] = await db.insert(instanceAssignment).values({ stepInstanceId: stepOn.id, workCenterId: s.wc.id, status: 'offered' }).returning();
    const [offerOff] = await db.insert(instanceAssignment).values({ stepInstanceId: stepOff.id, workCenterId: s.wc.id, status: 'offered' }).returning();
    const solo = await seedOperator(db, s.wc.id);

    expect(await sweepSoleCandidateClaims(db, s.wc.id, () => T)).toBe(true);
    const [aOn] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, offerOn.id));
    expect(aOn.status).toBe('claimed');
    expect(aOn.assignedUserId).toBe(solo.id);
    expect(aOn.dispatchReason).toBe('auto_claim_sole_candidate');
    const [aOff] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, offerOff.id));
    expect(aOff.status).toBe('offered');                           // workflow-level opt-out governs
    expect(await sweepSoleCandidateClaims(db, s.wc.id, () => T)).toBe(false);  // nothing left
    await close();
  });

  it('returns false untouched when the pool is contested or empty', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    await db.update(workCenter).set({ autoClaim: true }).where(eq(workCenter.id, s.wc.id));
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    const step = await seedStep(db, inst.id, { stepOid: 'sweep-contested' });
    await db.insert(instanceAssignment).values({ stepInstanceId: step.id, workCenterId: s.wc.id, status: 'offered' });
    expect(await sweepSoleCandidateClaims(db, s.wc.id, () => T)).toBe(false);  // nobody online
    await seedOperator(db, s.wc.id);
    await seedOperator(db, s.wc.id);
    expect(await sweepSoleCandidateClaims(db, s.wc.id, () => T)).toBe(false);  // two candidates
    const [a] = await db.select().from(instanceAssignment);
    expect(a.status).toBe('offered');
    await close();
  });
});

describe('released_from_user_id column (migration 0023)', () => {
  it('defaults null, stores a user id, and nulls on user delete', async () => {
    const { db, close } = await makeTestDb();
    const s = await seedWorkflow(db);
    const inst = await seedInstance(db, s, SPEC_WITH_MASTER);
    const step = await seedStep(db, inst.id);
    const [u] = await db.insert(appUser).values({ email: `m23-${Math.random()}@t.test`, displayName: 'U' }).returning();
    const [a] = await db.insert(instanceAssignment)
      .values({ stepInstanceId: step.id, workCenterId: s.wc.id, status: 'offered', releasedFromUserId: u.id }).returning();
    expect(a.releasedFromUserId).toBe(u.id);
    await db.delete(appUser).where(eq(appUser.id, u.id));
    const [after] = await db.select().from(instanceAssignment).where(eq(instanceAssignment.id, a.id));
    expect(after.releasedFromUserId).toBeNull();
    await close();
  });
});
