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
import { workCenter } from '../db/schema/index.js';
import { DaoError } from './errors.js';
import { listControlGrants, setControlGrant, deleteControlGrant, getControlGrantScope } from './control-grants.js';

test('set (upsert), list both directions, scope lookup, delete', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [a] = await db.insert(workCenter).values({ name: 'A' }).returning();
    const [b] = await db.insert(workCenter).values({ name: 'B' }).returning();
    await setControlGrant(db, { sourceWorkCenterId: a.id, targetWorkCenterId: b.id, scope: 'own', userId: null });
    await setControlGrant(db, { sourceWorkCenterId: a.id, targetWorkCenterId: b.id, scope: 'any', userId: null });
    expect(await getControlGrantScope(db, a.id, b.id)).toBe('any');
    expect(await getControlGrantScope(db, b.id, a.id)).toBeNull();
    const fromA = await listControlGrants(db, a.id);
    expect(fromA.outgoing).toEqual([expect.objectContaining({ targetWorkCenterName: 'B', scope: 'any' })]);
    expect(fromA.incoming).toEqual([]);
    expect((await listControlGrants(db, b.id)).incoming).toEqual([expect.objectContaining({ sourceWorkCenterName: 'A' })]);
    await deleteControlGrant(db, a.id, b.id);
    await deleteControlGrant(db, a.id, b.id); // idempotent
    expect(await getControlGrantScope(db, a.id, b.id)).toBeNull();
  } finally { await close(); }
});

test('self-grant, bad scope and unknown work centers are refused', async () => {
  const { db, close } = await makeTestDb();
  try {
    const [a] = await db.insert(workCenter).values({ name: 'A' }).returning();
    await expect(setControlGrant(db, { sourceWorkCenterId: a.id, targetWorkCenterId: a.id, scope: 'own', userId: null }))
      .rejects.toMatchObject({ code: 'CONTROL_GRANT_INVALID' });
    await expect(setControlGrant(db, { sourceWorkCenterId: a.id, targetWorkCenterId: a.id, scope: 'all' as never, userId: null }))
      .rejects.toBeInstanceOf(DaoError);
    await expect(setControlGrant(db, { sourceWorkCenterId: a.id, targetWorkCenterId: '00000000-0000-0000-0000-000000000000', scope: 'own', userId: null }))
      .rejects.toMatchObject({ code: 'WORK_CENTER_NOT_FOUND' });
  } finally { await close(); }
});
