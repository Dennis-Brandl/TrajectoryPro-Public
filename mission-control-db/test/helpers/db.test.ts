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
import { makeTestDb } from './db.js';

test('makeTestDb yields a working PGlite db with gen_random_uuid available', async () => {
  const { db, close } = await makeTestDb();
  const rows = await db.execute<{ id: string }>(`select gen_random_uuid() as id`);
  expect(rows.rows[0].id).toMatch(/[0-9a-f-]{36}/);
  await close();
});
