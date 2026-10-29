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
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { appUser } from 'mission-control-db/src/db/schema/index';
import { ACCOUNT_DISABLED_MESSAGE } from 'mission-control-db/src/dao/account-status';
import { migrateTestDb, resetDb } from '../test/fixture';
import { auth } from './auth';

beforeAll(async () => {
  await migrateTestDb();
});
beforeEach(async () => {
  await resetDb();
});

async function signUp(email: string, name: string): Promise<void> {
  await auth.api.signUpEmail({ body: { email, password: 'pw-123456', name } });
}
async function disable(email: string): Promise<string> {
  const [row] = await db.update(appUser).set({ status: 'disabled' }).where(eq(appUser.email, email)).returning({ id: appUser.id });
  return row.id;
}

describe('disabled accounts cannot get a session', () => {
  it('sign-in is refused with the disabled message (what the login page renders as error.message)', async () => {
    await signUp('admin@x.io', 'Admin');
    await signUp('v@x.io', 'Vic');
    await disable('v@x.io');
    const res = await auth.api.signInEmail({ body: { email: 'v@x.io', password: 'pw-123456' }, asResponse: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ message: ACCOUNT_DISABLED_MESSAGE, code: 'ACCOUNT_DISABLED' });
  });

  it('an admin cannot impersonate a disabled user', async () => {
    await signUp('admin@x.io', 'Admin');
    await signUp('v@x.io', 'Vic');
    const adminRes = await auth.api.signInEmail({ body: { email: 'admin@x.io', password: 'pw-123456' }, asResponse: true });
    const adminHeaders = new Headers({ cookie: adminRes.headers.get('set-cookie') ?? '' });
    const vicId = await disable('v@x.io');
    await expect(
      auth.api.impersonateUser({ body: { userId: vicId }, headers: adminHeaders }),
    ).rejects.toMatchObject({ statusCode: 403, body: { code: 'ACCOUNT_DISABLED' } });
  });
});
