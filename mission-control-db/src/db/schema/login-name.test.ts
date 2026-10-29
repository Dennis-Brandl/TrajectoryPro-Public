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
import { makeTestDb } from '../../../test/helpers/db.js';
import { appUser } from './identity.js';

test('login_name is derived from the email when omitted, de-duplicated with a numeric suffix', async () => {
  const { db, close } = await makeTestDb();
  const [a] = await db.insert(appUser).values({ email: 'Bob.Smith@X.io', displayName: 'A' }).returning();
  const [b] = await db.insert(appUser).values({ email: 'bob.smith@y.io', displayName: 'B' }).returning();
  const [c] = await db.insert(appUser).values({ email: '.weird+name@z.io', displayName: 'C' }).returning();
  const [d] = await db.insert(appUser).values({ email: 'a@x.io', displayName: 'D' }).returning();
  expect(a.loginName).toBe('bob.smith');
  expect(b.loginName).toBe('bob.smith-2');
  expect(c.loginName).toBe('weird-name');
  expect(d.loginName).toBe('user');          // a 1-char local part falls back to 'user'
  await close();
});

test('an explicit login_name is kept; the CHECK rejects invalid shapes; UNIQUE rejects duplicates', async () => {
  const { db, close } = await makeTestDb();
  const [u] = await db.insert(appUser).values({ email: 'j@x.io', displayName: 'J', loginName: 'jdoe' }).returning();
  expect(u.loginName).toBe('jdoe');
  await expect(db.insert(appUser).values({ email: 'k@x.io', displayName: 'K', loginName: 'jdoe' })).rejects.toThrow();
  await expect(db.insert(appUser).values({ email: 'l@x.io', displayName: 'L', loginName: 'Bad Name' })).rejects.toThrow();
  await expect(db.insert(appUser).values({ email: 'm@x.io', displayName: 'M', loginName: '-leading' })).rejects.toThrow();
  await expect(db.update(appUser).set({ loginName: '' }).where(eq(appUser.id, u.id))).rejects.toThrow();
  await close();
});
