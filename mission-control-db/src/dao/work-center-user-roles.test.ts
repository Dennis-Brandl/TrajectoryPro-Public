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
import { createRole, deleteRole } from './roles.js';
import { createWorkCenter, assignUserToWorkCenter, removeUserFromWorkCenter } from './work-centers.js';
import { DaoError } from './errors.js';
import {
  setWorkCenterUserRoles, rolesForUserInWorkCenter, rolesForWorkCenterMembers,
  workCenterMembershipsForUser, membersForRole, userHoldsRoleInWorkCenter,
} from './work-center-user-roles.js';

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

async function fixture(db: any) {
  const wc1 = await createWorkCenter(db, { name: 'Line 1' });
  const wc2 = await createWorkCenter(db, { name: 'Line 2' });
  const op = await createRole(db, { name: 'Operator' });
  const sup = await createRole(db, { name: 'Supervisor' });
  const alice = await createUser(db, { email: 'alice@x.io', displayName: 'Alice' });
  const bob = await createUser(db, { email: 'bob@x.io', displayName: 'Bob' });
  await assignUserToWorkCenter(db, wc1.id, alice.id);
  await assignUserToWorkCenter(db, wc2.id, alice.id, { missionSystemCommander: true });
  await assignUserToWorkCenter(db, wc1.id, bob.id);
  return { wc1, wc2, op, sup, alice, bob };
}

test('setWorkCenterUserRoles replaces the whole set atomically, de-duplicates, and is idempotent', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  await setWorkCenterUserRoles(db, f.wc1.id, f.alice.id, [f.sup.id, f.op.id, f.op.id]);
  expect((await rolesForUserInWorkCenter(db, f.wc1.id, f.alice.id)).map((r) => r.name)).toEqual(['Operator', 'Supervisor']);
  await setWorkCenterUserRoles(db, f.wc1.id, f.alice.id, [f.sup.id]);   // shrink
  expect((await rolesForUserInWorkCenter(db, f.wc1.id, f.alice.id)).map((r) => r.name)).toEqual(['Supervisor']);
  await setWorkCenterUserRoles(db, f.wc1.id, f.alice.id, [f.sup.id]);   // no-op, no throw
  await setWorkCenterUserRoles(db, f.wc1.id, f.alice.id, []);           // clear
  expect(await rolesForUserInWorkCenter(db, f.wc1.id, f.alice.id)).toEqual([]);
  // Scoped: Line 2 never saw any of that.
  expect(await rolesForUserInWorkCenter(db, f.wc2.id, f.alice.id)).toEqual([]);
  await close();
});

test('setWorkCenterUserRoles: non-member → LINK_TARGET_NOT_FOUND (even for an empty set); unknown role → LINK_TARGET_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  await expectDaoError(setWorkCenterUserRoles(db, f.wc2.id, f.bob.id, []), 'LINK_TARGET_NOT_FOUND');
  await expectDaoError(setWorkCenterUserRoles(db, f.wc2.id, f.bob.id, [f.op.id]), 'LINK_TARGET_NOT_FOUND');
  await expectDaoError(setWorkCenterUserRoles(db, f.wc1.id, f.bob.id, [NIL]), 'LINK_TARGET_NOT_FOUND');
  // A failed insert leaves the previous set intact (transactional).
  await setWorkCenterUserRoles(db, f.wc1.id, f.bob.id, [f.op.id]);
  await expectDaoError(setWorkCenterUserRoles(db, f.wc1.id, f.bob.id, [f.sup.id, NIL]), 'LINK_TARGET_NOT_FOUND');
  expect((await rolesForUserInWorkCenter(db, f.wc1.id, f.bob.id)).map((r) => r.name)).toEqual(['Operator']);
  await close();
});

test('grouped readers: per-work-center members, per-user memberships, per-role members', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  await setWorkCenterUserRoles(db, f.wc1.id, f.alice.id, [f.op.id]);
  await setWorkCenterUserRoles(db, f.wc2.id, f.alice.id, [f.sup.id]);
  await setWorkCenterUserRoles(db, f.wc1.id, f.bob.id, [f.op.id, f.sup.id]);

  const byMember = await rolesForWorkCenterMembers(db, f.wc1.id);
  expect(byMember.get(f.alice.id)?.map((r) => r.name)).toEqual(['Operator']);
  expect(byMember.get(f.bob.id)?.map((r) => r.name)).toEqual(['Operator', 'Supervisor']);

  const mine = await workCenterMembershipsForUser(db, f.alice.id);
  expect(mine.map((m) => m.workCenter.name)).toEqual(['Line 1', 'Line 2']);
  expect(mine.map((m) => m.missionSystemCommander)).toEqual([false, true]);
  expect(mine.map((m) => m.roles.map((r) => r.name))).toEqual([['Operator'], ['Supervisor']]);

  const members = await membersForRole(db, f.op.id);
  expect(members.map((m) => m.workCenter.name)).toEqual(['Line 1']);
  expect(members[0]!.users.map((u) => u.displayName)).toEqual(['Alice', 'Bob']);

  expect(await userHoldsRoleInWorkCenter(db, f.wc1.id, f.alice.id, f.op.id)).toBe(true);
  expect(await userHoldsRoleInWorkCenter(db, f.wc2.id, f.alice.id, f.op.id)).toBe(false);
  await close();
});

test('a member with no roles still appears in workCenterMembershipsForUser with roles []', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  const mine = await workCenterMembershipsForUser(db, f.bob.id);
  expect(mine).toHaveLength(1);
  expect(mine[0]!.workCenter.id).toBe(f.wc1.id);
  expect(mine[0]!.roles).toEqual([]);
  await close();
});

test('membersForRole groups by work-center id, not consecutive rows: same-named children under different parents do not interleave', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  const parentA = await createWorkCenter(db, { name: 'Plant A' });
  const parentB = await createWorkCenter(db, { name: 'Plant B' });
  const childA = await createWorkCenter(db, { name: 'Line 1', parentWorkCenterId: parentA.id });
  const childB = await createWorkCenter(db, { name: 'Line 1', parentWorkCenterId: parentB.id });
  const carol = await createUser(db, { email: 'carol@x.io', displayName: 'Carol' });
  await assignUserToWorkCenter(db, childA.id, f.alice.id);
  await assignUserToWorkCenter(db, childA.id, carol.id);
  await assignUserToWorkCenter(db, childB.id, f.bob.id);
  await setWorkCenterUserRoles(db, childA.id, f.alice.id, [f.op.id]);
  await setWorkCenterUserRoles(db, childB.id, f.bob.id, [f.op.id]);
  await setWorkCenterUserRoles(db, childA.id, carol.id, [f.op.id]);

  const members = await membersForRole(db, f.op.id);
  expect(members).toHaveLength(2);
  const byId = new Map(members.map((m) => [m.workCenter.id, m]));
  expect(byId.get(childA.id)?.users.map((u) => u.displayName)).toEqual(['Alice', 'Carol']);
  expect(byId.get(childB.id)?.users.map((u) => u.displayName)).toEqual(['Bob']);
  await close();
});

test('unassigning the member or deleting the role cascades the assignments', async () => {
  const { db, close } = await makeTestDb();
  const f = await fixture(db);
  await setWorkCenterUserRoles(db, f.wc1.id, f.alice.id, [f.op.id, f.sup.id]);
  await deleteRole(db, f.sup.id);
  expect((await rolesForUserInWorkCenter(db, f.wc1.id, f.alice.id)).map((r) => r.name)).toEqual(['Operator']);
  await removeUserFromWorkCenter(db, f.wc1.id, f.alice.id);
  expect(await rolesForUserInWorkCenter(db, f.wc1.id, f.alice.id)).toEqual([]);
  await close();
});
