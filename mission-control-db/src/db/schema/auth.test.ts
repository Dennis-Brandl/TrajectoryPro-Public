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
import { appUser } from './index.js';
import { session, account, verification } from './index.js';

test('app_user gains email_verified (default false) and nullable image', async () => {
  const { db, close } = await makeTestDb();
  const [u] = await db.insert(appUser).values({ email: 'a@x.io', displayName: 'A' }).returning();
  expect(u.emailVerified).toBe(false);
  expect(u.image).toBeNull();
  await close();
});

test('session/account/verification exist; session cascades on user delete', async () => {
  const { db, close } = await makeTestDb();
  const [u] = await db.insert(appUser).values({ email: 's@x.io', displayName: 'S' }).returning();

  const [s] = await db
    .insert(session)
    .values({ userId: u.id, token: 'tok-1', expiresAt: new Date(Date.now() + 3_600_000) })
    .returning();
  expect(typeof s.id).toBe('string'); // uuid string
  expect(s.userId).toBe(u.id);

  await db.insert(account).values({ userId: u.id, accountId: u.id, providerId: 'credential', password: 'hash' });
  await db.insert(verification).values({ identifier: 'a@x.io', value: 'v', expiresAt: new Date(Date.now() + 60_000) });

  await db.delete(appUser).where(eq(appUser.id, u.id)); // cascade removes session + account
  expect(await db.select().from(session).where(eq(session.userId, u.id))).toHaveLength(0);
  expect(await db.select().from(account).where(eq(account.userId, u.id))).toHaveLength(0);
  await close();
});
