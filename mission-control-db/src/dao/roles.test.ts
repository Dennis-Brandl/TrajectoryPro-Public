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
import { createUser } from './users.js';
import { createRole, listRoles, updateRole, deleteRole, findRoleByName } from './roles.js';
import { setWorkCenterUserRoles, rolesForUserInWorkCenter } from './work-center-user-roles.js';
import { assignUserToWorkCenter } from './work-centers.js';
import { DaoError } from './errors.js';
import {
  workflow, workflowNode, workCenter, workflowAllowedRole,
} from '../db/schema/index.js';

const NIL = '00000000-0000-0000-0000-000000000000';

async function expectDaoError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.fail(`expected DaoError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(DaoError);
    expect((err as DaoError).code).toBe(code);
  }
}

test('listRoles returns name-ascending', async () => {
  const { db, close } = await makeTestDb();
  await createRole(db, { name: 'Zeta' });
  await createRole(db, { name: 'Alpha' });
  expect((await listRoles(db)).map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  await close();
});

test('createRole duplicate name → ROLE_NAME_CONFLICT', async () => {
  const { db, close } = await makeTestDb();
  await createRole(db, { name: 'Operator' });
  await expectDaoError(createRole(db, { name: 'Operator' }), 'ROLE_NAME_CONFLICT');
  await close();
});

test('updateRole edits name+description; duplicate name → ROLE_NAME_CONFLICT', async () => {
  const { db, close } = await makeTestDb();
  const r = await createRole(db, { name: 'Operator' });
  await createRole(db, { name: 'Supervisor' });
  const updated = await updateRole(db, r.id, { name: 'Operator II', description: 'ops' });
  expect(updated.name).toBe('Operator II');
  expect(updated.description).toBe('ops');
  await expectDaoError(updateRole(db, r.id, { name: 'Supervisor' }), 'ROLE_NAME_CONFLICT');
  await close();
});

test('updateRole/deleteRole on is_system → SYSTEM_ROLE; missing → ROLE_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  const sys = await createRole(db, { name: 'System', isSystem: true });
  await expectDaoError(updateRole(db, sys.id, { name: 'Renamed' }), 'SYSTEM_ROLE');
  await expectDaoError(deleteRole(db, sys.id), 'SYSTEM_ROLE');
  await expectDaoError(updateRole(db, NIL, { name: 'X' }), 'ROLE_NOT_FOUND');
  await expectDaoError(deleteRole(db, NIL), 'ROLE_NOT_FOUND');
  await close();
});

test('deleteRole: referenced by allowed-role rows → ROLE_IN_USE; membership cascades', async () => {
  const { db, close } = await makeTestDb();
  const used = await createRole(db, { name: 'Used' });
  const member = await createRole(db, { name: 'HasMembers' });
  const u = await createUser(db, { email: 'a@b.io', displayName: 'A' });

  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  await assignUserToWorkCenter(db, wc.id, u.id);
  await setWorkCenterUserRoles(db, wc.id, u.id, [member.id]);
  const [wf] = await db.insert(workflow).values({ oid: 'wf-1', name: 'WF', workCenterId: wc.id, specJsonb: {} }).returning();
  const [node] = await db.insert(workflowNode).values({ workflowId: wf.id, nodeOid: 'n1', name: 'Root' }).returning();
  await db.insert(workflowAllowedRole).values({
    workflowId: wf.id, workflowNodeId: node.id, roleId: used.id,
  });

  await expectDaoError(deleteRole(db, used.id), 'ROLE_IN_USE');
  await deleteRole(db, member.id); // work_center_user_role rows cascade — members never block deletion
  expect(await rolesForUserInWorkCenter(db, wc.id, u.id)).toEqual([]);
  await close();
});

test('createRole rejects a name longer than 200 chars', async () => {
  const { db, close } = await makeTestDb();
  await expectDaoError(createRole(db, { name: 'x'.repeat(201) }), 'NAME_TOO_LONG');
  const r = await createRole(db, { name: 'x'.repeat(200) }); // boundary: exactly 200 is allowed
  expect(r.name).toHaveLength(200);
  await close();
});

test('updateRole rejects a name longer than 200 chars', async () => {
  const { db, close } = await makeTestDb();
  const r = await createRole(db, { name: 'Operator' });
  await expectDaoError(updateRole(db, r.id, { name: 'x'.repeat(201) }), 'NAME_TOO_LONG');
  const updated = await updateRole(db, r.id, { name: 'x'.repeat(200) }); // boundary: exactly 200 is allowed
  expect(updated.name).toHaveLength(200);
  await close();
});

test('findRoleByName: exact after trim, case-sensitive, null when absent', async () => {
  const { db, close } = await makeTestDb();
  const r = await createRole(db, { name: 'QA Lead' });
  expect((await findRoleByName(db, ' QA Lead '))?.id).toBe(r.id);
  expect(await findRoleByName(db, 'qa lead')).toBeNull();
  expect(await findRoleByName(db, 'Nope')).toBeNull();
  await close();
});
