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
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../../test/helpers/db.js';
import { createUser, setUserStatus } from './users.js';
import {
  setAccessLevel, setAccessLevelGuarded, setUserStatusGuarded, roleForLevel,
} from './access.js';
import { DaoError } from './errors.js';
import { appUser } from '../db/schema/index.js';

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

test('roleForLevel maps administrator→admin, others→user', () => {
  expect(roleForLevel('administrator')).toBe('admin');
  expect(roleForLevel('steward')).toBe('user');
  expect(roleForLevel('viewer')).toBe('user');
});

test('setAccessLevel mirrors the better-auth role column in the same update', async () => {
  const { db, close } = await makeTestDb();
  const u = await createUser(db, { email: 'a@b.io', displayName: 'A' });
  await setAccessLevel(db, u.id, 'administrator');
  let [row] = await db.select().from(appUser).where(eq(appUser.id, u.id));
  expect(row.accessLevel).toBe('administrator');
  expect(row.role).toBe('admin');
  await setAccessLevel(db, u.id, 'steward');
  [row] = await db.select().from(appUser).where(eq(appUser.id, u.id));
  expect(row.role).toBe('user');
  await close();
});

test('guarded self-demote and self-disable → SELF_CHANGE_FORBIDDEN', async () => {
  const { db, close } = await makeTestDb();
  const admin = await createUser(db, { email: 'adm@x.io', displayName: 'Adm', accessLevel: 'administrator' });
  await expectDaoError(setAccessLevelGuarded(db, admin.id, admin.id, 'viewer'), 'SELF_CHANGE_FORBIDDEN');
  await expectDaoError(setUserStatusGuarded(db, admin.id, admin.id, 'disabled'), 'SELF_CHANGE_FORBIDDEN');
  await close();
});

test('demoting/disabling the last ACTIVE administrator → LAST_ADMIN', async () => {
  const { db, close } = await makeTestDb();
  const actor = await createUser(db, { email: 'actor@x.io', displayName: 'Actor', accessLevel: 'administrator' });
  const other = await createUser(db, { email: 'other@x.io', displayName: 'Other', accessLevel: 'administrator' });
  // Disable `actor` (allowed: `other` is still an active admin) — via low-level to keep setup terse:
  await setUserStatus(db, actor.id, 'disabled');
  // `other` is now the last active admin — a (hypothetical) third-party actor cannot touch it:
  await expectDaoError(setAccessLevelGuarded(db, actor.id, other.id, 'steward'), 'LAST_ADMIN');
  await expectDaoError(setUserStatusGuarded(db, actor.id, other.id, 'disabled'), 'LAST_ADMIN');
  await close();
});

test('with two active admins, demoting one succeeds (and mirrors role)', async () => {
  const { db, close } = await makeTestDb();
  const a = await createUser(db, { email: 'a@x.io', displayName: 'A', accessLevel: 'administrator' });
  const b = await createUser(db, { email: 'b@x.io', displayName: 'B', accessLevel: 'administrator' });
  await setAccessLevelGuarded(db, a.id, b.id, 'steward');
  const [row] = await db.select().from(appUser).where(eq(appUser.id, b.id));
  expect(row.accessLevel).toBe('steward');
  expect(row.role).toBe('user');
  await close();
});

test('guarded ops on a missing user → USER_NOT_FOUND; non-admin ops need no admin count', async () => {
  const { db, close } = await makeTestDb();
  const admin = await createUser(db, { email: 'adm@x.io', displayName: 'Adm', accessLevel: 'administrator' });
  const viewer = await createUser(db, { email: 'v@x.io', displayName: 'V' });
  await expectDaoError(setAccessLevelGuarded(db, admin.id, NIL, 'steward'), 'USER_NOT_FOUND');
  await expectDaoError(setUserStatusGuarded(db, admin.id, NIL, 'disabled'), 'USER_NOT_FOUND');
  await setUserStatusGuarded(db, admin.id, viewer.id, 'disabled'); // viewer disable never trips LAST_ADMIN
  await setUserStatusGuarded(db, admin.id, viewer.id, 'active');
  await close();
});
