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
import { makeTestDb } from '../../../test/helpers/db.js';
import { appUser } from './identity.js';

test('user email is unique', async () => {
  const { db, close } = await makeTestDb();
  await db.insert(appUser).values({ email: 'op@x.io', displayName: 'Op' });
  await expect(
    db.insert(appUser).values({ email: 'op@x.io', displayName: 'Dup' }),
  ).rejects.toThrow();
  await close();
});
