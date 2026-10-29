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

import { expect, test, describe } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db.js';
import { runtimeCols } from '../../../test/helpers/instances.js';
import { workCenter, workflow } from './index.js';
import { workflowInstance, stepInstance, operatorPresence, instanceAssignment } from './execution.js';
import { appUser } from './identity.js';

test('instance + step rows persist; presence enforces one WC per (user, work center)', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
  const [inst] = await db.insert(workflowInstance).values({ workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols() }).returning();
  await db.insert(stepInstance).values({ workflowInstanceId: inst.id, nodeOid: 'w', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER' });

  const [u] = await db.insert(appUser).values({ email: 'p@x.io', displayName: 'P' }).returning();
  await db.insert(operatorPresence).values({ userId: u.id, attendingWorkCenterId: wc.id, sessionId: 'dev-1' });
  // same (user, work center) again -> reject (A3)
  await expect(db.insert(operatorPresence).values({ userId: u.id, attendingWorkCenterId: wc.id, sessionId: 'dev-2' })).rejects.toThrow();
  await close();
});

describe('instance_assignment 0019 (offer/claim reshape)', () => {
  test('defaults status to offered and accepts the new columns', async () => {
    const { db, close } = await makeTestDb();
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const [inst] = await db.insert(workflowInstance).values({ workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols() }).returning();
    const [step] = await db.insert(stepInstance).values({ workflowInstanceId: inst.id, nodeOid: 'w', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER' }).returning();

    const [a] = await db.insert(instanceAssignment).values({
      stepInstanceId: step.id, workCenterId: wc.id, allowedRoleIds: ['r1', 'r2'],
    }).returning();
    expect(a.status).toBe('offered');
    expect(a.allowedRoleIds).toEqual(['r1', 'r2']);
    expect(a.preferredUserId).toBeNull();
    await close();
  });

  test('rejects the retired statuses', async () => {
    const { db, close } = await makeTestDb();
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const [inst] = await db.insert(workflowInstance).values({ workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols() }).returning();
    const [step] = await db.insert(stepInstance).values({ workflowInstanceId: inst.id, nodeOid: 'w', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER' }).returning();

    try {
      await db.insert(instanceAssignment).values({
        stepInstanceId: step.id, workCenterId: wc.id, status: 'assigned',
      });
      throw new Error('should have rejected');
    } catch (err: any) {
      const errorStr = JSON.stringify(err, null, 2);
      expect(errorStr).toContain('instance_assignment_status_ck');
    }
    await close();
  });

  test('allows at most one LIVE assignment per step, but any number of closed ones', async () => {
    const { db, close } = await makeTestDb();
    const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
    const [wf] = await db.insert(workflow).values({ oid: 'w', name: 'W', workCenterId: wc.id, specJsonb: {} }).returning();
    const [inst] = await db.insert(workflowInstance).values({ workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', ...runtimeCols() }).returning();
    const [step] = await db.insert(stepInstance).values({ workflowInstanceId: inst.id, nodeOid: 'w', stepOid: 's1', stepType: 'USER_INTERACTION', state: 'WAITING_USER' }).returning();

    await db.insert(instanceAssignment).values({ stepInstanceId: step.id, workCenterId: wc.id, status: 'cancelled' });
    await db.insert(instanceAssignment).values({ stepInstanceId: step.id, workCenterId: wc.id, status: 'offered' });

    try {
      await db.insert(instanceAssignment).values({
        stepInstanceId: step.id, workCenterId: wc.id, status: 'claimed',
      });
      throw new Error('should have rejected');
    } catch (err: any) {
      const errorStr = JSON.stringify(err, null, 2);
      expect(errorStr).toContain('instance_assignment_step_live_uq');
    }
    await close();
  });
});
