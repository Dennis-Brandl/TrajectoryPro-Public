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
import { getTableColumns } from 'drizzle-orm';
import { makeTestDb } from '../../../test/helpers/db.js';
import { createUser } from '../../dao/users.js';
import { session } from './index.js';

test('app_user carries admin-plugin columns with role defaulting to user', async () => {
  const { db, close } = await makeTestDb();
  const u = await createUser(db, { email: 'a@b.io', displayName: 'A' });
  expect(u.role).toBe('user');
  expect(u.banned).toBeNull();
  expect(u.banReason).toBeNull();
  expect(u.banExpires).toBeNull();
  await close();
});

test('session carries the impersonatedBy column', () => {
  expect(getTableColumns(session).impersonatedBy).toBeDefined();
});
