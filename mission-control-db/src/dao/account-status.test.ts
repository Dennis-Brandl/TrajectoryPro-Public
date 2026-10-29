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
import { createUser } from './users.js';
import { isUserDisabled, ACCOUNT_DISABLED_MESSAGE } from './account-status.js';

test('isUserDisabled: active false, disabled true, unknown id false', async () => {
  const { db, close } = await makeTestDb();
  const u = await createUser(db, { email: 'a@t.test', displayName: 'A' });
  expect(await isUserDisabled(db, u.id)).toBe(false);
  await db.update(appUser).set({ status: 'disabled' }).where(eq(appUser.id, u.id));
  expect(await isUserDisabled(db, u.id)).toBe(true);
  expect(await isUserDisabled(db, '00000000-0000-0000-0000-000000000000')).toBe(false);
  expect(ACCOUNT_DISABLED_MESSAGE).toBe('This account is disabled. Ask an administrator to enable it.');
  await close();
});
