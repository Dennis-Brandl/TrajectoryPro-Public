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
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter, operatorPresence } from '../db/schema/index.js';
import { createUser } from './users.js';
import { listWorkCenterPresence } from './presence.js';

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  return { wc };
}

test('listWorkCenterPresence: online+away only, offline excluded', async () => {
  const { db, close } = await makeTestDb();
  const { wc } = await seed(db);
  const { wc: otherWc } = await seed(db);

  const a = await createUser(db, { email: `a-${Math.random()}@t.test`, displayName: 'A' });
  const b = await createUser(db, { email: `b-${Math.random()}@t.test`, displayName: 'B' });
  const c = await createUser(db, { email: `c-${Math.random()}@t.test`, displayName: 'C' });
  const d = await createUser(db, { email: `d-${Math.random()}@t.test`, displayName: 'D' });

  await db.insert(operatorPresence).values([
    { userId: a.id, attendingWorkCenterId: wc.id, sessionId: `sess-${Math.random()}`, status: 'online' },
    { userId: b.id, attendingWorkCenterId: wc.id, sessionId: `sess-${Math.random()}`, status: 'away' },
    { userId: c.id, attendingWorkCenterId: wc.id, sessionId: `sess-${Math.random()}`, status: 'offline' },
    { userId: d.id, attendingWorkCenterId: otherWc.id, sessionId: `sess-${Math.random()}`, status: 'online' },
  ]);

  const rows = await listWorkCenterPresence(db, wc.id);
  expect(rows.map((r) => [r.name, r.status]).sort()).toEqual([['A', 'online'], ['B', 'away']]);

  await close();
});
