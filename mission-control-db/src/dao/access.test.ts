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
import { TIER_RIGHTS, hasRight, RIGHTS, type Principal } from './access.js';

const principal = (accessLevel: Principal['accessLevel']): Principal => ({
  userId: 'u', accessLevel, rights: TIER_RIGHTS[accessLevel],
});

test('RIGHTS is the closed category×verb catalog', () => {
  expect(RIGHTS).toContain('work_center:link');
  expect(RIGHTS).toContain('access:edit');
  expect(RIGHTS).not.toContain('user:link'); // user/role have no link verb
});

test('viewer may only read non-access categories', () => {
  const p = principal('viewer');
  expect(hasRight(p, 'work_center:read')).toBe(true);
  expect(hasRight(p, 'work_center:create')).toBe(false);
  expect(hasRight(p, 'access:read')).toBe(false);
});

test('steward has every non-access right and no access right', () => {
  const p = principal('steward');
  expect(hasRight(p, 'work_center:delete')).toBe(true);
  expect(hasRight(p, 'user:create')).toBe(true);
  expect(hasRight(p, 'access:edit')).toBe(false);
});

test('administrator has every right including access', () => {
  const p = principal('administrator');
  expect(hasRight(p, 'access:edit')).toBe(true);
  expect(hasRight(p, 'work_center:link')).toBe(true);
});

test('settings domain (spec 2026-08-20): administrator + steward hold both verbs; viewer read-only', () => {
  expect(RIGHTS).toContain('settings:read');
  expect(RIGHTS).toContain('settings:edit');
  expect(hasRight(principal('administrator'), 'settings:edit')).toBe(true);
  expect(hasRight(principal('steward'), 'settings:edit')).toBe(true);
  expect(hasRight(principal('viewer'), 'settings:read')).toBe(true);
  expect(hasRight(principal('viewer'), 'settings:edit')).toBe(false);
});

import { makeTestDb } from '../../test/helpers/db.js';
import { appUser } from '../db/schema/index.js';
import { createUser } from './users.js';
import { loadPrincipal, setAccessLevel } from './access.js';
import { eq } from 'drizzle-orm';

test('new users default to viewer; loadPrincipal derives rights', async () => {
  const { db, close } = await makeTestDb();
  const u = await createUser(db, { email: 'p@x.io', displayName: 'P' });
  const [row] = await db.select().from(appUser).where(eq(appUser.id, u.id));
  expect(row.accessLevel).toBe('viewer');

  const p1 = await loadPrincipal(db, u.id);
  expect(p1?.accessLevel).toBe('viewer');
  expect(p1?.rights.has('work_center:create')).toBe(false);

  await setAccessLevel(db, u.id, 'administrator');
  const p2 = await loadPrincipal(db, u.id);
  expect(p2?.rights.has('access:edit')).toBe(true);

  expect(await loadPrincipal(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  await close();
});

test('access_level rejects values outside the enum', async () => {
  const { db, close } = await makeTestDb();
  await expect(
    db.insert(appUser).values({ email: 'b@x.io', displayName: 'B', accessLevel: 'root' as never }),
  ).rejects.toThrow();
  await close();
});

test('library rights are gone, and so are the never-used artifact link verbs', () => {
  expect(RIGHTS.filter((r) => r.startsWith('library:'))).toEqual([]);
  expect(RIGHTS).not.toContain('workflow:link');
  expect(RIGHTS).not.toContain('environment:link');
  // work_center:link survives — it still governs user assignment and allowed-roles editing.
  expect(RIGHTS).toContain('work_center:link');
  expect(RIGHTS).toContain('workflow:create');
  expect(RIGHTS).toContain('environment:create');
});
