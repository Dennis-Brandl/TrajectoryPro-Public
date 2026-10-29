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
import { workCenter } from './work-centers.js';

test('duplicate sibling names are rejected; same name under different parents is allowed', async () => {
  const { db, close } = await makeTestDb();
  const [root] = await db.insert(workCenter).values({ name: 'Plant A' }).returning();
  await db.insert(workCenter).values({ name: 'Line 1', parentWorkCenterId: root.id });
  // duplicate sibling under the same parent -> reject
  await expect(
    db.insert(workCenter).values({ name: 'Line 1', parentWorkCenterId: root.id }),
  ).rejects.toThrow();
  // duplicate root name -> reject
  await expect(db.insert(workCenter).values({ name: 'Plant A' })).rejects.toThrow();
  // same child name under a different parent -> allowed
  const [rootB] = await db.insert(workCenter).values({ name: 'Plant B' }).returning();
  await db.insert(workCenter).values({ name: 'Line 1', parentWorkCenterId: rootB.id });
  await close();
});
