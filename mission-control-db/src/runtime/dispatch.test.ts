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
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import { workCenter, workflow, role, appUser } from '../db/schema/index.js';
import { workCenterUser, workCenterUserRole } from '../db/schema/work-centers.js';
import { workflowInstance, stepInstance, instanceAssignment, operatorPresence } from '../db/schema/execution.js';
import { eq } from 'drizzle-orm';
import { computeSuggestion, effectiveAutoClaim, listOnlineCandidates } from './dispatch.js';

// `computeSuggestion` takes allowedRoleIds directly (Task 4/5's reconcile loop resolves them
// via resolveAllowedRoles before calling in), so the seed helper no longer needs a node/
// workflow_allowed_role tree — only the candidate-pool ingredients: users, roles, presence,
// work_center_user rows.
async function seed(db: any, policy: string) {
  const [wc] = await db.insert(workCenter).values({ name: 'WC', dispatchPolicy: policy }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [op] = await db.insert(role).values({ name: 'Operator' }).returning();
  const mkUser = async (email: string, prio: number, presence: 'online' | 'away' | null) => {
    const [u] = await db.insert(appUser).values({ email, displayName: email }).returning();
    await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: u.id, priority: prio });
    await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: u.id, roleId: op.id });
    if (presence) await db.insert(operatorPresence).values({ userId: u.id, attendingWorkCenterId: wc.id, sessionId: email, status: presence });
    return u;
  };
  return { wc, wf, op, mkUser };
}

test('unrestricted (no allowed roles) yields a null preference — pure pull-based claim', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'highest_priority');
  const suggestion = await computeSuggestion(db, { workCenterId: s.wc.id, workflowId: s.wf.id, allowedRoleIds: [] });
  expect(suggestion).toEqual({ preferredUserId: null, policy: 'highest_priority', reason: 'unrestricted: pull-based claim' });
  await close();
});

test('no online candidate holding an allowed role yields "no candidate"', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'least_queued_steps');
  await s.mkUser('off@x.io', 0, null); // holds the role but never online
  const suggestion = await computeSuggestion(db, { workCenterId: s.wc.id, workflowId: s.wf.id, allowedRoleIds: [s.op.id] });
  expect(suggestion).toEqual({ preferredUserId: null, policy: 'least_queued_steps', reason: 'no candidate' });
  await close();
});

test('manual policy yields a null preference even with an eligible online candidate', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'manual');
  await s.mkUser('p@x.io', 0, 'online');
  const suggestion = await computeSuggestion(db, { workCenterId: s.wc.id, workflowId: s.wf.id, allowedRoleIds: [s.op.id] });
  expect(suggestion).toEqual({ preferredUserId: null, policy: 'manual', reason: 'manual: pull-based claim' });
  await close();
});

test('highest_priority suggests the online candidate with max work_center_user.priority', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'highest_priority');
  await s.mkUser('low@x.io', 1, 'online');
  const high = await s.mkUser('high@x.io', 9, 'online');
  await s.mkUser('off@x.io', 99, null); // offline -> excluded despite highest priority
  const suggestion = await computeSuggestion(db, { workCenterId: s.wc.id, workflowId: s.wf.id, allowedRoleIds: [s.op.id] });
  expect(suggestion).toEqual({ preferredUserId: high.id, policy: 'highest_priority', reason: 'highest_priority: 9' });
  await close();
});

test('least_queued_steps (default) suggests the candidate with fewest claimed assignments', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'least_queued_steps');
  const busy = await s.mkUser('busy@x.io', 0, 'online');
  const free = await s.mkUser('free@x.io', 0, 'online');
  const [inst] = await db.insert(workflowInstance).values({ workflowId: s.wf.id, workCenterId: s.wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols() }).returning();
  const [pre] = await db.insert(stepInstance).values({ workflowInstanceId: inst.id, nodeOid: 'w', stepOid: 's0', stepType: 'USER_INTERACTION', state: 'WAITING_USER' }).returning();
  // NOTE vocabulary: 'claimed', not the retired 'assigned'.
  await db.insert(instanceAssignment).values({ stepInstanceId: pre.id, workCenterId: s.wc.id, assignedUserId: busy.id, status: 'claimed' });
  const suggestion = await computeSuggestion(db, { workCenterId: s.wc.id, workflowId: s.wf.id, allowedRoleIds: [s.op.id] });
  expect(suggestion).toEqual({ preferredUserId: free.id, policy: 'least_queued_steps', reason: 'least_queued_steps: 0' });
  await close();
});

test('presence gates the suggestion pool: an away or fully absent eligible user is never suggested', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'highest_priority');
  await s.mkUser('away@x.io', 99, 'away'); // eligible role + highest priority, but not online
  await s.mkUser('absent@x.io', 50, null); // eligible role, no presence row at all
  const online = await s.mkUser('online@x.io', 1, 'online'); // lowest priority but the only online candidate
  const suggestion = await computeSuggestion(db, { workCenterId: s.wc.id, workflowId: s.wf.id, allowedRoleIds: [s.op.id] });
  expect(suggestion).toEqual({ preferredUserId: online.id, policy: 'highest_priority', reason: 'highest_priority: 1' });
  await close();
});

test('effectiveDispatchPolicy: a workflow-level override beats the work center default', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC', dispatchPolicy: 'highest_priority' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {}, dispatchPolicy: 'manual' }).returning();
  const suggestion = await computeSuggestion(db, { workCenterId: wc.id, workflowId: wf.id, allowedRoleIds: [] });
  expect(suggestion).toEqual({ preferredUserId: null, policy: 'manual', reason: 'unrestricted: pull-based claim' });
  await close();
});

test('effectiveAutoClaim: workflow override wins; null inherits; default false', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC-ac', autoClaim: true }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  expect(await effectiveAutoClaim(db, wc.id, wf.id)).toBe(true); // null override inherits wc true

  await db.update(workflow).set({ autoClaim: false }).where(eq(workflow.id, wf.id));
  expect(await effectiveAutoClaim(db, wc.id, wf.id)).toBe(false); // override false beats wc true

  await db.update(workflow).set({ autoClaim: true }).where(eq(workflow.id, wf.id));
  await db.update(workCenter).set({ autoClaim: false }).where(eq(workCenter.id, wc.id));
  expect(await effectiveAutoClaim(db, wc.id, wf.id)).toBe(true); // override true beats wc false

  const [wc2] = await db.insert(workCenter).values({ name: 'WC-ac2' }).returning();
  const [wf2] = await db.insert(workflow).values({ oid: 'w2', name: 'W2', workCenterId: wc2.id, specJsonb: {} }).returning();
  expect(await effectiveAutoClaim(db, wc2.id, wf2.id)).toBe(false); // both defaults
  await close();
});

test('listOnlineCandidates: role-restricted — online members holding the role, deduped by user', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'least_queued_steps');
  const dual = await s.mkUser('dual@x.io', 0, 'online');
  // Second matching role for the same user — the raw join returns two rows; the helper must return one.
  const [op2] = await db.insert(role).values({ name: 'Operator2' }).returning();
  await db.insert(workCenterUserRole).values({ workCenterId: s.wc.id, userId: dual.id, roleId: op2.id });
  await s.mkUser('away@x.io', 0, 'away');      // holds the role but away
  await s.mkUser('offline@x.io', 0, null);     // holds the role but absent
  const candidates = await listOnlineCandidates(db, { workCenterId: s.wc.id, allowedRoleIds: [s.op.id, op2.id] });
  expect(candidates).toHaveLength(1);
  expect(candidates[0].userId).toBe(dual.id);
  expect([s.op.id, op2.id]).toContain(candidates[0].matchedRoleId);
  await close();
});

test('listOnlineCandidates: unrestricted ([]) — every online member, matchedRoleId null', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'least_queued_steps');
  const a = await s.mkUser('a@x.io', 0, 'online');
  const b = await s.mkUser('b@x.io', 0, 'online');
  await s.mkUser('c@x.io', 0, 'away');
  // Online in the WC but NOT a member: presence without work_center_user must not qualify.
  const [ghost] = await db.insert(appUser).values({ email: 'ghost@x.io', displayName: 'G' }).returning();
  await db.insert(operatorPresence).values({ userId: ghost.id, attendingWorkCenterId: s.wc.id, sessionId: 'ghost', status: 'online' });
  const candidates = await listOnlineCandidates(db, { workCenterId: s.wc.id, allowedRoleIds: [] });
  expect(candidates.map((c) => c.userId).sort()).toEqual([a.id, b.id].sort());
  expect(candidates.every((c) => c.matchedRoleId === null)).toBe(true);
  await close();
});

test('listOnlineCandidates: nobody eligible -> empty', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'least_queued_steps');
  await s.mkUser('noRole@x.io', 0, 'online');
  const [other] = await db.insert(role).values({ name: 'Unheld' }).returning();
  const candidates = await listOnlineCandidates(db, { workCenterId: s.wc.id, allowedRoleIds: [other.id] });
  // noRole@x.io HOLDS s.op — but the allowed set is [Unheld], which nobody online holds.
  expect(candidates).toHaveLength(0);
  await close();
});

test('listOnlineCandidates: a role held only in another work center does not qualify', async () => {
  const { db, close } = await makeTestDb();
  const s = await seed(db, 'least_queued_steps');
  const [otherWc] = await db.insert(workCenter).values({ name: 'Other' }).returning();
  const [u] = await db.insert(appUser).values({ email: 'far@x.io', displayName: 'far' }).returning();
  await db.insert(workCenterUser).values([{ workCenterId: s.wc.id, userId: u.id }, { workCenterId: otherWc.id, userId: u.id }]);
  await db.insert(workCenterUserRole).values({ workCenterId: otherWc.id, userId: u.id, roleId: s.op.id });
  await db.insert(operatorPresence).values({ userId: u.id, attendingWorkCenterId: s.wc.id, sessionId: 'far', status: 'online' });
  expect(await listOnlineCandidates(db, { workCenterId: s.wc.id, allowedRoleIds: [s.op.id] })).toEqual([]);
  await close();
});
