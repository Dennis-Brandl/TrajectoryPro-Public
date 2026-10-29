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
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { appUser, role } from './identity.js';
import { workCenter, workCenterUser, workCenterUserRole } from './work-centers.js';

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: 'WC' }).returning();
  const [u] = await db.insert(appUser).values({ email: 'op@x.io', displayName: 'Op' }).returning();
  const [r] = await db.insert(role).values({ name: 'Operator' }).returning();
  return { wc, u, r };
}

test('a role row requires an existing membership (composite FK) and is unique per (wc, user, role)', async () => {
  const { db, close } = await makeTestDb();
  const { wc, u, r } = await seed(db);
  // Not a member yet → FK violation (SQLSTATE 23503). Drizzle wraps the driver error as
  // `cause`, so the FK-specific check is against `cause.code`, not the outer message.
  await expect(
    db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: u.id, roleId: r.id }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });

  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: u.id });
  await db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: u.id, roleId: r.id });
  // Same triple again → PK violation.
  await expect(
    db.insert(workCenterUserRole).values({ workCenterId: wc.id, userId: u.id, roleId: r.id }),
  ).rejects.toThrow();
  await close();
});

test('removing the membership cascades the role rows; deleting the role cascades too', async () => {
  const { db, close } = await makeTestDb();
  const { wc, u, r } = await seed(db);
  const [r2] = await db.insert(role).values({ name: 'Supervisor' }).returning();
  await db.insert(workCenterUser).values({ workCenterId: wc.id, userId: u.id });
  await db.insert(workCenterUserRole).values([
    { workCenterId: wc.id, userId: u.id, roleId: r.id },
    { workCenterId: wc.id, userId: u.id, roleId: r2.id },
  ]);

  await db.delete(role).where(eq(role.id, r2.id));
  expect(await db.select().from(workCenterUserRole)).toHaveLength(1);

  await db.delete(workCenterUser).where(and(eq(workCenterUser.workCenterId, wc.id), eq(workCenterUser.userId, u.id)));
  expect(await db.select().from(workCenterUserRole)).toHaveLength(0);
  await close();
});
