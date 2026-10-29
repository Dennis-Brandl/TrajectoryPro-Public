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
import { appUser } from '../db/schema/index.js';
import { createUser, updateUser, findUserByLoginName, normalizeLoginName, isValidLoginName, mapLoginNameError } from './users.js';
import { DaoError } from './errors.js';

test('createUser derives the better-auth role mirror from accessLevel', async () => {
  const { db, close } = await makeTestDb();
  const admin = await createUser(db, { email: 'admin@b.io', displayName: 'Admin', accessLevel: 'administrator' });
  expect(admin.role).toBe('admin');
  const defaulted = await createUser(db, { email: 'default@b.io', displayName: 'Default' });
  expect(defaulted.role).toBe('user');
  const steward = await createUser(db, { email: 'steward@b.io', displayName: 'Steward', accessLevel: 'steward' });
  expect(steward.role).toBe('user'); // only 'administrator' maps to the 'admin' mirror
  await close();
});

test('updateUser renames; missing user → USER_NOT_FOUND', async () => {
  const { db, close } = await makeTestDb();
  const u = await createUser(db, { email: 'a@b.io', displayName: 'A' });
  const updated = await updateUser(db, u.id, { displayName: 'A Prime' });
  expect(updated.displayName).toBe('A Prime');
  try {
    await updateUser(db, '00000000-0000-0000-0000-000000000000', { displayName: 'X' });
    expect.fail('expected DaoError USER_NOT_FOUND');
  } catch (err) {
    expect(err).toBeInstanceOf(DaoError);
    expect((err as DaoError).code).toBe('USER_NOT_FOUND');
  }
  await close();
});

test('login name helpers: normalise + validate', () => {
  expect(normalizeLoginName('  JDoe ')).toBe('jdoe');
  expect(isValidLoginName('jdoe')).toBe(true);
  expect(isValidLoginName('j.doe_1-x')).toBe(true);
  expect(isValidLoginName('j')).toBe(false);
  expect(isValidLoginName('.jdoe')).toBe(false);
  expect(isValidLoginName('j doe')).toBe(false);
  expect(isValidLoginName('x'.repeat(65))).toBe(false);
  expect(isValidLoginName('x'.repeat(64))).toBe(true);
});

test('createUser: explicit login name is normalised and validated; omitted → derived; duplicate → LOGIN_NAME_CONFLICT', async () => {
  const { db, close } = await makeTestDb();
  const j = await createUser(db, { email: 'j@x.io', displayName: 'J', loginName: ' JDoe ' });
  expect(j.loginName).toBe('jdoe');
  const derived = await createUser(db, { email: 'k.lee@x.io', displayName: 'K' });
  expect(derived.loginName).toBe('k.lee');
  try {
    await createUser(db, { email: 'l@x.io', displayName: 'L', loginName: 'no spaces' });
    expect.fail('expected LOGIN_NAME_INVALID');
  } catch (err) { expect((err as DaoError).code).toBe('LOGIN_NAME_INVALID'); }
  try {
    await createUser(db, { email: 'm@x.io', displayName: 'M', loginName: 'JDOE' });
    expect.fail('expected LOGIN_NAME_CONFLICT');
  } catch (err) { expect((err as DaoError).code).toBe('LOGIN_NAME_CONFLICT'); }
  expect((await findUserByLoginName(db, ' JDOE '))?.id).toBe(j.id);
  expect(await findUserByLoginName(db, 'nobody')).toBeNull();
  await close();
});

test('updateUser: login name patch is normalised/validated; duplicate → LOGIN_NAME_CONFLICT; displayName alone still works', async () => {
  const { db, close } = await makeTestDb();
  const a = await createUser(db, { email: 'a@x.io', displayName: 'A', loginName: 'alpha' });
  await createUser(db, { email: 'b@x.io', displayName: 'B', loginName: 'bravo' });
  expect((await updateUser(db, a.id, { loginName: ' ALPHA-2 ' })).loginName).toBe('alpha-2');
  expect((await updateUser(db, a.id, { displayName: 'A2' })).displayName).toBe('A2');
  try {
    await updateUser(db, a.id, { loginName: 'bravo' });
    expect.fail('expected LOGIN_NAME_CONFLICT');
  } catch (err) { expect((err as DaoError).code).toBe('LOGIN_NAME_CONFLICT'); }
  try {
    await updateUser(db, a.id, { loginName: '!' });
    expect.fail('expected LOGIN_NAME_INVALID');
  } catch (err) { expect((err as DaoError).code).toBe('LOGIN_NAME_INVALID'); }
  await close();
});

test('updateUser: email patch is normalised/validated; duplicate → EMAIL_CONFLICT', async () => {
  const { db, close } = await makeTestDb();
  const a = await createUser(db, { email: 'a@x.io', displayName: 'A' });
  await createUser(db, { email: 'b@x.io', displayName: 'B' });
  expect((await updateUser(db, a.id, { email: ' New.Name@X.io ' })).email).toBe('new.name@x.io');
  try {
    await updateUser(db, a.id, { email: 'B@x.io' });
    expect.fail('expected EMAIL_CONFLICT');
  } catch (err) { expect((err as DaoError).code).toBe('EMAIL_CONFLICT'); }
  try {
    await updateUser(db, a.id, { email: 'not-an-email' });
    expect.fail('expected EMAIL_INVALID');
  } catch (err) { expect((err as DaoError).code).toBe('EMAIL_INVALID'); }
  await close();
});

test('mapLoginNameError maps a raw app_user_login_name_ck violation to LOGIN_NAME_INVALID', async () => {
  const { db, close } = await makeTestDb();
  const u = await createUser(db, { email: 'chk@x.io', displayName: 'Chk', loginName: 'chk' });
  // Bypass assertLoginName via a raw drizzle write to drive the real DB CHECK, the way a
  // caller outside this DAO (or a future bug in assertLoginName) could.
  let caught: unknown;
  try {
    await db.update(appUser).set({ loginName: 'Bad Name!' }).where(eq(appUser.id, u.id));
    expect.fail('expected the app_user_login_name_ck CHECK to reject this');
  } catch (err) {
    caught = err;
  }
  try {
    mapLoginNameError(caught);
    expect.fail('expected mapLoginNameError to throw');
  } catch (mapped) {
    expect(mapped).toBeInstanceOf(DaoError);
    expect((mapped as DaoError).code).toBe('LOGIN_NAME_INVALID');
  }
  await close();
});
