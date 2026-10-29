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
  workCenter, workflow, role, appUser, workCenterUser, workCenterUserRole,
  workflowInstance, stepInstance, instanceAssignment,
} from '../db/schema/index.js';
import { listOperatorWorkCenters } from './operator-work-centers.js';

const SPEC = { oid: 'rt_1', master_oid: 'M-root', connections: [], steps: [], children: [] };

async function seedWc(db: any, name: string, parentWorkCenterId: string | null = null) {
  const [wc] = await db.insert(workCenter).values({ name, parentWorkCenterId }).returning();
  return wc;
}

async function seedUser(db: any, email: string) {
  const [u] = await db.insert(appUser).values({ email, displayName: email }).returning();
  return u;
}

async function join(db: any, workCenterId: string, userId: string) {
  await db.insert(workCenterUser).values({ workCenterId, userId });
}

async function seedInstance(db: any, workCenterId: string) {
  const [wf] = await db.insert(workflow).values({ oid: `w-${Math.random()}`, name: 'W', workCenterId, specJsonb: {} }).returning();
  const [inst] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId, triggeredBy: 'manual', status: 'running',
    ...runtimeCols({ specJsonb: SPEC }),
  }).returning();
  return inst;
}

// One step + one assignment per call: the shape buildInbox reads.
async function seedTask(db: any, workCenterId: string, instanceId: string, step: Record<string, unknown>, assignment: Record<string, unknown>) {
  const [s] = await db.insert(stepInstance).values({
    workflowInstanceId: instanceId, nodeOid: 'rt_1', stepOid: `s-${Math.random()}`,
    stepType: 'USER_INTERACTION', state: 'WAITING_USER', ...step,
  }).returning();
  await db.insert(instanceAssignment).values({
    stepInstanceId: s.id, workCenterId, status: 'offered', allowedRoleIds: [], ...assignment,
  });
}

describe('listOperatorWorkCenters (spec 2026-10-09 §5.5)', () => {
  it('lists only my work centers, each with its ancestor path from the root, tree-ordered', async () => {
    const { db, close } = await makeTestDb();
    const plant = await seedWc(db, 'Plant');
    const mixing = await seedWc(db, 'Mixing', plant.id);
    const line2 = await seedWc(db, 'Line 2', mixing.id);
    await seedWc(db, 'Elsewhere');
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    await join(db, line2.id, me.id);
    await join(db, plant.id, me.id);

    const list = await listOperatorWorkCenters(db, me.id);
    expect(list).toEqual([
      { id: plant.id, name: 'Plant', path: [], openTasks: 0 },
      { id: line2.id, name: 'Line 2', path: ['Plant', 'Mixing'], openTasks: 0 },
    ]);
    await close();
  });

  it('counts what my inbox there would list: visible offers and my claims on waiting or paused steps', async () => {
    const { db, close } = await makeTestDb();
    const wc = await seedWc(db, 'Here');
    const other = await seedWc(db, 'There');
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    const someone = await seedUser(db, `someone-${Math.random()}@t.test`);
    await join(db, wc.id, me.id);
    await join(db, other.id, me.id);
    const [held] = await db.insert(role).values({ name: `Held-${Math.random()}` }).returning();
    const [heldElsewhere] = await db.insert(role).values({ name: `Elsewhere-${Math.random()}` }).returning();
    const [lacked] = await db.insert(role).values({ name: `Lacked-${Math.random()}` }).returning();
    await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: me.id, roleId: held.id });
    await db.insert(workCenterUserRole).values({ workCenterId: other.id, userId: me.id, roleId: heldElsewhere.id });
    const inst = await seedInstance(db, wc.id);

    // Counted: an open offer, an offer for a role I hold HERE, my waiting claim, my paused claim.
    await seedTask(db, wc.id, inst.id, {}, {});
    await seedTask(db, wc.id, inst.id, {}, { allowedRoleIds: [held.id] });
    await seedTask(db, wc.id, inst.id, {}, { status: 'claimed', assignedUserId: me.id, claimedAt: new Date() });
    await seedTask(db, wc.id, inst.id, { state: 'PAUSED' }, { status: 'claimed', assignedUserId: me.id, claimedAt: new Date() });
    // Not counted: a role I lack, a role I hold only in another work center, someone else's
    // claim, an offer whose step is not waiting for an operator, my claim on an executing
    // step, and a finished assignment.
    await seedTask(db, wc.id, inst.id, {}, { allowedRoleIds: [lacked.id] });
    await seedTask(db, wc.id, inst.id, {}, { allowedRoleIds: [heldElsewhere.id] });
    await seedTask(db, wc.id, inst.id, {}, { status: 'claimed', assignedUserId: someone.id, claimedAt: new Date() });
    await seedTask(db, wc.id, inst.id, { state: 'EXECUTING' }, {});
    await seedTask(db, wc.id, inst.id, { state: 'EXECUTING' }, { status: 'claimed', assignedUserId: me.id, claimedAt: new Date() });
    await seedTask(db, wc.id, inst.id, { state: 'COMPLETED' }, { status: 'completed', assignedUserId: me.id });

    const list = await listOperatorWorkCenters(db, me.id);
    expect(list.find((w) => w.id === wc.id)?.openTasks).toBe(4);
    expect(list.find((w) => w.id === other.id)?.openTasks).toBe(0);
    await close();
  });

  it('a parent cycle in bad data ends the path instead of looping (Review Focus 1)', async () => {
    const { db, close } = await makeTestDb();
    const a = await seedWc(db, 'A');
    const b = await seedWc(db, 'B', a.id);
    await db.update(workCenter).set({ parentWorkCenterId: b.id }).where(eq(workCenter.id, a.id));
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    await join(db, a.id, me.id);

    const list = await listOperatorWorkCenters(db, me.id);
    expect(list).toEqual([{ id: a.id, name: 'A', path: ['B'], openTasks: 0 }]);
    await close();
  });

  it('no memberships, no cards', async () => {
    const { db, close } = await makeTestDb();
    await seedWc(db, 'Lonely');
    const me = await seedUser(db, `me-${Math.random()}@t.test`);
    expect(await listOperatorWorkCenters(db, me.id)).toEqual([]);
    await close();
  });
});
